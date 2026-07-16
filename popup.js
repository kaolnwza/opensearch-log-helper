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
function makeTagInput({ boxId, inputId, storageKey }) {
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

  function save() { chrome.storage?.local?.set({ [storageKey]: tags }); }
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

const HIDE_FIELDS = ["Time", "kubernetes.container_name", "json_payload"];

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

$("btn-extract-apply").addEventListener("click", async () => {
  extractInput.flush();
  const fields = extractInput.getTags();
  if (!fields.length) return showStatus("Add at least one field name", "error");
  const res = await sendToContent("extractFields", { fields });
  if (res?.ok) {
    // Auto-hide all three columns by default
    await sendToContent("hideColumns", { fields: HIDE_FIELDS });
    setHideBtnState(true);
    const found = res.found ?? "?";
    const src = found === 0 ? " (waiting for data…)" : ` — ${found} row${found !== 1 ? "s" : ""} ✓`;
    showStatus(`Extracting ${fields.join(", ")}${src}`);
  } else {
    showStatus(res?.error || "Failed", "error");
  }
});

$("btn-extract-stop").addEventListener("click", async () => {
  const res = await sendToContent("stopExtract");
  await sendToContent("showColumn");
  setHideBtnState(false);
  showStatus(res?.ok ? "Extraction stopped" : res?.error || "Failed", res?.ok ? "success" : "error");
});

let colHidden = false;
$("btn-hide-col").addEventListener("click", async () => {
  colHidden = !colHidden;
  if (colHidden) {
    await sendToContent("hideColumns", { fields: HIDE_FIELDS });
  } else {
    await sendToContent("showColumn");
  }
  setHideBtnState(colHidden);
});

$("btn-clear-extract").addEventListener("click", async () => {
  extractInput.clear();
  await sendToContent("stopExtract");
  showStatus("Extraction cleared");
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
  ["containerTags", "payloadTags", "payloadMode", "extractFields"],
  (data) => {
    if (data.payloadMode) $("mode-payload").value = data.payloadMode;
    containerInput.restore(data.containerTags);
    payloadInput.restore(data.payloadTags);
    extractInput.restore(data.extractFields);
    updateHint();

    if (Array.isArray(data.extractFields) && data.extractFields.length) {
      sendToContent("extractFields", { fields: data.extractFields });
    }
  }
);
