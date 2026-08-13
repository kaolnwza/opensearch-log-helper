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

    const push = (name, dsl, dns) => {
        if (typeof name !== "string" || !name.trim()) return void skipped++;
        if (!dsl || typeof dsl !== "object" || Array.isArray(dsl))
            return void skipped++;
        entries.push({ name: name.trim(), dsl, dns: lfNormalizeHosts(dns) });
    };

    const list = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.forms)
          ? raw.forms
          : null;

    if (list) {
        for (const e of list) {
            if (!e || typeof e !== "object" || Array.isArray(e)) skipped++;
            else push(e.name, e.dsl, e.dns);
        }
    } else if (raw && typeof raw === "object") {
        // name → clause map: `dns` at this level gates the file, not a form
        for (const [k, v] of Object.entries(raw)) {
            if (k === "dns") continue;
            push(k, v);
        }
    } else {
        return { forms: [], skipped: 0, dns: [] };
    }

    // Names are the button labels *and* the pill alias we match on, so two
    // forms may not share one.
    const used = new Set();
    const forms = entries.map(({ name, dsl, dns }) => {
        let n = name;
        for (let i = 2; used.has(n); i++) n = `${name} (${i})`;
        used.add(n);
        return { name: n, dsl, dns };
    });
    return { forms, skipped, dns: lfNormalizeHosts(raw?.dns) };
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
    // Versions differ on where they park the id — data-explorer nests it under
    // discover state, classic under metadata. A pill with no meta.index is
    // dropped by the filter bar without a word, so it is worth one last sweep
    // of the raw hash for any indexPattern at all.
    const m = /indexPattern[:=]'?([\w.-]+)'?/.exec(String(found.pairs.map(([, v]) => v).join("&")));
    return m ? m[1] : null;
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

// ── DSL → Lucene ──────────────────────────────────────────────────────────────
// A filter pill is invisible in the query bar, cannot be edited, and on some
// OpenSearch builds is dropped without a word. Lucene pushed through the query
// bar is visible, editable and re-runnable, so it is the preferred path — the
// pill is kept only for clauses with no Lucene equivalent.

// Bare tokens keep date math (now-1h) and wildcards working; everything else is
// quoted, since a space or a colon would otherwise end the term early.
function lfLuceneValue(v) {
    const s = String(v);
    return /^[\w.@:*?+-]+$/.test(s) && !/^[+-]/.test(s)
        ? s
        : `"${s.replace(/(["\\])/g, "\\$1")}"`;
}

function lfRangeToLucene(field, r) {
    if (!r || typeof r !== "object") return null;
    const lo = r.gte !== undefined ? r.gte : r.gt;
    const hi = r.lte !== undefined ? r.lte : r.lt;
    if (lo === undefined && hi === undefined) return null;
    const open = r.gt !== undefined ? "{" : "[";
    const close = r.lt !== undefined ? "}" : "]";
    const l = lo === undefined ? "*" : lfLuceneValue(lo);
    const h = hi === undefined ? "*" : lfLuceneValue(hi);
    return `${field}:${open}${l} TO ${h}${close}`;
}

function lfDslToLucene(clause) {
    const listOf = (v) => (Array.isArray(v) ? v : v ? [v] : []);

    function leaf(op, arg) {
        if (op === "match_all") return "*";
        if (op === "exists") return arg?.field ? `_exists_:${arg.field}` : null;
        if (op === "query_string")
            return typeof arg?.query === "string" ? `(${arg.query})` : null;
        if (op === "range") {
            const f = Object.keys(arg || {})[0];
            return f ? lfRangeToLucene(f, arg[f]) : null;
        }
        if (op === "terms") {
            const f = Object.keys(arg || {})[0];
            const vals = arg?.[f];
            if (!f || !Array.isArray(vals) || !vals.length) return null;
            const ors = vals.map((v) => `${f}:${lfLuceneValue(v)}`).join(" OR ");
            return vals.length > 1 ? `(${ors})` : ors;
        }
        if (["term", "match", "match_phrase", "wildcard", "prefix"].includes(op)) {
            const f = Object.keys(arg || {})[0];
            if (!f) return null;
            let v = arg[f];
            // Long form: { field: { value: … } } / { field: { query: … } }
            if (v && typeof v === "object")
                v = v.value !== undefined ? v.value : v.query;
            if (v === undefined || v === null) return null;
            return op === "prefix" ? `${f}:${v}*` : `${f}:${lfLuceneValue(v)}`;
        }
        return null;
    }

    function bool(b) {
        if (!b || typeof b !== "object") return null;

        const join = (nodes, sep) => {
            const parts = nodes.map(walk);
            if (parts.some((p) => p === null)) return null;
            if (!parts.length) return "";
            return parts.length > 1 ? `(${parts.join(sep)})` : parts[0];
        };

        const must = join([...listOf(b.must), ...listOf(b.filter)], " AND ");
        const should = join(listOf(b.should), " OR ");
        const nots = listOf(b.must_not).map(walk);
        if (must === null || should === null || nots.some((n) => n === null))
            return null;

        const parts = [];
        if (must) parts.push(must);
        if (should) parts.push(should);
        for (const n of nots) parts.push(`NOT ${n}`);
        if (!parts.length) return null;
        return parts.length > 1 ? `(${parts.join(" AND ")})` : parts[0];
    }

    function walk(node) {
        if (!node || typeof node !== "object" || Array.isArray(node)) return null;
        const keys = Object.keys(node);
        if (!keys.length) return null;
        // Sibling keys at one level are an implicit AND in hand-written DSL
        if (keys.length > 1) {
            const parts = keys.map((k) => walk({ [k]: node[k] }));
            if (parts.some((p) => p === null)) return null;
            return `(${parts.join(" AND ")})`;
        }
        const op = keys[0];
        return op === "bool" ? bool(node[op]) : leaf(op, node[op]);
    }

    const lucene = walk(clause);
    return lucene
        ? { ok: true, lucene }
        : { ok: false, error: "no Lucene equivalent for this clause" };
}

// ── Host gating ───────────────────────────────────────────────────────────────
// One form file gets carried between OpenSearch instances — dev, uat, prod —
// and a container name that exists on one is noise on another. A `dns` entry,
// on the file or on a single form, limits where it shows up. No `dns` at all
// means everywhere, which keeps older files working untouched.

function lfNormalizeHosts(raw) {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list
        .filter((h) => typeof h === "string" && h.trim())
        .map((h) => h.trim().toLowerCase());
}

function lfHostMatches(hosts, host) {
    const want = String(host || "").toLowerCase();
    if (!hosts.length) return true; // ungated
    return hosts.some((h) => {
        if (h === "*") return true;
        // "*.corp.example" matches any subdomain, and the bare domain too
        if (h.startsWith("*.")) {
            const base = h.slice(2);
            return want === base || want.endsWith("." + base);
        }
        return want === h;
    });
}
