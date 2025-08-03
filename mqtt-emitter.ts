import * as mqtt from "mqtt";
import * as winston from "winston";
import { type BatteryInfo } from "./battery-parser.ts";
import { type UptimeInfo } from "./battery-status-reader.ts";
import { type DisplayInfo } from "./display-status-reader.ts";

export interface MqttConfig {
  broker: string;
  username?: string;
  password?: string;
  deviceId: string;
  deviceName: string;
  version: string;
}

// Home Assistant MQTT Discovery topics
const DISCOVERY_PREFIX = "homeassistant";

export class MqttEmitter {
  private logger: winston.Logger;
  private config: MqttConfig;
  private client: mqtt.MqttClient;
  private deviceId: string;

  constructor(config: MqttConfig, logger: winston.Logger) {
    this.config = config;
    this.logger = logger;
    this.deviceId = this.config.deviceId;

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

  public async connect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.client.connected) {
        this.publishDiscoveryConfigs();
        resolve();
      } else {
        this.client.once("connect", () => {
          this.publishDiscoveryConfigs();
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
      this.client.options.reconnectPeriod = 0;
      
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

  public publishBatteryData(batteryInfo: BatteryInfo): void {
    try {
      // Battery Level
      this.client.publish(
        `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/battery_level/state`,
        JSON.stringify({ battery_level: batteryInfo.batteryLevel })
      );

      // Battery Charging
      this.client.publish(
        `${DISCOVERY_PREFIX}/binary_sensor/${this.deviceId}/battery_charging/state`,
        JSON.stringify({ is_charging: batteryInfo.isCharging ? "ON" : "OFF" })
      );

      // Time Remaining
      this.client.publish(
        `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/time_remaining/state`,
        JSON.stringify({ time_remaining: batteryInfo.timeRemaining })
      );

      // AC Power (derived from power source)
      this.client.publish(
        `${DISCOVERY_PREFIX}/binary_sensor/${this.deviceId}/ac_power/state`,
        JSON.stringify({
          ac_power: batteryInfo.powerSource === "AC" ? "ON" : "OFF",
        })
      );
    } catch (error) {
      this.logger.error(`Error publishing battery data: ${error}`);
    }
  }

  public publishUptimeData(uptimeInfo: UptimeInfo): void {
    try {
      this.client.publish(
        `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/uptime/state`,
        JSON.stringify({ uptime: uptimeInfo.uptimeMinutes })
      );
    } catch (error) {
      this.logger.error(`Error publishing uptime data: ${error}`);
    }
  }

  public publishDisplayData(
    displayInfo: DisplayInfo,
    detailedDisplayInfo: any[]
  ): void {
    try {
      // Display Status
      this.client.publish(
        `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/display_status/state`,
        JSON.stringify({ status: displayInfo.status })
      );

      // External Display Count
      this.client.publish(
        `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/external_display_count/state`,
        JSON.stringify({
          external_display_count: displayInfo.externalDisplayCount,
        })
      );

      // Built-in Display Online
      this.client.publish(
        `${DISCOVERY_PREFIX}/binary_sensor/${this.deviceId}/builtin_display_online/state`,
        JSON.stringify({
          builtin_display_online: displayInfo.builtinDisplayOnline
            ? "ON"
            : "OFF",
        })
      );

      // Detailed Display Information
      this.client.publish(
        `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/display_info/state`,
        JSON.stringify({
          total_displays: detailedDisplayInfo.length,
          displays: detailedDisplayInfo,
          summary: {
            external_count: displayInfo.externalDisplayCount,
            builtin_online: displayInfo.builtinDisplayOnline,
            status: displayInfo.status,
          },
        })
      );
    } catch (error) {
      this.logger.error(`Error publishing display data: ${error}`);
    }
  }

  private setupMqttClient(): void {
    this.client.on("connect", () => {
      this.logger.info("Connected to MQTT broker");
      this.publishDiscoveryConfigs();
      // Publish online status after discovery configs
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

  private publishDiscoveryConfigs(): void {
    const deviceConfig = {
      identifiers: [this.deviceId],
      name: this.config.deviceName,
      model: "macOS System Monitor",
      manufacturer: "Apple",
      sw_version: `${this.config.version} (macOS ${require("os").release()})`,
    };

    // Battery Level Sensor
    const batteryLevelConfig = {
      name: "Battery Level",
      unique_id: `${this.deviceId}_battery_level`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/battery_level/state`,
      device_class: "battery",
      unit_of_measurement: "%",
      value_template: "{{ value_json.battery_level }}",
      device: deviceConfig,
    };

    // Battery Charging Sensor
    const batteryChargingConfig = {
      name: "Battery Charging",
      unique_id: `${this.deviceId}_battery_charging`,
      state_topic: `${DISCOVERY_PREFIX}/binary_sensor/${this.deviceId}/battery_charging/state`,
      device_class: "battery_charging",
      payload_on: "ON",
      payload_off: "OFF",
      value_template: "{{ value_json.is_charging }}",
      device: deviceConfig,
    };

    // AC Power Sensor
    const acPowerConfig = {
      name: "AC Power",
      unique_id: `${this.deviceId}_ac_power`,
      state_topic: `${DISCOVERY_PREFIX}/binary_sensor/${this.deviceId}/ac_power/state`,
      device_class: "plug",
      payload_on: "ON",
      payload_off: "OFF",
      value_template: "{{ value_json.ac_power }}",
      device: deviceConfig,
    };

    // Battery Time Remaining Sensor
    const timeRemainingConfig = {
      name: "Battery Time Remaining",
      unique_id: `${this.deviceId}_time_remaining`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/time_remaining/state`,
      unit_of_measurement: "min",
      value_template: "{{ value_json.time_remaining }}",
      device: deviceConfig,
    };

    // Uptime Sensor
    const uptimeConfig = {
      name: "System Uptime",
      unique_id: `${this.deviceId}_uptime`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/uptime/state`,
      unit_of_measurement: "min",
      value_template: "{{ value_json.uptime }}",
      device: deviceConfig,
    };

    // Display Status Sensor
    const displayStatusConfig = {
      name: "Display Status",
      unique_id: `${this.deviceId}_display_status`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/display_status/state`,
      value_template: "{{ value_json.status }}",
      device: deviceConfig,
    };

    // External Display Count Sensor
    const externalDisplayCountConfig = {
      name: "External Display Count",
      unique_id: `${this.deviceId}_external_display_count`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/external_display_count/state`,
      value_template: "{{ value_json.external_display_count }}",
      device: deviceConfig,
    };

    // Built-in Display Online Sensor
    const builtinDisplayOnlineConfig = {
      name: "Built-in Display Online",
      unique_id: `${this.deviceId}_builtin_display_online`,
      state_topic: `${DISCOVERY_PREFIX}/binary_sensor/${this.deviceId}/builtin_display_online/state`,
      device_class: "connectivity",
      payload_on: "ON",
      payload_off: "OFF",
      value_template: "{{ value_json.builtin_display_online }}",
      device: deviceConfig,
    };

    // Display Information Sensor (JSON attributes)
    const displayInfoConfig = {
      name: "Display Information",
      unique_id: `${this.deviceId}_display_info`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/display_info/state`,
      value_template: "{{ value_json.total_displays }}",
      json_attributes_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/display_info/state`,
      device: deviceConfig,
    };

    // Publish discovery configs
    this.client.publish(
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/battery_level/config`,
      JSON.stringify(batteryLevelConfig),
      { retain: true }
    );
    this.client.publish(
      `${DISCOVERY_PREFIX}/binary_sensor/${this.deviceId}/battery_charging/config`,
      JSON.stringify(batteryChargingConfig),
      { retain: true }
    );
    this.client.publish(
      `${DISCOVERY_PREFIX}/binary_sensor/${this.deviceId}/ac_power/config`,
      JSON.stringify(acPowerConfig),
      { retain: true }
    );
    this.client.publish(
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/time_remaining/config`,
      JSON.stringify(timeRemainingConfig),
      { retain: true }
    );

    this.client.publish(
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/uptime/config`,
      JSON.stringify(uptimeConfig),
      { retain: true }
    );

    this.client.publish(
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/display_status/config`,
      JSON.stringify(displayStatusConfig),
      { retain: true }
    );
    this.client.publish(
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/external_display_count/config`,
      JSON.stringify(externalDisplayCountConfig),
      { retain: true }
    );
    this.client.publish(
      `${DISCOVERY_PREFIX}/binary_sensor/${this.deviceId}/builtin_display_online/config`,
      JSON.stringify(builtinDisplayOnlineConfig),
      { retain: true }
    );

    this.client.publish(
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/display_info/config`,
      JSON.stringify(displayInfoConfig),
      { retain: true }
    );

    this.logger.info("Published Home Assistant discovery configurations");
  }
}
