#!/usr/bin/env bun

import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import * as mqtt from "mqtt";
import { hostname } from "os";
import * as readline from "readline";
import winston from "winston";
import { z } from "zod";
import { parsePmsetRawlogLine, type BatteryInfo } from "./battery-parser.ts";

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

// Home Assistant MQTT Discovery topics
const DISCOVERY_PREFIX = "homeassistant";

// Build-time version constant (will be replaced by bun build)
declare const VERSION: string;

class MacOSPowerAgent {
  private config: z.infer<typeof envSchema>;
  private client: mqtt.MqttClient;
  private deviceId: string;
  private upgradeCheckTimer?: NodeJS.Timeout;
  private pmsetProcess?: ChildProcess;
  private periodicTimer?: NodeJS.Timeout;

  constructor(config: z.infer<typeof envSchema>) {
    this.config = config;
    this.deviceId = this.config.DEVICE_ID;
    this.client = mqtt.connect(this.config.MQTT_BROKER, {
      username: this.config.MQTT_USERNAME,
      password: this.config.MQTT_PASSWORD,
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

  public async initialize(): Promise<void> {
    // Wait for MQTT connection before starting monitoring
    return new Promise((resolve) => {
      if (this.client.connected) {
        this.startMonitoring();
        resolve();
      } else {
        this.client.once("connect", () => {
          this.startMonitoring();
          resolve();
        });
      }
    });
  }

  private async getUptimeMinutes(): Promise<number> {
    try {
      const output = await this.executeCommand("sysctl kern.boottime");
      // sysctl kern.boottime returns something like: kern.boottime: { sec = 1722409523, usec = 0 } Thu Aug  1 15:12:03 2024
      const secMatch = output.match(/sec = (\d+)/);
      if (!secMatch || !secMatch[1]) {
        throw new Error("Could not parse boot time from sysctl output");
      }

      const bootTimeSeconds = parseInt(secMatch[1]);
      const bootTime = new Date(bootTimeSeconds * 1000);
      const now = new Date();
      const diffMs = now.getTime() - bootTime.getTime();
      return Math.floor(diffMs / 60000); // minutes
    } catch (error) {
      logger.error(`Error getting uptime: ${error}`);
      return -1;
    }
  }

  private setupMqttClient(): void {
    this.client.on("connect", () => {
      logger.info("Connected to MQTT broker");
      this.publishDiscoveryConfigs();
      // Publish online status after discovery configs
      this.client.publish(
        `${DISCOVERY_PREFIX}/status/${this.deviceId}`,
        "online",
        { qos: 1, retain: true }
      );
    });

    this.client.on("error", (error) => {
      logger.error(`MQTT connection error: ${error}`);
    });

    this.client.on("offline", () => {
      logger.warn("MQTT client offline");
    });

    this.client.on("reconnect", () => {
      logger.info("Reconnecting to MQTT broker...");
    });
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

  private parsePmsetRawlogLine(line: string): BatteryInfo | null {
    return parsePmsetRawlogLine(line);
  }

  private startPmsetRawlogMonitoring(): void {
    logger.info("Starting pmset rawlog monitoring...");

    this.pmsetProcess = spawn("pmset", ["-g", "rawlog"]);

    if (this.pmsetProcess.stdout) {
      const rl = readline.createInterface({
        input: this.pmsetProcess.stdout,
        crlfDelay: Infinity,
      });

      rl.on("line", (line: string) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;

        // Look for battery status lines (contain semicolons and percentage)
        if (trimmedLine.includes(";") && trimmedLine.includes("%")) {
          const batteryInfo = this.parsePmsetRawlogLine(trimmedLine);
          if (batteryInfo) {
            logger.debug(
              `Battery update: ${batteryInfo.batteryLevel}%, Charging: ${
                batteryInfo.isCharging
              }, AC: ${batteryInfo.powerSource === "AC"}`
            );
            this.publishBatteryData(batteryInfo);
          }
        }
      });

      rl.on("close", () => {
        logger.warn("pmset rawlog readline interface closed");
      });
    }

    this.pmsetProcess.stderr?.on("data", (data: Buffer) => {
      logger.error(`pmset rawlog stderr: ${data.toString()}`);
    });

    this.pmsetProcess.on("close", (code: number) => {
      logger.warn(`pmset rawlog process closed with code ${code}`);
      // Restart the process after a delay
      setTimeout(() => {
        if (!this.pmsetProcess?.killed) {
          this.startPmsetRawlogMonitoring();
        }
      }, 5000);
    });

    this.pmsetProcess.on("error", (error: Error) => {
      logger.error(`pmset rawlog process error: ${error}`);
    });
  }

  private async publishBatteryData(batteryInfo: BatteryInfo): Promise<void> {
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
      logger.error(`Error publishing battery data: ${error}`);
    }
  }

  private publishDiscoveryConfigs(): void {
    const deviceConfig = {
      identifiers: [this.deviceId],
      name: this.config.DEVICE_NAME,
      model: "macOS System Monitor",
      manufacturer: "Apple",
      sw_version: `${this.config.VERSION} (macOS ${require("os").release()})`,
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

    logger.info("Published Home Assistant discovery configurations");
  }

  private async publishSensorData(): Promise<void> {
    try {
      // Only publish uptime periodically since battery data comes from rawlog
      const uptimeMinutes = await this.getUptimeMinutes();

      // Uptime
      this.client.publish(
        `${DISCOVERY_PREFIX}/sensor/${this.deviceId}/uptime/state`,
        JSON.stringify({ uptime: uptimeMinutes })
      );

      logger.debug(`Uptime: ${uptimeMinutes}min`);
    } catch (error) {
      logger.error(`Error publishing sensor data: ${error}`);
    }
  }

  private startMonitoring(): void {
    // Start pmset rawlog monitoring for real-time battery updates
    this.startPmsetRawlogMonitoring();

    // Initial uptime publish
    this.publishSensorData();

    // Set up periodic updates for uptime (less frequent since it's not critical)
    this.periodicTimer = setInterval(() => {
      this.publishSensorData();
    }, this.config.UPDATE_INTERVAL);

    // Set up auto-upgrade check if enabled
    if (this.config.AUTO_UPGRADE && this.config.VERSION !== "development") {
      this.scheduleUpgradeCheck();
    }

    logger.info(
      `Started monitoring with real-time battery updates and ${this.config.UPDATE_INTERVAL}ms uptime updates`
    );
  }

  private scheduleUpgradeCheck(): void {
    const runUpgradeCheck = async (): Promise<void> => {
      try {
        logger.info("Checking for updates...");

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
        logger.error(`Upgrade check failed: ${error}`);
      }
    };

    // Initial check immediately
    runUpgradeCheck();

    // Schedule periodic checks
    this.upgradeCheckTimer = setInterval(() => {
      runUpgradeCheck();
    }, this.config.UPGRADE_CHECK_INTERVAL);

    logger.info(
      `Auto-upgrade enabled, checking every ${
        this.config.UPGRADE_CHECK_INTERVAL / (60 * 60 * 1000)
      } hours`
    );
  }

  public async shutdown(): Promise<void> {
    logger.info("Shutting down...");

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
    if (this.pmsetProcess && !this.pmsetProcess.killed) {
      this.pmsetProcess.kill("SIGTERM");
      this.pmsetProcess = undefined;
    }

    return new Promise((resolve) => {
      // Publish offline status before disconnecting
      this.client.publish(
        `${DISCOVERY_PREFIX}/status/${this.deviceId}`,
        "offline",
        { qos: 1, retain: true },
        () => {
          this.client.end(false, {}, () => {
            logger.info("MQTT client disconnected");
            resolve();
          });
        }
      );
    });
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
  const agent = new MacOSPowerAgent(config);

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

// Start the application
main().catch((error: any) => {
  logger.error(`Fatal error: ${error}`);
  process.exit(1);
});
