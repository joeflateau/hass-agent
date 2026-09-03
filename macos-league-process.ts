import { execFile } from "child_process";
import { realpathSync } from "fs";
import { basename, dirname, join } from "path";
import { promisify } from "util";
import { dlopen } from "node:ffi";

export const LIB_SYSTEM_PATH = "/usr/lib/libSystem.B.dylib";
export const PLUTIL_PATH = "/usr/bin/plutil";
export const LEAGUE_GAME_BUNDLE_ID =
  "com.riotgames.LeagueofLegends.GameClient";
export const LEAGUE_GAME_TERM_TIMEOUT_MS = 3_000;
export const LEAGUE_GAME_KILL_TIMEOUT_MS = 2_000;
export const LEAGUE_GAME_EXIT_POLL_INTERVAL_MS = 50;

const PROC_ALL_PIDS = 1;
const PROC_PIDTBSDINFO = 3;
const PROC_PIDPATHINFO_MAXSIZE = 4_096;
const PROC_BSDINFO_SIZE = 136;
const PROC_BSDINFO_UID_OFFSET = 20;
const PROC_BSDINFO_START_SECONDS_OFFSET = 120;
const PROC_BSDINFO_START_MICROSECONDS_OFFSET = 128;

const LIBPROC_SYMBOLS = {
  proc_listpids: {
    arguments: ["u32", "u32", "buffer", "i32"],
    return: "i32",
  },
  proc_pidpath: {
    arguments: ["i32", "buffer", "u32"],
    return: "i32",
  },
  proc_pidinfo: {
    arguments: ["i32", "i32", "u64", "buffer", "i32"],
    return: "i32",
  },
} as const;

export type ProcessStartTime = {
  seconds: bigint;
  microseconds: bigint;
};

export type MacOSProcessSnapshot = {
  pid: number;
  uid: number;
  executablePath: string;
  startTime: ProcessStartTime;
};

export type LeagueGameProcessIdentity = MacOSProcessSnapshot & {
  bundlePath: string;
};

export type MacOSProcessSource = {
  list: () => MacOSProcessSnapshot[];
  get: (pid: number) => MacOSProcessSnapshot | undefined;
};

export type LeagueProcessDependencies = {
  processSource: MacOSProcessSource;
  currentUid: () => number;
  canonicalizePath: (path: string) => string;
  readBundleValue: (plistPath: string, key: string) => Promise<string>;
  signal: (pid: number, signal: NodeJS.Signals) => void;
};

export type LeagueGameTerminationOptions = {
  termTimeoutMs?: number;
  killTimeoutMs?: number;
  pollIntervalMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
};

const execFileAsync = promisify(execFile);

function inspectPid(
  pid: number,
  functions: {
    proc_pidpath: (
      pid: number,
      buffer: Buffer,
      bufferSize: number
    ) => number;
    proc_pidinfo: (
      pid: number,
      flavor: number,
      arg: bigint,
      buffer: Buffer,
      bufferSize: number
    ) => number;
  }
): MacOSProcessSnapshot | undefined {
  if (!Number.isInteger(pid) || pid <= 1) {
    return undefined;
  }

  const info = Buffer.alloc(PROC_BSDINFO_SIZE);
  const infoBytes = functions.proc_pidinfo(
    pid,
    PROC_PIDTBSDINFO,
    0n,
    info,
    info.length
  );
  if (infoBytes < PROC_BSDINFO_SIZE) {
    return undefined;
  }

  const pathBuffer = Buffer.alloc(PROC_PIDPATHINFO_MAXSIZE);
  const pathBytes = functions.proc_pidpath(
    pid,
    pathBuffer,
    pathBuffer.length
  );
  if (pathBytes <= 0) {
    return undefined;
  }

  const executablePath = pathBuffer
    .subarray(0, pathBytes)
    .toString("utf8")
    .replace(/\0.*$/s, "");
  if (!executablePath) {
    return undefined;
  }

  return {
    pid,
    uid: info.readUInt32LE(PROC_BSDINFO_UID_OFFSET),
    executablePath,
    startTime: {
      seconds: info.readBigUInt64LE(
        PROC_BSDINFO_START_SECONDS_OFFSET
      ),
      microseconds: info.readBigUInt64LE(
        PROC_BSDINFO_START_MICROSECONDS_OFFSET
      ),
    },
  };
}

export function createNativeProcessSource(): MacOSProcessSource {
  return {
    list: () => {
      const { lib, functions } = dlopen(
        LIB_SYSTEM_PATH,
        LIBPROC_SYMBOLS
      );
      try {
        const requiredBytes = functions.proc_listpids(
          PROC_ALL_PIDS,
          0,
          null,
          0
        );
        if (requiredBytes <= 0) {
          return [];
        }

        const pidBuffer = Buffer.alloc(requiredBytes + 4_096);
        const returnedBytes = functions.proc_listpids(
          PROC_ALL_PIDS,
          0,
          pidBuffer,
          pidBuffer.length
        );
        if (returnedBytes <= 0) {
          return [];
        }

        const snapshots: MacOSProcessSnapshot[] = [];
        for (
          let offset = 0;
          offset + 4 <= returnedBytes;
          offset += 4
        ) {
          const snapshot = inspectPid(
            pidBuffer.readInt32LE(offset),
            functions
          );
          if (snapshot) {
            snapshots.push(snapshot);
          }
        }
        return snapshots;
      } finally {
        lib.close();
      }
    },
    get: (pid) => {
      const { lib, functions } = dlopen(
        LIB_SYSTEM_PATH,
        LIBPROC_SYMBOLS
      );
      try {
        return inspectPid(pid, functions);
      } finally {
        lib.close();
      }
    },
  };
}

export async function readPlistValue(
  plistPath: string,
  key: string
): Promise<string> {
  const { stdout } = await execFileAsync(
    PLUTIL_PATH,
    ["-extract", key, "raw", "-o", "-", plistPath],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1_024,
    }
  );
  return stdout.trim();
}

export function createDefaultLeagueProcessDependencies(): LeagueProcessDependencies {
  return {
    processSource: createNativeProcessSource(),
    currentUid: () => process.getuid?.() ?? -1,
    canonicalizePath: (path) => realpathSync.native(path),
    readBundleValue: readPlistValue,
    signal: (pid, signal) => process.kill(pid, signal),
  };
}

function sameStartTime(
  left: ProcessStartTime,
  right: ProcessStartTime
): boolean {
  return (
    left.seconds === right.seconds &&
    left.microseconds === right.microseconds
  );
}

function getLeagueBundlePath(
  canonicalExecutablePath: string
): string | undefined {
  const marker = "/Contents/MacOS/";
  const markerIndex = canonicalExecutablePath.lastIndexOf(marker);
  if (markerIndex <= 0) {
    return undefined;
  }

  const bundlePath = canonicalExecutablePath.slice(0, markerIndex);
  const executableName = canonicalExecutablePath.slice(
    markerIndex + marker.length
  );
  if (
    !bundlePath.endsWith(".app") ||
    !executableName ||
    executableName.includes("/")
  ) {
    return undefined;
  }

  const gameDirectory = dirname(bundlePath);
  const lolDirectory = dirname(gameDirectory);
  const contentsDirectory = dirname(lolDirectory);
  if (
    basename(gameDirectory) !== "Game" ||
    basename(lolDirectory) !== "LoL" ||
    basename(contentsDirectory) !== "Contents"
  ) {
    return undefined;
  }
  return bundlePath;
}

async function validateLeagueSnapshot(
  snapshot: MacOSProcessSnapshot,
  dependencies: LeagueProcessDependencies
): Promise<LeagueGameProcessIdentity | undefined> {
  if (snapshot.uid !== dependencies.currentUid()) {
    return undefined;
  }

  let executablePath: string;
  try {
    executablePath = dependencies.canonicalizePath(
      snapshot.executablePath
    );
  } catch {
    return undefined;
  }
  const bundlePath = getLeagueBundlePath(executablePath);
  if (!bundlePath) {
    return undefined;
  }

  const plistPath = join(bundlePath, "Contents", "Info.plist");
  let bundleId: string;
  let bundleExecutable: string;
  try {
    [bundleId, bundleExecutable] = await Promise.all([
      dependencies.readBundleValue(
        plistPath,
        "CFBundleIdentifier"
      ),
      dependencies.readBundleValue(
        plistPath,
        "CFBundleExecutable"
      ),
    ]);
  } catch {
    return undefined;
  }

  if (
    bundleId !== LEAGUE_GAME_BUNDLE_ID ||
    bundleExecutable !== basename(executablePath)
  ) {
    return undefined;
  }

  let expectedExecutablePath: string;
  try {
    expectedExecutablePath = dependencies.canonicalizePath(
      join(bundlePath, "Contents", "MacOS", bundleExecutable)
    );
  } catch {
    return undefined;
  }
  if (expectedExecutablePath !== executablePath) {
    return undefined;
  }

  return {
    ...snapshot,
    executablePath,
    bundlePath,
  };
}

export async function resolveLeagueGameProcesses(
  dependencies: LeagueProcessDependencies =
    createDefaultLeagueProcessDependencies()
): Promise<LeagueGameProcessIdentity[]> {
  return (
    await Promise.all(
      dependencies.processSource
        .list()
        .map((snapshot) =>
          validateLeagueSnapshot(snapshot, dependencies)
        )
    )
  ).filter(
    (candidate): candidate is LeagueGameProcessIdentity =>
      candidate !== undefined
  );
}

export function signalLeagueGameProcess(
  identity: LeagueGameProcessIdentity,
  signal: NodeJS.Signals,
  dependencies: LeagueProcessDependencies =
    createDefaultLeagueProcessDependencies()
): boolean {
  const current = dependencies.processSource.get(identity.pid);
  let currentExecutablePath: string | undefined;
  try {
    currentExecutablePath = current
      ? dependencies.canonicalizePath(current.executablePath)
      : undefined;
  } catch {
    currentExecutablePath = undefined;
  }
  if (
    !current ||
    current.uid !== identity.uid ||
    currentExecutablePath !== identity.executablePath ||
    !sameStartTime(current.startTime, identity.startTime)
  ) {
    return false;
  }
  dependencies.signal(identity.pid, signal);
  return true;
}

function isLeagueGameProcessRunning(
  identity: LeagueGameProcessIdentity,
  dependencies: LeagueProcessDependencies
): boolean {
  const current = dependencies.processSource.get(identity.pid);
  let currentExecutablePath: string | undefined;
  try {
    currentExecutablePath = current
      ? dependencies.canonicalizePath(current.executablePath)
      : undefined;
  } catch {
    currentExecutablePath = undefined;
  }
  return Boolean(
    current &&
      current.uid === identity.uid &&
      currentExecutablePath === identity.executablePath &&
      sameStartTime(current.startTime, identity.startTime)
  );
}

async function waitForLeagueGameProcessExit(
  identity: LeagueGameProcessIdentity,
  timeoutMs: number,
  pollIntervalMs: number,
  dependencies: LeagueProcessDependencies,
  wait: (milliseconds: number) => Promise<void>
): Promise<boolean> {
  const pollCount = Math.ceil(timeoutMs / pollIntervalMs);
  for (let poll = 0; poll <= pollCount; poll += 1) {
    if (!isLeagueGameProcessRunning(identity, dependencies)) {
      return true;
    }
    if (poll < pollCount) {
      await wait(pollIntervalMs);
    }
  }
  return false;
}

export async function terminateLeagueGameProcesses(
  dependencies: LeagueProcessDependencies =
    createDefaultLeagueProcessDependencies(),
  options: LeagueGameTerminationOptions = {}
): Promise<void> {
  const {
    termTimeoutMs = LEAGUE_GAME_TERM_TIMEOUT_MS,
    killTimeoutMs = LEAGUE_GAME_KILL_TIMEOUT_MS,
    pollIntervalMs = LEAGUE_GAME_EXIT_POLL_INTERVAL_MS,
    wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = options;
  const identities = await resolveLeagueGameProcesses(dependencies);

  for (const identity of identities) {
    if (!signalLeagueGameProcess(identity, "SIGTERM", dependencies)) {
      continue;
    }
    if (
      await waitForLeagueGameProcessExit(
        identity,
        termTimeoutMs,
        pollIntervalMs,
        dependencies,
        wait
      )
    ) {
      continue;
    }
    if (!signalLeagueGameProcess(identity, "SIGKILL", dependencies)) {
      continue;
    }
    if (
      !(await waitForLeagueGameProcessExit(
        identity,
        killTimeoutMs,
        pollIntervalMs,
        dependencies,
        wait
      ))
    ) {
      throw new Error(
        `League game process ${identity.pid} remained alive after SIGKILL`
      );
    }
  }
}
