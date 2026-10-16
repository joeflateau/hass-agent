import { randomUUID } from "node:crypto";
import { ACTIONS, emptySnapshot, parseNowPlaying, requestSchema, type MediaSnapshot, type MediaResult } from "./model.ts";
import { ARTWORK_MAX_RESPONSE } from "./artwork.ts";
import { runBounded, runSubscription } from "./process.ts";
import { prepareRuntime, verifyGuiLogin } from "./runtime.ts";

export interface MediaBackend {
  read(signal: AbortSignal): Promise<string>;
  readArtwork?(signal: AbortSignal): Promise<string>;
  subscribe?(signal: AbortSignal, onSnapshot: (raw: string) => void): Promise<void>;
  verifySession?(signal: AbortSignal): Promise<void>;
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
    verifySession: verifyGuiLogin,
    readArtwork: async signal => runBounded(await executable(signal), ["get"], signal, ARTWORK_MAX_RESPONSE),
    subscribe: async (signal, onSnapshot) => runSubscription(await executable(signal),
      ["stream", "--no-diff", "--no-artwork"], signal, line => {
        const event = JSON.parse(line);
        if (event?.type !== "data" || event.diff !== false || event.payload === null ||
          typeof event.payload !== "object" || Array.isArray(event.payload)) throw new Error("Invalid media stream event");
        onSnapshot(Object.keys(event.payload).length ? JSON.stringify(event.payload) : "null");
      }),
    command: async (action, signal) => { await runBounded(await executable(signal), [ACTIONS[action]], signal); },
  };
}

/** Bound waits even when runtime preparation has not reached a child process. */
function abortable<T>(operation: Promise<T> | undefined, signal: AbortSignal): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(new Error("Media operation stopped"));
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

/** Single-flight actions/probes, independent pushed metadata. Never replay playback. */
export class MediaController {
  snapshot: MediaSnapshot;
  private session = randomUUID();
  private busy = false;
  private activePoll?: Promise<void>;
  private running = false;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private watchdog?: NodeJS.Timeout;
  private subscription?: AbortController;
  private subscriptionRestart?: NodeJS.Timeout;
  private observationRevision = 0;
  private eligibilityTimer?: NodeJS.Timeout;
  private checkingEligibility = false;
  private subscriptionAllowed = false;
  private abort = new AbortController();
  private receipts = new Map<string, { fingerprint: string; at: number; result: MediaResult; pending: boolean }>();
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
    clearTimeout(this.subscriptionRestart);
    this.subscription = undefined;
    this.subscriptionAllowed = false;
    this.startSubscription();
  }
  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    this.abort = new AbortController();
    this.startSubscription();
    this.eligibilityTimer = setInterval(() => { void this.checkEligibility(); }, 10000);
    this.watchdog = setInterval(() => {
      if (this.snapshot.state !== "unavailable" && this.clock() - Date.parse(this.snapshot.observed_at) > 15000) {
        this.update(emptySnapshot(this.session, "unavailable", this.clock()));
      }
    }, 1000);
    const tick = async () => {
      // Stream notifications are primary. The pinned helper has no heartbeat;
      // only a real bounded read may renew a quiet stream's freshness lease.
      if (!this.backend.subscribe || this.snapshot.state === "unavailable" ||
        this.clock() - Date.parse(this.snapshot.observed_at) >= 10000) await this.poll();
      const wait = this.backend.subscribe
        ? Math.max(250, 10000 - (this.clock() - Date.parse(this.snapshot.observed_at))) : this.interval;
      if (this.running) this.timer = setTimeout(() => { void tick(); }, wait);
    };
    void tick();
  }
  stop(): void {
    this.running = false;
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.watchdog);
    clearInterval(this.eligibilityTimer);
    clearTimeout(this.subscriptionRestart);
    this.resetSession();
    this.abort.abort();
  }
  private startSubscription(): void {
    if (!this.running || this.abort.signal.aborted || !this.backend.subscribe || this.subscription) return;
    const session = this.session;
    const subscription = this.subscription = new AbortController();
    const signal = AbortSignal.any([this.abort.signal, subscription.signal]);
    void (async () => {
      await abortable(this.backend.verifySession?.(signal), signal);
      if (signal.aborted || session !== this.session) return;
      this.subscriptionAllowed = true;
      await this.backend.subscribe!(signal, raw => {
        if (signal.aborted || session !== this.session || !this.subscriptionAllowed) return;
        const snapshot = parseNowPlaying(raw, session, this.clock());
        this.observationRevision++;
        this.update(snapshot);
      });
    })().catch(() => {
      if (!signal.aborted && session === this.session) {
        this.subscriptionAllowed = false;
        this.observationRevision++;
        this.update(emptySnapshot(session, "unavailable", this.clock()));
      }
    }).finally(() => {
      if (this.subscription !== subscription) return;
      this.subscription = undefined;
      if (this.running && !this.abort.signal.aborted && session === this.session) {
        this.subscriptionRestart = setTimeout(() => this.startSubscription(), 5000);
      }
    });
  }
  private async checkEligibility(): Promise<void> {
    if (!this.backend.subscribe || !this.backend.verifySession || this.checkingEligibility || this.abort.signal.aborted) return;
    this.checkingEligibility = true;
    const session = this.session;
    const signal = this.abort.signal;
    try { await abortable(this.backend.verifySession(signal), signal); }
    catch {
      if (session === this.session && !signal.aborted) {
        this.subscriptionAllowed = false;
        this.subscription?.abort();
        this.observationRevision++;
        this.update(emptySnapshot(session, "unavailable", this.clock()));
      }
    } finally { this.checkingEligibility = false; }
  }
  private async read(session: string, signal = this.abort.signal): Promise<MediaSnapshot> {
    try { return parseNowPlaying(await this.backend.read(signal), session, this.clock()); }
    catch { return emptySnapshot(session, "unavailable", this.clock()); }
  }
  private update(snapshot: MediaSnapshot): void {
    if (snapshot.session === this.session && !this.abort.signal.aborted) {
      this.snapshot = snapshot;
      this.publish(snapshot);
    }
  }
  async poll(): Promise<void> {
    if (this.busy || this.activePoll || this.abort.signal.aborted) return;
    const session = this.session;
    const revision = this.observationRevision;
    this.activePoll = (async () => {
      const snapshot = await this.read(session);
      // A failed read also invalidates the stream's GUI-login eligibility. Stop
      // it until a new subscription has passed the native login check again.
      if (snapshot.state === "unavailable" && session === this.session) {
        this.subscriptionAllowed = false;
        this.subscription?.abort();
      }
      if (revision === this.observationRevision || snapshot.state === "unavailable") this.update(snapshot);
    })();
    try { await this.activePoll; }
    finally { this.activePoll = undefined; }
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
    if (previous) return previous.fingerprint !== fingerprint ? result("rejected", "Request ID already used") : previous.pending ? undefined : previous.result;
    for (const [key, value] of this.receipts) if (now - value.at > 60000) this.receipts.delete(key);
    const age = now - Date.parse(request.observed_at);
    if (request.session !== this.session || age < -2000 || age > 15000) return result("rejected", "Playback view expired; refresh before trying again");
    if (this.busy) return result("rejected", "Previous media action is still being checked. Wait, then check playback.");
    if (this.receipts.size >= 256) return result("rejected", "Too many recent media requests. Wait before trying again.");
    // Mark consumed BEFORE awaiting anything. Epoch fencing makes receipts from previous
    // process/connections unusable, so no durable command journal or playback replay is needed.
    const receipt = { fingerprint, at: now, pending: true, result: result("rejected", "Playback preflight did not complete; refresh before trying again") };
    this.receipts.set(request.request_id, receipt);
    this.busy = true;
    const session = this.session;
    const operation = new AbortController();
    const deadline = setTimeout(() => operation.abort(), 24000);
    const signal = AbortSignal.any([this.abort.signal, operation.signal]);
    try {
      // A background metadata read is not another playback action. Reserve the
      // one action slot, join that bounded read, then revalidate from scratch.
      await abortable(this.activePoll, signal);
      if (session !== this.session || signal.aborted) return receipt.result;
      const before = await abortable(this.read(session, signal), signal);
      if (!before || signal.aborted) return receipt.result;
      if (this.session !== session || this.clock() - Date.parse(request.observed_at) > 15000 || before.version !== request.expected ||
        this.snapshot.version !== request.expected || !["playing", "paused"].includes(before.state) || this.abort.signal.aborted) {
        if (!this.backend.subscribe) this.update(before);
        return receipt.result = result("rejected", "Now Playing changed or is unavailable; refresh before trying again");
      }
      receipt.result = result("unknown", "Outcome unknown; check playback before another action");
      await abortable(this.backend.command(request.action, signal), signal);
      // Submission is the command outcome. Normal telemetry reconciles playback;
      // do not hold the action slot or poll for proof the user's action happened.
      if (session === this.session && !signal.aborted) receipt.result = result("submitted");
    } catch { /* Native operation may already have happened: retain unknown, never retry. */ }
    finally { clearTimeout(deadline); receipt.pending = false; this.busy = false; }
    return receipt.result;
  }
}
