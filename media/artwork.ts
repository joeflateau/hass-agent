import { createHash, randomUUID } from "node:crypto";
import { parseNowPlaying, type MediaSnapshot } from "./model.ts";

export const ARTWORK_MAX_BYTES = 512 * 1024;
export const ARTWORK_MAX_RESPONSE = 1024 * 1024;
export interface MediaArtwork {
  key: string;
  sha256: string;
  mime: "image/jpeg" | "image/png";
  data: string;
}

/** Accept only genuine embedded raster bytes, never a URL or a title lookup. */
export function parseArtwork(raw: string, snapshot: MediaSnapshot): Omit<MediaArtwork, "key"> | null {
  if (Buffer.byteLength(raw) > ARTWORK_MAX_RESPONSE) return null;
  const read = parseNowPlaying(raw, snapshot.session);
  if (read.version !== snapshot.version || read.source_version !== snapshot.source_version || !["playing", "paused"].includes(read.state)) return null;
  const value = JSON.parse(raw);
  const data = value.artworkData;
  const mime = value.artworkMimeType;
  if (typeof data !== "string" || !data.length || data.length > Math.ceil(ARTWORK_MAX_BYTES / 3) * 4 ||
      (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))) return null;
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > ARTWORK_MAX_BYTES || bytes.toString("base64") !== data) return null;
  if (!(mime === "image/jpeg" && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) &&
      !(mime === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))) return null;
  return { data, mime, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** Independent single-flight artwork IO. Metadata and transport never await it. */
export class ArtworkPublisher {
  private identity: string | null | undefined;
  private key: string | null = null;
  private abort?: AbortController;
  private active = false;
  private lastAttempt = -Infinity;
  private lastHash: string | null = null;
  private misses = 0;
  constructor(private read: ((signal: AbortSignal) => Promise<string>) | undefined,
    private publish: (artwork: MediaArtwork | null) => void, private clock = Date.now) {}

  update(snapshot: MediaSnapshot): string | null {
    const identity = ["playing", "paused"].includes(snapshot.state) && snapshot.version && this.read
      ? JSON.stringify([snapshot.session, snapshot.version, snapshot.source_version]) : null;
    if (identity !== this.identity) {
      this.abort?.abort();
      this.identity = identity;
      this.key = identity ? randomUUID() : null;
      this.lastAttempt = -Infinity;
      this.lastHash = null;
      this.misses = 0;
      this.publish(null); // Retire the previous retained image before new-track state.
    }
    // An old read must settle before the next can start, even after A -> B -> A.
    const retry = this.lastHash || this.misses > 1 ? 30000 : 5000;
    if (identity && !this.active && this.clock() - this.lastAttempt >= retry) {
      const key = this.key!;
      const abort = this.abort = new AbortController();
      this.active = true;
      this.lastAttempt = this.clock();
      const deadline = setTimeout(() => abort.abort(), 5000);
      void (async () => {
        try {
          const raw = await this.read!(abort.signal);
          if (abort.signal.aborted || key !== this.key) return;
          const art = parseArtwork(raw, snapshot);
          const hash = art?.sha256 ?? null;
          if (hash !== this.lastHash) this.publish(art ? { ...art, key } : null);
          this.lastHash = hash;
          this.misses = art ? 0 : this.misses + 1;
        } catch {
          if (key === this.key) {
            if (this.lastHash) this.publish(null);
            this.lastHash = null;
            this.misses++;
          }
        } finally { clearTimeout(deadline); this.active = false; }
      })();
    }
    return this.key;
  }
  stop(): void {
    this.abort?.abort();
    this.identity = this.key = this.lastHash = null;
    this.publish(null);
  }
}
