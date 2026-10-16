import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { MqttClient } from "mqtt";
import { MqttMediaIntegration } from "./mqtt.ts";
import type { MediaBackend } from "./controller.ts";

function setup(enabled = true, readArtwork?: MediaBackend["readArtwork"]) {
  const client = Object.assign(new EventEmitter(), { connected: true, publish: vi.fn(), subscribe: vi.fn() });
  const backend: MediaBackend = { readArtwork, read: vi.fn(async () => JSON.stringify({ title: "Chrome video", playing: true })), command: vi.fn(async () => {}) };
  const feature = new MqttMediaIntegration(backend, enabled);
  feature.attach(client as unknown as MqttClient, "mac-mini", { identifiers: ["mac-mini"], name: "Joe's Mac mini", model: "Mac", manufacturer: "Apple", sw_version: "test" });
  const states = () => client.publish.mock.calls.filter(c => c[0] === "hass-agent/mac-mini/media/state").map(c => JSON.parse(c[1]));
  const configs = () => client.publish.mock.calls.filter(c => c[0].endsWith("/config"));
  return { client, backend, feature, states, configs };
}
describe("MQTT media integration (same broker, isolated protocol)", () => {
  it("discovers supported sensor/buttons with truthful fields, expiry and rename-safe command template", async () => {
    const { client, configs, states } = setup();
    await vi.waitFor(() => expect(states().at(-1)?.state).toBe("playing"));
    expect(configs()).toHaveLength(6);
    expect(configs().every(c => !c[0].includes("media_player"))).toBe(true);
    const config = JSON.parse(configs().find(c => c[0].includes("now_playing/config"))![1]);
    expect(config).toMatchObject({ expire_after: 20, availability_mode: "all", state_topic: "hass-agent/mac-mini/media/state" });
    expect(config.availability[1].value_template).toContain("observed_at");
    const button = JSON.parse(configs().find(c => c[0].includes("media_next/config"))![1]);
    expect(button).toMatchObject({ qos: 0, retain: false, payload_press: "next", command_topic: "hass-agent/mac-mini/media/command" });
    expect(button.command_template).toContain("this.attributes");
    expect(client.subscribe).toHaveBeenCalledWith("hass-agent/mac-mini/media/command", { qos: 0 });
  });
  it("clears retained state on reconnect and repopulates discovery at HA birth, never dispatches at startup", async () => {
    const { client, states, backend, configs } = setup();
    await vi.waitFor(() => expect(states().at(-1)?.state).toBe("playing"));
    const oldSession = states().at(-1).session;
    client.emit("connect");
    expect(states().at(-1)).toMatchObject({ state: "unavailable", title: null });
    await vi.waitFor(() => expect(states().at(-1)?.state).toBe("playing"));
    expect(states().at(-1).session).not.toBe(oldSession);
    const count = configs().length;
    client.emit("message", "homeassistant/status", Buffer.from("online"), {});
    expect(configs()).toHaveLength(count + 6);
    expect(backend.command).not.toHaveBeenCalled();
  });
  it("keeps every discovered button request-ID range within Home Assistant's sandbox limit", () => {
    const { configs } = setup();
    const buttons = configs().filter(c => c[0].startsWith("homeassistant/button/"));
    expect(buttons).toHaveLength(4);
    for (const [, payload] of buttons) {
      const template = JSON.parse(payload).command_template as string;
      const ranges = [...template.matchAll(/range\(\s*(\d+)\s*,\s*(\d+)\s*\)/g)];
      expect(ranges.length).toBeGreaterThan(0);
      for (const [, start, stop] of ranges) {
        // HA's safe_range raises OverflowError above MAX_RANGE = 100000.
        expect(Number(stop) - Number(start)).toBeGreaterThan(0);
        expect(Number(stop) - Number(start)).toBeLessThanOrEqual(100_000);
      }
    }
  });
  it("correlates one action receipt, drops retained/duplicate packets and does not route household commands", async () => {
    const { client, states, backend } = setup();
    await vi.waitFor(() => expect(states().at(-1)?.state).toBe("playing"));
    const snapshot = states().at(-1);
    const body = Buffer.from(JSON.stringify({ action: "pause", request_id: "frame_request_123456", session: snapshot.session, expected: snapshot.version, observed_at: snapshot.observed_at }));
    client.emit("message", "hass-agent/mac-mini/media/command", body, { retain: true });
    client.emit("message", "hass-agent/mac-mini/media/command", body, { dup: true });
    client.emit("message", "hass-agent/mac-mini/command", Buffer.from("lock_screen"), {});
    expect(backend.command).not.toHaveBeenCalled();
    vi.mocked(backend.command).mockImplementation(async () => { vi.mocked(backend.read).mockResolvedValue(JSON.stringify({ title: "Chrome video", playing: false })); });
    client.emit("message", "hass-agent/mac-mini/media/command", body, {});
    await vi.waitFor(() => expect(backend.command).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(client.publish.mock.calls.some(c => c[0] === "hass-agent/mac-mini/media/result")).toBe(true));
    const receipt = client.publish.mock.calls.find(c => c[0] === "hass-agent/mac-mini/media/result")!;
    expect(JSON.parse(receipt[1])).toMatchObject({ request_id: "frame_request_123456", action: "pause", status: "submitted" });
    expect(receipt[2]).toEqual({ qos: 0, retain: false });
  });
  it("opt-out retires only media discovery and retained media, without reading or subscribing to controls", () => {
    const { client, backend, configs } = setup(false);
    expect(configs()).toHaveLength(6);
    expect(configs().every(c => c[1] === "")).toBe(true);
    expect(client.subscribe).not.toHaveBeenCalled();
    expect(backend.read).not.toHaveBeenCalled();
    expect(backend.command).not.toHaveBeenCalled();
  });
  it("aborts a deferred old-epoch action and suppresses its result across reconnect", async () => {
    const { client, backend, states } = setup();
    await vi.waitFor(() => expect(states().at(-1)?.state).toBe("playing"));
    const snapshot = states().at(-1);
    let release!: () => void;
    let signal!: AbortSignal;
    const nativeSpawn = vi.fn();
    vi.mocked(backend.command).mockImplementation(async (_action, currentSignal) => {
      signal = currentSignal;
      await new Promise<void>(resolve => { release = resolve; });
      if (signal.aborted) throw new Error("cancelled before native spawn");
      nativeSpawn();
    });
    const payload = Buffer.from(JSON.stringify({ action: "next", request_id: "frame_request_123456", session: snapshot.session, expected: snapshot.version, observed_at: snapshot.observed_at }));
    client.emit("message", "hass-agent/mac-mini/media/command", payload, {});
    await vi.waitFor(() => expect(backend.command).toHaveBeenCalledOnce());
    client.connected = false; client.emit("close");
    expect(signal.aborted).toBe(true);
    client.connected = true; client.emit("connect");
    release();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(client.publish.mock.calls.filter(c => c[0] === "hass-agent/mac-mini/media/result")).toHaveLength(0);
  });
});


describe("MQTT private artwork transport", () => {
  it("uses a separate bounded retained envelope, never sensor attributes or control receipts", async () => {
    const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SioAAAAASUVORK5CYII=";
    const read = vi.fn(async () => JSON.stringify({ title: "Chrome video", playing: true, artworkMimeType: "image/png", artworkData: data }));
    const { client, states, backend, feature } = setup(true, read);
    await vi.waitFor(() => expect(client.publish.mock.calls.some(c => c[0].endsWith("/artwork") && c[1])).toBe(true));
    const envelope = client.publish.mock.calls.find(c => c[0].endsWith("/artwork") && c[1])!;
    expect(envelope[2]).toEqual({ qos: 1, retain: true });
    expect(JSON.parse(envelope[1])).toMatchObject({ key: states().at(-1).artwork_key, mime: "image/png", data });
    expect(states().every(s => !("artworkData" in s) && !("data" in s))).toBe(true);
    expect(backend.command).not.toHaveBeenCalled();
    client.emit("connect");
    const messages = client.publish.mock.calls.filter(c => c[0].endsWith("/artwork"));
    expect(messages.at(-1)?.[1]).toBe("");
    feature.stop();
  });
  it("opt out clears retained artwork and performs no image reads", () => {
    const read = vi.fn();
    const { client } = setup(false, read);
    expect(client.publish).toHaveBeenCalledWith("hass-agent/mac-mini/media/artwork", "", { qos: 1, retain: true });
    expect(read).not.toHaveBeenCalled();
  });
});
