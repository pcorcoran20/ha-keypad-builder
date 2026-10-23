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
const ledId = (deviceId, subtype) => `${ID_PREFIX}_${deviceId}_${slug(subtype)}_led`;
const isOurs = (id) => String(id || "").startsWith(`${ID_PREFIX}_`);

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
      const [devices, areas, entries, layouts] = await Promise.all([
        this._hass.callWS({ type: "config/device_registry/list" }),
        this._hass.callWS({ type: "config/area_registry/list" }),
        this._hass.callWS({ type: "config_entries/get", domain: DEFAULT_DOMAIN }).catch(() => []),
        this._hass.callWS({ type: "keypad_builder/layouts/get" }).catch(() => ({})),
      ]);
      s.layouts = layouts || {};
      const areaName = Object.fromEntries(areas.map((a) => [a.area_id, a.name]));
      const entryIds = new Set(entries.map((e) => e.entry_id));

      let list = devices
        .filter((d) => !d.disabled_by && (s.allDevices || d.config_entries.some((id) => entryIds.has(id))))
        .map((d) => ({
          id: d.id,
          name: d.name_by_user || d.name || "Unnamed device",
          area: areaName[d.area_id] || "",
          model: d.model || "",
        }));

      // For Lutron, only keep devices that actually have buttons.
      if (!s.allDevices) {
        const checked = await Promise.all(
          list.map(async (d) => ((await this._triggers(d.id).catch(() => [])).length ? d : null))
        );
        list = checked.filter(Boolean);
      }

      list.sort((a, b) => (a.area || "~").localeCompare(b.area || "~") || a.name.localeCompare(b.name));
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
    return (!this._s.dirty && !this._s.ledDirty) || confirm("You have unsaved changes for this button. Leave without saving?");
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
      alias: existing.alias || `Keypad LED · ${device?.name || "Keypad"} · ${this._layoutLabel(button.key)}`,
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
      alias: existing.alias || `Keypad · ${device?.name || "Keypad"} · ${cur.button.label} (${pretty(s.type)})`,
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
          return this._render();
        case "remove":
          s.rows.splice(i, 1);
          s.dirty = true;
          return this._render();
        case "up":
        case "down": {
          const j = el.dataset.act === "up" ? i - 1 : i + 1;
          if (j < 0 || j >= s.rows.length) return;
          [s.rows[i], s.rows[j]] = [s.rows[j], s.rows[i]];
          s.dirty = true;
          return this._render();
        }
        case "save":
          return this._save();
        case "delete":
          return this._delete();
        case "reload":
          this._triggerCache.clear();
          return this._loadDevices();
        case "theme":
          return this._cycleTheme();
        case "open-editor":
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

    root.addEventListener("input", (ev) => {
      const el = ev.target;
      const s = this._s;
      if (el.id === "search") {
        s.filter = el.value;
        return this._renderDeviceList();
      }
      if (el.dataset.ledField != null && el.tagName !== "SELECT") {
        s.led[el.dataset.ledField] = el.value;
        s.ledDirty = true;
        const hint = root.querySelector("#hint-led");
        if (hint && el.dataset.ledField === "entity") hint.textContent = this._entityName(el.value);
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
      if (el.dataset.field === "brightness") {
        const out = root.querySelector(`#bval-${el.dataset.row}`);
        if (out) out.textContent = `${el.value}%`;
      }
      if (el.dataset.field === "entity") {
        const hint = root.querySelector(`#hint-${el.dataset.row}`);
        if (hint) hint.textContent = this._entityName(el.value);
      }
    });

    root.addEventListener("change", (ev) => {
      const el = ev.target;
      const s = this._s;
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
        if (presetFor(el.value)?.led) row.entity = this._current()?.button.ledEntity || "";
        else if ("entity" in row && old.entity) row.entity = old.entity;
        s.rows[i] = row;
        s.dirty = true;
        this._render();
      }
    });
  }

  _entityName(entityId) {
    const st = this._hass.states[entityId];
    return st ? st.attributes.friendly_name || entityId : entityId ? "⚠️ entity not found" : "";
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
            <button class="icon" data-act="reload" title="Reload">↻</button>
          </div>
          <input id="search" type="search" placeholder="Search keypads…" value="${esc(s.filter)}">
          <label class="check"><input id="all-devices" type="checkbox" ${s.allDevices ? "checked" : ""}> Show devices from all integrations</label>
          <div id="devlist"></div>
        </section>

        <section class="card keypad-wrap">
          ${this._renderKeypad(device)}
        </section>

        <section class="card editor">
          ${this._renderEditor()}
        </section>
      </div>
      ${this._renderDatalists()}
    `;
    this._renderDeviceList();
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
    const list = s.devices.filter((d) => `${d.name} ${d.area} ${d.model}`.toLowerCase().includes(q));
    if (!list.length) {
      box.innerHTML = s.devices.length
        ? `<p class="muted">No matches for that search.</p>`
        : `<p class="muted">No Lutron keypads found 🥲<br>Make sure the <b>Lutron Caséta</b> integration (it handles RA3 too) is set up, or tick “all integrations” above.</p>`;
      return;
    }
    let lastArea = null;
    box.innerHTML = list
      .map((d) => {
        const header = d.area !== lastArea ? `<div class="area">${esc(d.area || "No area")}</div>` : "";
        lastArea = d.area;
        return `${header}<button class="dev ${d.id === s.deviceId ? "active" : ""}" data-act="device" data-id="${esc(d.id)}">
          <span>${esc(d.name)}</span>${d.model ? `<small>${esc(d.model)}</small>` : ""}
        </button>`;
      })
      .join("");
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
      const other = !has && this._relatedFor(b).length > 0;
      const hidden = layout.hidden.includes(b.key);
      const label = this._layoutLabel(b.key, layout);
      const cls = ["kbtn", small && "small", b.key === s.sel && !editing && "active", has && "has", other && "has-other", hidden && "is-hidden", b.led && "with-led"];
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
          <div class="device-name">${esc(device.name)}</div>
          <div class="muted">${esc(device.area || "")}${device.model ? ` · ${esc(device.model)}` : ""}</div>
        </div>
        ${editing ? "" : `<button class="ghost" data-act="l-edit">✏️ Edit layout</button>`}
      </div>
      ${source}
      <div class="faceplate finish-${esc(layout.finish)}">${rows}</div>
      ${
        editing
          ? this._renderLayoutEditor(layout, byKey)
          : `<div class="muted center legend"><span><span class="dot on"></span> set up here</span>${
              s.related.length ? `<span><span class="dot other"></span> used by another automation</span>` : ""
            }</div>`
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
      ${this._renderLedSection(cur.button)}
      ${this._renderRelated(cur.button)}
    `;
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
        <input class="grow" list="dl-any" placeholder="Device to follow, e.g. light.kitchen" value="${esc(led.entity)}" data-led-field="entity">
        <div class="hint" id="hint-led">${esc(this._entityName(led.entity))}</div>
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
        <div class="muted">Made outside Keypad Builder. They run too when the button is used.</div>
        ${list
          .map((r) => {
            const types = [...new Set(r.triggers.filter((t) => String(t.subtype) === button.key).map((t) => typeLabel(t.type).replace("When ", "")))];
            return `<div class="related">
              <div><div>${esc(r.name)}</div><div class="muted">${esc(types.join(", "))}</div></div>
              ${
                r.id
                  ? `<button class="link" data-act="open-editor" data-id="${esc(r.id)}">Open ↗</button>`
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
        <input class="grow" list="dl-${esc(preset.led ? "led" : preset.domains.join("-"))}" placeholder="Choose entity…" value="${esc(row.entity)}" data-row="${i}" data-field="entity">
        <div class="hint" id="hint-${i}">${esc(this._entityName(row.entity))}</div>
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
        <input class="grow" list="dl-any" placeholder="entity (optional)" value="${esc(row.entity)}" data-row="${i}" data-field="entity">
        <div class="hint" id="hint-${i}">${esc(this._entityName(row.entity))}</div>
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
    const states = Object.values(this._hass.states);
    const opt = (st) => `<option value="${esc(st.entity_id)}">${esc(st.attributes.friendly_name || "")}</option>`;
    const lists = new Map();
    for (const p of PRESETS) {
      if (p.led) continue;
      const id = p.domains.join("-");
      if (lists.has(id)) continue;
      const items = states.filter((st) => p.domains.includes(st.entity_id.split(".")[0]));
      lists.set(id, `<datalist id="dl-${esc(id)}">${items.map(opt).join("")}</datalist>`);
    }
    const services = Object.entries(this._hass.services || {}).flatMap(([d, svcs]) =>
      Object.keys(svcs).map((svc) => `<option value="${esc(`${d}.${svc}`)}"></option>`)
    );
    // keypad LEDs: this keypad's first, then anything else that looks like one
    const ownLeds = new Set(this._s.buttons.map((b) => b.ledEntity).filter(Boolean));
    const leds = [
      ...states.filter((st) => ownLeds.has(st.entity_id)),
      ...states.filter((st) => !ownLeds.has(st.entity_id) && st.entity_id.startsWith("switch.") && /\bled\b/i.test(`${st.entity_id.replace(/_/g, " ")} ${st.attributes.friendly_name || ""}`)),
    ];
    return `${[...lists.values()].join("")}
      <datalist id="dl-led">${leds.map(opt).join("")}</datalist>
      <datalist id="dl-any">${states.map(opt).join("")}</datalist>
      <datalist id="dl-services">${services.join("")}</datalist>`;
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
  .pair { display: flex; gap: 8px; }
  .kbtn.small { min-height: 34px; padding: 4px 16px; font-size: 11px; }
  .kbtn.small.with-led { padding-left: 18px; padding-right: 14px; letter-spacing: .04em; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: transparent; vertical-align: middle; }
  .dot.on { background: var(--kb-on); }
  .dot.other { background: var(--kb-other); }
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
