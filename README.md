# 🎛️ Keypad Builder

A visual editor for keypad button automations in Home Assistant. Made for **Lutron RA3** (and Caséta / Picos), but it can work with any device that has button triggers.

Pick a keypad → tap a button on the faceplate → choose what it does → **Save**. That's it ✨

## What it does

- Adds a **Keypad Builder** page to your sidebar (admins only)
- Lists your Lutron keypads, grouped by area
- Shows each keypad as a faceplate you can click (raise/lower buttons sit side by side)
- Lets you set separate actions for **pressed** and **released**
- Each button + press/release is saved as a **normal Home Assistant automation**, so you can still see and edit it in *Settings → Automations*
- A green dot shows which buttons already have something set up

### Actions you can pick

Toggle · Turn on · Turn off · Set light brightness (with fade) · Activate scene · Run script · Open/close/stop shade · Play/pause · Volume up/down · Wait · Custom action (any action + JSON data)

Steps the builder doesn't understand (like `choose` blocks you added in the HA editor) are shown as JSON and kept as-is.

## Requirements

- Home Assistant **2024.10** or newer
- The **Lutron Caséta** integration set up with your RA3 processor (it handles RA3 / HomeWorks QSX too)
- `automation: !include automations.yaml` in your config (this is the default)

## Install with HACS

1. HACS → ⋮ → **Custom repositories**
2. Add this repo's URL, category **Integration**
3. Install **Keypad Builder** and restart Home Assistant
4. *Settings → Devices & services → Add integration →* **Keypad Builder**
5. Open **Keypad Builder** in the sidebar 🎉

## Manual install

Copy `custom_components/keypad_builder` into your HA `config/custom_components/` folder, restart, then do step 4 above.

## How automations are named

Automation IDs look like `keypad_builder_<device id>_<button>_<press|release>`. Saving a button with no actions removes its automation. You can rename them in HA and the builder keeps your name.
