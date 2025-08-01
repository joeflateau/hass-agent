#!/usr/bin/env bun

import { spawn } from "child_process";
import * as mqtt from "mqtt";
import { hostname } from "os";
import { z } from "zod";

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
});

// Home Assistant MQTT Discovery topics
const DISCOVERY_PREFIX = "homeassistant";

interface BatteryInfo {
  isCharging: boolean;
  batteryLevel: number;
  timeRemaining: number;
  powerSource: string;
  cycleCount: number;
  condition: string;
}

interface PowerInfo {
  acPower: boolean;
  batteryPower: boolean;
  upsConnected: boolean;
}

class MacOSPowerAgent {
  private config: z.infer<typeof envSchema>;
  private client: mqtt.MqttClient;
  private deviceId: string;

  constructor(config: z.infer<typeof envSchema>) {
    this.config = config;
    this.deviceId = this.config.DEVICE_ID;
    this.client = mqtt.connect(this.config.MQTT_BROKER, {
      username: this.config.MQTT_USERNAME,
      password: this.config.MQTT_PASSWORD,
      clientId: `hass-agent-${this.deviceId}`,
      forceNativeWebSocket: true,
    });

    this.setupMqttClient();
  }

  private setupMqttClient(): void {
    this.client.on("connect", () => {
      console.log("Connected to MQTT broker");
      this.publishDiscoveryConfigs();
      this.startMonitoring();
    });

    this.client.on("error", (error) => {
      console.error("MQTT connection error:", error);
    });

    this.client.on("offline", () => {
      console.log("MQTT client offline");
    });

    this.client.on("reconnect", () => {
      console.log("Reconnecting to MQTT broker...");
    });
  }

  private async executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("sh", ["-c", command]);
      let output = "";
      let error = "";

      child.stdout.on("data", (data) => {
        output += data.toString();
      });

      child.stderr.on("data", (data) => {
        error += data.toString();
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Command failed with code ${code}: ${error}`));
        }
      });
    });
  }

  private async getBatteryInfo(): Promise<BatteryInfo | null> {
    try {
      const output = await this.executeCommand("pmset -g batt");
      const batteryMatch = output.match(/(\d+)%;\s*(.*?);\s*(.*?)\s*present/);

      if (
        !batteryMatch ||
        !batteryMatch[1] ||
        !batteryMatch[2] ||
        !batteryMatch[3]
      ) {
        return null; // No battery present
      }

      const batteryLevel = parseInt(batteryMatch[1]);
      const chargingState = batteryMatch[2];
      const timeInfo = batteryMatch[3];

      // Get additional battery info
      const systemProfiler = await this.executeCommand(
        'system_profiler SPPowerDataType | grep -E "(Cycle Count|Condition)"'
      );
      const cycleMatch = systemProfiler.match(/Cycle Count:\s*(\d+)/);
      const conditionMatch = systemProfiler.match(/Condition:\s*(.+)/);

      // Parse time remaining
      let timeRemaining = -1;
      if (timeInfo && timeInfo.includes(":")) {
        const timeParts = timeInfo.split(":");
        if (timeParts[0] && timeParts[1]) {
          timeRemaining = parseInt(timeParts[0]) * 60 + parseInt(timeParts[1]);
        }
      }

      return {
        isCharging:
          chargingState.includes("charging") ||
          chargingState.includes("charged"),
        batteryLevel,
        timeRemaining,
        powerSource: chargingState.includes("AC Power") ? "AC" : "Battery",
        cycleCount: cycleMatch && cycleMatch[1] ? parseInt(cycleMatch[1]) : 0,
        condition:
          conditionMatch && conditionMatch[1]
            ? conditionMatch[1].trim()
            : "Unknown",
      };
    } catch (error) {
      console.error("Error getting battery info:", error);
      return null;
    }
  }

  private async getPowerInfo(): Promise<PowerInfo> {
    try {
      const output = await this.executeCommand("pmset -g ps");
      return {
        acPower: output.includes("AC Power"),
        batteryPower: output.includes("Battery Power"),
        upsConnected: output.includes("UPS"),
      };
    } catch (error) {
      console.error("Error getting power info:", error);
      return {
        acPower: false,
        batteryPower: false,
        upsConnected: false,
      };
    }
  }

  private publishDiscoveryConfigs(): void {
    const deviceConfig = {
      identifiers: [this.deviceId],
      name: this.config.DEVICE_NAME,
      model: "macOS System Monitor",
      manufacturer: "Apple",
      sw_version: require("os").release(),
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

    console.log("Published Home Assistant discovery configurations");
  }

  private async publishSensorData(): Promise<void> {
    try {
      const batteryInfo = await this.getBatteryInfo();
      const powerInfo = await this.getPowerInfo();

      if (batteryInfo) {
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

        console.log(
          `Battery: ${batteryInfo.batteryLevel}%, Charging: ${batteryInfo.isCharging}, Time: ${batteryInfo.timeRemaining}min`
        );
      }

      // AC Power
      this.client.publish(
        `${DISCOVERY_PREFIX}/binary_sensor/${this.deviceId}/ac_power/state`,
        JSON.stringify({ ac_power: powerInfo.acPower ? "ON" : "OFF" })
      );

      console.log(`AC Power: ${powerInfo.acPower}`);
    } catch (error) {
      console.error("Error publishing sensor data:", error);
    }
  }

  private startMonitoring(): void {
    // Initial publish
    this.publishSensorData();

    // Set up periodic updates
    setInterval(() => {
      this.publishSensorData();
    }, this.config.UPDATE_INTERVAL);

    console.log(
      `Started monitoring with ${this.config.UPDATE_INTERVAL}ms interval`
    );
  }

  public async shutdown(): Promise<void> {
    console.log("Shutting down...");
    return new Promise((resolve) => {
      this.client.end(false, {}, () => {
        console.log("MQTT client disconnected");
        resolve();
      });
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
    console.error("❌ Environment variable validation failed:");
    if (error instanceof z.ZodError) {
      error.issues.forEach((err) => {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      });
    }
    console.error("\n💡 Please check your .env file or environment variables.");
    process.exit(1);
  }

  // Handle graceful shutdown
  const agent = new MacOSPowerAgent(config);

  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down gracefully...");
    await agent.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down gracefully...");
    await agent.shutdown();
    process.exit(0);
  });

  console.log("macOS Power Agent for Home Assistant started");
}

// Start the application
main().catch((error: any) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
