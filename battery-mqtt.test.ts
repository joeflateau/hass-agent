import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { MqttClient } from "mqtt";
import type { Logger } from "winston";
import { MqttBatteryIntegration } from "./battery-mqtt.ts";
import type { BatteryCapability } from "./battery-capability.ts";

const reading = { batteryLevel: 0, isCharging: false, timeRemainingToEmpty: -1,
  timeRemainingToFull: -1, powerSource: "AC", cycleCount: 0, condition: "Good" };
const present: BatteryCapability = { status: "present", powerSource: "AC" };
const absent: BatteryCapability = { status: "absent", powerSource: "AC" };
const unknown: BatteryCapability = { status: "unknown", powerSource: null };
function setup(result = present) {
  const client = Object.assign(new EventEmitter(), { connected: true, publish: vi.fn(), subscribe: vi.fn() });
  const read = vi.fn(async (_signal: AbortSignal | undefined) => result);
  const feature = new MqttBatteryIntegration({ warn: vi.fn() } as unknown as Logger, read);
  feature.attach(client as unknown as MqttClient, "mini", { identifiers: ["mini"], name: "Mac",
    model: "macOS System Monitor", manufacturer: "Apple", sw_version: "test" });
  const configs = () => client.publish.mock.calls.filter(c => c[0].endsWith("/config"));
  const states = () => client.publish.mock.calls.filter(c => c[0].endsWith("/state")).map(c => JSON.parse(c[1]));
  return { client, read, feature, configs, states };
}
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe("battery capability MQTT discovery", () => {
  it("retires all four desktop battery entries but retains AC and filters dummy zero readings", async () => {
    const { feature, configs, states } = setup(absent);
    try {
      feature.start(); await settle();
      const retired = configs().filter(c => c[1] === "");
      expect(retired.map(c => c[0])).toEqual([
        "homeassistant/sensor/mini/battery_level/config", "homeassistant/binary_sensor/mini/battery_charging/config",
        "homeassistant/sensor/mini/time_remaining_to_empty/config", "homeassistant/sensor/mini/time_remaining_to_full/config",
      ]);
      expect(retired.every(c => c[2].qos === 1 && c[2].retain)).toBe(true);
      const ac = JSON.parse(configs().find(c => c[0].includes("ac_power"))![1]);
      expect(ac).toMatchObject({ unique_id: "mini_ac_power", state_topic: "homeassistant/sensor/mini/battery_status/state", device: { identifiers: ["mini"] } });
      feature.publishState(reading);
      expect(states()).toEqual([{ powerSource: "AC" }, { powerSource: "AC" }]);
    } finally { feature.stop(); }
  });
  it("preserves real laptop battery IDs and legitimate zero-percent telemetry", async () => {
    const { feature, configs, states } = setup();
    try {
      feature.start(); feature.publishState(reading); await settle();
      expect(configs()).toHaveLength(5);
      expect(configs().every(c => c[1] !== "")).toBe(true);
      const level = JSON.parse(configs().find(c => c[0].includes("battery_level"))![1]);
      expect(level).toMatchObject({ unique_id: "mini_battery_level", value_template: "{{ value_json.batteryLevel }}" });
      expect(states()).toEqual([reading]);
    } finally { feature.stop(); }
  });
  it("replays migration tombstones on MQTT reconnect and HA birth", async () => {
    const { feature, client, configs } = setup(absent);
    try {
      feature.start(); await settle();
      client.emit("connect"); await settle();
      client.emit("message", "homeassistant/status", Buffer.from("online")); await settle();
      expect(configs().filter(c => c[1] === "")).toHaveLength(20); // initial + cached/new probe for both reconnect paths
      expect(client.subscribe).toHaveBeenCalledWith("homeassistant/status", { qos: 0 });
    } finally { feature.stop(); }
  });
  it("does not advertise or retire on an unknown probe, and recovers on its retry", async () => {
    vi.useFakeTimers();
    const { feature, client, read, configs, states } = setup(unknown);
    try {
      read.mockResolvedValueOnce(unknown).mockResolvedValue(present);
      feature.start(); feature.publishState(reading); await settle();
      expect(client.publish).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30000);
      expect(configs()).toHaveLength(5);
      expect(states()).toEqual([reading]);
    } finally { feature.stop(); vi.useRealTimers(); }
  });
  it("preserves confirmed laptop discovery if a reconnect probe fails", async () => {
    vi.useFakeTimers();
    const { feature, read, client, configs } = setup();
    try {
      read.mockResolvedValueOnce(present).mockRejectedValue(new Error("pmset failed"));
      feature.start(); await settle();
      client.emit("connect"); await settle();
      expect(configs().every(c => c[1] !== "")).toBe(true);
      expect(read).toHaveBeenCalledTimes(2);
    } finally { feature.stop(); vi.useRealTimers(); }
  });
  it("serializes probes and fences a late result after shutdown", async () => {
    const { feature, read, client } = setup();
    let resolve!: (capability: BatteryCapability) => void;
    read.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    feature.start(); client.emit("connect");
    expect(read).toHaveBeenCalledOnce();
    const signal = read.mock.calls[0]![0]!;
    feature.stop(); expect(signal.aborted).toBe(true);
    resolve(absent); await settle();
    feature.publishState(reading); client.emit("connect");
    expect(client.publish).not.toHaveBeenCalled();
  });
});
