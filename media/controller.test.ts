import { describe, expect, it, vi } from "vitest";
import { MediaController, type MediaBackend } from "./controller.ts";
import { emptySnapshot, parseNowPlaying, type MediaSnapshot } from "./model.ts";

const now = Date.parse("2026-10-16T18:12:52Z");
const chrome = { title: "Example track", artist: "Example artist feat. Guest", playing: true,
  bundleIdentifier: "com.google.Chrome", processIdentifier: 123, contentItemIdentifier: "track1",
  duration: 247.919458, elapsedTime: 128.197555, timestamp: "2026-10-16T18:12:51Z", playbackRate: 1 };
function setup() {
  let time = now;
  const backend: MediaBackend = { read: vi.fn(async () => JSON.stringify(chrome)), command: vi.fn(async () => {}) };
  const snapshots: MediaSnapshot[] = [];
  const controller = new MediaController(backend, s => snapshots.push(s), () => time);
  const request = (action = "next", id = "request_1234567890") => Buffer.from(JSON.stringify({ action, request_id: id,
    session: controller.snapshot.session, expected: controller.snapshot.version, observed_at: controller.snapshot.observed_at }));
  return { backend, controller, snapshots, request, time: (value: number) => { time = value; } };
}
describe("Now Playing trust boundary", () => {
  it("preserves Chrome title, original position timestamp and separate observation time", () => {
    const state = parseNowPlaying(JSON.stringify(chrome), "session", now);
    expect(state).toMatchObject({ state: "playing", title: "Example track", position: 128.197555,
      position_at: chrome.timestamp, observed_at: "2026-10-16T18:12:52.000Z", album: null });
    expect(state.version).toHaveLength(64);
  });
  it("distinguishes healthy idle and unavailable, clearing all metadata", async () => {
    const { backend, controller } = setup();
    await controller.poll();
    vi.mocked(backend.read).mockResolvedValue("null");
    await controller.poll();
    expect(controller.snapshot).toEqual(emptySnapshot(controller.snapshot.session, "idle", now));
    vi.mocked(backend.read).mockRejectedValue(new Error("wrong login"));
    await controller.poll();
    expect(controller.snapshot).toEqual(emptySnapshot(controller.snapshot.session, "unavailable", now));
  });
  it("keeps a track stable across the observed Chrome per-read content identifier churn", () => {
    const raw = { ...chrome, processIdentifier: 37817,
      bundleIdentifier: "com.google.Chrome.app.iknndogofehenbnenooclhillkiloioe",
      title: "OMENS (Feat. The Pretty WiLD)", artist: "PXNDO REMIX ft. Eminem, Tech N9ne, The Pretty Wild", album: "" };
    const versions = ["93F5FB2B-2F56-4489-ACA2-8623209BF41E", "43CF6505-917B-4237-8615-A2A53EA45A48", "2A30B4F0-90D1-4E52-9D4B-2FE53224F6A8"]
      .map(contentItemIdentifier => parseNowPlaying(JSON.stringify({ ...raw, contentItemIdentifier }), "session", now).version);
    expect(new Set(versions).size).toBe(1);
    const base = parseNowPlaying(JSON.stringify(raw), "session", now).version;
    for (const update of [{ title: "Other" }, { artist: "Other" }, { album: "Other" },
      { processIdentifier: 37818 }, { bundleIdentifier: "com.spotify.client" }]) {
      expect(parseNowPlaying(JSON.stringify({ ...raw, ...update }), "session", now).version).not.toBe(base);
    }
    expect(parseNowPlaying(JSON.stringify(raw), "new-session", now).version).not.toBe(base);
  });
  it("rejects malformed/invalid media and bounds optional fields without inventing values", () => {
    for (const raw of ["{}", "[]", '"playing"', '{"title":"x","playing":1}']) expect(() => parseNowPlaying(raw, "s")).toThrow();
    expect(parseNowPlaying(JSON.stringify({ ...chrome, duration: -1, elapsedTime: "3", playbackRate: 100,
      timestamp: "invalid", artist: "a".repeat(1000) }), "s", now)).toMatchObject({ duration: null, position: null, position_at: null, rate: null, artist: "a".repeat(512) });
  });
});
describe("media action lifecycle", () => {
  it("allows pause through volatile native IDs without confirmation polling", async () => {
    const { backend, controller, request } = setup();
    const ids = ["93F5FB2B-2F56-4489-ACA2-8623209BF41E", "43CF6505-917B-4237-8615-A2A53EA45A48", "2A30B4F0-90D1-4E52-9D4B-2FE53224F6A8"];
    vi.mocked(backend.read)
      .mockResolvedValueOnce(JSON.stringify({ ...chrome, contentItemIdentifier: ids[0] }))
      .mockResolvedValueOnce(JSON.stringify({ ...chrome, contentItemIdentifier: ids[1] }))
      .mockResolvedValueOnce(JSON.stringify({ ...chrome, contentItemIdentifier: ids[2], playing: false }));
    await controller.poll();
    const result = await controller.dispatch(request("pause"));
    expect(result?.status).toBe("submitted");
    expect(backend.command).toHaveBeenCalledExactlyOnceWith("pause", expect.any(AbortSignal));
    expect(controller.snapshot.state).toBe("playing");
  });
  it("releases the action slot after submission without confirmation polling", async () => {
    const { backend, controller, request } = setup();
    await controller.poll();
    const count = controller.snapshot.observed_at;
    expect((await controller.dispatch(request("pause")))?.status).toBe("submitted");
    expect((await controller.dispatch(request("play", "second_request_123456")))?.status).toBe("submitted");
    expect(backend.command).toHaveBeenCalledTimes(2);
    expect(backend.read).toHaveBeenCalledTimes(3);
    expect(controller.snapshot.observed_at).toBe(count);
  });
  it("joins a background poll but rejects a concurrent action and revalidates afterwards", async () => {
    const { backend, controller, request } = setup();
    await controller.poll();
    const body = request("pause");
    let resolve!: (value: string) => void;
    vi.mocked(backend.read).mockImplementationOnce(() => new Promise(r => { resolve = r; }))
      .mockResolvedValue(JSON.stringify({ ...chrome, title: "new track" }));
    const poll = controller.poll();
    const action = controller.dispatch(body);
    expect((await controller.dispatch(request("play", "other_request_123456")))?.reason).toContain("Previous media action is still being checked");
    expect(backend.command).not.toHaveBeenCalled();
    resolve(JSON.stringify(chrome));
    await poll;
    expect((await action)?.reason).toContain("Now Playing changed");
    expect(backend.command).not.toHaveBeenCalled();
  });
  it("deduplicates submitted actions without retrying playback", async () => {
    vi.useFakeTimers();
    try {
      const { backend, controller, request } = setup();
      await controller.poll();
      const body = request("pause");
      const pending = controller.dispatch(body);
      await vi.advanceTimersByTimeAsync(6100);
      expect((await pending)?.status).toBe("submitted");
      expect((await controller.dispatch(body))?.status).toBe("submitted");
      expect(backend.command).toHaveBeenCalledOnce();
      vi.mocked(backend.read).mockResolvedValue(JSON.stringify({ ...chrome, playing: false }));
      expect((await controller.dispatch(request("pause", "new_request_123456")))?.status).toBe("submitted");
    } finally { vi.useRealTimers(); }
  });
  it("fences a native command completing after an epoch reset", async () => {
    const { backend, controller, request, snapshots } = setup();
    await controller.poll();
    let release!: () => void;
    vi.mocked(backend.command).mockImplementationOnce(() => new Promise(r => { release = r; }));
    const pending = controller.dispatch(request("pause"));
    for (let i = 0; i < 10 && !release; i++) await Promise.resolve();
    expect(release).toBeTypeOf("function");
    controller.resetSession();
    const count = snapshots.length;
    release();
    expect((await pending)?.status).toBe("unknown");
    expect(snapshots).toHaveLength(count);
    expect(controller.snapshot.state).toBe("unavailable");
    expect(backend.command).toHaveBeenCalledOnce();
  });
  it("suppresses in-flight duplicate receipts until the original action completes", async () => {
    const { backend, controller, request } = setup();
    await controller.poll();
    const body = request("pause");
    let release!: () => void;
    vi.mocked(backend.command).mockImplementation(() => new Promise(r => { release = r; }));
    vi.mocked(backend.read).mockResolvedValue(JSON.stringify({ ...chrome, playing: false }));
    const pending = controller.dispatch(body);
    for (let i = 0; i < 10 && !release; i++) await Promise.resolve();
    expect(await controller.dispatch(body)).toBeUndefined();
    release();
    const result = await pending;
    expect(result?.status).toBe("submitted");
    expect(await controller.dispatch(body)).toEqual(result);
    expect(backend.command).toHaveBeenCalledOnce();
  });
  it("does not use later source metadata to invent a skip receipt", async () => {
    const { backend, controller, request } = setup();
    await controller.poll();
    vi.mocked(backend.read).mockResolvedValueOnce(JSON.stringify(chrome))
      .mockResolvedValue(JSON.stringify({ ...chrome, processIdentifier: 124, title: "another" }));
    expect((await controller.dispatch(request()))?.status).toBe("submitted");
    expect(backend.command).toHaveBeenCalledOnce();
  });
  it("bounds a stalled preflight and never sends after its deadline", async () => {
    vi.useFakeTimers();
    try {
      const { backend, controller, request, snapshots } = setup();
      await controller.poll();
      let release!: (raw: string) => void;
      vi.mocked(backend.read).mockImplementationOnce(() => new Promise(r => { release = r; }));
      const pending = controller.dispatch(request("pause"));
      await vi.advanceTimersByTimeAsync(24001);
      expect((await pending)?.status).toBe("rejected");
      const count = snapshots.length;
      release(JSON.stringify(chrome));
      await Promise.resolve(); await Promise.resolve();
      expect(snapshots).toHaveLength(count);
      expect(backend.command).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("watchdog clears stale metadata even when a poll never completes", async () => {
    vi.useFakeTimers();
    const { backend, controller, time } = setup();
    let resolve!: (value: string) => void;
    try {
      controller.start();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(controller.snapshot.state).toBe("playing");
      vi.mocked(backend.read).mockImplementation(() => new Promise(r => { resolve = r; }));
      await vi.advanceTimersByTimeAsync(5000);
      time(now + 16000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(controller.snapshot).toMatchObject({ state: "unavailable", title: null, version: null });
    } finally {
      controller.stop(); resolve?.("null");
      await Promise.resolve(); vi.useRealTimers();
    }
  });
  it("submits a skip once and deduplicates its receipt", async () => {
    const { backend, controller, request } = setup();
    await controller.poll();
    const body = request();
    vi.mocked(backend.read).mockResolvedValueOnce(JSON.stringify(chrome)).mockResolvedValue(JSON.stringify({ ...chrome, title: "next track" }));
    const result = await controller.dispatch(body);
    expect(result?.status).toBe("submitted");
    expect(await controller.dispatch(body)).toEqual(result);
    expect(backend.command).toHaveBeenCalledExactlyOnceWith("next", expect.any(AbortSignal));
  });
  it("does not equate native success with observed playback", async () => {
    const { backend, controller, request } = setup();
    await controller.poll();
    vi.useFakeTimers();
    const pending = controller.dispatch(request());
    await vi.advanceTimersByTimeAsync(6100);
    expect((await pending)?.status).toBe("submitted");
    vi.useRealTimers();
    expect(backend.command).toHaveBeenCalledOnce();
  });
  it.each(["play", "pause", "previous", "next"])("submits %s without waiting for a confirming read", async action => {
    const { backend, controller, request } = setup();
    await controller.poll();
    const result = await controller.dispatch(request(action));
    expect(result?.status).toBe("submitted");
    expect(backend.read).toHaveBeenCalledTimes(2); // bootstrap + safety preflight only
    expect(backend.command).toHaveBeenCalledExactlyOnceWith(action, expect.any(AbortSignal));
    expect(controller.snapshot.state).toBe("playing"); // normal telemetry remains authoritative
  });
  it("does not call a same-metadata skip observed just because the native content ID changed", async () => {
    const { backend, controller, request } = setup();
    let content = 0;
    vi.mocked(backend.read).mockImplementation(async () => JSON.stringify({ ...chrome, contentItemIdentifier: `ephemeral-${++content}` }));
    await controller.poll();
    vi.useFakeTimers();
    const pending = controller.dispatch(request("next"));
    await vi.advanceTimersByTimeAsync(6100);
    expect((await pending)?.status).toBe("submitted");
    vi.useRealTimers();
    expect(backend.command).toHaveBeenCalledExactlyOnceWith("next", expect.any(AbortSignal));
  });
  it("keeps unknown outcomes consumed and never retries a timed-out skip", async () => {
    const { backend, controller, request } = setup();
    await controller.poll();
    const body = request();
    vi.mocked(backend.command).mockRejectedValue(new Error("timeout after native call"));
    expect((await controller.dispatch(body))?.status).toBe("unknown");
    expect((await controller.dispatch(body))?.status).toBe("unknown");
    expect(backend.command).toHaveBeenCalledOnce();
  });
  it("rejects retained, dup-flagged, malformed, oversized, expired, and old-epoch requests", async () => {
    const { backend, controller, request, time } = setup();
    await controller.poll();
    const body = request();
    expect(await controller.dispatch(body, { retain: true })).toBeUndefined();
    expect(await controller.dispatch(body, { dup: true })).toBeUndefined();
    expect(await controller.dispatch(Buffer.alloc(2049))).toBeUndefined();
    expect(await controller.dispatch(Buffer.from('"next"'))).toBeUndefined();
    time(now + 16000);
    expect((await controller.dispatch(body))?.status).toBe("rejected");
    time(now);
    controller.resetSession();
    await controller.poll();
    expect((await controller.dispatch(body))?.status).toBe("rejected");
    expect(backend.command).not.toHaveBeenCalled();
  });
  it("revalidates track immediately before sending, without a post-action read", async () => {
    const { backend, controller, request } = setup();
    await controller.poll();
    const body = request();
    vi.mocked(backend.read).mockResolvedValue(JSON.stringify({ ...chrome, title: "other" }));
    expect((await controller.dispatch(body))?.status).toBe("rejected");
    expect(backend.command).not.toHaveBeenCalled();
    const pause = request("pause", "request_2234567890");
    vi.mocked(backend.command).mockImplementation(async () => { vi.mocked(backend.read).mockResolvedValue(JSON.stringify({ ...chrome, title: "other", playing: false })); });
    expect((await controller.dispatch(pause))?.status).toBe("submitted");
  });
  it("does not queue actions or overlap polls; shutdown cancels and fences late reads", async () => {
    const { backend, controller, request, snapshots } = setup();
    await controller.poll();
    let resolve!: (value: string) => void;
    vi.mocked(backend.read).mockImplementation(() => new Promise(r => { resolve = r; }));
    const poll = controller.poll();
    await controller.poll();
    const pending = controller.dispatch(request());
    expect(backend.read).toHaveBeenCalledTimes(2);
    controller.stop();
    const count = snapshots.length;
    resolve(JSON.stringify(chrome));
    await poll;
    expect((await pending)?.status).toBe("rejected");
    expect(backend.command).not.toHaveBeenCalled();
    expect(snapshots).toHaveLength(count);
    expect(controller.snapshot.state).toBe("unavailable");
    expect(vi.mocked(backend.read).mock.calls[1]![0].aborted).toBe(true);
    controller.resetSession(); // MQTT close after shutdown must not revive the reader.
    await controller.poll();
    expect(backend.read).toHaveBeenCalledTimes(2);
  });
});

describe("Now Playing notification subscription", () => {
  function streaming() {
    const lane = setup();
    const streams: { signal: AbortSignal; emit: (raw: string) => void; fail: (error: Error) => void }[] = [];
    lane.backend.verifySession = vi.fn(async () => {});
    lane.backend.subscribe = vi.fn((signal, emit) => new Promise<void>((resolve, reject) => {
      streams.push({ signal, emit, fail: reject });
      signal.addEventListener("abort", () => resolve(), { once: true });
    }));
    return { ...lane, streams };
  }
  it("pushes changes immediately without a poll or playback command", async () => {
    vi.useFakeTimers();
    const { controller, backend, streams, time } = streaming();
    try {
      controller.start();
      await vi.advanceTimersByTimeAsync(1);
      time(now + 1000);
      streams[0]!.emit(JSON.stringify({ ...chrome, playing: false, elapsedTime: 129 }));
      expect(controller.snapshot).toMatchObject({ state: "paused", position: 129, position_at: chrome.timestamp });
      expect(backend.read).toHaveBeenCalledOnce();
      expect(backend.command).not.toHaveBeenCalled();
    } finally { controller.stop(); await vi.advanceTimersByTimeAsync(1); vi.useRealTimers(); }
  });
  it("keeps silence healthy but renews its lease only with a real ten-second probe", async () => {
    vi.useFakeTimers();
    const { controller, backend, time } = streaming();
    try {
      controller.start(); await vi.advanceTimersByTimeAsync(1);
      const original = controller.snapshot.observed_at;
      time(now + 9000); await vi.advanceTimersByTimeAsync(8999);
      expect(controller.snapshot.observed_at).toBe(original);
      expect(backend.read).toHaveBeenCalledOnce();
      time(now + 10000); await vi.advanceTimersByTimeAsync(1000);
      expect(backend.read).toHaveBeenCalledTimes(2);
      expect(controller.snapshot.observed_at).not.toBe(original);
      expect(controller.snapshot.position_at).toBe(chrome.timestamp);
    } finally { controller.stop(); await vi.advanceTimersByTimeAsync(1); vi.useRealTimers(); }
  });
  it("does not let a slow older probe overwrite a pushed event", async () => {
    vi.useFakeTimers();
    const { controller, backend, streams } = streaming();
    let release!: (raw: string) => void;
    try {
      vi.mocked(backend.read).mockImplementationOnce(() => new Promise(r => { release = r; }));
      controller.start(); await vi.advanceTimersByTimeAsync(1);
      streams[0]!.emit(JSON.stringify({ ...chrome, title: "new pushed track" }));
      release(JSON.stringify(chrome));
      await vi.advanceTimersByTimeAsync(1);
      expect(controller.snapshot.title).toBe("new pushed track");
    } finally { controller.stop(); await vi.advanceTimersByTimeAsync(1); vi.useRealTimers(); }
  });
  it("fences reconnect and shutdown events and never replays playback", async () => {
    vi.useFakeTimers();
    const { controller, backend, streams } = streaming();
    try {
      controller.start(); await vi.advanceTimersByTimeAsync(1);
      const first = streams[0]!;
      controller.resetSession(); await vi.advanceTimersByTimeAsync(1);
      expect(first.signal.aborted).toBe(true);
      first.emit(JSON.stringify({ ...chrome, title: "old connection" }));
      expect(controller.snapshot.title).not.toBe("old connection");
      expect(streams).toHaveLength(2);
      streams[1]!.emit("null");
      expect(controller.snapshot.state).toBe("idle");
      controller.stop();
      streams[1]!.emit(JSON.stringify(chrome));
      expect(controller.snapshot.state).toBe("unavailable");
      await vi.advanceTimersByTimeAsync(20000);
      expect(streams).toHaveLength(2);
      expect(backend.command).not.toHaveBeenCalled();
    } finally { controller.stop(); await vi.advanceTimersByTimeAsync(1); vi.useRealTimers(); }
  });
  it("rejects a preflight overtaken by a pushed track change without publishing the old track", async () => {
    vi.useFakeTimers();
    const { controller, backend, streams, request } = streaming();
    try {
      controller.start(); await vi.advanceTimersByTimeAsync(1);
      let release!: (raw: string) => void;
      vi.mocked(backend.read).mockImplementationOnce(() => new Promise(r => { release = r; }));
      const pending = controller.dispatch(request("previous"));
      await vi.advanceTimersByTimeAsync(1);
      streams[0]!.emit(JSON.stringify({ ...chrome, title: "new pushed track" }));
      release(JSON.stringify(chrome));
      expect((await pending)?.status).toBe("rejected");
      expect(controller.snapshot.title).toBe("new pushed track");
      expect(backend.command).not.toHaveBeenCalled();
    } finally { controller.stop(); await vi.advanceTimersByTimeAsync(1); vi.useRealTimers(); }
  });
  it("bounds stream recovery without replaying actions", async () => {
    vi.useFakeTimers();
    const { controller, backend, streams } = streaming();
    try {
      controller.start(); await vi.advanceTimersByTimeAsync(1);
      streams[0]!.fail(new Error("helper exited"));
      await vi.advanceTimersByTimeAsync(1);
      expect(controller.snapshot.state).toBe("unavailable");
      await vi.advanceTimersByTimeAsync(4999);
      expect(streams).toHaveLength(2);
      expect(backend.command).not.toHaveBeenCalled();
    } finally { controller.stop(); await vi.advanceTimersByTimeAsync(1); vi.useRealTimers(); }
  });
  it("checks active-login eligibility even under continuous events and fences loss", async () => {
    vi.useFakeTimers();
    const { controller, backend, streams, time } = streaming();
    try {
      controller.start(); await vi.advanceTimersByTimeAsync(1);
      for (let second = 1; second <= 9; second++) {
        time(now + second * 1000);
        streams[0]!.emit(JSON.stringify(chrome));
        await vi.advanceTimersByTimeAsync(1000);
      }
      expect(backend.read).toHaveBeenCalledOnce();
      vi.mocked(backend.verifySession!).mockRejectedValue(new Error("different console user"));
      vi.mocked(backend.read).mockRejectedValue(new Error("wrong login"));
      time(now + 10000); await vi.advanceTimersByTimeAsync(1000);
      expect(backend.verifySession).toHaveBeenCalledTimes(2);
      expect(streams[0]!.signal.aborted).toBe(true);
      streams[0]!.emit(JSON.stringify(chrome));
      expect(controller.snapshot.state).toBe("unavailable");
      await vi.advanceTimersByTimeAsync(5000);
      expect(streams).toHaveLength(1); // restart admission failed eligibility
      vi.mocked(backend.verifySession!).mockResolvedValue();
      await vi.advanceTimersByTimeAsync(5000);
      expect(streams).toHaveLength(2);
      streams[1]!.emit(JSON.stringify(chrome));
      expect(controller.snapshot.state).toBe("playing");
    } finally { controller.stop(); await vi.advanceTimersByTimeAsync(1); vi.useRealTimers(); }
  });
});
