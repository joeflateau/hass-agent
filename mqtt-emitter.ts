import * as mqtt from "mqtt";
import * as winston from "winston";

export interface MqttConfig {
  broker: string;
  username?: string;
  password?: string;
  deviceId: string;
  deviceName: string;
  version: string;
}

export interface DeviceConfig {
  identifiers: string[];
  name: string;
  model: string;
  manufacturer: string;
  sw_version: string;
}

export interface EntityConfig {
  name: string;
  unique_id: string;
  state_topic: string;
  device_class?: string;
  unit_of_measurement?: string;
  value_template?: string;
  state_class?: string;
  icon?: string;
  entity_category?: string;
  enabled_by_default?: boolean;
  json_attributes_topic?: string;
  device: DeviceConfig;
}

// Home Assistant MQTT Discovery topics
const DISCOVERY_PREFIX = "homeassistant";

export class MqttDeviceFramework {
  private logger: winston.Logger;
  private config: MqttConfig;
  private client: mqtt.MqttClient;
  private deviceId: string;
  private deviceConfig: DeviceConfig;

  constructor(config: MqttConfig, logger: winston.Logger) {
    this.config = config;
    this.logger = logger;
    this.deviceId = this.config.deviceId;

    this.deviceConfig = {
      identifiers: [this.deviceId],
      name: this.config.deviceName,
      model: "macOS System Monitor",
      manufacturer: "Apple",
      sw_version: `${this.config.version} (macOS ${require("os").release()})`,
    };

    this.client = mqtt.connect(this.config.broker, {
      username: this.config.username,
      password: this.config.password,
      clientId: `hass-agent-${this.deviceId}`,
      forceNativeWebSocket: true,
      reconnectOnConnackError: true,
      reconnectPeriod: 5000,
      connectTimeout: 30000,
      clean: true,
      will: {
        topic: `${DISCOVERY_PREFIX}/status/${this.deviceId}`,
        payload: "offline",
        qos: 1,
        retain: true,
      },
    });

    this.setupMqttClient();
  }

  public createDeviceEmitter(
    topicId: string,
    entities: Array<{
      type: "sensor" | "binary_sensor";
      id: string;
      config: Omit<EntityConfig, "device" | "unique_id" | "state_topic">;
    }>
  ): MqttDeviceEmitter {
    return new MqttDeviceEmitter(
      this.client,
      this.deviceId,
      this.deviceConfig,
      topicId,
      entities,
      this.logger
    );
  }

  public async connect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.client.connected) {
        // Publish online status
        this.client.publish(
          `${DISCOVERY_PREFIX}/status/${this.deviceId}`,
          "online",
          { qos: 1, retain: true }
        );
        resolve();
      } else {
        this.client.once("connect", () => {
          // Publish online status after connection
          this.client.publish(
            `${DISCOVERY_PREFIX}/status/${this.deviceId}`,
            "online",
            { qos: 1, retain: true }
          );
          resolve();
        });
      }
    });
  }

  public async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      // Set a timeout to prevent hanging
      const timeout = setTimeout(() => {
        this.logger.warn("MQTT disconnect timeout, forcing close");
        resolve();
      }, 5000); // 5 second timeout

      // Disable auto-reconnect to prevent reconnection during shutdown
      if (this.client.options) {
        this.client.options.reconnectPeriod = 0;
      }

      // Publish offline status before disconnecting
      this.client.publish(
        `${DISCOVERY_PREFIX}/status/${this.deviceId}`,
        "offline",
        { qos: 1, retain: true },
        () => {
          this.client.end(true, {}, () => {
            clearTimeout(timeout);
            this.logger.info("MQTT client disconnected");
            resolve();
          });
        }
      );
    });
  }

  private setupMqttClient(): void {
    this.client.on("connect", () => {
      this.logger.info("Connected to MQTT broker");
      // Publish online status
      this.client.publish(
        `${DISCOVERY_PREFIX}/status/${this.deviceId}`,
        "online",
        { qos: 1, retain: true }
      );
    });

    this.client.on("error", (error) => {
      this.logger.error(`MQTT connection error: ${error}`);
    });

    this.client.on("offline", () => {
      this.logger.warn("MQTT client offline");
    });

    this.client.on("reconnect", () => {
      this.logger.info("Reconnecting to MQTT broker...");
    });
  }
}

export class MqttDeviceEmitter {
  private client: mqtt.MqttClient;
  private deviceId: string;
  private deviceConfig: DeviceConfig;
  private topicId: string;
  private entities: Array<{
    type: "sensor" | "binary_sensor";
    id: string;
    config: Omit<EntityConfig, "device" | "unique_id" | "state_topic">;
  }>;
  private logger: winston.Logger;
  private stateTopic: string;

  constructor(
    client: mqtt.MqttClient,
    deviceId: string,
    deviceConfig: DeviceConfig,
    topicId: string,
    entities: Array<{
      type: "sensor" | "binary_sensor";
      id: string;
      config: Omit<EntityConfig, "device" | "unique_id" | "state_topic">;
    }>,
    logger: winston.Logger
  ) {
    this.client = client;
    this.deviceId = deviceId;
    this.deviceConfig = deviceConfig;
    this.topicId = topicId;
    this.entities = entities;
    this.logger = logger;
    this.stateTopic = `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/${this.topicId}/state`;

    // Publish discovery configurations for all entities
    this.publishDiscoveryConfigs();
  }

  public publishState(
    data: any,
    options: mqtt.IClientPublishOptions = { qos: 1, retain: true }
  ): void {
    this.client.publish(this.stateTopic, JSON.stringify(data), options);
  }

  private publishDiscoveryConfigs(): void {
    for (const entity of this.entities) {
      const config: EntityConfig = {
        ...entity.config,
        unique_id: `${this.deviceId}_${entity.id}`,
        state_topic: this.stateTopic,
        device: this.deviceConfig,
      };

      this.client.publish(
        `${DISCOVERY_PREFIX}/${entity.type}/${this.deviceId}/${entity.id}/config`,
        JSON.stringify(config),
        { retain: true }
      );
    }
  }
}
