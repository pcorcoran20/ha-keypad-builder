# Keypad Builder

Personal Home Assistant hobby project by Patrick (pcorcoran20). No company attribution anywhere.

## File header (required)

Every code file starts with this header. Use it for all existing files and for any new file you create.

```
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
```

Rules:
- Keep the duck art and wording exactly as-is. Only swap the comment characters for the language:
  `#` for Python/YAML/shell, `//` for JS/TS/C, `<!-- -->` for HTML/XML, and so on.
- Put it at the very top of the file, followed by a blank line.
- Skip formats that can't have comments (JSON).
- The "Muscovy Public License" is a joke. The real license lives in `LICENSE` at the repo root, never in the header.
  The project uses MIT (`LICENSE`, copyright "Patrick (pcorcoran20)"). Ask Patrick before changing it.

## Development

```bash
pip install pytest-homeassistant-custom-component pylutron-caseta
pytest
```
