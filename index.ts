#!/usr/bin/env bun

import { spawn, type SpawnOptions } from "child_process";
import { hostname } from "os";
import * as winston from "winston";
import { z } from "zod";
import { BatteryStatusReader } from "./battery-status-reader.ts";
import {
  DisplayStatusReader,
  type DisplayInfo,
} from "./display-status-reader.ts";
import { MqttEmitter, type MqttConfig } from "./mqtt-emitter.ts";

// Configure Winston logger with timestamps
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({
      format: "YYYY-MM-DD HH:mm:ss",
    }),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}] ${message}`;
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
  private upgradeCheckTimer?: NodeJS.Timeout;
  private periodicTimer?: NodeJS.Timeout;
  private displayReader: DisplayStatusReader;
  private batteryReader: BatteryStatusReader;
  private mqttEmitter: MqttEmitter;

  constructor(config: z.infer<typeof envSchema>, logger: winston.Logger) {
    this.config = config;
    this.logger = logger;

    // Initialize readers and emitter
    this.displayReader = new DisplayStatusReader(logger);
    this.batteryReader = new BatteryStatusReader(logger);

    const mqttConfig: MqttConfig = {
      broker: this.config.MQTT_BROKER,
      username: this.config.MQTT_USERNAME,
      password: this.config.MQTT_PASSWORD,
      deviceId: this.config.DEVICE_ID,
      deviceName: this.config.DEVICE_NAME,
      version: this.config.VERSION,
    };

    this.mqttEmitter = new MqttEmitter(mqttConfig, logger);

    // Set up battery update callback
    this.batteryReader.setBatteryUpdateCallback((batteryInfo) => {
      this.mqttEmitter.publishBatteryData(batteryInfo);
    });
  }

  // Public getters for testing backward compatibility
  public async getDisplayStatus() {
    return this.displayReader.getDisplayStatus();
  }

  public async getDetailedDisplayInfo() {
    return this.displayReader.getDetailedDisplayInfo();
  }

  public async initialize(): Promise<void> {
    // Wait for MQTT connection before starting monitoring
    await this.mqttEmitter.connect();
    this.startMonitoring();
  }

  private async publishSensorData(): Promise<void> {
    try {
      // Get uptime and display status periodically
      const uptimeInfo = await this.batteryReader.getUptimeInfo();
      const displayInfo = await this.displayReader.getDisplayStatus();
      const detailedDisplayInfo =
        await this.displayReader.getDetailedDisplayInfo();

      this.mqttEmitter.publishUptimeData(uptimeInfo);
      this.mqttEmitter.publishDisplayData(displayInfo, detailedDisplayInfo);

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

    // Initial sensor data publish
    this.publishSensorData();

    // Set up periodic updates for uptime and display status
    this.periodicTimer = setInterval(() => {
      this.publishSensorData();
    }, this.config.UPDATE_INTERVAL);

    // Set up auto-upgrade check if enabled
    if (this.config.AUTO_UPGRADE && this.config.VERSION !== "development") {
      this.scheduleUpgradeCheck();
    }

    this.logger.info(
      `Started monitoring with real-time battery updates and ${this.config.UPDATE_INTERVAL}ms uptime/display updates`
    );
  }

  private scheduleUpgradeCheck(): void {
    const runUpgradeCheck = async (): Promise<void> => {
      try {
        this.logger.info("Checking for updates...");

        // Execute the install script with detached process so it can outlive this process
        // The install script may need to kill this process to update the binary
        await this.executeCommand(
          `curl -fsSL "${this.config.INSTALL_SCRIPT_URL}" | bash`,
          {
            env: { ...process.env, INSTALLED_VERSION: this.config.VERSION },
            detached: true, // Allow the process to run independently
            stdio: "ignore", // Disconnect stdio so child can outlive parent
          }
        );
      } catch (error) {
        this.logger.error(`Upgrade check failed: ${error}`);
      }
    };

    // Initial check immediately
    runUpgradeCheck();

    // Schedule periodic checks
    this.upgradeCheckTimer = setInterval(() => {
      runUpgradeCheck();
    }, this.config.UPGRADE_CHECK_INTERVAL);

    this.logger.info(
      `Auto-upgrade enabled, checking every ${
        this.config.UPGRADE_CHECK_INTERVAL / (60 * 60 * 1000)
      } hours`
    );
  }

  private async executeCommand(
    command: string,
    options?: SpawnOptions
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("sh", ["-c", command], { ...options });
      let output = "";
      let error = "";

      child.stdout?.on("data", (data) => {
        output += data.toString();
      });

      child.stderr?.on("data", (data) => {
        error += data.toString();
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Command failed with code ${code}: ${error}`));
        }
      });

      child.on("error", (err) => {
        reject(err);
      });
    });
  }

  public async shutdown(): Promise<void> {
    this.logger.info("Shutting down...");

    // Clear timers if they exist
    if (this.upgradeCheckTimer) {
      clearInterval(this.upgradeCheckTimer);
      this.upgradeCheckTimer = undefined;
    }

    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = undefined;
    }

    // Kill pmset rawlog process
    this.batteryReader.stopPmsetRawlogMonitoring();

    // Disconnect MQTT
    await this.mqttEmitter.disconnect();
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

  // Initialize the agent (this will start monitoring once connected)
  await agent.initialize();

  process.on("SIGINT", async () => {
    logger.info("\nReceived SIGINT, shutting down gracefully...");
    await agent.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("\nReceived SIGTERM, shutting down gracefully...");
    await agent.shutdown();
    process.exit(0);
  });

  logger.info(
    `macOS Power Agent for Home Assistant started (v${config.VERSION})`
  );
}

// Export for testing
export { getComputerName, MacOSPowerAgent, type DisplayInfo };

// Start the application only when this file is run directly
if (import.meta.main) {
  main().catch((error: any) => {
    logger.error(`Fatal error: ${error}`);
    process.exit(1);
  });
}
