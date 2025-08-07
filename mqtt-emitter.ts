import * as mqtt from "mqtt";
import * as winston from "winston";
import { type BatteryInfo } from "./battery-parser.ts";
import { type UptimeInfo } from "./battery-status-reader.ts";
import { type DisplayInfo } from "./display-status-reader.ts";
import { type LoLGameStatus } from "./lol-status-reader.ts";

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

  private publishState(
    entityId: string,
    data: any,
    options: mqtt.IClientPublishOptions = { qos: 1, retain: true }
  ): void {
    const topic = `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/${entityId}/state`;
    this.client.publish(topic, JSON.stringify(data), options);
  }

  private publishDiscoveryConfig(
    entityType: string,
    entityId: string,
    config: any
  ): void {
    this.client.publish(
      `${DISCOVERY_PREFIX}/${entityType}/${this.deviceId}/${entityId}/config`,
      JSON.stringify(config),
      { retain: true }
    );
  }
  public publishBatteryData(batteryInfo: BatteryInfo): void {
    try {
      // Publish all battery data to a single topic - sensors will extract values using value_template
      this.publishState("battery_status", {
        battery_level: batteryInfo.batteryLevel,
        is_charging: batteryInfo.isCharging ? "ON" : "OFF",
        time_remaining_to_empty: batteryInfo.timeRemainingToEmpty,
        time_remaining_to_full: batteryInfo.timeRemainingToFull,
        ac_power: batteryInfo.powerSource === "AC" ? "ON" : "OFF",
        power_source: batteryInfo.powerSource,
        cycle_count: batteryInfo.cycleCount,
        condition: batteryInfo.condition,
      });
    } catch (error) {
      this.logger.error(`Error publishing battery data: ${error}`);
    }
  }

  public publishUptimeData(uptimeInfo: UptimeInfo): void {
    try {
      this.publishState("uptime", { uptime: uptimeInfo.uptimeMinutes });
    } catch (error) {
      this.logger.error(`Error publishing uptime data: ${error}`);
    }
  }

  public publishDisplayData(
    displayInfo: DisplayInfo,
    detailedDisplayInfo: any[]
  ): void {
    try {
      // Publish all display data to a single topic - sensors will extract values using value_template
      this.publishState("display_status", {
        status: displayInfo.status,
        external_display_count: displayInfo.externalDisplayCount,
        builtin_display_online: displayInfo.builtinDisplayOnline ? "ON" : "OFF",
        total_displays: detailedDisplayInfo.length,
        displays: detailedDisplayInfo,
        summary: {
          external_count: displayInfo.externalDisplayCount,
          builtin_online: displayInfo.builtinDisplayOnline,
          status: displayInfo.status,
        },
      });
    } catch (error) {
      this.logger.error(`Error publishing display data: ${error}`);
    }
  }

  public publishLoLGameStatus(lolStatus: LoLGameStatus): void {
    try {
      this.logger.debug(
        `Publishing LoL status: ${JSON.stringify(lolStatus, null, 2)}`
      );

      // Publish all LoL data to a single topic - sensors will extract values using value_template
      this.publishState("lol_status", {
        isInGame: lolStatus.isInGame,
        gameTime: lolStatus.gameTime ? Math.round(lolStatus.gameTime) : null,
        gameMode: lolStatus.gameMode,
        mapName: lolStatus.mapName,
        mapId: lolStatus.mapId,
        activePlayerName: lolStatus.activePlayerName,
        championName: lolStatus.championName,
        level: lolStatus.level,
        currentGold: lolStatus.currentGold,
        score: lolStatus.score || { kills: null, deaths: null, assists: null },
        team: lolStatus.team,
        summonerSpells: lolStatus.summonerSpells || null,
        items: lolStatus.items || [],
      });
    } catch (error) {
      this.logger.error(`Error publishing LoL game status: ${error}`);
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

    // Battery Sensors - All use single topic with value_template for efficiency
    const batteryStatusTopic = `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/battery_status/state`;

    // Publish battery discovery configs
    this.publishDiscoveryConfig("sensor", "battery_level", {
      name: "Battery Level",
      unique_id: `${this.deviceId}_battery_level`,
      state_topic: batteryStatusTopic,
      device_class: "battery",
      unit_of_measurement: "%",
      value_template: "{{ value_json.battery_level }}",
      device: deviceConfig,
    });

    this.publishDiscoveryConfig("binary_sensor", "battery_charging", {
      name: "Battery Charging",
      unique_id: `${this.deviceId}_battery_charging`,
      state_topic: batteryStatusTopic,
      device_class: "battery_charging",
      value_template: "{{ value_json.is_charging }}",
      device: deviceConfig,
    });

    this.publishDiscoveryConfig("binary_sensor", "ac_power", {
      name: "AC Power",
      unique_id: `${this.deviceId}_ac_power`,
      state_topic: batteryStatusTopic,
      device_class: "plug",
      value_template: "{{ value_json.ac_power }}",
      device: deviceConfig,
    });

    this.publishDiscoveryConfig("sensor", "time_remaining_to_empty", {
      name: "Battery Time Remaining to Empty",
      unique_id: `${this.deviceId}_time_remaining_to_empty`,
      state_topic: batteryStatusTopic,
      unit_of_measurement: "min",
      value_template: "{{ value_json.time_remaining_to_empty }}",
      icon: "mdi:battery-clock",
      entity_category: "diagnostic",
      enabled_by_default: true,
      device: deviceConfig,
    });

    this.publishDiscoveryConfig("sensor", "time_remaining_to_full", {
      name: "Battery Time Remaining to Full",
      unique_id: `${this.deviceId}_time_remaining_to_full`,
      state_topic: batteryStatusTopic,
      unit_of_measurement: "min",
      value_template: "{{ value_json.time_remaining_to_full }}",
      icon: "mdi:battery-charging",
      entity_category: "diagnostic",
      enabled_by_default: true,
      device: deviceConfig,
    });

    // Uptime Sensor
    this.publishDiscoveryConfig("sensor", "uptime", {
      name: "System Uptime",
      unique_id: `${this.deviceId}_uptime`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/uptime/state`,
      unit_of_measurement: "min",
      value_template: "{{ value_json.uptime }}",
      device: deviceConfig,
    });

    // Display Sensors - All use single topic with value_template for efficiency
    const displayStatusTopic = `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/display_status/state`;

    this.publishDiscoveryConfig("sensor", "display_status", {
      name: "Display Status",
      unique_id: `${this.deviceId}_display_status`,
      state_topic: displayStatusTopic,
      value_template: "{{ value_json.status }}",
      device: deviceConfig,
    });

    this.publishDiscoveryConfig("sensor", "external_display_count", {
      name: "External Display Count",
      unique_id: `${this.deviceId}_external_display_count`,
      state_topic: displayStatusTopic,
      unit_of_measurement: "displays",
      value_template: "{{ value_json.external_display_count }}",
      device: deviceConfig,
    });

    this.publishDiscoveryConfig("binary_sensor", "builtin_display_online", {
      name: "Built-in Display Online",
      unique_id: `${this.deviceId}_builtin_display_online`,
      state_topic: displayStatusTopic,
      device_class: "connectivity",
      value_template: "{{ value_json.builtin_display_online }}",
      device: deviceConfig,
    });

    this.publishDiscoveryConfig("sensor", "display_info", {
      name: "Display Information",
      unique_id: `${this.deviceId}_display_info`,
      state_topic: displayStatusTopic,
      unit_of_measurement: "displays",
      value_template: "{{ value_json.total_displays }}",
      json_attributes_topic: displayStatusTopic,
      device: deviceConfig,
    });

    // League of Legends Sensors - All use single topic with value_template for efficiency
    const lolStatusTopic = `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_status/state`;

    this.publishDiscoveryConfig("binary_sensor", "lol_in_game", {
      name: "LoL In Game",
      unique_id: `${this.deviceId}_lol_in_game`,
      state_topic: lolStatusTopic,
      device_class: "connectivity",
      value_template: "{{ 'ON' if value_json.isInGame else 'OFF' }}",
      icon: "mdi:gamepad-variant",
      device: deviceConfig,
    });

    this.publishDiscoveryConfig("sensor", "lol_game_mode", {
      name: "LoL Game Mode",
      unique_id: `${this.deviceId}_lol_game_mode`,
      state_topic: lolStatusTopic,
      value_template: "{{ value_json.gameMode | default('unavailable') }}",
      icon: "mdi:gamepad-variant",
      device: deviceConfig,
    });

    this.publishDiscoveryConfig("sensor", "lol_game_time", {
      name: "LoL Game Time",
      unique_id: `${this.deviceId}_lol_game_time`,
      state_topic: lolStatusTopic,
      unit_of_measurement: "seconds",
      value_template: "{{ value_json.gameTime | default('unavailable') }}",
      icon: "mdi:timer-outline",
      device: deviceConfig,
    });

    this.publishDiscoveryConfig("sensor", "lol_champion", {
      name: "LoL Champion",
      unique_id: `${this.deviceId}_lol_champion`,
      state_topic: lolStatusTopic,
      value_template: "{{ value_json.championName | default('unavailable') }}",
      icon: "mdi:account-warrior",
      device: deviceConfig,
    });

    this.publishDiscoveryConfig("sensor", "lol_level", {
      name: "LoL Level",
      unique_id: `${this.deviceId}_lol_level`,
      state_topic: lolStatusTopic,
      unit_of_measurement: "level",
      value_template: "{{ value_json.level | default('unavailable') }}",
      icon: "mdi:trophy",
      device: deviceConfig,
    });

    this.publishDiscoveryConfig("sensor", "lol_gold", {
      name: "LoL Gold",
      unique_id: `${this.deviceId}_lol_gold`,
      state_topic: lolStatusTopic,
      unit_of_measurement: "gold",
      state_class: "measurement",
      value_template: "{{ (value_json.currentGold | default(0)) | floor }}",
      icon: "mdi:currency-usd",
      device: deviceConfig,
    });

    this.publishDiscoveryConfig("sensor", "lol_kills", {
      name: "LoL Kills",
      unique_id: `${this.deviceId}_lol_kills`,
      state_topic: lolStatusTopic,
      unit_of_measurement: "kills",
      value_template: "{{ value_json.score.kills | default('unavailable') }}",
      icon: "mdi:sword",
      device: deviceConfig,
    });

    this.publishDiscoveryConfig("sensor", "lol_deaths", {
      name: "LoL Deaths",
      unique_id: `${this.deviceId}_lol_deaths`,
      state_topic: lolStatusTopic,
      unit_of_measurement: "deaths",
      value_template: "{{ value_json.score.deaths | default('unavailable') }}",
      icon: "mdi:skull",
      device: deviceConfig,
    });

    this.publishDiscoveryConfig("sensor", "lol_assists", {
      name: "LoL Assists",
      unique_id: `${this.deviceId}_lol_assists`,
      state_topic: lolStatusTopic,
      unit_of_measurement: "assists",
      value_template: "{{ value_json.score.assists | default('unavailable') }}",
      icon: "mdi:account-multiple",
      device: deviceConfig,
    });

    this.publishDiscoveryConfig("sensor", "lol_game_info", {
      name: "LoL Game Info",
      unique_id: `${this.deviceId}_lol_game_info`,
      state_topic: lolStatusTopic,
      value_template: "{{ value_json.gameMode | default('unavailable') }}",
      json_attributes_topic: lolStatusTopic,
      icon: "mdi:information",
      device: deviceConfig,
    });

    this.logger.info("Published Home Assistant discovery configurations");
  }
}
