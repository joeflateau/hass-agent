"""Exercise real HA 2026.8.3 state, registry and entity-platform lifecycles.

Only broker IO is mocked; no test sends a native playback command.
"""

import asyncio
from datetime import timedelta
import json
import logging
from pathlib import Path
import sys
from types import MappingProxyType
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from homeassistant.config_entries import ConfigEntries, ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant, State
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.entity_platform import EntityPlatform
from homeassistant.util import dt as dt_util

from custom_components.hass_agent_overlay.const import DOMAIN
from custom_components.hass_agent_overlay.discovery import discover
from custom_components.hass_agent_overlay import media_player as module
from custom_components.hass_agent_overlay.snapshot import Snapshot
from custom_components.hass_agent_overlay.runtime import Runtime


def entry(domain):
    return ConfigEntry(
        version=1, minor_version=1, domain=domain, title=domain, source="user",
        data={}, options={}, unique_id=domain, discovery_keys=MappingProxyType({}),
        subentries_data=[], state=ConfigEntryState.LOADED,
    )


def attrs(**overrides):
    return {
        "session": "063c2fb6-511e-4e76-a624-2566fcc20878", "version": "a" * 64,
        "observed_at": dt_util.utcnow().isoformat(), "title": "Track", "artist": "Artist",
        "album": "Album", "source": "com.google.Chrome", "position": 12,
        "position_at": dt_util.utcnow().isoformat(), "duration": 120, "rate": 1,
        **overrides,
    }


@pytest.fixture
async def env(tmp_path, monkeypatch):
    hass = HomeAssistant(str(tmp_path))
    hass.config_entries = ConfigEntries(hass, {})
    await hass.config_entries.async_initialize()
    dr.async_setup(hass)
    await dr.async_load(hass, load_empty=True)
    await er.async_load(hass, load_empty=True)
    mqtt_entry, media_entry = entry("mqtt"), entry(DOMAIN)
    media_entry.runtime_data = Runtime()
    # Register real entries without booting the network-facing MQTT integration.
    for item in (mqtt_entry, media_entry):
        hass.config_entries._entries[item.entry_id] = item
    devices = dr.async_get(hass)
    device = devices.async_get_or_create(
        config_entry_id=mqtt_entry.entry_id, identifiers={("mqtt", "mini")}, name="Joe's Mac mini"
    )
    registry = er.async_get(hass)
    for name in ("now_playing", "media_last_action"):
        registry.async_get_or_create(
            "sensor", "mqtt", f"mini_{name}", config_entry=mqtt_entry,
            device_id=device.id, suggested_object_id=f"mini_{name}",
        )
    hass.states.async_set("sensor.mini_now_playing", "playing", attrs())
    monkeypatch.setattr(module.mqtt, "async_subscribe", AsyncMock(return_value=lambda: None))
    publish = AsyncMock()
    monkeypatch.setattr(module.mqtt, "async_publish", publish)
    monkeypatch.setattr(module.mqtt, "is_connected", lambda _: True)
    platform = EntityPlatform(
        hass=hass, logger=logging.getLogger(__name__), domain="media_player",
        platform_name=DOMAIN, platform=module, scan_interval=timedelta(seconds=30),
        entity_namespace=None,
    )
    assert await platform.async_setup_entry(media_entry)
    await hass.async_block_till_done()
    yield hass, registry, device, platform, publish
    await media_entry._async_process_on_unload(hass)
    await platform.async_reset()
    await hass.async_stop(force=True)


def player(env):
    return next(iter(env[3].entities.values()))


async def update(env, state="playing", **values):
    env[0].states.async_set(player(env).source_info.entity_id, state, attrs(**values))
    await env[0].async_block_till_done()


async def receipt(env, request, status="observed", **values):
    env[0].states.async_set("sensor.mini_media_last_action", status, {
        "request_id": request["request_id"], "action": request["action"],
        "status": status, "timestamp": dt_util.utcnow().isoformat(), **values,
    })
    await env[0].async_block_till_done()


async def test_real_platform_same_device_identity_and_native_metadata(env):
    hass, registry, device, platform, _ = env
    p = player(env)
    registered = registry.async_get(p.entity_id)
    assert registered.device_id == device.id
    assert len(dr.async_get(hass).devices) == 1
    assert registered.unique_id == "mini_media_player"
    state = hass.states.get(p.entity_id)
    assert state.state == "playing"
    assert state.attributes["media_title"] == "Track"
    assert state.attributes["media_artist"] == "Artist"
    assert state.attributes["media_position"] == 12
    assert state.attributes["supported_features"] == int(module.TRANSPORT_FEATURES)
    assert "volume_level" not in state.attributes
    assert "media_image_url" not in state.attributes


@pytest.mark.parametrize("state", ["paused", "idle", "unavailable"])
async def test_truthful_states_and_clearing(env, state):
    await update(env, state)
    p = player(env)
    assert p.state == (None if state == "unavailable" else state)
    assert p.available == (state != "unavailable")
    if state != "paused":
        assert p.media_title is None and p.media_position is None
        assert p.supported_features == 0
        with pytest.raises(HomeAssistantError):
            await p.async_media_play()
        env[4].assert_not_called()


async def test_expired_future_malformed_and_nonunit_timeline(env):
    for value in (dt_util.utcnow() - timedelta(seconds=16), dt_util.utcnow() + timedelta(seconds=3)):
        await update(env, observed_at=value.isoformat())
        assert not player(env).available and player(env).media_title is None
    await update(env, session="invalid")
    assert not player(env).available
    await update(env, rate=2)
    assert player(env).available and player(env).media_position_updated_at is None
    await update(env, position_at=None, position=float("nan"))
    assert player(env).media_position is None


async def test_expiry_timer_without_source_event(env, monkeypatch):
    p = player(env)
    future = dt_util.utcnow() + timedelta(seconds=16)
    monkeypatch.setattr(module.dt_util, "utcnow", lambda: future)
    p._expire(None)
    assert env[0].states.get(p.entity_id).state == "unavailable"
    assert p.media_title is None


async def test_registry_rename_rediscovery_disabled_and_late_device(env):
    hass, registry, device, platform, _ = env
    original_id = player(env).entity_id
    registry.async_update_entity("sensor.mini_now_playing", new_entity_id="sensor.renamed")
    hass.states.async_remove("sensor.mini_now_playing")
    hass.states.async_set("sensor.renamed", "paused", attrs())
    await asyncio.sleep(0.06)
    await hass.async_block_till_done()
    assert player(env).source_info.entity_id == "sensor.renamed"
    assert player(env).entity_id == original_id
    assert player(env).state == "paused"
    source = registry.async_get("sensor.renamed")
    registry.async_update_entity(source.entity_id, disabled_by=er.RegistryEntryDisabler.USER)
    await asyncio.sleep(0.06)
    await hass.async_block_till_done()
    assert not platform.entities
    registry.async_update_entity(source.entity_id, disabled_by=None)
    await asyncio.sleep(0.06)
    await hass.async_block_till_done()
    assert len(platform.entities) == 1
    assert player(env).entity_id == original_id


async def test_reject_mismatched_registry_identity_and_topic_injection(env):
    hass, registry, device, _, _ = env
    mqtt_entry = next(e for e in hass.config_entries.async_entries() if e.domain == "mqtt")
    for unique_id in ("other_now_playing", "mini/+/now_playing", "mini/+_now_playing"):
        registry.async_get_or_create("sensor", "mqtt", unique_id, config_entry=mqtt_entry, device_id=device.id)
    await hass.async_block_till_done()
    assert list(discover(hass)) == ["mini"]


async def test_service_returns_without_receipt_and_retains_transport_contract(env):
    p = player(env)
    await asyncio.wait_for(p.async_media_pause(), 0.1)
    request = json.loads(env[4].call_args.args[2])
    assert env[4].call_args.args[1] == "hass-agent/mini/media/command"
    assert env[4].call_args.kwargs == {"qos": 0, "retain": False}
    assert len(request["request_id"]) == 32 and request["expected"] == "a" * 64
    assert p.state == "paused" and p.assumed_state
    assert env[0].states.get(p.entity_id).attributes["assumed_state"] is True
    assert p._snapshot.state == "playing"
    assert p.extra_state_attributes["last_media_action"] is None


@pytest.mark.parametrize("status", ["observed", "submitted", "rejected", "unknown"])
async def test_receipts_diagnostic_even_before_publish_returns(env, status):
    p = player(env)
    async def publish(_hass, _topic, payload, **kwargs):
        await receipt(env, json.loads(payload), status=status, reason="Diagnostic")
    env[4].side_effect = publish
    await p.async_media_pause()
    assert p.extra_state_attributes["last_media_action"]["status"] == status
    assert p.assumed_state == (status not in ("rejected", "unknown"))
    assert p.state == ("paused" if p.assumed_state else "playing")


async def test_rapid_taps_late_receipt_and_no_invented_skip_metadata(env):
    p = player(env)
    await p.async_media_pause()
    first = json.loads(env[4].call_args.args[2])
    await p.async_media_play()
    second = json.loads(env[4].call_args.args[2])
    assert first["request_id"] != second["request_id"]
    assert p.assumed_state and p.state == "playing"
    await receipt(env, first, status="rejected")
    assert p.assumed_state and p.extra_state_attributes["last_media_action"] is None
    await receipt(env, {**second, "request_id": uuid4().hex})
    assert p.assumed_state
    await receipt(env, second, status="rejected")
    assert not p.assumed_state
    original = (p.media_title, p.media_position, p.media_image_hash)
    await p.async_media_next_track()
    await p.async_media_previous_track()
    assert (p.media_title, p.media_position, p.media_image_hash) == original
    assert not p.assumed_state and env[4].call_count == 4


async def test_publish_failure_clears_optimism_and_does_not_retry(env):
    p = player(env)
    env[4].side_effect = HomeAssistantError("MQTT failed")
    with pytest.raises(HomeAssistantError, match="MQTT failed"):
        await p.async_media_pause()
    assert p.state == "playing" and not p.assumed_state
    assert p._request is None and p._optimism_cancel is None and not p._sending
    assert env[4].call_count == 1


async def test_new_intent_clears_previous_diagnostic_and_fences_old_expiry(env):
    p = player(env)
    await p.async_media_pause()
    first = json.loads(env[4].call_args.args[2])
    await receipt(env, first, status="rejected")
    assert p.extra_state_attributes["last_media_action"]["status"] == "rejected"
    await p.async_media_play()
    assert p.assumed_state and p.state == "playing"
    assert p.extra_state_attributes["last_media_action"] is None
    p._expire_optimism(None, first["request_id"])
    assert p.assumed_state and p.state == "playing"
    assert env[4].call_count == 2


async def test_only_actual_publish_is_single_flight_no_queue(env):
    p = player(env)
    started, release = asyncio.Event(), asyncio.Event()
    async def publish(*args, **kwargs):
        started.set()
        await release.wait()
    env[4].side_effect = publish
    first = asyncio.create_task(p.async_media_pause())
    await started.wait()
    with pytest.raises(HomeAssistantError, match="being sent"):
        await p.async_media_play()
    assert p.state == "paused" and env[4].call_count == 1
    release.set()
    await first
    await p.async_media_play()
    assert p.state == "playing" and env[4].call_count == 2


async def test_cancelled_publication_clears_assumption_and_send_slot(env):
    p = player(env)
    started = asyncio.Event()
    async def publish(*args, **kwargs):
        started.set()
        await asyncio.Event().wait()
    env[4].side_effect = publish
    task = asyncio.create_task(p.async_media_pause())
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not p.assumed_state and p._request is None and not p._sending
    assert env[4].call_count == 1


@pytest.mark.parametrize("transition", ["observation", "disconnect", "unload"])
async def test_lifecycle_during_publication_does_not_restore_assumption(env, transition):
    p = player(env)
    started, release = asyncio.Event(), asyncio.Event()
    async def publish(*args, **kwargs):
        started.set()
        await release.wait()
    env[4].side_effect = publish
    task = asyncio.create_task(p.async_media_pause())
    await started.wait()
    assert p.assumed_state
    if transition == "observation":
        await update(env, "playing")
    elif transition == "disconnect":
        p._connection_changed(False)
    else:
        p._cleanup()
    release.set()
    await task
    assert not p.assumed_state and p._optimism_cancel is None
    assert env[4].call_count == 1 and not p._sending


async def test_new_observation_corrects_optimism_not_duplicate_state(env):
    p = player(env)
    await p.async_media_pause()
    old = dict(env[0].states.get(p.source_info.entity_id).attributes)
    env[0].states.async_set(p.source_info.entity_id, "playing", {**old, "unrelated": True})
    await env[0].async_block_till_done()
    assert p.state == "paused" and p.assumed_state
    await update(env, "playing")
    assert p.state == "playing" and not p.assumed_state
    assert p._optimism_cancel is None


@pytest.mark.parametrize("transition", ["session", "version", "source", "idle", "unavailable", "stale", "rename"])
async def test_context_transition_clears_intent_and_fences_receipts(env, transition):
    p = player(env)
    await p.async_media_pause()
    request = json.loads(env[4].call_args.args[2])
    if transition == "rename":
        from dataclasses import replace
        p.async_update_source(replace(p.source_info, entity_id="sensor.renamed"))
    elif transition in ("idle", "unavailable"):
        await update(env, transition)
    else:
        changes = {
            "session": {"session": str(uuid4())},
            "version": {"version": "b" * 64},
            "source": {"source": "com.spotify.client"},
            "stale": {"observed_at": (dt_util.utcnow() - timedelta(seconds=16)).isoformat()},
        }
        await update(env, **changes[transition])
    assert not p.assumed_state and p._optimism_cancel is None and p._request is None
    await receipt(env, request, status="submitted")
    assert p.extra_state_attributes["last_media_action"] is None


async def test_optimism_expiry_returns_to_observed_without_retry(env, monkeypatch):
    monkeypatch.setattr(module, "OPTIMISM_SECONDS", 0.01)
    p = player(env)
    await p.async_media_pause()
    assert p.state == "paused"
    await asyncio.sleep(0.02)
    assert p.state == "playing" and not p.assumed_state
    assert env[4].call_count == 1 and p._optimism_cancel is None


async def test_optimistic_timeline_freezes_and_resumes_at_tap(env, monkeypatch):
    now = dt_util.utcnow()
    await update(env, position=12, position_at=(now - timedelta(seconds=4)).isoformat(), observed_at=now.isoformat())
    p = player(env)
    monkeypatch.setattr(module.dt_util, "utcnow", lambda: now)
    await p.async_media_pause()
    assert p.media_position == 16 and p.media_position_updated_at == now
    later = now + timedelta(seconds=2)
    monkeypatch.setattr(module.dt_util, "utcnow", lambda: later)
    await p.async_media_play()
    assert p.media_position == 16 and p.media_position_updated_at == later
    assert p._snapshot.attributes["position"] == 12
    await update(env, "paused", rate=2, position=20, position_at=None, observed_at=later.isoformat())
    await p.async_media_play()
    assert p.media_position == 20 and p.media_position_updated_at is None


async def test_unload_and_disconnect_clear_intent_and_block_commands(env, monkeypatch):
    p = player(env)
    await p.async_media_pause()
    monkeypatch.setattr(module.mqtt, "is_connected", lambda _: False)
    p._connection_changed(False)
    assert not p.assumed_state and p._request is None and p._optimism_cancel is None
    with pytest.raises(HomeAssistantError, match="disconnected"):
        await p.async_media_play()
    monkeypatch.setattr(module.mqtt, "is_connected", lambda _: True)
    p._connection_changed(True)
    await update(env)
    await p.async_media_pause()
    p._cleanup()
    with pytest.raises(HomeAssistantError, match="unloaded"):
        await p.async_media_play()
    assert p._expiry_cancel is None and not p._unsubscribers and p._optimism_cancel is None


async def test_connection_epoch_requires_new_observation_and_fences_receipt(env):
    p = player(env)
    old = dict(env[0].states.get(p.source_info.entity_id).attributes)
    await p.async_media_pause()
    request = json.loads(env[4].call_args.args[2])
    p._connection_changed(False)
    p._connection_changed(True)
    p._refresh()
    assert not p.available and not p.assumed_state
    env[0].states.async_set(p.source_info.entity_id, "playing", old)
    await env[0].async_block_till_done()
    assert not p.available
    await receipt(env, request)
    assert p.extra_state_attributes["last_media_action"] is None
    await update(env)
    assert p.available


@pytest.mark.parametrize("skew", [-1, 1])
async def test_reconnect_compares_producer_high_water_not_ha_clock(env, skew):
    observed = dt_util.utcnow() + timedelta(seconds=skew)
    session = str(uuid4())
    await update(env, session=session, observed_at=observed.isoformat())
    p = player(env)
    p._connection_changed(False)
    p._connection_changed(True)
    p._refresh()
    assert not p.available
    await update(env, session=session, observed_at=(observed + timedelta(milliseconds=100)).isoformat())
    assert p.available
    await update(env, session=session, observed_at=observed.isoformat())
    assert not p.available


async def test_no_source_then_late_agent_is_discovered(env):
    hass, registry, device, platform, _ = env
    registry.async_remove("sensor.mini_now_playing")
    await asyncio.sleep(0.06)
    await hass.async_block_till_done()
    assert not platform.entities
    mqtt_entry = next(e for e in hass.config_entries.async_entries() if e.domain == "mqtt")
    registry.async_get_or_create("sensor", "mqtt", "mini_now_playing", config_entry=mqtt_entry, device_id=device.id)
    await asyncio.sleep(0.06)
    await hass.async_block_till_done()
    assert len(platform.entities) == 1


async def test_add_remove_during_pending_add_does_not_orphan_player(env, monkeypatch):
    hass, registry, device, platform, _ = env
    mqtt_entry = next(e for e in hass.config_entries.async_entries() if e.domain == "mqtt")
    late_device = dr.async_get(hass).async_get_or_create(config_entry_id=mqtt_entry.entry_id, identifiers={("mqtt", "late")}, name="Late Mac")
    started, release = asyncio.Event(), asyncio.Event()
    original = platform.async_add_entities
    async def delayed_add(entities, *args, **kwargs):
        started.set()
        await release.wait()
        await original(entities, *args, **kwargs)
    monkeypatch.setattr(platform, "async_add_entities", delayed_add)
    late = registry.async_get_or_create("sensor", "mqtt", "late_now_playing", config_entry=mqtt_entry, device_id=late_device.id)
    await asyncio.wait_for(started.wait(), 1)
    registry.async_remove(late.entity_id)
    await asyncio.sleep(0.06)
    release.set()
    await hass.async_block_till_done(wait_background_tasks=True)
    assert len(platform.entities) == 1
    assert player(env).source_info.agent_id == "mini"


async def test_discovery_status_survives_no_producer(env):
    from custom_components.hass_agent_overlay.sensor import DiscoveryStatus
    p = player(env)
    runtime = env[3].config_entry.runtime_data
    status = DiscoveryStatus(runtime)
    assert status.native_value == "Ready" and status.extra_state_attributes["player_count"] == 1
    env[1].async_remove(p.source_info.entity_id)
    await asyncio.sleep(0.06)
    await env[0].async_block_till_done()
    assert status.native_value == "Waiting for a Mac" and status.extra_state_attributes["player_count"] == 0


async def test_config_flow_singleton_and_missing_mqtt(env):
    from homeassistant.data_entry_flow import AbortFlow
    from custom_components.hass_agent_overlay.config_flow import HassAgentOverlayConfigFlow
    hass = env[0]
    flow = HassAgentOverlayConfigFlow()
    flow.hass, flow.context, flow.flow_id, flow.handler = hass, {"source": "user"}, uuid4().hex, DOMAIN
    with pytest.raises(AbortFlow, match="already_configured"):
        await flow.async_step_user({})
    media_entry = env[3].config_entry
    del hass.config_entries._entries[media_entry.entry_id]
    result = await flow.async_step_user({})
    assert result["type"] == "create_entry" and result["data"] == {}
    mqtt_entry = next(e for e in hass.config_entries.async_entries() if e.domain == "mqtt")
    del hass.config_entries._entries[mqtt_entry.entry_id]
    result = await flow.async_step_user({})
    assert result["type"] == "abort" and result["reason"] == "mqtt_required"


def art_payload(key=None, **overrides):
    import base64
    import hashlib
    from io import BytesIO
    from PIL import Image
    buffer = BytesIO()
    Image.new("RGB", (4, 4), (24, 80, 140)).save(buffer, "PNG")
    data = buffer.getvalue()
    return json.dumps({"key": key or str(uuid4()), "sha256": hashlib.sha256(data).hexdigest(),
                       "mime": "image/png", "data": base64.b64encode(data).decode(), **overrides}).encode(), data


async def deliver_art(env, payload):
    from types import SimpleNamespace
    player(env)._artwork_message(SimpleNamespace(payload=payload))
    await env[0].async_block_till_done()


async def test_artwork_standard_proxy_and_both_message_orders(env):
    p = player(env)
    key = str(uuid4())
    payload, data = art_payload(key)
    # Artwork can arrive before its metadata, even across an intervening old
    # observation; never display it under the old track or lose it to that poll.
    old_key = str(uuid4())
    await update(env, artwork_key=old_key)
    await deliver_art(env, payload)
    assert p.media_image_hash is None
    await update(env, artwork_key=old_key)
    assert p.media_image_hash is None
    await update(env, artwork_key=key)
    assert await p.async_get_media_image() == (data, "image/png")
    picture = env[0].states.get(p.entity_id).attributes["entity_picture"]
    assert picture.startswith(f"/api/media_player_proxy/{p.entity_id}?")
    assert "cache=" + p.media_image_hash in picture
    assert p.media_image_url is None and not p.media_image_remotely_accessible
    assert "data" not in env[0].states.get(p.entity_id).attributes
    # Fresh paused state retains exactly this image and URL.
    await update(env, "paused", artwork_key=key)
    assert env[0].states.get(p.entity_id).attributes["entity_picture"] == picture
    assert await p.async_get_media_image() == (data, "image/png")
    # State before image: clear immediately, then accept only matching image.
    next_key = str(uuid4())
    await update(env, title="Next", version="b" * 64, artwork_key=next_key)
    assert p.media_image_hash is None and await p.async_get_media_image() == (None, None)
    payload, _ = art_payload(next_key)
    await deliver_art(env, payload)
    assert p.media_image_hash is not None
    # An old retained/late envelope cannot supply the new track's picture.
    old, _ = art_payload(key)
    await deliver_art(env, old)
    assert p.media_image_hash is None and await p.async_get_media_image() == (None, None)
    assert p.media_title == "Next" and p.supported_features == module.TRANSPORT_FEATURES


@pytest.mark.parametrize("state", ["idle", "unavailable", "stale", "disconnect", "new_session"])
async def test_artwork_clears_on_metadata_lifecycle(env, monkeypatch, state):
    p = player(env)
    key = str(uuid4())
    await update(env, artwork_key=key)
    payload, _ = art_payload(key)
    await deliver_art(env, payload)
    assert p.media_image_hash is not None
    if state == "stale":
        await update(env, artwork_key=key, observed_at=(dt_util.utcnow() - timedelta(seconds=16)).isoformat())
    elif state == "disconnect":
        monkeypatch.setattr(module.mqtt, "is_connected", lambda _: False)
        p._connection_changed(False)
    elif state == "new_session":
        await update(env, artwork_key=str(uuid4()), session=str(uuid4()))
    else:
        await update(env, state, artwork_key=key)
    assert p.media_image_hash is None
    assert await p.async_get_media_image() == (None, None)
    assert "entity_picture" not in env[0].states.get(p.entity_id).attributes


async def test_invalid_artwork_never_breaks_playback_metadata(env):
    from custom_components.hass_agent_overlay.artwork import MAX_PAYLOAD
    p = player(env)
    key = str(uuid4())
    await update(env, artwork_key=key)
    for payload in [b"{", b"[]", b"x" * (MAX_PAYLOAD + 1), art_payload(key, mime="image/svg+xml")[0],
                    art_payload(key, data="https://not-an-image.invalid")[0], art_payload(key, sha256="0" * 64)[0]]:
        await deliver_art(env, payload)
        assert p.media_image_hash is None
        assert p.media_title == "Track" and p.supported_features == module.TRANSPORT_FEATURES
    payload, data = art_payload(key)
    await deliver_art(env, payload)
    assert await p.async_get_media_image() == (data, "image/png")
    await deliver_art(env, b"")
    assert p.media_image_hash is None


async def test_slow_artwork_decode_cannot_resurrect_after_clear_or_unload(env, monkeypatch):
    import threading
    p = player(env)
    started, release = threading.Event(), threading.Event()
    original = module.decode_artwork
    def blocked(payload):
        started.set()
        release.wait(3)
        return original(payload)
    monkeypatch.setattr(module, "decode_artwork", blocked)
    key = str(uuid4())
    await update(env, artwork_key=key)
    payload, _ = art_payload(key)
    from types import SimpleNamespace
    p._artwork_message(SimpleNamespace(payload=payload))
    await asyncio.get_running_loop().run_in_executor(None, started.wait, 2)
    p._artwork_message(SimpleNamespace(payload=b""))
    release.set()
    await env[0].async_block_till_done()
    assert p.media_image_hash is None
    assert await p.async_get_media_image() == (None, None)


async def test_real_ha_media_image_view_auth_and_clearing(env):
    from types import SimpleNamespace
    from aiohttp import web
    from aiohttp.test_utils import make_mocked_request
    from homeassistant.components.http.const import KEY_AUTHENTICATED
    from homeassistant.components.media_player import MediaPlayerImageView
    p = player(env)
    key = str(uuid4())
    await update(env, artwork_key=key)
    payload, data = art_payload(key)
    await deliver_art(env, payload)
    view = MediaPlayerImageView(SimpleNamespace(get_entity=lambda _: p))
    request = make_mocked_request("GET", f"/api/media_player_proxy/{p.entity_id}?token={p.access_token}")
    request[KEY_AUTHENTICATED] = False
    response = await view.get(request, p.entity_id)
    assert response.status == 200 and response.body == data
    assert response.content_type == "image/png"
    denied = make_mocked_request("GET", f"/api/media_player_proxy/{p.entity_id}")
    denied[KEY_AUTHENTICATED] = False
    with pytest.raises(web.HTTPForbidden):
        await view.get(denied, p.entity_id)
    await update(env, "idle")
    response = await view.get(request, p.entity_id)
    assert response.status == 404
