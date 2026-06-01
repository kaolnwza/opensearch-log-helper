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

    // 1. Remove parenthesized groups that contain this field
    //    e.g.  AND (json_payload:/.*x.*/ AND json_payload:/.*y.*/)
    q = q.replace(
        new RegExp(`\\s*(?:AND|OR)?\\s*\\([^)]*${esc}:[^)]*\\)`, "gi"),
        "",
    );

    // 2. Remove individual clauses  (AND/OR? NOT? field:value)
    //    value = regex /.../, quoted "...", or bare word
    const val = `(?:\\/[^\\/]*\\/|"[^"]*"|\\S+)`;
    q = q.replace(
        new RegExp(`\\s*(?:AND|OR)?\\s*NOT\\s+${esc}:${val}`, "gi"),
        "",
    );
    q = q.replace(new RegExp(`\\s*(?:AND|OR)?\\s*${esc}:${val}`, "gi"), "");

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

function addMultiFilter({ field, terms, op, mode = "regex" }) {
    const input = findElement(SELECTORS.queryInput);
    if (!input)
        return {
            ok: false,
            error: "Query bar not found. Make sure you're on the Discover page.",
        };

    // Strip any existing clauses for this field before applying the new ones
    const stripped = removeFieldFromQuery(input.value || "", field);

    const clauses = terms.map((t) => buildClause(field, t, mode));
    const group =
        clauses.length > 1 ? `(${clauses.join(` ${op} `)})` : clauses[0];
    const next = stripped ? `${stripped} AND ${group}` : group;

    input.focus();
    setNativeValue(input, next);
    submitQuery(input);
    return { ok: true };
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
  `;
    document.head.appendChild(s);
})();

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

    // Navigation / query change → clear boxes right away
    if (e.data?.type === "__LF_NAV__") {
        if (activeFields.length) purgeOverlays();
        return;
    }
});

window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.type !== "__LF_HITS__") return;
    cachedPayloads = e.data.payloads || [];
    // New search response → purge stale overlays so rows re-render with fresh data
    if (activeFields.length) {
        purgeOverlays();
        clearTimeout(window._lfTimer);
        window._lfTimer = setTimeout(() => processTableRows(activeFields), 400);
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

// Build a flat map of all raw field values needed by any spec (for regex fallback)
function regexExtract(text, specs) {
    const needed = new Set();
    specs.forEach((spec) => {
        const p = parseSpec(spec);
        if (p.type === "coalesce") p.fields.forEach((f) => needed.add(f));
        else needed.add(p.field);
    });
    const result = {};
    needed.forEach((f) => {
        const v = regexExtractOne(text, f);
        if (v !== undefined) result[f] = v;
    });
    return result;
}

// Resolve one spec to { label, displayValue } using parsed JSON or regex fallback
function resolveSpec(spec, parsed, regexResult) {
    const p = parseSpec(spec);

    if (p.type === "coalesce") {
        for (const f of p.fields) {
            const val = parsed ? getNestedValue(parsed, f) : regexResult[f];
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
    const val = parsed ? getNestedValue(parsed, p.field) : regexResult[p.field];
    const dv =
        val !== undefined && val !== null
            ? typeof val === "object"
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
    const grid = document.createElement("div");
    grid.style.cssText = `display:flex;align-items:stretch;border-bottom:1px solid ${th.sep};`;

    let any = false;
    specs.forEach((spec) => {
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

        // Field name header
        const hdr = document.createElement("div");
        hdr.style.cssText =
            `color:${th.hdr};font-size:10px;letter-spacing:0.4px;` +
            "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;";
        hdr.textContent = fieldName;

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
        grid.appendChild(col);
        any = true;
    });

    // ── json_payload toggle row (below columns, inside grid = above the border) ─
    if (rawJson) {
        // Row 2 inside the grid: "▶ json_payload" — below the data columns
        const toggleRow = document.createElement("div");
        toggleRow.style.cssText =
            `padding:3px 12px;display:inline-flex;align-items:center;gap:5px;` +
            `cursor:pointer;user-select:none;color:${th.toggle};font-size:11px;` +
            `border-top:1px solid ${th.sep};width:100%;box-sizing:border-box;`;

        const arrow = document.createElement("span");
        arrow.textContent = "▶";
        arrow.style.cssText = "font-size:9px;display:inline-block;transition:transform 0.15s;";

        const lbl = document.createElement("span");
        lbl.textContent = "json_payload";

        toggleRow.appendChild(arrow);
        toggleRow.appendChild(lbl);
        grid.appendChild(toggleRow);   // inside grid → above the grid's border-bottom

        // Pre element (below the grid border)
        const pre = document.createElement("pre");
        pre.innerHTML = syntaxHighlight(parsed, rawJson);
        pre.style.cssText =
            `display:none;margin:0;padding:12px 16px;` +
            `background:${th.jsonBg};border-top:1px solid ${th.jsonBord};` +
            `color:${th.jsonFg};font-size:13px;line-height:1.7;overflow:auto;` +
            "height:220px;white-space:pre;word-break:normal;" +
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

        // Single click handler — toggle pre + resizeBar together
        toggleRow.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = pre.style.display !== "none";
            pre.style.display       = isOpen ? "none"  : "block";
            resizeBar.style.display = isOpen ? "none"  : "block";
            arrow.style.transform   = isOpen ? "rotate(0deg)" : "rotate(90deg)";
            toggleRow.style.color   = isOpen ? T().toggle : T().key;
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

function processTableRows(fields) {
    if (!fields.length) return 0;
    const fieldKey = fields.join(",");
    let found = 0;
    const seenRows = new Set();

    // ── Pass 1: visible JSON cells (json_payload is a selected column) ───────
    const candidates = new Set([
        ...document.querySelectorAll("td"),
        ...document.querySelectorAll('[role="gridcell"]'),
        ...document.querySelectorAll(".euiDataGridRowCell__content"),
        ...document.querySelectorAll(".kbnDocTableCell"),
        ...document.querySelectorAll('[data-test-subj*="docTableField"]'),
    ]);

    candidates.forEach((cell) => {
        const raw = (cell.innerText || cell.textContent || "").trim();
        if (!raw.slice(0, 200).includes("{")) return;

        const jsonStart = raw.indexOf("{");
        const jsonText = jsonStart > 0 ? raw.slice(jsonStart) : raw;
        const parsed = tryParseJson(jsonText);
        const regex = regexExtract(raw, fields);
        const overlay = buildOverlay(parsed, regex, fields, jsonText);
        if (!overlay) return;

        const parentRow = cell.closest("tr");
        if (parentRow && !seenRows.has(parentRow)) {
            seenRows.add(parentRow);
            if (insertOverlayAfterRow(parentRow, overlay, fieldKey)) found++;
            else found++; // already up-to-date
        } else if (!parentRow) {
            if (cell.dataset.lfKey === fieldKey) {
                found++;
                return;
            }
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

        const parsed =
            typeof payload === "object"
                ? payload
                : tryParseJson(String(payload));
        const jsonText = parsed ? JSON.stringify(parsed) : String(payload);
        const regex = regexExtract(jsonText, fields);
        const overlay = buildOverlay(parsed, regex, fields, jsonText);
        if (!overlay) return;

        if (insertOverlayAfterRow(row, overlay, fieldKey)) found++;
        else found++;
    });

    return found;
}

// ── Hide / show a table column by field name ──────────────────────────────
const HIDE_STYLE_ID = "lf-hide-col-style";

// fields: array of column name substrings to hide (e.g. ["Time","kubernetes.container_name","json_payload"])
function hideColumns({ fields = [] }) {
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
        // If OpenSearch removed non-overlay rows → table re-rendered → purge stale overlays
        const tableRowsRemoved = mutations.some((m) =>
            [...m.removedNodes].some(
                (n) =>
                    n.nodeType === 1 &&
                    n.tagName === "TR" &&
                    !n.classList?.contains(EXTRACT_ROW_CLASS),
            ),
        );
        if (tableRowsRemoved) purgeOverlays();

        clearTimeout(window._lfTimer);
        window._lfTimer = setTimeout(() => processTableRows(activeFields), 300);
    });
    extractObserver.observe(document.body, { childList: true, subtree: true });

    return { ok: true, found };
}

function stopExtract() {
    activeFields = [];
    if (extractObserver) {
        extractObserver.disconnect();
        extractObserver = null;
    }
    document
        .querySelectorAll(`.${EXTRACT_ROW_CLASS}`)
        .forEach((el) => el.remove());
    document.querySelectorAll(`.${EXTRACT_CLASS}`).forEach((el) => el.remove());
    document
        .querySelectorAll("[data-lf-key]")
        .forEach((el) => el.removeAttribute("data-lf-key"));
    return { ok: true };
}

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
            case "stopExtract":
                sendResponse(stopExtract());
                break;
            case "hideColumns":
                sendResponse(hideColumns(msg));
                break;
            case "showColumn":
                sendResponse(showColumn());
                break;
            case "setTheme": {
                activeTheme = msg.theme || "light";
                try {
                    localStorage.setItem("lf_theme", activeTheme);
                } catch {}
                if (activeFields.length) {
                    stopExtract();
                    setTimeout(() => startExtract(activeFields), 50);
                }
                sendResponse({ ok: true });
                break;
            }
            default:
                sendResponse({ ok: false, error: "Unknown action" });
        }
    } catch (e) {
        sendResponse({ ok: false, error: e.message });
    }
    return true;
});
