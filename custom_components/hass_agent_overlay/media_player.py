"""Native HA media player backed by the existing hass-agent MQTT protocol."""

from __future__ import annotations

import asyncio
from datetime import datetime
import json
from typing import Any
from uuid import uuid4

from homeassistant.components import mqtt
from homeassistant.components.media_player import (
    MediaPlayerEntity, MediaPlayerEntityFeature, MediaPlayerState, MediaType,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.entity_platform import AddEntitiesCallback, async_get_current_platform
from homeassistant.helpers.event import async_call_later, async_track_state_change_event
from homeassistant.util import dt as dt_util

from .artwork import Artwork, MAX_PAYLOAD, decode_artwork
from .const import FRESHNESS_SECONDS, RESULT_TIMEOUT_SECONDS
from .discovery import Source, discover
from .snapshot import Snapshot, number, text, timestamp

TRANSPORT_FEATURES = (
    MediaPlayerEntityFeature.PLAY | MediaPlayerEntityFeature.PAUSE
    | MediaPlayerEntityFeature.PREVIOUS_TRACK | MediaPlayerEntityFeature.NEXT_TRACK
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Watch registry changes so late devices and renames require no reconfiguration."""
    players: dict[str, HassAgentMediaPlayer] = {}
    platform = async_get_current_platform()
    lock = asyncio.Lock()
    scheduled: Any = None
    closing = False

    async def reconcile() -> None:
        async with lock:
            sources = discover(hass)
            entry.runtime_data.update(len(sources))
            for agent_id in set(players) - sources.keys():
                player = players.pop(agent_id)
                if player.entity_id:
                    await player.async_remove()
            additions = []
            for agent_id, source in sources.items():
                if agent_id in players and players[agent_id].source_info.device_id != source.device_id:
                    player = players.pop(agent_id)
                    if player.entity_id:
                        await player.async_remove()
                if agent_id not in players:
                    players[agent_id] = HassAgentMediaPlayer(hass, source)
                    additions.append(players[agent_id])
                else:
                    players[agent_id].async_update_source(source)
            if additions:
                # Serialize registry retirement with completed entity addition;
                # a source removed during setup must not leave a queued orphan.
                await platform.async_add_entities(additions)

    @callback
    def run_reconcile(_now: Any) -> None:
        nonlocal scheduled
        scheduled = None
        if closing:
            return
        entry.async_create_background_task(hass, reconcile(), "discover hass-agent media players")

    @callback
    def registry_changed(event: Event) -> None:
        nonlocal scheduled
        if closing or scheduled is not None:
            return
        if event.event_type == er.EVENT_ENTITY_REGISTRY_UPDATED:
            entity_id = event.data.get("entity_id")
            source_ids = {s for p in players.values() for s in (p.source_info.entity_id, p.source_info.result_entity_id)}
            registered = er.async_get(hass).async_get(entity_id) if entity_id else None
            if entity_id not in source_ids and not (
                registered and registered.platform == "mqtt" and registered.unique_id.endswith(("_now_playing", "_media_last_action"))
            ):
                return
        elif event.data.get("device_id") not in {p.source_info.device_id for p in players.values()}:
            return
        scheduled = async_call_later(hass, 0.05, run_reconcile)

    @callback
    def stop_reconcile() -> None:
        nonlocal closing
        closing = True
        if scheduled:
            scheduled()

    for event in (er.EVENT_ENTITY_REGISTRY_UPDATED, dr.EVENT_DEVICE_REGISTRY_UPDATED):
        entry.async_on_unload(hass.bus.async_listen(event, registry_changed))
    entry.async_on_unload(stop_reconcile)
    await reconcile()


class HassAgentMediaPlayer(MediaPlayerEntity):
    """Expose only supported controls and never optimistically change playback."""

    _attr_has_entity_name = True
    _attr_name = "Media"
    _attr_should_poll = False
    _attr_icon = "mdi:music"

    def __init__(self, hass: HomeAssistant, source: Source) -> None:
        self.hass = hass
        self.source_info = source
        self._attr_unique_id = f"{source.agent_id}_media_player"
        # HA 2026.8 scopes identifier lookups to config entries. Reuse the
        # verified registry entry, as helpers do, rather than cloning the Mac.
        self.device_entry = dr.async_get(hass).async_get(source.device_id)
        self._snapshot: Snapshot | None = None
        self._unsubscribers: list[Any] = []
        self._expiry_cancel: Any = None
        self._added = False
        self._pending: asyncio.Future[dict[str, Any]] | None = None
        self._request: dict[str, str] | None = None
        self._last_result: dict[str, Any] | None = None
        self._last_observed: Snapshot | None = None
        self._require_newer_observation = False
        self._artwork: Artwork | None = None
        self._artwork_revision = 0
        self._artwork_task: asyncio.Task | None = None
        self._artwork_pending: bytes | str | None = None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._added = True
        self.async_on_remove(self._cleanup)
        self.async_on_remove(mqtt.async_subscribe_connection_status(self.hass, self._connection_changed))
        self._bind_source()
        self.async_on_remove(await mqtt.async_subscribe(
            self.hass, f"hass-agent/{self.source_info.agent_id}/media/artwork",
            self._artwork_message, qos=1, encoding=None,
        ))

    @callback
    def _clear_artwork(self) -> None:
        self._artwork_revision += 1
        self._artwork = None
        self._artwork_pending = None

    @callback
    def _artwork_message(self, message: Any) -> None:
        self._artwork_revision += 1
        payload = message.payload
        # Coalesce bursts into one worker plus one bounded latest payload.
        self._artwork_pending = payload if 0 < len(payload) <= MAX_PAYLOAD else None
        if self._artwork_pending is None:
            self._artwork = None
        if self._artwork_pending is not None and self._artwork_task is None:
            self._artwork_task = self.hass.async_create_task(self._decode_artwork(), "decode hass-agent artwork")
        self.async_write_ha_state()

    async def _decode_artwork(self) -> None:
        try:
            while self._added and self._artwork_pending is not None:
                payload = self._artwork_pending
                self._artwork_pending = None
                revision = self._artwork_revision
                art = await self.hass.async_add_executor_job(decode_artwork, payload)
                if revision == self._artwork_revision and self._added:
                    self._artwork = art
                    self.async_write_ha_state()
        finally:
            self._artwork_task = None

    @callback
    def _connection_changed(self, connected: bool) -> None:
        # A reconnect must wait for a genuinely newer producer observation,
        # rather than reviving the retained state that preceded the outage.
        self._require_newer_observation = True
        self._clear_artwork()
        self._snapshot = None
        if self._expiry_cancel:
            self._expiry_cancel()
            self._expiry_cancel = None
        self._abort_pending("The MQTT connection changed. Check playback before trying again.")
        self.async_write_ha_state()

    @callback
    def _cleanup(self) -> None:
        self._added = False
        self._clear_artwork()
        self._unbind_source()
        self._abort_pending("The media player was unloaded. Check playback before trying again.")

    @callback
    def _unbind_source(self) -> None:
        for unsubscribe in self._unsubscribers:
            unsubscribe()
        self._unsubscribers.clear()
        if self._expiry_cancel:
            self._expiry_cancel()
            self._expiry_cancel = None

    @callback
    def async_update_source(self, source: Source) -> None:
        if source == self.source_info:
            return
        self.source_info = source
        self._clear_artwork()
        if self._added:
            self._unbind_source()
            self._bind_source()
            self.async_write_ha_state()

    @callback
    def _bind_source(self) -> None:
        self._unsubscribers.append(async_track_state_change_event(
            self.hass, [self.source_info.entity_id], self._source_changed
        ))
        if self.source_info.result_entity_id:
            self._unsubscribers.append(async_track_state_change_event(
                self.hass, [self.source_info.result_entity_id], self._result_changed
            ))
        self._refresh()

    @callback
    def _source_changed(self, _event: Event) -> None:
        self._refresh()
        self.async_write_ha_state()

    @callback
    def _refresh(self) -> None:
        previous_artwork_key = self._snapshot.attributes.get("artwork_key") if self._snapshot else None
        self._snapshot = Snapshot.from_state(self.hass.states.get(self.source_info.entity_id))
        snapshot = self._snapshot
        previous = self._last_observed
        if snapshot is not None:
            # Compare producer timestamps only. HA's own reconnect clock may
            # differ from the Mac clock within the allowed freshness skew.
            if self._require_newer_observation and previous is None:
                self._last_observed = snapshot
                self._snapshot = None
            elif previous is not None and snapshot.session == previous.session and (
                snapshot.observed < previous.observed
                or self._require_newer_observation and snapshot.observed == previous.observed
            ):
                self._snapshot = None
            elif snapshot.fresh() and mqtt.is_connected(self.hass):
                self._last_observed = snapshot
                self._require_newer_observation = False
        if self._expiry_cancel:
            self._expiry_cancel()
            self._expiry_cancel = None
        snapshot = self._snapshot
        if snapshot is None or not snapshot.fresh() or snapshot.state == "idle":
            self._clear_artwork()
        elif (self._artwork is not None and self._artwork.key == previous_artwork_key
              and self._artwork.key != snapshot.attributes.get("artwork_key")):
            # Retire the old current image, but preserve a bounded newer envelope
            # that arrived ahead of its metadata. Serving is always key-gated.
            self._artwork = None
        if snapshot is not None and snapshot.fresh():
            delay = FRESHNESS_SECONDS - (dt_util.utcnow() - snapshot.observed).total_seconds()
            self._expiry_cancel = async_call_later(self.hass, delay + 0.05, self._expire)
        if self._request and (snapshot is None or not snapshot.fresh() or snapshot.session != self._request["session"]):
            self._abort_pending("The Mac playback connection changed. Refresh before trying again.")

    @callback
    def _expire(self, _now: Any) -> None:
        self._expiry_cancel = None
        self._clear_artwork()
        self._abort_pending("The Mac playback view expired. Check playback before trying again.")
        self.async_write_ha_state()

    @callback
    def _abort_pending(self, reason: str) -> None:
        if self._pending is not None and not self._pending.done():
            self._pending.set_exception(HomeAssistantError(reason))

    @property
    def current(self) -> Snapshot | None:
        value = self._snapshot
        return value if value is not None and value.fresh() and mqtt.is_connected(self.hass) else None

    @property
    def track(self) -> dict[str, Any]:
        snapshot = self.current
        return snapshot.attributes if snapshot and snapshot.state != "idle" else {}

    @property
    def available(self) -> bool:
        return self.current is not None

    @property
    def state(self) -> MediaPlayerState | None:
        snapshot = self.current
        return MediaPlayerState(snapshot.state) if snapshot else None

    @property
    def supported_features(self) -> MediaPlayerEntityFeature:
        snapshot = self.current
        return TRANSPORT_FEATURES if snapshot and snapshot.state != "idle" and self.source_info.result_entity_id else MediaPlayerEntityFeature(0)

    @property
    def current_artwork(self) -> Artwork | None:
        art = self._artwork
        key = self.track.get("artwork_key")
        return art if art is not None and art.key == key else None

    @property
    def media_image_hash(self) -> str | None:
        art = self.current_artwork
        # Include the per-track generation: A -> B -> A must not reuse an old URL.
        return f"{art.key}-{art.sha256}" if art else None

    async def async_get_media_image(self) -> tuple[bytes | None, str | None]:
        art = self.current_artwork
        return (art.data, art.mime) if art else (None, None)

    @property
    def media_content_type(self) -> MediaType | None:
        # The producer can be browser video as well as music: do not guess a type.
        return None

    @property
    def media_title(self) -> str | None:
        return text(self.track.get("title"))

    @property
    def media_artist(self) -> str | None:
        return text(self.track.get("artist"))

    @property
    def media_album_name(self) -> str | None:
        return text(self.track.get("album"))

    @property
    def media_duration(self) -> float | None:
        return number(self.track.get("duration"))

    @property
    def media_position(self) -> float | None:
        position = number(self.track.get("position"))
        duration = self.media_duration
        return min(position, duration) if position is not None and duration is not None else position

    @property
    def media_position_updated_at(self) -> datetime | None:
        # Native HA extrapolates at rate 1. Do not claim that timeline for a
        # playing source at another/unknown rate; retain raw data in attributes.
        if self.state == MediaPlayerState.PLAYING and self.track.get("rate") != 1:
            return None
        return timestamp(self.track.get("position_at")) if self.media_position is not None else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        snapshot = self.current
        return {
            "source_entity_id": self.source_info.entity_id,
            "agent_device_id": self.source_info.agent_id,
            "source_app": text(self.track.get("source"), 256),
            "observed_at": snapshot.observed_at if snapshot else None,
            "playback_rate": number(self.track.get("rate"), 8),
            "last_media_action": self._last_result,
        }

    @callback
    def _result_changed(self, event: Event) -> None:
        state = event.data.get("new_state")
        if state is None or self._request is None or self._pending is None or self._pending.done():
            return
        attrs = state.attributes
        if attrs.get("request_id") != self._request["request_id"] or attrs.get("action") != self._request["action"]:
            return
        status = attrs.get("status")
        if status not in ("rejected", "submitted", "observed", "unknown"):
            return
        result = {key: text(attrs.get(key)) for key in ("request_id", "action", "status", "reason", "timestamp")}
        self._last_result = result
        self._pending.set_result(result)
        self.async_write_ha_state()

    async def _command(self, action: str) -> None:
        if not mqtt.is_connected(self.hass):
            raise HomeAssistantError("MQTT is disconnected; no playback command was sent.")
        self._refresh()
        snapshot = self.current
        if snapshot is None or snapshot.state == "idle" or not self.source_info.result_entity_id:
            raise HomeAssistantError("No current Mac playback session. Refresh before trying again.")
        if self._pending is not None:
            raise HomeAssistantError("Another playback command is still pending. Check playback before trying again.")
        request = {
            "action": action, "request_id": uuid4().hex,
            "session": snapshot.session, "expected": snapshot.version,
            "observed_at": snapshot.observed_at,
        }
        self._request = request
        future = self._pending = self.hass.loop.create_future()
        try:
            await mqtt.async_publish(
                self.hass, f"hass-agent/{self.source_info.agent_id}/media/command",
                json.dumps(request), qos=0, retain=False,
            )
            result = await asyncio.wait_for(asyncio.shield(future), RESULT_TIMEOUT_SECONDS)
            if result["status"] == "rejected":
                raise HomeAssistantError(result.get("reason") or "The Mac declined the playback command.")
            if result["status"] == "unknown":
                raise HomeAssistantError("The Mac may have received the command, but could not confirm it. Check playback before trying again.")
            if result["status"] == "submitted":
                raise HomeAssistantError("Command sent, but the playback change was not confirmed. Check playback before trying again.")
        except TimeoutError as error:
            self._last_result = {"request_id": request["request_id"], "action": action, "status": "unknown", "reason": "No receipt received", "timestamp": dt_util.utcnow().isoformat()}
            self.async_write_ha_state()
            raise HomeAssistantError("No reply from the Mac. The command may have happened; check playback before trying again.") from error
        finally:
            if not future.done():
                future.cancel()
            # Retrieve a disconnect/unload exception even if publication failed.
            if future.done() and not future.cancelled():
                future.exception()
            self._pending = None
            self._request = None

    async def async_media_play(self) -> None:
        await self._command("play")

    async def async_media_pause(self) -> None:
        await self._command("pause")

    async def async_media_previous_track(self) -> None:
        await self._command("previous")

    async def async_media_next_track(self) -> None:
        await self._command("next")
