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

"""Keep Keypad Builder automations tidy: keypad's area, a Keypads category and a label."""

from __future__ import annotations

import re
from typing import Any

from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.event import async_call_later
from homeassistant.helpers import (
    category_registry as cr,
    device_registry as dr,
    entity_registry as er,
    label_registry as lr,
)

from .const import CATEGORY_ICON, CATEGORY_NAME, LABEL_COLOR, LABEL_ICON, LABEL_NAME

# Our automation ids look like keypad_builder_<32 hex device id>_<button>_<type>,
# or keypad_builder_shared_<name>_<random> for one action shared by many buttons.
AUTOMATION_ID = re.compile(r"^keypad_builder_([0-9a-f]{32})_")
SHARED_PREFIX = "keypad_builder_shared_"


def _is_ours(entry: er.RegistryEntry) -> bool:
    return (
        entry.domain == "automation"
        and entry.platform == "automation"
        and (AUTOMATION_ID.match(entry.unique_id) is not None or entry.unique_id.startswith(SHARED_PREFIX))
    )


def _device_id(entry: er.RegistryEntry) -> str | None:
    if not _is_ours(entry):
        return None
    match = AUTOMATION_ID.match(entry.unique_id)
    return match.group(1) if match else None


def _shared_area(hass: HomeAssistant, entity_id: str) -> str | None:
    """A shared action's area: the room its keypads share, if they're all in one."""
    component = hass.data.get("automation")
    automation = component.get_entity(entity_id) if component else None
    if automation is None:
        return None
    dev_reg = dr.async_get(hass)
    areas = {
        device.area_id
        for device_id in automation.referenced_devices
        if (device := dev_reg.async_get(device_id))
    }
    return areas.pop() if len(areas) == 1 else None


@callback
def _category_id(hass: HomeAssistant) -> str:
    registry = cr.async_get(hass)
    for category in registry.async_list_categories(scope="automation"):
        if category.name == CATEGORY_NAME:
            return category.category_id
    return registry.async_create(scope="automation", name=CATEGORY_NAME, icon=CATEGORY_ICON).category_id


@callback
def _label_id(hass: HomeAssistant) -> str:
    registry = lr.async_get(hass)
    if label := registry.async_get_label_by_name(LABEL_NAME):
        return label.label_id
    return registry.async_create(LABEL_NAME, icon=LABEL_ICON, color=LABEL_COLOR).label_id


@callback
def async_organize_entity(hass: HomeAssistant, entity_id: str, *, set_area: bool) -> bool:
    """Give one of our automations its keypad's area, the category and the label.

    Only fills things in: a category or area the user picked themselves is kept,
    unless set_area is True (new automations follow their keypad).
    Returns True if it's one of ours.
    """
    ent_reg = er.async_get(hass)
    entry = ent_reg.async_get(entity_id)
    if entry is None or not _is_ours(entry):
        return False

    changes: dict[str, Any] = {}
    if device_id := _device_id(entry):
        device = dr.async_get(hass).async_get(device_id)
        area_id = device.area_id if device else None
    else:
        area_id = _shared_area(hass, entity_id)
    if area_id and entry.area_id != area_id and (set_area or entry.area_id is None):
        changes["area_id"] = area_id
    if "automation" not in entry.categories:
        changes["categories"] = {**entry.categories, "automation": _category_id(hass)}
    label_id = _label_id(hass)
    if label_id not in entry.labels:
        changes["labels"] = {*entry.labels, label_id}
    if changes:
        ent_reg.async_update_entity(entity_id, **changes)
    return True


@callback
def async_list_ours(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Every Keypad Builder automation (device_id is None for shared actions)."""
    return [
        {
            "id": entry.unique_id,
            "entity_id": entry.entity_id,
            "device_id": _device_id(entry),
            "shared": entry.unique_id.startswith(SHARED_PREFIX),
        }
        for entry in er.async_get(hass).entities.values()
        if _is_ours(entry)
    ]


@callback
def async_organize_all(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Tidy every Keypad Builder automation and list them."""
    ours = async_list_ours(hass)
    for item in ours:
        async_organize_entity(hass, item["entity_id"], set_area=False)
    return ours


@callback
def async_track_organizing(hass: HomeAssistant) -> list:
    """Organize new automations as they appear, and follow keypads that change rooms."""

    @callback
    def _entity_created(event: Event[er.EventEntityRegistryUpdatedData]) -> None:
        if event.data["action"] != "create":
            return
        entity_id = event.data["entity_id"]
        async_organize_entity(hass, entity_id, set_area=True)
        entry = er.async_get(hass).async_get(entity_id)
        if entry and entry.unique_id.startswith(SHARED_PREFIX):
            # a shared action's keypads are only known once the automation has finished loading
            cancel = None

            @callback
            def _retry(_now: Any) -> None:
                pending.discard(cancel)
                async_organize_entity(hass, entity_id, set_area=False)

            cancel = async_call_later(hass, 3, _retry)
            pending.add(cancel)

    @callback
    def _is_automation(data: er.EventEntityRegistryUpdatedData) -> bool:
        return data["entity_id"].startswith("automation.")

    @callback
    def _device_updated(event: Event[dr.EventDeviceRegistryUpdatedData]) -> None:
        if event.data["action"] != "update" or "area_id" not in event.data["changes"]:
            return
        old_area = event.data["changes"]["area_id"]
        device = dr.async_get(hass).async_get(event.data["device_id"])
        if device is None:
            return
        ent_reg = er.async_get(hass)
        for entry in list(ent_reg.entities.values()):
            # move automations that were still following the keypad's old room
            if _device_id(entry) == device.id and entry.area_id in (old_area, None):
                ent_reg.async_update_entity(entry.entity_id, area_id=device.area_id)

    pending: set = set()

    @callback
    def _stop() -> None:
        for cancel in list(pending):
            cancel()

    return [
        _stop,
        hass.bus.async_listen(
            er.EVENT_ENTITY_REGISTRY_UPDATED,
            _entity_created,
            event_filter=_is_automation,
        ),
        hass.bus.async_listen(dr.EVENT_DEVICE_REGISTRY_UPDATED, _device_updated),
    ]
