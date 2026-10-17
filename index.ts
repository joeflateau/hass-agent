#!/usr/bin/env node

/**
 * Main Application Entry Point
 *
 * Orchestrates the Home Assistant Agent for macOS, coordinating multiple status readers
 * (battery, display, League of Legends) and publishing their data to Home Assistant via MQTT.
 * Handles configuration validation, graceful shutdown, and optional auto-updates.
 *
 * Commands:
 * - (default): Run the main agent
 * - update-data-dragon: Update League of Legends static data from Riot's Data Dragon API
 */

import assert from "assert";
import { hostname } from "os";
import { join } from "path";
import * as winston from "winston";
import { z } from "zod";
import { AutoUpdater, type AutoUpdaterConfig } from "./auto-updater.ts";
import {
  type AutoUpgradeSettingsStore,
  FileAutoUpgradeSettingsStore,
  MAX_UPGRADE_CHECK_INTERVAL,
  MIN_UPGRADE_CHECK_INTERVAL,
  UPGRADE_CHECK_INTERVAL_STEP,
} from "./auto-upgrade-settings.ts";
import { MqttBatteryIntegration } from "./battery-mqtt.ts";
import {
  BatteryStatusReader,
  type UptimeInfo,
} from "./battery-status-reader.ts";
import { updateDataDragon } from "./data-dragon-updater.ts";
import {
  DisplayStatusReader,
  type DisplayInfo,
} from "./display-status-reader.ts";
import { loadEnvironmentFile } from "./environment.ts";
import { LoLStatusReader, type LoLGameStatus } from "./lol-status-reader.ts";
import { MqttMediaIntegration } from "./media/mqtt.ts";
import { nativeMediaBackend } from "./media/controller.ts";
import { parseNowPlaying } from "./media/model.ts";
import { randomUUID } from "node:crypto";
import { prepareRuntime } from "./media/runtime.ts";
import {
  createMacOSCommands,
  RETIRED_MACOS_COMMAND_IDS,
} from "./macos-commands.ts";
import {
  MqttDeviceFramework,
  type MqttConfig,
  type MqttDeviceEmitter,
} from "./mqtt-emitter.ts";

loadEnvironmentFile();

const HOUR_MS = 60 * 60 * 1000;

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
  MEDIA_ENABLED: z.enum(["true", "false"]).default("true").transform(value => value === "true"),
  AUTO_UPGRADE: z
    .string()
    .transform((val) => val.toLowerCase() === "true")
    .default(() => true),
  UPGRADE_CHECK_INTERVAL: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .refine(
      (value) =>
        Number.isSafeInteger(value) &&
        value >= MIN_UPGRADE_CHECK_INTERVAL &&
        value <= MAX_UPGRADE_CHECK_INTERVAL &&
        value % UPGRADE_CHECK_INTERVAL_STEP === 0,
      "must be a 15-minute increment between 15 minutes and 168 hours"
    )
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

// Build-time version constant (replaced while bundling the SEA)
declare const VERSION: string;

class MacOSPowerAgent {
  private config: z.infer<typeof envSchema>;
  private logger: winston.Logger;
  private periodicTimer?: NodeJS.Timeout;
  private displayReader: DisplayStatusReader;
  private batteryReader: BatteryStatusReader;
  private lolStatusReader: LoLStatusReader;
  private mqttFramework: MqttDeviceFramework;
  private batteryEmitter: MqttBatteryIntegration;
  private uptimeEmitter: MqttDeviceEmitter<UptimeInfo>;
  private displayEmitter: MqttDeviceEmitter<DisplayInfo>;
  private lolEmitter: MqttDeviceEmitter<LoLGameStatus>;
  private lolLastInGameStatusEmitter: MqttDeviceEmitter<LoLGameStatus>;
  private autoUpdater: AutoUpdater;
  private autoUpgradeSettings: AutoUpgradeSettingsStore;
  private isShuttingDown = false;
  private media: MqttMediaIntegration;

  constructor(
    config: z.infer<typeof envSchema>,
    logger: winston.Logger,
    autoUpgradeSettings: AutoUpgradeSettingsStore =
      new FileAutoUpgradeSettingsStore()
  ) {
    this.config = config;
    this.logger = logger;
    this.autoUpgradeSettings = autoUpgradeSettings;

    // Initialize readers and emitter
    this.displayReader = new DisplayStatusReader(logger);
    this.batteryReader = new BatteryStatusReader(logger);
    this.lolStatusReader = new LoLStatusReader(logger);

    const mqttConfig: MqttConfig = {
      broker: this.config.MQTT_BROKER,
      username: this.config.MQTT_USERNAME,
      password: this.config.MQTT_PASSWORD,
      deviceId: this.config.DEVICE_ID,
      deviceName: this.config.DEVICE_NAME,
      version: this.config.VERSION,
    };

    this.mqttFramework = new MqttDeviceFramework(mqttConfig, logger);
    this.media = new MqttMediaIntegration(undefined, this.config.MEDIA_ENABLED === true);
    this.mqttFramework.registerIntegration(this.media);
    this.mqttFramework.registerCommands(createMacOSCommands());
    this.mqttFramework.retireCommands(RETIRED_MACOS_COMMAND_IDS);

    // Capability-owned battery discovery also retires legacy desktop entries.
    this.batteryEmitter = new MqttBatteryIntegration(logger);
    this.mqttFramework.registerIntegration(this.batteryEmitter);

    // Create device emitters
    this.uptimeEmitter = this.mqttFramework.createDeviceEmitter<UptimeInfo>(
      "uptime",
      [
        {
          type: "sensor",
          id: "uptime",
          config: {
            name: "System Uptime",
            unit_of_measurement: "min",
            value_template: "{{ value_json.uptimeMinutes }}",
          },
        },
      ]
    );

    this.displayEmitter = this.mqttFramework.createDeviceEmitter<DisplayInfo>(
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
            value_template: "{{ value_json.externalDisplayCount }}",
          },
        },
        {
          type: "binary_sensor",
          id: "builtin_display_online",
          config: {
            name: "Built-in Display Online",
            device_class: "connectivity",
            value_template:
              "{{ 'ON' if value_json.builtinDisplayOnline else 'OFF' }}",
          },
        },
        {
          type: "sensor",
          id: "display_info",
          config: {
            name: "Display Information",
            unit_of_measurement: "displays",
            value_template:
              "{{ value_json.externalDisplayCount + (1 if value_json.builtinDisplayOnline else 0) }}",
            json_attributes_topic: `homeassistant/sensor/${this.config.DEVICE_ID}/display_status/state`,
          },
        },
      ]
    );

    const lolLastInGameStatusEmitter =
      this.mqttFramework.createDeviceEmitter<LoLGameStatus>(
        "lol_last_in_game_status",
        [
          {
            type: "sensor",
            id: "lol_game_mode",
            config: {
              name: "LoL Game Mode",
              value_template:
                "{{ value_json.gameMode | default('unavailable') }}",
              icon: "mdi:gamepad-variant",
            },
          },
          {
            type: "sensor",
            id: "lol_game_time",
            config: {
              name: "LoL Game Time",
              unit_of_measurement: "seconds",
              value_template:
                "{{ value_json.gameTime | default('unavailable') }}",
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
              value_template:
                "{{ (value_json.currentGold | default(0)) | floor }}",
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
              value_template:
                "{{ value_json.gameMode | default('unavailable') }}",
              json_attributes_topic: `homeassistant/sensor/${this.config.DEVICE_ID}/lol_last_in_game_status/state`,
              icon: "mdi:information",
            },
          },
        ]
      );

    const lolStatusEmitter =
      this.mqttFramework.createDeviceEmitter<LoLGameStatus>("lol_now_status", [
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
      ]);

    assert(lolStatusEmitter);
    assert(lolLastInGameStatusEmitter);

    this.lolEmitter = lolStatusEmitter;
    this.lolLastInGameStatusEmitter = lolLastInGameStatusEmitter;

    // Initialize auto-updater
    const autoUpdaterConfig: AutoUpdaterConfig = {
      autoUpgrade: this.config.AUTO_UPGRADE,
      upgradeCheckInterval: this.config.UPGRADE_CHECK_INTERVAL,
      installScriptUrl: this.config.INSTALL_SCRIPT_URL,
      version: this.config.VERSION,
    };

    this.autoUpdater = new AutoUpdater(autoUpdaterConfig, logger);
    this.mqttFramework.registerSwitches([
      {
        id: "automatic_upgrades",
        name: "Automatic Upgrades",
        icon: "mdi:update",
        getState: () => this.autoUpdater.isEnabled(),
        setState: async (enabled) => {
          await this.autoUpgradeSettings.save(enabled);
          this.config.AUTO_UPGRADE = enabled;
          this.autoUpdater.setEnabled(enabled);
        },
      },
    ]);
    this.mqttFramework.registerNumbers([
      {
        id: "upgrade_check_interval",
        name: "Upgrade Check Interval",
        icon: "mdi:timer-sync-outline",
        min: MIN_UPGRADE_CHECK_INTERVAL / HOUR_MS,
        max: MAX_UPGRADE_CHECK_INTERVAL / HOUR_MS,
        step: UPGRADE_CHECK_INTERVAL_STEP / HOUR_MS,
        unitOfMeasurement: "h",
        deviceClass: "duration",
        getState: () => this.autoUpdater.getCheckInterval() / HOUR_MS,
        setState: async (hours) => {
          const interval = Math.round(hours * HOUR_MS);
          await this.autoUpgradeSettings.saveInterval(interval);
          this.config.UPGRADE_CHECK_INTERVAL = interval;
          this.autoUpdater.setCheckInterval(interval);
        },
      },
    ]);

    // Set up battery update callback
    this.batteryReader.setBatteryUpdateCallback((batteryInfo) => {
      this.batteryEmitter.publishState(batteryInfo);
    });

    // Set up LoL status update callback
    this.lolStatusReader.setStatusUpdateCallback((lolStatus) => {
      this.lolEmitter.publishState(lolStatus);
      if (lolStatus.isInGame) {
        this.lolLastInGameStatusEmitter.publishState(lolStatus);
      }
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
    this.batteryEmitter.start();
    // Start pmset rawlog monitoring for real-time battery updates
    this.batteryReader.startPmsetRawlogMonitoring();

    // Start LoL status monitoring
    this.lolStatusReader.startMonitoring();
    this.media.start();

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
    this.batteryEmitter.stop();
    this.batteryReader.stopPmsetRawlogMonitoring();

    // Stop LoL status monitoring
    this.lolStatusReader.stopMonitoring();
    this.media.stop();

    // Disconnect MQTT last (this will handle cleanup)
    try {
      await this.mqttFramework.disconnect();
    } catch (error) {
      this.logger.error(`Error during MQTT disconnect: ${error}`);
    }
  }
}

// Command line argument parsing
function parseCommand(): { command: string; args: string[] } {
  const args = process.argv.slice(2);
  const command = args[0] || "run";
  const commandArgs = args.slice(1);
  return { command, args: commandArgs };
}

// Show help message
function showHelp(): void {
  console.log(`
macOS Home Assistant Agent v${
    typeof VERSION !== "undefined" ? VERSION : "development"
  }

Usage: hass-agent [command] [options]

Commands:
  run                    Start the Home Assistant agent (default)
  update-data-dragon     Update League of Legends static data from Riot's Data Dragon API
  media-status           Read Now Playing in this GUI login (no MQTT or playback)
  media-runtime-check    Verify/extract bundled media runtime (no GUI read or playback)
  help, --help, -h       Show this help message

Examples:
  hass-agent                    # Start the agent
  hass-agent run               # Start the agent (explicit)
  hass-agent update-data-dragon # Update LoL data
  hass-agent --help            # Show help

Environment Variables:
  MQTT_BROKER              MQTT broker URL (default: mqtt://localhost:1883)
  MQTT_USERNAME            MQTT username (optional)
  MQTT_PASSWORD            MQTT password (optional)
  DEVICE_ID                Unique device identifier (required)
  DEVICE_NAME              Device display name (default: computer name)
  UPDATE_INTERVAL          Update interval in ms (default: 30000)
  AUTO_UPGRADE             Enable auto-upgrades (default: true)
  MEDIA_ENABLED            Publish Now Playing and four media controls (default: true)
  LOG_LEVEL                Log level (default: info)

For more information, see: https://github.com/joeflateau/hass-agent
`);
}

// Handle the update-data-dragon command
async function handleUpdateDataDragon(): Promise<void> {
  try {
    const dataDir = join(process.cwd(), "data", "ddragon");
    await updateDataDragon(dataDir, logger);
    process.exit(0);
  } catch (error) {
    logger.error(`Failed to update Data Dragon data: ${error}`);
    process.exit(1);
  }
}

// Main async function
async function main() {
  const { command, args } = parseCommand();

  if (command === "media-runtime-check") {
    try { await prepareRuntime(); console.log(JSON.stringify({ runtime: "media-control 0.7.7", verified: true })); }
    catch (error) { console.error(error instanceof Error ? error.message : "Invalid media runtime"); process.exitCode = 1; }
    return;
  }

  if (command === "media-status") {
    try {
      console.log(JSON.stringify(parseNowPlaying(await nativeMediaBackend().read(new AbortController().signal), randomUUID())));
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Now Playing reader unavailable");
      process.exitCode = 1;
    }
    return;
  }

  // Handle help command
  if (command === "help" || command === "--help" || command === "-h") {
    showHelp();
    return;
  }

  // Handle update-data-dragon command
  if (command === "update-data-dragon") {
    await handleUpdateDataDragon();
    return;
  }

  // Handle unknown commands
  if (command !== "run") {
    logger.error(`Unknown command: ${command}`);
    logger.info("Use 'hass-agent --help' for usage information");
    process.exit(1);
  }

  // Continue with the main agent logic for 'run' command
  // Parse and validate environment variables
  let config: z.infer<typeof envSchema>;
  const autoUpgradeSettings = new FileAutoUpgradeSettingsStore(
    ".settings.json",
    (message) => logger.error(message)
  );
  try {
    const rawConfig = envSchema.parse(process.env);
    const autoUpgrade = await autoUpgradeSettings.load(rawConfig.AUTO_UPGRADE);
    const upgradeCheckInterval = await autoUpgradeSettings.loadInterval(
      rawConfig.UPGRADE_CHECK_INTERVAL
    );
    // Set default device name to computer name if not provided
    const deviceName = rawConfig.DEVICE_NAME || (await getComputerName());
    config = {
      ...rawConfig,
      AUTO_UPGRADE: autoUpgrade,
      UPGRADE_CHECK_INTERVAL: upgradeCheckInterval,
      DEVICE_NAME: deviceName,
    };
  } catch (error) {
    logger.error("❌ Environment variable validation failed:");
    if (error instanceof z.ZodError) {
      error.issues.forEach((err) => {
        logger.error(`  - ${err.path.join(".")}: ${err.message}`);
      });
    } else {
      logger.error(error instanceof Error ? error.message : String(error));
    }
    logger.error("\n💡 Please check your .env file or environment variables.");
    process.exit(1);
  }

  // Handle graceful shutdown
  const agent = new MacOSPowerAgent(config, logger, autoUpgradeSettings);
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
export { envSchema, getComputerName, MacOSPowerAgent };

// Start the application only when this file is run directly
if (import.meta.main) {
  main().catch((error: any) => {
    logger.error(`Fatal error: ${error}`);
    process.exit(1);
  });
}
