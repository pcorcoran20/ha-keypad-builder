# ─────────────────────────────────────────────
#        ,,
#      <(@@)___     Patrick's nest
#       ( ._> /     quackomation for the homelab
#        `---'      hatched with love, waddles on HA
#
#  Muscovy Public License (a joke, not a license)
#  real one's in the LICENSE file. no feathers
#  were ruffled. this duck is legally un-binding
#  but will absolutely imprint on you.
# ─────────────────────────────────────────────

"""Keypad Builder: a visual editor for keypad button automations."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import (
    DOMAIN,
    PANEL_COMPONENT,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    STATIC_URL,
    VERSION,
)
from .organize import async_organize_all, async_track_organizing
from .websocket import async_setup_websocket

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up layout storage and the websocket API."""
    hass.data.setdefault(DOMAIN, {})
    await async_setup_websocket(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Register the static files and the sidebar panel."""
    data = hass.data.setdefault(DOMAIN, {})

    # Static paths can't be unregistered, so only add them once per HA run.
    if not data.get("static_registered"):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    STATIC_URL,
                    str(Path(__file__).parent / "frontend"),
                    cache_headers=False,
                )
            ]
        )
        data["static_registered"] = True

    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_COMPONENT,
        module_url=f"{STATIC_URL}/keypad-builder-panel.js?v={VERSION}",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        require_admin=True,
        config={},
    )

    # Tidy automations made before this version, then keep new ones tidy.
    async_organize_all(hass)
    for unsub in async_track_organizing(hass):
        entry.async_on_unload(unsub)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Remove the sidebar panel."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return True
