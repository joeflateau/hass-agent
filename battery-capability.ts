import { execFile } from "node:child_process";

export type BatteryCapability = {
  status: "present" | "absent" | "unknown";
  powerSource: "AC" | "Battery" | null;
};

const MAX_OUTPUT_BYTES = 64 * 1024;

function unknown(): BatteryCapability {
  return { status: "unknown", powerSource: null };
}

/**
 * Recognize only complete `pmset -g batt` snapshots. In particular, a rawlog
 * zero-percent reading does not establish that the machine has no battery.
 * Unrecognized output must never authorize removal of battery entities.
 */
export function parseBatteryCapability(raw: string): BatteryCapability {
  if (Buffer.byteLength(raw, "utf8") > MAX_OUTPUT_BYTES) return unknown();

  const lines = raw.trim().split(/\r?\n/).filter((line) => line.trim() !== "");
  const header = lines[0]?.trim();
  const powerSource = header === "Now drawing from 'AC Power'"
    ? "AC"
    : header === "Now drawing from 'Battery Power'"
      ? "Battery"
      : null;
  if (!powerSource) return unknown();

  if (lines.length === 1) {
    return powerSource === "AC"
      ? { status: "absent", powerSource }
      : unknown();
  }
  if (lines.length !== 2) return unknown();

  const battery = lines[1]?.match(
    /^\s*-InternalBattery-\d+ \(id=\d+\)\s+(0|[1-9]\d?|100)%;\s+(charging|discharging|charged|finishing charge|AC attached);\s+(.+?)\s+present: true\s*$/,
  );
  if (!battery) return unknown();
  const [, , state, remaining] = battery;
  if (powerSource === "Battery" && state !== "discharging") return unknown();
  if (powerSource === "AC" && state === "discharging") return unknown();
  if (state === "AC attached") {
    if (remaining !== "not charging") return unknown();
  } else if (!/^(?:\d+:[0-5]\d remaining|\(no estimate\))$/.test(remaining ?? "")) {
    return unknown();
  }

  return { status: "present", powerSource };
}

/** A bounded, shell-free capability probe; failed or partial reads are unknown. */
export async function readBatteryCapability(
  signal?: AbortSignal,
): Promise<BatteryCapability> {
  if (signal?.aborted) return unknown();
  return new Promise((resolve) => {
    try {
      execFile(
        "/usr/bin/pmset",
        ["-g", "batt"],
        { encoding: "utf8", timeout: 4000, maxBuffer: MAX_OUTPUT_BYTES, signal },
        (error, stdout, stderr) => {
          if (error || signal?.aborted || stderr.trim()) {
            resolve(unknown());
            return;
          }
          resolve(parseBatteryCapability(stdout));
        },
      );
    } catch {
      resolve(unknown());
    }
  });
}
