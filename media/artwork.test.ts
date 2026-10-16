import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ARTWORK_MAX_BYTES, ArtworkPublisher, parseArtwork } from "./artwork.ts";
import { emptySnapshot, parseNowPlaying } from "./model.ts";

// Synthetic 1px PNG; never commit private media fixtures.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SioAAAAASUVORK5CYII=";
const metadata = { title: "Fixture", artist: "Fixture artist", playing: true, processIdentifier: 12, bundleIdentifier: "com.example.player" };
const raw = (values = {}) => JSON.stringify({ ...metadata, artworkMimeType: "image/png", artworkData: png, ...values });
const snapshot = (values = {}) => parseNowPlaying(JSON.stringify({ ...metadata, ...values }), "test-session");
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe("genuine embedded artwork trust boundary", () => {
  it("accepts bounded embedded PNG/JPEG only for metadata from the same source/track/session", () => {
    expect(parseArtwork(raw(), snapshot())).toEqual({ data: png, mime: "image/png", sha256: createHash("sha256").update(Buffer.from(png, "base64")).digest("hex") });
    for (const values of [{ title: "Other" }, { bundleIdentifier: "com.other" }, { processIdentifier: 99 }, { artworkMimeType: "image/svg+xml" }, { artworkMimeType: "image/jpeg" }, { artworkData: "https://private.invalid/art.jpg" }, { artworkData: "%%%=" }, { artworkData: "" }, { artworkData: Buffer.alloc(ARTWORK_MAX_BYTES + 1).toString("base64") }]) {
      expect(parseArtwork(raw(values), snapshot())).toBeNull();
    }
  });
  it("fences delayed old artwork across track changes, including A -> B -> A", async () => {
    let release!: (s: string) => void;
    const read = vi.fn((_signal: AbortSignal) => new Promise<string>(r => { release = r; }));
    const publish = vi.fn();
    const art = new ArtworkPublisher(read, publish);
    const key = art.update(snapshot());
    art.update(snapshot({ title: "B" }));
    const returned = art.update(snapshot());
    expect(returned).not.toBe(key);
    release(raw()); await settle();
    expect(publish.mock.calls.every(([v]) => v === null)).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    art.update(snapshot()); release(raw()); await settle();
    expect(publish.mock.calls.at(-1)?.[0]).toMatchObject({ key: returned, data: png });
    art.stop();
  });
  it("retries late/missing artwork, rechecks removal, and suppresses unchanged-image publishes", async () => {
    let time = 0;
    const read = vi.fn(async () => raw({ artworkData: null }));
    const publish = vi.fn();
    const art = new ArtworkPublisher(read, publish, () => time);
    const key = art.update(snapshot()); await settle();
    time = 4999; art.update(snapshot()); expect(read).toHaveBeenCalledOnce();
    time = 5000; read.mockResolvedValue(raw()); art.update(snapshot()); await settle();
    expect(publish.mock.calls.at(-1)?.[0]).toMatchObject({ key, data: png });
    const count = publish.mock.calls.length;
    time = 34999; art.update(snapshot()); expect(read).toHaveBeenCalledTimes(2);
    time = 35000; art.update(snapshot()); await settle();
    expect(publish.mock.calls).toHaveLength(count);
    time = 65000; read.mockResolvedValue(raw({ artworkData: null })); art.update(snapshot()); await settle();
    expect(publish).toHaveBeenLastCalledWith(null);
    expect(art.update(snapshot({ playing: false }))).toBe(key);
    art.stop();
  });
  it("artwork failures are independent and stop/idle/unavailable clear and abort pending work", async () => {
    const read = vi.fn(async () => { throw new Error("optional art unavailable"); });
    const publish = vi.fn();
    const art = new ArtworkPublisher(read, publish);
    art.update(snapshot()); await settle();
    expect(art.update(emptySnapshot("test-session", "idle"))).toBeNull();
    expect(art.update(emptySnapshot("test-session", "unavailable"))).toBeNull();
    art.stop();
    expect(publish).toHaveBeenLastCalledWith(null);
  });
});
