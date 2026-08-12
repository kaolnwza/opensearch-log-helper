// OpenSearch keeps Discover's filters in a rison-encoded URL param. Writing a
// filter there needs no DOM automation, so it does not break when OpenSearch
// changes its markup, and it sidesteps the Ace editor inside the "Edit as
// Query DSL" popover, which ignores the native value setter used elsewhere in
// this extension. The price is owning the small rison subset below.

// ── Rison ─────────────────────────────────────────────────────────────────────
// Only what app state actually uses: objects, arrays, !t/!f/!n, numbers, bare
// ids and '…' strings. Round-tripping an untouched param must be lossless —
// every apply rewrites the param whole, so anything we cannot re-emit is lost.

// rison's not-idchar set: a string holding any of these cannot go unquoted
const LF_RISON_NOT_ID = /['!:(),*@$\s]/;

function lfRisonIsId(s) {
    if (!s.length) return false;
    if (s[0] === "-" || (s[0] >= "0" && s[0] <= "9")) return false; // would parse as a number
    return !LF_RISON_NOT_ID.test(s);
}

function lfRisonEncode(v) {
    if (v === true) return "!t";
    if (v === false) return "!f";
    if (v === null || v === undefined) return "!n";
    if (typeof v === "number")
        // rison writes exponents without the + that String() adds
        return Number.isFinite(v) ? String(v).replace("e+", "e") : "!n";
    if (typeof v === "string")
        return lfRisonIsId(v)
            ? v
            : "'" + v.replace(/!/g, "!!").replace(/'/g, "!'") + "'";
    if (Array.isArray(v)) return "!(" + v.map(lfRisonEncode).join(",") + ")";
    if (typeof v === "object")
        return (
            "(" +
            Object.keys(v)
                .filter((k) => v[k] !== undefined)
                .map((k) => lfRisonEncode(k) + ":" + lfRisonEncode(v[k]))
                .join(",") +
            ")"
        );
    return "!n";
}

function lfRisonDecode(text) {
    const s = String(text);
    let i = 0;

    const err = (m) => {
        throw new Error(`rison: ${m} at ${i}`);
    };

    function quoted() {
        i++; // opening '
        let out = "";
        for (;;) {
            const c = s[i++];
            if (c === undefined) err("unterminated string");
            if (c === "'") return out;
            if (c === "!") out += s[i++] ?? "";
            else out += c;
        }
    }

    function number() {
        const m = /^-?\d+(\.\d+)?([eE]-?\d+)?/.exec(s.slice(i));
        if (!m) err("bad number");
        i += m[0].length;
        return Number(m[0]);
    }

    function id() {
        const start = i;
        while (i < s.length && !LF_RISON_NOT_ID.test(s[i])) i++;
        if (i === start) err(`unexpected ${JSON.stringify(s[i] ?? "end")}`);
        return s.slice(start, i);
    }

    // Entered with the opening "!(" already consumed
    function array() {
        const out = [];
        if (s[i] === ")") {
            i++;
            return out;
        }
        for (;;) {
            out.push(value());
            if (s[i] === ",") {
                i++;
                continue;
            }
            if (s[i] === ")") {
                i++;
                return out;
            }
            err("expected , or ) in array");
        }
    }

    function object() {
        i++; // opening (
        const out = {};
        if (s[i] === ")") {
            i++;
            return out;
        }
        for (;;) {
            const k = value();
            if (s[i] !== ":") err("expected :");
            i++;
            out[String(k)] = value();
            if (s[i] === ",") {
                i++;
                continue;
            }
            if (s[i] === ")") {
                i++;
                return out;
            }
            err("expected , or ) in object");
        }
    }

    function bang() {
        i++; // !
        const c = s[i++];
        if (c === "t") return true;
        if (c === "f") return false;
        if (c === "n") return null;
        if (c === "(") return array();
        err("unknown ! escape");
    }

    function value() {
        const c = s[i];
        if (c === undefined) err("unexpected end");
        if (c === "!") return bang();
        if (c === "(") return object();
        if (c === "'") return quoted();
        if (c === "-" || (c >= "0" && c <= "9")) return number();
        return id();
    }

    const out = value();
    if (i !== s.length) err("trailing input");
    return out;
}

// ── App-state URL param ───────────────────────────────────────────────────────
// The params sit in the *hash's* query string ("#/?_g=…&_q=…"), not the URL's,
// so URLSearchParams on location.search never sees them. Pairs are split by
// hand and their values left percent-encoded exactly as they arrived: rewriting
// one param must not reformat the others.

// encodeURIComponent leaves !'()* alone already; these two would otherwise turn
// a readable rison param into a wall of escapes.
function lfEncodeParamValue(str) {
    return encodeURIComponent(str).replace(/%2C/g, ",").replace(/%3A/g, ":");
}

function lfSplitHash(hash) {
    const qAt = hash.indexOf("?");
    const head = qAt < 0 ? hash : hash.slice(0, qAt);
    const rest = qAt < 0 ? "" : hash.slice(qAt + 1);
    const pairs = rest
        ? rest.split("&").map((p) => {
              const eq = p.indexOf("=");
              return eq < 0 ? [p, ""] : [p.slice(0, eq), p.slice(eq + 1)];
          })
        : [];
    return { head, pairs };
}

// data-explorer keeps filters in _q, classic Discover in _a — whichever decodes
// to an object with a `filters` key is the one to rewrite.
function lfFindFilterParam(href) {
    const at = String(href).indexOf("#");
    if (at < 0) return null;
    const { head, pairs } = lfSplitHash(String(href).slice(at + 1));

    for (const name of ["_q", "_a"]) {
        const idx = pairs.findIndex((p) => p[0] === name);
        if (idx < 0) continue;
        let state;
        try {
            state = lfRisonDecode(decodeURIComponent(pairs[idx][1]));
        } catch {
            // Never overwrite state we could not read
            return { error: `Could not read ${name} from the URL` };
        }
        if (state && typeof state === "object" && "filters" in state)
            return { head, pairs, idx, name, state };
    }
    return null;
}

function lfWriteState(found, state) {
    const pairs = found.pairs.slice();
    pairs[found.idx] = [found.name, lfEncodeParamValue(lfRisonEncode(state))];
    location.hash =
        found.head + "?" + pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

// ── Filter form store ─────────────────────────────────────────────────────────
// A hand-written file is as likely to be a name → clause map as an array, and
// people paste whole search bodies out of their dev console, so both are taken
// and reduced to one shape here. Every read of the store goes through this.

function lfNormalizeFilterForms(raw) {
    const entries = [];
    let skipped = 0;

    const push = (name, dsl) => {
        if (typeof name !== "string" || !name.trim()) return void skipped++;
        if (!dsl || typeof dsl !== "object" || Array.isArray(dsl))
            return void skipped++;
        entries.push({ name: name.trim(), dsl });
    };

    const list = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.forms)
          ? raw.forms
          : null;

    if (list) {
        for (const e of list) {
            if (!e || typeof e !== "object" || Array.isArray(e)) skipped++;
            else push(e.name, e.dsl);
        }
    } else if (raw && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw)) push(k, v);
    } else {
        return { forms: [], skipped: 0 };
    }

    // Names are the button labels *and* the pill alias we match on, so two
    // forms may not share one.
    const used = new Set();
    const forms = entries.map(({ name, dsl }) => {
        let n = name;
        for (let i = 2; used.has(n); i++) n = `${name} (${i})`;
        used.add(n);
        return { name: n, dsl };
    });
    return { forms, skipped };
}

// Search-body keys alongside a query crash OpenSearch's filter label builder
// with "input.charAt is not a function". They are dropped, never silently —
// the caller names them in a toast.
const LF_BODY_KEYS = [
    "size",
    "from",
    "sort",
    "_source",
    "aggs",
    "aggregations",
    "track_total_hits",
    "highlight",
    "timeout",
    "search_after",
];

function lfStripBodyKeys(dsl) {
    const bad = { ok: false, dropped: [], error: "not a query clause object" };
    if (!dsl || typeof dsl !== "object" || Array.isArray(dsl)) return bad;

    const inner =
        dsl.query && typeof dsl.query === "object" && !Array.isArray(dsl.query)
            ? dsl.query
            : dsl;

    const query = {};
    const dropped = [];
    for (const [k, v] of Object.entries(inner)) {
        if (LF_BODY_KEYS.includes(k)) dropped.push(k);
        else query[k] = v;
    }
    if (!Object.keys(query).length)
        return { ok: false, dropped, error: "not a query clause object" };
    return { ok: true, query, dropped };
}

// ── Our filter pill ───────────────────────────────────────────────────────────
// meta.alias does three jobs: the pill's visible label, the marker that says a
// pill is ours to replace, and the form name the panel matches to light a
// button after a reload. Filters the user made by hand carry no such alias and
// are never touched.
const LF_ALIAS_PREFIX = "LF: ";

function lfIsOurs(f) {
    return typeof f?.meta?.alias === "string" && f.meta.alias.startsWith(LF_ALIAS_PREFIX);
}

// An unresolvable index pattern is not fatal — the pill is still written, and
// the caller warns that it may not render.
function lfIndexPatternId(found) {
    for (const f of found.state.filters || []) if (f?.meta?.index) return f.meta.index;
    for (const [k, v] of found.pairs) {
        if (k !== "_q" && k !== "_a") continue;
        try {
            const st = lfRisonDecode(decodeURIComponent(v));
            if (st?.metadata?.indexPattern) return st.metadata.indexPattern;
        } catch {
            // A param we cannot read simply has no index pattern to offer
        }
    }
    return null;
}

function lfBuildPill(clause, name, index) {
    const meta = {
        alias: LF_ALIAS_PREFIX + name,
        disabled: false,
        key: "query",
        negate: false,
        type: "custom",
        value: JSON.stringify(clause),
    };
    if (index) meta.index = index;
    return { $state: { store: "appState" }, meta, query: clause };
}

// Everything below reads the URL fresh: the user may have added or removed
// filters by hand since the panel was drawn.
function lfWithFilterParam(fn) {
    const found = lfFindFilterParam(location.href);
    if (!found)
        return {
            ok: false,
            error: "Filter state not found in the URL — is this Discover?",
        };
    if (found.error) return { ok: false, error: found.error };
    return fn(found, Array.isArray(found.state.filters) ? found.state.filters : []);
}

function lfSetDslFilter(clause, name) {
    return lfWithFilterParam((found, filters) => {
        const index = lfIndexPatternId(found);
        const kept = filters.filter((f) => !lfIsOurs(f));
        kept.push(lfBuildPill(clause, name, index));
        lfWriteState(found, { ...found.state, filters: kept });
        return { ok: true, indexResolved: Boolean(index) };
    });
}

function lfClearDslFilter() {
    return lfWithFilterParam((found, filters) => {
        lfWriteState(found, { ...found.state, filters: filters.filter((f) => !lfIsOurs(f)) });
        return { ok: true };
    });
}

function lfGetDslFilterAlias() {
    const found = lfFindFilterParam(location.href);
    if (!found || found.error) return null;
    const ours = (found.state.filters || []).find(lfIsOurs);
    return ours ? ours.meta.alias.slice(LF_ALIAS_PREFIX.length) : null;
}
