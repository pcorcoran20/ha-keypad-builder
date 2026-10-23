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

"""Tests for keeping Keypad Builder automations organized."""

from unittest.mock import patch

from homeassistant.core import HomeAssistant
from homeassistant.helpers import (
    area_registry as ar,
    category_registry as cr,
    device_registry as dr,
    entity_registry as er,
    label_registry as lr,
)
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.keypad_builder.const import CATEGORY_NAME, DOMAIN, LABEL_NAME


async def _setup(hass: HomeAssistant) -> None:
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, title="Keypad Builder")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


def _keypad(hass: HomeAssistant, area_id: str | None) -> dr.DeviceEntry:
    lutron = MockConfigEntry(domain="lutron_caseta")
    lutron.add_to_hass(hass)
    registry = dr.async_get(hass)
    device = registry.async_get_or_create(config_entry_id=lutron.entry_id, identifiers={("lutron_caseta", "kp")})
    return registry.async_update_device(device.id, area_id=area_id) if area_id else device


def _automation(hass: HomeAssistant, unique_id: str) -> er.RegistryEntry:
    return er.async_get(hass).async_get_or_create("automation", "automation", unique_id)


def _category_name(hass: HomeAssistant, entry: er.RegistryEntry) -> str | None:
    category_id = entry.categories.get("automation")
    category = cr.async_get(hass).async_get_category(scope="automation", category_id=category_id) if category_id else None
    return category.name if category else None


def _label_names(hass: HomeAssistant, entry: er.RegistryEntry) -> set[str]:
    return {lr.async_get(hass).async_get_label(label_id).name for label_id in entry.labels}


async def test_new_automation_gets_area_category_label(hass: HomeAssistant) -> None:
    office = ar.async_get(hass).async_create("Patrick's Office")
    device = _keypad(hass, office.id)
    await _setup(hass)

    created = _automation(hass, f"keypad_builder_{device.id}_bright_press")
    await hass.async_block_till_done()
    entry = er.async_get(hass).async_get(created.entity_id)
    assert entry.area_id == office.id
    assert _category_name(hass, entry) == CATEGORY_NAME
    assert _label_names(hass, entry) == {LABEL_NAME}

    # not ours: left alone
    other = _automation(hass, "1700000000")
    await hass.async_block_till_done()
    other = er.async_get(hass).async_get(other.entity_id)
    assert other.area_id is None and not other.categories and not other.labels


async def test_existing_automations_tidied_but_user_choices_kept(hass: HomeAssistant) -> None:
    areas = ar.async_get(hass)
    office, garage = areas.async_create("Patrick's Office"), areas.async_create("Garage")
    device = _keypad(hass, office.id)
    ent_reg = er.async_get(hass)

    plain = _automation(hass, f"keypad_builder_{device.id}_bright_press")
    custom = _automation(hass, f"keypad_builder_{device.id}_relax_press")
    mine = cr.async_get(hass).async_create(scope="automation", name="Mine")
    ent_reg.async_update_entity(custom.entity_id, area_id=garage.id, categories={"automation": mine.category_id})

    await _setup(hass)  # setup sweeps existing automations

    plain = ent_reg.async_get(plain.entity_id)
    custom = ent_reg.async_get(custom.entity_id)
    assert plain.area_id == office.id and _category_name(hass, plain) == CATEGORY_NAME
    assert custom.area_id == garage.id and _category_name(hass, custom) == "Mine"
    assert LABEL_NAME in _label_names(hass, custom)


async def test_automations_follow_keypad_to_new_room(hass: HomeAssistant) -> None:
    areas = ar.async_get(hass)
    office, bedroom, garage = (areas.async_create(n) for n in ("Patrick's Office", "Main Bedroom", "Garage"))
    device = _keypad(hass, office.id)
    await _setup(hass)
    ent_reg = er.async_get(hass)

    following = _automation(hass, f"keypad_builder_{device.id}_bright_press")
    pinned = _automation(hass, f"keypad_builder_{device.id}_relax_press")
    await hass.async_block_till_done()
    ent_reg.async_update_entity(pinned.entity_id, area_id=garage.id)

    dr.async_get(hass).async_update_device(device.id, area_id=bedroom.id)
    await hass.async_block_till_done()
    assert ent_reg.async_get(following.entity_id).area_id == bedroom.id
    assert ent_reg.async_get(pinned.entity_id).area_id == garage.id


async def test_organize_command(hass: HomeAssistant, hass_ws_client) -> None:
    device = _keypad(hass, None)
    await _setup(hass)
    created = _automation(hass, f"keypad_builder_{device.id}_bright_press")
    await hass.async_block_till_done()

    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "keypad_builder/organize"})
    result = (await client.receive_json())["result"]
    assert result == [{"id": created.unique_id, "entity_id": created.entity_id, "device_id": device.id, "shared": False}]


async def _shared_automation(hass: HomeAssistant, unique_id: str, devices: list[dr.DeviceEntry]) -> str:
    """Load a real automation whose triggers are buttons on several keypads."""
    triggers = [
        {"trigger": "device", "domain": "lutron_caseta", "device_id": d.id, "type": "press", "subtype": "Bright"}
        for d in devices
    ]
    with patch(
        "homeassistant.components.device_automation.trigger.async_validate_trigger_config",
        side_effect=lambda hass, config: config,
    ):
        assert await async_setup_component(
            hass,
            "automation",
            {"automation": [{"id": unique_id, "alias": "Movie time", "triggers": triggers, "actions": []}]},
        )
        await hass.async_block_till_done()
    return er.async_get(hass).async_get_entity_id("automation", "automation", unique_id)


def _two_keypads(hass: HomeAssistant, area_a: str, area_b: str) -> list[dr.DeviceEntry]:
    lutron = MockConfigEntry(domain="lutron_caseta")
    lutron.add_to_hass(hass)
    registry = dr.async_get(hass)
    return [
        registry.async_update_device(
            registry.async_get_or_create(config_entry_id=lutron.entry_id, identifiers={("lutron_caseta", name)}).id,
            area_id=area,
        )
        for name, area in (("a", area_a), ("b", area_b))
    ]


async def test_shared_action_in_one_room_gets_that_area(hass: HomeAssistant, hass_ws_client) -> None:
    office = ar.async_get(hass).async_create("Patrick's Office")
    devices = _two_keypads(hass, office.id, office.id)
    entity_id = await _shared_automation(hass, "keypad_builder_shared_movie_time_ab12", devices)
    await _setup(hass)

    entry = er.async_get(hass).async_get(entity_id)
    assert entry.area_id == office.id
    assert _category_name(hass, entry) == CATEGORY_NAME
    assert _label_names(hass, entry) == {LABEL_NAME}

    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "keypad_builder/automations"})
    assert (await client.receive_json())["result"] == [
        {"id": "keypad_builder_shared_movie_time_ab12", "entity_id": entity_id, "device_id": None, "shared": True}
    ]


async def test_shared_action_across_rooms_gets_no_area(hass: HomeAssistant) -> None:
    areas = ar.async_get(hass)
    devices = _two_keypads(hass, areas.async_create("Office").id, areas.async_create("Bedroom").id)
    entity_id = await _shared_automation(hass, "keypad_builder_shared_all_off_cd34", devices)
    await _setup(hass)

    entry = er.async_get(hass).async_get(entity_id)
    assert entry.area_id is None
    assert _category_name(hass, entry) == CATEGORY_NAME
