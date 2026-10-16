# Hass Agent Overlay

A Home Assistant-native overlay for hass-agent MQTT devices. Media is the first
feature; the integration name intentionally leaves room for other native entity
platforms later. It does not replace MQTT or the Mac agent.

A Home Assistant custom integration that automatically adds a native
`media_player` to each hass-agent MQTT Mac with Now Playing enabled. It uses your
existing HA MQTT integration and registered sensors; no second broker login,
per-device topic mappings, or Mac SSH access.

## Install and enable

1. Copy this directory to `/config/custom_components/hass_agent_overlay`.
2. Restart Home Assistant, then choose **Settings → Devices & services → Add
   integration → Hass Agent Overlay**. MQTT must already be configured.
3. Enable once. Existing and future hass-agent devices get a **Media** entity on
   their existing Mac device. No second Mac device is created.

Alternatively, enable with this YAML and restart:

```yaml
hass_agent_overlay: {}
```

Both setup paths select the same singleton config entry. If no players appear
yet, setup is still complete: leave it enabled, install/start hass-agent in the
Mac's logged-in desktop session, and check that its MQTT **Now Playing** sensor
has appeared. Players are added automatically when that source registers. The
source Now Playing and Last Media Action sensors must remain enabled. Entity
renames are supported; the integration discovers by MQTT unique IDs and device
registry identity, not entity names.

The diagnostic **Hass Agent Overlay discovery** sensor shows **Waiting for a Mac**
until a source registers, then **Ready** with the number of players. This is
discovery status, not a claim that a logged-out/offline Mac can play music.

The **Media** entity is the primary music control surface. Existing MQTT sensors
and buttons remain for compatibility and diagnostics; they can be hidden from
dashboards, but disabling the source/result sensors disables their companion.

## Behavior and controls

- Actual `playing`, `paused` and healthy `idle` states; stale/offline/logged-out
  readers become `unavailable`. Idle/unavailable clear track metadata and expose
  no actionable controls. A broker reconnect fences the last producer observation and requires a newer
  timestamp or a new agent session, still within the freshness limit; it does
  not assume the HA and Mac clocks are identical.
- Native title, artist, album, duration and position. Position uses the original
  source timestamp, never publication time. HA's rate-1 extrapolation is enabled
  only for known normal-rate playback; unsupported/unknown rates retain the raw
  position without a false running timeline.
- Play, pause, previous, next, plus HA's contextual play/pause service. No volume,
  seek, source selection, app launch, `play_media`, or power controls.
- Optional genuine native cover art through standard HA `entity_picture` and
  its media-player proxy. No public cover URL, title search or Mac connection.
  PNG/JPEG only, at most 512 KiB, 4096px per edge, 16 million pixels and one frame.
  Image bytes stay in a bounded memory cache, not entity attributes/recorder.
  Fresh paused playback keeps its art; track/source/session changes, idle,
  unavailable, disconnect, expiry or unload clear it. Missing/invalid/oversized
  art does not affect metadata or transport. The Mac rechecks missing art after
  five seconds initially, then every thirty seconds; late art can appear later.
- Snapshot freshness is independently checked at 15 seconds. No restored player
  metadata is accepted as current; existing MQTT LWT/expiry still apply.

Each action publishes a UUID-correlated, non-retained QoS-0 request to the fixed
`hass-agent/DEVICE_ID/media/command` topic using a fresh source session, version
and observation. Only one action per player can be pending. There is no queue,
automatic retry, or optimistic playback state. The integration waits at most
30 seconds for a matching result, cancelling pending work on an epoch change or
unload.

`last_media_action` contains the correlated receipt. `observed` means the agent
observed the requested state/change, not guaranteed causation. `submitted` means
only that the native helper returned; the service reports **sent but unconfirmed**
without changing the player state. `rejected` reports the Mac's reason. `unknown` or a missing receipt
raises a clear error: the action may have happened, so check playback before
trying again, especially for a skip. A later unrelated track change never
converts a missing receipt into success.

The backward-compatible metadata/control contract and additive artwork topic are documented in [Mac Now Playing](../../media/README.md).
Only MQTT sensor IDs `DEVICE_ID_now_playing` and `DEVICE_ID_media_last_action`
on device identifier `("mqtt", DEVICE_ID)` are accepted. Device IDs must be
1–128 ASCII letters, digits, `_` or `-`; MQTT wildcards and topic substitution
are not accepted. Unknown publishers cannot supply arbitrary command topics.

## Updates and rollback

The integration is installed separately from the Mac binary. Updating the Mac
does not overwrite it. Unload/delete its HA config entry to remove generated
players and cancel listeners/timers; the existing MQTT sensor/buttons and Mac
agent remain unchanged. To uninstall its files, remove the directory and YAML
enablement (if used), then restart HA. Do not delete or modify registry storage.

## Verification

Tested against HA 2026.8.3 / Python 3.14. The tests use real HA entity platforms,
entity/device registries, event dispatch and states; only MQTT network IO is
mocked. Install test dependencies in an isolated virtual environment:

```sh
uv venv --python 3.14 .venv-ha-media
uv pip install --python .venv-ha-media/bin/python -r tests/ha_media/requirements.txt
.venv-ha-media/bin/python -m pytest -c tests/ha_media/pytest.ini tests/ha_media
```

Inspired by the MQTT-to-native-player approach in
[TroyFernandes/hass-mqtt-mediaplayer](https://github.com/TroyFernandes/hass-mqtt-mediaplayer).
This is an independent implementation for hass-agent's existing correlated
protocol, not a copy of its per-player template/script configuration.
