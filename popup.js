const $ = (id) => document.getElementById(id);

// ── Status ─────────────────────────────────────────────────────────────────
function showStatus(msg, type = "success") {
  const el = $("status");
  if (!el) return;
  el.textContent = msg;
  el.className = `status ${type}`;
  setTimeout(() => (el.className = "status hidden"), 2800);
}

// ── Content script bridge ──────────────────────────────────────────────────
async function sendToContent(action, payload = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    return await chrome.tabs.sendMessage(tab.id, { action, ...payload });
  } catch {
    return { ok: false, error: "Cannot reach page — reload the tab and try again." };
  }
}

// ── Hint updater ───────────────────────────────────────────────────────────
function hintExample(mode, field) {
  switch (mode) {
    case "regex":    return `${field}:/.*xxx.*/ AND ${field}:/.*yyy.*/`;
    case "wildcard": return `${field}:*xxx* AND ${field}:*yyy*`;
    case "match":    return `${field}:xxx AND ${field}:yyy`;
    default:         return "";
  }
}

function updateHint() {
  const hintEl = $("payload-hint-code");
  const modeEl = $("mode-payload");
  const fieldEl = $("field-payload");
  if (hintEl && modeEl && fieldEl)
    hintEl.textContent = hintExample(modeEl.value, fieldEl.value);
}

["mode-payload", "field-payload"].forEach((id) => {
  const el = $(id);
  if (!el) return;
  el.addEventListener("change", () => {
    updateHint();
    chrome.storage?.local?.set({ payloadMode: $("mode-payload")?.value });
  });
});
updateHint();

// ── Generic tag-input factory ──────────────────────────────────────────────
// storageKey persists the tags on its own; onChange is for tag lists that live
// inside a larger stored object (the suggestion presets) and save themselves.
function makeTagInput({ boxId, inputId, storageKey, onChange }) {
  let tags = [];
  let dragIndex = null;

  function render() {
    const box = $(boxId), input = $(inputId);
    box.querySelectorAll(".tag").forEach((t) => t.remove());
    tags.forEach((term, i) => {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.title = term;
      chip.draggable = true;
      chip.style.cursor = "grab";

      const lbl = document.createElement("span");
      lbl.textContent = term;
      lbl.style.cssText = "overflow:hidden;text-overflow:ellipsis;pointer-events:none;";

      const rm = document.createElement("button");
      rm.className = "tag-remove";
      rm.textContent = "×";
      rm.draggable = false;
      rm.addEventListener("click", () => { tags.splice(i, 1); render(); save(); });

      // ── Drag to reorder ──────────────────────────────────────────────────
      chip.addEventListener("dragstart", (e) => {
        dragIndex = i;
        e.dataTransfer.effectAllowed = "move";
        chip.style.opacity = "0.4";
      });
      chip.addEventListener("dragend", () => {
        dragIndex = null;
        chip.style.opacity = "";
      });
      chip.addEventListener("dragover", (e) => {
        if (dragIndex === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      });
      chip.addEventListener("drop", (e) => {
        e.preventDefault();
        const from = dragIndex;
        if (from === null) return;
        const rect = chip.getBoundingClientRect();
        let to = e.clientX > rect.left + rect.width / 2 ? i + 1 : i;
        if (from < to) to -= 1;
        if (to === from) return;
        const [moved] = tags.splice(from, 1);
        tags.splice(to, 0, moved);
        render();
        save();
      });

      chip.appendChild(lbl);
      chip.appendChild(rm);
      box.insertBefore(chip, input);
    });
  }

  function add(value) {
    const term = value.trim();
    if (!term || tags.includes(term)) return;
    tags.push(term);
    render();
    save();
  }

  function save() {
    if (storageKey) chrome.storage?.local?.set({ [storageKey]: tags });
    onChange?.(tags.slice());
  }
  function clear() { tags = []; render(); save(); }
  function flush() {
    const raw = $(inputId).value.trim();
    if (raw) { add(raw); $(inputId).value = ""; }
  }

  $(inputId)?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault(); add(e.target.value); e.target.value = "";
    } else if (e.key === "Backspace" && !e.target.value && tags.length) {
      tags.pop(); render(); save();
    }
  });

  $(boxId)?.addEventListener("click", (e) => {
    if (e.target === $(boxId)) $(inputId)?.focus();
  });

  return {
    add, clear, flush,
    getTags: () => tags,
    restore(saved) { if (Array.isArray(saved)) { tags = saved; render(); } },
  };
}

const containerInput = makeTagInput({ boxId: "container-tag-box", inputId: "input-container", storageKey: "containerTags" });
const payloadInput   = makeTagInput({ boxId: "tag-box",           inputId: "input-payload",   storageKey: "payloadTags"   });
const extractInput   = makeTagInput({ boxId: "extract-tag-box",   inputId: "input-extract",   storageKey: "extractFields" });

// ── Cmd+Enter / Ctrl+Enter shortcut ───────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
  e.preventDefault();
  const focused = document.activeElement;

  if (focused.id === "input-container" || focused.closest("#container-tag-box")) {
    $("btn-container").click();
  } else if (focused.closest("#tag-box") || focused.id === "input-payload") {
    $("btn-payload").click();
  } else if (focused.closest("#extract-tag-box") || focused.id === "input-extract") {
    $("btn-extract-apply").click();
  }
});

// ── Theme ─────────────────────────────────────────────────────────────────
$("theme-select").addEventListener("change", async (e) => {
  const theme = e.target.value;
  chrome.storage?.local?.set({ theme });
  await sendToContent("setTheme", { theme });
});

// Restore saved theme
chrome.storage?.local?.get(["theme"], (data) => {
  if (data.theme) $("theme-select").value = data.theme;
});

// ── Pin / pop-out ──────────────────────────────────────────────────────────
$("btn-pin").addEventListener("click", () => {
  if (typeof chrome !== "undefined" && chrome.windows) {
    chrome.windows.create({
      url: chrome.runtime.getURL("popup.html"),
      type: "popup", width: 360, height: 720, focused: true,
    });
  } else {
    window.open(location.href, "_blank", "width=360,height=720");
  }
});

// ── Expand ────────────────────────────────────────────────────────────────
$("btn-expand").addEventListener("click", async () => {
  const res = await sendToContent("expandAll");
  if (res?.ok) showStatus(`Expanded ${res.count} entr${res.count === 1 ? "y" : "ies"}`);
  else showStatus(res?.error || "Failed", "error");
});

// ── Container Name ────────────────────────────────────────────────────────
$("btn-container").addEventListener("click", async () => {
  containerInput.flush();
  const terms = containerInput.getTags();
  if (!terms.length) return showStatus("Add at least one container name", "error");
  const mustNot = $("neg-container").value === "must_not";
  const op      = $("op-container").value;
  const res = await sendToContent("addMultiFilter", {
    field: "kubernetes.container_name",
    terms,
    op,
    mode: mustNot ? "term_not" : "term",
  });
  if (res?.ok) showStatus(`${terms.length} container filter${terms.length > 1 ? "s" : ""} applied ✓`);
  else showStatus(res?.error || "Failed", "error");
});

$("btn-clear-container").addEventListener("click", async () => {
  containerInput.clear();
  const res = await sendToContent("removeFilter", { field: "kubernetes.container_name" });
  showStatus(res?.ok ? "Container filter cleared from query ✓" : "Tags cleared");
});

// ── Payload search ────────────────────────────────────────────────────────
$("btn-payload").addEventListener("click", async () => {
  payloadInput.flush();
  const terms = payloadInput.getTags();
  if (!terms.length) return showStatus("Add at least one search term", "error");
  const res = await sendToContent("addMultiFilter", {
    field: $("field-payload").value,
    terms,
    op:   $("op-payload").value,
    mode: $("mode-payload").value,
  });
  if (res?.ok) showStatus(`${terms.length} filter${terms.length > 1 ? "s" : ""} applied ✓`);
  else showStatus(res?.error || "Failed", "error");
});

$("btn-clear-payload").addEventListener("click", async () => {
  payloadInput.clear();
  const field = $("field-payload").value;
  const res = await sendToContent("removeFilter", { field });
  showStatus(res?.ok ? `${field} cleared from query ✓` : "Tags cleared");
});

// ── Extractor presets ─────────────────────────────────────────────────────
const EXTRACT_PRESETS = {
  dev: ["coalesce(time, timestamp)", "level", "coalesce(msg, message)", "loan_app_id", "trace_id", "span_id", "request_header.Wf-traceparent"],
};

$("preset-extract").addEventListener("change", (e) => {
  const fields = EXTRACT_PRESETS[e.target.value];
  if (!fields) return;
  extractInput.clear();
  fields.forEach((f) => extractInput.add(f));
  e.target.value = ""; // reset dropdown back to placeholder
});

// ── JSON Field Extractor ──────────────────────────────────────────────────
function setHideBtnState(hidden) {
  $("btn-hide-col").textContent = hidden ? "👁 Show Columns" : "🙈 Hide Columns";
}

// The content script runs the whole sequence (Lucene → json_payload column →
// extract → hide columns) so the auto path and this button share one code path.
async function applyExtract() {
  extractInput.flush();
  const fields = extractInput.getTags();
  if (!fields.length) {
    showStatus("Add at least one field name", "error");
    return false;
  }

  const res = await sendToContent("applyExtract", { fields });
  if (!res?.ok) {
    showStatus(res?.error || "Failed", "error");
    return false;
  }

  setHideBtnState(true);
  const found = res.found ?? "?";
  const src = found === 0 ? " (waiting for data…)" : ` — ${found} row${found !== 1 ? "s" : ""} ✓`;
  if (res.lang && !res.lang.ok) showStatus(`Lucene switch failed: ${res.lang.error}`, "error");
  else showStatus(`Extracting ${fields.join(", ")}${src}`);
  return true;
}

$("btn-extract-apply").addEventListener("click", applyExtract);

// Auto mode: content.js re-applies the saved fields on every page load / query
// change. Turning it on applies right away so the toggle is the only click.
$("chk-extract-auto").addEventListener("change", async (e) => {
  const on = e.target.checked;
  chrome.storage?.local?.set({ extractAuto: on });
  if (!on) return showStatus("Auto-apply off");
  if (await applyExtract()) showStatus("Auto-apply on — no more clicking ✓");
});

function setAutoOff() {
  $("chk-extract-auto").checked = false;
  chrome.storage?.local?.set({ extractAuto: false });
}

$("btn-extract-stop").addEventListener("click", async () => {
  const res = await sendToContent("stopExtract");
  await sendToContent("showColumn");
  setHideBtnState(false);
  setAutoOff(); // otherwise the next page load brings it straight back
  showStatus(res?.ok ? "Extraction stopped" : res?.error || "Failed", res?.ok ? "success" : "error");
});

let colHidden = false;
$("btn-hide-col").addEventListener("click", async () => {
  colHidden = !colHidden;
  if (colHidden) {
    await sendToContent("hideColumns");
  } else {
    await sendToContent("showColumn");
  }
  setHideBtnState(colHidden);
});

$("btn-clear-extract").addEventListener("click", async () => {
  extractInput.clear();
  await sendToContent("stopExtract");
  setAutoOff();
  showStatus("Extraction cleared");
});

// ── Editor suggestion presets ─────────────────────────────────────────────
// One preset per project: the field names the in-page editor completes, and
// the values it offers after an operator. content.js picks the change up from
// chrome.storage.local — no reload needed.
let suggestStore = lfNormalizeStore(null);
let valueField = "";  // field whose values the lower tag box is editing
let nameMode = null;  // "new" | "rename" | "dup" while the name row is open

const activePreset = () => lfActivePreset(suggestStore);

function saveSuggestStore() {
  chrome.storage?.local?.set({ [LF_SUGGEST_KEY]: suggestStore });
}

const suggestFieldInput = makeTagInput({
  boxId: "suggest-field-box",
  inputId: "input-suggest-field",
  onChange: (fields) => {
    activePreset().fields = fields;
    saveSuggestStore();
    renderValueFieldOptions();
  },
});

const suggestValueInput = makeTagInput({
  boxId: "suggest-value-box",
  inputId: "input-suggest-value",
  onChange: (values) => {
    if (!valueField) return;
    const preset = activePreset();
    // An empty list is the same as no entry — the logs still supply values
    if (values.length) preset.values[valueField] = values;
    else delete preset.values[valueField];
    saveSuggestStore();
    renderContainerDatalist();
  },
});

function fillSelect(sel, entries, selected) {
  sel.textContent = "";
  entries.forEach(([value, label]) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
  });
  sel.value = selected;
}

function renderPresetOptions() {
  const entries = Object.entries(suggestStore.presets)
    .map(([id, p]) => [id, p.name])
    .sort((a, b) => a[1].localeCompare(b[1]));
  fillSelect($("suggest-preset"), entries, suggestStore.active);
}

function renderValueFieldOptions() {
  const preset = activePreset();
  const fields = [...new Set([...preset.fields, ...Object.keys(preset.values)])];
  if (!fields.includes(valueField)) valueField = fields[0] || "";

  fillSelect($("suggest-value-field"), fields.map((f) => [f, f]), valueField);
  $("suggest-value-field").disabled = !fields.length;

  const input = $("input-suggest-value");
  input.disabled = !valueField;
  input.placeholder = valueField ? `Value for ${valueField}…` : "Add a field first";
  suggestValueInput.restore(valueField ? (preset.values[valueField] || []).slice() : []);
}

// The container names live in the filter forms file, which is gated by `dns` —
// and the popup's own hostname is the extension's, so the gate is checked
// against the tab it is pointed at instead.
let formsStore = { dns: [], suggests: [] };
let formsHost = "";

function formsSuggestValues(field) {
  if (!lfHostMatches(formsStore.dns, formsHost)) return [];
  const out = [];
  for (const s of formsStore.suggests)
    if (lfHostMatches(s.dns, formsHost))
      for (const v of s.values[field] || []) out.push(v);
  return out;
}

// The Container Name box picks from the same list the editor suggests
function renderContainerDatalist() {
  const dl = $("container-suggestions");
  if (!dl) return;
  dl.textContent = "";
  const values = new Set([
    ...(activePreset().values["kubernetes.container_name"] || []),
    ...formsSuggestValues("kubernetes.container_name"),
  ]);
  [...values].sort().forEach((v) => {
    const o = document.createElement("option");
    o.value = v;
    dl.appendChild(o);
  });
}

function renderSuggestUI() {
  renderPresetOptions();
  suggestFieldInput.restore(activePreset().fields.slice());
  renderValueFieldOptions();
  renderContainerDatalist();
}

$("suggest-preset").addEventListener("change", (e) => {
  suggestStore.active = e.target.value;
  saveSuggestStore();
  renderSuggestUI();
  showStatus(`Preset: ${activePreset().name}`);
});

$("suggest-value-field").addEventListener("change", (e) => {
  valueField = e.target.value;
  renderValueFieldOptions();
});

// ── Naming row (New / Rename / Duplicate all go through it) ───────────────
function openNameRow(mode) {
  nameMode = mode;
  const input = $("input-suggest-name");
  input.value =
    mode === "rename" ? activePreset().name :
    mode === "dup"    ? `${activePreset().name} copy` : "";
  $("suggest-name-row").classList.remove("hidden");
  input.focus();
  input.select();
}

function closeNameRow() {
  nameMode = null;
  $("suggest-name-row").classList.add("hidden");
}

function commitName() {
  const name = $("input-suggest-name").value.trim();
  if (!name) return showStatus("Give the preset a name", "error");

  if (nameMode === "rename") {
    activePreset().name = name;
  } else {
    const from = nameMode === "dup" ? activePreset() : { fields: [], values: {} };
    const id = `p${Date.now().toString(36)}`;
    suggestStore.presets[id] = {
      name,
      fields: from.fields.slice(),
      values: Object.fromEntries(
        Object.entries(from.values).map(([k, v]) => [k, v.slice()]),
      ),
    };
    suggestStore.active = id;
  }

  const what = nameMode === "rename" ? "renamed" : "created";
  closeNameRow();
  saveSuggestStore();
  renderSuggestUI();
  showStatus(`Preset ${what}: ${name} ✓`);
}

$("btn-suggest-new").addEventListener("click", () => openNameRow("new"));
$("btn-suggest-rename").addEventListener("click", () => openNameRow("rename"));
$("btn-suggest-dup").addEventListener("click", () => openNameRow("dup"));
$("btn-suggest-name-ok").addEventListener("click", commitName);
$("btn-suggest-name-cancel").addEventListener("click", closeNameRow);

$("input-suggest-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); commitName(); }
  else if (e.key === "Escape") { e.preventDefault(); closeNameRow(); }
});

$("btn-suggest-del").addEventListener("click", () => {
  const ids = Object.keys(suggestStore.presets);
  if (ids.length < 2) return showStatus("Keep at least one preset", "error");
  const gone = activePreset().name;
  delete suggestStore.presets[suggestStore.active];
  suggestStore.active = Object.keys(suggestStore.presets)[0];
  saveSuggestStore();
  renderSuggestUI();
  showStatus(`Deleted preset: ${gone}`);
});

// Puts the shipped preset back — edited or deleted, it can always be recovered
$("btn-suggest-reset").addEventListener("click", () => {
  suggestStore.presets[LF_BUILTIN_PRESET_ID] = lfBuiltinPreset();
  suggestStore.active = LF_BUILTIN_PRESET_ID;
  saveSuggestStore();
  renderSuggestUI();
  showStatus("Built-in preset restored ✓");
});

// ── Clear all ─────────────────────────────────────────────────────────────
$("btn-clear").addEventListener("click", async () => {
  const res = await sendToContent("clearFilters");
  if (res?.ok) {
    payloadInput.clear();
    showStatus("All filters cleared ✓");
  } else {
    showStatus(res?.error || "Failed", "error");
  }
});

// ── Restore saved state ───────────────────────────────────────────────────
chrome.storage?.local?.get(
  [
    "containerTags",
    "payloadTags",
    "payloadMode",
    "extractFields",
    "extractAuto",
    LF_SUGGEST_KEY,
    LF_FORMS_KEY,
  ],
  (data) => {
    if (data.payloadMode) $("mode-payload").value = data.payloadMode;
    suggestStore = lfNormalizeStore(data[LF_SUGGEST_KEY]);
    formsStore = {
      dns: lfNormalizeHosts(data[LF_FORMS_KEY]?.dns),
      suggests: lfNormalizeSuggests(data[LF_FORMS_KEY]?.suggests),
    };
    renderSuggestUI();
    containerInput.restore(data.containerTags);
    payloadInput.restore(data.payloadTags);
    extractInput.restore(data.extractFields);
    $("chk-extract-auto").checked = Boolean(data.extractAuto);
    updateHint();

    // Opening the popup never re-runs the extractor itself — with auto mode on
    // the content script has already applied the saved fields on page load.
  }
);

// Answers separately from the store read above, so whichever lands last
// repaints the datalist.
chrome.tabs?.query({ active: true, currentWindow: true }, ([tab]) => {
  try {
    formsHost = new URL(tab?.url || "").hostname;
  } catch {
    formsHost = "";
  }
  renderContainerDatalist();
});
