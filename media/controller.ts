import { randomUUID } from "node:crypto";
import { ACTIONS, emptySnapshot, parseNowPlaying, requestSchema, type MediaSnapshot, type MediaResult } from "./model.ts";
import { runBounded } from "./process.ts";
import { prepareRuntime, verifyGuiLogin } from "./runtime.ts";

export interface MediaBackend {
  read(signal: AbortSignal): Promise<string>;
  command(action: keyof typeof ACTIONS, signal: AbortSignal): Promise<void>;
}
export function nativeMediaBackend(): MediaBackend {
  let runtime: string | undefined;
  async function executable(signal: AbortSignal) {
    await verifyGuiLogin(signal);
    runtime ??= await prepareRuntime();
    if (signal.aborted) throw new Error("Media operation stopped");
    return runtime;
  }
  return {
    read: async signal => runBounded(await executable(signal), ["get", "--no-artwork"], signal),
    command: async (action, signal) => { await runBounded(await executable(signal), [ACTIONS[action]], signal); },
  };
}

/** One media operation at a time. No queued playback, no retries, no impact on other readers. */
export class MediaController {
  snapshot: MediaSnapshot;
  private session = randomUUID();
  private busy = false;
  private running = false;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private watchdog?: NodeJS.Timeout;
  private abort = new AbortController();
  private receipts = new Map<string, { fingerprint: string; at: number; result: MediaResult }>();
  constructor(private backend: MediaBackend, private publish: (state: MediaSnapshot) => void,
    private clock = Date.now, private interval = 5000) {
    this.snapshot = emptySnapshot(this.session, "unavailable", this.clock());
  }
  resetSession(): void {
    this.abort.abort();
    this.abort = new AbortController();
    if (this.stopped) this.abort.abort();
    this.session = randomUUID();
    this.receipts.clear();
    this.snapshot = emptySnapshot(this.session, "unavailable", this.clock());
    this.publish(this.snapshot);
  }
  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    this.abort = new AbortController();
    this.watchdog = setInterval(() => {
      if (this.snapshot.state !== "unavailable" && this.clock() - Date.parse(this.snapshot.observed_at) > 15000) {
        this.update(emptySnapshot(this.session, "unavailable", this.clock()));
      }
    }, 1000);
    const tick = async () => {
      await this.poll();
      if (this.running) this.timer = setTimeout(() => { void tick(); }, this.interval);
    };
    void tick();
  }
  stop(): void {
    this.running = false;
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.watchdog);
    this.resetSession();
    this.abort.abort();
  }
  private async read(session: string): Promise<MediaSnapshot> {
    try { return parseNowPlaying(await this.backend.read(this.abort.signal), session, this.clock()); }
    catch { return emptySnapshot(session, "unavailable", this.clock()); }
  }
  private update(snapshot: MediaSnapshot): void {
    if (snapshot.session === this.session && !this.abort.signal.aborted) {
      this.snapshot = snapshot;
      this.publish(snapshot);
    }
  }
  async poll(): Promise<void> {
    if (this.busy || this.abort.signal.aborted) return;
    this.busy = true;
    const session = this.session;
    try { this.update(await this.read(session)); }
    finally { this.busy = false; }
  }
  async dispatch(payload: Buffer, packet?: { retain?: boolean; dup?: boolean }): Promise<MediaResult | undefined> {
    if (packet?.retain || packet?.dup || payload.length > 2048 || this.abort.signal.aborted) return;
    let parsed;
    try { parsed = requestSchema.safeParse(JSON.parse(payload.toString("utf8"))); } catch { return; }
    if (!parsed.success) return;
    const request = parsed.data;
    const now = this.clock();
    const fingerprint = JSON.stringify(request);
    const result = (status: MediaResult["status"], reason?: string): MediaResult => ({
      request_id: request.request_id, action: request.action, status, reason, timestamp: new Date(this.clock()).toISOString(),
    });
    const previous = this.receipts.get(request.request_id);
    if (previous) return previous.fingerprint === fingerprint ? previous.result : result("rejected", "Request ID already used");
    for (const [key, value] of this.receipts) if (now - value.at > 60000) this.receipts.delete(key);
    const age = now - Date.parse(request.observed_at);
    if (request.session !== this.session || age < -2000 || age > 15000) return result("rejected", "Playback view expired; refresh before trying again");
    if (this.busy || this.receipts.size >= 256) return result("rejected", "Media busy; refresh before trying again");
    // Mark consumed BEFORE awaiting anything. Epoch fencing makes receipts from previous
    // process/connections unusable, so no durable command journal or playback replay is needed.
    const receipt = { fingerprint, at: now, result: result("rejected", "Request is being checked") };
    this.receipts.set(request.request_id, receipt);
    this.busy = true;
    const session = this.session;
    try {
      const before = await this.read(session);
      this.update(before);
      if (this.session !== session || this.clock() - Date.parse(request.observed_at) > 15000 || before.version !== request.expected || !["playing", "paused"].includes(before.state) || this.abort.signal.aborted) {
        return receipt.result = result("rejected", "Now Playing changed or is unavailable; refresh before trying again");
      }
      receipt.result = result("unknown", "Outcome unknown; check playback before another action");
      await this.backend.command(request.action, this.abort.signal);
      const after = await this.read(session);
      this.update(after);
      const observed = this.session === session && after.version !== null && (
        request.action === "next" || request.action === "previous" ? after.version !== before.version :
          after.version === before.version && after.state === (request.action === "play" ? "playing" : "paused"));
      receipt.result = observed ? result("observed") : result("submitted", "Command sent; playback change not confirmed. Check playback before another action");
    } catch { /* Native operation may already have happened: retain unknown, never retry. */ }
    finally { this.busy = false; }
    return receipt.result;
  }
}
