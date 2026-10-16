import { describe, expect, it } from "vitest";
import { getEventListeners } from "node:events";
import { runBounded, runSubscription } from "./process.ts";

describe("bounded native helper process", () => {
  it("captures one result, rejects oversize, nonzero and nonexistent helpers", async () => {
    await expect(runBounded(process.execPath, ["-e", "process.stdout.write('null')"])).resolves.toBe("null");
    await expect(runBounded(process.execPath, ["-e", "process.stdout.write('a'.repeat(70000));setInterval(()=>{},1000)"])).rejects.toThrow("64 KiB");
    await expect(runBounded(process.execPath, ["-e", "process.exit(1)"])).rejects.toThrow();
    await expect(runBounded("/not/a/helper", [])).rejects.toThrow();
  });
  it("keeps the artwork ceiling separate from normal metadata", async () => {
    await expect(runBounded(process.execPath, ["-e", "process.stdout.write('a'.repeat(70000))"], undefined, 1048576)).resolves.toHaveLength(70000);
    await expect(runBounded(process.execPath, ["-e", "process.stdout.write('a'.repeat(1048577))"], undefined, 1048576)).rejects.toThrow("artwork limit");
  });
  it("kills a hung process on its deadline", async () => {
    await expect(runBounded(process.execPath, ["-e", "setInterval(()=>{},1000)"])).rejects.toThrow("timed out");
  }, 6000);
  it("cancels on shutdown", async () => {
    const abort = new AbortController();
    const pending = runBounded(process.execPath, ["-e", "setInterval(()=>{},1000)"], abort.signal);
    abort.abort();
    await expect(pending).rejects.toThrow("stopped");
  });
});

describe("native helper subscription", () => {
  it("frames fragmented/coalesced records without splitting UTF-8 and cancels cleanly", async () => {
    const abort = new AbortController();
    const lines: string[] = [];
    await expect(runSubscription(process.execPath, ["-e", `
      const bytes = Buffer.from('{"title":"café"}\\n{"playing":true}\\n');
      const split = bytes.indexOf(0xc3) + 1;
      process.stdout.write(bytes.subarray(0, split));
      setTimeout(() => process.stdout.write(bytes.subarray(split)), 20);
      setInterval(() => {}, 1000);
    `], abort.signal, line => {
      lines.push(line);
      if (lines.length === 2) abort.abort();
    })).resolves.toBeUndefined();
    expect(lines).toEqual(['{"title":"café"}', '{"playing":true}']);
    expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
  });

  it("does not treat the per-record budget as a lifetime output limit", async () => {
    const abort = new AbortController();
    let count = 0;
    await expect(runSubscription(process.execPath, ["-e", `
      process.stdout.write(('x'.repeat(1024) + '\\n').repeat(100));
      setInterval(() => {}, 1000);
    `], abort.signal, line => {
      expect(line).toHaveLength(1024);
      if (++count === 100) abort.abort();
    })).resolves.toBeUndefined();
    expect(count).toBe(100);
  });

  it.each(["process.stdout.write('x'.repeat(65537))", "process.stdout.write('x'.repeat(32768));setTimeout(() => process.stdout.write('x'.repeat(32769) + '\\n'), 10)"])(
    "kills an overlong record, including fragmented/no-newline output (%s)", async source => {
      await expect(runSubscription(process.execPath, ["-e", `${source};setInterval(() => {}, 1000)`],
        new AbortController().signal, () => { throw new Error("must not emit"); })).rejects.toThrow("record exceeded 64 KiB");
    });

  it("bounds ingress floods even when every record is short", async () => {
    await expect(runSubscription(process.execPath, ["-e", `
      process.stdout.write(('x'.repeat(1023) + '\\n').repeat(2048));
      setInterval(() => {}, 1000);
    `], new AbortController().signal, () => {})).rejects.toThrow("ingress exceeded");
  });

  it.each([0, 1])("treats every unexpected exit as failure (exit %i)", async code => {
    const abort = new AbortController();
    const lines: string[] = [];
    await expect(runSubscription(process.execPath, ["-e", `process.stdout.write('null\\n');process.exit(${code})`],
      abort.signal, line => { lines.push(line); })).rejects.toThrow("subscription exited");
    expect(lines).toEqual(["null"]);
    expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
  });

  it("rejects spawn failure and removes its abort listener", async () => {
    const abort = new AbortController();
    await expect(runSubscription("/not/a/helper", [], abort.signal, () => {})).rejects.toThrow();
    expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
  });

  it("kills the helper when the synchronous record consumer fails", async () => {
    await expect(runSubscription(process.execPath, ["-e", "process.stdout.write('null\\n');setInterval(() => {}, 1000)"],
      new AbortController().signal, () => { throw new Error("Invalid stream record"); })).rejects.toThrow("Invalid stream record");
  });

  it("cancels a silent subscription and skips a pre-cancelled launch", async () => {
    const abort = new AbortController();
    const pending = runSubscription(process.execPath, ["-e", "setInterval(() => {}, 1000)"], abort.signal,
      () => { throw new Error("must not emit"); });
    abort.abort();
    await expect(pending).resolves.toBeUndefined();
    await expect(runSubscription("/not/a/helper", [], abort.signal, () => {})).resolves.toBeUndefined();
    expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
  });
});
