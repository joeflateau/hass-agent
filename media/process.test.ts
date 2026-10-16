import { describe, expect, it } from "vitest";
import { runBounded } from "./process.ts";

describe("bounded native helper process", () => {
  it("captures one result, rejects oversize, nonzero and nonexistent helpers", async () => {
    await expect(runBounded(process.execPath, ["-e", "process.stdout.write('null')"])).resolves.toBe("null");
    await expect(runBounded(process.execPath, ["-e", "process.stdout.write('a'.repeat(70000));setInterval(()=>{},1000)"])).rejects.toThrow("64 KiB");
    await expect(runBounded(process.execPath, ["-e", "process.exit(1)"])).rejects.toThrow();
    await expect(runBounded("/not/a/helper", [])).rejects.toThrow();
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
