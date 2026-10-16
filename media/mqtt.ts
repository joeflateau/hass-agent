import type { MqttClient } from "mqtt";
import type { DeviceConfig } from "../mqtt-emitter.ts";
import { MediaController, nativeMediaBackend, type MediaBackend } from "./controller.ts";
import { ACTIONS, type MediaSnapshot } from "./model.ts";

export class MqttMediaIntegration {
  private controller?: MediaController;
  constructor(private backend: MediaBackend = nativeMediaBackend(), private enabled = true) {}
  attach(client: MqttClient, deviceId: string, device: DeviceConfig): void {
    if (!this.enabled) {
      const retire = () => {
        for (const [type, id] of [["sensor", "now_playing"], ["sensor", "media_last_action"], ...Object.keys(ACTIONS).map(action => ["button", `media_${action}`])]) {
          client.publish(`homeassistant/${type}/${deviceId}/${id}/config`, "", { qos: 1, retain: true });
        }
        client.publish(`hass-agent/${deviceId}/media/state`, "", { qos: 1, retain: true });
      };
      client.on("connect", retire);
      if (client.connected) retire();
      return;
    }
    const root = `hass-agent/${deviceId}/media`;
    const stateTopic = `${root}/state`;
    const commandTopic = `${root}/command`;
    const resultTopic = `${root}/result`;
    const publishState = (state: MediaSnapshot) => {
      if (client.connected) client.publish(stateTopic, JSON.stringify(state), { qos: 0, retain: true });
    };
    const controller = this.controller = new MediaController(this.backend, publishState);
    const availability = (controls = false) => [
      { topic: `homeassistant/status/${deviceId}`, payload_available: "online", payload_not_available: "offline" },
      { topic: stateTopic, payload_available: "online", payload_not_available: "offline", value_template:
        `{{ 'online' if value_json.state ${controls ? "in ['playing', 'paused']" : "in ['playing', 'paused', 'idle']"} and -2 <= as_timestamp(now()) - as_timestamp(value_json.observed_at, 0) <= 15 else 'offline' }}` },
    ];
    const discover = () => {
      const send = (type: string, id: string, config: object) => client.publish(`homeassistant/${type}/${deviceId}/${id}/config`, JSON.stringify({
        unique_id: `${deviceId}_${id}`, device, availability: availability(type === "button"), availability_mode: "all", ...config,
      }), { qos: 1, retain: true });
      send("sensor", "now_playing", {
        name: "Now Playing", icon: "mdi:music", state_topic: stateTopic,
        value_template: "{{ value_json.state }}", json_attributes_topic: stateTopic, expire_after: 20,
      });
      send("sensor", "media_last_action", {
        name: "Last Media Action", icon: "mdi:gesture-tap-button", entity_category: "diagnostic",
        availability: [availability()[0]], state_topic: resultTopic, value_template: "{{ value_json.status }}", json_attributes_topic: resultTopic,
      });
      for (const action of Object.keys(ACTIONS)) send("button", `media_${action}`, {
        name: `Media ${action[0]!.toUpperCase()}${action.slice(1)}`,
        icon: `mdi:${action === "previous" ? "skip-previous" : action === "next" ? "skip-next" : action}`,
        command_topic: commandTopic, payload_press: action, qos: 0, retain: false,
        json_attributes_topic: stateTopic,
        // HA 2026.8.3 MqttCommandTemplate provides `this`; no entity-name assumptions.
        command_template: "{{ {'action': value, 'request_id': (now().isoformat() ~ '-' ~ (range(0, 2147483647) | random)), 'session': this.attributes.get('session', ''), 'expected': this.attributes.get('version', ''), 'observed_at': this.attributes.get('observed_at', '')} | tojson }}",
      });
    };
    const connect = () => {
      controller.resetSession(); // Never advertise retained media as a fresh observation.
      discover();
      client.subscribe(commandTopic, { qos: 0 });
      client.subscribe("homeassistant/status", { qos: 0 });
      void controller.poll();
    };
    client.on("connect", connect);
    client.on("close", () => controller.resetSession());
    client.on("message", (topic, payload, packet) => {
      if (topic === "homeassistant/status" && payload.toString() === "online") { discover(); void controller.poll(); }
      if (topic !== commandTopic || !client.connected) return;
      const session = controller.snapshot.session;
      void controller.dispatch(payload, packet).then(result => {
        if (result && client.connected && session === controller.snapshot.session) client.publish(resultTopic, JSON.stringify(result), { qos: 0, retain: false });
      });
    });
    if (client.connected) connect();
  }
  start(): void { this.controller?.start(); }
  stop(): void { this.controller?.stop(); }
}
