/**
 * Allowlisted macOS commands exposed through Home Assistant.
 *
 * Commands are defined as executable/argument pairs and never pass through a
 * shell. This keeps MQTT payloads from becoming an arbitrary command surface.
 */

import { dlopen, FFIType } from "bun:ffi";
import { spawn } from "child_process";
import type { MqttCommandDefinition } from "./mqtt-emitter.ts";

export const RETIRED_MACOS_COMMAND_IDS = ["start_screensaver"] as const;
export const LOGIN_FRAMEWORK_PATH =
  "/System/Library/PrivateFrameworks/login.framework/Versions/Current/login";

export type ProcessRunner = (
  executable: string,
  args: readonly string[]
) => Promise<void>;

export type ScreenLocker = () => Promise<void>;

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

export async function lockScreen(): Promise<void> {
  const loginFramework = dlopen(LOGIN_FRAMEWORK_PATH, {
    SACLockScreenImmediate: {
      args: [],
      returns: FFIType.i32,
    },
  });

  try {
    const result = loginFramework.symbols.SACLockScreenImmediate();
    if (result !== 0) {
      throw new Error(`SACLockScreenImmediate failed with code ${result}`);
    }
  } finally {
    loginFramework.close();
  }
}

export function createMacOSCommands(
  runner: ProcessRunner = runProcess,
  screenLocker: ScreenLocker = lockScreen
): MqttCommandDefinition[] {
  return [
    {
      id: "lock_screen",
      name: "Lock Screen",
      icon: "mdi:lock",
      execute: screenLocker,
    },
    {
      id: "sleep_display",
      name: "Sleep Display",
      icon: "mdi:monitor-off",
      execute: () => runner("/usr/bin/pmset", ["displaysleepnow"]),
    },
  ];
}
