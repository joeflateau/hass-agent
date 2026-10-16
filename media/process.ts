import { spawn } from "node:child_process";

/** No shell, no stdin, a hard output ceiling and kill deadline (also on stop). */
export function runBounded(executable: string, args: readonly string[], signal?: AbortSignal, maxBytes = 65536): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Media operation stopped"));
    const child = spawn(executable, [...args], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failure: Error | undefined;
    const kill = (message: string) => {
      failure ??= new Error(message);
      child.kill("SIGKILL");
    };
    const abort = () => kill("Media operation stopped");
    const timer = setTimeout(() => kill("Media operation timed out"), 4000);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) kill(maxBytes === 65536 ? "Media response exceeded 64 KiB" : "Media response exceeded artwork limit");
      else chunks.push(chunk);
    });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("close", (code) => {
      cleanup();
      if (failure || code !== 0) reject(failure ?? new Error("Media helper failed"));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}
