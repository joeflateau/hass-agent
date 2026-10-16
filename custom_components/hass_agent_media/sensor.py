"""Persistent setup feedback even when no Mac has registered yet."""

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .runtime import Runtime


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([DiscoveryStatus(entry.runtime_data)])


class DiscoveryStatus(SensorEntity):
    _attr_should_poll = False
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_name = "Hass Agent Media discovery"
    _attr_unique_id = f"{DOMAIN}_discovery_status"
    _attr_icon = "mdi:music-box-multiple"

    def __init__(self, runtime: Runtime) -> None:
        self.runtime = runtime

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        listener = self.async_write_ha_state
        self.runtime.listeners.add(listener)
        self.async_on_remove(lambda: self.runtime.listeners.discard(listener))

    @property
    def native_value(self) -> str:
        return "Ready" if self.runtime.player_count else "Waiting for a Mac"

    @property
    def extra_state_attributes(self) -> dict:
        return {
            "player_count": self.runtime.player_count,
            "detail": "Media players added; open the Mac's Media entity for playback status."
            if self.runtime.player_count else "Start hass-agent in the Mac's logged-in desktop session; players appear automatically.",
        }
