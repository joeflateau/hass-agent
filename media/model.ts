import { createHash } from "node:crypto";
import { z } from "zod";

export const ACTIONS = { play: "play", pause: "pause", previous: "previous-track", next: "next-track" } as const;
export type MediaAction = keyof typeof ACTIONS;
export interface MediaSnapshot {
  state: "playing" | "paused" | "idle" | "unavailable";
  session: string;
  version: string | null;
  observed_at: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  source: string | null;
  duration: number | null;
  position: number | null;
  position_at: string | null;
  rate: number | null;
}

export function emptySnapshot(session: string, state: "idle" | "unavailable", now = Date.now()): MediaSnapshot {
  return { state, session, version: null, observed_at: new Date(now).toISOString(), title: null,
    artist: null, album: null, source: null, duration: null, position: null, position_at: null, rate: null };
}
const finite = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
const text = (v: unknown, max = 512): string | null => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : null;

export function parseNowPlaying(raw: string, session: string, now = Date.now()): MediaSnapshot {
  const value: unknown = JSON.parse(raw);
  if (value === null) return emptySnapshot(session, "idle", now);
  const record = z.object({ title: z.string().min(1), playing: z.boolean() }).passthrough().parse(value);
  if (!record.title.trim()) throw new Error("Invalid media title");
  const timestamp = typeof record.timestamp === "string" && record.timestamp.length <= 64 &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(record.timestamp) && Number.isFinite(Date.parse(record.timestamp)) && Date.parse(record.timestamp) <= now + 2000
    ? record.timestamp : null;
  return {
    ...emptySnapshot(session, "idle", now), state: record.playing ? "playing" : "paused",
    version: createHash("sha256").update(JSON.stringify([session, ...["processIdentifier", "bundleIdentifier", "contentItemIdentifier", "title", "artist", "album"].map(k => record[k] ?? null)])).digest("hex"),
    title: text(record.title), artist: text(record.artist), album: text(record.album), source: text(record.bundleIdentifier, 256),
    duration: finite(record.duration, 604800), position: finite(record.elapsedTime, 604800),
    position_at: timestamp, rate: finite(record.playbackRate, 8),
  };
}

export const requestSchema = z.object({
  action: z.enum(["play", "pause", "previous", "next"]),
  request_id: z.string().min(16).max(128).regex(/^[a-zA-Z0-9_.:+-]+$/),
  session: z.string().uuid(), expected: z.string().regex(/^[a-f0-9]{64}$/),
  observed_at: z.iso.datetime({ offset: true }),
}).strict();
export type MediaRequest = z.infer<typeof requestSchema>;
export interface MediaResult {
  request_id: string;
  action: MediaAction;
  status: "rejected" | "submitted" | "observed" | "unknown";
  timestamp: string;
  reason?: string;
}
