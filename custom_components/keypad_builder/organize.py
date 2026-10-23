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
from homeassistant.helpers import (
    category_registry as cr,
    device_registry as dr,
    entity_registry as er,
    label_registry as lr,
)

from .const import CATEGORY_ICON, CATEGORY_NAME, LABEL_COLOR, LABEL_ICON, LABEL_NAME

# Our automation ids look like keypad_builder_<32 hex device id>_<button>_<type>
AUTOMATION_ID = re.compile(r"^keypad_builder_([0-9a-f]{32})_")


def _device_id(entry: er.RegistryEntry) -> str | None:
    if entry.domain != "automation" or entry.platform != "automation":
        return None
    match = AUTOMATION_ID.match(entry.unique_id)
    return match.group(1) if match else None


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
    if entry is None or (device_id := _device_id(entry)) is None:
        return False

    changes: dict[str, Any] = {}
    device = dr.async_get(hass).async_get(device_id)
    if device and device.area_id and entry.area_id != device.area_id and (set_area or entry.area_id is None):
        changes["area_id"] = device.area_id
    if "automation" not in entry.categories:
        changes["categories"] = {**entry.categories, "automation": _category_id(hass)}
    label_id = _label_id(hass)
    if label_id not in entry.labels:
        changes["labels"] = {*entry.labels, label_id}
    if changes:
        ent_reg.async_update_entity(entity_id, **changes)
    return True


@callback
def async_organize_all(hass: HomeAssistant) -> list[dict[str, str]]:
    """Tidy every Keypad Builder automation and list them."""
    found = []
    for entry in list(er.async_get(hass).entities.values()):
        if async_organize_entity(hass, entry.entity_id, set_area=False):
            found.append({"id": entry.unique_id, "entity_id": entry.entity_id, "device_id": _device_id(entry)})
    return found


@callback
def async_track_organizing(hass: HomeAssistant) -> list:
    """Organize new automations as they appear, and follow keypads that change rooms."""

    @callback
    def _entity_created(event: Event[er.EventEntityRegistryUpdatedData]) -> None:
        if event.data["action"] == "create":
            async_organize_entity(hass, event.data["entity_id"], set_area=True)

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

    return [
        hass.bus.async_listen(
            er.EVENT_ENTITY_REGISTRY_UPDATED,
            _entity_created,
            event_filter=_is_automation,
        ),
        hass.bus.async_listen(dr.EVENT_DEVICE_REGISTRY_UPDATED, _device_updated),
    ]
