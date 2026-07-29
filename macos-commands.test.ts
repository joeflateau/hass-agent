import { describe, expect, it, mock } from "bun:test";
import {
  createMacOSCommands,
  RETIRED_MACOS_COMMAND_IDS,
} from "./macos-commands.ts";

describe("createMacOSCommands", () => {
  it("defines the safe macOS command allowlist", () => {
    const commands = createMacOSCommands(mock(async () => {}));

    expect(commands.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "lock_screen", name: "Lock Screen" },
      { id: "sleep_display", name: "Sleep Display" },
    ]);
  });

  it("locks the session with CGSession without AppleScript", async () => {
    const runner = mock(async () => {});
    const command = createMacOSCommands(runner).find(
      ({ id }) => id === "lock_screen"
    );

    await command?.execute();

    expect(runner).toHaveBeenCalledWith(
      "/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession",
      ["-suspend"]
    );
  });

  it("sleeps the display with pmset", async () => {
    const runner = mock(async () => {});
    const command = createMacOSCommands(runner).find(
      ({ id }) => id === "sleep_display"
    );

    await command?.execute();

    expect(runner).toHaveBeenCalledWith("/usr/bin/pmset", ["displaysleepnow"]);
  });

  it("retires the removed command ids", () => {
    expect(RETIRED_MACOS_COMMAND_IDS).toEqual(["start_screensaver"]);
  });
});
