const $ = (id) => document.getElementById(id);

// ── Version ────────────────────────────────────────────────────────────────
// Straight from the manifest, so the badge cannot drift from what is loaded —
// which is the whole point of showing it: after a reload at chrome://extensions
// it says whether the new build is the one running.
try {
  const v = chrome?.runtime?.getManifest?.().version;
  if (v) document.getElementById("version").textContent = `v${v}`;
} catch {}

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

const extractInput = makeTagInput({ boxId: "extract-tag-box", inputId: "input-extract", storageKey: "extractFields" });

// ── Cmd+Enter / Ctrl+Enter shortcut ───────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
  e.preventDefault();
  const focused = document.activeElement;

  if (focused.closest("#extract-tag-box") || focused.id === "input-extract") {
    $("btn-extract-apply").click();
  }
});

// ── Theme ─────────────────────────────────────────────────────────────────
// The popup paints itself from the same setting it sends to the page. Dark is
// the stylesheet's default, so only light needs the attribute.
function paintPopup(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
}

// One switch for everything: the OpenSearch page, this popup, and the in-page
// overlays. The page's own setPageDark swings the extension palette with it,
// so "pageDark" is the only message needed.
$("theme-select").addEventListener("change", async (e) => {
  const theme = e.target.value;
  paintPopup(theme);
  chrome.storage?.local?.set({ theme });
  const res = await sendToContent("pageDark", { dark: theme === "dark" });
  if (!res?.ok) showStatus(res?.error || "Theme applied here only", "error");
});

// Restore saved theme, then let the page correct it — whether the page is dark
// lives in that page's own localStorage, which outranks the stored preference.
chrome.storage?.local?.get(["theme"], (data) => {
  if (data.theme) $("theme-select").value = data.theme;
  paintPopup(data.theme || $("theme-select").value);
});

sendToContent("pageDark").then((res) => {
  // Only an actual boolean overrides the stored preference — a reply that
  // can't tell us (no page, older content script) must leave it alone.
  if (typeof res?.dark !== "boolean") return;
  const theme = res.dark ? "dark" : "light";
  $("theme-select").value = theme;
  paintPopup(theme);
});

// ── "Add filter" bar ──────────────────────────────────────────────────────
// Lives in the page's localStorage, so the page is the source of truth — ask
// it on open, and leave the box disabled if there is no page to ask.
$("chk-filter-bar").addEventListener("change", async (e) => {
  const show = e.target.checked;
  const res = await sendToContent("filterBar", { hidden: !show });
  if (res?.ok) showStatus(show ? "“Add filter” bar shown ✓" : "“Add filter” bar hidden");
  else showStatus(res?.error || "Failed", "error");
});

sendToContent("filterBar").then((res) => {
  if (res?.ok) $("chk-filter-bar").checked = !res.hidden;
  else $("chk-filter-bar").disabled = true;
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
  // Land on a field that has values to show. The first field is usually a
  // parent path with none of its own ("kubernetes"), and an empty box reads
  // as if the preset were empty.
  if (!fields.includes(valueField))
    valueField =
      fields.find((f) => (preset.values[f] || []).length) || fields[0] || "";

  fillSelect($("suggest-value-field"), fields.map((f) => [f, f]), valueField);
  $("suggest-value-field").disabled = !fields.length;

  const input = $("input-suggest-value");
  input.disabled = !valueField;
  input.placeholder = valueField ? `Value for ${valueField}…` : "Add a field first";
  suggestValueInput.restore(valueField ? (preset.values[valueField] || []).slice() : []);
}

function renderSuggestUI() {
  renderPresetOptions();
  suggestFieldInput.restore(activePreset().fields.slice());
  renderValueFieldOptions();
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

// ── Value lists as .txt ───────────────────────────────────────────────────
// A value list is long (70-odd container names) and comes from somewhere else
// — another squad's list, a kubectl output, a wiki page. One value per line is
// what all of those already are, so that is the exchange format.
//
// An import *replaces* the list: the file is the list, so what it leaves out
// is meant to be gone. Export first if the current one is worth keeping — and
// ↺ always brings the built-in list back.
const VALUES_MAX = 5000;

const currentValues = () => (activePreset().values[valueField] || []).slice();

$("btn-values-export").addEventListener("click", () => {
  const values = currentValues();
  if (!values.length) return showStatus("Nothing to export", "error");
  // The field path makes a readable file name, and a safe one bar the dots
  const name = `${valueField.replace(/[^\w.@-]+/g, "_")}.txt`;
  const url = URL.createObjectURL(
    new Blob([values.join("\n") + "\n"], { type: "text/plain" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // The click is synchronous, but the download reads the blob after it
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  showStatus(`${values.length} value${values.length > 1 ? "s" : ""} → ${name} ✓`);
});

$("btn-values-import").addEventListener("click", () => {
  if (!valueField) return showStatus("Add a field first", "error");
  $("file-values").click();
});

// A line per value — or several, since these lists are as likely to arrive in
// columns (a terminal's `kubectl get deploy`, a pasted wiki table) as one per
// line. A tab or a run of two or more spaces is a column gap; a single space
// is part of the value, because other fields hold values with spaces in them
// ("document borrower info"). Blank lines and `#` comments are skipped, so a
// list can be annotated and still re-imported, and anything the file says
// beyond that is taken as text — never markup, never a field name.
function parseValueFile(text) {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("#"))
        .flatMap((line) => line.split(/\t+| {2,}/))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

$("file-values").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  // Let the same file be picked twice in a row
  e.target.value = "";
  if (!file || !valueField) return;

  let incoming;
  try {
    incoming = parseValueFile(await file.text());
  } catch {
    return showStatus("Could not read that file", "error");
  }
  if (!incoming.length) return showStatus("No values in that file", "error");

  const before = currentValues().length;
  const over = incoming.length > VALUES_MAX;
  const kept = over ? incoming.slice(0, VALUES_MAX) : incoming;

  activePreset().values[valueField] = kept;
  saveSuggestStore();
  renderValueFieldOptions();

  showStatus(
    over
      ? `Replaced — stopped at ${VALUES_MAX} of ${incoming.length}`
      : `${valueField}: ${before} → ${kept.length} value${kept.length > 1 ? "s" : ""} ✓`,
    over ? "error" : "success",
  );
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
  showStatus(res?.ok ? "All filters cleared ✓" : res?.error || "Failed", res?.ok ? "success" : "error");
});

// ── Restore saved state ───────────────────────────────────────────────────
chrome.storage?.local?.get(
  ["extractFields", "extractAuto", LF_SUGGEST_KEY],
  (data) => {
    suggestStore = lfNormalizeStore(data[LF_SUGGEST_KEY]);
    renderSuggestUI();

    // Nothing saved yet — start on the dev preset rather than an empty box.
    // add() persists it, so the in-page panel and auto-apply see the same list.
    // A deliberate Clear stores [], which is not the same as never having set it.
    if (data.extractFields === undefined)
      EXTRACT_PRESETS.dev.forEach((f) => extractInput.add(f));
    else extractInput.restore(data.extractFields);

    $("chk-extract-auto").checked = Boolean(data.extractAuto);

    // Opening the popup never re-runs the extractor itself — with auto mode on
    // the content script has already applied the saved fields on page load.
  }
);
