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

from custom_components.hass_agent_media.const import DOMAIN
from custom_components.hass_agent_media.discovery import discover
from custom_components.hass_agent_media import media_player as module
from custom_components.hass_agent_media.snapshot import Snapshot
from custom_components.hass_agent_media.runtime import Runtime


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


async def test_receipt_before_publish_returns_correlation_no_optimism(env):
    p = player(env)
    async def publish(_hass, topic, payload, **kwargs):
        request = json.loads(payload)
        assert topic == "hass-agent/mini/media/command"
        assert kwargs == {"qos": 0, "retain": False}
        assert len(request["request_id"]) == 32 and request["expected"] == "a" * 64
        await receipt(env, request, status="submitted")
    env[4].side_effect = publish
    with pytest.raises(HomeAssistantError, match="not confirmed"):
        await p.async_media_pause()
    assert p.state == "playing"
    assert p.extra_state_attributes["last_media_action"]["status"] == "submitted"


@pytest.mark.parametrize("status", ["observed", "rejected", "unknown"])
async def test_correlated_receipt_statuses(env, status):
    p = player(env)
    task = asyncio.create_task(p.async_media_pause())
    await asyncio.sleep(0)
    request = json.loads(env[4].call_args.args[2])
    await receipt(env, {**request, "request_id": uuid4().hex})
    assert not task.done()
    with pytest.raises(HomeAssistantError, match="pending"):
        await p.async_media_next_track()
    await receipt(env, request, status=status, reason="Refresh playback")
    if status == "observed":
        await task
    else:
        with pytest.raises(HomeAssistantError):
            await task
    assert p.state == "playing"
    assert env[4].call_count == 1


async def test_timeout_no_retry_and_new_session_fencing(env, monkeypatch):
    monkeypatch.setattr(module, "RESULT_TIMEOUT_SECONDS", 0.01)
    with pytest.raises(HomeAssistantError, match="may have happened"):
        await player(env).async_media_next_track()
    assert env[4].call_count == 1
    assert player(env).extra_state_attributes["last_media_action"]["status"] == "unknown"
    monkeypatch.setattr(module, "RESULT_TIMEOUT_SECONDS", 30)
    task = asyncio.create_task(player(env).async_media_pause())
    await asyncio.sleep(0)
    await update(env, session=str(uuid4()))
    with pytest.raises(HomeAssistantError, match="connection changed"):
        await task
    assert env[4].call_count == 2


async def test_unload_and_disconnect_block_and_cancel_commands(env, monkeypatch):
    monkeypatch.setattr(module.mqtt, "is_connected", lambda _: False)
    with pytest.raises(HomeAssistantError, match="disconnected"):
        await player(env).async_media_pause()
    env[4].assert_not_called()
    monkeypatch.setattr(module.mqtt, "is_connected", lambda _: True)
    p = player(env)
    task = asyncio.create_task(p.async_media_pause())
    await asyncio.sleep(0)
    p._cleanup()
    with pytest.raises(HomeAssistantError, match="unloaded"):
        await task
    assert p._expiry_cancel is None and not p._unsubscribers


async def test_connection_epoch_requires_new_observation_and_fences_pending(env):
    p = player(env)
    old = dict(env[0].states.get(p.source_info.entity_id).attributes)
    task = asyncio.create_task(p.async_media_pause())
    await asyncio.sleep(0)
    p._connection_changed(False)
    with pytest.raises(HomeAssistantError, match="MQTT connection changed"):
        await task
    p._connection_changed(True)
    p._refresh()
    assert not p.available
    env[0].states.async_set(p.source_info.entity_id, "playing", old)
    await env[0].async_block_till_done()
    assert not p.available
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
    from custom_components.hass_agent_media.sensor import DiscoveryStatus
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
    from custom_components.hass_agent_media.config_flow import HassAgentMediaConfigFlow
    hass = env[0]
    flow = HassAgentMediaConfigFlow()
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
