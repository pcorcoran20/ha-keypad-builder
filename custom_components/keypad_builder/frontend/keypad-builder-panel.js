// ─────────────────────────────────────────────
//        ,,
//      <(@@)___     Patrick's nest
//       ( ._> /     quackomation for the homelab
//        `---'      hatched with love, waddles on HA
//
//  Muscovy Public License (a joke, not a license)
//  real one's in the LICENSE file. no feathers
//  were ruffled. this duck is legally un-binding
//  but will absolutely imprint on you.
// ─────────────────────────────────────────────

// Keypad Builder panel: pick a keypad, click a button, choose what it does.
// Each button + trigger type (press/release) is saved as one normal HA automation.

const ID_PREFIX = "keypad_builder";
const DEFAULT_DOMAIN = "lutron_caseta";

const TOGGLE_DOMAINS = ["light", "switch", "fan", "input_boolean", "cover", "media_player", "group"];

const PRESETS = [
  { service: "homeassistant.toggle", label: "Toggle", domains: TOGGLE_DOMAINS },
  { service: "homeassistant.turn_on", label: "Turn on", domains: TOGGLE_DOMAINS },
  { service: "homeassistant.turn_off", label: "Turn off", domains: TOGGLE_DOMAINS },
  { service: "light.turn_on", label: "Set light brightness", domains: ["light"], brightness: true },
  { service: "scene.turn_on", label: "Activate scene", domains: ["scene"] },
  { service: "script.turn_on", label: "Run script", domains: ["script"] },
  { service: "automation.trigger", label: "Run another automation", domains: ["automation"] },
  { service: "cover.open_cover", label: "Open shade", domains: ["cover"] },
  { service: "cover.close_cover", label: "Close shade", domains: ["cover"] },
  { service: "cover.stop_cover", label: "Stop shade", domains: ["cover"] },
  { service: "media_player.media_play_pause", label: "Play / pause", domains: ["media_player"] },
  { service: "media_player.volume_up", label: "Volume up", domains: ["media_player"] },
  { service: "media_player.volume_down", label: "Volume down", domains: ["media_player"] },
  { service: "switch.turn_on", label: "Keypad LED on", domains: ["switch"], led: true },
  { service: "switch.turn_off", label: "Keypad LED off", domains: ["switch"], led: true },
  { service: "switch.toggle", label: "Keypad LED toggle", domains: ["switch"], led: true },
];

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const slug = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const pretty = (v) =>
  String(v).replace(/_/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());

const typeLabel = (t) => ({ press: "When pressed", release: "When released" })[t] || `When ${pretty(t).toLowerCase()}`;

const autoId = (deviceId, subtype, type) => `${ID_PREFIX}_${deviceId}_${slug(subtype)}_${slug(type)}`;
// Names that sort nicely in HA's automation list: "Patrick's Office · Entry · Bright · pressed"
function makeAlias(device, label, kind) {
  const what = kind === "led" ? "LED" : typeLabel(kind).replace(/^When /, "");
  return [device?.area, device?.title || device?.name || "Keypad", label, what].filter(Boolean).join(" · ");
}

// Names made before 0.5: "Keypad · <device> · <label> (<Type>)" and "Keypad LED · <device> · <label>"
const OLD_ALIAS = /^Keypad( LED)? · (.+) · (.+?)(?: \(([^)]+)\))?$/;
const keepAlias = (alias) => (alias && !OLD_ALIAS.test(alias) ? alias : null);

const ledId = (deviceId, subtype) => `${ID_PREFIX}_${deviceId}_${slug(subtype)}_led`;
const isOurs = (id) => String(id || "").startsWith(`${ID_PREFIX}_`);
const SHARED_PREFIX = `${ID_PREFIX}_shared_`;
const memberKey = (deviceId, subtype) => `${deviceId}|${subtype}`;

// The keypad buttons a shared action listens to (its device triggers).
function sharedMembers(config) {
  return [].concat(config?.triggers ?? config?.trigger ?? [])
    .filter((t) => (t.trigger || t.platform) === "device" && t.device_id && t.subtype != null)
    .map((t) => ({ deviceId: t.device_id, subtype: String(t.subtype), type: t.type }));
}

const SORT_KEY = "keypad-builder-sort";
function loadSort() {
  try {
    return localStorage.getItem(SORT_KEY) === "setup" ? "setup" : "room";
  } catch (e) {
    return "room";
  }
}

const presetFor = (service) => PRESETS.find((p) => p.service === service);

const FINISHES = [
  ["auto", "Match light/dark mode"],
  ["white", "White"],
  ["ivory", "Ivory"],
  ["gray", "Gray"],
  ["black", "Black"],
  ["brass", "Brass"],
  ["nickel", "Nickel"],
];

const THEME_KEY = "keypad-builder-theme";
const THEME_MODES = ["auto", "light", "dark"];
const THEME_ICONS = { auto: "🌗", light: "☀️", dark: "🌙" };

const isRaise = (label) => /^(raise|up)\b/i.test(label);
const isLower = (label) => /^(lower|down)\b/i.test(label);

// Default layout: one button per row, raise/lower side by side.
function autoLayout(buttons, finish = "auto") {
  const rows = [];
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    const next = buttons[i + 1];
    if (next && ((isLower(b.label) && isRaise(next.label)) || (isRaise(b.label) && isLower(next.label)))) {
      rows.push(isLower(b.label) ? [b.key, next.key] : [next.key, b.key]);
      i++;
    } else {
      rows.push([b.key]);
    }
  }
  return { rows, labels: {}, hidden: [], finish };
}

// Make a saved layout fit the buttons the keypad has now.
function reconcileLayout(saved, buttons) {
  const keys = new Set(buttons.map((b) => b.key));
  const seen = new Set();
  const rows = (saved.rows || [])
    .map((row) => row.filter((k) => keys.has(k) && !seen.has(k) && seen.add(k)))
    .filter((row) => row.length);
  for (const b of buttons) if (!seen.has(b.key)) rows.push([b.key]);
  const labels = Object.fromEntries(Object.entries(saved.labels || {}).filter(([k, v]) => keys.has(k) && v));
  const hidden = (saved.hidden || []).filter((k) => keys.has(k));
  return { rows, labels, hidden, finish: saved.finish || "auto" };
}

const cloneLayout = (l) => JSON.parse(JSON.stringify(l));

const TYPE_LABELS = {
  light: "💡 Lights",
  switch: "🔌 Switches",
  fan: "🌀 Fans",
  cover: "🪟 Shades & covers",
  scene: "🎬 Scenes",
  script: "📜 Scripts",
  automation: "🤖 Automations",
  media_player: "🔊 Media players",
  input_boolean: "✅ Toggle helpers",
  group: "👥 Groups",
  climate: "🌡️ Climate",
  lock: "🔒 Locks",
  sensor: "📈 Sensors",
  binary_sensor: "🚪 Binary sensors",
};
const domainLabel = (domain) => TYPE_LABELS[domain] || pretty(domain);

const LUTRON_TYPES = {
  SunnataKeypad: "Sunnata keypad",
  SunnataHybridKeypad: "Sunnata hybrid keypad",
  SeeTouchKeypad: "seeTouch keypad",
  SeeTouchTabletopKeypad: "seeTouch tabletop",
  HomeownerKeypad: "Homeowner keypad",
  PaddleSwitchPico: "Paddle Pico",
  FourGroupRemote: "4-group remote",
};

// "RRST-W4B-XX (SunnataKeypad)" -> { type: "Sunnata keypad", code: "RRST-W4B-XX" }
function friendlyModel(model) {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(model || "");
  const code = (m ? m[1] : model || "").trim();
  const raw = m ? m[2] : "";
  let type = LUTRON_TYPES[raw];
  if (!type && /^Pico/.test(raw)) type = "Pico remote";
  if (!type && raw) type = raw.replace(/([a-z])([A-Z])/g, "$1 $2");
  return { type: type || "", code };
}

// Lutron names devices "<Room> <Location> Position <n> <Kind>". The room is already the
// list heading, so show just the location ("Entry") and keep the position for gangs.
function splitDeviceName(name, area) {
  let rest = name;
  if (area && rest.toLowerCase().startsWith(`${area.toLowerCase()} `)) rest = rest.slice(area.length + 1);
  const m = /^(.*?)\s*\bPosition\s+(\d+)\s*(.*)$/i.exec(rest);
  if (m) return { title: m[1] || m[3] || rest, position: Number(m[2]) };
  return { title: rest || name, position: null };
}

function loadThemeMode() {
  try {
    const mode = localStorage.getItem(THEME_KEY);
    return THEME_MODES.includes(mode) ? mode : "auto";
  } catch (e) {
    return "auto";
  }
}

function delaySeconds(delay) {
  if (typeof delay === "number") return delay;
  if (typeof delay === "string" && /^\d+(:\d+){0,2}$/.test(delay)) {
    return delay.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
  }
  if (delay && typeof delay === "object") {
    const keys = Object.keys(delay);
    if (keys.every((k) => ["hours", "minutes", "seconds", "milliseconds"].includes(k))) {
      return (delay.hours || 0) * 3600 + (delay.minutes || 0) * 60 + (delay.seconds || 0) + (delay.milliseconds || 0) / 1000;
    }
  }
  return null;
}

// Turn a saved automation action into one or more editor rows.
// Anything we don't understand becomes a "raw" row so it's never lost.
function parseAction(action) {
  const raw = [{ kind: "raw", text: JSON.stringify(action, null, 2) }];
  const keys = Object.keys(action);

  if (keys.length === 1 && "delay" in action) {
    const seconds = delaySeconds(action.delay);
    return seconds == null ? raw : [{ kind: "delay", seconds }];
  }

  const service = action.action || action.service;
  if (!service || !keys.every((k) => ["action", "service", "target", "data", "entity_id"].includes(k))) return raw;
  if (action.target && Object.keys(action.target).some((k) => k !== "entity_id")) return raw;

  const data = { ...(action.data || {}) };
  let entities = action.target?.entity_id ?? action.entity_id ?? data.entity_id;
  delete data.entity_id;
  if (typeof entities === "string") entities = entities.split(",").map((e) => e.trim());
  entities = entities?.length ? entities : [""];

  const preset = presetFor(service);
  if (preset) {
    const extra = { ...data };
    let brightness = null;
    let transition = null;
    if (preset.brightness) {
      brightness = extra.brightness_pct ?? null;
      transition = extra.transition ?? null;
      delete extra.brightness_pct;
      delete extra.transition;
    }
    if (Object.keys(extra).length === 0) {
      return entities.map((entity) => ({ kind: "service", service, entity, brightness, transition }));
    }
  }

  const dataText = Object.keys(data).length ? JSON.stringify(data, null, 2) : "";
  return entities.map((entity) => ({ kind: "custom", service, entity, dataText }));
}

// Turn an editor row back into an automation action. Throws a friendly message on bad input.
function buildAction(row, index) {
  const n = index + 1;
  if (row.kind === "delay") {
    const seconds = Number(row.seconds);
    if (!(seconds >= 0)) throw new Error(`Action ${n}: wait time needs to be a number.`);
    return { delay: { seconds } };
  }
  if (row.kind === "raw") {
    try {
      return JSON.parse(row.text);
    } catch (e) {
      throw new Error(`Action ${n}: that JSON isn't valid (${e.message}).`);
    }
  }

  const service = (row.service || "").trim();
  if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(service)) throw new Error(`Action ${n}: pick an action like light.turn_on.`);
  const entity = (row.entity || "").trim();
  const out = { action: service };
  if (entity) out.target = { entity_id: entity };

  if (row.kind === "service") {
    if (!entity) throw new Error(`Action ${n}: pick a device/entity for "${presetFor(service)?.label || service}".`);
    if (presetFor(service)?.brightness) {
      const data = {};
      if (row.brightness !== null && row.brightness !== "") data.brightness_pct = Number(row.brightness);
      if (row.transition !== null && row.transition !== "") data.transition = Number(row.transition);
      if (Object.keys(data).length) out.data = data;
    }
    return out;
  }

  if (row.dataText && row.dataText.trim()) {
    try {
      out.data = JSON.parse(row.dataText);
    } catch (e) {
      throw new Error(`Action ${n}: extra data isn't valid JSON (${e.message}).`);
    }
  }
  return out;
}

// LED automations we write look like: state trigger on a source entity -> if on, LED on, else LED off.
function parseLed(config) {
  if (!config) return { mode: "lutron", entity: "", state: "on" };
  const trigger = [].concat(config.triggers ?? config.trigger ?? []).find((t) => (t.trigger || t.platform) === "state" && t.entity_id);
  const action = [].concat(config.actions ?? config.action ?? [])[0];
  const cond = action?.if?.[0];
  if (trigger && cond?.state != null && action.then && action.else) {
    return { mode: "follow", entity: [].concat(trigger.entity_id)[0], state: String(cond.state) };
  }
  return { mode: "custom", entity: "", state: "on" };
}

function newRow(kind) {
  if (kind === "delay") return { kind: "delay", seconds: 1 };
  if (kind === "custom") return { kind: "custom", service: "", entity: "", dataText: "" };
  return { kind: "service", service: kind, entity: "", brightness: presetFor(kind)?.brightness ? 100 : null, transition: null };
}

class KeypadBuilderPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._triggerCache = new Map();
    this._themeMode = loadThemeMode();
    this._s = {
      view: "keypad",
      ours: [],
      shared: {},
      sharedDraft: null,
      sort: loadSort(),
      ledConfigs: {},
      led: null,
      ledDirty: false,
      ledMsg: null,
      related: [],
      layouts: {},
      info: null,
      layout: null,
      layoutDraft: null,
      editingLayout: false,
      loading: true,
      allDevices: false,
      devices: [],
      filter: "",
      deviceId: null,
      loadingDevice: false,
      buttons: [],
      configs: {},
      sel: null,
      type: null,
      rows: [],
      dirty: false,
      busy: false,
      msg: null,
    };
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    this._applyTheme();
    if (first) {
      this._attachListeners();
      this._render();
      this._loadDevices();
    }
    this._syncMenu();
    this._updateLeds();
  }

  // Light up faceplate LEDs from the live LED switch states (no full re-render).
  _updateLeds() {
    for (const el of this.shadowRoot.querySelectorAll("[data-led-entity]")) {
      const on = this._hass.states[el.dataset.ledEntity]?.state === "on";
      el.classList.toggle("lit", on);
    }
    const label = this.shadowRoot.querySelector("#led-state");
    if (label) {
      const st = this._hass.states[label.dataset.ledEntity]?.state;
      label.textContent = st === "on" ? "currently on" : st === "off" ? "currently off" : "";
    }
  }

  _navigate(path) {
    if (!this._okToLeave()) return;
    history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }

  get hass() {
    return this._hass;
  }

  set narrow(narrow) {
    this._narrow = narrow;
    this._syncMenu();
  }

  set panel(panel) {
    this._panel = panel;
  }

  // Host attributes drive the CSS: mode = what the user picked, dark = what's showing.
  _applyTheme() {
    const dark = this._themeMode === "dark" || (this._themeMode === "auto" && !!this._hass?.themes?.darkMode);
    this.setAttribute("mode", this._themeMode);
    this.toggleAttribute("dark", dark);
  }

  _cycleTheme() {
    this._themeMode = THEME_MODES[(THEME_MODES.indexOf(this._themeMode) + 1) % THEME_MODES.length];
    try {
      localStorage.setItem(THEME_KEY, this._themeMode);
    } catch (e) {
      // private window etc. – it just won't be remembered
    }
    this._applyTheme();
    const btn = this.shadowRoot.querySelector("#theme");
    if (btn) {
      btn.textContent = THEME_ICONS[this._themeMode];
      btn.title = `Theme: ${this._themeMode}`;
    }
  }

  _syncMenu() {
    const menu = this.shadowRoot.querySelector("ha-menu-button");
    if (menu) {
      menu.hass = this._hass;
      menu.narrow = this._narrow;
    }
  }

  // ---------- data ----------

  async _triggers(deviceId) {
    if (!this._triggerCache.has(deviceId)) {
      const list = await this._hass.callWS({ type: "device_automation/trigger/list", device_id: deviceId });
      this._triggerCache.set(deviceId, list.filter((t) => t.subtype != null));
    }
    return this._triggerCache.get(deviceId);
  }

  async _loadDevices() {
    const s = this._s;
    s.loading = true;
    this._render();
    try {
      const [devices, areas, entries, layouts, entities, ours] = await Promise.all([
        this._hass.callWS({ type: "config/device_registry/list" }),
        this._hass.callWS({ type: "config/area_registry/list" }),
        this._hass.callWS({ type: "config_entries/get", domain: DEFAULT_DOMAIN }).catch(() => []),
        this._hass.callWS({ type: "keypad_builder/layouts/get" }).catch(() => ({})),
        this._hass.callWS({ type: "config/entity_registry/list" }).catch(() => []),
        this._hass.callWS({ type: "keypad_builder/automations" }).catch(() => []),
      ]);
      s.ours = ours || [];
      s.shared = {};
      await Promise.all(
        s.ours
          .filter((a) => a.shared)
          .map(async (a) => {
            try {
              s.shared[a.id] = await this._hass.callApi("GET", `config/automation/config/${a.id}`);
            } catch (e) {
              // removed outside the builder
            }
          })
      );
      s.layouts = layouts || {};
      const areaName = Object.fromEntries(areas.map((a) => [a.area_id, a.name]));
      // entity -> room, for the entity picker (entity's own room, else its device's room)
      const deviceArea = Object.fromEntries(devices.map((d) => [d.id, d.area_id]));
      this._areaName = areaName;
      this._entityArea = Object.fromEntries(
        entities.map((e) => [e.entity_id, e.area_id || deviceArea[e.device_id] || null])
      );
      const entryIds = new Set(entries.map((e) => e.entry_id));

      let list = devices
        .filter((d) => !d.disabled_by && (s.allDevices || d.config_entries.some((id) => entryIds.has(id))))
        .map((d) => ({
          id: d.id,
          name: d.name_by_user || d.name || "Unnamed device",
          area: areaName[d.area_id] || "",
          model: d.model || "",
        }))
        .map((d) => ({ ...d, ...splitDeviceName(d.name, d.area), ...friendlyModel(d.model) }));

      // For Lutron, only keep devices that actually have buttons.
      if (!s.allDevices) {
        const checked = await Promise.all(
          list.map(async (d) => ((await this._triggers(d.id).catch(() => [])).length ? d : null))
        );
        list = checked.filter(Boolean);
      }

      list.sort(
        (a, b) =>
          (a.area || "~").localeCompare(b.area || "~") ||
          a.title.localeCompare(b.title) ||
          (a.position || 0) - (b.position || 0)
      );
      // only show "Pos 2" when a room has more than one device with the same name
      const seen = {};
      for (const d of list) seen[`${d.area}|${d.title}`] = (seen[`${d.area}|${d.title}`] || 0) + 1;
      for (const d of list) d.showPosition = d.position != null && seen[`${d.area}|${d.title}`] > 1;
      s.devices = list;
    } catch (e) {
      s.msg = { type: "error", text: `Couldn't load devices: ${e.message || e}` };
    }
    s.loading = false;
    this._render();
  }

  async _selectDevice(deviceId) {
    const s = this._s;
    if (!this._okToLeave()) return;
    if (s.editingLayout && !confirm("You're still editing this keypad's layout. Leave without saving it?")) return;
    Object.assign(s, {
      view: "keypad",
      sharedDraft: null,
      deviceId,
      loadingDevice: true,
      buttons: [],
      configs: {},
      sel: null,
      rows: [],
      dirty: false,
      msg: null,
      info: null,
      layout: null,
      layoutDraft: null,
      editingLayout: false,
      ledConfigs: {},
      led: null,
      ledDirty: false,
      ledMsg: null,
      related: [],
    });
    this._render();

    try {
      const [triggers, info] = await Promise.all([
        this._triggers(deviceId),
        this._hass.callWS({ type: "keypad_builder/lutron_info", device_id: deviceId }).catch(() => null),
      ]);
      const groups = new Map();
      for (const t of triggers) {
        const key = String(t.subtype);
        if (!groups.has(key)) groups.set(key, { key, subtype: t.subtype, label: pretty(t.subtype), triggers: {} });
        groups.get(key).triggers[t.type] = t;
      }

      // Use the processor's button order (and LED info) when the Lutron integration has it.
      s.info = info;
      const order = new Map((info?.buttons || []).map((b, i) => [String(b.subtype), { ...b, index: i }]));
      s.buttons = [...groups.values()]
        .map((b, i) => ({
          ...b,
          number: order.get(b.key)?.number,
          led: !!order.get(b.key)?.led,
          ledEntity: order.get(b.key)?.led_entity_id || null,
          index: order.get(b.key)?.index ?? 1000 + i,
        }))
        .sort((a, b) => a.index - b.index);
      s.layout = reconcileLayout(s.layouts[deviceId] || autoLayout(s.buttons), s.buttons);

      const load = async (id, into) => {
        try {
          into[id] = await this._hass.callApi("GET", `config/automation/config/${id}`);
        } catch (e) {
          // 404 = nothing saved for this yet, totally fine
        }
      };
      const [related] = await Promise.all([
        this._hass.callWS({ type: "keypad_builder/button_automations", device_id: deviceId }).catch(() => []),
        ...s.buttons.flatMap((b) => Object.keys(b.triggers).map((type) => load(autoId(deviceId, b.subtype, type), s.configs))),
        ...s.buttons.filter((b) => b.ledEntity).map((b) => load(ledId(deviceId, b.subtype), s.ledConfigs)),
      ]);
      s.related = (related || []).filter((r) => !isOurs(r.id));
    } catch (e) {
      s.msg = { type: "error", text: `Couldn't load buttons: ${e.message || e}` };
    }
    s.loadingDevice = false;
    this._render();
  }

  _selectButton(key, type) {
    const s = this._s;
    if (key !== s.sel ? !this._okToLeave() : type !== s.type && s.dirty && !confirm("You have unsaved changes for this button. Leave without saving?")) return;
    const button = s.buttons.find((b) => b.key === key);
    if (!button) return;
    const types = Object.keys(button.triggers);
    if (key !== s.sel) {
      s.led = parseLed(s.ledConfigs[ledId(s.deviceId, button.subtype)]);
      s.ledDirty = false;
      s.ledMsg = null;
    }
    s.sel = key;
    s.type = type && types.includes(type) ? type : types.includes("press") ? "press" : types[0];
    const config = s.configs[autoId(s.deviceId, button.subtype, s.type)];
    const actions = config ? [].concat(config.actions ?? config.action ?? []) : [];
    s.rows = actions.flatMap(parseAction);
    s.dirty = false;
    s.msg = null;
    this._render();
  }

  _okToLeave() {
    return (!this._s.dirty && !this._s.ledDirty) || confirm("You have unsaved changes. Leave without saving?");
  }

  // Keep our list of Keypad Builder automations current (drives the "set up" counts).
  _trackOurs(id, deviceId, present) {
    const s = this._s;
    s.ours = s.ours.filter((a) => a.id !== id);
    if (present) s.ours.push({ id, device_id: deviceId, shared: id.startsWith(SHARED_PREFIX) });
  }

  _setupCounts() {
    const counts = {};
    for (const a of this._s.ours) if (a.device_id) counts[a.device_id] = (counts[a.device_id] || 0) + 1;
    for (const config of Object.values(this._s.shared)) {
      for (const id of new Set(sharedMembers(config).map((m) => m.deviceId))) counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  }

  _sharedFor(deviceId, subtype) {
    return Object.entries(this._s.shared)
      .filter(([, config]) => sharedMembers(config).some((m) => m.deviceId === deviceId && m.subtype === subtype))
      .map(([id, config]) => ({ id, config }));
  }

  _sharedSummary(config) {
    const members = sharedMembers(config);
    const what = members[0] ? typeLabel(members[0].type).replace(/^When /, "") : "";
    return [`${members.length} button${members.length === 1 ? "" : "s"}`, what].filter(Boolean).join(" · ");
  }

  _memberLabel(m) {
    const device = this._s.devices.find((d) => d.id === m.deviceId);
    return {
      button: this._s.layouts[m.deviceId]?.labels?.[m.subtype] || pretty(m.subtype),
      where: device
        ? [device.area, device.title + (device.showPosition ? ` (Pos ${device.position})` : "")].filter(Boolean).join(" · ")
        : "Unknown keypad",
    };
  }

  // ---------- shared actions ----------

  _showShared() {
    if (!this._okToLeave()) return;
    Object.assign(this._s, { view: "shared", sharedDraft: null, rows: [], dirty: false, ledDirty: false, msg: null });
    this._render();
  }

  _openShared(id) {
    const s = this._s;
    if (!this._okToLeave()) return;
    const config = s.shared[id];
    if (!config) return;
    const members = sharedMembers(config);
    const isMember = (t) => (t.trigger || t.platform) === "device" && t.device_id && t.subtype != null;
    s.view = "shared";
    s.sharedDraft = {
      id,
      name: config.alias || "",
      type: members[0]?.type || "press",
      members: members.map(({ deviceId, subtype }) => ({ deviceId, subtype })),
      saved: new Set(members.map((m) => memberKey(m.deviceId, m.subtype))),
      // keep any non-keypad triggers someone added in HA's editor
      extra: [].concat(config.triggers ?? config.trigger ?? []).filter((t) => !isMember(t)),
    };
    s.rows = [].concat(config.actions ?? config.action ?? []).flatMap(parseAction);
    Object.assign(s, { dirty: false, ledDirty: false, msg: null });
    this._render();
  }

  // From the shared list ("new") or from a button ("copy this button's actions over").
  _newShared(fromButton) {
    const s = this._s;
    const draft = { id: null, name: "", type: "press", members: [], saved: new Set(), extra: [] };
    if (fromButton) {
      if (s.ledDirty && !confirm("You have unsaved LED changes. Leave without saving?")) return;
      const cur = this._current();
      if (!cur) return;
      draft.type = s.type;
      draft.members = [{ deviceId: s.deviceId, subtype: cur.button.key }];
      s.rows = JSON.parse(JSON.stringify(s.rows));
    } else {
      if (!this._okToLeave()) return;
      s.rows = [];
    }
    Object.assign(s, { view: "shared", sharedDraft: draft, dirty: fromButton, ledDirty: false, msg: null });
    this._render();
  }

  _sharedTypes(draft) {
    const types = new Set();
    for (const m of draft.members) {
      for (const t of this._triggerCache.get(m.deviceId) || []) if (String(t.subtype) === m.subtype) types.add(t.type);
    }
    if (!types.size) ["press", "release"].forEach((t) => types.add(t));
    types.add(draft.type);
    const order = ["press", "release", "multi_tap"];
    return [...types].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  }

  async _saveShared() {
    const s = this._s;
    const d = s.sharedDraft;
    const fail = (text) => {
      s.msg = { type: "error", text };
      this._render();
    };
    const name = d.name.trim();
    if (!name) return fail("Give it a name first 💛 (like “Movie time”)");
    if (!d.members.length) return fail("Add at least one button 💛");
    let actions;
    try {
      actions = s.rows.map(buildAction);
    } catch (e) {
      return fail(e.message);
    }
    if (!actions.length) return d.id ? this._deleteShared() : fail("Add at least one action first 💛");

    const what = typeLabel(d.type).replace(/^When /, "");
    await Promise.all(d.members.map((m) => this._triggers(m.deviceId).catch(() => [])));
    const triggers = [];
    const missing = [];
    for (const m of d.members) {
      const t = this._triggerCache.get(m.deviceId)?.find((x) => String(x.subtype) === m.subtype && x.type === d.type);
      if (!t) missing.push(m);
      else {
        const { metadata, ...clean } = t;
        triggers.push(clean);
      }
    }
    if (missing.length) {
      const names = missing.map((m) => this._memberLabel(m).button).join(", ");
      return fail(`${names} can't do “${what}”. Remove ${missing.length === 1 ? "it" : "them"} or pick a different “Runs when”.`);
    }

    s.busy = true;
    this._render();
    try {
      // Newly added buttons that already do something on their own would run twice.
      const conflicts = [];
      await Promise.all(
        d.members
          .filter((m) => !d.saved.has(memberKey(m.deviceId, m.subtype)))
          .map(async (m) => {
            const id = autoId(m.deviceId, m.subtype, d.type);
            try {
              await this._hass.callApi("GET", `config/automation/config/${id}`);
              conflicts.push({ m, id });
            } catch (e) {
              // no own automation, nothing to clash with
            }
          })
      );
      if (
        conflicts.length &&
        confirm(
          `${conflicts.length === 1 ? "1 of these buttons already has" : `${conflicts.length} of these buttons already have`} their own “${what}” actions:\n\n` +
            conflicts.map((c) => `• ${this._memberLabel(c.m).button} (${this._memberLabel(c.m).where})`).join("\n") +
            "\n\nRemove those so only this shared action runs?\n(Cancel keeps both, so both will run.)"
        )
      ) {
        for (const c of conflicts) {
          await this._hass.callApi("DELETE", `config/automation/config/${c.id}`);
          this._trackOurs(c.id, c.m.deviceId, false);
          delete s.configs[c.id];
        }
      }

      const id = d.id || `${SHARED_PREFIX}${slug(name) || "action"}_${Math.random().toString(36).slice(2, 6)}`;
      const existing = s.shared[id] || {};
      const config = {
        ...existing,
        alias: name,
        description: existing.description ?? "Shared action made with Keypad Builder 🎛️",
        mode: existing.mode || "single",
        triggers: [...triggers, ...d.extra],
        conditions: existing.conditions ?? existing.condition ?? [],
        actions,
      };
      for (const k of ["id", "trigger", "condition", "action"]) delete config[k];
      await this._hass.callApi("POST", `config/automation/config/${id}`, config);
      s.shared[id] = { ...config, id };
      this._trackOurs(id, null, true);
      d.id = id;
      d.saved = new Set(d.members.map((m) => memberKey(m.deviceId, m.subtype)));
      s.dirty = false;
      s.msg = { type: "ok", text: `Saved! ${d.members.length === 1 ? "That button does" : `All ${d.members.length} buttons do`} this now ✨` };
    } catch (e) {
      s.msg = { type: "error", text: `Save failed: ${e.body?.message || e.message || e}` };
    }
    s.busy = false;
    this._render();
  }

  async _deleteShared() {
    const s = this._s;
    const d = s.sharedDraft;
    if (!d?.id || !confirm(`Delete “${d.name || "this shared action"}”? Its buttons will stop doing this.`)) return;
    try {
      await this._hass.callApi("DELETE", `config/automation/config/${d.id}`);
      delete s.shared[d.id];
      this._trackOurs(d.id, null, false);
      Object.assign(s, { sharedDraft: null, rows: [], dirty: false, msg: { type: "ok", text: "Deleted 🫧" } });
    } catch (e) {
      s.msg = { type: "error", text: `Delete failed: ${e.body?.message || e.message || e}` };
    }
    this._render();
  }

  // ---------- importing automations made outside the builder ----------

  async _openImport(relatedId) {
    const s = this._s;
    const related = s.related.find((r) => r.id === relatedId);
    if (!related || !this._okToLeave()) return;
    this._imp = { related, loading: true, mode: "move" };
    this._render();
    try {
      const config = await this._hass.callApi("GET", `config/automation/config/${related.id}`);
      Object.assign(this._imp, this._planImport(config), { config });
    } catch (e) {
      this._imp.blocked =
        "This one lives in a YAML file that Home Assistant's editor can't change, so it can't be imported. You can copy its actions over by hand.";
    }
    this._imp.loading = false;
    this._render();
  }

  // Work out what an outside automation turns into: one button's actions, or a shared action.
  _planImport(config) {
    const s = this._s;
    const isButton = (t) => (t.trigger || t.platform) === "device" && t.device_id && t.subtype != null;
    const triggers = [].concat(config.triggers ?? config.trigger ?? []);
    const buttons = triggers.filter(isButton);
    const extra = triggers.filter((t) => !isButton(t));
    if (new Set(buttons.map((t) => t.type)).size > 1) {
      return {
        blocked:
          "It mixes different button actions (like pressed and released), so it can't become one Keypad Builder action. You can still open it in Home Assistant.",
      };
    }
    const type = buttons[0]?.type;
    const members = [
      ...new Map(
        buttons.map((t) => [memberKey(t.device_id, String(t.subtype)), { deviceId: t.device_id, subtype: String(t.subtype) }])
      ).values(),
    ];
    if (members.length === 1 && !extra.length) {
      const target = autoId(members[0].deviceId, members[0].subtype, type);
      const existing = members[0].deviceId === s.deviceId ? s.configs[target] : null;
      if (existing && [].concat(config.conditions ?? config.condition ?? []).length) {
        return {
          blocked:
            "This button already has its own actions in Keypad Builder, and this automation has conditions, so they can't be safely combined. Open both in Home Assistant to merge them by hand.",
        };
      }
      return { kind: "button", type, member: members[0], target, merge: !!existing };
    }
    return { kind: "shared", type, members, extra };
  }

  async _doImport() {
    const s = this._s;
    const imp = this._imp;
    const { related, config } = imp;
    const { id: _oldId, ...body } = config;
    imp.busy = true;
    imp.error = null;
    this._render();
    try {
      // 1. save it as a Keypad Builder automation (name, conditions and settings come along)
      let newId;
      if (imp.kind === "button") {
        newId = imp.target;
        let out = { ...body };
        if (imp.merge) {
          const existing = s.configs[newId];
          out = {
            ...existing,
            actions: [...[].concat(existing.actions ?? existing.action ?? []), ...[].concat(body.actions ?? body.action ?? [])],
          };
          delete out.action;
        }
        delete out.id;
        await this._hass.callApi("POST", `config/automation/config/${newId}`, out);
        s.configs[newId] = { ...out, id: newId };
        this._trackOurs(newId, s.deviceId, true);
      } else {
        newId = `${SHARED_PREFIX}${slug(body.alias || "") || "imported"}_${Math.random().toString(36).slice(2, 6)}`;
        await this._hass.callApi("POST", `config/automation/config/${newId}`, body);
        s.shared[newId] = { ...body, id: newId };
        this._trackOurs(newId, null, true);
      }

      // 2. the original would still fire too, so remove it or switch it off
      if (imp.mode === "move") await this._hass.callApi("DELETE", `config/automation/config/${related.id}`);
      else await this._hass.callService("automation", "turn_off", { entity_id: related.entity_id });
      s.related = s.related.filter((r) => r.id !== related.id);

      this._imp = null;
      s.dirty = false; // already confirmed when the import window opened
      const done = `Imported “${related.name}” ✨${imp.mode === "copy" ? " The original is turned off." : ""}`;
      if (imp.kind === "button") {
        this._selectButton(imp.member.subtype, imp.type);
      } else {
        this._openShared(newId);
      }
      s.msg = { type: "ok", text: done };
      this._render();
    } catch (e) {
      imp.busy = false;
      imp.error = `Import failed: ${e.body?.message || e.message || e}`;
      this._render();
    }
  }

  _renderImport() {
    const imp = this._imp;
    if (!imp) return "";
    let body;
    if (imp.loading) {
      body = `<p class="muted center">Reading the automation…</p>`;
    } else if (imp.blocked) {
      body = `<p>${esc(imp.blocked)}</p>`;
    } else {
      const what = typeLabel(imp.type).replace(/^When /, "");
      const n = imp.members?.length || 1;
      const summary =
        imp.kind === "button"
          ? imp.merge
            ? `This button already has “${what}” actions here, so the imported actions get added after them.`
            : `It becomes this button's “${what}” actions in Keypad Builder. Its name, conditions and settings come along too.`
          : `It's used by ${n} button${n === 1 ? "" : "s"}${imp.extra.length ? " plus other triggers" : ""}, so it becomes a 🔗 shared action. Its name, conditions and settings come along too.`;
      body = `
        <p>${esc(summary)}</p>
        <div class="choices">
          <label class="choice">
            <input type="radio" name="imp-mode" value="move" ${imp.mode === "move" ? "checked" : ""}>
            <span><b>Move it</b> <span class="chip">recommended</span><br><span class="muted">Removes the original so nothing runs twice</span></span>
          </label>
          <label class="choice">
            <input type="radio" name="imp-mode" value="copy" ${imp.mode === "copy" ? "checked" : ""}>
            <span><b>Copy it</b><br><span class="muted">Keeps the original, but turns it off</span></span>
          </label>
        </div>
        <p class="muted">If a script or dashboard points to the old automation, you might need to update it.</p>`;
    }
    const canImport = !imp.loading && !imp.blocked;
    return `
      <div class="picker-backdrop" data-act="imp-close"></div>
      <div class="picker" id="import-dialog" role="dialog" aria-label="Import automation" tabindex="-1">
        <div class="picker-head">
          <h3>📥 Import “${esc(imp.related.name)}”</h3>
          <button class="icon" data-act="imp-close" title="Close">✕</button>
        </div>
        ${body}
        ${imp.error ? `<div class="msg error">${esc(imp.error)}</div>` : ""}
        <div class="picker-foot">
          ${imp.blocked && imp.related.id ? `<button class="ghost" data-act="open-editor" data-id="${esc(imp.related.id)}">Open in HA ↗</button>` : ""}
          <span class="spacer"></span>
          <button class="ghost" data-act="imp-close">Cancel</button>
          ${canImport ? `<button class="primary" data-act="imp-go" ${imp.busy ? "disabled" : ""}>${imp.busy ? "Importing…" : "Import"}</button>` : ""}
        </div>
      </div>`;
  }

  // ---------- button picker (for shared actions) ----------

  async _openButtonPicker() {
    const s = this._s;
    this._bp = {
      q: "",
      loading: true,
      selected: new Set(s.sharedDraft.members.map((m) => memberKey(m.deviceId, m.subtype))),
    };
    this._render();
    this.shadowRoot.querySelector("#bp-q")?.focus();
    await Promise.all(s.devices.map((d) => this._triggers(d.id).catch(() => [])));
    if (!this._bp) return;
    this._bp.loading = false;
    this._renderButtonPickerList();
  }

  _closeButtonPicker(apply) {
    const s = this._s;
    if (apply) {
      const d = s.sharedDraft;
      const kept = d.members.filter((m) => this._bp.selected.has(memberKey(m.deviceId, m.subtype)));
      const keptKeys = new Set(kept.map((m) => memberKey(m.deviceId, m.subtype)));
      const added = [...this._bp.selected]
        .filter((k) => !keptKeys.has(k))
        .map((k) => ({ deviceId: k.slice(0, k.indexOf("|")), subtype: k.slice(k.indexOf("|") + 1) }));
      d.members = [...kept, ...added];
      s.dirty = true;
      s.msg = null;
    }
    this._bp = null;
    this._render();
  }

  _buttonsOf(deviceId) {
    const subtypes = [...new Set((this._triggerCache.get(deviceId) || []).map((t) => String(t.subtype)))];
    const order = (this._s.layouts[deviceId]?.rows || []).flat();
    const rank = (k) => (order.includes(k) ? order.indexOf(k) : 1000 + subtypes.indexOf(k));
    return subtypes.sort((a, b) => rank(a) - rank(b));
  }

  // Organize every Keypad Builder automation (backend sets area/category/label),
  // and give automations from older versions the new name style.
  async _tidyUp() {
    const s = this._s;
    if (
      !confirm(
        "Tidy up all Keypad Builder automations?\n\nEach one gets its keypad's area, the “Keypads” category and a “Keypad Builder” label. Older ones get the new name style. Names, areas and categories you changed yourself are kept."
      )
    )
      return;
    s.tidyMsg = { type: "ok", text: "Tidying up… 🧹" };
    this._render();
    try {
      const list = await this._hass.callWS({ type: "keypad_builder/organize" });
      let renamed = 0;
      for (const item of list) {
        let config;
        try {
          config = await this._hass.callApi("GET", `config/automation/config/${item.id}`);
        } catch (e) {
          continue;
        }
        const old = OLD_ALIAS.exec(config.alias || "");
        const device = s.devices.find((d) => d.id === item.device_id);
        if (!old || !device) continue;
        const alias = makeAlias(device, old[3], old[1] ? "led" : slug(old[4] || "press"));
        const { id, ...rest } = config;
        await this._hass.callApi("POST", `config/automation/config/${item.id}`, { ...rest, alias });
        for (const cache of [s.configs, s.ledConfigs]) if (cache[item.id]) cache[item.id].alias = alias;
        renamed++;
      }
      s.tidyMsg = {
        type: "ok",
        text: list.length
          ? `All ${list.length} automations organized ✨${renamed ? ` (${renamed} renamed)` : ""}`
          : "No Keypad Builder automations yet 🫧",
      };
    } catch (e) {
      s.tidyMsg = { type: "error", text: `Tidy up failed: ${e.message || e}` };
    }
    this._render();
  }

  _relatedFor(button, type) {
    return this._s.related.filter((r) => r.triggers.some((t) => String(t.subtype) === button.key && (!type || t.type === type)));
  }

  async _saveLed() {
    const s = this._s;
    const cur = this._current();
    const button = cur?.button;
    if (!button?.ledEntity) return;
    const id = ledId(s.deviceId, button.subtype);
    const led = s.led;

    if (led.mode === "lutron") {
      if (s.ledConfigs[id]) return this._removeLed();
      s.ledDirty = false;
      return this._render();
    }
    const source = (led.entity || "").trim();
    if (!source) {
      s.ledMsg = { type: "error", text: "Pick which device the LED should follow 💛" };
      return this._render();
    }
    const onState = (led.state || "on").trim();
    const device = s.devices.find((d) => d.id === s.deviceId);
    const existing = s.ledConfigs[id] || {};
    const config = {
      ...existing,
      alias: keepAlias(existing.alias) || makeAlias(device, button.label, "led"),
      description: existing.description ?? "Made with Keypad Builder 🎛️",
      mode: "restart",
      triggers: [
        { trigger: "state", entity_id: source },
        { trigger: "homeassistant", event: "start" },
      ],
      conditions: existing.conditions ?? [],
      actions: [
        {
          if: [{ condition: "state", entity_id: source, state: onState }],
          then: [{ action: "switch.turn_on", target: { entity_id: button.ledEntity } }],
          else: [{ action: "switch.turn_off", target: { entity_id: button.ledEntity } }],
        },
      ],
    };
    for (const k of ["id", "trigger", "condition", "action"]) delete config[k];

    try {
      await this._hass.callApi("POST", `config/automation/config/${id}`, config);
      s.ledConfigs[id] = { ...config, id };
      this._trackOurs(id, s.deviceId, true);
      s.ledDirty = false;
      s.ledMsg = { type: "ok", text: "LED saved! 💡" };
      // sync the LED right away instead of waiting for the next change
      const on = this._hass.states[source]?.state === onState;
      await this._hass.callService("switch", on ? "turn_on" : "turn_off", { entity_id: button.ledEntity }).catch(() => {});
    } catch (e) {
      s.ledMsg = { type: "error", text: `Save failed: ${e.body?.message || e.message || e}` };
    }
    this._render();
  }

  async _removeLed() {
    const s = this._s;
    const button = this._current()?.button;
    const id = ledId(s.deviceId, button.subtype);
    if (!confirm("Stop controlling this LED? Lutron will be in charge of it again.")) return;
    try {
      await this._hass.callApi("DELETE", `config/automation/config/${id}`);
      delete s.ledConfigs[id];
      this._trackOurs(id, s.deviceId, false);
      s.led = parseLed(null);
      s.ledDirty = false;
      s.ledMsg = { type: "ok", text: "Done, Lutron controls this LED again." };
    } catch (e) {
      s.ledMsg = { type: "error", text: `Remove failed: ${e.body?.message || e.message || e}` };
    }
    this._render();
  }

  // ---------- layout ----------

  _layoutLabel(key, layout = this._s.layoutDraft || this._s.layout) {
    return layout?.labels[key] || this._s.buttons.find((b) => b.key === key)?.label || key;
  }

  _editLayout() {
    const s = this._s;
    s.layoutDraft = cloneLayout(s.layout);
    s.editingLayout = true;
    this._render();
  }

  _changeLayout(fn) {
    fn(this._s.layoutDraft);
    this._render();
  }

  async _saveLayout() {
    const s = this._s;
    const layout = reconcileLayout(s.layoutDraft, s.buttons);
    try {
      await this._hass.callWS({ type: "keypad_builder/layouts/save", device_id: s.deviceId, layout });
      s.layouts[s.deviceId] = layout;
      s.layout = layout;
      s.layoutDraft = null;
      s.editingLayout = false;
      s.layoutMsg = null;
    } catch (e) {
      s.layoutMsg = `Couldn't save layout: ${e.message || e}`;
    }
    this._render();
  }

  _current() {
    const s = this._s;
    const button = s.buttons.find((b) => b.key === s.sel);
    if (!button) return null;
    return { button, trigger: button.triggers[s.type], id: autoId(s.deviceId, button.subtype, s.type) };
  }

  async _save() {
    const s = this._s;
    const cur = this._current();
    if (!cur) return;

    let actions;
    try {
      actions = s.rows.map(buildAction);
    } catch (e) {
      s.msg = { type: "error", text: e.message };
      return this._render();
    }
    if (!actions.length) {
      if (s.configs[cur.id]) return this._delete();
      s.msg = { type: "error", text: "Add at least one action first 💛" };
      return this._render();
    }

    const device = s.devices.find((d) => d.id === s.deviceId);
    const existing = s.configs[cur.id] || {};
    const trigger = { ...cur.trigger };
    delete trigger.metadata;

    const config = {
      ...existing,
      alias: keepAlias(existing.alias) || makeAlias(device, cur.button.label, s.type),
      description: existing.description ?? "Made with Keypad Builder 🎛️",
      mode: existing.mode || "single",
      triggers: [trigger],
      conditions: existing.conditions ?? existing.condition ?? [],
      actions,
    };
    delete config.id;
    delete config.trigger;
    delete config.condition;
    delete config.action;

    s.busy = true;
    this._render();
    try {
      await this._hass.callApi("POST", `config/automation/config/${cur.id}`, config);
      s.configs[cur.id] = { ...config, id: cur.id };
      this._trackOurs(cur.id, s.deviceId, true);
      s.dirty = false;
      s.msg = { type: "ok", text: "Saved! Go press that button ✨" };
    } catch (e) {
      s.msg = { type: "error", text: `Save failed: ${e.body?.message || e.message || e}` };
    }
    s.busy = false;
    this._render();
  }

  async _delete() {
    const s = this._s;
    const cur = this._current();
    if (!cur || !s.configs[cur.id]) return;
    if (!confirm(`Remove the automation for ${cur.button.label} (${pretty(s.type)})?`)) return;
    s.busy = true;
    this._render();
    try {
      await this._hass.callApi("DELETE", `config/automation/config/${cur.id}`);
      delete s.configs[cur.id];
      this._trackOurs(cur.id, s.deviceId, false);
      s.rows = [];
      s.dirty = false;
      s.msg = { type: "ok", text: "Removed. This button does nothing now 🫧" };
    } catch (e) {
      s.msg = { type: "error", text: `Remove failed: ${e.body?.message || e.message || e}` };
    }
    s.busy = false;
    this._render();
  }

  // ---------- events ----------

  _attachListeners() {
    const root = this.shadowRoot;

    root.addEventListener("click", (ev) => {
      const el = ev.target.closest("[data-act]");
      if (!el || el.disabled) return;
      const s = this._s;
      const i = Number(el.dataset.row);
      switch (el.dataset.act) {
        case "device":
          return this._selectDevice(el.dataset.id);
        case "button":
          if (s.editingLayout) {
            return root.querySelector(`input[data-lkey="${CSS.escape(el.dataset.key)}"]`)?.focus();
          }
          return this._selectButton(el.dataset.key);
        case "type":
          return this._selectButton(s.sel, el.dataset.type);
        case "add":
          s.rows.push(newRow("homeassistant.toggle"));
          s.dirty = true;
          s.msg = null;
          return this._render();
        case "remove":
          s.rows.splice(i, 1);
          s.dirty = true;
          s.msg = null;
          return this._render();
        case "up":
        case "down": {
          const j = el.dataset.act === "up" ? i - 1 : i + 1;
          if (j < 0 || j >= s.rows.length) return;
          [s.rows[i], s.rows[j]] = [s.rows[j], s.rows[i]];
          s.dirty = true;
          s.msg = null;
          return this._render();
        }
        case "save":
          return this._save();
        case "delete":
          return this._delete();
        case "tidy":
          return this._tidyUp();
        case "shared-view":
          return this._showShared();
        case "shared-new":
          return this._newShared(false);
        case "shared-from-button":
          return this._newShared(true);
        case "shared-open":
          return this._openShared(el.dataset.id);
        case "s-save":
          return this._saveShared();
        case "s-delete":
          return this._deleteShared();
        case "s-remove-member":
          s.sharedDraft.members = s.sharedDraft.members.filter((m) => memberKey(m.deviceId, m.subtype) !== el.dataset.key);
          s.dirty = true;
          s.msg = null;
          return this._render();
        case "bp-open":
          return this._openButtonPicker();
        case "bp-close":
          return this._closeButtonPicker(false);
        case "bp-done":
          return this._closeButtonPicker(true);
        case "bp-toggle": {
          const sel = this._bp.selected;
          if (sel.has(el.dataset.key)) sel.delete(el.dataset.key);
          else sel.add(el.dataset.key);
          return this._renderButtonPickerList();
        }
        case "reload":
          this._triggerCache.clear();
          return this._loadDevices();
        case "theme":
          return this._cycleTheme();
        case "pick":
          return this._openPicker(el.dataset.pick);
        case "pick-close":
          return this._closePicker();
        case "pick-choose":
          return this._choose(el.dataset.entity);
        case "imp-open":
          return this._openImport(el.dataset.id);
        case "imp-close":
          this._imp = null;
          return this._render();
        case "imp-go":
          return this._doImport();
        case "open-editor":
          this._imp = null;
          return this._navigate(`/config/automation/edit/${encodeURIComponent(el.dataset.id)}`);
        case "led-save":
          return this._saveLed();
        case "led-remove":
          return this._removeLed();
        case "l-edit":
          return this._editLayout();
        case "l-cancel":
          Object.assign(s, { editingLayout: false, layoutDraft: null, layoutMsg: null });
          return this._render();
        case "l-save":
          return this._saveLayout();
        case "l-reset":
          return this._changeLayout((d) => Object.assign(d, autoLayout(s.buttons, d.finish)));
        case "l-up":
        case "l-down": {
          const r = Number(el.dataset.r);
          const t = el.dataset.act === "l-up" ? r - 1 : r + 1;
          return this._changeLayout((d) => {
            if (t >= 0 && t < d.rows.length) [d.rows[r], d.rows[t]] = [d.rows[t], d.rows[r]];
          });
        }
        case "l-join": {
          const r = Number(el.dataset.r);
          return this._changeLayout((d) => d.rows.splice(r, 2, [...d.rows[r], ...d.rows[r + 1]]));
        }
        case "l-split": {
          const r = Number(el.dataset.r);
          return this._changeLayout((d) => d.rows.splice(r, 1, ...d.rows[r].map((k) => [k])));
        }
      }
    });

    root.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") return;
      if (this._picker) this._closePicker();
      else if (this._bp) this._closeButtonPicker(false);
      else if (this._imp && !this._imp.busy) {
        this._imp = null;
        this._render();
      }
    });

    root.addEventListener("input", (ev) => {
      const el = ev.target;
      const s = this._s;
      if (el.id === "search") {
        s.filter = el.value;
        return this._renderDeviceList();
      }
      if (el.id === "bp-q") {
        this._bp.q = el.value;
        return this._renderButtonPickerList();
      }
      if (el.dataset.sfield === "name") {
        s.sharedDraft.name = el.value;
        s.dirty = true;
        return;
      }
      if (el.id === "pick-q") {
        this._picker.q = el.value;
        return this._renderPickerList();
      }
      if (el.dataset.ledField != null && el.tagName !== "SELECT") {
        s.led[el.dataset.ledField] = el.value;
        s.ledDirty = true;
        return;
      }
      if (el.dataset.lkey != null) {
        const key = el.dataset.lkey;
        const value = el.value.trim();
        if (value) s.layoutDraft.labels[key] = value;
        else delete s.layoutDraft.labels[key];
        const label = root.querySelector(`.kbtn[data-key="${CSS.escape(key)}"] .label`);
        if (label) label.textContent = this._layoutLabel(key);
        return;
      }
      if (el.dataset.field == null) return;
      const row = s.rows[Number(el.dataset.row)];
      if (!row) return;
      row[el.dataset.field] = el.value;
      s.dirty = true;
      s.msg = null;
      if (el.dataset.field === "brightness") {
        const out = root.querySelector(`#bval-${el.dataset.row}`);
        if (out) out.textContent = `${el.value}%`;
      }
    });

    root.addEventListener("change", (ev) => {
      const el = ev.target;
      const s = this._s;
      if (el.name === "imp-mode") {
        this._imp.mode = el.value;
        return;
      }
      if (el.dataset.sfield === "type") {
        s.sharedDraft.type = el.value;
        s.dirty = true;
        s.msg = null;
        return this._render();
      }
      if (el.id === "sort") {
        s.sort = el.value;
        try {
          localStorage.setItem(SORT_KEY, s.sort);
        } catch (e) {
          // just won't be remembered
        }
        return this._renderDeviceList();
      }
      if (el.id === "pick-area" || el.id === "pick-type") {
        this._picker[el.id === "pick-area" ? "area" : "type"] = el.value;
        return this._renderPickerList();
      }
      if (el.id === "all-devices") {
        s.allDevices = el.checked;
        return this._loadDevices();
      }
      if (el.dataset.ledField === "mode") {
        s.led.mode = el.value;
        s.ledDirty = true;
        return this._render();
      }
      if (el.dataset.lhide != null) {
        const key = el.dataset.lhide;
        return this._changeLayout((d) => {
          d.hidden = el.checked ? [...d.hidden, key] : d.hidden.filter((k) => k !== key);
        });
      }
      if (el.dataset.lfield === "finish") {
        return this._changeLayout((d) => (d.finish = el.value));
      }
      if (el.dataset.kind != null) {
        const i = Number(el.dataset.kind);
        const old = s.rows[i];
        const row = newRow(el.value);
        // keep the chosen entity when switching between similar actions
        if (presetFor(el.value)?.led) row.entity = (s.view === "keypad" && this._current()?.button.ledEntity) || "";
        else if ("entity" in row && old.entity) row.entity = old.entity;
        s.rows[i] = row;
        s.dirty = true;
        s.msg = null;
        this._render();
      }
    });
  }

  // ---------- rendering ----------

  _render() {
    const s = this._s;
    const device = s.devices.find((d) => d.id === s.deviceId);
    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <div class="toolbar">
        <ha-menu-button></ha-menu-button>
        <div class="title">🎛️ Keypad Builder</div>
        <span class="spacer"></span>
        <button id="theme" class="icon theme" data-act="theme" title="Theme: ${this._themeMode}">${THEME_ICONS[this._themeMode]}</button>
      </div>
      <div class="layout">
        <section class="card devices">
          <div class="card-head">
            <h2>Keypads</h2>
            <span>
              <button class="icon" data-act="tidy" title="Tidy up automations: area, category, label and names">🧹</button>
              <button class="icon" data-act="reload" title="Reload">↻</button>
            </span>
          </div>
          <input id="search" type="search" placeholder="Search keypads…" value="${esc(s.filter)}">
          <label class="check"><input id="all-devices" type="checkbox" ${s.allDevices ? "checked" : ""}> Show devices from all integrations</label>
          <div class="inline sort"><label for="sort">Sort</label>
            <select id="sort">
              <option value="room" ${s.sort === "room" ? "selected" : ""}>By room</option>
              <option value="setup" ${s.sort === "setup" ? "selected" : ""}>Set up first</option>
            </select>
          </div>
          <button class="dev shared-entry ${s.view === "shared" ? "active" : ""}" data-act="shared-view">
            <span class="dev-title">🔗 Shared actions${Object.keys(s.shared).length ? ` <span class="chip">${Object.keys(s.shared).length}</span>` : ""}</span>
            <small>One action for buttons on many keypads</small>
          </button>
          ${s.tidyMsg ? `<div class="msg ${s.tidyMsg.type}">${esc(s.tidyMsg.text)}</div>` : ""}
          <div id="devlist"></div>
        </section>

        <section class="card keypad-wrap">
          ${s.view === "shared" ? this._renderSharedList() : this._renderKeypad(device)}
        </section>

        <section class="card editor">
          ${s.view === "shared" ? this._renderSharedEditor() : this._renderEditor()}
        </section>
      </div>
      ${this._renderDatalists()}
      ${this._renderPicker()}
      ${this._renderButtonPicker()}
      ${this._renderImport()}
    `;
    this._renderDeviceList();
    this._renderPickerList();
    this._renderButtonPickerList();
    // focus the import window so Esc reaches us (it has no text box to focus)
    if (this._imp) this.shadowRoot.querySelector("#import-dialog")?.focus();
    this._syncMenu();
    this._updateLeds();
  }

  _renderDeviceList() {
    const s = this._s;
    const box = this.shadowRoot.querySelector("#devlist");
    if (!box) return;
    if (s.loading) {
      box.innerHTML = `<p class="muted">Looking for keypads… 🔍</p>`;
      return;
    }
    const q = s.filter.toLowerCase();
    const list = s.devices.filter((d) => `${d.name} ${d.area} ${d.model} ${d.type}`.toLowerCase().includes(q));
    if (!list.length) {
      box.innerHTML = s.devices.length
        ? `<p class="muted">No matches for that search.</p>`
        : `<p class="muted">No Lutron keypads found 🥲<br>Make sure the <b>Lutron Caséta</b> integration (it handles RA3 too) is set up, or tick “all integrations” above.</p>`;
      return;
    }
    const counts = this._setupCounts();
    const row = (d, sub) => `<button class="dev ${d.id === s.deviceId && s.view === "keypad" ? "active" : ""}" data-act="device" data-id="${esc(d.id)}">
        <span class="dev-title" title="${esc(d.name)}">${esc(d.title)}${d.showPosition ? ` <span class="chip">Pos ${d.position}</span>` : ""}${
          counts[d.id] ? ` <span class="chip on">${counts[d.id]} set up</span>` : ""
        }</span>
        ${sub ? `<small>${esc(sub)}</small>` : ""}
      </button>`;

    let lastGroup = null;
    const header = (group) => {
      if (group === lastGroup) return "";
      lastGroup = group;
      return `<div class="area">${esc(group)}</div>`;
    };
    if (s.sort === "setup") {
      box.innerHTML = [...list]
        .sort(
          (a, b) =>
            (counts[b.id] || 0) - (counts[a.id] || 0) ||
            (a.area || "~").localeCompare(b.area || "~") ||
            a.title.localeCompare(b.title)
        )
        .map((d) => header(counts[d.id] ? "Set up" : "Not set up yet") + row(d, [d.area, d.type || d.code].filter(Boolean).join(" · ")))
        .join("");
    } else {
      box.innerHTML = list.map((d) => header(d.area || "No area") + row(d, d.type || d.code)).join("");
    }
  }

  _renderKeypad(device) {
    const s = this._s;
    if (!device) return `<div class="empty">👈 Pick a keypad to start</div>`;
    if (s.loadingDevice) return `<div class="empty">Loading buttons…</div>`;
    if (!s.buttons.length) return `<div class="empty">This device doesn't have any buttons HA can use as triggers.</div>`;

    const editing = s.editingLayout;
    const layout = editing ? s.layoutDraft : s.layout;
    const byKey = new Map(s.buttons.map((b) => [b.key, b]));

    const btn = (b, small) => {
      const has = Object.keys(b.triggers).some((t) => s.configs[autoId(s.deviceId, b.subtype, t)]);
      const inShared = !has && this._sharedFor(s.deviceId, b.key).length > 0;
      const other = !has && !inShared && this._relatedFor(b).length > 0;
      const hidden = layout.hidden.includes(b.key);
      const label = this._layoutLabel(b.key, layout);
      const cls = ["kbtn", small && "small", b.key === s.sel && !editing && "active", has && "has", inShared && "has-shared", other && "has-other", hidden && "is-hidden", b.led && "with-led"];
      return `<button class="${cls.filter(Boolean).join(" ")}" data-act="button" data-key="${esc(b.key)}" title="${esc(label)}">
        ${b.led ? `<span class="led" ${b.ledEntity ? `data-led-entity="${esc(b.ledEntity)}"` : ""}></span>` : ""}<span class="label">${esc(label)}</span><span class="dot"></span>
      </button>`;
    };

    const rows = layout.rows
      .map((row) => row.map((k) => byKey.get(k)).filter((b) => b && (editing || !layout.hidden.includes(b.key))))
      .filter((row) => row.length)
      .map((row) => (row.length > 1 ? `<div class="pair">${row.map((b) => btn(b, true)).join("")}</div>` : btn(row[0])))
      .join("");

    const source = s.info
      ? `<div class="source">📡 Button order &amp; names from your Lutron processor</div>`
      : "";

    return `
      <div class="card-head">
        <div>
          <div class="device-name" title="${esc(device.name)}">${esc(device.title)}${device.showPosition ? ` <span class="chip">Pos ${device.position}</span>` : ""}</div>
          <div class="muted">${esc([device.area, device.type, device.code].filter(Boolean).join(" · "))}</div>
        </div>
        ${editing ? "" : `<button class="ghost" data-act="l-edit">✏️ Edit layout</button>`}
      </div>
      ${source}
      <div class="faceplate finish-${esc(layout.finish)}">${rows}</div>
      ${
        editing
          ? this._renderLayoutEditor(layout, byKey)
          : `<div class="muted center legend"><span><span class="dot on"></span> set up here</span>${
              s.buttons.some((b) => this._sharedFor(s.deviceId, b.key).length)
                ? `<span><span class="dot shared"></span> in a shared action</span>`
                : ""
            }${s.related.length ? `<span><span class="dot other"></span> used by another automation</span>` : ""}</div>`
      }
    `;
  }

  _renderLayoutEditor(layout, byKey) {
    const s = this._s;
    const finishOptions = FINISHES.map(
      ([v, l]) => `<option value="${v}" ${v === layout.finish ? "selected" : ""}>${esc(l)}</option>`
    ).join("");
    const last = layout.rows.length - 1;

    const rows = layout.rows
      .map(
        (row, r) => `
        <div class="lrow">
          <div class="lrow-head">
            <span class="muted">Row ${r + 1}</span>
            <span class="spacer"></span>
            ${row.length > 1 ? `<button class="icon" data-act="l-split" data-r="${r}" title="Put each button on its own row">Split</button>` : ""}
            ${r < last ? `<button class="icon" data-act="l-join" data-r="${r}" title="Put the next row's buttons beside these">Join ↓</button>` : ""}
            <button class="icon" data-act="l-up" data-r="${r}" title="Move row up" ${r === 0 ? "disabled" : ""}>↑</button>
            <button class="icon" data-act="l-down" data-r="${r}" title="Move row down" ${r === last ? "disabled" : ""}>↓</button>
          </div>
          ${row
            .map((k) => {
              const b = byKey.get(k);
              return `<div class="lbtn">
                <input data-lkey="${esc(k)}" value="${esc(layout.labels[k] || "")}" placeholder="${esc(b?.label || k)}">
                <label class="check" title="Hide this button on the faceplate"><input type="checkbox" data-lhide="${esc(k)}" ${layout.hidden.includes(k) ? "checked" : ""}> hide</label>
              </div>`;
            })
            .join("")}
        </div>`
      )
      .join("");

    return `
      <div class="layout-editor">
        <div class="inline"><label>Finish</label><select data-lfield="finish">${finishOptions}</select></div>
        <p class="muted">Rename buttons, move rows, or join rows so buttons sit side by side. Names here are just for this page, your automations don't change.</p>
        ${rows}
        ${s.layoutMsg ? `<div class="msg error">${esc(s.layoutMsg)}</div>` : ""}
        <div class="footer">
          <button class="ghost" data-act="l-reset" title="Go back to the order from your processor">↺ Reset</button>
          <span class="spacer"></span>
          <button class="ghost" data-act="l-cancel">Cancel</button>
          <button class="primary" data-act="l-save">Save layout</button>
        </div>
      </div>`;
  }

  _renderEditor() {
    const s = this._s;
    const cur = this._current();
    if (!cur) {
      return `<div class="empty">${s.deviceId ? "Tap a button on the keypad ✨" : "Your button settings show up here"}</div>`;
    }
    const types = Object.keys(cur.button.triggers);
    const exists = !!s.configs[cur.id];

    return `
      <h2>${esc(cur.button.label)}</h2>
      <div class="tabs">
        ${types
          .map((t) => {
            const has = !!s.configs[autoId(s.deviceId, cur.button.subtype, t)];
            return `<button class="tab ${t === s.type ? "active" : ""}" data-act="type" data-type="${esc(t)}">
              ${esc(typeLabel(t))} ${has ? `<span class="dot on"></span>` : ""}</button>`;
          })
          .join("")}
      </div>
      <p class="muted">Actions run top to bottom.</p>
      <div class="rows">
        ${s.rows.length ? s.rows.map((r, i) => this._renderRow(r, i)).join("") : `<div class="muted empty-rows">No actions yet, add one below 👇</div>`}
      </div>
      <button class="add" data-act="add">＋ Add action</button>
      ${s.msg ? `<div class="msg ${s.msg.type}">${esc(s.msg.text)}</div>` : ""}
      <div class="footer">
        ${exists ? `<button class="danger" data-act="delete" ${s.busy ? "disabled" : ""}>Remove</button>` : ""}
        <span class="spacer"></span>
        ${s.dirty ? `<span class="muted">unsaved changes</span>` : ""}
        <button class="primary" data-act="save" ${s.busy ? "disabled" : ""}>${s.busy ? "Saving…" : "Save"}</button>
      </div>
      ${
        exists
          ? `<div class="advanced">Want conditions, choose blocks or other fancy stuff?
              <button class="link" data-act="open-editor" data-id="${esc(cur.id)}">Open in HA automation editor ↗</button>
              <div class="muted">Changes you make there show up here too.</div></div>`
          : ""
      }
      ${this._renderSharedSection(cur.button)}
      ${this._renderLedSection(cur.button)}
      ${this._renderRelated(cur.button)}
    `;
  }

  _renderSharedSection(button) {
    const list = this._sharedFor(this._s.deviceId, button.key);
    return `
      <div class="section">
        <h3>🔗 Shared actions</h3>
        ${
          list.length
            ? list
                .map(
                  ({ id, config }) => `<div class="related">
                    <div><div>${esc(config.alias || "Shared action")}</div><div class="muted">${esc(this._sharedSummary(config))}</div></div>
                    <button class="link" data-act="shared-open" data-id="${esc(id)}">Open</button>
                  </div>`
                )
                .join("")
            : `<div class="muted">Want buttons on other keypads to do the same thing as this one?</div>`
        }
        <div><button class="ghost" data-act="shared-from-button">🔗 Share this button's actions…</button></div>
      </div>`;
  }

  _renderSharedList() {
    const s = this._s;
    const items = Object.entries(s.shared).sort((a, b) => (a[1].alias || "").localeCompare(b[1].alias || ""));
    return `
      <div class="device-name">🔗 Shared actions</div>
      <p class="muted">One set of actions for buttons on lots of keypads. Change it once and every button updates.</p>
      <div class="shared-list">
        ${
          items.length
            ? items
                .map(
                  ([id, config]) => `<button class="dev ${s.sharedDraft?.id === id ? "active" : ""}" data-act="shared-open" data-id="${esc(id)}">
                    <span class="dev-title">${esc(config.alias || "Shared action")}</span>
                    <small>${esc(this._sharedSummary(config))}</small>
                  </button>`
                )
                .join("")
            : `<p class="muted center">None yet ✨</p>`
        }
      </div>
      <button class="add" data-act="shared-new">＋ New shared action</button>`;
  }

  _renderSharedEditor() {
    const s = this._s;
    const d = s.sharedDraft;
    if (!d) {
      return `<div class="empty">Pick a shared action, or make a new one ✨</div>
        ${s.msg ? `<div class="msg ${s.msg.type}">${esc(s.msg.text)}</div>` : ""}`;
    }
    const what = typeLabel(d.type).replace(/^When /, "");
    const typeOptions = this._sharedTypes(d)
      .map((t) => `<option value="${esc(t)}" ${t === d.type ? "selected" : ""}>${esc(typeLabel(t))}</option>`)
      .join("");
    const members = d.members
      .map((m) => {
        const { button, where } = this._memberLabel(m);
        const cached = this._triggerCache.get(m.deviceId);
        const ok = !cached || cached.some((t) => String(t.subtype) === m.subtype && t.type === d.type);
        return `<div class="member">
          <span class="ef-text"><span class="ef-name">${esc(button)}</span><span class="ef-meta">${esc(where)}</span></span>
          ${ok ? "" : `<span class="warn">can't do “${esc(what)}”</span>`}
          <button class="icon" data-act="s-remove-member" data-key="${esc(memberKey(m.deviceId, m.subtype))}" title="Remove this button">✕</button>
        </div>`;
      })
      .join("");

    return `
      <h2>${d.id ? esc(d.name || "Shared action") : "New shared action"}</h2>
      <div class="inline"><label>Name</label><input class="grow" data-sfield="name" value="${esc(d.name)}" placeholder="e.g. Movie time"></div>
      <div class="inline"><label>Runs when</label><select data-sfield="type">${typeOptions}</select></div>

      <div class="section">
        <h3>Buttons <span class="muted">${d.members.length}</span></h3>
        <div class="members">${members || `<div class="muted empty-rows">No buttons yet. Add some from any keypad 👇</div>`}</div>
        <button class="add" data-act="bp-open">＋ Add buttons from any keypad</button>
      </div>

      <div class="section">
        <h3>Actions</h3>
        <p class="muted">Actions run top to bottom.</p>
        <div class="rows">
          ${s.rows.length ? s.rows.map((r, i) => this._renderRow(r, i)).join("") : `<div class="muted empty-rows">No actions yet, add one below 👇</div>`}
        </div>
        <button class="add" data-act="add">＋ Add action</button>
      </div>
      ${s.msg ? `<div class="msg ${s.msg.type}">${esc(s.msg.text)}</div>` : ""}
      <div class="footer">
        ${d.id ? `<button class="danger" data-act="s-delete" ${s.busy ? "disabled" : ""}>Delete</button>` : ""}
        <span class="spacer"></span>
        ${s.dirty ? `<span class="muted">unsaved changes</span>` : ""}
        <button class="primary" data-act="s-save" ${s.busy ? "disabled" : ""}>${s.busy ? "Saving…" : "Save"}</button>
      </div>
      ${
        d.id
          ? `<div class="advanced">Want conditions or other fancy stuff?
              <button class="link" data-act="open-editor" data-id="${esc(d.id)}">Open in HA automation editor ↗</button></div>`
          : ""
      }`;
  }

  _renderButtonPicker() {
    if (!this._bp) return "";
    return `
      <div class="picker-backdrop" data-act="bp-close"></div>
      <div class="picker" role="dialog" aria-label="Choose buttons">
        <div class="picker-head">
          <h3>Choose buttons</h3>
          <button class="icon" data-act="bp-close" title="Close">✕</button>
        </div>
        <input id="bp-q" type="search" placeholder="Search keypads or rooms…" value="${esc(this._bp.q)}" autocomplete="off">
        <div id="bp-list" class="pick-list"></div>
        <div class="picker-foot">
          <span class="muted" id="bp-count"></span>
          <span class="spacer"></span>
          <button class="ghost" data-act="bp-close">Cancel</button>
          <button class="primary" data-act="bp-done">Done</button>
        </div>
      </div>`;
  }

  _renderButtonPickerList() {
    const bp = this._bp;
    const box = this.shadowRoot.querySelector("#bp-list");
    if (!bp || !box) return;
    const count = this.shadowRoot.querySelector("#bp-count");
    if (count) count.textContent = `${bp.selected.size} selected`;
    if (bp.loading) {
      box.innerHTML = `<p class="muted center">Loading buttons…</p>`;
      return;
    }
    const words = bp.q.toLowerCase().split(/\s+/).filter(Boolean);
    const devices = this._s.devices.filter((d) => {
      const hay = `${d.title} ${d.name} ${d.area} ${d.type}`.toLowerCase();
      return words.every((w) => hay.includes(w)) && this._buttonsOf(d.id).length;
    });
    if (!devices.length) {
      box.innerHTML = `<p class="muted center">No keypads match 🥲</p>`;
      return;
    }
    let lastArea = null;
    box.innerHTML = devices
      .map((d) => {
        const header = d.area !== lastArea ? `<div class="area">${esc(d.area || "No area")}</div>` : "";
        lastArea = d.area;
        const buttons = this._buttonsOf(d.id)
          .map((subtype) => {
            const key = memberKey(d.id, subtype);
            const on = bp.selected.has(key);
            const label = this._s.layouts[d.id]?.labels?.[subtype] || pretty(subtype);
            return `<button class="bp-btn ${on ? "on" : ""}" data-act="bp-toggle" data-key="${esc(key)}" aria-pressed="${on}">${on ? "✓ " : ""}${esc(label)}</button>`;
          })
          .join("");
        return `${header}<div class="bp-keypad">
          <div class="bp-title">${esc(d.title)}${d.showPosition ? ` <span class="chip">Pos ${d.position}</span>` : ""} <small class="muted">${esc(d.type || d.code || "")}</small></div>
          <div class="bp-buttons">${buttons}</div>
        </div>`;
      })
      .join("");
  }

  _renderLedSection(button) {
    const s = this._s;
    if (!button.ledEntity || !s.led) return "";
    const led = s.led;
    const saved = !!s.ledConfigs[ledId(s.deviceId, button.subtype)];
    const modes = [
      ["lutron", "What Lutron programmed (default)"],
      ["follow", "Whether a device is on"],
      ...(led.mode === "custom" ? [["custom", "Custom (edited in HA)"]] : []),
    ]
      .map(([v, l]) => `<option value="${v}" ${v === led.mode ? "selected" : ""}>${esc(l)}</option>`)
      .join("");

    let body = "";
    if (led.mode === "follow") {
      body = `
        ${this._entityButton(led.entity, "led", "Choose what the LED follows…")}
        <div class="inline"><label>LED on when</label>
          <input placeholder="on" value="${esc(led.state)}" data-led-field="state">
        </div>
        <div class="muted">Most things use <b>on</b>. Shades use <b>open</b>, locks use <b>locked</b>.</div>`;
    } else if (led.mode === "custom") {
      body = `<div class="muted">This LED automation was changed in HA's editor, so it's managed there.
        <button class="link" data-act="open-editor" data-id="${esc(ledId(s.deviceId, button.subtype))}">Open it ↗</button></div>`;
    }

    return `
      <div class="section">
        <h3>💡 LED <span class="muted" id="led-state" data-led-entity="${esc(button.ledEntity)}"></span></h3>
        <div class="inline"><label>LED shows</label><select data-led-field="mode">${modes}</select></div>
        ${body}
        <div class="muted">Heads up: your RA3 processor can still change this LED too, like when a Lutron scene runs. You can also turn LEDs on/off from any button with the “Keypad LED” actions.</div>
        ${s.ledMsg ? `<div class="msg ${s.ledMsg.type}">${esc(s.ledMsg.text)}</div>` : ""}
        ${
          led.mode === "custom"
            ? ""
            : `<div class="footer">
                ${saved ? `<button class="danger" data-act="led-remove">Stop controlling</button>` : ""}
                <span class="spacer"></span>
                ${s.ledDirty ? `<span class="muted">unsaved</span>` : ""}
                <button class="primary" data-act="led-save">Save LED</button>
              </div>`
        }
      </div>`;
  }

  _renderRelated(button) {
    const list = this._relatedFor(button);
    if (!list.length) return "";
    return `
      <div class="section">
        <h3>🔗 Other automations using this button</h3>
        <div class="muted">Made outside Keypad Builder. They run too when the button is used. Import one to manage it here.</div>
        ${list
          .map((r) => {
            const types = [...new Set(r.triggers.filter((t) => String(t.subtype) === button.key).map((t) => typeLabel(t.type).replace("When ", "")))];
            return `<div class="related">
              <div><div>${esc(r.name)}</div><div class="muted">${esc(types.join(", "))}</div></div>
              ${
                r.id
                  ? `<span class="related-actions">
                      <button class="link" data-act="imp-open" data-id="${esc(r.id)}">📥 Import</button>
                      <button class="link" data-act="open-editor" data-id="${esc(r.id)}">Open ↗</button>
                    </span>`
                  : `<span class="muted" title="Automations written in YAML without an id can't open in the editor">YAML only</span>`
              }
            </div>`;
          })
          .join("")}
      </div>`;
  }

  _renderRow(row, i) {
    const kindValue = row.kind === "service" ? row.service : row.kind;
    const options = [
      ...PRESETS.map((p) => [p.service, p.label]),
      ["delay", "Wait"],
      ["custom", "Custom action…"],
      ...(row.kind === "raw" ? [["raw", "Advanced (JSON)"]] : []),
    ]
      .map(([v, l]) => `<option value="${esc(v)}" ${v === kindValue ? "selected" : ""}>${esc(l)}</option>`)
      .join("");

    let body = "";
    if (row.kind === "service") {
      const preset = presetFor(row.service);
      body = `
        ${this._entityButton(row.entity, `row-${i}`, preset.led ? "Choose a keypad LED…" : "Choose what to control…")}
        ${
          preset.brightness
            ? `<div class="inline">
                <label>Brightness</label>
                <input type="range" min="1" max="100" value="${esc(row.brightness ?? 100)}" data-row="${i}" data-field="brightness">
                <span id="bval-${i}" class="val">${esc(row.brightness ?? 100)}%</span>
              </div>
              <div class="inline">
                <label>Fade (sec)</label>
                <input type="number" min="0" step="0.5" placeholder="optional" value="${esc(row.transition ?? "")}" data-row="${i}" data-field="transition">
              </div>`
            : ""
        }`;
    } else if (row.kind === "custom") {
      body = `
        <input class="grow" list="dl-services" placeholder="action, e.g. light.turn_on" value="${esc(row.service)}" data-row="${i}" data-field="service">
        ${this._entityButton(row.entity, `row-${i}`, "Entity (optional)…")}
        <textarea rows="3" placeholder='extra data as JSON, e.g. {"color_name": "pink"}' data-row="${i}" data-field="dataText">${esc(row.dataText)}</textarea>`;
    } else if (row.kind === "delay") {
      body = `<div class="inline"><label>Seconds</label>
        <input type="number" min="0" step="0.5" value="${esc(row.seconds)}" data-row="${i}" data-field="seconds"></div>`;
    } else {
      body = `<p class="muted">This step was made somewhere else, so it's shown as JSON. It's kept as-is unless you edit it.</p>
        <textarea rows="6" data-row="${i}" data-field="text">${esc(row.text)}</textarea>`;
    }

    return `
      <div class="row">
        <div class="row-head">
          <span class="num">${i + 1}</span>
          <select data-kind="${i}">${options}</select>
          <button class="icon" data-act="up" data-row="${i}" title="Move up">↑</button>
          <button class="icon" data-act="down" data-row="${i}" title="Move down">↓</button>
          <button class="icon" data-act="remove" data-row="${i}" title="Remove">✕</button>
        </div>
        <div class="row-body">${body}</div>
      </div>`;
  }

  _renderDatalists() {
    const services = Object.entries(this._hass.services || {}).flatMap(([d, svcs]) =>
      Object.keys(svcs).map((svc) => `<option value="${esc(`${d}.${svc}`)}"></option>`)
    );
    return `<datalist id="dl-services">${services.join("")}</datalist>`;
  }

  // ---------- entity picker ----------

  _areaOf(entityId) {
    return this._areaName?.[this._entityArea?.[entityId]] || "";
  }

  _entityButton(value, pickId, placeholder) {
    const st = this._hass.states[value];
    const meta = [this._areaOf(value), value].filter(Boolean).join(" · ") + (value && !st ? " · ⚠️ not found" : "");
    return `<button class="entity-field ${value ? "" : "empty"}" data-act="pick" data-pick="${esc(pickId)}">
      <span class="ef-text">
        <span class="ef-name">${esc(value ? st?.attributes.friendly_name || value : placeholder)}</span>
        ${value ? `<span class="ef-meta">${esc(meta)}</span>` : ""}
      </span>
      <span class="ef-chev">▾</span>
    </button>`;
  }

  _openPicker(pickId) {
    const s = this._s;
    let domains = null;
    let led = false;
    let value = "";
    if (pickId === "led") {
      value = s.led?.entity || "";
    } else {
      const row = s.rows[Number(pickId.slice(4))];
      if (!row) return;
      value = row.entity || "";
      const preset = row.kind === "service" ? presetFor(row.service) : null;
      led = !!preset?.led;
      domains = preset && !led ? preset.domains : null;
    }
    this._picker = { pickId, domains, led, value, q: "", area: "", type: "" };
    this._render();
    this.shadowRoot.querySelector("#pick-q")?.focus();
  }

  _closePicker() {
    this._picker = null;
    this._render();
  }

  _choose(entityId) {
    const s = this._s;
    const { pickId } = this._picker;
    if (pickId === "led") {
      s.led.entity = entityId;
      s.ledDirty = true;
    } else {
      s.rows[Number(pickId.slice(4))].entity = entityId;
      s.dirty = true;
      s.msg = null;
    }
    this._closePicker();
  }

  // Everything this field could pick from, before the room/type/search filters.
  _pickerCandidates() {
    const p = this._picker;
    const states = Object.values(this._hass.states);
    if (p.led) {
      // keypad LEDs: this keypad's first, then anything else that looks like one
      const own = new Set(this._s.buttons.map((b) => b.ledEntity).filter(Boolean));
      return states.filter(
        (st) =>
          own.has(st.entity_id) ||
          (st.entity_id.startsWith("switch.") && /\bled\b/i.test(`${st.entity_id.replace(/_/g, " ")} ${st.attributes.friendly_name || ""}`))
      );
    }
    if (p.domains) return states.filter((st) => p.domains.includes(st.entity_id.split(".")[0]));
    return states;
  }

  _renderPicker() {
    const p = this._picker;
    if (!p) return "";
    const candidates = this._pickerCandidates();
    const rooms = new Map();
    let noRoom = false;
    const types = new Set();
    for (const st of candidates) {
      const areaId = this._entityArea?.[st.entity_id];
      if (areaId && this._areaName?.[areaId]) rooms.set(areaId, this._areaName[areaId]);
      else noRoom = true;
      types.add(st.entity_id.split(".")[0]);
    }
    const roomOptions = [...rooms.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => `<option value="${esc(id)}" ${p.area === id ? "selected" : ""}>${esc(name)}</option>`)
      .join("");
    const typeOptions = [...types]
      .sort((a, b) => domainLabel(a).replace(/^\W+/, "").localeCompare(domainLabel(b).replace(/^\W+/, "")))
      .map((t) => `<option value="${esc(t)}" ${p.type === t ? "selected" : ""}>${esc(domainLabel(t))}</option>`)
      .join("");
    const title = p.led ? "Choose a keypad LED" : p.pickId === "led" ? "What should the LED follow?" : "Choose what to control";

    return `
      <div class="picker-backdrop" data-act="pick-close"></div>
      <div class="picker" role="dialog" aria-label="${esc(title)}">
        <div class="picker-head">
          <h3>${esc(title)}</h3>
          <button class="icon" data-act="pick-close" title="Close">✕</button>
        </div>
        <input id="pick-q" type="search" placeholder="Search by name…" value="${esc(p.q)}" autocomplete="off">
        <div class="picker-filters">
          <select id="pick-area" aria-label="Room">
            <option value="">🏠 All rooms</option>
            ${roomOptions}
            ${noRoom ? `<option value="__none" ${p.area === "__none" ? "selected" : ""}>No room</option>` : ""}
          </select>
          ${
            types.size > 1
              ? `<select id="pick-type" aria-label="Type"><option value="">✨ All types</option>${typeOptions}</select>`
              : ""
          }
        </div>
        <div id="pick-list" class="pick-list"></div>
        ${p.value ? `<div class="picker-foot"><button class="ghost" data-act="pick-choose" data-entity="">Clear selection</button></div>` : ""}
      </div>`;
  }

  _renderPickerList() {
    const p = this._picker;
    const box = this.shadowRoot.querySelector("#pick-list");
    if (!p || !box) return;
    const words = p.q.toLowerCase().split(/\s+/).filter(Boolean);
    const items = this._pickerCandidates()
      .map((st) => ({
        id: st.entity_id,
        name: st.attributes.friendly_name || st.entity_id,
        domain: st.entity_id.split(".")[0],
        areaId: this._entityArea?.[st.entity_id] || null,
        area: this._areaOf(st.entity_id),
        state: st.state,
      }))
      .filter((e) => !p.type || e.domain === p.type)
      .filter((e) => !p.area || (p.area === "__none" ? !e.area : e.areaId === p.area))
      .filter((e) => {
        const hay = `${e.name} ${e.id} ${e.area}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => (a.area || "~").localeCompare(b.area || "~") || a.name.localeCompare(b.name));

    if (!items.length) {
      box.innerHTML = `<p class="muted center">Nothing matches 🥲 Try another room, type or search.</p>`;
      return;
    }
    const LIMIT = 250;
    let lastArea = null;
    box.innerHTML =
      items
        .slice(0, LIMIT)
        .map((e) => {
          const header = e.area !== lastArea ? `<div class="area">${esc(e.area || "No room")}</div>` : "";
          lastArea = e.area;
          return `${header}<button class="pick-item ${e.id === p.value ? "active" : ""}" data-act="pick-choose" data-entity="${esc(e.id)}">
            <span class="pi-text"><span class="pi-name">${esc(e.name)}</span>
            <span class="pi-meta">${esc(domainLabel(e.domain))} · ${esc(e.id)}</span></span>
            <span class="pi-state">${esc(e.state)}</span>
          </button>`;
        })
        .join("") +
      (items.length > LIMIT ? `<p class="muted center">Showing ${LIMIT} of ${items.length}. Search or filter to narrow it down.</p>` : "");
  }
}

const STYLES = `
  /* Auto: borrow Home Assistant's theme so we match light/dark automatically. */
  :host {
    --kb-bg: var(--primary-background-color, #f5f5f7);
    --kb-card: var(--card-background-color, #fff);
    --kb-text: var(--primary-text-color, #1c1c1e);
    --kb-muted: var(--secondary-text-color, #6b6b70);
    --kb-border: var(--divider-color, rgba(0,0,0,.12));
    --kb-input: var(--primary-background-color, #fafafa);
    --kb-header: var(--app-header-background-color, var(--kb-card));
    --kb-header-text: var(--app-header-text-color, var(--kb-text));
    --kb-accent: var(--primary-color, #03a9f4);
    --kb-on-accent: var(--text-primary-color, #fff);
    --kb-on: var(--success-color, #43a047);
    --kb-error: var(--error-color, #db4437);
    --kb-other: var(--info-color, #039be5);
    --kb-shared: #9b6dff;
    --kb-radius: 14px;

    display: block;
    min-height: 100vh;
    background: var(--kb-bg);
    color: var(--kb-text);
    font-family: var(--paper-font-body1_-_font-family, system-ui, sans-serif);
  }
  /* Forced themes from the ☀️/🌙 button, independent of HA's theme. */
  :host([mode="light"]) {
    --kb-bg: #f5f5f7; --kb-card: #ffffff; --kb-text: #1c1c1e; --kb-muted: #6b6b70;
    --kb-border: rgba(0,0,0,.12); --kb-input: #fafafa; --kb-header: #ffffff; --kb-header-text: #1c1c1e;
  }
  :host([mode="dark"]) {
    --kb-bg: #111114; --kb-card: #1c1c20; --kb-text: #ececf0; --kb-muted: #9a9aa3;
    --kb-border: rgba(255,255,255,.12); --kb-input: #26262b; --kb-header: #1c1c20; --kb-header-text: #ececf0;
  }
  :host([dark]) { color-scheme: dark; }

  * { box-sizing: border-box; }
  .toolbar {
    display: flex; align-items: center; gap: 8px; height: 56px; padding: 0 16px;
    background: var(--kb-header); color: var(--kb-header-text);
    border-bottom: 1px solid var(--kb-border);
  }
  .title { font-size: 20px; font-weight: 500; }
  .theme { font-size: 18px; color: inherit; }
  .layout {
    display: grid; gap: 16px; padding: 16px;
    grid-template-columns: minmax(220px, 280px) minmax(260px, 340px) minmax(0, 1fr);
    align-items: start;
  }
  @media (max-width: 1000px) { .layout { grid-template-columns: 1fr 1fr; } .editor { grid-column: 1 / -1; } }
  @media (max-width: 640px) { .layout { grid-template-columns: 1fr; } }
  .card { background: var(--kb-card); border: 1px solid var(--kb-border); border-radius: var(--kb-radius); padding: 16px; min-width: 0; }
  .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  h2 { margin: 0 0 12px; font-size: 18px; font-weight: 600; }
  .muted { color: var(--kb-muted); font-size: 13px; }
  .center { text-align: center; }
  .empty { color: var(--kb-muted); text-align: center; padding: 48px 8px; }
  .spacer { flex: 1; }
  input, select, textarea {
    font: inherit; color: inherit; background: var(--kb-input);
    border: 1px solid var(--kb-border); border-radius: 10px; padding: 8px 10px; min-width: 0;
  }
  textarea { width: 100%; font-family: ui-monospace, monospace; font-size: 13px; resize: vertical; }
  input:focus, select:focus, textarea:focus { outline: 2px solid var(--kb-accent); outline-offset: -1px; }
  #search { width: 100%; margin-bottom: 8px; }
  .check { display: flex; gap: 6px; align-items: center; font-size: 13px; color: var(--kb-muted); margin-bottom: 8px; }
  button { font: inherit; cursor: pointer; color: inherit; }
  button:disabled { opacity: .4; cursor: default; }
  .icon { background: none; border: none; border-radius: 8px; padding: 4px 8px; font-size: 14px; color: var(--kb-muted); }
  .icon:hover:not(:disabled) { background: var(--kb-border); }
  .ghost { background: none; border: 1px solid var(--kb-border); border-radius: 10px; padding: 7px 12px; font-size: 13px; white-space: nowrap; }
  .ghost:hover { border-color: var(--kb-accent); }
  .area { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--kb-muted); margin: 12px 4px 4px; }
  .dev {
    display: flex; flex-direction: column; align-items: flex-start; width: 100%; text-align: left;
    background: none; border: 1px solid transparent; border-radius: 10px; padding: 8px 10px;
  }
  .dev small { color: var(--kb-muted); }
  .dev:hover { background: var(--kb-border); }
  .dev.active { border-color: var(--kb-accent); background: color-mix(in srgb, var(--kb-accent) 12%, transparent); }
  .device-name { font-weight: 600; font-size: 17px; }
  .dev-title { font-weight: 500; }
  .chip {
    display: inline-block; font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: 999px;
    background: color-mix(in srgb, var(--kb-accent) 16%, transparent); color: var(--kb-text); vertical-align: middle;
  }

  /* ---- entity picker ---- */
  .entity-field {
    display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
    background: var(--kb-input); border: 1px solid var(--kb-border); border-radius: 10px; padding: 8px 10px;
  }
  .entity-field:hover { border-color: var(--kb-accent); }
  .entity-field.empty .ef-name { color: var(--kb-muted); }
  .ef-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .ef-name, .pi-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ef-meta, .pi-meta { font-size: 12px; color: var(--kb-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ef-chev { color: var(--kb-muted); }
  .picker-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); z-index: 10; }
  .picker {
    position: fixed; z-index: 11; left: 50%; top: 50%; translate: -50% -50%;
    width: min(560px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 48px));
    display: flex; flex-direction: column; gap: 10px; padding: 16px;
    background: var(--kb-card); color: var(--kb-text); border: 1px solid var(--kb-border); border-radius: var(--kb-radius);
    box-shadow: 0 20px 60px rgba(0, 0, 0, .35);
  }
  .picker-head { display: flex; align-items: center; justify-content: space-between; }
  .picker-filters { display: flex; gap: 8px; flex-wrap: wrap; }
  .picker-filters select { flex: 1; min-width: 160px; }
  .pick-list { overflow-y: auto; min-height: 120px; display: flex; flex-direction: column; gap: 2px; }
  .pick-list .area { margin-top: 10px; }
  .pick-item {
    display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
    background: none; border: 1px solid transparent; border-radius: 10px; padding: 8px 10px;
  }
  .pick-item:hover { background: var(--kb-border); }
  .pick-item.active { border-color: var(--kb-accent); background: color-mix(in srgb, var(--kb-accent) 12%, transparent); }
  .pi-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .pi-state { font-size: 12px; color: var(--kb-muted); flex: none; }
  .picker-foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .picker p { margin: 0; }
  .picker:focus { outline: none; }
  .related-actions { display: flex; gap: 14px; flex: none; }
  .choices { display: flex; flex-direction: column; gap: 8px; }
  .choice {
    display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; cursor: pointer;
    border: 1px solid var(--kb-border); border-radius: 12px;
  }
  .choice:has(input:checked) { border-color: var(--kb-accent); background: color-mix(in srgb, var(--kb-accent) 10%, transparent); }
  .choice input { margin-top: 3px; }
  .chip.on { background: color-mix(in srgb, var(--kb-on) 22%, transparent); }
  .sort { margin-bottom: 8px; }
  .sort label { min-width: 0; }
  .shared-entry { margin: 4px 0 4px; border-color: var(--kb-border); }
  .shared-list { display: flex; flex-direction: column; gap: 2px; margin: 8px 0 12px; }
  .members { display: flex; flex-direction: column; gap: 6px; }
  .member { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--kb-border); border-radius: 10px; }
  .warn { font-size: 12px; color: var(--kb-error); white-space: nowrap; }
  .bp-keypad { padding: 6px 4px 10px; }
  .bp-title { font-weight: 500; margin-bottom: 6px; }
  .bp-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
  .bp-btn {
    border: 1px solid var(--kb-border); background: var(--kb-input); border-radius: 999px;
    padding: 5px 12px; font-size: 13px;
  }
  .bp-btn:hover { border-color: var(--kb-accent); }
  .bp-btn.on { background: var(--kb-accent); border-color: var(--kb-accent); color: var(--kb-on-accent); }
  .source { margin-top: 10px; font-size: 12px; color: var(--kb-muted); }

  /* ---- faceplate ---- */
  .faceplate {
    --fp-top: #fdfdfb; --fp-bottom: #ecebe6; --fp-btn-top: #ffffff; --fp-btn-bottom: #f1f0eb;
    --fp-text: #3a3a3c; --fp-edge: rgba(0,0,0,.14);
    margin: 16px auto; width: 210px; padding: 28px 22px; border-radius: 18px;
    background: linear-gradient(160deg, var(--fp-top), var(--fp-bottom));
    box-shadow: 0 1px 0 rgba(255,255,255,.5) inset, 0 8px 24px rgba(0,0,0,.25), 0 0 0 1px rgba(0,0,0,.1);
    display: flex; flex-direction: column; gap: 10px;
  }
  .finish-ivory { --fp-top: #fbf7ec; --fp-bottom: #ece4cf; --fp-btn-top: #fdf9ef; --fp-btn-bottom: #efe8d6; --fp-text: #4a4436; }
  .finish-gray { --fp-top: #a9aaa8; --fp-bottom: #8c8d8b; --fp-btn-top: #b3b4b2; --fp-btn-bottom: #999a98; --fp-text: #222; }
  .finish-black, :host([dark]) .finish-auto {
    --fp-top: #2c2c2e; --fp-bottom: #161617; --fp-btn-top: #313133; --fp-btn-bottom: #1f1f21;
    --fp-text: #d6d6d8; --fp-edge: rgba(255,255,255,.08);
  }
  .finish-brass { --fp-top: #d9c18a; --fp-bottom: #a88a4c; --fp-btn-top: #e2cc98; --fp-btn-bottom: #b99a5a; --fp-text: #3b2f16; }
  .finish-nickel { --fp-top: #dcdddf; --fp-bottom: #a9abaf; --fp-btn-top: #e5e6e8; --fp-btn-bottom: #b6b8bc; --fp-text: #2e3034; }
  .kbtn {
    position: relative; display: flex; align-items: center; justify-content: center;
    width: 100%; min-height: 44px; padding: 6px 20px; border-radius: 8px;
    background: linear-gradient(var(--fp-btn-top), var(--fp-btn-bottom)); color: var(--fp-text);
    border: 1px solid var(--fp-edge); box-shadow: 0 2px 3px rgba(0,0,0,.15);
    font-size: 12px; letter-spacing: .08em; text-transform: uppercase;
    transition: transform .08s, box-shadow .15s;
  }
  .kbtn .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kbtn:hover { box-shadow: 0 2px 8px rgba(0,0,0,.28); }
  .kbtn:active { transform: translateY(1px); }
  .kbtn.active { outline: 3px solid var(--kb-accent); outline-offset: 2px; }
  .kbtn.is-hidden { opacity: .35; border-style: dashed; }
  .kbtn .dot { position: absolute; right: 8px; top: 50%; translate: 0 -50%; }
  .kbtn.has .dot { background: var(--kb-on); }
  .kbtn .led {
    position: absolute; left: 8px; top: 50%; translate: 0 -50%;
    width: 4px; height: 12px; border-radius: 2px; background: color-mix(in srgb, var(--fp-text) 30%, transparent);
  }
  .kbtn .led.lit {
    background: #ffd76a; box-shadow: 0 0 6px 2px rgba(255, 200, 80, .75);
  }
  .kbtn.has-other .dot { background: var(--kb-other); }
  .kbtn.has-shared .dot { background: var(--kb-shared); }
  .pair { display: flex; gap: 8px; }
  .kbtn.small { min-height: 34px; padding: 4px 16px; font-size: 11px; }
  .kbtn.small.with-led { padding-left: 18px; padding-right: 14px; letter-spacing: .04em; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: transparent; vertical-align: middle; }
  .dot.on { background: var(--kb-on); }
  .dot.other { background: var(--kb-other); }
  .dot.shared { background: var(--kb-shared); }
  .legend { margin-top: 4px; display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 14px; }

  /* ---- extra editor sections ---- */
  .section { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--kb-border); display: flex; flex-direction: column; gap: 8px; }
  h3 { margin: 0; font-size: 16px; font-weight: 600; display: flex; align-items: baseline; gap: 8px; }
  .section .footer { margin-top: 4px; }
  .advanced { margin-top: 12px; font-size: 14px; }
  .link { background: none; border: none; padding: 0; color: var(--kb-accent); font-weight: 500; }
  .link:hover { text-decoration: underline; }
  .related { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border: 1px solid var(--kb-border); border-radius: 10px; }

  /* ---- layout editor ---- */
  .layout-editor { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--kb-border); padding-top: 12px; }
  .layout-editor p { margin: 0; }
  .lrow { border: 1px solid var(--kb-border); border-radius: 12px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .lrow-head { display: flex; align-items: center; gap: 2px; }
  .lbtn { display: flex; align-items: center; gap: 8px; }
  .lbtn input:not([type]) { flex: 1; }
  .lbtn .check { margin: 0; }

  /* ---- action editor ---- */
  .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .tab { border: 1px solid var(--kb-border); background: none; border-radius: 999px; padding: 6px 14px; }
  .tab.active { background: var(--kb-accent); border-color: var(--kb-accent); color: var(--kb-on-accent); }
  .rows { display: flex; flex-direction: column; gap: 10px; margin: 8px 0 12px; }
  .empty-rows { padding: 16px; border: 1px dashed var(--kb-border); border-radius: 12px; text-align: center; }
  .row { border: 1px solid var(--kb-border); border-radius: 12px; padding: 10px; }
  .row-head { display: flex; align-items: center; gap: 6px; }
  .row-head select { flex: 1; }
  .num {
    flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center;
    background: var(--kb-accent); color: var(--kb-on-accent); font-size: 12px; font-weight: 600;
  }
  .row-body { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; padding-left: 30px; }
  .grow { width: 100%; }
  .hint { font-size: 12px; color: var(--kb-muted); margin-top: -4px; }
  .hint:empty { display: none; }
  .inline { display: flex; align-items: center; gap: 10px; }
  .inline label { font-size: 13px; color: var(--kb-muted); min-width: 80px; }
  .inline input[type=range] { flex: 1; }
  .inline input[type=number] { width: 110px; }
  .inline select { flex: 1; }
  .val { min-width: 40px; text-align: right; font-variant-numeric: tabular-nums; }
  .add { width: 100%; padding: 10px; border: 1px dashed var(--kb-accent); color: var(--kb-accent); background: none; border-radius: 12px; }
  .add:hover { background: color-mix(in srgb, var(--kb-accent) 8%, transparent); }
  .footer { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
  .layout-editor .footer { margin-top: 4px; }
  .primary { background: var(--kb-accent); color: var(--kb-on-accent); border: none; border-radius: 10px; padding: 10px 22px; font-weight: 600; }
  .danger { background: none; color: var(--kb-error); border: 1px solid var(--kb-error); border-radius: 10px; padding: 9px 16px; }
  .msg { margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 14px; }
  .msg.ok { background: color-mix(in srgb, var(--kb-on) 14%, transparent); }
  .msg.error { background: color-mix(in srgb, var(--kb-error) 14%, transparent); color: var(--kb-error); }
`;

customElements.define("keypad-builder-panel", KeypadBuilderPanel);
