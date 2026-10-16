import { spawn } from "node:child_process";

/** A long-lived, newline-framed helper. Silence is not a health acknowledgement:
 * the owner supplies freshness/reconciliation and reconnect policy. Every exit
 * is a failure except explicit cancellation, which kills the process and resolves.
 * Limits apply per record and per ingress window, never across the stream's life. */
export function runSubscription(executable: string, args: readonly string[], signal: AbortSignal,
  onLine: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve();
    const child = spawn(executable, [...args], { stdio: ["ignore", "pipe", "ignore"] });
    const recordLimit = 65536;
    const ingressLimit = 1048576;
    let pending = Buffer.alloc(0);
    let windowStart = performance.now();
    let windowBytes = 0;
    let failure: Error | undefined;
    let cancelled = false;
    let settled = false;
    const kill = (error: Error) => { failure ??= error; child.kill("SIGKILL"); };
    const abort = () => { cancelled = true; child.kill("SIGKILL"); };
    const data = (chunk: Buffer) => {
      if (failure || cancelled) return;
      const now = performance.now();
      if (now - windowStart >= 1000) { windowStart = now; windowBytes = 0; }
      windowBytes += chunk.length;
      if (windowBytes > ingressLimit) return kill(new Error("Media subscription ingress exceeded 1 MiB per second"));
      let offset = 0;
      while (offset < chunk.length && !failure && !cancelled) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        if (pending.length + end - offset > recordLimit) return kill(new Error("Media subscription record exceeded 64 KiB"));
        pending = Buffer.concat([pending, chunk.subarray(offset, end)]);
        if (newline < 0) break;
        const line = pending.toString("utf8");
        pending = Buffer.alloc(0);
        try { onLine(line.endsWith("\r") ? line.slice(0, -1) : line); }
        catch (error) { kill(error instanceof Error ? error : new Error("Media subscription callback failed")); }
        offset = newline + 1;
      }
    };
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      child.stdout.removeListener("data", data);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (failure) reject(failure);
      else if (cancelled) resolve();
      else reject(error ?? new Error("Media subscription exited"));
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", data);
    child.stdout.once("error", error => kill(error));
    child.once("error", error => finish(error));
    child.once("close", () => finish());
    // Cover cancellation during setup without ever starting a second helper.
    if (signal.aborted) abort();
  });
}

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
