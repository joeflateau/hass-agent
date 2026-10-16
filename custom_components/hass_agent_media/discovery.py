"""Discover by MQTT registry identity, never by renameable entity names."""

from __future__ import annotations

from dataclasses import dataclass
import re

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er


@dataclass(frozen=True, slots=True)
class Source:
    agent_id: str
    entity_id: str
    result_entity_id: str | None
    device_id: str


def discover(hass: HomeAssistant) -> dict[str, Source]:
    """Only consume registered MQTT sensors on the matching MQTT device."""
    entities = er.async_get(hass)
    devices = dr.async_get(hass)
    sources = {}
    for entry in entities.entities.values():
        if (
            entry.platform != "mqtt"
            or not entry.entity_id.startswith("sensor.")
            or entry.disabled
            or not entry.unique_id.endswith("_now_playing")
        ):
            continue
        agent_id = entry.unique_id.removesuffix("_now_playing")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", agent_id):
            continue
        device = devices.async_get(entry.device_id)
        if device is None or ("mqtt", agent_id) not in device.identifiers:
            continue
        result_id = entities.async_get_entity_id("sensor", "mqtt", f"{agent_id}_media_last_action")
        result_entry = entities.async_get(result_id) if result_id else None
        if result_entry is None or result_entry.disabled or result_entry.device_id != device.id:
            result_id = None
        sources[agent_id] = Source(agent_id, entry.entity_id, result_id, device.id)
    return sources
