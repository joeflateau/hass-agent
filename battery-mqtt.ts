import type { MqttClient } from "mqtt";
import type { Logger } from "winston";
import type { BatteryInfo } from "./battery-parser.ts";
import type { DeviceConfig, EntityConfig } from "./mqtt-emitter.ts";
import { readBatteryCapability, type BatteryCapability } from "./battery-capability.ts";

type Entity = { type: "sensor" | "binary_sensor"; id: string; config: Omit<EntityConfig, "device" | "unique_id" | "state_topic"> };
const entities: Entity[] = [
  {
    type: "sensor",
    id: "battery_level",
    config: {
      name: "Battery Level",
      device_class: "battery",
      unit_of_measurement: "%",
      value_template: "{{ value_json.batteryLevel }}",
    },
  },
  {
    type: "binary_sensor",
    id: "battery_charging",
    config: {
      name: "Battery Charging",
      device_class: "battery_charging",
      value_template: "{{ 'ON' if value_json.isCharging else 'OFF' }}",
    },
  },
  {
    type: "binary_sensor",
    id: "ac_power",
    config: {
      name: "AC Power",
      device_class: "plug",
      value_template:
        "{{ 'ON' if value_json.powerSource == 'AC' else 'OFF' }}",
    },
  },
  {
    type: "sensor",
    id: "time_remaining_to_empty",
    config: {
      name: "Battery Time Remaining to Empty",
      unit_of_measurement: "min",
      value_template: "{{ value_json.timeRemainingToEmpty }}",
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
      value_template: "{{ value_json.timeRemainingToFull }}",
      icon: "mdi:battery-charging",
      entity_category: "diagnostic",
      enabled_by_default: true,
    },
  },
];

/** One hardware capability owns both discovery and legacy retained cleanup. */
export class MqttBatteryIntegration {
  private client?: MqttClient;
  private deviceId = "";
  private device?: DeviceConfig;
  private capability: BatteryCapability = { status: "unknown", powerSource: null };
  private lastReading?: BatteryInfo;
  private running = false;
  private abort = new AbortController();
  private pending?: Promise<void>;
  private retry?: NodeJS.Timeout;
  private warned = false;
  constructor(private logger: Logger, private readCapability = readBatteryCapability) {}

  attach(client: MqttClient, deviceId: string, device: DeviceConfig): void {
    this.client = client; this.deviceId = deviceId; this.device = device;
    const connect = () => {
      client.subscribe("homeassistant/status", { qos: 0 });
      if (!this.running) return;
      this.discover();
      this.publishCurrent();
      void this.refresh();
    };
    client.on("connect", connect);
    client.on("message", (topic, payload) => {
      if (topic === "homeassistant/status" && payload.toString() === "online" && this.running) {
        this.discover(); this.publishCurrent(); void this.refresh();
      }
    });
    if (client.connected) connect();
  }
  start(): void {
    if (this.running) return;
    this.running = true;
    this.abort = new AbortController();
    void this.refresh();
  }
  stop(): void {
    this.running = false;
    this.abort.abort();
    clearTimeout(this.retry);
  }
  publishState(reading: BatteryInfo): void {
    if (!this.running) return;
    this.lastReading = reading;
    this.publishCurrent();
  }
  private async refresh(): Promise<void> {
    if (!this.running || this.pending) return;
    clearTimeout(this.retry);
    const signal = this.abort.signal;
    this.pending = (async () => {
      let result: BatteryCapability;
      try { result = await this.readCapability(signal); }
      catch { result = { status: "unknown", powerSource: null }; }
      if (!this.running || signal.aborted) return;
      if (result.status !== "unknown") {
        this.capability = result;
        this.warned = false;
        this.discover();
        this.publishCurrent();
      } else {
        // Never turn an unreadable command response into a hardware-removal event.
        // Preserve a prior confirmed capability and retry without blocking telemetry.
        if (!this.warned) this.logger.warn("Battery capability unavailable; preserving existing discovery and retrying.");
        this.warned = true;
        this.retry = setTimeout(() => { void this.refresh(); }, 30000);
      }
    })();
    try { await this.pending; }
    finally { this.pending = undefined; }
  }
  private discover(): void {
    if (!this.running || !this.client?.connected || !this.device || this.capability.status === "unknown") return;
    for (const entity of entities) {
      const topic = `homeassistant/${entity.type}/${this.deviceId}/${entity.id}/config`;
      const payload = this.capability.status === "absent" && entity.id !== "ac_power" ? "" : JSON.stringify({
        ...entity.config, unique_id: `${this.deviceId}_${entity.id}`,
        state_topic: this.stateTopic, device: this.device,
      });
      this.client.publish(topic, payload, { qos: 1, retain: true });
    }
  }
  private get stateTopic(): string { return `homeassistant/sensor/${this.deviceId}/battery_status/state`; }
  private publishCurrent(): void {
    if (!this.running || !this.client?.connected || this.capability.status === "unknown") return;
    const state = this.capability.status === "absent"
      ? { powerSource: this.lastReading?.powerSource ?? this.capability.powerSource }
      : this.lastReading;
    if (state) this.client.publish(this.stateTopic, JSON.stringify(state), { qos: 1, retain: true });
  }
}
