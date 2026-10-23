# Changelog

Release notes for each version. The Release workflow copies the matching section into the GitHub release, which is what HACS shows as the "release announcement".

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
