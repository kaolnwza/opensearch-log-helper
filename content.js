// ── Selectors for OpenSearch Dashboards ──────────────────────────────────────
const SELECTORS = {
    queryInput: [
        '[data-test-subj="queryInput"]',
        ".euiFieldSearch",
        'input[placeholder*="Search"]',
        'input[placeholder*="Lucene"]',
        'textarea[placeholder*="Search"]',
    ],
    expandToggle: [
        '[data-test-subj="docTableExpandToggleColumn"] button',
        ".kbnDocTableOpen",
        'button[aria-label="Expand"]',
        'button.euiButtonIcon[aria-label*="expand"]',
        "td.osdDocTableCell__toggleDetails button",
        ".osd-table tbody tr td:first-child button",
        ".euiTable tbody tr td:first-child button",
    ],
    filterBadge: [
        '[data-test-subj="filter"]',
        ".globalFilterItem",
        '.euiBadge[data-test-subj*="filter"]',
    ],
};

// Query-bar language switcher (DQL ⇄ Lucene)
const LANG_SWITCH_BUTTON = [
    '[data-test-subj="switchQueryLanguageButton"]',
    '[data-test-subj="queryBarLanguageSwitcherPopover"] button',
    ".osdQueryBar__languageSwitcherPopover button",
    ".kbnQueryBar__languageSwitcherPopover button",
];

const LANG_MENU_ITEM = ".euiContextMenuItem, [role='menuitem'], .euiSelectableListItem";

// Discover sidebar field lists
const SIDEBAR_SELECTED_LIST = [
    '[data-test-subj="fieldList-selected"]',
    '[data-test-subj="discoverFieldListSelected"]',
];

function findElement(selectorList) {
    for (const sel of selectorList) {
        const el = document.querySelector(sel);
        if (el) return el;
    }
    return null;
}

function findAllElements(selectorList) {
    for (const sel of selectorList) {
        const els = document.querySelectorAll(sel);
        if (els.length) return Array.from(els);
    }
    return [];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setNativeValue(input, value) {
    if (input.isContentEditable) {
        input.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, value);
    } else {
        const proto =
            input instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(input, value);
        else input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

function submitQuery(input) {
    setTimeout(() => {
        input.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "Enter",
                keyCode: 13,
                bubbles: true,
            }),
        );
        input.dispatchEvent(
            new KeyboardEvent("keyup", {
                key: "Enter",
                keyCode: 13,
                bubbles: true,
            }),
        );
        const btn =
            document.querySelector('[data-test-subj="querySubmitButton"]') ||
            document.querySelector('button[aria-label="Search"]') ||
            document.querySelector('button[type="submit"]');
        if (btn) btn.click();
    }, 120);
}

// Strips ALL clauses for a given field from a Lucene query string
function removeFieldFromQuery(q, field) {
    const esc = field.replace(/\./g, "\\.");
    // Also match dotted subfields (json_payload → json_payload.msg, …) so a
    // Clear/re-apply strips scoped clauses too, not just the bare field.
    const fieldPat = `${esc}(?:\\.[\\w-]+)*`;

    // 1. Remove parenthesized groups that contain this field
    //    e.g.  AND (json_payload:/.*x.*/ AND json_payload.msg:/.*y.*/)
    q = q.replace(
        new RegExp(`\\s*(?:AND|OR)?\\s*\\([^)]*${fieldPat}:[^)]*\\)`, "gi"),
        "",
    );

    // 2. Remove individual clauses  (AND/OR? NOT? field:value)
    //    value = regex /.../, quoted "...", or bare word
    const val = `(?:\\/[^\\/]*\\/|"[^"]*"|\\S+)`;
    q = q.replace(
        new RegExp(`\\s*(?:AND|OR)?\\s*NOT\\s+${fieldPat}:${val}`, "gi"),
        "",
    );
    q = q.replace(new RegExp(`\\s*(?:AND|OR)?\\s*${fieldPat}:${val}`, "gi"), "");

    // 3. Clean up dangling operators and whitespace
    q = q
        .replace(/^\s*(?:AND|OR)\s+/i, "")
        .replace(/\s+(?:AND|OR)\s*$/i, "")
        .trim();
    return q;
}

// ── Actions ───────────────────────────────────────────────────────────────────

function expandAll() {
    const toggles = findAllElements(SELECTORS.expandToggle);
    if (!toggles.length)
        return { ok: false, error: "No expand buttons found on this page." };
    let expanded = 0;
    toggles.forEach((btn) => {
        const isExpanded =
            btn.getAttribute("aria-expanded") === "true" ||
            btn.classList.contains("opened");
        if (!isExpanded) {
            btn.click();
            expanded++;
        }
    });
    return { ok: true, count: expanded };
}

function addFilter({ field, value, mustNot, mode }) {
    const input = findElement(SELECTORS.queryInput);
    if (!input)
        return {
            ok: false,
            error: "Query bar not found. Make sure you're on the Discover page.",
        };

    let clause =
        mode === "wildcard" ? `${field}:*${value}*` : `${field}:"${value}"`;
    if (mustNot) clause = `NOT ${clause}`;

    const current = (input.value || "").trim();
    const next = current ? `${current} AND ${clause}` : clause;

    input.focus();
    setNativeValue(input, next);
    submitQuery(input);
    return { ok: true };
}

function removeFilter({ field }) {
    const input = findElement(SELECTORS.queryInput);
    if (!input) return { ok: false, error: "Query bar not found." };

    const next = removeFieldFromQuery(input.value || "", field);
    input.focus();
    setNativeValue(input, next);
    submitQuery(input);
    return { ok: true };
}

function clearFilters() {
    const input = findElement(SELECTORS.queryInput);
    if (input) {
        input.focus();
        setNativeValue(input, "");
    }

    const filterItems = findAllElements(SELECTORS.filterBadge);
    filterItems.forEach((badge) => {
        const btn =
            badge.querySelector('[data-test-subj="deleteFilter"]') ||
            badge.querySelector('button[aria-label*="Delete"]') ||
            badge.querySelector('button[aria-label*="Remove"]') ||
            badge.querySelector("button");
        if (btn) btn.click();
    });

    setTimeout(() => {
        const submitBtn =
            document.querySelector('[data-test-subj="querySubmitButton"]') ||
            document.querySelector('button[aria-label="Search"]');
        if (submitBtn) submitBtn.click();
        else if (input)
            input.dispatchEvent(
                new KeyboardEvent("keydown", {
                    key: "Enter",
                    keyCode: 13,
                    bubbles: true,
                }),
            );
    }, 150);

    return { ok: true };
}

function buildClause(field, term, mode) {
    switch (mode) {
        case "term":
            return `${field}:"${term}"`;
        case "term_not":
            return `NOT ${field}:"${term}"`;
        case "regex":
            return `${field}:/.*${term}.*/`;
        case "wildcard":
            return `${field}:*${term}*`;
        case "match":
            return `${field}:${term}`;
        default:
            return `${field}:/.*${term}.*/`;
    }
}

// json_payload subfields that a search term may target via a "field.value" prefix
const PAYLOAD_SUBFIELDS = [
    "msg",
    "tag",
    "loan_app_id",
    "trace_id",
    "span_id",
    "level",
];

// Resolve a raw search term to { field, term }. When the base field is
// json_payload, a "<subfield>.<value>" prefix scopes the search to that
// nested field — e.g. "msg.notification" → json_payload.msg : notification.
// Anything without a recognised prefix stays a plain json_payload search.
function resolvePayloadTerm(baseField, raw) {
    if (baseField === "json_payload") {
        const dot = raw.indexOf(".");
        if (dot > 0) {
            const prefix = raw.slice(0, dot);
            const rest = raw.slice(dot + 1).trim();
            if (rest && PAYLOAD_SUBFIELDS.includes(prefix))
                return { field: `json_payload.${prefix}`, term: rest };
        }
    }
    return { field: baseField, term: raw };
}

function addMultiFilter({ field, terms, op, mode = "regex" }) {
    const input = findElement(SELECTORS.queryInput);
    if (!input)
        return {
            ok: false,
            error: "Query bar not found. Make sure you're on the Discover page.",
        };

    // Strip any existing clauses for this field (and its subfields) first
    const stripped = removeFieldFromQuery(input.value || "", field);

    const clauses = terms.map((t) => {
        const { field: f, term } = resolvePayloadTerm(field, t);
        return buildClause(f, term, mode);
    });
    const group =
        clauses.length > 1 ? `(${clauses.join(` ${op} `)})` : clauses[0];
    const next = stripped ? `${stripped} AND ${group}` : group;

    input.focus();
    setNativeValue(input, next);
    submitQuery(input);
    return { ok: true };
}

// ── Query language ────────────────────────────────────────────────────────────

// Poll fn until it returns something truthy (the popover / sidebar renders async)
function waitFor(fn, timeout = 2000, interval = 60) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        (function tick() {
            const v = fn();
            if (v) return resolve(v);
            if (Date.now() - t0 >= timeout) return resolve(null);
            setTimeout(tick, interval);
        })();
    });
}

// The switcher button's label is the language currently in use: "Lucene", or
// "DQL"/"KQL" for kuery.
function currentLanguage(btn) {
    return (btn.textContent || "").trim().toLowerCase();
}

// Variant A — popover with one menu item per language.
function findLanguageMenuItem(language) {
    const direct = document.querySelector(
        `[data-test-subj="${language}LanguageMenuItem"]`,
    );
    if (direct) return direct;
    return (
        [...document.querySelectorAll(LANG_MENU_ITEM)].find(
            (el) => el.textContent.trim().toLowerCase() === language,
        ) || null
    );
}

// Variant B — popover with an EuiSwitch ("Turn on DQL"): on = kuery, off =
// lucene. EUI renders it as a role="switch" button or a checkbox input.
function findLanguageToggle() {
    return (
        document.querySelector('[data-test-subj="languageToggle"]') ||
        document.querySelector('[data-test-subj="queryEnhancementOptIn"]') ||
        document.querySelector(
            '.euiPopover__panel [role="switch"], .euiPopover__panel .euiSwitch__input',
        )
    );
}

function toggleIsOn(el) {
    return el.getAttribute("aria-checked") === "true" || el.checked === true;
}

// Variant C — popover with a <select> of languages.
function findLanguageSelect(language) {
    const sel = document.querySelector(
        '.euiPopover__panel select, [data-test-subj="queryEditorLanguageSelector"]',
    );
    if (!sel || sel.tagName !== "SELECT") return null;
    const opt = [...sel.options].find(
        (o) =>
            o.value.toLowerCase() === language ||
            o.textContent.trim().toLowerCase() === language,
    );
    return opt ? { sel, value: opt.value } : null;
}

async function setQueryLanguage({ language = "lucene" }) {
    const btn = findElement(LANG_SWITCH_BUTTON);
    if (!btn) return { ok: false, error: "Language switcher not found." };
    if (currentLanguage(btn) === language) return { ok: true, changed: false };

    btn.click(); // open the popover

    const found = await waitFor(() => {
        const item = findLanguageMenuItem(language);
        if (item) return { kind: "item", el: item };
        const select = findLanguageSelect(language);
        if (select) return { kind: "select", ...select };
        const toggle = findLanguageToggle();
        if (toggle) return { kind: "toggle", el: toggle };
        return null;
    });

    if (!found) {
        btn.click(); // close the popover we opened
        return { ok: false, error: "No language control in the popover." };
    }

    if (found.kind === "item") {
        found.el.click();
    } else if (found.kind === "select") {
        setNativeValue(found.sel, found.value);
    } else {
        // Toggle on means kuery/DQL — only click when we need it off for Lucene.
        const wantOn = language !== "lucene";
        if (toggleIsOn(found.el) !== wantOn) found.el.click();
    }

    // Confirm via the button label rather than trusting the click landed.
    const ok = await waitFor(() => currentLanguage(btn) === language, 1500);
    if (!ok) return { ok: false, error: `Still on "${currentLanguage(btn)}".` };

    // The popover stays open on the toggle/select variants.
    if (document.querySelector(".euiPopover__panel")) btn.click();
    return { ok: true, changed: true };
}

// ── Discover sidebar fields ───────────────────────────────────────────────────

function isFieldSelected(name) {
    const list = findElement(SIDEBAR_SELECTED_LIST);
    if (!list) return false;
    return Boolean(
        list.querySelector(`[data-test-subj="field-${name}"]`) ||
            [...list.querySelectorAll('[data-test-subj^="field-"]')].some(
                (el) => el.textContent.trim() === name,
            ),
    );
}

// The add/remove toggle for a sidebar field — it's in the DOM even when the
// hover styling hides it.
function findFieldToggle(name) {
    const direct = document.querySelector(
        `[data-test-subj="fieldToggle-${name}"]`,
    );
    if (direct) return direct;

    const row =
        document.querySelector(`[data-test-subj="field-${name}"]`) ||
        [...document.querySelectorAll('[data-test-subj^="field-"]')].find(
            (el) => el.textContent.trim() === name,
        );
    if (!row) return null;
    const scope = row.closest("li") || row.parentElement;
    return (
        scope?.querySelector(
            'button[data-test-subj^="fieldToggle"],' +
                'button[aria-label*="Add"],button[title*="Add"]',
        ) || null
    );
}

// Move fields from "Available fields" into "Selected fields" (no-op per field
// that's already selected).
async function selectFields({ fields = [] }) {
    const added = [];
    const missing = [];
    for (const name of fields) {
        if (isFieldSelected(name)) continue;
        const toggle = await waitFor(() => findFieldToggle(name), 1500);
        if (!toggle) {
            missing.push(name);
            continue;
        }
        toggle.click();
        added.push(name);
    }
    if (missing.length && !added.length)
        return { ok: false, error: `Field not found: ${missing.join(", ")}` };
    return { ok: true, added, missing };
}

// ── JSON Field Extractor ──────────────────────────────────────────────────────
const EXTRACT_CLASS = "lf-extract-overlay";
const EXTRACT_ROW_CLASS = "lf-extract-row";
const COL_WIDTH_KEY = "lf_col_widths";
const DEFAULT_COL_W = 160;

let extractObserver = null;
let activeFields = [];

// Persist column widths in localStorage
function loadColWidths() {
    try {
        return JSON.parse(localStorage.getItem(COL_WIDTH_KEY) || "{}");
    } catch {
        return {};
    }
}
function saveColWidths(w) {
    try {
        localStorage.setItem(COL_WIDTH_KEY, JSON.stringify(w));
    } catch {}
}
let colWidths = loadColWidths();

// Sync resize across all visible overlays for the same field
function applyColWidth(fieldName, px) {
    colWidths[fieldName] = px;
    saveColWidths(colWidths);
    document
        .querySelectorAll(`[data-lf-field="${fieldName}"]`)
        .forEach((el) => {
            el.style.width = px + "px";
        });
}

// Index of the column header currently being dragged (null when not dragging)
let colDragIndex = null;

// Move an extractor column from one position to another, rebuild every overlay
// with the new order, and persist it so the popup + reloads keep the change.
function reorderExtractFields(from, to) {
    if (from == null || from === to) return;
    if (from < 0 || from >= activeFields.length) return;
    const f = activeFields.slice();
    const [moved] = f.splice(from, 1);
    f.splice(to, 0, moved);
    activeFields = f;
    try {
        chrome.storage?.local?.set({ extractFields: f });
    } catch {}
    purgeOverlays();
    processTableRows(activeFields);
}

// Cache of json_payload objects captured from intercepted search responses
let cachedPayloads = []; // index → parsed json_payload (or null)

// Kill borders/spacing on overlay rows + hide the original data row stub
(function () {
    const s = document.createElement("style");
    s.textContent = `
    tr.lf-extract-row,
    tr.lf-extract-row td {
      border: none !important;
      border-top: none !important;
      padding: 0 !important;
      margin: 0 !important;
      box-shadow: none !important;
      outline: none !important;
    }
    tbody tr:not(.lf-extract-row):has(+ tr.lf-extract-row) {
      display: none !important;
    }
    tbody tr:not(.lf-extract-row):has(+ tr + tr.lf-extract-row) td,
    tbody tr:not(.lf-extract-row):has(+ tr + tr.lf-extract-row) th {
      border-bottom: none !important;
    }
    @keyframes lf-spin { to { transform: rotate(360deg); } }
  `;
    document.head.appendChild(s);
})();

// ── Loading indicator (shown while a new query / refresh loads its data) ──────
const LOADING_ID = "lf-extract-loading";

function showExtractLoading() {
    let el = document.getElementById(LOADING_ID);
    const th = T();
    if (!el) {
        el = document.createElement("div");
        el.id = LOADING_ID;
        const spinner = document.createElement("div");
        spinner.className = "lf-spinner";
        spinner.style.cssText =
            "width:14px;height:14px;border-radius:50%;flex-shrink:0;" +
            "animation:lf-spin 0.7s linear infinite;";
        const txt = document.createElement("span");
        txt.className = "lf-loading-text";
        txt.textContent = "Loading extracted fields…";
        el.appendChild(spinner);
        el.appendChild(txt);
        document.body.appendChild(el);
    }
    // (Re)apply theme colours each time so it matches light/dark on show
    // (right:150px keeps it clear of the panel launcher in the corner)
    el.style.cssText =
        "position:fixed;bottom:20px;right:150px;z-index:2147483647;" +
        "display:flex;align-items:center;gap:9px;padding:10px 14px;" +
        `background:${th.bg};color:${th.fg};border:1px solid ${th.border};` +
        "border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,0.28);" +
        "font-family:'Fira Code',Consolas,monospace;font-size:12px;";
    const sp = el.querySelector(".lf-spinner");
    if (sp)
        sp.style.border = `2px solid ${th.sep}`,
            (sp.style.borderTopColor = th.border);

    // Safety net: never spin forever if data never arrives
    clearTimeout(el._lfHideT);
    el._lfHideT = setTimeout(hideExtractLoading, 20000);
}

function hideExtractLoading() {
    document.getElementById(LOADING_ID)?.remove();
}

function purgeOverlays() {
    document
        .querySelectorAll(`.${EXTRACT_ROW_CLASS}`)
        .forEach((el) => el.remove());
    document
        .querySelectorAll("[data-lf-key]")
        .forEach((el) => el.removeAttribute("data-lf-key"));
}

// ── Clear overlays immediately on query / navigation change ──────────────
window.addEventListener("message", (e) => {
    if (e.source !== window) return;

    if (e.data?.type === "__LF_NAV__") {
        if (!activeFields.length) return;
        // New query / refresh / time change: keep the extractor applied, drop
        // the now-stale overlays and show a loading indicator. The incoming
        // __LF_HITS__ (fresh data) re-renders the overlays and hides it.
        purgeOverlays();
        showExtractLoading();
        return;
    }
});

window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.type !== "__LF_HITS__") return;
    cachedPayloads = e.data.payloads || [];
    // New search response → purge stale overlays so rows re-render with fresh data
    if (activeFields.length) {
        showExtractLoading();
        purgeOverlays();
        clearTimeout(window._lfTimer);
        window._lfTimer = setTimeout(() => {
            if (processTableRows(activeFields) > 0) hideExtractLoading();
        }, 400);
    }
});

function getNestedValue(obj, path) {
    return path.split(".").reduce((cur, k) => cur?.[k], obj);
}

// Full JSON parse with truncated-JSON fallbacks
function tryParseJson(text) {
    const s = text.trim();
    if (!s.startsWith("{")) return null;
    try {
        return JSON.parse(s);
    } catch {}
    for (const sfx of ['"}', '"}}', '"}}}', "}}", "}}}", "}}}}"]) {
        try {
            return JSON.parse(s + sfx);
        } catch {}
    }
    return null;
}

// ── Theme system ─────────────────────────────────────────────────────────────
const THEMES = {
    light: {
        // Dracula White (default)
        bg: "#ffffff",
        border: "#6272a4",
        hdr: "#8892b0", // column label
        fg: "#282a36", // value text
        empty: "#b0b8c8",
        sep: "#e0e0e8",
        jsonBg: "#f0f0ef",
        jsonBord: "#d0d0d8",
        jsonFg: "#282a36",
        toggle: "#6272a4",
        handle: "#6272a4",
        comment: "#5c9e5c", // commented-out query lines
        opEq: "#2e7d32", // =  (exact term)
        opRe: "#7a5af8", // =~ (regex), same colour as a /regex/ literal
        // Translucent so the coloured text under the textarea stays readable
        selBg: "rgba(98,114,164,0.28)",
        // syntax
        key: "#0070b8",
        str: "#bf3939",
        num: "#7a5af8",
        bool_t: "#2e7d32",
        bool_f: "#c0392b",
        null_: "#95a5a6",
    },
    dark: {
        // Dracula Dark
        bg: "#282a36",
        border: "#bd93f9",
        hdr: "#6272a4",
        fg: "#f8f8f2",
        empty: "#6272a4",
        sep: "#44475a",
        jsonBg: "#21222c",
        jsonBord: "#44475a",
        jsonFg: "#f8f8f2",
        toggle: "#6272a4",
        handle: "#bd93f9",
        comment: "#6272a4", // commented-out query lines
        opEq: "#50fa7b", // =  (exact term)
        opRe: "#bd93f9", // =~ (regex), same colour as a /regex/ literal
        selBg: "rgba(189,147,249,0.35)",
        // syntax
        key: "#8be9fd",
        str: "#f1fa8c",
        num: "#bd93f9",
        bool_t: "#50fa7b",
        bool_f: "#ff5555",
        null_: "#6272a4",
    },
};

// Default: light (Dracula White)
let activeTheme = "light";
try {
    activeTheme = localStorage.getItem("lf_theme") || "light";
} catch {}
function T() {
    return THEMES[activeTheme] || THEMES.light;
}

// Level → colour mapping
const LEVEL_COLORS = {
    ERROR: { light: "#c0392b", dark: "#ff5555" },
    WARN: { light: "#d35400", dark: "#ffb86c" },
    WARNING: { light: "#d35400", dark: "#ffb86c" },
    INFO: { light: "#2e7d32", dark: "#50fa7b" },
    DEBUG: { light: "#0070b8", dark: "#8be9fd" },
};
function levelColor(value) {
    const c = LEVEL_COLORS[String(value).toUpperCase()];
    return c ? c[activeTheme] || c.dark : null;
}

function syntaxHighlight(obj, rawFallback) {
    const str = obj ? JSON.stringify(obj, null, 2) : String(rawFallback || "");

    // Escape HTML entities BEFORE regex so < > & in values are safe
    const safe = str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Use [ \t]* (NOT \s*) so newlines are NOT consumed → keeps } on its own line
    return safe.replace(
        /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*")[ \t]*(:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?/g,
        (match) => {
            if (match.startsWith('"')) {
                return match.endsWith(":")
                    ? `<span style="color:${T().key}">${match.slice(0, -1)}</span>:`
                    : `<span style="color:${T().str}">${match}</span>`;
            }
            if (match === "true")
                return `<span style="color:${T().bool_t}">${match}</span>`;
            if (match === "false")
                return `<span style="color:${T().bool_f}">${match}</span>`;
            if (match === "null")
                return `<span style="color:${T().toggle}">${match}</span>`;
            return `<span style="color:${T().num}">${match}</span>`; // number
        },
    );
}

// Parse a field spec: returns { type:"simple", field } or { type:"coalesce", fields:[...] }
function parseSpec(spec) {
    const m = spec.trim().match(/^coalesce\(\s*(.+?)\s*\)$/i);
    if (m)
        return {
            type: "coalesce",
            fields: m[1].split(",").map((f) => f.trim()),
        };
    return { type: "simple", field: spec.trim() };
}

// Regex extraction for a single field path (works on truncated JSON)
function regexExtractOne(text, fieldPath) {
    const key = fieldPath.split(".").pop();
    const re = new RegExp(
        `"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|[^,}\\s\\]]+)`,
        "i",
    );
    const m = text.match(re);
    if (!m) return undefined;
    let v = m[1];
    if (v.startsWith('"') && v.endsWith('"'))
        v = v.slice(1, -1).replace(/\\"/g, '"');
    return v;
}

// Flatten every distinct field path referenced by any spec (simple + coalesce)
function collectFields(specs) {
    const needed = new Set();
    specs.forEach((spec) => {
        const p = parseSpec(spec);
        if (p.type === "coalesce") p.fields.forEach((f) => needed.add(f));
        else needed.add(p.field);
    });
    return needed;
}

// Build a flat map of all raw field values needed by any spec (for regex fallback)
function regexExtract(text, specs) {
    const result = {};
    collectFields(specs).forEach((f) => {
        const v = regexExtractOne(text, f);
        if (v !== undefined) result[f] = v;
    });
    return result;
}

// Table header cells (both plain <thead> and ARIA grids). Queried once per
// processTableRows pass and threaded through, never per-row.
function getHeaderCells() {
    return [
        ...document.querySelectorAll("thead tr th"),
        ...document.querySelectorAll("thead tr [role='columnheader']"),
    ];
}

// For any spec field the json_payload doesn't provide, fall back to the matching
// sibling table column (kept even when that column is hidden — textContent still
// resolves). Mutates regexResult in place so resolveSpec can pick it up. `headers`
// is precomputed by the caller; row cells are read once and only if needed.
function enrichFromRow(row, specs, parsed, regexResult, headers) {
    if (!row || !headers.length) return;
    let cells = null;
    collectFields(specs).forEach((f) => {
        const fromJson = parsed ? getNestedValue(parsed, f) : undefined;
        if (fromJson !== undefined && fromJson !== null && fromJson !== "")
            return;
        if (regexResult[f] !== undefined) return;
        const idx = headers.findIndex((h) =>
            h.textContent.trim().includes(f),
        );
        if (idx < 0) return;
        if (!cells)
            cells = [
                ...row.querySelectorAll(":scope > td"),
                ...row.querySelectorAll(":scope > [role='gridcell']"),
            ];
        const cell = cells[idx];
        if (!cell) return;
        const v = (cell.textContent || "").trim();
        if (v) regexResult[f] = v;
    });
}

// Resolve one spec to { label, displayValue } using parsed JSON or regex fallback
function resolveSpec(spec, parsed, regexResult) {
    const p = parseSpec(spec);

    if (p.type === "coalesce") {
        for (const f of p.fields) {
            let val = parsed ? getNestedValue(parsed, f) : undefined;
            if (val === undefined || val === null || val === "")
                val = regexResult[f];
            if (val !== undefined && val !== null && val !== "") {
                return {
                    label: f,
                    displayValue:
                        typeof val === "object"
                            ? JSON.stringify(val)
                            : String(val),
                };
            }
        }
        // All missing / empty → show first field name with empty marker
        return { label: p.fields[0], displayValue: "" };
    }

    // Simple field — always show the column, empty string when value is missing
    let val = parsed ? getNestedValue(parsed, p.field) : undefined;
    if (val === undefined || val === null || val === "")
        val = regexResult[p.field];
    const dv =
        val !== undefined && val !== null
            ? Array.isArray(val) && val.length === 1
                ? String(val[0])
                : typeof val === "object"
                    ? JSON.stringify(val)
                    : String(val)
            : "";
    return { label: p.field, displayValue: dv };
}

function buildOverlay(parsed, regexResult, specs, rawJson) {
    const th = T();
    const wrap = document.createElement("div");
    wrap.className = EXTRACT_CLASS;
    wrap.style.cssText =
        `margin:0;padding:0;background:${th.bg};` +
        `border-left:4px solid ${th.border};border-radius:0 6px 6px 0;` +
        "font-family:'Fira Code',Consolas,monospace;font-size:13px;" +
        "width:100%;box-sizing:border-box;overflow:hidden;";

    // ── Column grid ───────────────────────────────────────────────────────────
    // grid = flex-column wrapper (has the border-bottom "br")
    // colRow = flex-row for the field columns
    const grid = document.createElement("div");
    grid.style.cssText = `display:flex;flex-direction:column;border-bottom:1px solid ${th.sep};`;

    const colRow = document.createElement("div");
    colRow.style.cssText = "display:flex;align-items:stretch;";

    let any = false;
    specs.forEach((spec, colIdx) => {
        const resolved = resolveSpec(spec, parsed, regexResult);
        if (resolved === null) return;

        const fieldName = resolved.label;
        const w = colWidths[fieldName] ?? DEFAULT_COL_W;

        // Column cell
        const col = document.createElement("div");
        col.dataset.lfField = fieldName;
        col.style.cssText =
            `width:${w}px;min-width:50px;flex-shrink:0;` +
            `position:relative;padding:5px 10px 5px 12px;` +
            `border-right:1px solid ${th.sep};overflow:hidden;`;

        // Field name header — also the drag handle for reordering columns
        const hdr = document.createElement("div");
        hdr.style.cssText =
            `color:${th.hdr};font-size:10px;letter-spacing:0.4px;cursor:grab;` +
            "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;";
        hdr.textContent = fieldName;
        hdr.title = `${fieldName} · drag to reorder`;
        hdr.draggable = true;

        // ── Drag to reorder columns (grab the header, drop on any column) ────
        hdr.addEventListener("dragstart", (e) => {
            colDragIndex = colIdx;
            e.dataTransfer.effectAllowed = "move";
            col.style.opacity = "0.4";
        });
        hdr.addEventListener("dragend", () => {
            colDragIndex = null;
            col.style.opacity = "";
        });
        col.addEventListener("dragover", (e) => {
            if (colDragIndex === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
        });
        col.addEventListener("drop", (e) => {
            if (colDragIndex === null) return;
            e.preventDefault();
            e.stopPropagation();
            const rect = col.getBoundingClientRect();
            let to = e.clientX > rect.left + rect.width / 2 ? colIdx + 1 : colIdx;
            const from = colDragIndex;
            if (from < to) to -= 1;
            reorderExtractFields(from, to);
        });

        // Value — with special level colouring
        const hasVal = Boolean(resolved.displayValue);
        const lvlColor =
            fieldName === "level" ? levelColor(resolved.displayValue) : null;
        const val = document.createElement("div");
        val.style.cssText =
            (hasVal
                ? `color:${lvlColor || th.fg};${lvlColor ? "font-weight:bold;" : ""}`
                : `color:${th.empty};font-style:italic;`) +
            "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;";
        val.textContent = resolved.displayValue || "—";
        if (hasVal) val.title = resolved.displayValue;

        // ── Drag handle ────────────────────────────────────────────────────────
        const handle = document.createElement("div");
        handle.style.cssText =
            "position:absolute;top:0;right:0;width:5px;height:100%;" +
            "cursor:col-resize;z-index:5;transition:background 0.1s;";
        handle.addEventListener("mouseenter", () => {
            handle.style.background = T().num + "88";
        });
        handle.addEventListener("mouseleave", () => {
            handle.style.background = "transparent";
        });
        handle.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startW = col.offsetWidth;

            const onMove = (ev) => {
                const newW = Math.max(50, startW + ev.clientX - startX);
                applyColWidth(fieldName, newW);
            };
            const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });

        col.appendChild(hdr);
        col.appendChild(val);
        col.appendChild(handle);
        colRow.appendChild(col);
        any = true;
    });
    grid.appendChild(colRow);

    // ── json_payload toggle row (below columns, inside grid = above the border) ─
    if (rawJson) {
        // Row 2 inside the grid: "▶ json_payload" — below the data columns
        const toggleRow = document.createElement("div");
        toggleRow.style.cssText =
            `padding:3px 12px;display:inline-flex;align-items:center;gap:5px;` +
            `cursor:pointer;user-select:none;color:${th.toggle};font-size:11px;` +
            `width:100%;box-sizing:border-box;`;

        const arrow = document.createElement("span");
        arrow.textContent = "▶";
        arrow.style.cssText = "font-size:9px;display:inline-block;transition:transform 0.15s;";

        const lbl = document.createElement("span");
        lbl.textContent = "json_payload";

        // ── Action buttons (right-aligned): Full/Fit + Copy ──────────────────
        const makeMiniBtn = (text) => {
            const b = document.createElement("button");
            b.textContent = text;
            b.style.cssText =
                `font-family:inherit;font-size:10px;line-height:1;padding:3px 7px;` +
                `margin-left:6px;cursor:pointer;border-radius:4px;` +
                `border:1px solid ${th.jsonBord};background:${th.jsonBg};` +
                `color:${th.toggle};white-space:nowrap;`;
            b.addEventListener("mouseenter", () => { b.style.background = th.sep; });
            b.addEventListener("mouseleave", () => { b.style.background = th.jsonBg; });
            return b;
        };
        const btnGroup = document.createElement("span");
        btnGroup.style.cssText = "margin-left:10px;display:inline-flex;align-items:center;";
        const fullBtn = makeMiniBtn("⤢ Full");
        const copyBtn = makeMiniBtn("⧉ Copy");
        btnGroup.appendChild(fullBtn);
        btnGroup.appendChild(copyBtn);

        toggleRow.appendChild(arrow);
        toggleRow.appendChild(lbl);
        toggleRow.appendChild(btnGroup);
        grid.appendChild(toggleRow);   // inside grid → above the grid's border-bottom

        // Pre element (below the grid border)
        const DEFAULT_JSON_H = 400;
        const pre = document.createElement("pre");
        pre.innerHTML = syntaxHighlight(parsed, rawJson);
        pre.style.cssText =
            `display:none;margin:0;padding:12px 16px;` +
            `background:${th.jsonBg};border-top:1px solid ${th.jsonBord};` +
            `color:${th.jsonFg};font-size:13px;line-height:1.7;overflow:auto;` +
            `height:${DEFAULT_JSON_H}px;white-space:pre;word-break:normal;` +
            "width:100%;box-sizing:border-box;";

        // ── Height resize handle (drag to resize pre) ─────────────────────────
        const resizeBar = document.createElement("div");
        resizeBar.style.cssText =
            `display:none;height:6px;cursor:row-resize;` +
            `background:${th.sep};transition:background 0.1s;`;
        resizeBar.addEventListener("mouseenter", () => { resizeBar.style.background = th.border; });
        resizeBar.addEventListener("mouseleave", () => { resizeBar.style.background = th.sep; });
        resizeBar.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const startY = e.clientY;
            const startH = pre.getBoundingClientRect().height;
            const onMove = (ev) => {
                pre.style.height = Math.max(60, startH + ev.clientY - startY) + "px";
            };
            const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });

        // Open / close the JSON viewer (pre + resize handle together)
        const setOpen = (open) => {
            pre.style.display       = open ? "block" : "none";
            resizeBar.style.display = open ? "block" : "none";
            arrow.style.transform   = open ? "rotate(90deg)" : "rotate(0deg)";
            toggleRow.style.color   = open ? T().key : T().toggle;
        };
        toggleRow.addEventListener("click", (e) => {
            e.stopPropagation();
            setOpen(pre.style.display === "none");
        });

        // ── Full / Fit: expand the pre to the entire JSON (no scroll cap) ────
        let full = false;
        fullBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (pre.style.display === "none") setOpen(true); // reveal first
            full = !full;
            if (full) {
                pre.style.height = "auto";
                pre.style.maxHeight = "none";
                resizeBar.style.display = "none"; // no fixed height to drag
                fullBtn.textContent = "⤡ Fit";
            } else {
                pre.style.height = DEFAULT_JSON_H + "px";
                pre.style.maxHeight = "";
                resizeBar.style.display = "block";
                fullBtn.textContent = "⤢ Full";
            }
        });

        // ── Copy: pretty-printed JSON to clipboard ──────────────────────────
        copyBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const text = parsed ? JSON.stringify(parsed, null, 2) : rawJson;
            try {
                await navigator.clipboard.writeText(text);
            } catch {
                const ta = document.createElement("textarea");
                ta.value = text;
                ta.style.cssText = "position:fixed;left:-9999px;top:0;";
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand("copy"); } catch {}
                ta.remove();
            }
            copyBtn.textContent = "✓ Copied";
            clearTimeout(copyBtn._t);
            copyBtn._t = setTimeout(() => (copyBtn.textContent = "⧉ Copy"), 1200);
        });

        wrap.appendChild(grid);
        wrap.appendChild(pre);
        wrap.appendChild(resizeBar);
        any = true;
    } else {
        if (any) wrap.appendChild(grid);
    }

    return any ? wrap : null;
}

function insertOverlayAfterRow(row, overlay, fieldKey) {
    const next = row.nextElementSibling;
    if (next?.classList.contains(EXTRACT_ROW_CLASS)) {
        if (next.dataset.lfKey === fieldKey) return false; // already current
        next.remove();
    }
    const tr = document.createElement("tr");
    tr.className = EXTRACT_ROW_CLASS;
    tr.dataset.lfKey = fieldKey;
    tr.style.cssText = "background:transparent;border:none;line-height:0;";
    const td = document.createElement("td");
    td.colSpan = 99;
    td.style.cssText =
        "padding:0;margin:0;border:none !important;overflow:visible;line-height:normal;";
    td.appendChild(overlay);
    tr.appendChild(td);
    row.after(tr);
    return true;
}

// A row already carries a current overlay for this field set → nothing to do.
function rowHasCurrentOverlay(row, fieldKey) {
    const next = row.nextElementSibling;
    return (
        next?.classList.contains(EXTRACT_ROW_CLASS) &&
        next.dataset.lfKey === fieldKey
    );
}

// Candidate JSON cells, excluding our own injected overlays. A single combined
// selector (querySelectorAll dedupes) instead of five separate queries + Set.
const CANDIDATE_SELECTOR =
    'td,[role="gridcell"],.euiDataGridRowCell__content,' +
    '.kbnDocTableCell,[data-test-subj*="docTableField"]';

function collectCandidateCells() {
    const out = [];
    document.querySelectorAll(CANDIDATE_SELECTOR).forEach((cell) => {
        // Skip cells inside (or belonging to) our overlays — they contain JSON too.
        if (
            cell.classList.contains(EXTRACT_CLASS) ||
            cell.closest(`.${EXTRACT_ROW_CLASS}`) ||
            cell.closest(`.${EXTRACT_CLASS}`)
        )
            return;
        out.push(cell);
    });
    return out;
}

function processTableRows(fields) {
    if (!fields.length) return 0;
    const fieldKey = fields.join(",");
    let found = 0;
    const seenRows = new Set();
    const headers = getHeaderCells();

    // ── Pass 1: visible JSON cells (json_payload is a selected column) ───────
    collectCandidateCells().forEach((cell) => {
        const parentRow = cell.closest("tr");

        // Fast path: skip rows/cells already carrying a current overlay so we
        // never rebuild overlay DOM for unchanged rows (the streaming-log case).
        if (parentRow) {
            if (seenRows.has(parentRow)) return;
            if (rowHasCurrentOverlay(parentRow, fieldKey)) {
                seenRows.add(parentRow);
                found++;
                return;
            }
        } else if (cell.dataset.lfKey === fieldKey) {
            found++;
            return;
        }

        // textContent (not innerText) — innerText forces a synchronous reflow
        // per cell, which is the dominant cost on large tables.
        const raw = (cell.textContent || "").trim();
        if (!raw.slice(0, 200).includes("{")) return;

        const jsonStart = raw.indexOf("{");
        const jsonText = jsonStart > 0 ? raw.slice(jsonStart) : raw;
        const parsed = tryParseJson(jsonText);
        const regex = regexExtract(raw, fields);
        enrichFromRow(parentRow, fields, parsed, regex, headers);
        const overlay = buildOverlay(parsed, regex, fields, jsonText);
        if (!overlay) return;

        if (parentRow) {
            seenRows.add(parentRow);
            insertOverlayAfterRow(parentRow, overlay, fieldKey);
            found++;
        } else {
            cell.dataset.lfKey = fieldKey;
            cell.querySelectorAll(`.${EXTRACT_CLASS}`).forEach((el) =>
                el.remove(),
            );
            cell.style.overflow = "visible";
            cell.style.maxHeight = "none";
            cell.style.whiteSpace = "normal";
            cell.appendChild(overlay);
            found++;
        }
    });

    if (found > 0) return found;

    // ── Pass 2: no JSON column visible — use intercepted search cache ─────────
    if (!cachedPayloads.length) return 0;

    // Collect real data rows (skip our injected overlay rows)
    const dataRows = [...document.querySelectorAll("tbody tr")].filter(
        (tr) => !tr.classList.contains(EXTRACT_ROW_CLASS),
    );

    dataRows.forEach((row, idx) => {
        const payload = cachedPayloads[idx];
        if (!payload) return;
        if (rowHasCurrentOverlay(row, fieldKey)) {
            found++;
            return;
        }

        const parsed =
            typeof payload === "object"
                ? payload
                : tryParseJson(String(payload));
        const jsonText = parsed ? JSON.stringify(parsed) : String(payload);
        const regex = regexExtract(jsonText, fields);
        const overlay = buildOverlay(parsed, regex, fields, jsonText);
        if (!overlay) return;

        insertOverlayAfterRow(row, overlay, fieldKey);
        found++;
    });

    return found;
}

// ── Hide / show a table column by field name ──────────────────────────────
const HIDE_STYLE_ID = "lf-hide-col-style";

// Columns the extractor overlays replace — hidden while extraction is running
const HIDE_FIELDS = ["Time", "kubernetes.container_name", "json_payload"];

// fields: column name substrings to hide; defaults to the ones the overlays replace
function hideColumns({ fields = HIDE_FIELDS }) {
    document.getElementById(HIDE_STYLE_ID)?.remove();

    const headers = [
        ...document.querySelectorAll("thead tr th"),
        ...document.querySelectorAll("thead tr [role='columnheader']"),
    ];

    const rules = [];
    fields.forEach((field) => {
        const idx = headers.findIndex((h) =>
            h.textContent.trim().includes(field),
        );
        if (idx < 0) return;
        const n = idx + 1;
        rules.push(
            `thead tr th:nth-child(${n}),` +
                `thead tr [role="columnheader"]:nth-child(${n}),` +
                `tbody tr:not(.${EXTRACT_ROW_CLASS}) td:nth-child(${n}),` +
                `tbody tr:not(.${EXTRACT_ROW_CLASS}) [role="gridcell"]:nth-child(${n})` +
                `{ display:none !important; }`,
        );
    });

    if (!rules.length) return { ok: false, error: "No matching columns found" };
    const style = document.createElement("style");
    style.id = HIDE_STYLE_ID;
    style.textContent = rules.join("\n");
    document.head.appendChild(style);
    return { ok: true };
}

function showColumn() {
    document.getElementById(HIDE_STYLE_ID)?.remove();
    return { ok: true };
}

function startExtract(fields) {
    activeFields = fields;
    const found = processTableRows(fields);

    if (extractObserver) extractObserver.disconnect();
    extractObserver = new MutationObserver((mutations) => {
        let tableRowsRemoved = false;
        let relevant = false;

        // Classify mutations once: ignore the ones caused by our own overlay
        // insertions/removals, otherwise the observer feeds itself in a loop.
        for (const m of mutations) {
            for (const n of m.removedNodes) {
                if (n.nodeType !== 1) continue;
                if (n.classList?.contains(EXTRACT_ROW_CLASS)) continue; // ours
                if (n.tagName === "TR") tableRowsRemoved = true;
                relevant = true;
            }
            for (const n of m.addedNodes) {
                if (n.nodeType !== 1) continue;
                if (
                    n.classList?.contains(EXTRACT_ROW_CLASS) ||
                    n.classList?.contains(EXTRACT_CLASS)
                )
                    continue; // ours
                relevant = true;
            }
        }

        if (tableRowsRemoved) purgeOverlays(); // table re-rendered → drop stale overlays
        if (!relevant) return; // only our own DOM churned — skip reprocessing

        clearTimeout(window._lfTimer);
        window._lfTimer = setTimeout(() => {
            if (processTableRows(activeFields) > 0) hideExtractLoading();
        }, 300);
    });
    extractObserver.observe(document.body, { childList: true, subtree: true });

    return { ok: true, found };
}

// Extraction reads json_payload out of the table, so it has to be a selected
// column first — it gets hidden again right after via HIDE_FIELDS.
const REQUIRED_FIELDS = ["json_payload"];

// Full "Apply to Table" sequence: prepare the page (Lucene + json_payload
// column), start extracting, then hide the columns the overlays replace.
// Neither prep step is fatal — extraction still works off the intercepted cache.
async function applyExtract({ fields = [] }) {
    if (!fields.length) return { ok: false, error: "No fields given" };

    const lang = await setQueryLanguage({ language: "lucene" });
    const sel = await selectFields({ fields: REQUIRED_FIELDS });
    if (lang.changed || sel.added?.length)
        await new Promise((r) => setTimeout(r, 400)); // let the table re-render

    const res = startExtract(fields);
    hideColumns({});
    return { ...res, lang };
}

function stopExtract() {
    activeFields = [];
    if (extractObserver) {
        extractObserver.disconnect();
        extractObserver = null;
    }
    hideExtractLoading();
    document
        .querySelectorAll(`.${EXTRACT_ROW_CLASS}`)
        .forEach((el) => el.remove());
    document.querySelectorAll(`.${EXTRACT_CLASS}`).forEach((el) => el.remove());
    document
        .querySelectorAll("[data-lf-key]")
        .forEach((el) => el.removeAttribute("data-lf-key"));
    return { ok: true };
}

// ── Auto-apply ────────────────────────────────────────────────────────────────
// With auto mode on, the saved fields are applied as soon as the results table
// renders — on page load and on SPA navigation — so "Apply to Table" only has
// to be clicked once, ever.
let autoPending = false;

function readStored(keys) {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(keys, (d) => resolve(d || {}));
        } catch {
            resolve({});
        }
    });
}

async function autoApply() {
    if (autoPending || activeFields.length) return;

    const { extractAuto, extractFields } = await readStored([
        "extractAuto",
        "extractFields",
    ]);
    if (!extractAuto || !extractFields?.length) return;

    autoPending = true;
    // The content script runs on every page — the query bar is what says this
    // is actually Discover. Nothing is shown until it turns up, so other sites
    // never see a stray spinner.
    const isDiscover = await waitFor(
        () => findElement(SELECTORS.queryInput),
        10000,
        300,
    );
    if (!isDiscover) {
        autoPending = false;
        return;
    }

    // Rows land a moment after the query bar.
    showExtractLoading();
    const ready = await waitFor(
        () => document.querySelector("tbody tr"),
        15000,
        300,
    );
    autoPending = false;

    // Bail if the user applied/stopped by hand while we were waiting.
    if (!ready || activeFields.length) return hideExtractLoading();

    const res = await applyExtract({ fields: extractFields });
    if (res.found > 0) hideExtractLoading();
}

autoApply();
window.addEventListener("message", (e) => {
    if (e.source === window && e.data?.type === "__LF_NAV__") autoApply();
});

// ── Theme switching ───────────────────────────────────────────────────────────
function setTheme(theme) {
    activeTheme = theme || "light";
    try {
        localStorage.setItem("lf_theme", activeTheme);
    } catch {}
    if (activeFields.length) {
        stopExtract();
        setTimeout(() => startExtract(activeFields), 50);
    }
    if (document.getElementById(PANEL_ID)) {
        closePanel();
        openPanel();
    }
    rebuildEditor(); // the query editor's colours are theme-dependent
    return { ok: true };
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function lfToast(text, ms = 2200) {
    const th = T();
    let el = document.getElementById("lf-toast");
    if (!el) {
        el = document.createElement("div");
        el.id = "lf-toast";
        document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.cssText =
        "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);" +
        "z-index:2147483647;padding:9px 14px;border-radius:8px;" +
        `background:${th.bg};color:${th.fg};border:1px solid ${th.border};` +
        "box-shadow:0 4px 18px rgba(0,0,0,0.28);" +
        "font-family:'Fira Code',Consolas,monospace;font-size:12px;";
    clearTimeout(el._t);
    el._t = setTimeout(() => el.remove(), ms);
}

// ── Query editor ──────────────────────────────────────────────────────────────
// OpenSearch's own query bar grabs the arrow keys for its history/suggestion
// popup, which makes editing a long query miserable. So the query is written in
// our own box instead — a syntax-coloured code block that supports comment
// lines — and only the cleaned, single-line query is pushed into their bar.

const QUERY_SRC_KEY = "lf_query_src";
const EDITOR_H_KEY = "lf_editor_height";
const EDITOR_ID = "lf-editor";
const EDITOR_STYLE_ID = "lf-editor-style";
const DEFAULT_EDITOR_H = 120;

let editorHeight = Number(localStorage.getItem(EDITOR_H_KEY)) || DEFAULT_EDITOR_H;
let editorBox = null; // the whole editor
let editorTA = null; // our textarea
let editorPre = null; // the colour layer under it
let editorMirror = null; // hidden copy used to locate the caret on screen

function queryBarEl() {
    return findElement(SELECTORS.queryInput);
}

// ── Comments ─────────────────────────────────────────────────────────────────
// Cut a line at its first comment marker, ignoring markers inside "quoted
// strings" and /regex/ literals (so http:// and /.*a.*/ stay intact).
function stripLineComment(line) {
    let quoted = false;
    let inRegex = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        const n = line[i + 1];
        if (c === "\\") {
            i++;
            continue;
        }
        if (quoted) {
            if (c === '"') quoted = false;
            continue;
        }
        if (inRegex) {
            if (c === "/") inRegex = false;
            continue;
        }
        if (c === '"') {
            quoted = true;
            continue;
        }
        if (c === "/" && line[i - 1] === ":") {
            inRegex = true;
            continue;
        }
        if ((c === "-" && n === "-") || (c === "/" && n === "/") || c === "#")
            return line.slice(0, i);
    }
    return line;
}

// Multi-line annotated query → the single-line query OpenSearch runs
function stripQueryComments(text) {
    return text
        .split("\n")
        .map((l) => stripLineComment(l).trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

// ── Shorthand operators ──────────────────────────────────────────────────────
//   field="value"   → field:"value"          (exact term)
//   field=~"value"  → field:/.*value.*/      (contains, regex)
// The value may be bare too: level=ERROR, msg=~nil.
const SUGAR_RE =
    /([A-Za-z_@][\w.@-]*)\s*(=~|=)\s*("(?:\\.|[^"\\])*"|[^\s()]+)/g;

// Character ranges covered by "strings" and /regex/ literals — a shorthand
// operator inside one of those is just text, e.g. msg:"a=b".
function protectedRanges(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        const isString = c === '"';
        const isRegex = c === "/" && s[i - 1] === ":";
        if (!isString && !isRegex) {
            i++;
            continue;
        }
        const close = isString ? '"' : "/";
        const start = i++;
        while (i < s.length && s[i] !== close) i += s[i] === "\\" ? 2 : 1;
        out.push([start, i]);
        i++;
    }
    return out;
}

function compileQuerySugar(q) {
    const ranges = protectedRanges(q);
    let out = "";
    let last = 0;
    let m;
    SUGAR_RE.lastIndex = 0;
    while ((m = SUGAR_RE.exec(q))) {
        if (ranges.some(([a, b]) => m.index > a && m.index < b)) continue;
        const [full, field, op, raw] = m;
        const val =
            raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
        out +=
            q.slice(last, m.index) +
            (op === "=~"
                ? `${field}:/.*${val.replace(/\//g, "\\/")}.*/`
                : `${field}:"${val}"`);
        last = m.index + full.length;
    }
    return out + q.slice(last);
}

function countCommentLines(text) {
    return text
        .split("\n")
        .filter((l) => l.trim() && stripLineComment(l).trim() !== l.trim())
        .length;
}

// ⌘/ ⌃/ — comment out the selected lines, or uncomment them when they all
// already are (same as an editor's toggle-comment).
function toggleLineComment(ta) {
    const v = ta.value;
    const selStart = ta.selectionStart;
    const selEnd = ta.selectionEnd;
    const start = v.lastIndexOf("\n", selStart - 1) + 1;
    let end = v.indexOf("\n", selEnd);
    if (end === -1) end = v.length;

    const lines = v.slice(start, end).split("\n");
    const filled = lines.filter((l) => l.trim());
    const allCommented =
        filled.length > 0 && filled.every((l) => /^\s*--\s?/.test(l));

    const next = lines.map((l) => {
        if (!l.trim()) return l;
        if (allCommented) return l.replace(/^(\s*)--\s?/, "$1");
        const indent = l.match(/^\s*/)[0];
        return `${indent}-- ${l.slice(indent.length)}`;
    });
    const out = next.join("\n");

    setValue(ta, v.slice(0, start) + out + v.slice(end));

    // A caret stays a caret (selecting the line would hide it behind the
    // selection band); an actual selection keeps covering the same lines.
    if (selStart === selEnd) {
        const lineIdx = v.slice(start, selStart).split("\n").length - 1;
        let shift = 0;
        for (let i = 0; i <= lineIdx; i++) shift += next[i].length - lines[i].length;
        ta.selectionStart = ta.selectionEnd = Math.max(start, selStart + shift);
    } else {
        ta.selectionStart = start;
        ta.selectionEnd = start + out.length;
    }
}

// ⌥↓ — copy the caret's line (or every line the selection touches) below it,
// leaving the caret in the same spot on the copy.
function duplicateLines(ta) {
    const v = ta.value;
    const selStart = ta.selectionStart;
    const selEnd = ta.selectionEnd;
    const start = v.lastIndexOf("\n", selStart - 1) + 1;
    let end = v.indexOf("\n", selEnd);
    if (end === -1) end = v.length;

    const block = v.slice(start, end);
    setValue(ta, v.slice(0, end) + "\n" + block + v.slice(end));

    const offset = block.length + 1;
    ta.selectionStart = selStart + offset;
    ta.selectionEnd = selEnd + offset;
}

// Our own textarea — no React underneath, so a plain assignment is enough
function setValue(ta, v) {
    ta.value = v;
    paintEditor();
    saveQuerySource(v);
}

function saveQuerySource(raw) {
    try {
        localStorage.setItem(QUERY_SRC_KEY, raw);
    } catch {}
}

// ── Syntax colouring ─────────────────────────────────────────────────────────
const escHtml = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// "string" · /regex/ · AND OR NOT TO · field: · field= · = · =~ · bare value
// after an operator · brackets · numbers · * ? ! -
const QUERY_TOKENS =
    /("(?:\\.|[^"\\])*")|(\/(?:\\.|[^/\\])*\/)|\b(AND|OR|NOT|TO)\b|([A-Za-z_@][\w.@-]*)(?=\s*(?::|=~|=))|(=~)|(=)|((?<=[:=~]\s{0,8})[^\s()"][^\s()"]*)|([(){}[\]])|(\b\d+(?:\.\d+)?\b)|([*?!]|(?<![\w"])-(?=[\w"]))/g;

function colourCode(src) {
    const th = T();
    let out = "";
    let last = 0;
    let m;
    QUERY_TOKENS.lastIndex = 0;
    while ((m = QUERY_TOKENS.exec(src))) {
        out += escHtml(src.slice(last, m.index));
        const [tok, str, re, kw, field, opRe, opEq, value, bracket, num] = m;
        let style;
        if (str) style = `color:${th.str}`;
        else if (re) style = `color:${th.num}`;
        else if (kw) style = `color:${th.border};font-weight:bold`;
        else if (field) style = `color:${th.key}`;
        else if (opRe) style = `color:${th.opRe};font-weight:bold`;
        else if (opEq) style = `color:${th.opEq};font-weight:bold`;
        else if (value) style = `color:${th.str}`; // bare value reads like "…"
        else if (bracket) style = `color:${th.hdr}`;
        else if (num) style = `color:${th.num}`;
        else style = `color:${th.bool_f};font-weight:bold`; // * ? ! -
        out += `<span style="${style}">${escHtml(tok)}</span>`;
        last = m.index + tok.length;
    }
    return out + escHtml(src.slice(last));
}

function colourQuery(text) {
    const th = T();
    return (
        text
            .split("\n")
            .map((line) => {
                const code = stripLineComment(line);
                const comment = line.slice(code.length);
                return (
                    colourCode(code) +
                    (comment
                        ? `<span style="color:${th.comment};font-style:italic;">` +
                          `${escHtml(comment)}</span>`
                        : "")
                );
            })
            .join("\n") + "\n" // trailing line keeps the last empty row visible
    );
}

function paintEditor() {
    if (!editorTA || !editorPre) return;
    editorPre.innerHTML = colourQuery(editorTA.value);
    editorPre.scrollTop = editorTA.scrollTop;
    editorPre.scrollLeft = editorTA.scrollLeft;
}

// ── Running the query ────────────────────────────────────────────────────────
function runEditorQuery() {
    if (!editorTA) return;
    const src = editorTA.value;
    const clean = compileQuerySugar(stripQueryComments(src));
    const input = queryBarEl();
    if (!input) return lfToast("Query bar not found — is this the Discover page?");

    saveQuerySource(src);
    input.focus();
    setNativeValue(input, clean);
    submitQuery(input);
    setTimeout(() => editorTA?.focus(), 500); // keep typing where you were

    const n = countCommentLines(src);
    lfToast(
        n
            ? `Ran query · ${n} comment line${n > 1 ? "s" : ""} ignored`
            : clean
                ? "Ran query"
                : "Cleared query",
    );
}

// ── Suggestions ──────────────────────────────────────────────────────────────
const SUGGEST_ID = "lf-suggest";

// Values offered inside kubernetes.container_name="…"
const CONTAINER_NAMES = [
    "adaptor-account-cdd",
    "adaptor-account-dcb-vb",
    "adaptor-application-ccd",
    "adaptor-application-channel",
    "adaptor-application-ncb",
    "adaptor-document-alfresco",
    "adaptor-document-cmlos",
    "adaptor-document-email",
    "adaptor-document-signing",
    "adaptor-document-statement",
    "batch-account-stamp-duty-export",
    "batch-application-geography",
    "batch-application-notification",
    "batch-application-occupation",
    "batch-application-update-expired",
    "core-account-accept",
    "core-account-activate-flow",
    "core-account-calc-stamp-duty",
    "core-account-deduct-fees",
    "core-account-setup-revolvingloan",
    "core-account-update-kyc",
    "core-application-appform-package",
    "core-application-ccd-master",
    "core-application-compliant-check",
    "core-application-decision",
    "core-application-dre-consume",
    "core-application-ncb-consume",
    "core-application-personal-info",
    "core-application-request-consent",
    "core-application-request-form",
    "core-application-submit-flow",
    "core-document-alfresco-consume",
    "core-document-flow",
    "core-document-follow-up",
    "core-document-generate-report-go",
    "core-document-mgmt",
    "core-document-resend-contract",
    "core-document-send-email",
    "core-document-signing",
    "core-document-statement-consume",
    "core-foundation-centralize-log",
    "core-product-master",
    "dgl-vb",
    "orch-account-accept",
    "orch-application-form-mgmt",
    "orch-application-partner",
    "orch-document-mgmt",
    "orch-document-partner",
    "orch-document-upload",
    "orch-product-management",
    "orch-schedule",
    "proc-gotenberg",
];

// The known list plus whatever containers actually show up in the loaded logs
function containerNames() {
    const set = new Set(CONTAINER_NAMES);
    cachedPayloads.forEach((p) => {
        const n = p?.kubernetes?.container_name;
        if (n) set.add(String(n));
    });
    return [...set].sort();
}

// field → the values worth suggesting after its operator
const VALUE_SUGGESTIONS = {
    "kubernetes.container_name": containerNames,
};

const FIELD_SUGGESTIONS = [
    "kubernetes",
    "kubernetes.container_name",
    "json_payload",
    "json_payload.loan_app_id",
    "json_payload.tag",
    "json_payload.msg",
    "json_payload.trace_id",
    "json_payload.span_id",
    "json_payload.wf_traceparent",
    "json_payload.level",
];

let sugItems = [];
let sugIndex = 0;
let sugStart = 0; // where the word being completed begins
let sugQuoted = false; // completing a value inside an opening quote
let sugTokenRe = /[\w.@-]/; // what still counts as part of that word

const suggestOpen = () => sugItems.length > 0;

// What is being typed right before the caret: a field name, or a value for a
// field we know the values of.
function contextAtCaret() {
    const v = editorTA.value;
    const pos = editorTA.selectionStart;
    if (pos !== editorTA.selectionEnd) return null;

    const lineStart = v.lastIndexOf("\n", pos - 1) + 1;
    const upto = v.slice(lineStart, pos);
    if (stripLineComment(upto).length < upto.length) return null; // in a comment

    // value:  kubernetes.container_name="core-|
    const val = upto.match(/([A-Za-z_@][\w.@-]*)\s*(?::|=~|=)\s*(")?([^"\s()]*)$/);
    if (val && VALUE_SUGGESTIONS[val[1]]) {
        return {
            word: val[3],
            start: pos - val[3].length,
            quoted: Boolean(val[2]),
            items: VALUE_SUGGESTIONS[val[1]](),
            tokenRe: /[^"\s()]/,
            keepEmpty: true, // an empty value still lists everything
        };
    }

    // field:  json_pay|      — but never inside a "quoted string"
    if ((upto.match(/(^|[^\\])"/g) || []).length % 2) return null;
    const m = upto.match(/[A-Za-z_@][\w.@-]*$/);
    if (!m) return null;
    return {
        word: m[0],
        start: lineStart + m.index,
        quoted: false,
        items: FIELD_SUGGESTIONS,
        tokenRe: /[\w.@-]/,
    };
}

// Caret position on screen, measured with a hidden copy of the text
function caretPoint() {
    if (!editorMirror) return null;
    editorMirror.textContent = editorTA.value.slice(0, editorTA.selectionStart);
    const marker = document.createElement("span");
    marker.textContent = "​";
    editorMirror.appendChild(marker);
    editorMirror.scrollTop = editorTA.scrollTop;
    return marker.getBoundingClientRect();
}

function hideSuggest() {
    sugItems = [];
    document.getElementById(SUGGEST_ID)?.remove();
}

function updateSuggest() {
    if (!editorTA) return;
    const at = contextAtCaret();
    if (!at || (!at.word && !at.keepEmpty)) return hideSuggest();

    const q = at.word.toLowerCase();
    const starts = at.items.filter((f) => f.toLowerCase().startsWith(q));
    const rest = at.items.filter(
        (f) => !f.toLowerCase().startsWith(q) && f.toLowerCase().includes(q),
    );
    const matches = [...starts, ...rest];
    // A single exact match is already typed out — nothing left to suggest
    if (!matches.length || (matches.length === 1 && matches[0].toLowerCase() === q))
        return hideSuggest();

    sugItems = matches;
    sugIndex = 0;
    sugStart = at.start;
    sugQuoted = at.quoted;
    sugTokenRe = at.tokenRe;
    renderSuggest();
}

function renderSuggest() {
    const th = T();
    const point = caretPoint();
    if (!point) return hideSuggest();

    let box = document.getElementById(SUGGEST_ID);
    if (!box) {
        box = document.createElement("div");
        box.id = SUGGEST_ID;
        document.body.appendChild(box);
    }
    box.textContent = "";
    box.style.cssText =
        "position:fixed;z-index:2147483647;max-height:190px;overflow-y:auto;" +
        `background:${th.bg};color:${th.fg};border:1px solid ${th.border};` +
        "border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,0.3);padding:3px;" +
        "font-family:'Fira Code',Consolas,monospace;font-size:12px;min-width:210px;";

    sugItems.forEach((field, i) => {
        const row = el(
            "div",
            "padding:4px 8px;border-radius:4px;cursor:pointer;white-space:nowrap;" +
                (i === sugIndex
                    ? `background-color:${th.selBg};color:${th.key};`
                    : `color:${th.fg};`),
            field,
        );
        row.addEventListener("mouseenter", () => {
            sugIndex = i;
            renderSuggest();
        });
        // mousedown, not click — the textarea must not lose focus first
        row.addEventListener("mousedown", (e) => {
            e.preventDefault();
            acceptSuggest();
        });
        box.appendChild(row);
        if (i === sugIndex)
            setTimeout(() => row.scrollIntoView?.({ block: "nearest" }), 0);
    });

    const w = box.offsetWidth;
    const left = Math.min(point.left, window.innerWidth - w - 8);
    const below = point.bottom + 2;
    const fitsBelow = below + box.offsetHeight < window.innerHeight - 8;
    box.style.left = Math.max(8, left) + "px";
    box.style.top = (fitsBelow ? below : point.top - box.offsetHeight - 2) + "px";
}

function moveSuggest(delta) {
    sugIndex = (sugIndex + delta + sugItems.length) % sugItems.length;
    renderSuggest();
}

function acceptSuggest() {
    let text = sugItems[sugIndex];
    const v = editorTA.value;
    hideSuggest();

    // Replace the whole word/value the caret sits in, not just the part before
    // it, so completing from the middle of one doesn't leave its tail behind.
    let end = editorTA.selectionStart;
    while (end < v.length && sugTokenRe.test(v[end])) end++;

    // Close the quote we were typing inside, unless one is already there
    if (sugQuoted && v[end] !== '"') text += '"';
    setValue(editorTA, v.slice(0, sugStart) + text + v.slice(end));
    const caret = sugStart + text.length;
    editorTA.selectionStart = editorTA.selectionEnd = caret;
    editorTA.focus();
    // No re-open here: typing "." brings the subfields up, and Enter stays a
    // newline right after you accepted something.
}

// ⌘↵ / Ctrl+↵ runs the editor's query from anywhere on the page — except from
// inside the editor (it handles its own) or OpenSearch's query bar (that one
// submits itself).
document.addEventListener(
    "keydown",
    (e) => {
        if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
        if (!editorBox?.isConnected) return;
        if (editorBox.contains(e.target) || e.target === queryBarEl()) return;
        e.preventDefault();
        runEditorQuery();
    },
    true,
);

// ── Editor DOM ───────────────────────────────────────────────────────────────
function installEditorStyle() {
    const th = T();
    document.getElementById(EDITOR_STYLE_ID)?.remove();
    const s = document.createElement("style");
    s.id = EDITOR_STYLE_ID;
    // The textarea's own glyphs are hidden so the coloured layer shows through;
    // the caret and the selection band stay visible.
    s.textContent = `
    #${EDITOR_ID} textarea {
      color: transparent;
      -webkit-text-fill-color: transparent;
      caret-color: ${th.fg};
    }
    #${EDITOR_ID} textarea::selection { background: ${th.selBg}; }
    #${EDITOR_ID} textarea::-moz-selection { background: ${th.selBg}; }
    #${EDITOR_ID} textarea::placeholder {
      color: ${th.empty};
      -webkit-text-fill-color: ${th.empty};
    }
  `;
    document.head.appendChild(s);
}

function setEditorHeight(px) {
    editorHeight = Math.min(600, Math.max(60, Math.round(px)));
    try {
        localStorage.setItem(EDITOR_H_KEY, String(editorHeight));
    } catch {}
    const wrap = document.getElementById(EDITOR_ID)?.querySelector(".lf-ed-wrap");
    if (wrap) wrap.style.height = editorHeight + "px";
}

function editorButton(text, title, primary = false) {
    const th = T();
    const b = el(
        "button",
        "font-family:inherit;font-size:11px;padding:4px 9px;border-radius:5px;" +
            "cursor:pointer;white-space:nowrap;" +
            (primary
                ? `background:${th.border};color:${th.bg};border:1px solid ${th.border};`
                : `background:${th.jsonBg};color:${th.fg};border:1px solid ${th.jsonBord};`),
        text,
    );
    b.title = title;
    b.type = "button";
    return b;
}

function buildEditor() {
    const th = T();
    installEditorStyle();

    const box = el(
        "div",
        `margin:6px 0;border:1px solid ${th.border};border-radius:8px;` +
            `background:${th.jsonBg};color:${th.fg};overflow:hidden;` +
            "font-family:'Fira Code',Consolas,monospace;font-size:13px;",
    );
    box.id = EDITOR_ID;

    // ── Toolbar ──────────────────────────────────────────────────────────────
    const bar = el(
        "div",
        "display:flex;align-items:center;gap:6px;padding:5px 8px;" +
            `background:${th.bg};border-bottom:1px solid ${th.sep};`,
    );
    bar.appendChild(
        el("span", `color:${th.hdr};font-size:10px;letter-spacing:0.4px;flex:1;`, "QUERY EDITOR"),
    );

    const runBtn = editorButton("▶ Run", "Run the query (⌘↵ / Ctrl+↵)", true);
    runBtn.addEventListener("click", runEditorQuery);

    const cmtBtn = editorButton("// Comment", "Comment or uncomment the selected lines (⌘/)");
    cmtBtn.addEventListener("click", () => {
        editorTA.focus();
        toggleLineComment(editorTA);
    });

    const pullBtn = editorButton("⇩ Pull", "Copy the query that is currently applied into the editor");
    pullBtn.addEventListener("click", () => {
        const input = queryBarEl();
        if (!input) return;
        setValue(editorTA, input.value || "");
        editorTA.focus();
    });

    const clrBtn = editorButton("✕", "Clear the editor");
    clrBtn.addEventListener("click", () => {
        setValue(editorTA, "");
        editorTA.focus();
    });

    [runBtn, cmtBtn, pullBtn, clrBtn].forEach((b) => bar.appendChild(b));
    box.appendChild(bar);

    // ── Code area: colour layer + transparent textarea on top ────────────────
    const wrap = el("div", `position:relative;height:${editorHeight}px;`);
    wrap.className = "lf-ed-wrap";

    const metrics =
        "margin:0;padding:8px 11px;border:0;box-sizing:border-box;" +
        "width:100%;height:100%;font:inherit;line-height:1.6;" +
        "white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;" +
        "tab-size:2;overflow:auto;";

    editorMirror = el(
        "div",
        `position:absolute;inset:0;z-index:0;visibility:hidden;pointer-events:none;${metrics}`,
    );
    editorPre = el("pre", `position:absolute;inset:0;z-index:1;pointer-events:none;background:transparent;${metrics}`);
    editorTA = document.createElement("textarea");
    editorTA.spellcheck = false;
    editorTA.placeholder =
        'json_payload.level:"ERROR"\n-- notes go after --, // or #';
    editorTA.style.cssText =
        `position:absolute;inset:0;z-index:2;resize:none;background:transparent;` +
        `outline:none;${metrics}`;

    editorTA.addEventListener("input", () => {
        paintEditor();
        saveQuerySource(editorTA.value);
        updateSuggest();
    });
    editorTA.addEventListener("scroll", () => {
        editorPre.scrollTop = editorTA.scrollTop;
        editorPre.scrollLeft = editorTA.scrollLeft;
        hideSuggest();
    });
    editorTA.addEventListener("click", updateSuggest);
    editorTA.addEventListener("blur", () => setTimeout(hideSuggest, 120));
    // Moving the caret out of a word closes the list (the popup owns ↑↓ itself)
    editorTA.addEventListener("keyup", (e) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            updateSuggest();
    });

    // Arrow keys, Home/End, Enter — all native here. Only these are ours.
    editorTA.addEventListener("keydown", (e) => {
        e.stopPropagation(); // never let the page's shortcuts see them

        // While the suggestion list is up it takes ↑ ↓ Tab Enter Esc
        if (suggestOpen() && !e.metaKey && !e.ctrlKey && !e.altKey) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                return moveSuggest(e.key === "ArrowDown" ? 1 : -1);
            }
            if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                return acceptSuggest();
            }
            if (e.key === "Escape") {
                e.preventDefault();
                return hideSuggest();
            }
        }

        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            runEditorQuery();
        } else if (e.key === "/" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            toggleLineComment(editorTA);
        } else if (e.key === "ArrowDown" && e.altKey) {
            e.preventDefault();
            duplicateLines(editorTA);
        } else if (e.key === "Tab") {
            e.preventDefault();
            const { selectionStart: s, selectionEnd: t, value } = editorTA;
            setValue(editorTA, value.slice(0, s) + "  " + value.slice(t));
            editorTA.selectionStart = editorTA.selectionEnd = s + 2;
        }
    });

    wrap.appendChild(editorMirror);
    wrap.appendChild(editorPre);
    wrap.appendChild(editorTA);
    box.appendChild(wrap);

    // ── Resize grip + hint ───────────────────────────────────────────────────
    const foot = el(
        "div",
        "display:flex;align-items:center;gap:8px;padding:3px 8px 4px;" +
            `background:${th.bg};border-top:1px solid ${th.sep};cursor:row-resize;` +
            `color:${th.hdr};font-size:10px;`,
    );
    foot.appendChild(
        el(
            "span",
            "flex:1;",
            '⌘↵ run · ⌘/ comment · ⌥↓ copy line · f="v" → f:"v" · f=~"v" → f:/.*v.*/ · comments: -- // #',
        ),
    );
    foot.appendChild(el("span", "letter-spacing:2px;", "⋯"));
    foot.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const startY = e.clientY;
        const startH = editorHeight;
        const onMove = (ev) => setEditorHeight(startH + ev.clientY - startY);
        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });
    box.appendChild(foot);

    // Restore the last annotated query, or seed from what's applied right now
    let src = "";
    try {
        src = localStorage.getItem(QUERY_SRC_KEY) || "";
    } catch {}
    editorTA.value = src || queryBarEl()?.value || "";
    paintEditor();

    return box;
}

// The row that holds OpenSearch's query bar — we sit right underneath it
function queryBarRow() {
    const input = queryBarEl();
    if (!input) return null;
    return (
        input.closest("form") ||
        input.closest(".osdQueryBar") ||
        input.closest(".kbnQueryBar") ||
        input.parentElement?.parentElement?.parentElement ||
        null
    );
}

// OpenSearch re-renders around the query bar on navigation, so the editor is
// re-seated (moved, not rebuilt — it keeps its text and listeners) every tick.
function mountEditor() {
    const row = queryBarRow();
    if (!row || !row.parentElement) return;
    if (!editorBox) editorBox = buildEditor();
    if (editorBox.previousElementSibling === row) return;
    row.parentElement.insertBefore(editorBox, row.nextSibling);
}

// Rebuilt on a theme change so every colour follows
function rebuildEditor() {
    if (!editorBox) return;
    const text = editorTA.value;
    editorBox.remove();
    editorBox = buildEditor();
    editorTA.value = text;
    paintEditor();
    mountEditor();
}

// ── Histogram toggle ──────────────────────────────────────────────────────────
// The count-per-hour chart eats most of the screen; this collapses it and
// remembers the choice.
const CHART_BTN_ID = "lf-chart-toggle";
const CHART_HIDDEN_KEY = "lf_chart_hidden";

let chartHidden = false;
try {
    chartHidden = localStorage.getItem(CHART_HIDDEN_KEY) === "1";
} catch {}

const CHART_SELECTORS = [
    '[data-test-subj="discoverChart"]',
    ".dscTimechart",
    ".dscChart",
    ".dscCanvas__chart",
    ".dscHistogram",
];

function findChart() {
    const direct = findElement(CHART_SELECTORS);
    if (direct) return direct;
    // Unknown OpenSearch build: climb from the rendered chart to its container
    const inner = document.querySelector(".echChart, .visChart, .visWrapper");
    return inner ? inner.closest("[class*='hart']") || inner.parentElement : null;
}

// The "Aug 1 … - Aug 3 … per [Auto]" strip that sits above the chart — it
// belongs to the chart, so it collapses with it.
function chartHeader(chart) {
    let row = chart?.previousElementSibling;
    if (row?.id === CHART_BTN_ID) row = row.previousElementSibling; // our button
    if (!row || row.querySelector("table,tbody")) return null;
    const looksLikeHeader =
        row.querySelector("select") || /\sper\s/.test(row.textContent || "");
    return looksLikeHeader ? row : null;
}

function applyChartHidden(chart) {
    chart = chart || findChart();
    if (chart) {
        chart.style.display = chartHidden ? "none" : "";
        const header = chartHeader(chart);
        if (header) header.style.display = chartHidden ? "none" : "";
    }
    const btn = document.getElementById(CHART_BTN_ID);
    if (btn) btn.textContent = chartHidden ? "▸ Show chart" : "▾ Hide chart";
}

// ── Filter bar ────────────────────────────────────────────────────────────────
// The "▽ ⊕ Add filter" strip — everything this extension does goes through the
// query string, so it is hidden by default (panel checkbox brings it back).
const CHROME_STYLE_ID = "lf-chrome-style";
const FILTER_BAR_KEY = "lf_filterbar_hidden";

let filterBarHidden = true;
try {
    filterBarHidden = localStorage.getItem(FILTER_BAR_KEY) !== "0";
} catch {}

function applyFilterBarHidden() {
    document.getElementById(CHROME_STYLE_ID)?.remove();
    if (!filterBarHidden) return;
    const style = document.createElement("style");
    style.id = CHROME_STYLE_ID;
    style.textContent = `
    .globalFilterGroup__wrapper,
    [data-test-subj="globalFilterBar"],
    .globalFilterBar { display: none !important; }
  `;
    document.head.appendChild(style);
}

function setFilterBarHidden(on) {
    filterBarHidden = on;
    try {
        localStorage.setItem(FILTER_BAR_KEY, on ? "1" : "0");
    } catch {}
    applyFilterBarHidden();
}

// ── Left sidebar ──────────────────────────────────────────────────────────────
// Collapsed on load and on every query/navigation change, so the log table gets
// the whole width.
const SIDEBAR_TOGGLE =
    '[data-test-subj="dscSideBarCollapse"],[data-test-subj="discoverSidebarCollapse"],' +
    '.euiResizableToggleButton,button[aria-label*="ollapse"],button[title*="ollapse"]';
const SIDEBAR_KEY = "lf_collapse_sidebar";

let collapseSidebarOn = true;
try {
    collapseSidebarOn = localStorage.getItem(SIDEBAR_KEY) !== "0";
} catch {}
let lastCollapse = 0;

function collapseSidebar() {
    for (const b of document.querySelectorAll(SIDEBAR_TOGGLE)) {
        // Only the control on the left edge — never some unrelated "collapse"
        if (b.getBoundingClientRect().left > 300) continue;
        if (b.getAttribute("aria-expanded") === "false") continue;
        const label = `${b.getAttribute("aria-label") || ""} ${b.title || ""}`.toLowerCase();
        if (label.includes("expand") || label.includes("show")) continue; // would open it
        b.click();
        lastCollapse = Date.now();
        return true;
    }
    return false;
}

// Retries while Discover is still rendering its sidebar
async function autoCollapseSidebar() {
    if (!collapseSidebarOn) return;
    if (Date.now() - lastCollapse < 10000) return; // don't fight a manual re-open
    await waitFor(collapseSidebar, 8000, 400);
}

function setCollapseSidebar(on) {
    collapseSidebarOn = on;
    try {
        localStorage.setItem(SIDEBAR_KEY, on ? "1" : "0");
    } catch {}
    if (on) {
        lastCollapse = 0;
        autoCollapseSidebar();
    }
}

function mountChartToggle() {
    const chart = findChart();
    if (!chart || !chart.parentElement) return;

    let btn = document.getElementById(CHART_BTN_ID);
    if (!btn) {
        const th = T();
        btn = el(
            "button",
            "margin:4px 0;padding:3px 9px;border-radius:5px;cursor:pointer;" +
                `background:${th.jsonBg};color:${th.fg};border:1px solid ${th.jsonBord};` +
                "font-family:'Fira Code',Consolas,monospace;font-size:11px;",
        );
        btn.id = CHART_BTN_ID;
        btn.type = "button";
        btn.title = "Collapse the count-per-hour histogram";
        btn.addEventListener("click", () => {
            chartHidden = !chartHidden;
            try {
                localStorage.setItem(CHART_HIDDEN_KEY, chartHidden ? "1" : "0");
            } catch {}
            applyChartHidden();
        });
    }
    if (btn.nextElementSibling !== chart)
        chart.parentElement.insertBefore(btn, chart);
    applyChartHidden(chart);
}

function watchQueryBar() {
    const tick = () => {
        mountEditor();
        mountChartToggle();
        // Re-inject only if the page dropped our stylesheet
        if (filterBarHidden && !document.getElementById(CHROME_STYLE_ID))
            applyFilterBarHidden();
    };
    tick();
    setInterval(tick, 1000);
    autoCollapseSidebar();
}

// Every query / time-range / navigation change re-collapses the sidebar
window.addEventListener("message", (e) => {
    if (e.source === window && e.data?.type === "__LF_NAV__") autoCollapseSidebar();
});

// ── In-page extractor panel ───────────────────────────────────────────────────
const PANEL_ID = "lf-panel";
const LAUNCH_ID = "lf-launcher";
const PANEL_OPEN_KEY = "lf_panel_open";

const PANEL_PRESETS = {
    dev: [
        "coalesce(time, timestamp)",
        "level",
        "coalesce(msg, message)",
        "loan_app_id",
        "trace_id",
        "span_id",
        "request_header.Wf-traceparent",
    ],
};

let panelFields = [];
let panelSearch = "";
let panelColsHidden = false;
let chipsBox = null;
let listBox = null;
let panelDragIndex = null;

function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
}

// Every field path present in the loaded logs — from the intercepted search
// response when we have it, otherwise from the json_payload cells on screen.
function discoverFields() {
    const paths = new Set();
    const walk = (obj, prefix, depth) => {
        if (!obj || typeof obj !== "object" || depth > 3) return;
        for (const [k, v] of Object.entries(obj)) {
            const p = prefix ? `${prefix}.${k}` : k;
            paths.add(p);
            if (v && typeof v === "object" && !Array.isArray(v))
                walk(v, p, depth + 1);
        }
    };

    cachedPayloads.slice(0, 40).forEach((p) => {
        if (p && typeof p === "object") walk(p, "", 1);
    });

    if (!paths.size) {
        let seen = 0;
        for (const cell of collectCandidateCells()) {
            if (seen >= 10) break;
            const raw = (cell.textContent || "").trim();
            const start = raw.indexOf("{");
            if (start < 0) continue;
            const parsed = tryParseJson(raw.slice(start));
            if (!parsed) continue;
            walk(parsed, "", 1);
            seen++;
        }
    }
    return [...paths].sort();
}

// A spec's display label — coalesce(a, b) is "checked" by its first field
function specLabel(spec) {
    const p = parseSpec(spec);
    return p.type === "coalesce" ? p.fields[0] : p.field;
}

function persistFields() {
    try {
        chrome.storage?.local?.set({ extractFields: panelFields });
    } catch {}
}

// Field set changed → save, re-render the panel, and refresh the table when
// extraction is already running.
function setPanelFields(fields, { rerender = true } = {}) {
    panelFields = fields;
    persistFields();
    if (rerender) {
        renderChips();
        renderList();
    }
    if (activeFields.length) {
        activeFields = fields.slice();
        purgeOverlays();
        processTableRows(activeFields);
    }
}

function toggleField(path, on) {
    if (on) {
        if (!panelFields.some((s) => specLabel(s) === path))
            setPanelFields([...panelFields, path]);
    } else {
        setPanelFields(panelFields.filter((s) => specLabel(s) !== path));
    }
}

function renderChips() {
    if (!chipsBox) return;
    const th = T();
    chipsBox.textContent = "";
    if (!panelFields.length) {
        chipsBox.appendChild(
            el("span", `color:${th.empty};font-style:italic;`, "No columns yet — tick a field below"),
        );
        return;
    }

    panelFields.forEach((spec, i) => {
        const chip = el(
            "span",
            `display:inline-flex;align-items:center;gap:5px;margin:0 4px 4px 0;` +
                `padding:3px 6px;border-radius:5px;cursor:grab;` +
                `background:${th.jsonBg};border:1px solid ${th.jsonBord};color:${th.fg};`,
        );
        chip.draggable = true;
        chip.title = `${spec} · drag to reorder`;
        chip.appendChild(el("span", "pointer-events:none;", spec));

        const rm = el("span", `cursor:pointer;color:${th.hdr};font-weight:bold;`, "×");
        rm.addEventListener("click", () =>
            setPanelFields(panelFields.filter((_, j) => j !== i)),
        );
        chip.appendChild(rm);

        chip.addEventListener("dragstart", (e) => {
            panelDragIndex = i;
            e.dataTransfer.effectAllowed = "move";
            chip.style.opacity = "0.4";
        });
        chip.addEventListener("dragend", () => {
            panelDragIndex = null;
            chip.style.opacity = "";
        });
        chip.addEventListener("dragover", (e) => {
            if (panelDragIndex === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
        });
        chip.addEventListener("drop", (e) => {
            if (panelDragIndex === null) return;
            e.preventDefault();
            const rect = chip.getBoundingClientRect();
            let to = e.clientX > rect.left + rect.width / 2 ? i + 1 : i;
            const from = panelDragIndex;
            if (from < to) to -= 1;
            if (from === to) return;
            const f = panelFields.slice();
            const [moved] = f.splice(from, 1);
            f.splice(to, 0, moved);
            setPanelFields(f);
        });

        chipsBox.appendChild(chip);
    });
}

function renderList() {
    if (!listBox) return;
    const th = T();
    const q = panelSearch.trim().toLowerCase();
    const fields = discoverFields().filter((f) => !q || f.toLowerCase().includes(q));

    listBox.textContent = "";
    if (!fields.length) {
        listBox.appendChild(
            el(
                "div",
                `color:${th.empty};font-style:italic;padding:6px;`,
                cachedPayloads.length || document.querySelector("tbody tr")
                    ? "No field matches"
                    : "Waiting for log data…",
            ),
        );
        return;
    }

    fields.forEach((path) => {
        const row = el(
            "label",
            "display:flex;align-items:center;gap:7px;padding:3px 6px;" +
                `border-radius:4px;cursor:pointer;color:${th.fg};`,
        );
        row.addEventListener("mouseenter", () => (row.style.background = th.jsonBg));
        row.addEventListener("mouseleave", () => (row.style.background = "transparent"));

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = panelFields.some((s) => specLabel(s) === path);
        cb.addEventListener("change", () => toggleField(path, cb.checked));

        row.appendChild(cb);
        row.appendChild(
            el("span", "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;", path),
        );
        row.title = path;
        listBox.appendChild(row);
    });
}

function panelButton(text, primary = false) {
    const th = T();
    const b = el(
        "button",
        "font-family:inherit;font-size:11px;padding:6px 9px;border-radius:5px;" +
            "cursor:pointer;flex:1;white-space:nowrap;" +
            (primary
                ? `background:${th.border};color:${th.bg};border:1px solid ${th.border};`
                : `background:${th.jsonBg};color:${th.fg};border:1px solid ${th.jsonBord};`),
        text,
    );
    return b;
}

function openPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const th = T();

    const panel = el(
        "div",
        "position:fixed;right:20px;bottom:64px;width:340px;max-height:72vh;" +
            "z-index:2147483646;display:flex;flex-direction:column;" +
            `background:${th.bg};color:${th.fg};border:1px solid ${th.border};` +
            "border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,0.35);" +
            "font-family:'Fira Code',Consolas,monospace;font-size:12px;overflow:hidden;",
    );
    panel.id = PANEL_ID;

    // ── Header (drag to move) ────────────────────────────────────────────────
    const head = el(
        "div",
        "display:flex;align-items:center;gap:8px;padding:9px 11px;cursor:move;" +
            `background:${th.jsonBg};border-bottom:1px solid ${th.sep};`,
    );
    head.appendChild(el("span", "flex:1;font-weight:bold;", "⌗ JSON Field Extractor"));

    const themeSel = document.createElement("select");
    themeSel.style.cssText =
        `font-family:inherit;font-size:11px;background:${th.bg};color:${th.fg};` +
        `border:1px solid ${th.jsonBord};border-radius:4px;padding:2px;`;
    [["light", "☀"], ["dark", "🌙"]].forEach(([v, t]) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = t;
        themeSel.appendChild(o);
    });
    themeSel.value = activeTheme;
    themeSel.addEventListener("change", () => {
        try {
            chrome.storage?.local?.set({ theme: themeSel.value });
        } catch {}
        setTheme(themeSel.value);
    });
    head.appendChild(themeSel);

    const close = el("span", `cursor:pointer;color:${th.hdr};font-size:14px;`, "×");
    close.title = "Close";
    close.addEventListener("click", () => {
        closePanel();
        try {
            localStorage.setItem(PANEL_OPEN_KEY, "0");
        } catch {}
    });
    head.appendChild(close);

    head.addEventListener("mousedown", (e) => {
        if (e.target === close || e.target === themeSel) return;
        e.preventDefault();
        const rect = panel.getBoundingClientRect();
        const dx = e.clientX - rect.left;
        const dy = e.clientY - rect.top;
        const onMove = (ev) => {
            panel.style.left = ev.clientX - dx + "px";
            panel.style.top = ev.clientY - dy + "px";
            panel.style.right = "auto";
            panel.style.bottom = "auto";
        };
        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });
    panel.appendChild(head);

    // ── Body ─────────────────────────────────────────────────────────────────
    const body = el(
        "div",
        "padding:10px 11px;overflow-y:auto;min-height:0;" +
            "display:flex;flex-direction:column;gap:8px;",
    );

    body.appendChild(el("div", `color:${th.hdr};font-size:10px;letter-spacing:0.4px;`, "COLUMNS (drag to reorder)"));
    chipsBox = el("div", "display:flex;flex-wrap:wrap;");
    body.appendChild(chipsBox);

    // Preset + custom spec
    const specRow = el("div", "display:flex;gap:6px;");
    const preset = document.createElement("select");
    preset.style.cssText =
        `flex:1;font-family:inherit;font-size:11px;background:${th.bg};color:${th.fg};` +
        `border:1px solid ${th.jsonBord};border-radius:5px;padding:5px;`;
    [["", "— preset —"], ["dev", "dev preset"]].forEach(([v, t]) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = t;
        preset.appendChild(o);
    });
    preset.addEventListener("change", () => {
        const f = PANEL_PRESETS[preset.value];
        preset.value = "";
        if (f) setPanelFields(f.slice());
    });
    specRow.appendChild(preset);
    body.appendChild(specRow);

    const customInput = document.createElement("input");
    customInput.placeholder = "custom spec — e.g. coalesce(msg, message) ↵";
    customInput.style.cssText =
        `width:100%;box-sizing:border-box;font-family:inherit;font-size:11px;padding:5px 7px;` +
        `background:${th.bg};color:${th.fg};border:1px solid ${th.jsonBord};border-radius:5px;`;
    customInput.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        const v = customInput.value.trim();
        if (!v || panelFields.includes(v)) return;
        customInput.value = "";
        setPanelFields([...panelFields, v]);
    });
    body.appendChild(customInput);

    // Field selector
    const listHead = el("div", "display:flex;align-items:center;gap:6px;");
    listHead.appendChild(
        el("span", `color:${th.hdr};font-size:10px;letter-spacing:0.4px;flex:1;`, "FIELDS IN THESE LOGS"),
    );
    const refresh = el("span", `cursor:pointer;color:${th.toggle};`, "⟳");
    refresh.title = "Rescan loaded logs";
    refresh.addEventListener("click", renderList);
    listHead.appendChild(refresh);
    body.appendChild(listHead);

    const search = document.createElement("input");
    search.placeholder = "filter fields…";
    search.value = panelSearch;
    search.style.cssText = customInput.style.cssText;
    search.addEventListener("input", () => {
        panelSearch = search.value;
        renderList();
    });
    search.addEventListener("keydown", (e) => e.stopPropagation());
    body.appendChild(search);

    listBox = el(
        "div",
        `max-height:220px;overflow-y:auto;border:1px solid ${th.sep};border-radius:5px;padding:3px;`,
    );
    body.appendChild(listBox);

    // Actions
    const row1 = el("div", "display:flex;gap:6px;");
    const applyBtn = panelButton("Apply to Table", true);
    applyBtn.addEventListener("click", async () => {
        if (!panelFields.length) return lfToast("Pick at least one field");
        const res = await applyExtract({ fields: panelFields });
        panelColsHidden = true;
        hideBtn.textContent = "👁 Show Cols";
        lfToast(
            res?.ok
                ? `Extracting ${panelFields.length} field${panelFields.length > 1 ? "s" : ""} · ${res.found ?? 0} rows`
                : res?.error || "Failed",
        );
    });
    const stopBtn = panelButton("Stop");
    stopBtn.addEventListener("click", () => {
        stopExtract();
        showColumn();
        panelColsHidden = false;
        hideBtn.textContent = "🙈 Hide Cols";
        try {
            chrome.storage?.local?.set({ extractAuto: false });
        } catch {}
        autoChk.checked = false;
        lfToast("Extraction stopped");
    });
    row1.appendChild(applyBtn);
    row1.appendChild(stopBtn);
    body.appendChild(row1);

    const row2 = el("div", "display:flex;gap:6px;align-items:center;");
    const hideBtn = panelButton("🙈 Hide Cols");
    hideBtn.addEventListener("click", () => {
        panelColsHidden = !panelColsHidden;
        if (panelColsHidden) hideColumns({});
        else showColumn();
        hideBtn.textContent = panelColsHidden ? "👁 Show Cols" : "🙈 Hide Cols";
    });
    row2.appendChild(hideBtn);

    const autoLbl = el("label", "display:flex;align-items:center;gap:5px;flex:1;cursor:pointer;");
    const autoChk = document.createElement("input");
    autoChk.type = "checkbox";
    autoChk.addEventListener("change", () => {
        try {
            chrome.storage?.local?.set({ extractAuto: autoChk.checked });
        } catch {}
        if (autoChk.checked && panelFields.length) applyBtn.click();
    });
    autoLbl.appendChild(autoChk);
    autoLbl.appendChild(el("span", "", "auto-apply"));
    row2.appendChild(autoLbl);
    body.appendChild(row2);

    // ── Query editor height ──────────────────────────────────────────────────
    const qRow = el(
        "div",
        `display:flex;gap:6px;align-items:center;border-top:1px solid ${th.sep};padding-top:8px;`,
    );
    qRow.appendChild(
        el("span", `color:${th.hdr};font-size:10px;letter-spacing:0.4px;flex:1;`, "QUERY EDITOR"),
    );
    const shorter = panelButton("▼ Shorter");
    const taller = panelButton("▲ Taller");
    shorter.addEventListener("click", () => setEditorHeight(editorHeight - 30));
    taller.addEventListener("click", () => setEditorHeight(editorHeight + 30));
    qRow.appendChild(shorter);
    qRow.appendChild(taller);
    body.appendChild(qRow);

    // ── Page chrome ──────────────────────────────────────────────────────────
    body.appendChild(
        el("div", `color:${th.hdr};font-size:10px;letter-spacing:0.4px;`, "PAGE"),
    );
    const check = (label, on, onChange) => {
        const row = el("label", "display:flex;align-items:center;gap:6px;cursor:pointer;");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = on;
        cb.addEventListener("change", () => onChange(cb.checked));
        row.appendChild(cb);
        row.appendChild(el("span", "", label));
        body.appendChild(row);
    };
    check("Hide the “Add filter” bar", filterBarHidden, setFilterBarHidden);
    check("Collapse the left sidebar", collapseSidebarOn, setCollapseSidebar);

    body.appendChild(
        el(
            "div",
            `color:${th.hdr};font-size:10px;line-height:1.6;`,
            "Write the query in the editor under the search bar · ⌘↵ runs it · ⌘/ comments the selected lines · -- // # comments are stripped before it runs",
        ),
    );

    panel.appendChild(body);
    document.body.appendChild(panel);

    // Fill from whatever the popup last saved, then paint
    readStored(["extractFields", "extractAuto"]).then((d) => {
        panelFields = activeFields.length
            ? activeFields.slice()
            : d.extractFields || [];
        autoChk.checked = Boolean(d.extractAuto);
        panelColsHidden = Boolean(document.getElementById(HIDE_STYLE_ID));
        hideBtn.textContent = panelColsHidden ? "👁 Show Cols" : "🙈 Hide Cols";
        renderChips();
        renderList();
    });
}

function closePanel() {
    document.getElementById(PANEL_ID)?.remove();
    chipsBox = null;
    listBox = null;
}

function togglePanel() {
    const open = Boolean(document.getElementById(PANEL_ID));
    if (open) closePanel();
    else openPanel();
    try {
        localStorage.setItem(PANEL_OPEN_KEY, open ? "0" : "1");
    } catch {}
}

function mountLauncher() {
    if (document.getElementById(LAUNCH_ID)) return;
    const th = T();
    const b = el(
        "button",
        "position:fixed;bottom:20px;right:20px;z-index:2147483646;" +
            "padding:9px 13px;border-radius:20px;cursor:pointer;" +
            `background:${th.bg};color:${th.fg};border:1px solid ${th.border};` +
            "box-shadow:0 4px 18px rgba(0,0,0,0.28);" +
            "font-family:'Fira Code',Consolas,monospace;font-size:12px;",
        "⌗ Fields",
    );
    b.id = LAUNCH_ID;
    b.title = "JSON field extractor";
    b.addEventListener("click", togglePanel);
    document.body.appendChild(b);
}

// Keep the panel in step with edits made from the popup
try {
    chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "local" || !changes.extractFields) return;
        if (!document.getElementById(PANEL_ID)) return;
        panelFields = changes.extractFields.newValue || [];
        renderChips();
        renderList();
    });
} catch {}

// New search results → the discovered field list may have changed
window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.type !== "__LF_HITS__") return;
    if (document.getElementById(PANEL_ID)) setTimeout(renderList, 450);
});

// ── Page UI bootstrap ─────────────────────────────────────────────────────────
// The content script runs everywhere; the query bar is what makes this Discover.
(async function initPageUI() {
    const ta = await waitFor(() => findElement(SELECTORS.queryInput), 20000, 400);
    if (!ta) return;
    watchQueryBar();
    mountLauncher();
    let open = "0";
    try {
        open = localStorage.getItem(PANEL_OPEN_KEY) || "0";
    } catch {}
    if (open === "1") openPanel();
})();

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
        switch (msg.action) {
            case "expandAll":
                sendResponse(expandAll());
                break;
            case "addFilter":
                sendResponse(addFilter(msg));
                break;
            case "addMultiFilter":
                sendResponse(addMultiFilter(msg));
                break;
            case "removeFilter":
                sendResponse(removeFilter(msg));
                break;
            case "clearFilters":
                sendResponse(clearFilters());
                break;
            case "extractFields":
                sendResponse(startExtract(msg.fields));
                break;
            case "applyExtract":
                applyExtract(msg).then(sendResponse);
                break;
            case "setQueryLanguage":
                setQueryLanguage(msg).then(sendResponse);
                break;
            case "selectFields":
                selectFields(msg).then(sendResponse);
                break;
            case "stopExtract":
                sendResponse(stopExtract());
                break;
            case "hideColumns":
                sendResponse(hideColumns(msg));
                break;
            case "showColumn":
                sendResponse(showColumn());
                break;
            case "setTheme":
                sendResponse(setTheme(msg.theme));
                break;
            default:
                sendResponse({ ok: false, error: "Unknown action" });
        }
    } catch (e) {
        sendResponse({ ok: false, error: e.message });
    }
    return true;
});
