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

"""Websocket API: saved keypad layouts + button info from the Lutron integration."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
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
    websocket_api.async_register_command(hass, ws_button_automations)


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


@websocket_api.websocket_command(
    {vol.Required("type"): "keypad_builder/button_automations", vol.Required("device_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_button_automations(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """List every automation that uses one of this device's buttons as a trigger."""
    connection.send_result(msg["id"], await _async_button_automations(hass, msg["device_id"]))


async def _async_button_automations(hass: HomeAssistant, device_id: str) -> list[dict[str, Any]]:
    automation = await async_import_module(hass, "homeassistant.components.automation")
    component = hass.data.get(automation.DATA_COMPONENT)
    if component is None:
        return []

    found = []
    for entity_id in automation.automations_with_device(hass, device_id):
        entity = component.get_entity(entity_id)
        config = getattr(entity, "raw_config", None) or {}
        triggers = config.get("triggers", config.get("trigger")) or []
        if isinstance(triggers, dict):
            triggers = [triggers]
        buttons = [
            {"type": t.get("type"), "subtype": t.get("subtype")}
            for t in triggers
            if isinstance(t, dict) and t.get("device_id") == device_id and "subtype" in t
        ]
        if not buttons:
            continue
        state = hass.states.get(entity_id)
        found.append(
            {
                "entity_id": entity_id,
                "id": config.get("id"),
                "name": state.name if state else entity_id,
                "triggers": buttons,
            }
        )
    return found


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

    try:
        util = await async_import_module(hass, f"homeassistant.components.{LUTRON_DOMAIN}.util")
        serial_to_unique_id = util.serial_to_unique_id
    except (ImportError, AttributeError):
        serial_to_unique_id = None
    ent_reg = er.async_get(hass)

    for entry in hass.config_entries.async_entries(LUTRON_DOMAIN):
        runtime_data = getattr(entry, "runtime_data", None)
        keypad_data = getattr(runtime_data, "keypad_data", None)
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
                button["leap_button_number"]: button["led_device_id"]
                for button_id in keypad["buttons"]
                if (button := keypad_data.buttons.get(button_id))
                and button.get("led_device_id")
            }
            # LED switches use "<bridge serial>_<led id>" as unique id (RA3 has no LED serials)
            bridge_serial = (getattr(runtime_data, "bridge_device", None) or {}).get("serial")

            def led_entity(number: int) -> str | None:
                if number not in leds or bridge_serial is None or serial_to_unique_id is None:
                    return None
                return ent_reg.async_get_entity_id(
                    "switch", LUTRON_DOMAIN, f"{serial_to_unique_id(bridge_serial)}_{leds[number]}"
                )

            return {
                "name": keypad.get("name"),
                "model": keypad.get("model"),
                "type": keypad.get("type"),
                "buttons": [
                    {
                        "subtype": name,
                        "number": number,
                        "led": number in leds,
                        "led_entity_id": led_entity(number),
                    }
                    for name, number in names
                ],
            }
        except (AttributeError, KeyError, TypeError) as err:
            _LOGGER.debug("Couldn't read Lutron keypad info for %s: %s", device_id, err)
            return None
    return None
