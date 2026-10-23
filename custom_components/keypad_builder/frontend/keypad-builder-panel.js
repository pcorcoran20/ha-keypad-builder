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
  { service: "cover.open_cover", label: "Open shade", domains: ["cover"] },
  { service: "cover.close_cover", label: "Close shade", domains: ["cover"] },
  { service: "cover.stop_cover", label: "Stop shade", domains: ["cover"] },
  { service: "media_player.media_play_pause", label: "Play / pause", domains: ["media_player"] },
  { service: "media_player.volume_up", label: "Volume up", domains: ["media_player"] },
  { service: "media_player.volume_down", label: "Volume down", domains: ["media_player"] },
];

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const slug = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const pretty = (v) =>
  String(v).replace(/_/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());

const typeLabel = (t) => ({ press: "When pressed", release: "When released" })[t] || `When ${pretty(t).toLowerCase()}`;

const autoId = (deviceId, subtype, type) => `${ID_PREFIX}_${deviceId}_${slug(subtype)}_${slug(type)}`;

const presetFor = (service) => PRESETS.find((p) => p.service === service);

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
    this._s = {
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
    if (first) {
      this._attachListeners();
      this._render();
      this._loadDevices();
    }
    this._syncMenu();
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
      const [devices, areas, entries] = await Promise.all([
        this._hass.callWS({ type: "config/device_registry/list" }),
        this._hass.callWS({ type: "config/area_registry/list" }),
        this._hass.callWS({ type: "config_entries/get", domain: DEFAULT_DOMAIN }).catch(() => []),
      ]);
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
    Object.assign(s, { deviceId, loadingDevice: true, buttons: [], configs: {}, sel: null, rows: [], dirty: false, msg: null });
    this._render();

    try {
      const groups = new Map();
      for (const t of await this._triggers(deviceId)) {
        const key = String(t.subtype);
        if (!groups.has(key)) groups.set(key, { key, subtype: t.subtype, label: pretty(t.subtype), triggers: {} });
        groups.get(key).triggers[t.type] = t;
      }
      s.buttons = [...groups.values()];

      await Promise.all(
        s.buttons.flatMap((b) =>
          Object.keys(b.triggers).map(async (type) => {
            const id = autoId(deviceId, b.subtype, type);
            try {
              s.configs[id] = await this._hass.callApi("GET", `config/automation/config/${id}`);
            } catch (e) {
              // 404 = no automation for this button yet, totally fine
            }
          })
        )
      );
    } catch (e) {
      s.msg = { type: "error", text: `Couldn't load buttons: ${e.message || e}` };
    }
    s.loadingDevice = false;
    this._render();
  }

  _selectButton(key, type) {
    const s = this._s;
    if ((key !== s.sel || type !== s.type) && !this._okToLeave()) return;
    const button = s.buttons.find((b) => b.key === key);
    if (!button) return;
    const types = Object.keys(button.triggers);
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
    return !this._s.dirty || confirm("You have unsaved changes for this button. Leave without saving?");
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
      }
    });

    root.addEventListener("input", (ev) => {
      const el = ev.target;
      const s = this._s;
      if (el.id === "search") {
        s.filter = el.value;
        return this._renderDeviceList();
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
      if (el.dataset.kind != null) {
        const i = Number(el.dataset.kind);
        const old = s.rows[i];
        const row = newRow(el.value);
        // keep the chosen entity when switching between similar actions
        if ("entity" in row && old.entity) row.entity = old.entity;
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

    const btn = (b, extra = "") => {
      const has = Object.keys(b.triggers).some((t) => s.configs[autoId(s.deviceId, b.subtype, t)]);
      return `<button class="kbtn ${extra} ${b.key === s.sel ? "active" : ""} ${has ? "has" : ""}" data-act="button" data-key="${esc(b.key)}" title="${esc(b.label)}">
        <span class="label">${esc(b.label)}</span><span class="dot"></span>
      </button>`;
    };

    const isRaise = (b) => /raise|up\b/i.test(b.label);
    const isLower = (b) => /lower|down\b/i.test(b.label);
    const parts = [];
    for (let i = 0; i < s.buttons.length; i++) {
      const b = s.buttons[i];
      const next = s.buttons[i + 1];
      if (next && ((isLower(b) && isRaise(next)) || (isRaise(b) && isLower(next)))) {
        const [lo, hi] = isLower(b) ? [b, next] : [next, b];
        parts.push(`<div class="pair">${btn(lo, "small")}${btn(hi, "small")}</div>`);
        i++;
      } else {
        parts.push(btn(b));
      }
    }

    return `
      <div class="device-name">${esc(device.name)}</div>
      <div class="muted center">${esc(device.area || "")}${device.model ? ` · ${esc(device.model)}` : ""}</div>
      <div class="faceplate">${parts.join("")}</div>
      <div class="muted center legend"><span class="dot on"></span> has an automation</div>
    `;
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
    `;
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
        <input class="grow" list="dl-${esc(preset.domains.join("-"))}" placeholder="Choose entity…" value="${esc(row.entity)}" data-row="${i}" data-field="entity">
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
      const id = p.domains.join("-");
      if (lists.has(id)) continue;
      const items = states.filter((st) => p.domains.includes(st.entity_id.split(".")[0]));
      lists.set(id, `<datalist id="dl-${esc(id)}">${items.map(opt).join("")}</datalist>`);
    }
    const services = Object.entries(this._hass.services || {}).flatMap(([d, svcs]) =>
      Object.keys(svcs).map((svc) => `<option value="${esc(`${d}.${svc}`)}"></option>`)
    );
    return `${[...lists.values()].join("")}
      <datalist id="dl-any">${states.map(opt).join("")}</datalist>
      <datalist id="dl-services">${services.join("")}</datalist>`;
  }
}

const STYLES = `
  :host {
    display: block;
    min-height: 100vh;
    background: var(--primary-background-color, #f5f5f7);
    color: var(--primary-text-color, #1c1c1e);
    font-family: var(--paper-font-body1_-_font-family, system-ui, sans-serif);
    --kb-radius: 14px;
    --kb-accent: var(--primary-color, #03a9f4);
    --kb-card: var(--card-background-color, #fff);
    --kb-border: var(--divider-color, rgba(0,0,0,.12));
    --kb-muted: var(--secondary-text-color, #6b6b70);
    --kb-on: var(--success-color, #43a047);
    --kb-error: var(--error-color, #db4437);
  }
  * { box-sizing: border-box; }
  .toolbar {
    display: flex; align-items: center; gap: 8px; height: 56px; padding: 0 16px;
    background: var(--app-header-background-color, var(--kb-card));
    color: var(--app-header-text-color, inherit);
    border-bottom: 1px solid var(--kb-border);
  }
  .title { font-size: 20px; font-weight: 500; }
  .layout {
    display: grid; gap: 16px; padding: 16px;
    grid-template-columns: minmax(220px, 280px) minmax(240px, 320px) minmax(0, 1fr);
    align-items: start;
  }
  @media (max-width: 1000px) { .layout { grid-template-columns: 1fr 1fr; } .editor { grid-column: 1 / -1; } }
  @media (max-width: 640px) { .layout { grid-template-columns: 1fr; } }
  .card { background: var(--kb-card); border: 1px solid var(--kb-border); border-radius: var(--kb-radius); padding: 16px; min-width: 0; }
  .card-head { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 0 0 12px; font-size: 18px; font-weight: 600; }
  .muted { color: var(--kb-muted); font-size: 13px; }
  .center { text-align: center; }
  .empty { color: var(--kb-muted); text-align: center; padding: 48px 8px; }
  input, select, textarea {
    font: inherit; color: inherit; background: var(--primary-background-color, #fafafa);
    border: 1px solid var(--kb-border); border-radius: 10px; padding: 8px 10px; min-width: 0;
  }
  textarea { width: 100%; font-family: ui-monospace, monospace; font-size: 13px; resize: vertical; }
  input:focus, select:focus, textarea:focus { outline: 2px solid var(--kb-accent); outline-offset: -1px; }
  #search { width: 100%; margin-bottom: 8px; }
  .check { display: flex; gap: 6px; align-items: center; font-size: 13px; color: var(--kb-muted); margin-bottom: 8px; }
  button { font: inherit; cursor: pointer; color: inherit; }
  button:disabled { opacity: .5; cursor: default; }
  .icon { background: none; border: none; border-radius: 8px; padding: 4px 8px; font-size: 15px; color: var(--kb-muted); }
  .icon:hover { background: var(--kb-border); }
  .area { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--kb-muted); margin: 12px 4px 4px; }
  .dev {
    display: flex; flex-direction: column; align-items: flex-start; width: 100%; text-align: left;
    background: none; border: 1px solid transparent; border-radius: 10px; padding: 8px 10px;
  }
  .dev small { color: var(--kb-muted); }
  .dev:hover { background: var(--kb-border); }
  .dev.active { border-color: var(--kb-accent); background: color-mix(in srgb, var(--kb-accent) 12%, transparent); }
  .device-name { text-align: center; font-weight: 600; font-size: 17px; }
  .faceplate {
    margin: 16px auto; width: 200px; padding: 28px 22px; border-radius: 18px;
    background: linear-gradient(160deg, #fdfdfb, #ecebe6);
    box-shadow: 0 1px 0 #fff inset, 0 8px 24px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.08);
    display: flex; flex-direction: column; gap: 10px;
  }
  .kbtn {
    position: relative; display: flex; align-items: center; justify-content: center;
    width: 100%; min-height: 44px; padding: 6px 18px; border-radius: 8px;
    background: linear-gradient(#ffffff, #f1f0eb); color: #3a3a3c;
    border: 1px solid rgba(0,0,0,.14); box-shadow: 0 2px 3px rgba(0,0,0,.08);
    font-size: 12px; letter-spacing: .08em; text-transform: uppercase;
    transition: transform .08s, box-shadow .15s;
  }
  .kbtn .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kbtn:hover { box-shadow: 0 2px 6px rgba(0,0,0,.18); }
  .kbtn:active { transform: translateY(1px); }
  .kbtn.active { outline: 3px solid var(--kb-accent); outline-offset: 2px; }
  .kbtn .dot { position: absolute; right: 8px; top: 50%; translate: 0 -50%; }
  .kbtn.has .dot { background: var(--kb-on); }
  .pair { display: flex; gap: 8px; }
  .kbtn.small { min-height: 34px; padding: 4px 18px 4px 8px; font-size: 11px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: transparent; vertical-align: middle; }
  .dot.on { background: var(--kb-on); }
  .legend { margin-top: 4px; }
  .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .tab { border: 1px solid var(--kb-border); background: none; border-radius: 999px; padding: 6px 14px; }
  .tab.active { background: var(--kb-accent); border-color: var(--kb-accent); color: var(--text-primary-color, #fff); }
  .rows { display: flex; flex-direction: column; gap: 10px; margin: 8px 0 12px; }
  .empty-rows { padding: 16px; border: 1px dashed var(--kb-border); border-radius: 12px; text-align: center; }
  .row { border: 1px solid var(--kb-border); border-radius: 12px; padding: 10px; }
  .row-head { display: flex; align-items: center; gap: 6px; }
  .row-head select { flex: 1; }
  .num {
    flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center;
    background: var(--kb-accent); color: var(--text-primary-color, #fff); font-size: 12px; font-weight: 600;
  }
  .row-body { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; padding-left: 30px; }
  .grow { width: 100%; }
  .hint { font-size: 12px; color: var(--kb-muted); margin-top: -4px; min-height: 0; }
  .hint:empty { display: none; }
  .inline { display: flex; align-items: center; gap: 10px; }
  .inline label { font-size: 13px; color: var(--kb-muted); min-width: 80px; }
  .inline input[type=range] { flex: 1; }
  .inline input[type=number] { width: 110px; }
  .val { min-width: 40px; text-align: right; font-variant-numeric: tabular-nums; }
  .add { width: 100%; padding: 10px; border: 1px dashed var(--kb-accent); color: var(--kb-accent); background: none; border-radius: 12px; }
  .add:hover { background: color-mix(in srgb, var(--kb-accent) 8%, transparent); }
  .footer { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
  .spacer { flex: 1; }
  .primary { background: var(--kb-accent); color: var(--text-primary-color, #fff); border: none; border-radius: 10px; padding: 10px 22px; font-weight: 600; }
  .danger { background: none; color: var(--kb-error); border: 1px solid var(--kb-error); border-radius: 10px; padding: 9px 16px; }
  .msg { margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 14px; }
  .msg.ok { background: color-mix(in srgb, var(--kb-on) 14%, transparent); }
  .msg.error { background: color-mix(in srgb, var(--kb-error) 14%, transparent); color: var(--kb-error); }
`;

customElements.define("keypad-builder-panel", KeypadBuilderPanel);
