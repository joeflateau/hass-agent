import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as winston from "winston";

// Mock winston logger
const mockLogger: winston.Logger = {
  debug: mock(() => {}),
  error: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  log: mock(() => {}),
} as any;

// Mock the reader classes instances
const mockDisplayReader = {
  getDisplayStatus: mock(),
  getDetailedDisplayInfo: mock(),
};

const mockBatteryReader = {
  getUptimeInfo: mock(),
  setBatteryUpdateCallback: mock(),
  startPmsetRawlogMonitoring: mock(),
  stopPmsetRawlogMonitoring: mock(),
};

const mockMqttEmitter = {
  connect: mock(),
  disconnect: mock(),
  publishBatteryData: mock(),
  publishUptimeData: mock(),
  publishDisplayData: mock(),
};

// Mock the imported class constructors
const mockDisplayStatusReader = mock(() => mockDisplayReader);
const mockBatteryStatusReader = mock(() => mockBatteryReader);
const mockMqttEmitterClass = mock(() => mockMqttEmitter);

// Mock the modules
mock.module("./display-status-reader.ts", () => ({
  DisplayStatusReader: mockDisplayStatusReader,
}));

mock.module("./battery-status-reader.ts", () => ({
  BatteryStatusReader: mockBatteryStatusReader,
}));

mock.module("./mqtt-emitter.ts", () => ({
  MqttEmitter: mockMqttEmitterClass,
}));

// Import after mocking
import { MacOSPowerAgent } from "./index.ts";

describe("MacOSPowerAgent", () => {
  let agent: MacOSPowerAgent;
  let config: any;

  beforeEach(() => {
    config = {
      MQTT_BROKER: "mqtt://localhost:1883",
      MQTT_USERNAME: "testuser",
      MQTT_PASSWORD: "testpass",
      DEVICE_ID: "test-device",
      DEVICE_NAME: "Test Device",
      UPDATE_INTERVAL: 30000,
      AUTO_UPGRADE: false,
      UPGRADE_CHECK_INTERVAL: 3600000,
      INSTALL_SCRIPT_URL: "https://example.com/install.sh",
      VERSION: "1.0.0",
    };

    // Clear all mocks before creating new agent
    mockDisplayStatusReader.mockClear();
    mockBatteryStatusReader.mockClear();
    mockMqttEmitterClass.mockClear();
    mockDisplayReader.getDisplayStatus.mockClear();
    mockDisplayReader.getDetailedDisplayInfo.mockClear();
    mockBatteryReader.getUptimeInfo.mockClear();
    mockBatteryReader.setBatteryUpdateCallback.mockClear();
    mockBatteryReader.startPmsetRawlogMonitoring.mockClear();
    mockBatteryReader.stopPmsetRawlogMonitoring.mockClear();
    mockMqttEmitter.connect.mockClear();
    mockMqttEmitter.disconnect.mockClear();
    mockMqttEmitter.publishBatteryData.mockClear();
    mockMqttEmitter.publishUptimeData.mockClear();
    mockMqttEmitter.publishDisplayData.mockClear();

    agent = new MacOSPowerAgent(config, mockLogger);
  });

  afterEach(async () => {
    if (agent) {
      await agent.shutdown();
    }
  });

  describe("constructor", () => {
    it("should initialize readers and emitter", () => {
      expect(mockDisplayStatusReader).toHaveBeenCalledWith(mockLogger);
      expect(mockBatteryStatusReader).toHaveBeenCalledWith(mockLogger);
      expect(mockMqttEmitterClass).toHaveBeenCalledWith(
        {
          broker: config.MQTT_BROKER,
          username: config.MQTT_USERNAME,
          password: config.MQTT_PASSWORD,
          deviceId: config.DEVICE_ID,
          deviceName: config.DEVICE_NAME,
          version: config.VERSION,
        },
        mockLogger
      );
    });

    it("should set battery update callback", () => {
      expect(mockBatteryReader.setBatteryUpdateCallback).toHaveBeenCalledWith(
        expect.any(Function)
      );
    });
  });

  describe("initialize", () => {
    it("should connect to MQTT and start monitoring", async () => {
      mockMqttEmitter.connect.mockResolvedValue(undefined);

      await agent.initialize();

      expect(mockMqttEmitter.connect).toHaveBeenCalled();
      expect(mockBatteryReader.startPmsetRawlogMonitoring).toHaveBeenCalled();
    });
  });

  describe("publishSensorData", () => {
    it("should publish uptime and display data", async () => {
      const uptimeInfo = { uptimeMinutes: 1440 };
      const displayInfo = {
        status: "on" as const,
        externalDisplayCount: 0,
        builtinDisplayOnline: true,
      };
      const detailedDisplayInfo = [{ id: "display1", name: "Built-in" }];

      mockBatteryReader.getUptimeInfo.mockResolvedValue(uptimeInfo);
      mockDisplayReader.getDisplayStatus.mockResolvedValue(displayInfo);
      mockDisplayReader.getDetailedDisplayInfo.mockResolvedValue(
        detailedDisplayInfo
      );

      await (agent as any).publishSensorData();

      expect(mockMqttEmitter.publishUptimeData).toHaveBeenCalledWith(
        uptimeInfo
      );
      expect(mockMqttEmitter.publishDisplayData).toHaveBeenCalledWith(
        displayInfo,
        detailedDisplayInfo
      );
    });

    it("should handle errors gracefully", async () => {
      mockBatteryReader.getUptimeInfo.mockRejectedValue(
        new Error("Uptime failed")
      );

      await (agent as any).publishSensorData();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error publishing sensor data")
      );
    });
  });

  describe("battery update callback", () => {
    it("should publish battery data when callback is triggered", () => {
      const batteryInfo = {
        batteryLevel: 85,
        isCharging: true,
        powerSource: "AC",
        timeRemaining: 120,
        cycleCount: 100,
        condition: "Normal",
      };

      // Get the callback that was set
      const calls = mockBatteryReader.setBatteryUpdateCallback.mock.calls;
      expect(calls).toBeDefined();
      expect(calls.length).toBeGreaterThan(0);
      const callback = calls[0]?.[0];
      expect(callback).toBeDefined();

      // Trigger the callback
      callback!(batteryInfo);

      expect(mockMqttEmitter.publishBatteryData).toHaveBeenCalledWith(
        batteryInfo
      );
    });
  });

  describe("shutdown", () => {
    it("should clean up all resources", async () => {
      mockMqttEmitter.disconnect.mockResolvedValue(undefined);

      await agent.shutdown();

      expect(mockBatteryReader.stopPmsetRawlogMonitoring).toHaveBeenCalled();
      expect(mockMqttEmitter.disconnect).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith("Shutting down...");
    });

    it("should clear timers if they exist", async () => {
      // Set up some timers
      (agent as any).periodicTimer = setTimeout(() => {}, 1000);
      (agent as any).upgradeCheckTimer = setTimeout(() => {}, 1000);

      const clearIntervalSpy = mock(() => {});
      global.clearInterval = clearIntervalSpy;
      mockMqttEmitter.disconnect.mockResolvedValue(undefined);

      await agent.shutdown();

      expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("auto-upgrade", () => {
    it("should schedule upgrade check when enabled", async () => {
      const configWithUpgrade = {
        ...config,
        AUTO_UPGRADE: true,
        VERSION: "1.0.0", // Not development
      };

      mockMqttEmitter.connect.mockResolvedValue(undefined);

      agent = new MacOSPowerAgent(configWithUpgrade, mockLogger);
      await agent.initialize();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Auto-upgrade enabled")
      );
    });

    it("should not schedule upgrade check for development version", async () => {
      const configWithDevUpgrade = {
        ...config,
        AUTO_UPGRADE: true,
        VERSION: "development",
      };

      mockMqttEmitter.connect.mockResolvedValue(undefined);

      agent = new MacOSPowerAgent(configWithDevUpgrade, mockLogger);

      // Clear mocks before the test action
      (mockLogger.info as any).mockClear();

      await agent.initialize();

      // Check that the auto-upgrade message was not logged
      const infoCalls = (mockLogger.info as any).mock.calls;
      const autoUpgradeCall = infoCalls.find(
        (call: any) => call[0] && call[0].includes("Auto-upgrade enabled")
      );

      expect(autoUpgradeCall).toBeUndefined();
    });

    it("should not schedule upgrade check when disabled", async () => {
      mockMqttEmitter.connect.mockResolvedValue(undefined);

      agent = new MacOSPowerAgent(config, mockLogger);

      // Clear mocks before the test action
      (mockLogger.info as any).mockClear();

      await agent.initialize();

      // Check that the auto-upgrade message was not logged
      const infoCalls = (mockLogger.info as any).mock.calls;
      const autoUpgradeCall = infoCalls.find(
        (call: any) => call[0] && call[0].includes("Auto-upgrade enabled")
      );

      expect(autoUpgradeCall).toBeUndefined();
    });
  });

  describe("periodic updates", () => {
    it("should set up periodic timer for sensor data", async () => {
      mockMqttEmitter.connect.mockResolvedValue(undefined);

      agent = new MacOSPowerAgent(config, mockLogger);
      await agent.initialize();

      // Verify that periodic monitoring was started
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          "Started monitoring with real-time battery updates"
        )
      );
    });
  });
});
