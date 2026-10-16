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
  it("allows pause through volatile native IDs and confirms the unchanged track paused", async () => {
    const { backend, controller, request } = setup();
    const ids = ["93F5FB2B-2F56-4489-ACA2-8623209BF41E", "43CF6505-917B-4237-8615-A2A53EA45A48", "2A30B4F0-90D1-4E52-9D4B-2FE53224F6A8"];
    vi.mocked(backend.read)
      .mockResolvedValueOnce(JSON.stringify({ ...chrome, contentItemIdentifier: ids[0] }))
      .mockResolvedValueOnce(JSON.stringify({ ...chrome, contentItemIdentifier: ids[1] }))
      .mockResolvedValueOnce(JSON.stringify({ ...chrome, contentItemIdentifier: ids[2], playing: false }));
    await controller.poll();
    const result = await controller.dispatch(request("pause"));
    expect(result?.status).toBe("observed");
    expect(backend.command).toHaveBeenCalledExactlyOnceWith("pause", expect.any(AbortSignal));
    expect(controller.snapshot.state).toBe("paused");
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
  it("observes skip only after changed track, consumes duplicate request once", async () => {
    const { backend, controller, request } = setup();
    await controller.poll();
    const body = request();
    vi.mocked(backend.read).mockResolvedValueOnce(JSON.stringify(chrome)).mockResolvedValue(JSON.stringify({ ...chrome, title: "next track" }));
    const result = await controller.dispatch(body);
    expect(result?.status).toBe("observed");
    expect(await controller.dispatch(body)).toEqual(result);
    expect(backend.command).toHaveBeenCalledExactlyOnceWith("next", expect.any(AbortSignal));
  });
  it("does not equate native success with observed playback", async () => {
    const { backend, controller, request } = setup();
    await controller.poll();
    expect((await controller.dispatch(request()))?.status).toBe("submitted");
    expect(backend.command).toHaveBeenCalledOnce();
  });
  it("does not call a same-metadata skip observed just because the native content ID changed", async () => {
    const { backend, controller, request } = setup();
    let content = 0;
    vi.mocked(backend.read).mockImplementation(async () => JSON.stringify({ ...chrome, contentItemIdentifier: `ephemeral-${++content}` }));
    await controller.poll();
    expect((await controller.dispatch(request("next")))?.status).toBe("submitted");
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
  it("revalidates track immediately before sending; paused observation confirms pause", async () => {
    const { backend, controller, request } = setup();
    await controller.poll();
    const body = request();
    vi.mocked(backend.read).mockResolvedValue(JSON.stringify({ ...chrome, title: "other" }));
    expect((await controller.dispatch(body))?.status).toBe("rejected");
    expect(backend.command).not.toHaveBeenCalled();
    const pause = request("pause", "request_2234567890");
    vi.mocked(backend.command).mockImplementation(async () => { vi.mocked(backend.read).mockResolvedValue(JSON.stringify({ ...chrome, title: "other", playing: false })); });
    expect((await controller.dispatch(pause))?.status).toBe("observed");
  });
  it("does not queue actions or overlap polls; shutdown cancels and fences late reads", async () => {
    const { backend, controller, request, snapshots } = setup();
    await controller.poll();
    let resolve!: (value: string) => void;
    vi.mocked(backend.read).mockImplementation(() => new Promise(r => { resolve = r; }));
    const poll = controller.poll();
    await controller.poll();
    expect((await controller.dispatch(request()))?.status).toBe("rejected");
    expect(backend.read).toHaveBeenCalledTimes(2);
    controller.stop();
    const count = snapshots.length;
    resolve(JSON.stringify(chrome));
    await poll;
    expect(snapshots).toHaveLength(count);
    expect(controller.snapshot.state).toBe("unavailable");
    expect(vi.mocked(backend.read).mock.calls[1]![0].aborted).toBe(true);
    controller.resetSession(); // MQTT close after shutdown must not revive the reader.
    await controller.poll();
    expect(backend.read).toHaveBeenCalledTimes(2);
  });
});
