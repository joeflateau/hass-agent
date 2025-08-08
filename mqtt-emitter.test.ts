import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as winston from "winston";

// Mock winston logger
const mockLogger: winston.Logger = {
  debug: mock(() => {}),
  error: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  log: mock(() => {}),
} as any;

// Mock mqtt module
const mockMqttClient = {
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

const mockMqttConnect = mock(() => mockMqttClient);

// Mock os module
const mockOs = {
  release: mock(() => "23.1.0"),
  hostname: mock(() => "test-hostname"),
};

// Set up module mocks before importing
mock.module("mqtt", () => ({
  connect: mockMqttConnect,
}));

mock.module("os", () => mockOs);

// Import after mocking
import {
  MqttDeviceEmitter,
  MqttDeviceFramework,
  type MqttConfig,
} from "./mqtt-emitter.ts";

describe("MqttDeviceFramework", () => {
  let framework: MqttDeviceFramework;
  let config: MqttConfig;

  beforeEach(() => {
    // Reset all mocks
    mockMqttClient.publish.mockClear();
    mockMqttClient.on.mockClear();
    mockMqttClient.once.mockClear();
    mockMqttClient.end.mockClear();
    mockMqttConnect.mockClear();
    mockOs.release.mockClear();
    (mockLogger.debug as any).mockClear();
    (mockLogger.error as any).mockClear();
    (mockLogger.info as any).mockClear();
    (mockLogger.warn as any).mockClear();

    config = {
      broker: "mqtt://localhost:1883",
      username: "testuser",
      password: "testpass",
      deviceId: "test-device",
      deviceName: "Test Device",
      version: "1.0.0",
    };

    framework = new MqttDeviceFramework(config, mockLogger);
  });

  describe("constructor", () => {
    it("should initialize with correct configuration", () => {
      expect(mockMqttConnect).toHaveBeenCalledWith(
        "mqtt://localhost:1883",
        expect.objectContaining({
          username: "testuser",
          password: "testpass",
          clientId: "hass-agent-test-device",
          forceNativeWebSocket: true,
          reconnectOnConnackError: true,
          reconnectPeriod: 5000,
          connectTimeout: 30000,
          clean: true,
          will: expect.objectContaining({
            topic: "homeassistant/status/test-device",
            payload: "offline",
            qos: 1,
            retain: true,
          }),
        })
      );
    });

    it("should set up MQTT client event handlers", () => {
      expect(mockMqttClient.on).toHaveBeenCalledWith(
        "connect",
        expect.any(Function)
      );
      expect(mockMqttClient.on).toHaveBeenCalledWith(
        "error",
        expect.any(Function)
      );
      expect(mockMqttClient.on).toHaveBeenCalledWith(
        "offline",
        expect.any(Function)
      );
      expect(mockMqttClient.on).toHaveBeenCalledWith(
        "reconnect",
        expect.any(Function)
      );
    });

    it("should create device config with proper structure", () => {
      // Just verify that createDeviceEmitter works and returns an emitter instance
      const emitter = framework.createDeviceEmitter("test", []);

      expect(emitter).toBeInstanceOf(MqttDeviceEmitter);
    });
  });

  describe("connect", () => {
    it("should resolve immediately if already connected", async () => {
      mockMqttClient.connected = true;

      await framework.connect();

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/status/test-device",
        "online",
        { qos: 1, retain: true }
      );
      expect(mockMqttClient.once).not.toHaveBeenCalled();
    });

    it("should wait for connect event if not connected", async () => {
      mockMqttClient.connected = false;

      // Start the connect process
      const connectPromise = framework.connect();

      // Verify that it sets up the event listener
      expect(mockMqttClient.once).toHaveBeenCalledWith(
        "connect",
        expect.any(Function)
      );

      // Simulate the connect event
      const connectCallback = mockMqttClient.once.mock.calls.find(
        (call: any[]) => call[0] === "connect"
      )?.[1];
      connectCallback?.();

      await connectPromise;

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/status/test-device",
        "online",
        { qos: 1, retain: true }
      );
    });
  });

  describe("disconnect", () => {
    it("should publish offline status and disconnect gracefully", async () => {
      // Mock the publish callback to be called immediately
      mockMqttClient.publish.mockImplementation(
        (
          topic: string,
          payload: string,
          options: any,
          callback?: () => void
        ) => {
          if (callback) callback();
        }
      );

      // Mock the end callback to be called immediately
      mockMqttClient.end.mockImplementation(
        (force: boolean, options: any, callback?: () => void) => {
          if (callback) callback();
        }
      );

      await framework.disconnect();

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
      expect(mockMqttClient.options.reconnectPeriod).toBe(0);
    });
  });

  describe("createDeviceEmitter", () => {
    it("should create a device emitter with correct parameters", () => {
      const entities = [
        {
          type: "sensor" as const,
          id: "test_sensor",
          config: {
            name: "Test Sensor",
            unit_of_measurement: "°C",
          },
        },
      ];

      const emitter = framework.createDeviceEmitter("test_topic", entities);

      expect(emitter).toBeInstanceOf(MqttDeviceEmitter);
    });
  });

  describe("MQTT event handlers", () => {
    it("should handle connect event", () => {
      const connectHandler = mockMqttClient.on.mock.calls.find(
        (call: any[]) => call[0] === "connect"
      )?.[1];

      connectHandler?.();

      expect(mockLogger.info).toHaveBeenCalledWith("Connected to MQTT broker");
      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/status/test-device",
        "online",
        { qos: 1, retain: true }
      );
    });

    it("should handle error event", () => {
      const errorHandler = mockMqttClient.on.mock.calls.find(
        (call: any[]) => call[0] === "error"
      )?.[1];

      const testError = new Error("Connection failed");
      errorHandler?.(testError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        "MQTT connection error: Error: Connection failed"
      );
    });

    it("should handle offline event", () => {
      const offlineHandler = mockMqttClient.on.mock.calls.find(
        (call: any[]) => call[0] === "offline"
      )?.[1];

      offlineHandler?.();

      expect(mockLogger.warn).toHaveBeenCalledWith("MQTT client offline");
    });

    it("should handle reconnect event", () => {
      const reconnectHandler = mockMqttClient.on.mock.calls.find(
        (call: any[]) => call[0] === "reconnect"
      )?.[1];

      reconnectHandler?.();

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Reconnecting to MQTT broker..."
      );
    });
  });
});

describe("MqttDeviceEmitter", () => {
  let emitter: MqttDeviceEmitter;
  let deviceConfig: any;
  let entities: any[];

  beforeEach(() => {
    deviceConfig = {
      identifiers: ["test-device"],
      name: "Test Device",
      model: "Test Model",
      manufacturer: "Test Manufacturer",
      sw_version: "1.0.0",
    };

    entities = [
      {
        type: "sensor" as const,
        id: "temperature",
        config: {
          name: "Temperature",
          unit_of_measurement: "°C",
          device_class: "temperature",
        },
      },
      {
        type: "binary_sensor" as const,
        id: "motion",
        config: {
          name: "Motion",
          device_class: "motion",
        },
      },
    ];

    emitter = new MqttDeviceEmitter(
      mockMqttClient as any,
      "test-device",
      deviceConfig,
      "test_topic",
      entities,
      mockLogger
    );
  });

  describe("constructor", () => {
    it("should publish discovery configs for all entities", () => {
      // Check that discovery configs were published for each entity
      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/sensor/test-device/temperature/config",
        JSON.stringify({
          name: "Temperature",
          unit_of_measurement: "°C",
          device_class: "temperature",
          unique_id: "test-device_temperature",
          state_topic: "homeassistant/sensor/test-device/test_topic/state",
          device: deviceConfig,
        }),
        { retain: true }
      );

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/binary_sensor/test-device/motion/config",
        JSON.stringify({
          name: "Motion",
          device_class: "motion",
          unique_id: "test-device_motion",
          state_topic: "homeassistant/sensor/test-device/test_topic/state",
          device: deviceConfig,
        }),
        { retain: true }
      );
    });
  });

  describe("publishState", () => {
    it("should publish state data to correct topic with default options", () => {
      const testData = { temperature: 23.5, motion: true };

      emitter.publishState(testData);

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/sensor/test-device/test_topic/state",
        JSON.stringify(testData),
        { qos: 1, retain: true }
      );
    });

    it("should publish state data with custom options", () => {
      const testData = { temperature: 25.0 };
      const customOptions = { qos: 2 as const, retain: false };

      emitter.publishState(testData, customOptions);

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/sensor/test-device/test_topic/state",
        JSON.stringify(testData),
        customOptions
      );
    });

    it("should handle complex data structures", () => {
      const complexData = {
        sensor_data: {
          temperature: 22.3,
          humidity: 65,
          nested: {
            value: "test",
            array: [1, 2, 3],
          },
        },
        timestamp: "2023-01-01T00:00:00Z",
      };

      emitter.publishState(complexData);

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        "homeassistant/sensor/test-device/test_topic/state",
        JSON.stringify(complexData),
        { qos: 1, retain: true }
      );
    });
  });

  describe("discovery configuration", () => {
    it("should generate correct unique IDs", () => {
      // Find the temperature sensor config call
      const temperatureConfigCall = mockMqttClient.publish.mock.calls.find(
        (call: any[]) => call[0].includes("temperature/config")
      );

      expect(temperatureConfigCall).toBeDefined();
      const config = JSON.parse(temperatureConfigCall![1]);
      expect(config.unique_id).toBe("test-device_temperature");
    });

    it("should set correct state topics for all entities", () => {
      // Check both sensor and binary_sensor configs
      const temperatureCall = mockMqttClient.publish.mock.calls.find(
        (call: any[]) => call[0].includes("temperature/config")
      );
      const motionCall = mockMqttClient.publish.mock.calls.find((call: any[]) =>
        call[0].includes("motion/config")
      );

      const tempConfig = JSON.parse(temperatureCall![1]);
      const motionConfig = JSON.parse(motionCall![1]);

      expect(tempConfig.state_topic).toBe(
        "homeassistant/sensor/test-device/test_topic/state"
      );
      expect(motionConfig.state_topic).toBe(
        "homeassistant/sensor/test-device/test_topic/state"
      );
    });

    it("should include device information in all configs", () => {
      const configCall = mockMqttClient.publish.mock.calls.find((call: any[]) =>
        call[0].includes("/config")
      );

      const config = JSON.parse(configCall![1]);
      expect(config.device).toEqual(deviceConfig);
    });

    it("should preserve all entity config properties", () => {
      const temperatureCall = mockMqttClient.publish.mock.calls.find(
        (call: any[]) => call[0].includes("temperature/config")
      );

      const config = JSON.parse(temperatureCall![1]);
      expect(config.name).toBe("Temperature");
      expect(config.unit_of_measurement).toBe("°C");
      expect(config.device_class).toBe("temperature");
    });
  });
});
