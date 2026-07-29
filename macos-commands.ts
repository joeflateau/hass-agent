/**
 * Allowlisted macOS commands exposed through Home Assistant.
 *
 * Commands are defined as executable/argument pairs and never pass through a
 * shell. This keeps MQTT payloads from becoming an arbitrary command surface.
 */

import { spawn } from "child_process";
import type { MqttCommandDefinition } from "./mqtt-emitter.ts";

export const RETIRED_MACOS_COMMAND_IDS = [
  "lock_screen",
  "start_screensaver",
] as const;

export type ProcessRunner = (
  executable: string,
  args: readonly string[]
) => Promise<void>;

export async function runProcess(
  executable: string,
  args: readonly string[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const detail = stderr.trim();
      reject(
        new Error(
          `${executable} exited with code ${code}${detail ? `: ${detail}` : ""}`
        )
      );
    });

    child.on("error", reject);
  });
}

export function createMacOSCommands(
  runner: ProcessRunner = runProcess
): MqttCommandDefinition[] {
  return [
    {
      id: "sleep_display",
      name: "Sleep Display",
      icon: "mdi:monitor-off",
      execute: () => runner("/usr/bin/pmset", ["displaysleepnow"]),
    },
  ];
}
