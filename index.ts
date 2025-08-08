#!/usr/bin/env bun

/**
 * Main Application Entry Point
 *
 * Orchestrates the Home Assistant Agent for macOS, coordinating multiple status readers
 * (battery, display, League of Legends) and publishing their data to Home Assistant via MQTT.
 * Handles configuration validation, graceful shutdown, and optional auto-updates.
 */

import { hostname } from "os";
import * as winston from "winston";
import { z } from "zod";
import { AutoUpdater, type AutoUpdaterConfig } from "./auto-updater.ts";
import { BatteryStatusReader } from "./battery-status-reader.ts";
import { DisplayStatusReader } from "./display-status-reader.ts";
import { LoLStatusReader } from "./lol-status-reader.ts";
import {
  MqttDeviceFramework,
  type MqttConfig,
  type MqttDeviceEmitter,
} from "./mqtt-emitter.ts";

const syncEnvSchema = z.object({
  LOG_LEVEL: z.string().default("info"),
});

const syncEnv = syncEnvSchema.parse(process.env);

// Configure Winston logger with timestamps
const logger = winston.createLogger({
  level: syncEnv.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({
      format: "YYYY-MM-DD HH:mm:ss",
    }),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      let logMessage = `${timestamp} [${level}] ${message}`;

      // If there are additional metadata objects, stringify and append them
      const metaKeys = Object.keys(meta);
      if (metaKeys.length > 0) {
        const metaString = JSON.stringify(meta, null, 2);
        logMessage += `\n${metaString}`;
      }

      return logMessage;
    })
  ),
  transports: [new winston.transports.Console()],
});

// Helper function to get macOS computer name
async function getComputerName(): Promise<string> {
  try {
    const { spawn } = await import("child_process");
    return new Promise((resolve, reject) => {
      const child = spawn("scutil", ["--get", "ComputerName"]);
      let output = "";

      child.stdout.on("data", (data) => {
        output += data.toString();
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          // Fallback to hostname if computer name fails
          resolve(hostname());
        }
      });

      child.on("error", () => {
        // Fallback to hostname if command fails
        resolve(hostname());
      });
    });
  } catch {
    return hostname();
  }
}

// Environment variable schema
const envSchema = z.object({
  MQTT_BROKER: z.string().url().default("mqtt://localhost:1883"),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  DEVICE_ID: z.string().min(1, "DEVICE_ID is required"),
  DEVICE_NAME: z.string().default(""),
  UPDATE_INTERVAL: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(() => 30000),
  AUTO_UPGRADE: z
    .string()
    .transform((val) => val.toLowerCase() === "true")
    .default(() => true),
  UPGRADE_CHECK_INTERVAL: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(() => 3 * 60 * 60 * 1000), // 3 hours in milliseconds
  INSTALL_SCRIPT_URL: z
    .string()
    .default(
      "https://github.com/joeflateau/hass-agent/releases/latest/download/install.sh"
    ),
  VERSION: z
    .string()
    .default(() => (typeof VERSION !== "undefined" ? VERSION : "development")),
});

// Build-time version constant (will be replaced by bun build)
declare const VERSION: string;

class MacOSPowerAgent {
  private config: z.infer<typeof envSchema>;
  private logger: winston.Logger;
  private periodicTimer?: NodeJS.Timeout;
  private displayReader: DisplayStatusReader;
  private batteryReader: BatteryStatusReader;
  private lolStatusReader: LoLStatusReader;
  private mqttFramework: MqttDeviceFramework;
  private batteryEmitter: MqttDeviceEmitter;
  private uptimeEmitter: MqttDeviceEmitter;
  private displayEmitter: MqttDeviceEmitter;
  private lolEmitter: MqttDeviceEmitter;
  private autoUpdater: AutoUpdater;
  private isShuttingDown = false;

  constructor(config: z.infer<typeof envSchema>, logger: winston.Logger) {
    this.config = config;
    this.logger = logger;

    // Initialize readers and emitter
    this.displayReader = new DisplayStatusReader(logger);
    this.batteryReader = new BatteryStatusReader(logger);
    this.lolStatusReader = new LoLStatusReader(logger);
    this.batteryReader = new BatteryStatusReader(logger);

    const mqttConfig: MqttConfig = {
      broker: this.config.MQTT_BROKER,
      username: this.config.MQTT_USERNAME,
      password: this.config.MQTT_PASSWORD,
      deviceId: this.config.DEVICE_ID,
      deviceName: this.config.DEVICE_NAME,
      version: this.config.VERSION,
    };

    this.mqttFramework = new MqttDeviceFramework(mqttConfig, logger);

    // Create device emitters
    this.batteryEmitter = this.mqttFramework.createDeviceEmitter(
      "battery_status",
      [
        {
          type: "sensor",
          id: "battery_level",
          config: {
            name: "Battery Level",
            device_class: "battery",
            unit_of_measurement: "%",
            value_template: "{{ value_json.battery_level }}",
          },
        },
        {
          type: "binary_sensor",
          id: "battery_charging",
          config: {
            name: "Battery Charging",
            device_class: "battery_charging",
            value_template: "{{ value_json.is_charging }}",
          },
        },
        {
          type: "binary_sensor",
          id: "ac_power",
          config: {
            name: "AC Power",
            device_class: "plug",
            value_template: "{{ value_json.ac_power }}",
          },
        },
        {
          type: "sensor",
          id: "time_remaining_to_empty",
          config: {
            name: "Battery Time Remaining to Empty",
            unit_of_measurement: "min",
            value_template: "{{ value_json.time_remaining_to_empty }}",
            icon: "mdi:battery-clock",
            entity_category: "diagnostic",
            enabled_by_default: true,
          },
        },
        {
          type: "sensor",
          id: "time_remaining_to_full",
          config: {
            name: "Battery Time Remaining to Full",
            unit_of_measurement: "min",
            value_template: "{{ value_json.time_remaining_to_full }}",
            icon: "mdi:battery-charging",
            entity_category: "diagnostic",
            enabled_by_default: true,
          },
        },
      ]
    );

    this.uptimeEmitter = this.mqttFramework.createDeviceEmitter("uptime", [
      {
        type: "sensor",
        id: "uptime",
        config: {
          name: "System Uptime",
          unit_of_measurement: "min",
          value_template: "{{ value_json.uptime }}",
        },
      },
    ]);

    this.displayEmitter = this.mqttFramework.createDeviceEmitter(
      "display_status",
      [
        {
          type: "sensor",
          id: "display_status",
          config: {
            name: "Display Status",
            value_template: "{{ value_json.status }}",
          },
        },
        {
          type: "sensor",
          id: "external_display_count",
          config: {
            name: "External Display Count",
            unit_of_measurement: "displays",
            value_template: "{{ value_json.external_display_count }}",
          },
        },
        {
          type: "binary_sensor",
          id: "builtin_display_online",
          config: {
            name: "Built-in Display Online",
            device_class: "connectivity",
            value_template: "{{ value_json.builtin_display_online }}",
          },
        },
        {
          type: "sensor",
          id: "display_info",
          config: {
            name: "Display Information",
            unit_of_measurement: "displays",
            value_template: "{{ value_json.total_displays }}",
            json_attributes_topic: `homeassistant/sensor/${this.config.DEVICE_ID}/display_status/state`,
          },
        },
      ]
    );

    this.lolEmitter = this.mqttFramework.createDeviceEmitter("lol_status", [
      {
        type: "binary_sensor",
        id: "lol_in_game",
        config: {
          name: "LoL In Game",
          device_class: "connectivity",
          value_template: "{{ 'ON' if value_json.isInGame else 'OFF' }}",
          icon: "mdi:gamepad-variant",
        },
      },
      {
        type: "sensor",
        id: "lol_game_mode",
        config: {
          name: "LoL Game Mode",
          value_template: "{{ value_json.gameMode | default('unavailable') }}",
          icon: "mdi:gamepad-variant",
        },
      },
      {
        type: "sensor",
        id: "lol_game_time",
        config: {
          name: "LoL Game Time",
          unit_of_measurement: "seconds",
          value_template: "{{ value_json.gameTime | default('unavailable') }}",
          icon: "mdi:timer-outline",
        },
      },
      {
        type: "sensor",
        id: "lol_champion",
        config: {
          name: "LoL Champion",
          value_template:
            "{{ value_json.championName | default('unavailable') }}",
          icon: "mdi:account-warrior",
        },
      },
      {
        type: "sensor",
        id: "lol_level",
        config: {
          name: "LoL Level",
          unit_of_measurement: "level",
          value_template: "{{ value_json.level | default('unavailable') }}",
          icon: "mdi:trophy",
        },
      },
      {
        type: "sensor",
        id: "lol_gold",
        config: {
          name: "LoL Gold",
          unit_of_measurement: "gold",
          state_class: "measurement",
          value_template: "{{ (value_json.currentGold | default(0)) | floor }}",
          icon: "mdi:currency-usd",
        },
      },
      {
        type: "sensor",
        id: "lol_kills",
        config: {
          name: "LoL Kills",
          unit_of_measurement: "kills",
          value_template:
            "{{ value_json.score.kills | default('unavailable') }}",
          icon: "mdi:sword",
        },
      },
      {
        type: "sensor",
        id: "lol_deaths",
        config: {
          name: "LoL Deaths",
          unit_of_measurement: "deaths",
          value_template:
            "{{ value_json.score.deaths | default('unavailable') }}",
          icon: "mdi:skull",
        },
      },
      {
        type: "sensor",
        id: "lol_assists",
        config: {
          name: "LoL Assists",
          unit_of_measurement: "assists",
          value_template:
            "{{ value_json.score.assists | default('unavailable') }}",
          icon: "mdi:account-multiple",
        },
      },
      {
        type: "sensor",
        id: "lol_creep_score",
        config: {
          name: "LoL Creep Score",
          unit_of_measurement: "cs",
          value_template:
            "{{ value_json.score.creepScore | default('unavailable') }}",
          icon: "mdi:sword",
        },
      },
      {
        type: "sensor",
        id: "lol_ward_score",
        config: {
          name: "LoL Ward Score",
          unit_of_measurement: "wards",
          value_template:
            "{{ value_json.score.wardScore | default('unavailable') }}",
          icon: "mdi:eye",
        },
      },
      {
        type: "sensor",
        id: "lol_game_info",
        config: {
          name: "LoL Game Info",
          value_template: "{{ value_json.gameMode | default('unavailable') }}",
          json_attributes_topic: `homeassistant/sensor/${this.config.DEVICE_ID}/lol_status/state`,
          icon: "mdi:information",
        },
      },
    ]);

    // Initialize auto-updater
    const autoUpdaterConfig: AutoUpdaterConfig = {
      autoUpgrade: this.config.AUTO_UPGRADE,
      upgradeCheckInterval: this.config.UPGRADE_CHECK_INTERVAL,
      installScriptUrl: this.config.INSTALL_SCRIPT_URL,
      version: this.config.VERSION,
    };

    this.autoUpdater = new AutoUpdater(autoUpdaterConfig, logger);

    // Set up battery update callback
    this.batteryReader.setBatteryUpdateCallback((batteryInfo) => {
      this.batteryEmitter.publishState(batteryInfo);
    });

    // Set up LoL status update callback
    this.lolStatusReader.setStatusUpdateCallback((lolStatus) => {
      this.lolEmitter.publishState(lolStatus);
    });
  }

  public async initialize(): Promise<void> {
    // Wait for MQTT connection before starting monitoring
    await this.mqttFramework.connect();
    this.startMonitoring();
  }

  private async publishSensorData(): Promise<void> {
    try {
      // Get uptime and display status periodically
      const uptimeInfo = await this.batteryReader.getUptimeInfo();
      const displayInfo = await this.displayReader.getDisplayStatus();
      const detailedDisplayInfo =
        await this.displayReader.getDetailedDisplayInfo();

      this.uptimeEmitter.publishState(uptimeInfo);
      this.displayEmitter.publishState(displayInfo);

      this.logger.debug(
        `Uptime: ${uptimeInfo.uptimeMinutes}min, Display: ${displayInfo.status}, External: ${displayInfo.externalDisplayCount}, Built-in Online: ${displayInfo.builtinDisplayOnline}, Total: ${detailedDisplayInfo.length}`
      );
    } catch (error) {
      this.logger.error(`Error publishing sensor data: ${error}`);
    }
  }

  private startMonitoring(): void {
    // Start pmset rawlog monitoring for real-time battery updates
    this.batteryReader.startPmsetRawlogMonitoring();

    // Start LoL status monitoring
    this.lolStatusReader.startMonitoring();

    // Initial sensor data publish
    this.publishSensorData();

    // Set up periodic updates for uptime and display status
    this.periodicTimer = setInterval(() => {
      this.publishSensorData();
    }, this.config.UPDATE_INTERVAL);

    // Start auto-updater
    this.autoUpdater.start();

    this.logger.info(
      `Started monitoring with real-time battery updates, LoL status monitoring, and ${this.config.UPDATE_INTERVAL}ms uptime/display updates`
    );
  }

  public async shutdown(): Promise<void> {
    // Prevent multiple shutdown calls
    if (this.isShuttingDown) {
      return;
    }
    this.isShuttingDown = true;

    this.logger.info("Shutting down...");

    // Stop auto-updater
    this.autoUpdater.stop();

    // Clear periodic timer if it exists
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = undefined;
    }

    // Stop pmset rawlog process first
    this.batteryReader.stopPmsetRawlogMonitoring();

    // Stop LoL status monitoring
    this.lolStatusReader.stopMonitoring();

    // Disconnect MQTT last (this will handle cleanup)
    try {
      await this.mqttFramework.disconnect();
    } catch (error) {
      this.logger.error(`Error during MQTT disconnect: ${error}`);
    }
  }
}

// Main async function
async function main() {
  // Parse and validate environment variables
  let config: z.infer<typeof envSchema>;
  try {
    const rawConfig = envSchema.parse(process.env);
    // Set default device name to computer name if not provided
    const deviceName = rawConfig.DEVICE_NAME || (await getComputerName());
    config = { ...rawConfig, DEVICE_NAME: deviceName };
  } catch (error) {
    logger.error("❌ Environment variable validation failed:");
    if (error instanceof z.ZodError) {
      error.issues.forEach((err) => {
        logger.error(`  - ${err.path.join(".")}: ${err.message}`);
      });
    }
    logger.error("\n💡 Please check your .env file or environment variables.");
    process.exit(1);
  }

  // Handle graceful shutdown
  const agent = new MacOSPowerAgent(config, logger);
  let isShuttingDown = false;

  const handleShutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.info(`Already shutting down, ignoring ${signal}`);
      return;
    }
    isShuttingDown = true;

    logger.info(`\nReceived ${signal}, shutting down gracefully...`);

    try {
      await agent.shutdown();
      logger.info("Shutdown complete");
      process.exit(0);
    } catch (error) {
      logger.error(`Error during shutdown: ${error}`);
      process.exit(1);
    }
  };

  // Initialize the agent (this will start monitoring once connected)
  await agent.initialize();

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));

  logger.info(
    `macOS Power Agent for Home Assistant started (v${config.VERSION})`
  );
}

// Export for testing
export { getComputerName, MacOSPowerAgent };

// Start the application only when this file is run directly
if (import.meta.main) {
  main().catch((error: any) => {
    logger.error(`Fatal error: ${error}`);
    process.exit(1);
  });
}
