import { describe, expect, it, mock } from "bun:test";
import { createMacOSCommands } from "./macos-commands.ts";

describe("createMacOSCommands", () => {
  it("defines the safe macOS command allowlist", () => {
    const commands = createMacOSCommands(mock(async () => {}));

    expect(commands.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "lock_screen", name: "Lock Screen" },
      { id: "sleep_display", name: "Sleep Display" },
      { id: "start_screensaver", name: "Start Screen Saver" },
    ]);
  });

  it("locks the screen with the native keyboard shortcut", async () => {
    const runner = mock(async () => {});
    const command = createMacOSCommands(runner).find(
      ({ id }) => id === "lock_screen"
    );

    await command?.execute();

    expect(runner).toHaveBeenCalledWith("/usr/bin/osascript", [
      "-e",
      'tell application "System Events" to key code 12 using {control down, command down}',
    ]);
  });

  it("sleeps the display with pmset", async () => {
    const runner = mock(async () => {});
    const command = createMacOSCommands(runner).find(
      ({ id }) => id === "sleep_display"
    );

    await command?.execute();

    expect(runner).toHaveBeenCalledWith("/usr/bin/pmset", ["displaysleepnow"]);
  });

  it("starts the screen saver with open", async () => {
    const runner = mock(async () => {});
    const command = createMacOSCommands(runner).find(
      ({ id }) => id === "start_screensaver"
    );

    await command?.execute();

    expect(runner).toHaveBeenCalledWith("/usr/bin/open", [
      "-a",
      "ScreenSaverEngine",
    ]);
  });
});
