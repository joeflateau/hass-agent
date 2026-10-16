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
  it("rejects malformed/invalid media and bounds optional fields without inventing values", () => {
    for (const raw of ["{}", "[]", '"playing"', '{"title":"x","playing":1}']) expect(() => parseNowPlaying(raw, "s")).toThrow();
    expect(parseNowPlaying(JSON.stringify({ ...chrome, duration: -1, elapsedTime: "3", playbackRate: 100,
      timestamp: "invalid", artist: "a".repeat(1000) }), "s", now)).toMatchObject({ duration: null, position: null, position_at: null, rate: null, artist: "a".repeat(512) });
  });
});
describe("media action lifecycle", () => {
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
