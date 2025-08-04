import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as winston from "winston";
import type { BatteryInfo } from "./battery-parser.ts";
import type { UptimeInfo } from "./battery-status-reader.ts";
import type { DisplayInfo } from "./display-status-reader.ts";
import { MqttEmitter, type MqttConfig } from "./mqtt-emitter.ts";

// Mock winston logger
const mockLogger: winston.Logger = {
  debug: mock(() => {}),
  error: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  log: mock(() => {}),
} as any;

describe("MqttEmitter", () => {
  let emitter: MqttEmitter;
  let config: MqttConfig;
  let mockMqttClient: any;

  beforeEach(() => {
    config = {
      broker: "mqtt://localhost:1883",
      username: "testuser",
      password: "testpass",
      deviceId: "test-device",
      deviceName: "Test Device",
      version: "1.0.0",
    };

    // Create mock MQTT client
    mockMqttClient = {
      connected: false,
      publish: mock(),
      on: mock(),
      once: mock(),
      end: mock(),
      subscribe: mock(),
      options: {
        reconnectPeriod: 5000,
      },
    };

    emitter = new MqttEmitter(config, mockLogger);

    // Replace the client with our mock after construction
    (emitter as any).client = mockMqttClient;

    // Mock the publishDiscoveryConfigs method to avoid actual MQTT calls
    (emitter as any).publishDiscoveryConfigs = mock();

    // Reset mocks
    mockMqttClient.publish.mockClear();
    mockMqttClient.on.mockClear();
    mockMqttClient.once.mockClear();
  });

  afterEach(() => {
    // Clean up without calling disconnect to avoid hanging
    mockMqttClient.publish.mockClear();
    mockMqttClient.on.mockClear();
    mockMqttClient.once.mockClear();
  });

  describe("constructor", () => {
    it("should initialize with correct configuration", () => {
      expect(emitter).toBeDefined();
      expect((emitter as any).config.deviceId).toBe("test-device");
      expect((emitter as any).config.deviceName).toBe("Test Device");
    });
  });

  describe("connect", () => {
    it("should resolve immediately if already connected", async () => {
      mockMqttClient.connected = true;

      await emitter.connect();

      expect(mockMqttClient.once).not.toHaveBeenCalled();
    });

    it("should setup connect event listener if not connected", () => {
      mockMqttClient.connected = false;

      // Just test that the connect method sets up the listener
      // without actually waiting for the async callback
      const connectPromise = emitter.connect();

      expect(mockMqttClient.once).toHaveBeenCalledWith(
        "connect",
        expect.any(Function)
      );

      // Simulate the connect event to resolve the promise
      const connectCallback = mockMqttClient.once.mock.calls[0][1];
      connectCallback();

      return connectPromise;
    });
  });

  describe("publishBatteryData", () => {
    it("should publish battery data to correct topics", () => {
      const batteryInfo: BatteryInfo = {
        batteryLevel: 85,
        isCharging: true,
        powerSource: "AC",
        timeRemainingToEmpty: -1,
        timeRemainingToFull: 120,
        cycleCount: 100,
        condition: "Normal",
      };

      emitter.publishBatteryData(batteryInfo);

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/sensor/test-device/battery_level/state",
        JSON.stringify({ battery_level: 85 })
      );

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/binary_sensor/test-device/battery_charging/state",
        JSON.stringify({ is_charging: "ON" })
      );

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/sensor/test-device/time_remaining_to_empty/state",
        JSON.stringify({ time_remaining_to_empty: -1 })
      );

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/sensor/test-device/time_remaining_to_full/state",
        JSON.stringify({ time_remaining_to_full: 120 })
      );

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/binary_sensor/test-device/ac_power/state",
        JSON.stringify({ ac_power: "ON" })
      );
    });

    it("should handle battery not charging", () => {
      const batteryInfo: BatteryInfo = {
        batteryLevel: 50,
        isCharging: false,
        powerSource: "Battery",
        timeRemainingToEmpty: 240,
        timeRemainingToFull: -1,
        cycleCount: 100,
        condition: "Normal",
      };

      emitter.publishBatteryData(batteryInfo);

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/binary_sensor/test-device/battery_charging/state",
        JSON.stringify({ is_charging: "OFF" })
      );

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/binary_sensor/test-device/ac_power/state",
        JSON.stringify({ ac_power: "OFF" })
      );
    });
  });

  describe("publishUptimeData", () => {
    it("should publish uptime data to correct topic", () => {
      const uptimeInfo: UptimeInfo = {
        uptimeMinutes: 1440, // 24 hours
      };

      emitter.publishUptimeData(uptimeInfo);

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/sensor/test-device/uptime/state",
        JSON.stringify({ uptime: 1440 })
      );
    });
  });

  describe("publishDisplayData", () => {
    it("should publish display data to correct topics", () => {
      const displayInfo: DisplayInfo = {
        status: "external",
        externalDisplayCount: 1,
        builtinDisplayOnline: true,
      };

      const detailedDisplayInfo = [
        {
          id: "display1",
          name: "External Monitor",
          internal: false,
          online: true,
          connection_type: "HDMI",
        },
      ];

      emitter.publishDisplayData(displayInfo, detailedDisplayInfo);

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/sensor/test-device/display_status/state",
        JSON.stringify({ status: "external" })
      );

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/sensor/test-device/external_display_count/state",
        JSON.stringify({ external_display_count: 1 })
      );

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/binary_sensor/test-device/builtin_display_online/state",
        JSON.stringify({ builtin_display_online: "ON" })
      );

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/sensor/test-device/display_info/state",
        JSON.stringify({
          total_displays: 1,
          displays: detailedDisplayInfo,
          summary: {
            external_count: 1,
            builtin_online: true,
            status: "external",
          },
        })
      );
    });

    it("should handle built-in display offline", () => {
      const displayInfo: DisplayInfo = {
        status: "off",
        externalDisplayCount: 0,
        builtinDisplayOnline: false,
      };

      emitter.publishDisplayData(displayInfo, []);

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/binary_sensor/test-device/builtin_display_online/state",
        JSON.stringify({ builtin_display_online: "OFF" })
      );
    });
  });

  describe("disconnect", () => {
    it("should publish offline status and call disconnect", async () => {
      // Setup mock behavior
      mockMqttClient.publish.mockImplementation(
        (topic: any, payload: any, options: any, callback: any) => {
          if (callback) callback();
        }
      );

      mockMqttClient.end.mockImplementation(
        (force: any, options: any, callback: any) => {
          if (callback) callback();
        }
      );

      // Call disconnect and wait for completion
      await emitter.disconnect();

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/status/test-device",
        "offline",
        { qos: 1, retain: true },
        expect.any(Function)
      );

      expect(mockMqttClient.end).toHaveBeenCalledWith(
        true,
        {},
        expect.any(Function)
      );

      expect(mockLogger.info).toHaveBeenCalledWith("MQTT client disconnected");

      // Check that reconnectPeriod was disabled
      expect(mockMqttClient.options.reconnectPeriod).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should handle publish errors gracefully", () => {
      const batteryInfo: BatteryInfo = {
        batteryLevel: 85,
        isCharging: true,
        powerSource: "AC",
        timeRemainingToEmpty: -1,
        timeRemainingToFull: 120,
        cycleCount: 100,
        condition: "Normal",
      };

      mockMqttClient.publish.mockImplementation(() => {
        throw new Error("Publish failed");
      });

      expect(() => emitter.publishBatteryData(batteryInfo)).not.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error publishing battery data")
      );
    });
  });
});
