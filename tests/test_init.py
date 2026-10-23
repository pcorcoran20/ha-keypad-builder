"""Tests for setup, layouts and Lutron info."""

from types import SimpleNamespace
from unittest.mock import patch

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.keypad_builder.const import DOMAIN, PANEL_URL_PATH


async def _setup(hass: HomeAssistant) -> MockConfigEntry:
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, title="Keypad Builder")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_panel_registered_and_removed(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    assert entry.state is ConfigEntryState.LOADED
    assert PANEL_URL_PATH in hass.data["frontend_panels"]

    assert await hass.config_entries.async_unload(entry.entry_id)
    assert PANEL_URL_PATH not in hass.data["frontend_panels"]

    # reloading must not try to register the static path twice
    assert await hass.config_entries.async_setup(entry.entry_id)
    assert PANEL_URL_PATH in hass.data["frontend_panels"]


async def test_layout_round_trip(hass: HomeAssistant, hass_ws_client, hass_storage) -> None:
    await _setup(hass)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "keypad_builder/layouts/get"})
    assert (await client.receive_json())["result"] == {}

    layout = {"rows": [["on", "favorite"], ["off"]], "labels": {"favorite": "Dinner"}, "hidden": [], "finish": "brass", "junk": 1}
    await client.send_json_auto_id({"type": "keypad_builder/layouts/save", "device_id": "abc", "layout": layout})
    msg = await client.receive_json()
    assert msg["success"]
    assert "junk" not in msg["result"]

    await client.send_json_auto_id({"type": "keypad_builder/layouts/get"})
    assert (await client.receive_json())["result"]["abc"]["finish"] == "brass"
    assert hass_storage["keypad_builder.layouts"]["data"]["abc"]["labels"] == {"favorite": "Dinner"}

    await client.send_json_auto_id({"type": "keypad_builder/layouts/save", "device_id": "abc", "layout": None})
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id({"type": "keypad_builder/layouts/get"})
    assert (await client.receive_json())["result"] == {}


async def test_bad_layout_rejected(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "keypad_builder/layouts/save", "device_id": "abc", "layout": {"rows": "nope"}})
    assert not (await client.receive_json())["success"]


async def test_lutron_info(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass)

    keypad_data = SimpleNamespace(
        dr_device_id_to_keypad={
            "ra3_dev": {"lutron_device_id": 10, "type": "SunnataKeypad", "model": "HRST-W4B", "name": "Kitchen", "buttons": [101, 102, 103]},
            "pico_dev": {"lutron_device_id": 20, "type": "Pico3ButtonRaiseLower", "model": "PJ2-3BRL", "name": "Pico", "buttons": []},
        },
        buttons={
            101: {"leap_button_number": 1, "led_device_id": "501"},
            102: {"leap_button_number": 2, "led_device_id": None},
            103: {"leap_button_number": 18, "led_device_id": None},
        },
        button_names_to_leap={10: {"Raise": 18, "Dinner": 2, "Welcome": 1}},
    )
    lutron_entry = MockConfigEntry(domain="lutron_caseta")
    lutron_entry.add_to_hass(hass)
    lutron_entry.runtime_data = SimpleNamespace(keypad_data=keypad_data, bridge_device={"serial": 1234})
    # LED switch for button 1, registered the way lutron_caseta does it: "<hex bridge serial>_<led id>"
    er.async_get(hass).async_get_or_create(
        "switch", "lutron_caseta", "000004d2_501", suggested_object_id="kitchen_welcome_led", config_entry=lutron_entry
    )

    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "keypad_builder/lutron_info", "device_id": "ra3_dev"})
    result = (await client.receive_json())["result"]
    assert result["model"] == "HRST-W4B"
    assert result["buttons"] == [
        {"subtype": "Welcome", "number": 1, "led": True, "led_entity_id": "switch.kitchen_welcome_led"},
        {"subtype": "Dinner", "number": 2, "led": False, "led_entity_id": None},
        {"subtype": "Raise", "number": 18, "led": False, "led_entity_id": None},
    ]

    # Picos use HA's fixed button names, in physical order
    await client.send_json_auto_id({"type": "keypad_builder/lutron_info", "device_id": "pico_dev"})
    pico = (await client.receive_json())["result"]
    assert [b["subtype"] for b in pico["buttons"]] == ["on", "stop", "off", "raise", "lower"]

    await client.send_json_auto_id({"type": "keypad_builder/lutron_info", "device_id": "unknown"})
    assert (await client.receive_json())["result"] is None


async def test_button_automations(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass)
    other = MockConfigEntry(domain="test")
    other.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(config_entry_id=other.entry_id, identifiers={("test", "kp")})

    def device_trigger(subtype):
        return {"trigger": "device", "domain": "test", "device_id": device.id, "type": "press", "subtype": subtype}

    def event_trigger():
        return {"trigger": "event", "event_type": "x"}

    # automations only remember referenced devices for device triggers/actions,
    # so reference the device in an action and put the button in a device trigger
    act = [{"device_id": device.id, "domain": "test", "type": "turn_on", "entity_id": "light.x"}]
    hass.config.components.add("test")
    with patch(
        "homeassistant.components.device_automation.trigger.async_validate_trigger_config",
        side_effect=lambda hass, config: config,
    ), patch(
        "homeassistant.components.device_automation.action.async_validate_action_config",
        side_effect=lambda hass, config: config,
    ):
        assert await async_setup_component(
            hass,
            "automation",
            {
                "automation": [
                    {"id": "mine", "alias": "Old dinner", "triggers": [device_trigger("Dinner")], "actions": act},
                    {"id": "keypad_builder_x_dinner_press", "alias": "Ours", "triggers": [device_trigger("Dinner")], "actions": act},
                    {"id": "unrelated", "alias": "Unrelated", "triggers": [event_trigger()], "actions": act},
                ]
            },
        )
        await hass.async_block_till_done()

    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "keypad_builder/button_automations", "device_id": device.id})
    result = (await client.receive_json())["result"]
    by_id = {r["id"]: r for r in result}
    assert by_id["mine"]["triggers"] == [{"type": "press", "subtype": "Dinner"}]
    assert by_id["mine"]["name"] == "Old dinner"
    assert "keypad_builder_x_dinner_press" in by_id  # the panel filters its own out
    assert "unrelated" not in by_id
