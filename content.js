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

// ── Is this actually OpenSearch Dashboards? ───────────────────────────────────
// The loose query-bar selectors above match a search box on half the web, so
// nothing is injected until one of these OpenSearch-only markers shows up.
const OSD_MARKERS = [
    '[data-test-subj="queryInput"]',
    '[data-test-subj="globalQueryBar"]',
    '[data-test-subj="discoverChart"]',
    ".osdQueryBar",
    ".kbnQueryBar",
    "#opensearch-dashboards-body",
    "#osdAppWrapper",
    ".dscCanvas",
    ".dscTimechart",
].join(",");

function isOpenSearchPage() {
    return (
        Boolean(document.querySelector(OSD_MARKERS)) ||
        /opensearch dashboards|kibana/i.test(document.title || "")
    );
}

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
        el.classList.add("lf-ui");
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

// Set on objects that only parsed once we closed the JSON ourselves: the text
// was cut off, so whatever sat at the cut came through short. A Symbol so it
// stays out of Object.entries, JSON.stringify, and the field walkers.
const JSON_REPAIRED = Symbol("lf-json-repaired");

// Full JSON parse with truncated-JSON fallbacks
function tryParseJson(text) {
    const s = text.trim();
    if (!s.startsWith("{")) return null;
    try {
        return JSON.parse(s);
    } catch {}
    for (const sfx of ['"}', '"}}', '"}}}', "}}", "}}}", "}}}}"]) {
        try {
            const obj = JSON.parse(s + sfx);
            if (obj && typeof obj === "object")
                Object.defineProperty(obj, JSON_REPAIRED, { value: true });
            return obj;
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

// ── Click-to-filter ──────────────────────────────────────────────────────────
// The value under the cursor is nearly always the next thing you want to filter
// on, so every overlay cell carries filter-for / filter-out / copy.

// Inside a Lucene phrase only \ and " need escaping
function luceneQuote(value) {
    return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Words seen in the table headers, refreshed once per extraction pass — this
// runs for every rendered cell, so it must not touch the DOM per call.
let headerWords = new Set();
const fieldQueryCache = new Map();

function refreshHeaderWords(headers) {
    headerWords = new Set();
    (headers || getHeaderCells()).forEach((h) =>
        (h.textContent || "")
            .trim()
            .split(/\s+/)
            .forEach((w) => w && headerWords.add(w)),
    );
    fieldQueryCache.clear();
}

// Overlay columns are named by their path *inside* json_payload, but a query
// needs the real index field. A table column of exactly that name wins: those
// are top-level _source fields (level, kubernetes.container_name) that live
// outside json_payload.
function queryFieldFor(path) {
    const hit = fieldQueryCache.get(path);
    if (hit) return hit;
    if (!headerWords.size) refreshHeaderWords();

    let field;
    if (headerWords.has(path)) field = path;
    else if (headerWords.has(`json_payload.${path}`)) field = `json_payload.${path}`;
    else if (path === "kubernetes" || path.startsWith("kubernetes."))
        field = path;
    else field = `json_payload.${path}`;

    fieldQueryCache.set(path, field);
    return field;
}

// What the editor would run right now
function editorClean() {
    if (!editorTA) return null;
    return glueUnary(
        upperBooleans(compileQuerySugar(stripQueryComments(editorTA.value))),
    );
}

// Add a clause to the running query and re-run it. The in-page editor is the
// source of truth while it still matches the bar; once the two have drifted (a
// query typed into their bar, or one restored from the URL) the bar wins and
// the editor is re-seeded from it, so the next click stays consistent.
function appendClause(clause) {
    const input = queryBarEl();
    if (!input) return lfToast("Query bar not found — is this the Discover page?");
    const bar = (input.value || "").trim();
    const clean = editorClean();

    if (editorTA && (clean || "") === bar) {
        const src = editorTA.value.replace(/\s+$/, "");
        setValue(
            editorTA,
            src ? `${src}\n${bar ? "AND " : ""}${clause}` : clause,
        );
        runEditorQuery();
        return;
    }

    const next = bar ? `${bar} AND ${clause}` : clause;
    if (editorTA) setValue(editorTA, next);
    pushQueryToBar(input, next);
    lfToast("Filter applied");
}

function filterForValue(path, value, negate) {
    const clause = `${negate ? "NOT " : ""}${queryFieldFor(path)}:${luceneQuote(value)}`;
    appendClause(clause);
}

async function copyValue(value) {
    try {
        await navigator.clipboard.writeText(String(value));
        lfToast("Copied");
    } catch {
        lfToast("Copy failed");
    }
}

// ── Trace pivot ──────────────────────────────────────────────────────────────
// "Show me this whole request." One click drops every other filter, queries the
// correlation id across all containers, and widens the time range around the
// row — in a new tab, so the view you came from survives.

// The correlation id we actually carry is the x-request-id header. Which of
// these paths it lands on depends on the service, so try them in order.
const REQUEST_ID_PATHS = [
    "x-request-id",
    "request_header.x-request-id",
    "request_header.X-Request-Id",
    "headers.x-request-id",
];
// Weaker ids — only used when no x-request-id is on the row
const TRACE_FIELDS = ["loan_app_id", "trace_id", "span_id", "request_id"];
const TIME_FIELDS = ["time", "timestamp", "@timestamp", "ts"];
const TRACE_WINDOW_MIN = 5;

const REQUEST_ID_KEY = /^x-request-id$/i;

// Header casing and nesting vary by service, so when the known paths miss, look
// for the key itself in the first few levels of the payload.
function findRequestId(obj, prefix = "", depth = 1) {
    if (!obj || typeof obj !== "object" || depth > 3) return null;
    for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (REQUEST_ID_KEY.test(k) && v && typeof v !== "object")
            return { field: path, value: String(v) };
        const hit = findRequestId(v, path, depth + 1);
        if (hit) return hit;
    }
    return null;
}

// First of `fields` this row actually carries, from the payload or the regex
// fallback. Objects are skipped — they make no sense as a query term.
function firstValue(parsed, regexResult, fields) {
    for (const f of fields) {
        let v = parsed ? getNestedValue(parsed, f) : undefined;
        if (v === undefined || v === null || v === "") v = regexResult?.[f];
        if (v === undefined || v === null || v === "" || typeof v === "object")
            continue;
        return { field: f, value: String(v) };
    }
    return null;
}

// The row's payload as the search response gave it — whole, whatever the table
// chose to render. Rows are indexed the same way pass 2 indexes them.
function payloadForRow(row) {
    if (!row || !cachedPayloads.length) return null;
    const dataRows = [...document.querySelectorAll("tbody tr")].filter(
        (tr) => !tr.classList.contains(EXTRACT_ROW_CLASS),
    );
    const idx = dataRows.indexOf(row);
    const p = idx >= 0 ? cachedPayloads[idx] : null;
    return p && typeof p === "object" ? p : null;
}

// The id to follow: x-request-id first, wherever it sits, then the fallbacks.
function traceIdOf(parsed, regexResult) {
    return (
        firstValue(parsed, regexResult, REQUEST_ID_PATHS) ||
        findRequestId(parsed) ||
        firstValue(parsed, regexResult, TRACE_FIELDS)
    );
}

// A cell the table cut off leaves tryParseJson to close the dangling string for
// us, so the id read from the DOM can be a prefix of the real one — and a prefix
// matches nothing. An x-request-id is opaque, so a short one is indistinguishable
// from a real one by shape; the repair flag is the only way to tell. The
// intercepted response is never cut, so prefer it and mark what comes from a
// payload we know was patched up.
function traceIdForRow(parsed, regexResult, row) {
    const full = payloadForRow(row);
    const fromFull = full && traceIdOf(full, {});
    if (fromFull) return fromFull;

    const hit = traceIdOf(parsed, regexResult);
    if (!hit) return null;
    return parsed?.[JSON_REPAIRED] ? { ...hit, truncated: true } : hit;
}

// One field, one term: the id exactly as it was logged, whole.
function traceClause(hit) {
    return `${queryFieldFor(hit.field)}:${luceneQuote(hit.value.trim())}`;
}

// A ±5 min window is unforgiving: a timestamp that is merely wrong sends the
// pivot to a range with nothing in it, which looks exactly like "the query
// matched nothing". So anything outside the range logs plausibly carry is
// rejected, and we fall back to a source we trust more.
const TIME_FLOOR = Date.UTC(2000, 0, 1);
function plausibleTime(t) {
    return Number.isFinite(t) && t > TIME_FLOOR && t < Date.now() + 864e5;
}

// A payload "time" is as often an elapsed-ms number as a timestamp, and
// Date.parse reads a bare "152" as the year 151 rather than failing — so only
// 10/13-digit epochs are read as numbers, and other digit strings are refused.
function parseTimeValue(raw) {
    if (/^\d{13}$/.test(raw)) return Number(raw);
    if (/^\d{10}$/.test(raw)) return Number(raw) * 1000;
    if (/^[\d.]+$/.test(raw)) return null;
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : t;
}

// Epoch ms for the row: the payload's own timestamp, else the Time column.
function rowTime(parsed, regexResult, row) {
    const hit = firstValue(parsed, regexResult, TIME_FIELDS);
    if (hit) {
        const t = parseTimeValue(hit.value.trim());
        if (plausibleTime(t)) return t;
    }
    if (!row) return null;
    const headers = getHeaderCells();
    const idx = headers.findIndex(
        (h) => (h.textContent || "").trim().split(/\s+/)[0] === "Time",
    );
    if (idx < 0) return null;
    const cells = [
        ...row.querySelectorAll(":scope > td"),
        ...row.querySelectorAll(":scope > [role='gridcell']"),
    ];
    const text = (cells[idx]?.textContent || "").trim();
    // OpenSearch prints "Aug 6, 2026 @ 22:04:11.123" — the @ is not parseable
    const t = Date.parse(text.replace(" @ ", " "));
    return plausibleTime(t) ? t : null;
}

// Rison quotes with ! — so ! and ' are the two characters to escape
function risonEscape(s) {
    return String(s).replace(/!/g, "!!").replace(/'/g, "!'");
}

// Replace `key` … up to its matching ")" — the value may nest parens (a filter
// clause does) and may hold quoted strings, so bracket counting is the only
// way to find the end.
function replaceBalanced(s, key, replacement, from = 0) {
    const start = s.indexOf(key, from);
    if (start < 0) return { out: s, changed: false, end: -1 };

    let i = start + key.length; // just past the opening paren
    let depth = 1;
    let quoted = false;
    while (i < s.length && depth > 0) {
        const c = s[i];
        if (quoted) {
            if (c === "!") i++; // rison escape — skip what follows
            else if (c === "'") quoted = false;
        } else if (c === "'") quoted = true;
        else if (c === "(") depth++;
        else if (c === ")") depth--;
        i++;
    }
    if (depth !== 0) return { out: s, changed: false, end: -1 };
    return {
        out: s.slice(0, start) + replacement + s.slice(i),
        changed: true,
        end: start + replacement.length,
    };
}

// The Discover URL with our query, no filters, and a window around `from`/`to`.
// Data-explorer keeps the query in _q, classic Discover in _a; both put the
// time range in _g — replacing every occurrence covers either layout.
function pivotUrl(href, query, fromISO, toISO) {
    let out = href;
    let changedQuery = false;
    let changedTime = false;

    // Pinned filter badges would survive the query swap and hide the trace
    for (let at = 0; ; ) {
        const r = replaceBalanced(out, "filters:!(", "filters:!()", at);
        if (!r.changed) break;
        out = r.out;
        at = r.end;
    }

    out = out.replace(/query:'(?:!.|[^'])*'/g, () => {
        changedQuery = true;
        return `query:'${risonEscape(query)}'`;
    });

    if (fromISO && toISO) {
        const r = replaceBalanced(
            out,
            "time:(",
            `time:(from:'${fromISO}',to:'${toISO}')`,
        );
        out = r.out;
        changedTime = r.changed;
    }
    return { url: out, changedQuery, changedTime };
}

function tracePivot(parsed, regexResult, row) {
    const id = traceIdForRow(parsed, regexResult, row);
    if (!id) return lfToast("No request id on this row");
    // Say so rather than run a query that cannot match
    if (id.truncated)
        return lfToast(
            "Request id looks cut off — re-run the search so the full row is loaded",
            4000,
        );

    const query = traceClause(id);
    const at = rowTime(parsed, regexResult, row);
    const from = at
        ? new Date(at - TRACE_WINDOW_MIN * 60000).toISOString()
        : null;
    const to = at ? new Date(at + TRACE_WINDOW_MIN * 60000).toISOString() : null;

    // The hash is usually written raw, but a build that percent-encodes it
    // would not match — decode and retry before giving up.
    let res = pivotUrl(location.href, query, from, to);
    if (!res.changedQuery) {
        try {
            res = pivotUrl(decodeURIComponent(location.href), query, from, to);
        } catch {}
    }

    // No query state in the URL to rewrite — run it here instead
    if (!res.changedQuery) {
        if (!editorTA) return lfToast("Could not follow the trace from this page");
        setValue(editorTA, query);
        runEditorQuery();
        return lfToast(`Following ${id.field} in this tab · time range unchanged`);
    }

    window.open(res.url, "_blank");
    lfToast(
        `Following ${id.field} · ${
            res.changedTime ? `±${TRACE_WINDOW_MIN} min` : "time range unchanged"
        }`,
    );
}

// Shown only while the cell is hovered — a CSS rule rather than two listeners
// on every cell of every row.
const ACTS_STYLE_ID = "lf-acts-style";
const ACTS_CLASS = "lf-acts";

function installActionStyle() {
    if (document.getElementById(ACTS_STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = ACTS_STYLE_ID;
    s.textContent =
        `.${EXTRACT_CLASS} .${ACTS_CLASS}{display:none;}` +
        `.${EXTRACT_CLASS} [data-lf-field]:hover .${ACTS_CLASS}{display:flex;}`;
    document.head.appendChild(s);
}

// The hover strip on one overlay cell
function cellActions(path, value) {
    const th = T();
    const field = queryFieldFor(path);
    const shown =
        String(value).length > 40 ? `${String(value).slice(0, 40)}…` : value;

    const box = document.createElement("div");
    box.className = ACTS_CLASS;
    box.style.cssText = "position:absolute;top:1px;right:9px;gap:2px;z-index:4;";

    const mk = (text, title, run) => {
        const b = document.createElement("button");
        b.textContent = text;
        b.title = title;
        b.style.cssText =
            "font-family:inherit;font-size:10px;line-height:1;padding:2px 5px;" +
            `cursor:pointer;background:${th.bg};color:${th.fg};` +
            `border:1px solid ${th.jsonBord};border-radius:3px;`;
        // The row underneath expands on click and the header starts a drag —
        // neither should react to a press on these.
        b.addEventListener("mousedown", (e) => e.stopPropagation());
        b.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            run();
        });
        box.appendChild(b);
        return b;
    };

    mk("=", `Filter for  ${field}:"${shown}"`, () =>
        filterForValue(path, value, false),
    );
    mk("≠", `Filter out  NOT ${field}:"${shown}"`, () =>
        filterForValue(path, value, true),
    );
    mk("⧉", "Copy value", () => copyValue(value));
    return box;
}

function buildOverlay(parsed, regexResult, specs, rawJson, row) {
    const th = T();
    const wrap = document.createElement("div");
    wrap.className = `${EXTRACT_CLASS} lf-ui`;
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

        // Hover actions — only where there is a value to act on
        if (hasVal) col.appendChild(cellActions(fieldName, resolved.displayValue));

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

        // ── Follow this request across every container ───────────────────────
        const traceId = traceIdForRow(parsed, regexResult, row);
        if (traceId) {
            const traceBtn = makeMiniBtn("⇱ Trace");
            traceBtn.title =
                `Follow  ${traceClause(traceId)}\n` +
                `in a new tab — drops every other filter, ±${TRACE_WINDOW_MIN} min`;
            traceBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                tracePivot(parsed, regexResult, row);
            });
            btnGroup.appendChild(traceBtn);
        }

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
    tr.className = `${EXTRACT_ROW_CLASS} lf-ui`;
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
    refreshHeaderWords(headers);
    installActionStyle();

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
        const overlay = buildOverlay(parsed, regex, fields, jsonText, parentRow);
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
        const overlay = buildOverlay(parsed, regex, fields, jsonText, row);
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
    // Wait for OpenSearch specifically, then for its query bar — on any other
    // site neither turns up, so nothing is ever drawn (not even a spinner).
    const isDiscover = await waitFor(
        () => isOpenSearchPage() && findElement(SELECTORS.queryInput),
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
        el.classList.add("lf-ui");
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

// ── and/or → AND/OR ──────────────────────────────────────────────────────────
// Lucene reads a lowercase `and` as a search term, not an operator, so the
// word is upper-cased the moment you finish typing it.
function autoUpperBool() {
    const v = editorTA.value;
    const pos = editorTA.selectionStart;
    if (pos !== editorTA.selectionEnd) return;

    const m = v.slice(0, pos).match(/(^|[\s("])(and|or)([\s()])$/);
    if (!m || m[2] === m[2].toUpperCase()) return;

    // Not inside a comment or a "quoted string"
    const lineStart = v.lastIndexOf("\n", pos - 1) + 1;
    const upto = v.slice(lineStart, pos);
    if (stripLineComment(upto).length < upto.length) return;
    if ((upto.match(/(^|[^\\])"/g) || []).length % 2) return;

    const start = pos - m[0].length + m[1].length;
    const end = start + m[2].length;
    editorTA.selectionStart = start;
    editorTA.selectionEnd = end;
    // execCommand keeps native undo working; the caret goes back where it was
    if (!document.execCommand("insertText", false, m[2].toUpperCase()))
        editorTA.value = v.slice(0, start) + m[2].toUpperCase() + v.slice(end);
    editorTA.selectionStart = editorTA.selectionEnd = pos;
}

// Safety net for a query that never got the finishing keystroke — a standalone
// and/or between clauses is always the operator, never a term.
function upperBooleans(q) {
    const ranges = protectedRanges(q);
    return q.replace(/(^|[\s(])(and|or)(?=[\s)]|$)/gi, (full, pre, word, idx) =>
        ranges.some(([a, b]) => idx > a && idx < b)
            ? full
            : pre + word.toUpperCase(),
    );
}

// `!`, `-` and `+` are prefix operators — OpenSearch needs them stuck to the
// group they negate, so `!\n(…)` must not join up as `! (…)`.
function glueUnary(q) {
    const ranges = protectedRanges(q);
    return q.replace(/([!+-])\s+(?=\()/g, (full, op, idx) =>
        ranges.some(([a, b]) => idx > a && idx < b) ? full : op,
    );
}

// ── Formatter ────────────────────────────────────────────────────────────────
// Breaks a query onto one clause per line, indents parenthesised groups,
// upper-cases the booleans and tightens `field = "v"` to `field="v"`. Comments,
// quoted strings and /regex/ literals are moved but never rewritten.
const FMT_TOKENS =
    /(--[^\n]*|\/\/[^\n]*|#[^\n]*)|([()])|\b(AND|OR|NOT|TO)\b|((?:"(?:\\.|[^"\\])*"|[^\s()])+)|(\s+)/gi;

function formatQuery(text) {
    const lines = [];
    let cur = "";
    let indent = 0;
    let tight = false; // the next token joins the previous one directly

    const flush = () => {
        if (cur.trim()) lines.push("  ".repeat(Math.max(0, indent)) + cur.trim());
        cur = "";
        tight = false;
    };
    const push = (s, joinTight) => {
        cur = !cur || joinTight ? cur + s : `${cur} ${s}`;
    };

    let m;
    FMT_TOKENS.lastIndex = 0;
    while ((m = FMT_TOKENS.exec(text))) {
        const [, comment, paren, kw, atom, space] = m;

        if (comment) {
            push(comment, false); // own line when cur is empty, trailing otherwise
            flush();
        } else if (paren === "(") {
            push("(", tight);
            flush();
            indent++;
        } else if (paren === ")") {
            flush();
            indent--;
            push(")", false);
        } else if (kw) {
            const upper = kw.toUpperCase();
            if (upper === "AND" || upper === "OR") flush(); // one clause per line
            push(upper, false);
        } else if (atom) {
            push(atom, tight || /^(?:=~|=|:)/.test(atom));
            // `!`, `-` and `+` bind to whatever follows — `!(` never `! (`
            tight = /(?:=~|=|:|[!+-])$/.test(atom);
            continue; // keep `tight` for the value that follows
        } else if (space) {
            // `field = "v"` → the space must not break the tight join
            if (!space.includes("\n")) continue;
            flush(); // your own line breaks are kept
            if ((space.match(/\n/g) || []).length > 1 && lines.at(-1) !== "")
                lines.push(""); // and so is one blank separator line
        }
        tight = false;
    }
    flush();
    return lines.join("\n");
}

function formatEditor() {
    if (!editorTA) return;
    const src = editorTA.value;
    const out = formatQuery(src);
    if (out === src) return lfToast("Already formatted");

    // Put the caret back on the same character, wherever it moved to
    const before = src.slice(0, editorTA.selectionStart).replace(/\s/g, "").length;
    let i = 0;
    let seen = 0;
    while (i < out.length && seen < before) {
        if (!/\s/.test(out[i])) seen++;
        i++;
    }
    setValue(editorTA, out);
    editorTA.selectionStart = editorTA.selectionEnd = i;
    editorTA.focus();
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
// Put the query in OpenSearch's bar and submit it — without ever focusing that
// box. Focusing it opens the recent-searches list, and the Enter key we used to
// send would then pick a history entry instead of running what we just wrote.
// Did the search actually run with our query? Discover keeps the applied query
// in the URL (`_q=(query:(…))`), so a distinctive word from it has to show up
// there. Builds that keep their state elsewhere are given the benefit of doubt.
function queryLanded(clean) {
    let url = location.href;
    try {
        url = decodeURIComponent(url);
    } catch {}
    if (!url.includes("query:")) return true;
    const word = (clean.match(/[A-Za-z0-9_]{4,}/g) || []).sort(
        (a, b) => b.length - a.length,
    )[0];
    return !word || url.includes(word);
}

function pushQueryToBar(input, clean) {
    const submitBtn = () =>
        document.querySelector('[data-test-subj="querySubmitButton"]') ||
        document.querySelector('button[aria-label="Search"]') ||
        document.querySelector("form.osdQueryBar button[type='submit']");

    const fire = () => {
        // Re-apply if the page put its own text back (a stale draft would be
        // submitted instead, which is what made the first ⌘↵ look ignored).
        if (input.value !== clean) setNativeValue(input, clean);
        const btn = submitBtn();
        if (btn) return btn.click();
        // No submit button on this build — Enter is the only way left
        for (const type of ["keydown", "keyup"])
            input.dispatchEvent(
                new KeyboardEvent(type, { key: "Enter", keyCode: 13, bubbles: true }),
            );
    };

    setNativeValue(input, clean);

    // Only touch focus if the page put it there — an Escape or blur on a box we
    // never focused can make OpenSearch revert the draft we just wrote.
    if (document.activeElement === input) {
        input.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }),
        );
        input.blur?.();
    }

    // Two frames, then a beat: React re-renders the submit control around the
    // new query, and clicking before that commit submits the *previous* one.
    requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(fire, 120)),
    );

    // The automatic second press: if the bar no longer holds our query, or the
    // search that ran was not ours, run it again rather than making you retype.
    setTimeout(() => {
        if (!input.isConnected) return;
        if (input.value !== clean || !queryLanded(clean)) fire();
    }, 700);

    setTimeout(() => editorTA?.focus(), 800); // keep typing where you were
}

function runEditorQuery() {
    if (!editorTA) return;
    const src = editorTA.value;
    const clean = glueUnary(
        upperBooleans(compileQuerySugar(stripQueryComments(src))),
    );
    const input = queryBarEl();
    if (!input) return lfToast("Query bar not found — is this the Discover page?");

    saveQuerySource(src);
    pushQueryToBar(input, clean);

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

// Which fields and values get offered comes from the preset the popup manages
// (see suggest-presets.js); until storage answers, the built-in one applies.
let suggestStore = lfNormalizeStore(null);

try {
    chrome.storage?.local?.get([LF_SUGGEST_KEY], (d) => {
        suggestStore = lfNormalizeStore(d?.[LF_SUGGEST_KEY]);
    });
    chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "local" || !changes[LF_SUGGEST_KEY]) return;
        suggestStore = lfNormalizeStore(changes[LF_SUGGEST_KEY].newValue);
        if (suggestOpen()) updateSuggest(); // a list is up — re-filter it
    });
} catch {}

const suggestFields = () => lfActivePreset(suggestStore).fields;

// The preset's values for a field, plus whatever that field actually holds in
// the loaded logs — so a new project gets useful values before anyone lists
// them. cachedPayloads holds json_payload objects (with `kubernetes` grafted
// on), hence the stripped prefix.
function suggestValues(field) {
    const set = new Set(lfActivePreset(suggestStore).values[field] || []);
    const path = field.replace(/^json_payload\./, "");
    for (const p of cachedPayloads) {
        if (set.size >= 200) break;
        const v = getNestedValue(p, path);
        if (v == null || typeof v === "object") continue;
        const s = String(v);
        if (s && s.length <= 60) set.add(s);
    }
    return [...set].sort();
}

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
    if (val) {
        const items = suggestValues(val[1]);
        // No values for this field — fall through to completing a field name
        if (items.length)
            return {
                word: val[3],
                start: pos - val[3].length,
                quoted: Boolean(val[2]),
                items,
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
        items: suggestFields(),
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
        box.classList.add("lf-ui");
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
    box.classList.add("lf-ui");

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

    const fmtBtn = editorButton("≡ Format", "Format the query (⌥⇧F)");
    fmtBtn.addEventListener("click", formatEditor);

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

    [runBtn, cmtBtn, fmtBtn, pullBtn, clrBtn].forEach((b) => bar.appendChild(b));
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
        autoUpperBool();
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
        } else if (e.altKey && e.shiftKey && e.code === "KeyF") {
            // e.code, not e.key — ⌥⇧F is a dead key on a Mac layout
            e.preventDefault();
            formatEditor();
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
            '⌘↵ run · ⌘/ comment · ⌥⇧F format · ⌥↓ copy line · f="v" → f:"v" · f=~"v" → f:/.*v.*/ · comments: -- // #',
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

// ── Whole-page dark mode ──────────────────────────────────────────────────────
// A stylesheet, not a CSS filter: `filter: invert()` on the root repaints the
// whole page on every scroll, which is exactly what hurts on a 500-row table.
// One <style> tag, no per-element work, nothing to re-apply on re-render.
const DARK_STYLE_ID = "lf-dark-style";
const PAGE_DARK_KEY = "lf_page_dark";

let pageDark = false;
try {
    pageDark = localStorage.getItem(PAGE_DARK_KEY) === "1";
} catch {}

// Our own UI themes itself through T() — keep the page rules off it entirely
const NOT_OURS = ":not(.lf-ui):not(.lf-ui *)";

const DARK = {
    bg: "#21222c",
    surface: "#282a36",
    raised: "#2f313f",
    field: "#1e1f29",
    text: "#e2e4ec",
    muted: "#a5adc4",
    border: "#44475a",
    line: "#33354a",
    link: "#8be9fd",
};

const DARK_SURFACE = [
    ".euiPage", ".euiPageBody", ".euiPageContent", ".euiPanel", ".euiHeader",
    ".euiHeaderSection", ".headerGlobalNav", ".euiCard", ".euiAccordion",
    ".euiTabs", ".euiTab", ".euiCollapsibleNav", ".euiSideNav", ".euiFlyout",
    ".dscSideBar", ".dscCanvas", ".dscAppContainer", ".application", "main",
];
const DARK_RAISED = [
    ".euiPopover__panel", ".euiContextMenuPanel", ".euiContextMenuItem",
    ".euiModal", ".euiToolTip", ".euiSelectableList", ".euiSelectableListItem",
    ".euiComboBoxOptionsList", ".euiSuperDatePicker", ".euiDatePopoverButton",
];
const DARK_FIELD = [
    "input", "textarea", "select", ".euiFieldText", ".euiFieldSearch",
    ".euiTextArea", ".euiSelect", ".euiComboBox__inputWrap",
    ".euiFormControlLayout", ".euiFormControlLayout__childrenWrapper",
    ".euiFilterButton", ".euiButtonEmpty",
];
const DARK_TABLE = [
    "table", "thead", "tbody", "tr", "td", "th", ".euiTable", ".euiTableRow",
    ".euiTableRowCell", ".euiTableHeaderCell", ".osdDocTable", ".kbnDocTable",
    ".euiDataGrid", ".euiDataGridRowCell", ".euiDataGridHeaderCell",
];

const darkRule = (selectors, body) =>
    `${selectors.map((s) => `html.lf-dark ${s}${NOT_OURS}`).join(",")}{${body}}`;

function darkCss() {
    const d = DARK;
    return [
        `html.lf-dark,html.lf-dark body{background:${d.bg} !important;color:${d.text} !important;}`,
        darkRule(DARK_SURFACE, `background-color:${d.surface} !important;color:${d.text} !important;border-color:${d.border} !important;`),
        darkRule(DARK_RAISED, `background-color:${d.raised} !important;color:${d.text} !important;border-color:${d.border} !important;`),
        darkRule(DARK_FIELD, `background-color:${d.field} !important;color:${d.text} !important;border-color:${d.border} !important;`),
        darkRule(DARK_TABLE, `background-color:transparent !important;color:${d.text} !important;border-color:${d.line} !important;`),
        darkRule(["a"], `color:${d.link} !important;`),
        darkRule([".euiTitle", ".euiText", "h1", "h2", "h3", "h4", "label", ".euiFormLabel"], `color:${d.text} !important;`),
        darkRule([".euiTextColor--subdued", ".euiFormHelpText", "small"], `color:${d.muted} !important;`),
        darkRule(["svg text"], `fill:${d.muted} !important;`),
        `html.lf-dark ::-webkit-scrollbar{background:${d.bg};}`,
        `html.lf-dark ::-webkit-scrollbar-thumb{background:${d.border};border-radius:6px;}`,
    ].join("\n");
}

// OpenSearch ships its own dark build of every stylesheet next to the light one
// (…v7.light.css → …v7.dark.css). Swapping the <link> is the whole page turned
// dark by the app itself: complete coverage, and the browser just uses a
// different file — no filter, no extra paint work, nothing running per frame.
const swappedLinks = new WeakSet();
const disabledLinks = [];
let darkLoaded = false; // a real dark bundle took over

// Fallback for builds that ship no dark stylesheet (or name it something we
// can't guess): make every element inherit the dark page background instead of
// listing class names we'd never finish enumerating. One universal rule costs a
// single style recalc — unlike `filter: invert()`, nothing runs while scrolling.
const FALLBACK_STYLE_ID = "lf-dark-fallback";

function darkFallbackCss() {
    const d = DARK;
    return [
        `html.lf-dark *${NOT_OURS}{background-color:inherit !important;color:inherit !important;border-color:${d.line} !important;}`,
        `html.lf-dark,html.lf-dark body{background-color:${d.bg} !important;color:${d.text} !important;}`,
        darkRule([...DARK_SURFACE, "thead", ".euiHeader"], `background-color:${d.surface} !important;`),
        darkRule(DARK_RAISED, `background-color:${d.raised} !important;`),
        darkRule(DARK_FIELD, `background-color:${d.field} !important;`),
        darkRule(["a", "a *"], `color:${d.link} !important;`),
        darkRule(["img", "canvas", "video", "embed", "object"], `background-color:transparent !important;`),
    ].join("\n");
}

function injectDarkFallback() {
    if (document.getElementById(FALLBACK_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FALLBACK_STYLE_ID;
    style.textContent = darkFallbackCss();
    document.head.appendChild(style);
}

function darkenStylesheets() {
    document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
        const href = link.getAttribute("href") || "";
        if (swappedLinks.has(link) || !/light/i.test(href)) return;
        swappedLinks.add(link);

        const darkHref = href.replace(/light/gi, (m) =>
            m[0] === "L" ? "Dark" : "dark",
        );
        const dark = document.createElement("link");
        dark.rel = "stylesheet";
        dark.href = darkHref;
        dark.dataset.lfDark = "1";
        // Only drop the light one once the dark one has actually loaded, so a
        // build without a dark bundle is left exactly as it was.
        dark.onload = () => {
            link.disabled = true;
            disabledLinks.push(link);
            darkLoaded = true;
            // The app's own theme is better than anything we can force
            document.getElementById(FALLBACK_STYLE_ID)?.remove();
        };
        dark.onerror = () => dark.remove();
        link.after(dark); // after, so it also wins the cascade
    });

    // Some builds theme through a body class instead of (or as well as) the file
    const body = document.body;
    if (body && /(^|\s)theme-light(\s|$)/.test(body.className))
        body.classList.replace("theme-light", "theme-dark");
}

function restoreStylesheets() {
    document.querySelectorAll("link[data-lf-dark]").forEach((l) => l.remove());
    while (disabledLinks.length) disabledLinks.pop().disabled = false;
    if (document.body?.classList.contains("theme-dark"))
        document.body.classList.replace("theme-dark", "theme-light");
}

function applyPageDark() {
    document.documentElement.classList.toggle("lf-dark", pageDark);

    if (!pageDark) {
        restoreStylesheets();
        darkLoaded = false;
        document.getElementById(DARK_STYLE_ID)?.remove();
        document.getElementById(FALLBACK_STYLE_ID)?.remove();
        return;
    }

    darkenStylesheets();

    if (!document.getElementById(DARK_STYLE_ID)) {
        const style = document.createElement("style");
        style.id = DARK_STYLE_ID;
        style.textContent = darkCss();
        document.head.appendChild(style);
    }

    // No dark bundle showed up in time → force it, so nothing is left white
    setTimeout(() => {
        if (pageDark && !darkLoaded) injectDarkFallback();
    }, 1200);
}

function setPageDark(on) {
    pageDark = on;
    try {
        localStorage.setItem(PAGE_DARK_KEY, on ? "1" : "0");
    } catch {}
    applyPageDark();
    setTheme(on ? "dark" : "light"); // keep our own panels in step
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
        btn.classList.add("lf-ui");
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
        // Lazily loaded chunks bring their own light CSS — catch those too
        if (pageDark) darkenStylesheets();
    };
    tick();
    setInterval(tick, 1000);
}

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

// Drag a floating panel around by its header, minus the controls that sit in it
function makeDraggable(panel, head, skip = []) {
    head.addEventListener("mousedown", (e) => {
        if (skip.includes(e.target)) return;
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
}

// Every log payload we can currently see — the intercepted search response
// when we have it, otherwise whatever JSON is rendered on screen. `limit` caps
// the DOM parsing, which is the expensive half.
function loadedPayloads(limit = Infinity) {
    if (cachedPayloads.length)
        return cachedPayloads
            .filter((p) => p && typeof p === "object")
            .slice(0, limit);

    const out = [];
    for (const cell of collectCandidateCells()) {
        if (out.length >= limit) break;
        const raw = (cell.textContent || "").trim();
        const start = raw.indexOf("{");
        if (start < 0) continue;
        const parsed = tryParseJson(raw.slice(start));
        if (parsed) out.push(parsed);
    }
    return out;
}

// Every field path present in the loaded logs
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
    loadedPayloads(40).forEach((p) => walk(p, "", 1));
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
    panel.classList.add("lf-ui");

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

    makeDraggable(panel, head, [close, themeSel]);
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

    // ── Filter forms ─────────────────────────────────────────────────────────
    const fRow = el(
        "div",
        `display:flex;gap:6px;align-items:center;border-top:1px solid ${th.sep};padding-top:8px;`,
    );
    fRow.appendChild(
        el("span", `color:${th.hdr};font-size:10px;letter-spacing:0.4px;flex:1;`, "FILTER FORMS"),
    );

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,application/json";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", () => {
        const f = fileInput.files?.[0];
        // Re-picking the same file must still fire change
        fileInput.value = "";
        if (f) loadFormsFile(f);
    });

    const loadBtn = panelButton("⤑ Load");
    loadBtn.style.flex = "0 0 auto";
    loadBtn.title = "Load a .json file of named DSL filters";
    loadBtn.addEventListener("click", () => fileInput.click());
    fRow.appendChild(loadBtn);

    const fRefresh = el("span", `cursor:pointer;color:${th.toggle};`, "⟳");
    fRefresh.title = "Re-read the saved forms and re-sync the active one";
    fRefresh.addEventListener("click", () =>
        readStored([FORMS_KEY]).then((d) => {
            filterForms = normalizeStoredForms(d[FORMS_KEY]);
            renderForms();
            renderLinks();
        }),
    );
    fRow.appendChild(fRefresh);
    body.appendChild(fRow);
    body.appendChild(fileInput);

    formsMeta = el("div", `color:${th.hdr};font-size:10px;`);
    body.appendChild(formsMeta);

    formsSearchInput = document.createElement("input");
    formsSearchInput.placeholder = "search forms…";
    formsSearchInput.value = formsSearch;
    formsSearchInput.style.cssText = customInput.style.cssText;
    formsSearchInput.addEventListener("input", () => {
        formsSearch = formsSearchInput.value;
        renderForms();
    });
    formsSearchInput.addEventListener("keydown", (e) => e.stopPropagation());
    body.appendChild(formsSearchInput);

    formsBox = el("div", "display:flex;flex-wrap:wrap;gap:5px;");
    body.appendChild(formsBox);

    // ── Links ────────────────────────────────────────────────────────────────
    linksRow = el(
        "div",
        `display:flex;gap:6px;align-items:center;border-top:1px solid ${th.sep};padding-top:8px;`,
    );
    linksRow.appendChild(
        el("span", `color:${th.hdr};font-size:10px;letter-spacing:0.4px;flex:1;`, "LINKS"),
    );
    body.appendChild(linksRow);

    linksBox = el("div", "display:flex;flex-wrap:wrap;gap:5px;");
    body.appendChild(linksBox);

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
    check("Dark mode (whole page)", pageDark, setPageDark);
    check("Hide the “Add filter” bar", filterBarHidden, setFilterBarHidden);

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
    readStored(["extractFields", "extractAuto", FORMS_KEY]).then((d) => {
        panelFields = activeFields.length
            ? activeFields.slice()
            : d.extractFields || [];
        autoChk.checked = Boolean(d.extractAuto);
        panelColsHidden = Boolean(document.getElementById(HIDE_STYLE_ID));
        hideBtn.textContent = panelColsHidden ? "👁 Show Cols" : "🙈 Hide Cols";
        filterForms = normalizeStoredForms(d[FORMS_KEY]);
        renderChips();
        renderList();
        renderForms();
        renderLinks();
        if (!filterForms.forms.length)
            seedFormsFromBundle().then((seeded) => {
                if (!seeded) return;
                filterForms = seeded;
                renderForms();
                renderLinks();
            });
    });
}

function closePanel() {
    document.getElementById(PANEL_ID)?.remove();
    chipsBox = null;
    listBox = null;
    formsBox = null;
    formsMeta = null;
    formsSearchInput = null;
    linksBox = null;
    linksRow = null;
}

function togglePanel() {
    const open = Boolean(document.getElementById(PANEL_ID));
    if (open) closePanel();
    else openPanel();
    try {
        localStorage.setItem(PANEL_OPEN_KEY, open ? "0" : "1");
    } catch {}
}

// Clicking anywhere outside the panel closes it. mousedown, not click, so a
// drag that starts on the panel and ends on the page doesn't count as outside.
document.addEventListener(
    "mousedown",
    (e) => {
        const panel = document.getElementById(PANEL_ID);
        if (!panel || panel.contains(e.target)) return;
        if (e.target?.closest?.(`#${LAUNCH_ID}`)) return; // the launcher toggles
        closePanel();
        try {
            localStorage.setItem(PANEL_OPEN_KEY, "0");
        } catch {}
    },
    true,
);

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
    b.classList.add("lf-ui");
    b.title = "JSON field extractor";
    b.addEventListener("click", togglePanel);
    document.body.appendChild(b);
}

// Keep the panel in step with edits made from the popup
try {
    chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "local") return;
        if (!document.getElementById(PANEL_ID)) return;
        if (changes.extractFields) {
            panelFields = changes.extractFields.newValue || [];
            renderChips();
            renderList();
        }
        if (changes[FORMS_KEY]) {
            filterForms = normalizeStoredForms(changes[FORMS_KEY].newValue);
            renderForms();
            renderLinks();
        }
    });
} catch {}

// New search results → the discovered field list may have changed
window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.type !== "__LF_HITS__") return;
    if (document.getElementById(PANEL_ID)) setTimeout(renderList, 450);
});

// Filters can also change from OpenSearch's own pill UI, and applying one of
// ours is itself a navigation — either way the lit button is re-derived here.
window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.type !== "__LF_NAV__") return;
    if (document.getElementById(PANEL_ID)) setTimeout(renderForms, 100);
});

// ── Filter forms ──────────────────────────────────────────────────────────────
// A .json file of named Query DSL clauses, one button per name. The active form
// is deliberately not stored: the pill in the URL is the real state, so a
// reloaded or shared link lights the right button on its own.
const FORMS_KEY = "filterForms";

let filterForms = { file: "", loaded: 0, dns: [], forms: [], links: [] };
let formsSearch = "";
let formsBox = null;
let formsMeta = null;
let formsSearchInput = null;
let linksBox = null;
let linksRow = null;

// Storage is not trusted any more than the file was: an older version, or
// another extension, could have left a `javascript:` url in there, so the
// stored shape is fed back through the same normaliser before it is painted.
function normalizeStoredForms(raw) {
    const { forms, links } = lfNormalizeFilterForms({
        forms: raw?.forms || [],
        [LF_LINK_KEY]: raw?.links || [],
    });
    return {
        file: String(raw?.file || ""),
        loaded: Number(raw?.loaded) || 0,
        dns: lfNormalizeHosts(raw?.dns),
        forms,
        links,
    };
}

// The store is shared by every tab, but a form is only meant for the hosts its
// `dns` names — so the gate is applied here, at paint time, against this tab's
// host, rather than thrown away at load time.
function formsForThisHost() {
    const host = location.hostname;
    if (!lfHostMatches(filterForms.dns || [], host)) return [];
    return filterForms.forms.filter((f) => lfHostMatches(f.dns || [], host));
}

function linksForThisHost() {
    const host = location.hostname;
    if (!lfHostMatches(filterForms.dns || [], host)) return [];
    return (filterForms.links || []).filter((l) => lfHostMatches(l.dns || [], host));
}

// First run has nothing stored, and an empty panel section teaches nobody what
// the file should look like — so the bundled sample is seeded once. Loading a
// file of your own overwrites it and it is never re-seeded after that.
const FORMS_BUNDLED = "filter-forms.sample.json";

async function seedFormsFromBundle() {
    try {
        const url = chrome.runtime?.getURL?.(FORMS_BUNDLED);
        if (!url) return null;
        const { forms, links, dns } = lfNormalizeFilterForms(
            await (await fetch(url)).json(),
        );
        if (!forms.length) return null;
        const store = { file: FORMS_BUNDLED, loaded: Date.now(), dns, forms, links };
        chrome.storage?.local?.set({ [FORMS_KEY]: store });
        return store;
    } catch {
        return null; // no sample is not a failure worth a toast
    }
}

function formsAge(ms) {
    if (!ms) return "just now";
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

function renderForms() {
    if (!formsBox) return;
    const th = T();
    const active = activeFormName();
    const forms = formsForThisHost();
    const hidden = filterForms.forms.length - forms.length;

    if (formsMeta)
        formsMeta.textContent = filterForms.forms.length
            ? `${filterForms.file || "forms"} · ${forms.length} forms` +
              (hidden ? ` · ${hidden} for other hosts` : "") +
              ` · loaded ${formsAge(filterForms.loaded)}`
            : "";
    // The search box only earns its space once the list stops fitting at a glance
    if (formsSearchInput)
        formsSearchInput.style.display = forms.length > 8 ? "" : "none";

    formsBox.textContent = "";
    if (!forms.length) {
        formsBox.appendChild(
            el(
                "span",
                `color:${th.empty};font-style:italic;`,
                filterForms.forms.length
                    ? `No forms for ${location.hostname}`
                    : "No filter forms — ⤑ Load a .json",
            ),
        );
        return;
    }

    const q = formsSearch.trim().toLowerCase();
    const shown = q ? forms.filter((f) => f.name.toLowerCase().includes(q)) : forms;
    if (!shown.length) {
        formsBox.appendChild(
            el("span", `color:${th.empty};font-style:italic;`, "No form matches"),
        );
        return;
    }

    shown.forEach((form) => {
        const on = form.name === active;
        const b = panelButton(
            form.name.length > 22 ? form.name.slice(0, 21) + "…" : form.name,
            on,
        );
        b.style.flex = "0 0 auto";
        b.title = form.name;
        b.addEventListener("click", () => applyForm(form, on));
        formsBox.appendChild(b);
    });
}

// Links ride in the same file as the forms, so the whole section appears and
// disappears with the file — an empty "LINKS" header would only be noise.
function renderLinks() {
    if (!linksBox) return;
    const links = linksForThisHost();
    if (linksRow) linksRow.style.display = links.length ? "" : "none";

    linksBox.textContent = "";
    linksBox.style.display = links.length ? "flex" : "none";

    links.forEach((link) => {
        const b = panelButton(
            link.name.length > 22 ? link.name.slice(0, 21) + "…" : link.name,
        );
        b.style.flex = "0 0 auto";
        b.title = `${link.name} — ${link.url}`;
        b.addEventListener("click", () => {
            // noopener: the new tab must not reach back into Discover
            window.open(link.url, "_blank", "noopener,noreferrer");
        });
        linksBox.appendChild(b);
    });
}

function loadFormsFile(file) {
    const reader = new FileReader();
    reader.onerror = () => lfToast("Could not read that file");
    reader.onload = () => {
        let raw;
        try {
            raw = JSON.parse(String(reader.result));
        } catch (e) {
            return lfToast(e.message, 4000);
        }
        const { forms, links, skipped, dns } = lfNormalizeFilterForms(raw);
        // A file of nothing but links is a legitimate file
        if (!forms.length && !links.length)
            return lfToast("No valid filter forms in that file", 3500);

        filterForms = { file: file.name, loaded: Date.now(), dns, forms, links };
        try {
            chrome.storage?.local?.set({ [FORMS_KEY]: filterForms });
        } catch {}
        renderForms();
        renderLinks();
        const here = formsForThisHost().length;
        const notes = [`Loaded ${forms.length} forms`];
        if (links.length) notes.push(`${links.length} links`);
        if (here !== forms.length) notes.push(`${here} for ${location.hostname}`);
        if (skipped) notes.push(`${skipped} skipped`);
        lfToast(notes.join(" · "), notes.length > 1 ? 4000 : 2200);
    };
    reader.readAsText(file);
}

// Which form is on. A pill carries its own name in the URL, but the Lucene
// path leaves no such marker, so the name is remembered here — page-scoped
// visual state, like the other lf_* keys.
const ACTIVE_FORM_KEY = "lf_active_form";

function activeFormName() {
    try {
        return localStorage.getItem(ACTIVE_FORM_KEY) || lfGetDslFilterAlias();
    } catch {
        return lfGetDslFilterAlias();
    }
}

function setActiveFormName(name) {
    try {
        if (name) localStorage.setItem(ACTIVE_FORM_KEY, name);
        else localStorage.removeItem(ACTIVE_FORM_KEY);
    } catch {}
}

// Lucene first, pill second. A pill is invisible in the query bar, cannot be
// edited, and some builds drop it silently; Lucene in the bar is visible,
// editable and actually runs. Only clauses Lucene cannot express fall back.
//
// Clicking the lit button is the only remove gesture — there is no separate
// clear control.
function applyForm(form, isActive) {
    if (isActive) {
        lfClearDslFilter(); // no-op unless the pill path was used
        setActiveFormName(null);
        renderForms();
        if (!editorTA) return lfToast("Filter cleared");
        setValue(editorTA, "");
        return runEditorQuery(); // toasts "Cleared query"
    }

    const clean = lfStripBodyKeys(form.dsl);
    if (!clean.ok) return lfToast(`${form.name}: ${clean.error}`, 4000);

    const dropped = clean.dropped.length
        ? ` · dropped ${clean.dropped.join(", ")}`
        : "";

    const lucene = lfDslToLucene(clean.query);
    if (lucene.ok && editorTA) {
        lfClearDslFilter(); // never leave a stale pill beside the query
        // The clause it came from, above the Lucene it became. Commented, so
        // stripLineComment drops it before the query bar ever sees it.
        const src = JSON.stringify(clean.query, null, 2)
            .split("\n")
            .map((l) => "# " + l)
            .join("\n");
        setValue(editorTA, `# ${form.name}\n${src}\n${lucene.lucene}`);
        setActiveFormName(form.name);
        renderForms();
        runEditorQuery();
        // runEditorQuery toasts first; this replaces it with the fuller line
        return lfToast(`Ran · ${form.name}${dropped}`, dropped ? 4000 : 2200);
    }

    const res = lfSetDslFilter(clean.query, form.name);
    if (!res.ok) return lfToast(res.error, 4000);
    setActiveFormName(form.name);
    renderForms();

    const notes = [`Filter pill · ${form.name}${dropped}`];
    if (!res.indexResolved)
        notes.push("index pattern unresolved — the pill may not render");
    lfToast(notes.join(" · "), 4500);
}

// ── Page UI bootstrap ─────────────────────────────────────────────────────────
// The content script can still land on a non-OpenSearch page, so every piece of
// UI below waits for an OpenSearch marker *and* its query bar. On any other site
// this resolves to nothing and the extension stays completely invisible.
(async function initPageUI() {
    const ta = await waitFor(
        () => isOpenSearchPage() && findElement(SELECTORS.queryInput),
        20000,
        400,
    );
    if (!ta) return;
    applyPageDark();
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
