import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as winston from "winston";

// Mock winston logger
const mockLogger: winston.Logger = {
  debug: vi.fn(() => {}),
  error: vi.fn(() => {}),
  info: vi.fn(() => {}),
  warn: vi.fn(() => {}),
  log: vi.fn(() => {}),
} as any;

const {
  mockBatteryReader,
  mockBatteryStatusReader,
  mockDeviceEmitter,
  mockDisplayReader,
  mockDisplayStatusReader,
  mockLoLStatusReader,
  mockLoLStatusReaderClass,
  mockMqttDeviceFrameworkClass,
  mockMqttFramework,
} = vi.hoisted(() => {
  const mockDeviceEmitter = {
    publishState: vi.fn(),
  };
  const mockDisplayReader = {
    getDisplayStatus: vi.fn(),
    getDetailedDisplayInfo: vi.fn(),
  };
  const mockBatteryReader = {
    getUptimeInfo: vi.fn(),
    setBatteryUpdateCallback: vi.fn(),
    startPmsetRawlogMonitoring: vi.fn(),
    stopPmsetRawlogMonitoring: vi.fn(),
  };
  const mockLoLStatusReader = {
    getGameStatus: vi.fn(),
    setStatusUpdateCallback: vi.fn(),
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn(),
  };
  const mockMqttFramework = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    createDeviceEmitter: vi.fn(() => mockDeviceEmitter),
    registerCommands: vi.fn(),
    registerIntegration: vi.fn(),
    registerSwitches: vi.fn(),
    registerNumbers: vi.fn(),
    retireCommands: vi.fn(),
  };

  return {
    mockBatteryReader,
    mockBatteryStatusReader: vi.fn(function () {
      return mockBatteryReader;
    }),
    mockDeviceEmitter,
    mockDisplayReader,
    mockDisplayStatusReader: vi.fn(function () {
      return mockDisplayReader;
    }),
    mockLoLStatusReader,
    mockLoLStatusReaderClass: vi.fn(function () {
      return mockLoLStatusReader;
    }),
    mockMqttDeviceFrameworkClass: vi.fn(function () {
      return mockMqttFramework;
    }),
    mockMqttFramework,
  };
});

vi.mock("./display-status-reader.ts", () => ({
  DisplayStatusReader: mockDisplayStatusReader,
}));

vi.mock("./battery-status-reader.ts", () => ({
  BatteryStatusReader: mockBatteryStatusReader,
}));

vi.mock("./lol-status-reader.ts", () => ({
  LoLStatusReader: mockLoLStatusReaderClass,
}));

vi.mock("./mqtt-emitter.ts", () => ({
  MqttDeviceFramework: mockMqttDeviceFrameworkClass,
}));

// Import after mocking
import { envSchema, MacOSPowerAgent } from "./index.ts";

describe("MacOSPowerAgent", () => {
  it("enables music by default while preserving an explicit opt-out", () => {
    expect(envSchema.parse({ DEVICE_ID: "mac-mini" }).MEDIA_ENABLED).toBe(true);
    expect(envSchema.parse({ DEVICE_ID: "mac-mini", MEDIA_ENABLED: "false" }).MEDIA_ENABLED).toBe(false);
    expect(() => envSchema.parse({ DEVICE_ID: "mac-mini", MEDIA_ENABLED: "maybe" })).toThrow();
  });
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

    agent = new MacOSPowerAgent(config, mockLogger);
  });

  afterEach(async () => {
    if (agent) {
      await agent.shutdown();
    }

    // Clear all mocks after each test to prevent interference
    mockDisplayStatusReader.mockClear();
    mockBatteryStatusReader.mockClear();
    mockLoLStatusReaderClass.mockClear();
    mockMqttDeviceFrameworkClass.mockClear();
    mockDisplayReader.getDisplayStatus.mockClear();
    mockDisplayReader.getDetailedDisplayInfo.mockClear();
    mockBatteryReader.getUptimeInfo.mockClear();
    mockBatteryReader.setBatteryUpdateCallback.mockClear();
    mockBatteryReader.startPmsetRawlogMonitoring.mockClear();
    mockBatteryReader.stopPmsetRawlogMonitoring.mockClear();
    mockLoLStatusReader.getGameStatus.mockClear();
    mockLoLStatusReader.setStatusUpdateCallback.mockClear();
    mockLoLStatusReader.startMonitoring.mockClear();
    mockLoLStatusReader.stopMonitoring.mockClear();
    mockMqttFramework.connect.mockClear();
    mockMqttFramework.disconnect.mockClear();
    mockMqttFramework.createDeviceEmitter.mockClear();
    mockMqttFramework.registerCommands.mockClear();
    mockMqttFramework.registerSwitches.mockClear();
    mockMqttFramework.retireCommands.mockClear();
    mockDeviceEmitter.publishState.mockClear();
  });

  describe("constructor", () => {
    it("should initialize readers and emitter", () => {
      expect(mockDisplayStatusReader).toHaveBeenCalledWith(mockLogger);
      expect(mockBatteryStatusReader).toHaveBeenCalledWith(mockLogger);
      expect(mockLoLStatusReaderClass).toHaveBeenCalledWith(mockLogger);
      expect(mockMqttDeviceFrameworkClass).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: "test-device",
          deviceName: "Test Device",
          broker: "mqtt://localhost:1883",
          username: "testuser",
          password: "testpass",
          version: "1.0.0",
        }),
        mockLogger
      );
      expect(mockMqttFramework.registerCommands).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "lock_screen",
          name: "Lock Screen",
        }),
        expect.objectContaining({
          id: "sleep_display",
          name: "Sleep Display",
        }),
      ]);
      expect(mockMqttFramework.retireCommands).toHaveBeenCalledWith([
        "start_screensaver",
      ]);
      expect(mockMqttFramework.registerSwitches).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "automatic_upgrades",
          name: "Automatic Upgrades",
          icon: "mdi:update",
          getState: expect.any(Function),
          setState: expect.any(Function),
        }),
      ]);
      expect(mockMqttFramework.registerNumbers).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "upgrade_check_interval",
          name: "Upgrade Check Interval",
          min: 0.25,
          max: 168,
          step: 0.25,
          unitOfMeasurement: "h",
          deviceClass: "duration",
          getState: expect.any(Function),
          setState: expect.any(Function),
        }),
      ]);
    });

    it("should set battery update callback", () => {
      expect(mockBatteryReader.setBatteryUpdateCallback).toHaveBeenCalledWith(
        expect.any(Function)
      );
      expect(mockLoLStatusReader.setStatusUpdateCallback).toHaveBeenCalledWith(
        expect.any(Function)
      );
    });
  });

  describe("initialize", () => {
    it("should connect to MQTT and start monitoring", async () => {
      mockMqttFramework.connect.mockResolvedValue(undefined);

      await agent.initialize();

      expect(mockMqttFramework.connect).toHaveBeenCalled();
      expect(mockBatteryReader.startPmsetRawlogMonitoring).toHaveBeenCalled();
      expect(mockLoLStatusReader.startMonitoring).toHaveBeenCalled();
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

      expect(mockDeviceEmitter.publishState).toHaveBeenCalledWith(uptimeInfo);
      expect(mockDeviceEmitter.publishState).toHaveBeenCalledWith(displayInfo);
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
        timeRemainingToEmpty: -1,
        timeRemainingToFull: 120,
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

      expect(mockDeviceEmitter.publishState).toHaveBeenCalledWith(batteryInfo);
    });
  });

  describe("shutdown", () => {
    it("should clean up all resources", async () => {
      mockMqttFramework.disconnect.mockResolvedValue(undefined);

      await agent.shutdown();

      expect(mockBatteryReader.stopPmsetRawlogMonitoring).toHaveBeenCalled();
      expect(mockLoLStatusReader.stopMonitoring).toHaveBeenCalled();
      expect(mockMqttFramework.disconnect).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith("Shutting down...");
    });

    it("should clear timers if they exist", async () => {
      // Set up periodic timer (upgradeCheckTimer is now handled by AutoUpdater)
      (agent as any).periodicTimer = setTimeout(() => {}, 1000);

      const clearIntervalSpy = vi.fn(() => {});
      global.clearInterval = clearIntervalSpy;
      mockMqttFramework.disconnect.mockResolvedValue(undefined);

      await agent.shutdown();

      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("auto-upgrade", () => {
    it("persists and applies Home Assistant switch changes", async () => {
      const saved = Promise.withResolvers<void>();
      const save = vi.fn(() => saved.promise);
      const settingsStore = {
        load: vi.fn(async (fallback: boolean) => fallback),
        save,
        loadInterval: vi.fn(async (fallback: number) => fallback),
        saveInterval: vi.fn(async () => {}),
      };
      agent = new MacOSPowerAgent(
        { ...config, VERSION: "development" },
        mockLogger,
        settingsStore
      );
      const switchDefinition =
        mockMqttFramework.registerSwitches.mock.calls.at(-1)?.[0]?.[0];

      expect(switchDefinition.getState()).toBe(false);
      const update = switchDefinition.setState(true);
      await Promise.resolve();

      expect(save).toHaveBeenCalledWith(true);
      expect(switchDefinition.getState()).toBe(false);
      saved.resolve();
      await update;
      expect(switchDefinition.getState()).toBe(true);
    });

    it("persists and applies Home Assistant interval changes", async () => {
      const saved = Promise.withResolvers<void>();
      const saveInterval = vi.fn(() => saved.promise);
      const settingsStore = {
        load: vi.fn(async (fallback: boolean) => fallback),
        save: vi.fn(async () => {}),
        loadInterval: vi.fn(async (fallback: number) => fallback),
        saveInterval,
      };
      agent = new MacOSPowerAgent(
        {
          ...config,
          VERSION: "development",
          UPGRADE_CHECK_INTERVAL: 60 * 60 * 1000,
        },
        mockLogger,
        settingsStore
      );
      const numberDefinition =
        mockMqttFramework.registerNumbers.mock.calls.at(-1)?.[0]?.[0];

      expect(numberDefinition.getState()).toBe(1);
      const update = numberDefinition.setState(1.5);
      await Promise.resolve();

      expect(saveInterval).toHaveBeenCalledWith(90 * 60 * 1000);
      expect(numberDefinition.getState()).toBe(1);
      saved.resolve();
      await update;
      expect(numberDefinition.getState()).toBe(1.5);
    });

    it("should schedule upgrade check when enabled", async () => {
      const configWithUpgrade = {
        ...config,
        AUTO_UPGRADE: true,
        VERSION: "1.0.0", // Not development
      };

      mockMqttFramework.connect.mockResolvedValue(undefined);

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

      mockMqttFramework.connect.mockResolvedValue(undefined);

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
      mockMqttFramework.connect.mockResolvedValue(undefined);

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
      mockMqttFramework.connect.mockResolvedValue(undefined);

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

  describe("MQTT device framework integration", () => {
    it("should create device emitters for all device types", () => {
      // Verify that createDeviceEmitter was called for each device type
      expect(mockMqttFramework.createDeviceEmitter).toHaveBeenCalledTimes(5);

      // Verify battery emitter creation
      expect(mockMqttFramework.createDeviceEmitter).toHaveBeenCalledWith(
        "battery_status",
        expect.arrayContaining([
          expect.objectContaining({
            type: "sensor",
            id: "battery_level",
            config: expect.objectContaining({
              name: "Battery Level",
              device_class: "battery",
            }),
          }),
          expect.objectContaining({
            type: "binary_sensor",
            id: "battery_charging",
            config: expect.objectContaining({
              name: "Battery Charging",
              device_class: "battery_charging",
            }),
          }),
        ])
      );

      // Verify uptime emitter creation
      expect(mockMqttFramework.createDeviceEmitter).toHaveBeenCalledWith(
        "uptime",
        expect.arrayContaining([
          expect.objectContaining({
            type: "sensor",
            id: "uptime",
            config: expect.objectContaining({
              name: "System Uptime",
              unit_of_measurement: "min",
            }),
          }),
        ])
      );

      // Verify display emitter creation
      expect(mockMqttFramework.createDeviceEmitter).toHaveBeenCalledWith(
        "display_status",
        expect.arrayContaining([
          expect.objectContaining({
            type: "sensor",
            id: "display_status",
            config: expect.objectContaining({
              name: "Display Status",
            }),
          }),
          expect.objectContaining({
            type: "binary_sensor",
            id: "builtin_display_online",
            config: expect.objectContaining({
              name: "Built-in Display Online",
              device_class: "connectivity",
            }),
          }),
        ])
      );

      expect(mockMqttFramework.createDeviceEmitter).toHaveBeenCalledWith(
        "lol_last_in_game_status",
        expect.arrayContaining([
          expect.objectContaining({
            type: "sensor",
            id: "lol_game_mode",
            config: expect.objectContaining({
              name: "LoL Game Mode",
            }),
          }),
        ])
      );

      // Verify LoL emitter creation
      expect(mockMqttFramework.createDeviceEmitter).toHaveBeenCalledWith(
        "lol_now_status",
        expect.arrayContaining([
          expect.objectContaining({
            type: "binary_sensor",
            id: "lol_in_game",
            config: expect.objectContaining({
              name: "LoL In Game",
              device_class: "connectivity",
            }),
          }),
        ])
      );
    });

    it("should publish battery data with correct format", () => {
      const batteryInfo = {
        batteryLevel: 85,
        isCharging: true,
        powerSource: "AC",
        timeRemainingToEmpty: -1,
        timeRemainingToFull: 120,
        cycleCount: 100,
        condition: "Normal",
      };

      // Get the callback that was set
      const calls = mockBatteryReader.setBatteryUpdateCallback.mock.calls;
      const callback = calls[0]?.[0];

      // Trigger the callback
      callback!(batteryInfo);

      expect(mockDeviceEmitter.publishState).toHaveBeenCalledWith({
        batteryLevel: 85,
        isCharging: true,
        powerSource: "AC",
        timeRemainingToEmpty: -1,
        timeRemainingToFull: 120,
        cycleCount: 100,
        condition: "Normal",
      });
    });

    it("should publish battery data when not charging", () => {
      const batteryInfo = {
        batteryLevel: 50,
        isCharging: false,
        powerSource: "Battery",
        timeRemainingToEmpty: 240,
        timeRemainingToFull: -1,
        cycleCount: 100,
        condition: "Normal",
      };

      // Get the callback that was set
      const calls = mockBatteryReader.setBatteryUpdateCallback.mock.calls;
      const callback = calls[0]?.[0];

      // Trigger the callback
      callback!(batteryInfo);

      expect(mockDeviceEmitter.publishState).toHaveBeenCalledWith({
        batteryLevel: 50,
        isCharging: false,
        powerSource: "Battery",
        timeRemainingToEmpty: 240,
        timeRemainingToFull: -1,
        cycleCount: 100,
        condition: "Normal",
      });
    });

    it("should publish uptime data with correct format", async () => {
      const uptimeInfo = { uptimeMinutes: 1440 }; // 24 hours

      mockBatteryReader.getUptimeInfo.mockResolvedValue(uptimeInfo);
      mockDisplayReader.getDisplayStatus.mockResolvedValue({
        status: "on" as const,
        externalDisplayCount: 0,
        builtinDisplayOnline: true,
      });
      mockDisplayReader.getDetailedDisplayInfo.mockResolvedValue([]);

      await (agent as any).publishSensorData();

      expect(mockDeviceEmitter.publishState).toHaveBeenCalledWith(uptimeInfo);
    });

    it("should publish display data with external monitor", async () => {
      const displayInfo = {
        status: "external" as const,
        externalDisplayCount: 1,
        builtinDisplayOnline: true,
      };

      mockBatteryReader.getUptimeInfo.mockResolvedValue({ uptimeMinutes: 100 });
      mockDisplayReader.getDisplayStatus.mockResolvedValue(displayInfo);
      mockDisplayReader.getDetailedDisplayInfo.mockResolvedValue([
        {
          id: "display1",
          name: "External Monitor",
          internal: false,
          online: true,
          connection_type: "HDMI",
        },
      ]);

      await (agent as any).publishSensorData();

      expect(mockDeviceEmitter.publishState).toHaveBeenCalledWith(displayInfo);
    });

    it("should publish display data when display is off", async () => {
      const displayInfo = {
        status: "off" as const,
        externalDisplayCount: 0,
        builtinDisplayOnline: false,
      };

      mockBatteryReader.getUptimeInfo.mockResolvedValue({ uptimeMinutes: 100 });
      mockDisplayReader.getDisplayStatus.mockResolvedValue(displayInfo);
      mockDisplayReader.getDetailedDisplayInfo.mockResolvedValue([]);

      await (agent as any).publishSensorData();

      expect(mockDeviceEmitter.publishState).toHaveBeenCalledWith(displayInfo);
    });

    it("should publish LoL game status when in game", () => {
      const lolStatus = {
        isInGame: true,
        gameTime: 600.5,
        gameMode: "CLASSIC",
        mapName: "Summoner's Rift",
        mapNumber: 11,
        activePlayerName: "TestPlayer",
        championName: "Jinx",
        level: 12,
        currentGold: 2500,
        score: {
          kills: 5,
          deaths: 2,
          assists: 8,
          creepScore: 145,
          wardScore: 12,
        },
        team: "BLUE",
        summonerSpells: {
          summonerSpellOne: {
            displayName: "Flash",
            rawDescription:
              "Teleports your champion a short distance toward your cursor's location.",
          },
          summonerSpellTwo: {
            displayName: "Heal",
            rawDescription:
              "Restores Health to you and your most wounded nearby ally.",
          },
        },
        items: [
          {
            canUse: false,
            consumable: false,
            count: 1,
            displayName: "Doran's Blade",
            itemID: 1055,
            price: 450,
            rawDescription: "+8 Attack Damage +80 Health +3% Life Steal",
            rawDisplayName: "Item_1055_Name",
            slot: 0,
          },
        ],
      };

      // Get the LoL callback that was set
      const calls = mockLoLStatusReader.setStatusUpdateCallback.mock.calls;
      const callback = calls[0]?.[0];

      // Trigger the callback
      callback!(lolStatus);

      expect(mockDeviceEmitter.publishState).toHaveBeenCalledWith(lolStatus);
    });

    it("should publish LoL game status when not in game", () => {
      const lolStatus = {
        isInGame: false,
        gameTime: undefined,
        gameMode: undefined,
        mapName: undefined,
        mapNumber: undefined,
        activePlayerName: undefined,
        championName: undefined,
        level: undefined,
        currentGold: undefined,
        score: undefined,
        team: undefined,
      };

      // Get the LoL callback that was set
      const calls = mockLoLStatusReader.setStatusUpdateCallback.mock.calls;
      const callback = calls[0]?.[0];

      // Trigger the callback
      callback!(lolStatus);

      expect(mockDeviceEmitter.publishState).toHaveBeenCalledWith(lolStatus);
    });

    it("should handle MQTT connection errors gracefully", async () => {
      mockMqttFramework.connect.mockRejectedValue(
        new Error("Connection failed")
      );

      try {
        await agent.initialize();
      } catch (error) {
        // Should not throw, but log the error
      }

      expect(mockMqttFramework.connect).toHaveBeenCalled();
    });

    it("should handle MQTT disconnection gracefully", async () => {
      mockMqttFramework.disconnect.mockResolvedValue(undefined);

      await agent.shutdown();

      expect(mockMqttFramework.disconnect).toHaveBeenCalled();
    });

    it("should handle publish errors gracefully", () => {
      const batteryInfo = {
        batteryLevel: 85,
        isCharging: true,
        powerSource: "AC",
        timeRemainingToEmpty: -1,
        timeRemainingToFull: 120,
        cycleCount: 100,
        condition: "Normal",
      };

      // Mock publishState to throw an error
      mockDeviceEmitter.publishState.mockImplementation(() => {
        throw new Error("Publish failed");
      });

      // Get the callback that was set
      const calls = mockBatteryReader.setBatteryUpdateCallback.mock.calls;
      const callback = calls[0]?.[0];

      // The callback itself will throw, but this is expected behavior
      // In a real scenario, the error would be handled by the caller
      expect(() => callback!(batteryInfo)).toThrow("Publish failed");

      // Verify that publishState was called despite the error
      expect(mockDeviceEmitter.publishState).toHaveBeenCalledWith(batteryInfo);
    });

    it("should validate entity configurations have required properties", () => {
      // Check that battery entities have proper structure
      const batteryCall = mockMqttFramework.createDeviceEmitter.mock.calls.find(
        (call: any[]) => call[0] === "battery_status"
      ) as any[] | undefined;
      expect(batteryCall).toBeDefined();

      if (batteryCall && batteryCall.length > 1) {
        const batteryEntities = batteryCall[1] as any[];
        expect(batteryEntities).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: expect.any(String),
              id: expect.any(String),
              config: expect.objectContaining({
                name: expect.any(String),
              }),
            }),
          ])
        );

        // Check that all battery entities have proper types
        const entityTypes = batteryEntities.map((e: any) => e.type);
        expect(entityTypes).toContain("sensor");
        expect(entityTypes).toContain("binary_sensor");
      }
    });
  });
});
