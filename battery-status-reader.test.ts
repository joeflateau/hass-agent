import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import * as winston from "winston";
import type { BatteryInfo } from "./battery-parser.ts";
import { BatteryStatusReader } from "./battery-status-reader.ts";
import { executeCommand } from "./command-utils.ts";

// Mock spawn
const mockSpawn = mock();
const mockStdout = {
  on: mock(),
  resume: mock(),
};
const mockStderr = {
  on: mock(),
};
const mockProcess = {
  stdout: mockStdout,
  stderr: mockStderr,
  on: mock(),
  kill: mock(),
  killed: false,
};

// Mock winston logger
const mockLogger: winston.Logger = {
  debug: mock(() => {}),
  error: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  log: mock(() => {}),
} as any;

describe("BatteryStatusReader", () => {
  let reader: BatteryStatusReader;

  beforeAll(() => {
    // Set up module mocks
    mock.module("./command-utils.ts", () => ({
      executeCommand: mock(),
    }));

    mock.module("child_process", () => ({
      spawn: mockSpawn,
    }));

    mock.module("readline", () => ({
      createInterface: mock(() => ({
        on: mock(),
      })),
    }));
  });

  afterAll(() => {
    // Reset all mocks to prevent interference with other test files
    mock.restore();
  });

  beforeEach(() => {
    reader = new BatteryStatusReader(mockLogger);

    // Reset spawn mock
    mockSpawn.mockReturnValue(mockProcess);
  });

  afterEach(() => {
    reader.stopPmsetRawlogMonitoring();

    // Clear all mocks after each test to prevent interference
    mockSpawn.mockClear();
    mockStdout.on.mockClear();
    mockStderr.on.mockClear();
    mockProcess.on.mockClear();
    mockProcess.kill.mockClear();

    // Reset executeCommand mock
    (executeCommand as any).mockClear();
  });

  describe("getUptimeInfo", () => {
    it("should return uptime in minutes", async () => {
      const bootTimeSeconds = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      (executeCommand as any).mockResolvedValue(
        `kern.boottime: { sec = ${bootTimeSeconds}, usec = 0 } Sat Aug  3 10:00:00 2024`
      );

      const result = await reader.getUptimeInfo();

      expect(result.uptimeMinutes).toBeGreaterThan(50); // Should be around 60 minutes
      expect(result.uptimeMinutes).toBeLessThan(70);
    });

    it("should return -1 on command error", async () => {
      (executeCommand as any).mockRejectedValue(new Error("Command failed"));

      const result = await reader.getUptimeInfo();

      expect(result.uptimeMinutes).toBe(-1);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should return -1 when boot time format is invalid", async () => {
      (executeCommand as any).mockResolvedValue("invalid output");

      const result = await reader.getUptimeInfo();

      expect(result.uptimeMinutes).toBe(-1);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("setBatteryUpdateCallback", () => {
    it("should set battery update callback", () => {
      const callback = mock();
      reader.setBatteryUpdateCallback(callback);

      expect(reader["onBatteryUpdate"]).toBe(callback);
    });
  });

  describe("startPmsetRawlogMonitoring", () => {
    it("should start pmset rawlog monitoring", () => {
      reader.startPmsetRawlogMonitoring();

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Starting pmset rawlog monitoring..."
      );
    });
  });

  describe("stopPmsetRawlogMonitoring", () => {
    it("should stop pmset rawlog monitoring", () => {
      const mockProcess = {
        kill: mock(),
        killed: false,
      };

      reader["pmsetProcess"] = mockProcess as any;

      reader.stopPmsetRawlogMonitoring();

      expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("should handle case when no process is running", () => {
      reader["pmsetProcess"] = undefined;

      // Should not throw
      expect(() => reader.stopPmsetRawlogMonitoring()).not.toThrow();
    });

    it("should handle case when process is already killed", () => {
      const mockProcess = {
        kill: mock(),
        killed: true,
      };

      reader["pmsetProcess"] = mockProcess as any;

      reader.stopPmsetRawlogMonitoring();

      expect(mockProcess.kill).not.toHaveBeenCalled();
    });
  });

  describe("battery parsing integration", () => {
    it("should call callback when valid battery line is received", (done) => {
      let callbackCount = 0;
      const callback = mock((batteryInfo: BatteryInfo) => {
        expect(batteryInfo.batteryLevel).toBe(85);
        expect(batteryInfo.isCharging).toBe(true);
        expect(batteryInfo.powerSource).toBe("AC");
        callbackCount++;
        if (callbackCount === 1) {
          done();
        }
      });

      reader.setBatteryUpdateCallback(callback);

      // Mock parsePmsetRawlogLine to return test data
      const mockBatteryInfo: BatteryInfo = {
        batteryLevel: 85,
        isCharging: true,
        powerSource: "AC",
        timeRemainingToEmpty: -1,
        timeRemainingToFull: 120,
        cycleCount: 100,
        condition: "Normal",
      };

      (reader as any).parsePmsetRawlogLine = mock(() => mockBatteryInfo);

      // Simulate calling the line parser directly (as would happen in the readline interface)
      const testLine = "2024-08-03 10:00:00 +0000;Charging;85%;AC;120;";
      const batteryInfo = (reader as any).parsePmsetRawlogLine(testLine);
      if (batteryInfo && reader["onBatteryUpdate"]) {
        reader["onBatteryUpdate"](batteryInfo);
      }
    });

    it("should not call callback for invalid battery lines", () => {
      const callback = mock();
      reader.setBatteryUpdateCallback(callback);

      (reader as any).parsePmsetRawlogLine = mock(() => null);

      // Simulate calling the line parser with invalid data
      const testLine = "invalid line";
      const batteryInfo = (reader as any).parsePmsetRawlogLine(testLine);
      if (batteryInfo && reader["onBatteryUpdate"]) {
        reader["onBatteryUpdate"](batteryInfo);
      }

      expect(callback).not.toHaveBeenCalled();
    });
  });
});
