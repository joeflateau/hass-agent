import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: mockExecFile }));

import { parseBatteryCapability, readBatteryCapability } from "./battery-capability.ts";

const UNKNOWN = { status: "unknown", powerSource: null };
const AC_HEADER = "Now drawing from 'AC Power'";
const BATTERY_HEADER = "Now drawing from 'Battery Power'";
// Synthetic fixtures of the expected platform format, not hardware captures.
const internal = (charge = "85", state = "charging", remaining = "1:20 remaining") =>
  ` -InternalBattery-0 (id=1234567)\t${charge}%; ${state}; ${remaining} present: true`;

describe("parseBatteryCapability", () => {
  it.each([`${AC_HEADER}\n`, `\n${AC_HEADER}\n\t \n`])(
    "recognizes a complete AC-only snapshot as batteryless",
    (raw) => expect(parseBatteryCapability(raw)).toEqual({ status: "absent", powerSource: "AC" }),
  );

  it.each([
    [AC_HEADER, internal(), "AC"],
    [AC_HEADER, internal("100", "charged", "0:00 remaining"), "AC"],
    [AC_HEADER, internal("0", "charging", "(no estimate)"), "AC"],
    [AC_HEADER, internal("98", "AC attached", "not charging"), "AC"],
    [AC_HEADER, internal("99", "finishing charge", "0:05 remaining"), "AC"],
    [BATTERY_HEADER, internal("0", "discharging", "0:00 remaining"), "Battery"],
    [BATTERY_HEADER, internal("45", "discharging", "(no estimate)"), "Battery"],
  ])("recognizes a coherent internal battery from %s", (header, body, source) => {
    expect(parseBatteryCapability(`${header}\r\n${body}\r\n`)).toEqual({ status: "present", powerSource: source });
  });

  it.each([
    "", " \n\t", BATTERY_HEADER,
    "Now drawing from 'UPS Power'", "Now drawing from 'External Power'",
    `Now drawing from AC Power\n${internal()}`,
    internal(), `2026-10-17 12:00:00;discharging;0%;AC;0;`,
    `${AC_HEADER}\n${BATTERY_HEADER}`,
    `${AC_HEADER}\n${internal()}\n${internal()}`,
    `${AC_HEADER}\n -UPS-0 (id=12) 100%; charged; 0:00 remaining present: true`,
    `${AC_HEADER}\n${internal()}\nwarning: incomplete output`,
    `${BATTERY_HEADER}\n${internal()}`,
    `${AC_HEADER}\n${internal("20", "discharging")}`,
    `${AC_HEADER}\n${internal("101")}`,
    `${AC_HEADER}\n${internal("-1")}`,
    `${AC_HEADER}\n${internal("0.0")}`,
    `${AC_HEADER}\n${internal("000")}`,
    `${AC_HEADER}\n${internal("NaN")}`,
    `${AC_HEADER}\n${internal("50", "unknown")}`,
    `${AC_HEADER}\n${internal("50", "charging", "1:99 remaining")}`,
    `${AC_HEADER}\n${internal("50", "charging", "not charging")}`,
    `${AC_HEADER}\n${internal().replace("present: true", "present: false")}`,
    `${AC_HEADER}\n${internal().replace(" present: true", "")}`,
    `${AC_HEADER}\n${internal()} truncated`,
  ])("keeps unsupported, malformed or contradictory output unknown: %s", (raw) => {
    expect(parseBatteryCapability(raw)).toEqual(UNKNOWN);
  });

  it("does not treat oversized whitespace output as evidence of absence", () => {
    expect(parseBatteryCapability(`${AC_HEADER}\n${" ".repeat(64 * 1024)}`)).toEqual(UNKNOWN);
  });
});

describe("readBatteryCapability", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  function answer(error: Error | null, stdout: string, stderr = "") {
    mockExecFile.mockImplementation((_file, _args, _options, callback) => {
      callback(error, stdout, stderr);
    });
  }

  it("uses the fixed command with bounded shell-free options and cancellation", async () => {
    answer(null, `${AC_HEADER}\n`);
    const controller = new AbortController();
    await expect(readBatteryCapability(controller.signal)).resolves.toEqual({ status: "absent", powerSource: "AC" });
    expect(mockExecFile).toHaveBeenCalledWith(
      "/usr/bin/pmset", ["-g", "batt"],
      { encoding: "utf8", timeout: 4000, maxBuffer: 65536, signal: controller.signal },
      expect.any(Function),
    );
    expect(mockExecFile.mock.calls[0]?.[2]).not.toHaveProperty("shell");
  });

  it("passes successful snapshots through the parser", async () => {
    answer(null, `${BATTERY_HEADER}\n${internal("0", "discharging", "0:00 remaining")}`);
    await expect(readBatteryCapability()).resolves.toEqual({ status: "present", powerSource: "Battery" });
  });

  it.each(["ENOENT", "EACCES", "ETIMEDOUT", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", "ABORT_ERR"])(
    "returns unknown on %s even if partial stdout looks batteryless",
    async (code) => {
      answer(Object.assign(new Error("process failed"), { code }), `${AC_HEADER}\n`);
      await expect(readBatteryCapability()).resolves.toEqual(UNKNOWN);
    },
  );

  it("returns unknown on process startup exceptions", async () => {
    mockExecFile.mockImplementation(() => { throw new Error("could not launch"); });
    await expect(readBatteryCapability()).resolves.toEqual(UNKNOWN);
  });

  it("does not launch an already-cancelled probe", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readBatteryCapability(controller.signal)).resolves.toEqual(UNKNOWN);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("ignores successful-looking output if cancelled while the process completes", async () => {
    const controller = new AbortController();
    mockExecFile.mockImplementation((_file, _args, _options, callback) => {
      controller.abort();
      callback(null, `${AC_HEADER}\n`, "");
    });
    await expect(readBatteryCapability(controller.signal)).resolves.toEqual(UNKNOWN);
  });

  it("does not trust output accompanied by a native diagnostic", async () => {
    answer(null, `${AC_HEADER}\n`, "warning: incomplete result");
    await expect(readBatteryCapability()).resolves.toEqual(UNKNOWN);
  });
});
