# Changelog

Release notes for each version. The Release workflow copies the matching section into the GitHub release, which is what HACS shows as the "release announcement".

## v1.2.0

### 🔀 If / then / otherwise and more, right in the editor
- New step types: **🔀 If / then / otherwise**, **🔀 Choose** (several "when … do …" options plus an otherwise), **🔁 Repeat** (a number of times, while…, or until…) and **✋ Only keep going if…**
- Conditions without JSON: **Device is…**, **Number is above / below…**, **Sun** (after sunset etc.), **Time / day** (time range plus weekday chips), with **All of these / Any of these** matching
- Steps inside blocks work like normal steps: device tiles, settings, drag to reorder, even blocks inside blocks
- Changing a step into an "If" or "Repeat" wraps the step that was there inside it
- If something's missing, the message says exactly where (like "Action 2 → Then 1: pick a device")

### 📥 Imported automations show as normal steps
- Automations built in Home Assistant's own editor no longer show up as JSON. Its hidden extras (like `metadata`) are kept quietly in the background
- Device actions (turn on / off / toggle, shade open / close / stop) become normal steps
- Room, device, floor and label targets show as chips (🏠 Kitchen)
- Extra settings like `color_name` get a simple setting / value editor
- Anything still too fancy for the editor shows as a readable summary, with "Edit this step in HA's editor ↗" and the JSON tucked away under "Advanced"

### ⬆️ Updating
HACS → Keypad Builder → Update → restart Home Assistant → hard refresh your browser

## v1.1.0

### 💎 Liquid glass
- A new **Liquid glass** look: frosted see-through panels over a soft glowing background, light catching the glass edges, glossy buttons and smooth hover and press animations
- It's the new default look. Tap the 💎 button (top right) to switch between 💎 Liquid glass, 🌗 Match Home Assistant, ☀️ Light and 🌙 Dark
- New faceplate finishes: **Smoked glass** and **Frosted glass**. In the glass look, "Match light/dark mode" uses smoked glass
- Animations switch off if your device has "reduce motion" turned on

### ⬆️ Updating
HACS → Keypad Builder → Update → restart Home Assistant → hard refresh your browser

## v1.0.0

The big redesign 🎉

### 🖼️ Keypads that look like the real thing
- New faceplate styles: **Sunnata** (flat buttons, slim white status lights), **seeTouch** (beveled buttons, round LEDs, joined raise/lower rocker) and **Pico** (rounded remote, or a split paddle for paddle Picos). The old look is still there as **Classic**
- **Auto** picks the style from the model number. Change it any time in **Edit layout → Style**
- Raise/lower buttons show ▲ ▼ like the real engraving, and long engravings wrap onto two lines

### 🔲 Ganged wallboxes
- Keypads Lutron names "Position 1 / 2 / 3" in the same spot now show **side by side in one multi-gang wallplate**
- Tap any button on any keypad in the box to jump straight to it

### ✋ Drag and drop
- In **Edit layout**, drag buttons right on the keypad. Drop one on another button to put them side by side, or between rows to start a new row
- Action steps have a ⠿ handle, so you can drag them into a new order

### 🧱 Device tiles
- "Choose what to control" is now a grid of tiles with checkboxes, room filter and type chips (💡 Lights, 🪟 Shades…)
- **One step can control several things at once.** Pick as many tiles as you like, or use **Select all** for a room
- Existing steps that already controlled several things now show as one step instead of being split up

### ⬆️ Updating
HACS → Keypad Builder → Update → restart Home Assistant → hard refresh your browser

## v0.7.0

### 📥 Import existing automations
- Automations you made before Keypad Builder now have an **Import** button in a button's "Other automations using this button" list
- One that uses just that button becomes its actions in Keypad Builder. If the button already has actions, the imported ones get added after them
- One that uses several buttons (or buttons plus other triggers) becomes a 🔗 shared action
- The name, conditions and settings all come along
- Pick **Move it** (the original is removed, so nothing runs twice) or **Copy it** (the original stays, but gets turned off)
- Automations that mix pressed and released, or live in YAML files, can't be imported. The window says why and links to Home Assistant instead

### ⬆️ Updating
HACS → Keypad Builder → Update → restart Home Assistant → hard refresh your browser

## v0.6.2

Same features as v0.6.1, just some repo housekeeping 🧹

- Added a contributing guide (`CONTRIBUTING.md`) with the file header rules and release steps
- No changes to the integration itself, so updating is optional

### ⬆️ Updating
HACS → Keypad Builder → Update → restart Home Assistant

## v0.6.1

First proper release of Keypad Builder 🎛️🦆

### ✨ What's in it
- **Visual keypad builder** for Lutron RA3 / Caséta / Picos: tap a button, pick what it does, save
- **Pressed, released and multi tap** actions, saved as normal Home Assistant automations
- **Button order and engravings** pulled straight from your RA3 processor
- **Layout editor**: rename, reorder, put buttons side by side, hide, and pick a faceplate finish
- **💡 LED control**: make an LED follow a device, or turn LEDs on/off as actions. Faceplate LEDs glow live
- **🔗 Shared actions**: one set of actions for buttons on lots of keypads
- **🔍 Entity picker**: search, plus filters for room and type
- **🗂️ Organized automations**: keypad's area, a "Keypads" category, a "Keypad Builder" label and tidy names
- **🔢 Set up badges** and a "Set up first" sort
- **🌙 Dark mode**, open-in-HA-editor links, and a list of other automations that use each button

### 🆕 New in this version
- The icon now ships with the integration, so it shows in HA without a brands repo PR (needs HA 2026.3+)
- Real version numbers in HACS from now on

### ⬆️ Updating
HACS → Keypad Builder → Update → restart Home Assistant → hard refresh your browser
