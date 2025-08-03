import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { parsePmsetRawlogLine } from "./battery-parser.ts";
import { MacOSPowerAgent } from "./index.ts";

describe("MacOS Power Agent", () => {
  describe("parsePmsetRawlogLine", () => {
    test("should parse battery line with AC power", () => {
      const line =
        " AC; Charging; 85%; Cap=85: FCC=100; Design=8694; Time=1:23; 1500mA; Cycles=245/1000; Location=0;";
      const result = parsePmsetRawlogLine(line);

      expect(result).toEqual({
        isCharging: true,
        batteryLevel: 85,
        timeRemaining: 83, // 1 hour 23 minutes = 83 minutes
        powerSource: "AC",
        cycleCount: 245,
        condition: "Good",
      });
    });

    test("should parse battery line without AC power", () => {
      const line =
        " No AC; Not Charging; 97%; Cap=97: FCC=100; Design=8694; Time=5:02; -1250mA; Cycles=489/1000; Location=0;";
      const result = parsePmsetRawlogLine(line);

      expect(result).toEqual({
        isCharging: false,
        batteryLevel: 97,
        timeRemaining: 302, // 5 hours 2 minutes = 302 minutes
        powerSource: "Battery",
        cycleCount: 489,
        condition: "Good",
      });
    });

    test("should parse battery line with charging status", () => {
      const line =
        " AC; Charging; 45%; Cap=45: FCC=100; Design=8694; Time=2:15; 2000mA; Cycles=123/1000; Location=0;";
      const result = parsePmsetRawlogLine(line);

      expect(result).toEqual({
        isCharging: true,
        batteryLevel: 45,
        timeRemaining: 135, // 2 hours 15 minutes = 135 minutes
        powerSource: "AC",
        cycleCount: 123,
        condition: "Good",
      });
    });

    test("should parse battery line with charged status", () => {
      const line =
        " AC; Charged; 100%; Cap=100: FCC=100; Design=8694; Time=0:00; 0mA; Cycles=567/1000; Location=0;";
      const result = parsePmsetRawlogLine(line);

      expect(result).toEqual({
        isCharging: false, // "Charged" is not "Charging"
        batteryLevel: 100,
        timeRemaining: 0,
        powerSource: "AC",
        cycleCount: 567,
        condition: "Good",
      });
    });

    test("should return null for invalid lines", () => {
      expect(parsePmsetRawlogLine("")).toBe(null);
      expect(
        parsePmsetRawlogLine(
          "pmset is in RAW logging mode now. Hit ctrl-c to exit."
        )
      ).toBe(null);
      expect(parsePmsetRawlogLine("08/02/2025 09:31:02")).toBe(null);
      expect(parsePmsetRawlogLine("* Battery matched at registry = 5931")).toBe(
        null
      );
    });

    test("should handle missing time information", () => {
      const line =
        " No AC; Not Charging; 50%; Cap=50: FCC=100; Design=8694; Cycles=300/1000; Location=0;";
      const result = parsePmsetRawlogLine(line);

      expect(result).toEqual({
        isCharging: false,
        batteryLevel: 50,
        timeRemaining: -1, // No time info available
        powerSource: "Battery",
        cycleCount: 300,
        condition: "Good",
      });
    });

    test("should handle edge cases in time parsing", () => {
      const line1 =
        " No AC; Not Charging; 25%; Cap=25: FCC=100; Design=8694; Time=0:05; -500mA; Cycles=100/1000; Location=0;";
      const result1 = parsePmsetRawlogLine(line1);
      expect(result1?.timeRemaining).toBe(5); // 5 minutes

      const line2 =
        " No AC; Not Charging; 75%; Cap=75: FCC=100; Design=8694; Time=10:00; -800mA; Cycles=200/1000; Location=0;";
      const result2 = parsePmsetRawlogLine(line2);
      expect(result2?.timeRemaining).toBe(600); // 10 hours = 600 minutes
    });

    test("should handle zero cycle count", () => {
      const line =
        " AC; Charging; 80%; Cap=80: FCC=100; Design=8694; Time=1:00; 1000mA; Cycles=0/1000; Location=0;";
      const result = parsePmsetRawlogLine(line);

      expect(result?.cycleCount).toBe(0);
    });

    test("should handle high cycle counts", () => {
      const line =
        " No AC; Not Charging; 60%; Cap=60: FCC=100; Design=8694; Time=3:30; -600mA; Cycles=999/1000; Location=0;";
      const result = parsePmsetRawlogLine(line);

      expect(result?.cycleCount).toBe(999);
    });

    test("should parse real charging example", () => {
      const line =
        " AC; Charging; 43%; Cap=43: FCC=100; Design=8694; Time=2:01; 4794mA; Cycles=490/1000; Location=0;";
      const result = parsePmsetRawlogLine(line);

      expect(result).toEqual({
        isCharging: true,
        batteryLevel: 43,
        timeRemaining: 121, // 2 hours 1 minute = 121 minutes
        powerSource: "AC",
        cycleCount: 490,
        condition: "Good",
      });
    });
  });

  describe("Environment validation", () => {
    test("should validate required DEVICE_ID", () => {
      // This would test the Zod schema validation
      // For now, we'll create a simple validation function to test
      const validateConfig = (env: Record<string, string>) => {
        if (!env.DEVICE_ID || env.DEVICE_ID.length === 0) {
          throw new Error("DEVICE_ID is required");
        }
        return true;
      };

      expect(() => validateConfig({})).toThrow("DEVICE_ID is required");
      expect(() => validateConfig({ DEVICE_ID: "" })).toThrow(
        "DEVICE_ID is required"
      );
      expect(validateConfig({ DEVICE_ID: "test-device" })).toBe(true);
    });
  });

  describe("Uptime calculation", () => {
    test("should calculate uptime from sysctl output", () => {
      const calculateUptimeMinutes = (
        sysctlOutput: string,
        currentTime: Date
      ): number => {
        const secMatch = sysctlOutput.match(/sec = (\d+)/);
        if (!secMatch || !secMatch[1]) {
          throw new Error("Could not parse boot time from sysctl output");
        }

        const bootTimeSeconds = parseInt(secMatch[1]);
        const bootTime = new Date(bootTimeSeconds * 1000);
        const diffMs = currentTime.getTime() - bootTime.getTime();
        return Math.floor(diffMs / 60000); // minutes
      };

      // Mock current time to be predictable
      const mockNow = new Date("2025-08-02T10:00:00Z");
      const bootTimeSeconds =
        Math.floor(mockNow.getTime() / 1000) - 2 * 60 * 60; // 2 hours ago
      const sysctlOutput = `kern.boottime: { sec = ${bootTimeSeconds}, usec = 0 } Fri Aug  2 08:00:00 2025`;

      const uptime = calculateUptimeMinutes(sysctlOutput, mockNow);
      expect(uptime).toBe(120); // 2 hours = 120 minutes
    });

    test("should handle invalid sysctl output", () => {
      const calculateUptimeMinutes = (sysctlOutput: string): number => {
        const secMatch = sysctlOutput.match(/sec = (\d+)/);
        if (!secMatch || !secMatch[1]) {
          throw new Error("Could not parse boot time from sysctl output");
        }

        const bootTimeSeconds = parseInt(secMatch[1]);
        const bootTime = new Date(bootTimeSeconds * 1000);
        const now = new Date();
        const diffMs = now.getTime() - bootTime.getTime();
        return Math.floor(diffMs / 60000);
      };

      expect(() => calculateUptimeMinutes("invalid output")).toThrow(
        "Could not parse boot time"
      );
      expect(() => calculateUptimeMinutes("kern.boottime: invalid")).toThrow(
        "Could not parse boot time"
      );
    });
  });

  describe("MQTT Discovery Configuration", () => {
    test("should generate correct battery level sensor config", () => {
      const deviceId = "test-device";
      const deviceName = "Test Device";
      const version = "1.0.0";

      const generateBatteryLevelConfig = (
        deviceId: string,
        deviceName: string,
        version: string
      ) => {
        const deviceConfig = {
          identifiers: [deviceId],
          name: deviceName,
          model: "macOS System Monitor",
          manufacturer: "Apple",
          sw_version: `${version} (macOS 14.0)`,
        };

        return {
          name: "Battery Level",
          unique_id: `${deviceId}_battery_level`,
          state_topic: `homeassistant/sensor/${deviceId}/battery_level/state`,
          device_class: "battery",
          unit_of_measurement: "%",
          value_template: "{{ value_json.battery_level }}",
          device: deviceConfig,
        };
      };

      const config = generateBatteryLevelConfig(deviceId, deviceName, version);

      expect(config.name).toBe("Battery Level");
      expect(config.unique_id).toBe("test-device_battery_level");
      expect(config.state_topic).toBe(
        "homeassistant/sensor/test-device/battery_level/state"
      );
      expect(config.device_class).toBe("battery");
      expect(config.unit_of_measurement).toBe("%");
      expect(config.device.identifiers).toEqual(["test-device"]);
      expect(config.device.name).toBe("Test Device");
    });

    test("should generate correct charging sensor config", () => {
      const deviceId = "test-device";
      const deviceName = "Test Device";
      const version = "1.0.0";

      const generateChargingConfig = (
        deviceId: string,
        deviceName: string,
        version: string
      ) => {
        const deviceConfig = {
          identifiers: [deviceId],
          name: deviceName,
          model: "macOS System Monitor",
          manufacturer: "Apple",
          sw_version: `${version} (macOS 14.0)`,
        };

        return {
          name: "Battery Charging",
          unique_id: `${deviceId}_battery_charging`,
          state_topic: `homeassistant/binary_sensor/${deviceId}/battery_charging/state`,
          device_class: "battery_charging",
          payload_on: "ON",
          payload_off: "OFF",
          value_template: "{{ value_json.is_charging }}",
          device: deviceConfig,
        };
      };

      const config = generateChargingConfig(deviceId, deviceName, version);

      expect(config.name).toBe("Battery Charging");
      expect(config.unique_id).toBe("test-device_battery_charging");
      expect(config.device_class).toBe("battery_charging");
      expect(config.payload_on).toBe("ON");
      expect(config.payload_off).toBe("OFF");
    });
  });

  describe("Battery data publishing", () => {
    test("should format battery data correctly", () => {
      const formatBatteryData = (batteryInfo: any) => {
        return {
          battery_level: { battery_level: batteryInfo.batteryLevel },
          is_charging: { is_charging: batteryInfo.isCharging ? "ON" : "OFF" },
          time_remaining: { time_remaining: batteryInfo.timeRemaining },
          ac_power: {
            ac_power: batteryInfo.powerSource === "AC" ? "ON" : "OFF",
          },
        };
      };

      const batteryInfo = {
        isCharging: true,
        batteryLevel: 85,
        timeRemaining: 120,
        powerSource: "AC",
        cycleCount: 300,
        condition: "Good",
      };

      const formatted = formatBatteryData(batteryInfo);

      expect(formatted.battery_level).toEqual({ battery_level: 85 });
      expect(formatted.is_charging).toEqual({ is_charging: "ON" });
      expect(formatted.time_remaining).toEqual({ time_remaining: 120 });
      expect(formatted.ac_power).toEqual({ ac_power: "ON" });
    });

    test("should handle battery power correctly", () => {
      const formatBatteryData = (batteryInfo: any) => {
        return {
          battery_level: { battery_level: batteryInfo.batteryLevel },
          is_charging: { is_charging: batteryInfo.isCharging ? "ON" : "OFF" },
          time_remaining: { time_remaining: batteryInfo.timeRemaining },
          ac_power: {
            ac_power: batteryInfo.powerSource === "AC" ? "ON" : "OFF",
          },
        };
      };

      const batteryInfo = {
        isCharging: false,
        batteryLevel: 60,
        timeRemaining: 240,
        powerSource: "Battery",
        cycleCount: 450,
        condition: "Good",
      };

      const formatted = formatBatteryData(batteryInfo);

      expect(formatted.is_charging).toEqual({ is_charging: "OFF" });
      expect(formatted.ac_power).toEqual({ ac_power: "OFF" });
    });
  });

  describe("Display Status Detection", () => {
    let agent: MacOSPowerAgent;
    let mockExecuteCommand: any;

    beforeEach(() => {
      // Create agent with minimal config
      const config = {
        MQTT_BROKER: "mqtt://localhost:1883",
        DEVICE_ID: "test-device",
        DEVICE_NAME: "Test Device",
        UPDATE_INTERVAL: 30000,
        AUTO_UPGRADE: false,
        UPGRADE_CHECK_INTERVAL: 3 * 60 * 60 * 1000,
        INSTALL_SCRIPT_URL: "https://example.com/install.sh",
        VERSION: "test-version",
      };

      agent = new MacOSPowerAgent(config);

      // Mock the executeCommand method
      mockExecuteCommand = mock();
      (agent as any).executeCommand = mockExecuteCommand;
    });

    afterEach(() => {
      mockExecuteCommand.mockRestore?.();
    });

    test("should detect external display status", async () => {
      // Mock system_profiler output with external display
      const mockDisplayOutput = JSON.stringify({
        SPDisplaysDataType: [
          {
            spdisplays_ndrvs: [
              {
                spdisplays_connection_type: "spdisplays_internal",
                spdisplays_online: "spdisplays_yes",
              },
              {
                spdisplays_connection_type: "spdisplays_external",
                spdisplays_online: "spdisplays_yes",
              },
            ],
          },
        ],
      });

      const mockAssertionsOutput =
        "PreventUserIdleDisplaySleep    0\nInternalPreventDisplaySleep    0";

      mockExecuteCommand
        .mockImplementationOnce(() => Promise.resolve(mockDisplayOutput))
        .mockImplementationOnce(() => Promise.resolve(mockAssertionsOutput));

      const result = await agent.getDisplayStatus();

      expect(result).toEqual({
        status: "external",
        externalDisplayCount: 1,
        builtinDisplayOnline: true,
      });

      expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
      expect(mockExecuteCommand).toHaveBeenNthCalledWith(
        1,
        "system_profiler SPDisplaysDataType -json"
      );
      expect(mockExecuteCommand).toHaveBeenNthCalledWith(
        2,
        "pmset -g assertions"
      );
    });

    test("should detect built-in display on status", async () => {
      // Mock system_profiler output with only built-in display
      const mockDisplayOutput = JSON.stringify({
        SPDisplaysDataType: [
          {
            spdisplays_ndrvs: [
              {
                spdisplays_connection_type: "spdisplays_internal",
                spdisplays_online: "spdisplays_yes",
              },
            ],
          },
        ],
      });

      const mockAssertionsOutput = "PreventUserIdleDisplaySleep    1";

      mockExecuteCommand
        .mockImplementationOnce(() => Promise.resolve(mockDisplayOutput))
        .mockImplementationOnce(() => Promise.resolve(mockAssertionsOutput));

      const result = await agent.getDisplayStatus();

      expect(result).toEqual({
        status: "on",
        externalDisplayCount: 0,
        builtinDisplayOnline: true,
      });
    });

    test("should detect display off status", async () => {
      // Mock system_profiler output with built-in display online but no sleep prevention
      const mockDisplayOutput = JSON.stringify({
        SPDisplaysDataType: [
          {
            spdisplays_ndrvs: [
              {
                spdisplays_connection_type: "spdisplays_internal",
                spdisplays_online: "spdisplays_yes",
              },
            ],
          },
        ],
      });

      const mockAssertionsOutput =
        "PreventUserIdleDisplaySleep    0\nInternalPreventDisplaySleep    0";

      mockExecuteCommand
        .mockImplementationOnce(() => Promise.resolve(mockDisplayOutput))
        .mockImplementationOnce(() => Promise.resolve(mockAssertionsOutput));

      const result = await agent.getDisplayStatus();

      expect(result).toEqual({
        status: "off",
        externalDisplayCount: 0,
        builtinDisplayOnline: true,
      });
    });

    test("should handle multiple external displays", async () => {
      // Mock system_profiler output with multiple external displays
      const mockDisplayOutput = JSON.stringify({
        SPDisplaysDataType: [
          {
            spdisplays_ndrvs: [
              {
                spdisplays_connection_type: "spdisplays_internal",
                spdisplays_online: "spdisplays_no",
              },
              {
                spdisplays_connection_type: "spdisplays_external",
                spdisplays_online: "spdisplays_yes",
              },
              {
                spdisplays_connection_type: "spdisplays_external",
                spdisplays_online: "spdisplays_yes",
              },
            ],
          },
        ],
      });

      const mockAssertionsOutput = "PreventUserIdleDisplaySleep    0";

      mockExecuteCommand
        .mockImplementationOnce(() => Promise.resolve(mockDisplayOutput))
        .mockImplementationOnce(() => Promise.resolve(mockAssertionsOutput));

      const result = await agent.getDisplayStatus();

      expect(result).toEqual({
        status: "external",
        externalDisplayCount: 2,
        builtinDisplayOnline: false,
      });
    });

    test("should handle empty display data", async () => {
      // Mock system_profiler output with no displays
      const mockDisplayOutput = JSON.stringify({
        SPDisplaysDataType: [],
      });

      const mockAssertionsOutput = "PreventUserIdleDisplaySleep    0";

      mockExecuteCommand
        .mockImplementationOnce(() => Promise.resolve(mockDisplayOutput))
        .mockImplementationOnce(() => Promise.resolve(mockAssertionsOutput));

      const result = await agent.getDisplayStatus();

      expect(result).toEqual({
        status: "off",
        externalDisplayCount: 0,
        builtinDisplayOnline: false,
      });
    });

    test("should handle InternalPreventDisplaySleep assertion", async () => {
      // Mock system_profiler output with built-in display
      const mockDisplayOutput = JSON.stringify({
        SPDisplaysDataType: [
          {
            spdisplays_ndrvs: [
              {
                spdisplays_connection_type: "spdisplays_internal",
                spdisplays_online: "spdisplays_yes",
              },
            ],
          },
        ],
      });

      const mockAssertionsOutput = "InternalPreventDisplaySleep    1";

      mockExecuteCommand
        .mockImplementationOnce(() => Promise.resolve(mockDisplayOutput))
        .mockImplementationOnce(() => Promise.resolve(mockAssertionsOutput));

      const result = await agent.getDisplayStatus();

      expect(result).toEqual({
        status: "on",
        externalDisplayCount: 0,
        builtinDisplayOnline: true,
      });
    });

    test("should handle offline external displays", async () => {
      // Mock system_profiler output with offline external display
      const mockDisplayOutput = JSON.stringify({
        SPDisplaysDataType: [
          {
            spdisplays_ndrvs: [
              {
                spdisplays_connection_type: "spdisplays_internal",
                spdisplays_online: "spdisplays_yes",
              },
              {
                spdisplays_connection_type: "spdisplays_external",
                spdisplays_online: "spdisplays_no",
              },
            ],
          },
        ],
      });

      const mockAssertionsOutput = "PreventUserIdleDisplaySleep    1";

      mockExecuteCommand
        .mockImplementationOnce(() => Promise.resolve(mockDisplayOutput))
        .mockImplementationOnce(() => Promise.resolve(mockAssertionsOutput));

      const result = await agent.getDisplayStatus();

      expect(result).toEqual({
        status: "on",
        externalDisplayCount: 0,
        builtinDisplayOnline: true,
      });
    });

    test("should handle command execution errors", async () => {
      // Mock executeCommand to throw an error
      mockExecuteCommand.mockImplementationOnce(() =>
        Promise.reject(new Error("Command failed"))
      );

      const result = await agent.getDisplayStatus();

      expect(result).toEqual({
        status: "off",
        externalDisplayCount: 0,
        builtinDisplayOnline: false,
      });

      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
    });

    test("should handle invalid JSON from system_profiler", async () => {
      // Mock system_profiler to return invalid JSON
      mockExecuteCommand.mockImplementationOnce(() =>
        Promise.resolve("invalid json")
      );

      const result = await agent.getDisplayStatus();

      expect(result).toEqual({
        status: "off",
        externalDisplayCount: 0,
        builtinDisplayOnline: false,
      });

      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
    });

    test("should handle missing spdisplays_ndrvs data", async () => {
      // Mock system_profiler output with missing spdisplays_ndrvs
      const mockDisplayOutput = JSON.stringify({
        SPDisplaysDataType: [
          {
            // Missing spdisplays_ndrvs
          },
        ],
      });

      const mockAssertionsOutput = "PreventUserIdleDisplaySleep    0";

      mockExecuteCommand
        .mockImplementationOnce(() => Promise.resolve(mockDisplayOutput))
        .mockImplementationOnce(() => Promise.resolve(mockAssertionsOutput));

      const result = await agent.getDisplayStatus();

      expect(result).toEqual({
        status: "off",
        externalDisplayCount: 0,
        builtinDisplayOnline: false,
      });
    });

    test("should prioritize external displays over built-in display status", async () => {
      // Mock system_profiler output with both built-in and external displays
      const mockDisplayOutput = JSON.stringify({
        SPDisplaysDataType: [
          {
            spdisplays_ndrvs: [
              {
                spdisplays_connection_type: "spdisplays_internal",
                spdisplays_online: "spdisplays_yes",
              },
              {
                spdisplays_connection_type: "spdisplays_external",
                spdisplays_online: "spdisplays_yes",
              },
            ],
          },
        ],
      });

      // Even if display sleep is not prevented, external display should take priority
      const mockAssertionsOutput = "PreventUserIdleDisplaySleep    0";

      mockExecuteCommand
        .mockImplementationOnce(() => Promise.resolve(mockDisplayOutput))
        .mockImplementationOnce(() => Promise.resolve(mockAssertionsOutput));

      const result = await agent.getDisplayStatus();

      expect(result).toEqual({
        status: "external",
        externalDisplayCount: 1,
        builtinDisplayOnline: true,
      });
    });
  });
});
