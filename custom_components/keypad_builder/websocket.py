"""Websocket API: saved keypad layouts + button info from the Lutron integration."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.importlib import async_import_module
from homeassistant.helpers.storage import Store

from .const import DOMAIN, STORAGE_KEY, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)

LUTRON_DOMAIN = "lutron_caseta"

LAYOUT_SCHEMA = vol.Schema(
    {
        vol.Required("rows"): [[str]],
        vol.Optional("labels", default={}): {str: str},
        vol.Optional("hidden", default=[]): [str],
        vol.Optional("finish", default="auto"): str,
    },
    extra=vol.REMOVE_EXTRA,
)


async def async_setup_websocket(hass: HomeAssistant) -> None:
    """Load saved layouts and register the websocket commands."""
    store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    data = hass.data[DOMAIN]
    data["store"] = store
    data["layouts"] = await store.async_load() or {}

    websocket_api.async_register_command(hass, ws_get_layouts)
    websocket_api.async_register_command(hass, ws_save_layout)
    websocket_api.async_register_command(hass, ws_lutron_info)


@websocket_api.websocket_command({vol.Required("type"): "keypad_builder/layouts/get"})
@websocket_api.require_admin
@callback
def ws_get_layouts(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return every saved layout, keyed by device registry id."""
    connection.send_result(msg["id"], hass.data[DOMAIN]["layouts"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): "keypad_builder/layouts/save",
        vol.Required("device_id"): str,
        vol.Required("layout"): vol.Any(None, LAYOUT_SCHEMA),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save_layout(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Save (or with layout=None, forget) one keypad's layout."""
    data = hass.data[DOMAIN]
    layouts: dict[str, Any] = data["layouts"]
    if msg["layout"] is None:
        layouts.pop(msg["device_id"], None)
    else:
        layouts[msg["device_id"]] = msg["layout"]
    await data["store"].async_save(layouts)
    connection.send_result(msg["id"], msg["layout"])


@websocket_api.websocket_command(
    {vol.Required("type"): "keypad_builder/lutron_info", vol.Required("device_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_lutron_info(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return button order, engravings and LEDs as programmed on the processor."""
    connection.send_result(msg["id"], await _async_lutron_info(hass, msg["device_id"]))


async def _async_lutron_info(hass: HomeAssistant, device_id: str) -> dict[str, Any] | None:
    """Read keypad data the Lutron integration already pulled over LEAP.

    This reaches into lutron_caseta's runtime data, which isn't a public API,
    so anything unexpected just returns None and the panel falls back to the
    device trigger list.
    """
    try:
        triggers = await async_import_module(
            hass, f"homeassistant.components.{LUTRON_DOMAIN}.device_trigger"
        )
        fixed_maps: dict[str, dict[str, int]] = getattr(
            triggers, "DEVICE_TYPE_SUBTYPE_MAP_TO_LEAP", {}
        )
    except ImportError:
        fixed_maps = {}

    for entry in hass.config_entries.async_entries(LUTRON_DOMAIN):
        keypad_data = getattr(getattr(entry, "runtime_data", None), "keypad_data", None)
        if keypad_data is None:
            continue
        keypad = keypad_data.dr_device_id_to_keypad.get(device_id)
        if keypad is None:
            continue
        try:
            # Picos have fixed names (on/off/raise...) in physical order;
            # RA3 keypads use the engravings, numbered top to bottom.
            if keypad["type"] in fixed_maps:
                names = list(fixed_maps[keypad["type"]].items())
            else:
                names = sorted(
                    keypad_data.button_names_to_leap[keypad["lutron_device_id"]].items(),
                    key=lambda item: item[1],
                )
            leds = {
                button["leap_button_number"]
                for button_id in keypad["buttons"]
                if (button := keypad_data.buttons.get(button_id))
                and button.get("led_device_id")
            }
            return {
                "name": keypad.get("name"),
                "model": keypad.get("model"),
                "type": keypad.get("type"),
                "buttons": [
                    {"subtype": name, "number": number, "led": number in leds}
                    for name, number in names
                ],
            }
        except (AttributeError, KeyError, TypeError) as err:
            _LOGGER.debug("Couldn't read Lutron keypad info for %s: %s", device_id, err)
            return None
    return None
