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

      // Time Remaining to Empty (when discharging)
      this.client.publish(
        `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/time_remaining_to_empty/state`,
        JSON.stringify({
          time_remaining_to_empty: batteryInfo.timeRemainingToEmpty,
        })
      );

      // Time Remaining to Full (when charging)
      this.client.publish(
        `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/time_remaining_to_full/state`,
        JSON.stringify({
          time_remaining_to_full: batteryInfo.timeRemainingToFull,
        })
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

  public publishLoLGameStatus(lolStatus: LoLGameStatus): void {
    try {
      this.logger.debug(
        `Publishing LoL status: ${JSON.stringify(lolStatus, null, 2)}`
      );

      // Publish in-game status
      this.client.publish(
        `${DISCOVERY_PREFIX}/binary_sensor/${this.deviceId}/lol_in_game/state`,
        lolStatus.isInGame ? "ON" : "OFF",
        { qos: 1, retain: true }
      );

      // Helper function to publish LoL sensor data
      const publishLoLSensor = (
        sensor: string,
        value: string | number | null | undefined
      ) => {
        this.client.publish(
          `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_${sensor}/state`,
          value?.toString() ?? "null",
          { qos: 1, retain: true }
        );
      };

      // Always publish all sensor data - values will be null when not in game
      publishLoLSensor("game_mode", lolStatus.gameMode);
      publishLoLSensor(
        "game_time",
        lolStatus.gameTime ? Math.round(lolStatus.gameTime) : null
      );

      if (lolStatus.championName) {
        this.logger.debug(
          `Publishing champion name: ${lolStatus.championName}`
        );
      }
      publishLoLSensor("champion", lolStatus.championName);

      publishLoLSensor("level", lolStatus.level);
      publishLoLSensor("gold", lolStatus.currentGold);
      publishLoLSensor("kills", lolStatus.score?.kills);
      publishLoLSensor("deaths", lolStatus.score?.deaths);
      publishLoLSensor("assists", lolStatus.score?.assists);

      // Publish detailed game info as JSON
      publishLoLSensor(
        "game_info",
        JSON.stringify({
          gameTime: lolStatus.gameTime,
          gameMode: lolStatus.gameMode,
          mapName: lolStatus.mapName,
          mapId: lolStatus.mapId,
          activePlayerName: lolStatus.activePlayerName,
          championName: lolStatus.championName,
          level: lolStatus.level,
          currentGold: lolStatus.currentGold,
          score: lolStatus.score,
          team: lolStatus.team,
        })
      );
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

    // Battery Time Remaining to Empty Sensor
    const timeRemainingToEmptyConfig = {
      name: "Battery Time Remaining to Empty",
      unique_id: `${this.deviceId}_time_remaining_to_empty`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/time_remaining_to_empty/state`,
      unit_of_measurement: "min",
      value_template: "{{ value_json.time_remaining_to_empty }}",
      icon: "mdi:battery-clock",
      entity_category: "diagnostic",
      enabled_by_default: true,
      device: deviceConfig,
    };

    // Battery Time Remaining to Full Sensor
    const timeRemainingToFullConfig = {
      name: "Battery Time Remaining to Full",
      unique_id: `${this.deviceId}_time_remaining_to_full`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/time_remaining_to_full/state`,
      unit_of_measurement: "min",
      value_template: "{{ value_json.time_remaining_to_full }}",
      icon: "mdi:battery-charging",
      entity_category: "diagnostic",
      enabled_by_default: true,
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

    // League of Legends Sensors
    const lolInGameConfig = {
      name: "LoL In Game",
      unique_id: `${this.deviceId}_lol_in_game`,
      state_topic: `${DISCOVERY_PREFIX}/binary_sensor/${this.deviceId}/lol_in_game/state`,
      device_class: "connectivity",
      payload_on: "ON",
      payload_off: "OFF",
      icon: "mdi:gamepad-variant",
      device: deviceConfig,
    };

    const lolGameModeConfig = {
      name: "LoL Game Mode",
      unique_id: `${this.deviceId}_lol_game_mode`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_game_mode/state`,
      icon: "mdi:gamepad-variant",
      device: deviceConfig,
    };

    const lolGameTimeConfig = {
      name: "LoL Game Time",
      unique_id: `${this.deviceId}_lol_game_time`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_game_time/state`,
      unit_of_measurement: "seconds",
      icon: "mdi:timer-outline",
      device: deviceConfig,
    };

    const lolChampionConfig = {
      name: "LoL Champion",
      unique_id: `${this.deviceId}_lol_champion`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_champion/state`,
      icon: "mdi:account-warrior",
      device: deviceConfig,
    };

    const lolLevelConfig = {
      name: "LoL Level",
      unique_id: `${this.deviceId}_lol_level`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_level/state`,
      icon: "mdi:trophy",
      device: deviceConfig,
    };

    const lolGoldConfig = {
      name: "LoL Gold",
      unique_id: `${this.deviceId}_lol_gold`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_gold/state`,
      unit_of_measurement: "gold",
      state_class: "measurement",
      icon: "mdi:currency-usd",
      device: deviceConfig,
    };

    const lolKillsConfig = {
      name: "LoL Kills",
      unique_id: `${this.deviceId}_lol_kills`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_kills/state`,
      icon: "mdi:sword",
      device: deviceConfig,
    };

    const lolDeathsConfig = {
      name: "LoL Deaths",
      unique_id: `${this.deviceId}_lol_deaths`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_deaths/state`,
      icon: "mdi:skull",
      device: deviceConfig,
    };

    const lolAssistsConfig = {
      name: "LoL Assists",
      unique_id: `${this.deviceId}_lol_assists`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_assists/state`,
      icon: "mdi:account-multiple",
      device: deviceConfig,
    };

    const lolGameInfoConfig = {
      name: "LoL Game Info",
      unique_id: `${this.deviceId}_lol_game_info`,
      state_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_game_info/state`,
      value_template: "{{ value_json.gameMode }}",
      json_attributes_topic: `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_game_info/state`,
      icon: "mdi:information",
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
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/time_remaining_to_empty/config`,
      JSON.stringify(timeRemainingToEmptyConfig),
      { retain: true }
    );
    this.client.publish(
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/time_remaining_to_full/config`,
      JSON.stringify(timeRemainingToFullConfig),
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

    // Publish LoL discovery configs
    this.client.publish(
      `${DISCOVERY_PREFIX}/binary_sensor/${this.deviceId}/lol_in_game/config`,
      JSON.stringify(lolInGameConfig),
      { retain: true }
    );
    this.client.publish(
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_game_mode/config`,
      JSON.stringify(lolGameModeConfig),
      { retain: true }
    );
    this.client.publish(
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_game_time/config`,
      JSON.stringify(lolGameTimeConfig),
      { retain: true }
    );
    this.client.publish(
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_champion/config`,
      JSON.stringify(lolChampionConfig),
      { retain: true }
    );
    this.client.publish(
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_level/config`,
      JSON.stringify(lolLevelConfig),
      { retain: true }
    );
    this.client.publish(
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_gold/config`,
      JSON.stringify(lolGoldConfig),
      { retain: true }
    );
    this.client.publish(
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_kills/config`,
      JSON.stringify(lolKillsConfig),
      { retain: true }
    );
    this.client.publish(
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_deaths/config`,
      JSON.stringify(lolDeathsConfig),
      { retain: true }
    );
    this.client.publish(
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_assists/config`,
      JSON.stringify(lolAssistsConfig),
      { retain: true }
    );
    this.client.publish(
      `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/lol_game_info/config`,
      JSON.stringify(lolGameInfoConfig),
      { retain: true }
    );

    this.logger.info("Published Home Assistant discovery configurations");
  }
}
