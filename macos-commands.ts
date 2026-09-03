/**
 * Allowlisted macOS commands exposed through Home Assistant.
 *
 * Commands are defined as executable/argument pairs and never pass through a
 * shell. This keeps MQTT payloads from becoming an arbitrary command surface.
 */

import { dlopen } from "node:ffi";
import { spawn } from "child_process";
import type { MqttCommandDefinition } from "./mqtt-emitter.ts";
import {
  releaseCapturedDisplayForLock,
  verifyDisplayCaptureSupport,
  type DisplayCaptureReleaseOptions,
  type DisplayCaptureReleaseRequester,
} from "./macos-display-capture.ts";
import {
  terminateLeagueGameProcesses,
} from "./macos-league-process.ts";

export const RETIRED_MACOS_COMMAND_IDS = ["start_screensaver"] as const;
export const LOGIN_FRAMEWORK_PATH =
  "/System/Library/PrivateFrameworks/login.framework/Versions/Current/login";
export const OPEN_APPLICATION_PATH = "/usr/bin/open";
export const FINDER_BUNDLE_ID = "com.apple.finder";
const LOGIN_FRAMEWORK_SYMBOLS = {
  SACLockScreenImmediate: {
    arguments: [],
    return: "i32",
  },
} as const;

export type ProcessRunner = (
  executable: string,
  args: readonly string[]
) => Promise<void>;

export type ScreenLocker = () => Promise<void>;
export type NativeScreenLocker = () => void;
export type DisplayCaptureReleaser = (
  requestRelease: DisplayCaptureReleaseRequester,
  options?: DisplayCaptureReleaseOptions
) => Promise<void>;
export type LeagueProcessTerminator = () => Promise<void>;

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

function callNativeLockScreen(): void {
  const { lib, functions } = dlopen(
    LOGIN_FRAMEWORK_PATH,
    LOGIN_FRAMEWORK_SYMBOLS
  );

  try {
    const result = functions.SACLockScreenImmediate();
    if (result !== 0) {
      throw new Error(`SACLockScreenImmediate failed with code ${result}`);
    }
  } finally {
    lib.close();
  }
}

export async function lockScreen(
  runner: ProcessRunner = runProcess,
  releaseDisplayCapture: DisplayCaptureReleaser =
    releaseCapturedDisplayForLock,
  nativeScreenLocker: NativeScreenLocker = callNativeLockScreen,
  terminateLeagueProcesses: LeagueProcessTerminator =
    terminateLeagueGameProcesses
): Promise<void> {
  await terminateLeagueProcesses();
  await releaseDisplayCapture(
    () => runner(OPEN_APPLICATION_PATH, ["-b", FINDER_BUNDLE_ID]),
    { requestDescription: "activating Finder" }
  );

  nativeScreenLocker();
}

/**
 * Verify that the private macOS lock function is still available without
 * invoking it (which would lock the test runner).
 */
export function verifyLockScreenSupport(): void {
  const { lib } = dlopen(LOGIN_FRAMEWORK_PATH, LOGIN_FRAMEWORK_SYMBOLS);
  lib.close();
  verifyDisplayCaptureSupport();
}

export function createMacOSCommands(
  runner: ProcessRunner = runProcess,
  screenLocker: ScreenLocker = () => lockScreen(runner)
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
