import { describe, expect, it, vi } from "vitest";
import {
  LEAGUE_GAME_BUNDLE_ID,
  resolveLeagueGameProcesses,
  signalLeagueGameProcess,
  terminateLeagueGameProcesses,
  type LeagueGameProcessIdentity,
  type LeagueProcessDependencies,
  type MacOSProcessSnapshot,
} from "./macos-league-process.ts";

const gameExecutablePath =
  "/Users/jotham/Games/League of Legends.app/Contents/LoL/Game/League of Legends.app/Contents/MacOS/LeagueofLegends";

function createSnapshot(
  overrides: Partial<MacOSProcessSnapshot> = {}
): MacOSProcessSnapshot {
  return {
    pid: 4242,
    uid: 501,
    executablePath: gameExecutablePath,
    startTime: { seconds: 100n, microseconds: 200n },
    ...overrides,
  };
}

function createDependencies(
  snapshots: MacOSProcessSnapshot[],
  overrides: Partial<LeagueProcessDependencies> = {}
): LeagueProcessDependencies {
  return {
    processSource: {
      list: vi.fn(() => snapshots),
      get: vi.fn((pid) =>
        snapshots.find((snapshot) => snapshot.pid === pid)
      ),
    },
    currentUid: vi.fn(() => 501),
    canonicalizePath: vi.fn((path) => path),
    readBundleValue: vi.fn(async (_plistPath, key) =>
      key === "CFBundleIdentifier"
        ? LEAGUE_GAME_BUNDLE_ID
        : "LeagueofLegends"
    ),
    signal: vi.fn(() => {}),
    ...overrides,
  };
}

function createIdentity(
  snapshot: MacOSProcessSnapshot
): LeagueGameProcessIdentity {
  return {
    ...snapshot,
    bundlePath:
      "/Users/jotham/Games/League of Legends.app/Contents/LoL/Game/League of Legends.app",
  };
}

describe("resolveLeagueGameProcesses", () => {
  it("accepts a same-user game process from the verified Riot game bundle", async () => {
    const snapshot = createSnapshot();

    await expect(
      resolveLeagueGameProcesses(createDependencies([snapshot]))
    ).resolves.toEqual([createIdentity(snapshot)]);
  });

  it("supports the alternate LeagueOfLegends inner bundle spelling", async () => {
    const snapshot = createSnapshot({
      executablePath: gameExecutablePath.replace(
        "/Game/League of Legends.app/",
        "/Game/LeagueOfLegends.app/"
      ),
    });

    await expect(
      resolveLeagueGameProcesses(createDependencies([snapshot]))
    ).resolves.toEqual([
      expect.objectContaining({ pid: snapshot.pid }),
    ]);
  });

  it("rejects a fake process with the League basename outside the Riot game bundle", async () => {
    const snapshot = createSnapshot({
      executablePath: "/tmp/LeagueofLegends",
    });
    const readBundleValue = vi.fn(async () => "unexpected");

    await expect(
      resolveLeagueGameProcesses(
        createDependencies([snapshot], { readBundleValue })
      )
    ).resolves.toEqual([]);
    expect(readBundleValue).not.toHaveBeenCalled();
  });

  it("never mistakes League Client UX or Riot Client for the game", async () => {
    const leagueClientUx = createSnapshot({
      executablePath:
        "/Applications/League of Legends.app/Contents/LoL/LeagueClient.app/Contents/MacOS/LeagueClientUx",
    });
    const riotClient = createSnapshot({
      pid: 4243,
      executablePath:
        "/Applications/Riot Client.app/Contents/MacOS/RiotClientServices",
    });

    await expect(
      resolveLeagueGameProcesses(
        createDependencies([leagueClientUx, riotClient])
      )
    ).resolves.toEqual([]);
  });

  it("rejects the wrong bundle identifier or executable", async () => {
    const snapshot = createSnapshot();
    const wrongBundle = createDependencies([snapshot], {
      readBundleValue: vi.fn(async (_path, key) =>
        key === "CFBundleIdentifier"
          ? "com.example.fake"
          : "LeagueofLegends"
      ),
    });
    const wrongExecutable = createDependencies([snapshot], {
      readBundleValue: vi.fn(async (_path, key) =>
        key === "CFBundleIdentifier"
          ? LEAGUE_GAME_BUNDLE_ID
          : "LeagueClientUx"
      ),
    });

    await expect(
      resolveLeagueGameProcesses(wrongBundle)
    ).resolves.toEqual([]);
    await expect(
      resolveLeagueGameProcesses(wrongExecutable)
    ).resolves.toEqual([]);
  });

  it("returns every verified game process instead of requiring exactly one", async () => {
    const first = createSnapshot();
    const second = createSnapshot({ pid: 4243 });

    await expect(
      resolveLeagueGameProcesses(
        createDependencies([first, second])
      )
    ).resolves.toEqual([createIdentity(first), createIdentity(second)]);
  });

  it("rejects a matching process owned by another user", async () => {
    const snapshot = createSnapshot({ uid: 502 });

    await expect(
      resolveLeagueGameProcesses(createDependencies([snapshot]))
    ).resolves.toEqual([]);
  });
});

describe("signalLeagueGameProcess", () => {
  it("signals only the exact revalidated PID", () => {
    const snapshot = createSnapshot();
    const dependencies = createDependencies([snapshot]);

    expect(
      signalLeagueGameProcess(
        createIdentity(snapshot),
        "SIGTERM",
        dependencies
      )
    ).toBe(true);
    expect(dependencies.signal).toHaveBeenCalledWith(
      snapshot.pid,
      "SIGTERM"
    );
  });

  it("does not signal a PID reused by another process", () => {
    const original = createSnapshot();
    const replacement = createSnapshot({
      startTime: { seconds: 101n, microseconds: 0n },
    });
    const dependencies = createDependencies([replacement]);

    expect(
      signalLeagueGameProcess(
        createIdentity(original),
        "SIGKILL",
        dependencies
      )
    ).toBe(false);
    expect(dependencies.signal).not.toHaveBeenCalled();
  });

  it("does not signal when the executable path or user changed", () => {
    const original = createSnapshot();
    const replacement = createSnapshot({
      uid: 502,
      executablePath: "/tmp/LeagueofLegends",
    });
    const dependencies = createDependencies([replacement]);

    expect(
      signalLeagueGameProcess(
        createIdentity(original),
        "SIGKILL",
        dependencies
      )
    ).toBe(false);
    expect(dependencies.signal).not.toHaveBeenCalled();
  });
});

describe("terminateLeagueGameProcesses", () => {
  it("does nothing when no verified game process is running", async () => {
    const dependencies = createDependencies([]);

    await terminateLeagueGameProcesses(dependencies);

    expect(dependencies.signal).not.toHaveBeenCalled();
  });

  it("terminates the exact game PID with SIGTERM", async () => {
    const snapshot = createSnapshot();
    let current: MacOSProcessSnapshot | undefined = snapshot;
    const signal = vi.fn(() => {
      current = undefined;
    });
    const dependencies = createDependencies([snapshot], {
      processSource: {
        list: vi.fn(() => [snapshot]),
        get: vi.fn(() => current),
      },
      signal,
    });

    await terminateLeagueGameProcesses(dependencies);

    expect(signal).toHaveBeenCalledTimes(1);
    expect(signal).toHaveBeenCalledWith(snapshot.pid, "SIGTERM");
  });

  it("force-terminates the game when it ignores SIGTERM", async () => {
    const snapshot = createSnapshot();
    let current: MacOSProcessSnapshot | undefined = snapshot;
    const signal = vi.fn((_pid: number, sentSignal: NodeJS.Signals) => {
      if (sentSignal === "SIGKILL") {
        current = undefined;
      }
    });
    const dependencies = createDependencies([snapshot], {
      processSource: {
        list: vi.fn(() => [snapshot]),
        get: vi.fn(() => current),
      },
      signal,
    });

    await terminateLeagueGameProcesses(dependencies, {
      termTimeoutMs: 0,
      killTimeoutMs: 0,
      pollIntervalMs: 1,
      wait: vi.fn(async () => {}),
    });

    expect(signal.mock.calls).toEqual([
      [snapshot.pid, "SIGTERM"],
      [snapshot.pid, "SIGKILL"],
    ]);
  });

  it("fails instead of locking while the exact PID survives SIGKILL", async () => {
    const snapshot = createSnapshot();
    const dependencies = createDependencies([snapshot]);

    await expect(
      terminateLeagueGameProcesses(dependencies, {
        termTimeoutMs: 0,
        killTimeoutMs: 0,
        pollIntervalMs: 1,
        wait: vi.fn(async () => {}),
      })
    ).rejects.toThrow(
      `League game process ${snapshot.pid} remained alive after SIGKILL`
    );
    expect(dependencies.signal).toHaveBeenNthCalledWith(
      1,
      snapshot.pid,
      "SIGTERM"
    );
    expect(dependencies.signal).toHaveBeenNthCalledWith(
      2,
      snapshot.pid,
      "SIGKILL"
    );
  });

  it("terminates all verified game PIDs while leaving client UX alone", async () => {
    const first = createSnapshot();
    const second = createSnapshot({ pid: 4243 });
    const leagueClientUx = createSnapshot({
      pid: 4244,
      executablePath:
        "/Applications/League of Legends.app/Contents/LoL/LeagueClient.app/Contents/MacOS/LeagueClientUx",
    });
    const current = new Map(
      [first, second, leagueClientUx].map((snapshot) => [
        snapshot.pid,
        snapshot,
      ])
    );
    const signal = vi.fn((pid: number) => {
      current.delete(pid);
    });
    const dependencies = createDependencies(
      [first, second, leagueClientUx],
      {
        processSource: {
          list: vi.fn(() => [first, second, leagueClientUx]),
          get: vi.fn((pid) => current.get(pid)),
        },
        signal,
      }
    );

    await terminateLeagueGameProcesses(dependencies);

    expect(signal.mock.calls).toEqual([
      [first.pid, "SIGTERM"],
      [second.pid, "SIGTERM"],
    ]);
    expect(current.has(leagueClientUx.pid)).toBe(true);
  });
});
