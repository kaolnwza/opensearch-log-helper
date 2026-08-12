# Filter Forms Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `FILTER FORMS` section to the in-page panel that loads a `.json` file of named Query DSL clauses and applies any one of them as an OpenSearch filter pill with a single click.

**Architecture:** A new plain script `dsl-state.js` owns everything pure and everything URL-shaped: a small rison codec, the filter-form store normaliser, the clause sanitiser, and the read/modify/write cycle over the OpenSearch app-state URL param. `content.js` gains one panel section that renders the forms as buttons and calls into it. Applying a filter is a `location.hash` assignment — OpenSearch's own URL-state sync re-queries, and `interceptor.js` already rebroadcasts the resulting `hashchange` as `__LF_NAV__`, so nothing else needs wiring.

**Tech Stack:** Plain ES2020 browser JavaScript, Chrome MV3 content scripts, no build step, no dependencies. Tests run on Node's built-in `node --test` and load `dsl-state.js` into a `vm` context with a fake `location` — the file stays a plain browser script with no `module.exports`.

## Global Constraints

- No build step, no `package.json`, no runtime dependencies. The repo-root files are what Chrome loads.
- `content.js` and `dsl-state.js` use **4-space** indentation. `popup.*` uses 2. (This plan touches no popup file.)
- Never inline a hex colour in injected UI. All colours come from `THEMES.light` / `THEMES.dark` via `T()`.
- Comments explain *why* (the OpenSearch quirk being worked around), not *what*. Section banners are `// ── Name ───…` padded to 80 columns.
- All injected UI must sit behind the `isOpenSearchPage()` guard — in practice, inside `initPageUI()` or the panel it builds.
- Ownership marker for our filter pill is the exact prefix `LF: ` (capital L, capital F, colon, one space) on `meta.alias`.
- Bump `version` in `manifest.json` when shipping a user-visible change (Task 6 only).
- The store key in `chrome.storage.local` is `filterForms`.

**Spec:** `docs/superpowers/specs/2026-08-13-filter-forms-toolbar-design.md`

**Deviation from the spec, deliberate:** the spec puts `lfNormalizeFilterForms` in `content.js`. This plan puts it and the clause sanitiser in `dsl-state.js` instead, because `content.js` cannot be loaded in a test process (it needs a live DOM and the `chrome` API) and `dsl-state.js` can. Everything DOM-shaped still lives in `content.js`.

---

### Task 1: Rison codec

The app-state param is rison-encoded. Every apply rewrites the whole param, so the property that matters most is that decoding and re-encoding a param we did not change gives back a byte-identical string.

**Files:**
- Create: `dsl-state.js`
- Create: `test/dsl-state.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `lfRisonEncode(value) -> string`
  - `lfRisonDecode(text) -> any` (throws `Error` on malformed input)

- [ ] **Step 1: Write the failing test**

Create `test/dsl-state.test.js`:

```js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "dsl-state.js"), "utf8");

// dsl-state.js is a plain browser script — no exports. Run it in a vm context
// with a fake `location` and pick the function declarations off the global.
function load(href = "http://osd.local/app/data-explorer/discover#?_q=(filters:!())") {
    const location = {
        href,
        get hash() {
            const i = this.href.indexOf("#");
            return i < 0 ? "" : this.href.slice(i);
        },
        set hash(v) {
            const i = this.href.indexOf("#");
            const base = i < 0 ? this.href : this.href.slice(0, i);
            this.href = base + "#" + String(v).replace(/^#/, "");
        },
    };
    const ctx = { location, console };
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    return ctx;
}

// A real Discover app-state param, verbatim.
const REAL_Q =
    "(filters:!(('$state':(store:appState)," +
    "meta:(alias:'LF: cus1',disabled:!f,index:'a1b2',key:query,negate:!f,type:custom," +
    "value:'{\"term\":{\"customer_id\":\"cus1\"}}')," +
    "query:(term:(customer_id:cus1))))," +
    "query:(language:lucene,query:'level:ERROR'))";

test("rison round-trips an untouched param losslessly", () => {
    const { lfRisonEncode, lfRisonDecode } = load();
    assert.strictEqual(lfRisonEncode(lfRisonDecode(REAL_Q)), REAL_Q);
});

test("rison decodes scalars", () => {
    const { lfRisonDecode } = load();
    assert.deepStrictEqual(lfRisonDecode("(a:!t,b:!f,c:!n,d:1.5,e:-2,f:bare,g:'q!'uoted')"), {
        a: true,
        b: false,
        c: null,
        d: 1.5,
        e: -2,
        f: "bare",
        g: "q'uoted",
    });
});

test("rison decodes empty and nested containers", () => {
    const { lfRisonDecode } = load();
    assert.deepStrictEqual(lfRisonDecode("(a:!(),b:(),c:!(1,!(2)))"), {
        a: [],
        b: {},
        c: [1, [2]],
    });
});

test("rison quotes strings that are not bare ids", () => {
    const { lfRisonEncode } = load();
    assert.strictEqual(lfRisonEncode("plain"), "plain");
    assert.strictEqual(lfRisonEncode("has space"), "'has space'");
    assert.strictEqual(lfRisonEncode("a:b"), "'a:b'");
    assert.strictEqual(lfRisonEncode("bang!"), "'bang!!'");
    assert.strictEqual(lfRisonEncode("it's"), "'it!'s'");
    assert.strictEqual(lfRisonEncode("9lives"), "'9lives'");
    assert.strictEqual(lfRisonEncode(""), "''");
});

test("rison rejects malformed input", () => {
    const { lfRisonDecode } = load();
    assert.throws(() => lfRisonDecode("(a:1"), /rison/);
    assert.throws(() => lfRisonDecode("(a:1)junk"), /rison/);
    assert.throws(() => lfRisonDecode("!z"), /rison/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/`
Expected: FAIL — `ENOENT: no such file or directory, open '.../dsl-state.js'`

- [ ] **Step 3: Write the implementation**

Create `dsl-state.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/`
Expected: PASS — `# pass 5`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add dsl-state.js test/dsl-state.test.js
git commit -m "feat: add rison codec for the OpenSearch app-state param"
```

---

### Task 2: Locate and rewrite the app-state param

The filters live in one of two params (`_q` for data-explorer, `_a` for classic Discover), inside the *hash's* query string rather than the URL's. This task is the read/modify/write cycle over that param, with no knowledge of what a filter is.

**Files:**
- Modify: `dsl-state.js` (append)
- Modify: `test/dsl-state.test.js` (append)

**Interfaces:**
- Consumes: `lfRisonEncode`, `lfRisonDecode` from Task 1.
- Produces:
  - `lfFindFilterParam(href) -> null | { error: string } | { head: string, pairs: string[][], idx: number, name: string, state: object }`
  - `lfWriteState(found, state) -> void` — re-encodes `state` into `found.pairs[found.idx]` and assigns `location.hash`

- [ ] **Step 1: Write the failing test**

Append to `test/dsl-state.test.js`:

```js
const DISCOVER_HREF =
    "http://osd.local/app/data-explorer/discover#/?" +
    "_g=(time:(from:now-15m,to:now))&" +
    "_q=(filters:!(),query:(language:lucene,query:''))&" +
    "_a=(metadata:(indexPattern:'idx-1',view:discover))";

test("finds the param carrying filters", () => {
    const { lfFindFilterParam } = load(DISCOVER_HREF);
    const found = lfFindFilterParam(DISCOVER_HREF);
    assert.strictEqual(found.name, "_q");
    assert.strictEqual(found.head, "/");
    assert.deepStrictEqual(found.state.filters, []);
});

test("falls back to _a when _q carries no filters", () => {
    const href =
        "http://osd.local/app/discover#/?_q=(query:(language:lucene,query:''))" +
        "&_a=(filters:!(),metadata:(indexPattern:'idx-9'))";
    const { lfFindFilterParam } = load(href);
    assert.strictEqual(lfFindFilterParam(href).name, "_a");
});

test("returns null when the URL has no app state", () => {
    const href = "http://example.com/app/other";
    const { lfFindFilterParam } = load(href);
    assert.strictEqual(lfFindFilterParam(href), null);
});

test("reports an unreadable param instead of guessing", () => {
    const href = "http://osd.local/app/discover#/?_q=(filters:!(";
    const { lfFindFilterParam } = load(href);
    assert.match(lfFindFilterParam(href).error, /Could not read _q/);
});

test("writing a state leaves the other params untouched", () => {
    const ctx = load(DISCOVER_HREF);
    const found = ctx.lfFindFilterParam(DISCOVER_HREF);
    found.state.filters = [{ meta: { alias: "x" } }];
    ctx.lfWriteState(found, found.state);
    assert.match(ctx.location.href, /_g=\(time:\(from:now-15m,to:now\)\)/);
    assert.match(ctx.location.href, /_a=\(metadata:\(indexPattern:'idx-1',view:discover\)\)/);
    assert.match(ctx.location.href, /_q=\(filters:!\(\(meta:\(alias:x\)\)\)/);
    assert.match(ctx.location.href, /#\/\?/); // the pre-query part of the hash survives
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/`
Expected: FAIL — `TypeError: ctx.lfFindFilterParam is not a function`

- [ ] **Step 3: Write the implementation**

Append to `dsl-state.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/`
Expected: PASS — `# pass 10`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add dsl-state.js test/dsl-state.test.js
git commit -m "feat: read and rewrite the Discover app-state URL param"
```

---

### Task 3: Store normaliser and clause sanitiser

Pure data, no URL, no DOM. The normaliser is the single gate every read of the store passes through; the sanitiser is what stops a pasted search body from crashing OpenSearch's filter label builder with `input.charAt is not a function`.

**Files:**
- Modify: `dsl-state.js` (append)
- Modify: `test/dsl-state.test.js` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `lfNormalizeFilterForms(raw) -> { forms: {name: string, dsl: object}[], skipped: number }`
  - `lfStripBodyKeys(dsl) -> { ok: true, query: object, dropped: string[] } | { ok: false, dropped: string[], error: string }`

- [ ] **Step 1: Write the failing test**

Append to `test/dsl-state.test.js`:

```js
test("normalises the three accepted file shapes to the same forms", () => {
    const { lfNormalizeFilterForms } = load();
    const dsl = { term: { customer_id: "cus1" } };
    const expected = [{ name: "cus1", dsl }];

    assert.deepStrictEqual(lfNormalizeFilterForms([{ name: "cus1", dsl }]).forms, expected);
    assert.deepStrictEqual(lfNormalizeFilterForms({ forms: [{ name: "cus1", dsl }] }).forms, expected);
    assert.deepStrictEqual(lfNormalizeFilterForms({ cus1: dsl }).forms, expected);
});

test("skips invalid entries and counts them", () => {
    const { lfNormalizeFilterForms } = load();
    const res = lfNormalizeFilterForms([
        { name: "ok", dsl: { match_all: {} } },
        { name: "", dsl: { match_all: {} } },
        { name: "no dsl" },
        { name: "array dsl", dsl: [] },
        "nonsense",
    ]);
    assert.deepStrictEqual(res.forms.map((f) => f.name), ["ok"]);
    assert.strictEqual(res.skipped, 4);
});

test("suffixes duplicate names", () => {
    const { lfNormalizeFilterForms } = load();
    const d = { match_all: {} };
    const res = lfNormalizeFilterForms([
        { name: "dup", dsl: d },
        { name: "dup", dsl: d },
        { name: "dup", dsl: d },
    ]);
    assert.deepStrictEqual(res.forms.map((f) => f.name), ["dup", "dup (2)", "dup (3)"]);
});

test("normalising junk yields an empty list, not a throw", () => {
    const { lfNormalizeFilterForms } = load();
    assert.deepStrictEqual(lfNormalizeFilterForms(null), { forms: [], skipped: 0 });
    assert.deepStrictEqual(lfNormalizeFilterForms("nope"), { forms: [], skipped: 0 });
});

test("strips search-body keys and names them", () => {
    const { lfStripBodyKeys } = load();
    const res = lfStripBodyKeys({
        size: 500,
        sort: [{ "@timestamp": "desc" }],
        bool: { must: [] },
    });
    assert.deepStrictEqual(res, { ok: true, query: { bool: { must: [] } }, dropped: ["size", "sort"] });
});

test("unwraps a top-level query key", () => {
    const { lfStripBodyKeys } = load();
    assert.deepStrictEqual(lfStripBodyKeys({ query: { term: { a: 1 } } }).query, { term: { a: 1 } });
});

test("rejects anything that is not a clause object", () => {
    const { lfStripBodyKeys } = load();
    assert.strictEqual(lfStripBodyKeys(null).ok, false);
    assert.strictEqual(lfStripBodyKeys([]).ok, false);
    assert.strictEqual(lfStripBodyKeys({}).ok, false);
    assert.strictEqual(lfStripBodyKeys({ size: 10 }).ok, false);
    assert.match(lfStripBodyKeys({}).error, /not a query clause object/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/`
Expected: FAIL — `TypeError: lfNormalizeFilterForms is not a function`

- [ ] **Step 3: Write the implementation**

Append to `dsl-state.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/`
Expected: PASS — `# pass 17`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add dsl-state.js test/dsl-state.test.js
git commit -m "feat: normalise filter form files and strip search-body keys"
```

---

### Task 4: Build, apply, read and clear the filter pill

The public surface `content.js` calls. This is where the `LF: ` ownership marker earns its keep: it is the pill's visible label, the marker that says a pill is ours to replace, and the name the panel matches to decide which button is lit.

**Files:**
- Modify: `dsl-state.js` (append)
- Modify: `test/dsl-state.test.js` (append)

**Interfaces:**
- Consumes: `lfFindFilterParam`, `lfWriteState` (Task 2).
- Produces:
  - `lfSetDslFilter(clause, name) -> { ok: true, indexResolved: boolean } | { ok: false, error: string }`
  - `lfClearDslFilter() -> { ok: true } | { ok: false, error: string }`
  - `lfGetDslFilterAlias() -> string | null` — the active form's name, without the `LF: ` prefix

- [ ] **Step 1: Write the failing test**

Append to `test/dsl-state.test.js`:

```js
const WITH_FOREIGN =
    "http://osd.local/app/data-explorer/discover#/?" +
    "_q=(filters:!((meta:(alias:!n,index:'idx-1',key:level,negate:!f)," +
    "query:(match_phrase:(level:ERROR)))),query:(language:lucene,query:''))";

test("applying writes one owned pill and keeps foreign filters", () => {
    const ctx = load(WITH_FOREIGN);
    const res = ctx.lfSetDslFilter({ term: { customer_id: "cus1" } }, "cus1");
    assert.deepStrictEqual(res, { ok: true, indexResolved: true });

    const state = ctx.lfFindFilterParam(ctx.location.href).state;
    assert.strictEqual(state.filters.length, 2);
    assert.strictEqual(state.filters[0].query.match_phrase.level, "ERROR"); // untouched
    const ours = state.filters[1];
    assert.strictEqual(ours.meta.alias, "LF: cus1");
    assert.strictEqual(ours.meta.index, "idx-1"); // borrowed from the foreign filter
    assert.strictEqual(ours.meta.type, "custom");
    assert.strictEqual(ours.meta.disabled, false);
    assert.strictEqual(ours.meta.negate, false);
    assert.strictEqual(ours.meta.value, '{"term":{"customer_id":"cus1"}}');
    assert.deepStrictEqual(ours.$state, { store: "appState" });
    assert.deepStrictEqual(ours.query, { term: { customer_id: "cus1" } });
});

test("applying twice replaces our pill rather than stacking", () => {
    const ctx = load(WITH_FOREIGN);
    ctx.lfSetDslFilter({ term: { a: 1 } }, "one");
    ctx.lfSetDslFilter({ term: { b: 2 } }, "two");
    const state = ctx.lfFindFilterParam(ctx.location.href).state;
    assert.strictEqual(state.filters.length, 2);
    assert.strictEqual(ctx.lfGetDslFilterAlias(), "two");
});

test("the active form name comes back from the URL", () => {
    const ctx = load(WITH_FOREIGN);
    assert.strictEqual(ctx.lfGetDslFilterAlias(), null);
    ctx.lfSetDslFilter({ term: { a: 1 } }, "cus1");
    assert.strictEqual(ctx.lfGetDslFilterAlias(), "cus1");
});

test("clearing removes only our pill", () => {
    const ctx = load(WITH_FOREIGN);
    ctx.lfSetDslFilter({ term: { a: 1 } }, "cus1");
    assert.deepStrictEqual(ctx.lfClearDslFilter(), { ok: true });
    const state = ctx.lfFindFilterParam(ctx.location.href).state;
    assert.strictEqual(state.filters.length, 1);
    assert.strictEqual(state.filters[0].query.match_phrase.level, "ERROR");
    assert.strictEqual(ctx.lfGetDslFilterAlias(), null);
});

test("falls back to metadata.indexPattern, then reports it unresolved", () => {
    const withMeta =
        "http://osd.local/app/discover#/?_q=(filters:!(),query:(language:lucene,query:''))" +
        "&_a=(metadata:(indexPattern:'idx-7'))";
    const ctx = load(withMeta);
    assert.deepStrictEqual(ctx.lfSetDslFilter({ term: { a: 1 } }, "x"), {
        ok: true,
        indexResolved: true,
    });
    assert.strictEqual(ctx.lfFindFilterParam(ctx.location.href).state.filters[0].meta.index, "idx-7");

    const bare = load("http://osd.local/app/discover#/?_q=(filters:!())");
    const res = bare.lfSetDslFilter({ term: { a: 1 } }, "x");
    assert.deepStrictEqual(res, { ok: true, indexResolved: false });
    assert.strictEqual(bare.lfFindFilterParam(bare.location.href).state.filters[0].meta.index, undefined);
});

test("refuses to write when there is no app state, and says why", () => {
    const ctx = load("http://example.com/app/other");
    assert.deepStrictEqual(ctx.lfSetDslFilter({ term: { a: 1 } }, "x"), {
        ok: false,
        error: "Filter state not found in the URL — is this Discover?",
    });
    assert.strictEqual(ctx.location.href, "http://example.com/app/other");
});

test("refuses to write over a param it could not decode", () => {
    const href = "http://osd.local/app/discover#/?_q=(filters:!(";
    const ctx = load(href);
    const res = ctx.lfSetDslFilter({ term: { a: 1 } }, "x");
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /Could not read _q/);
    assert.strictEqual(ctx.location.href, href);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/`
Expected: FAIL — `TypeError: ctx.lfSetDslFilter is not a function`

- [ ] **Step 3: Write the implementation**

Append to `dsl-state.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/`
Expected: PASS — `# pass 24`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add dsl-state.js test/dsl-state.test.js
git commit -m "feat: apply, read and clear our Discover filter pill"
```

---

### Task 5: Panel section — load a file and render the buttons

Wire `dsl-state.js` into the extension and draw the section. Clicking a button does nothing yet; that is Task 6, so this task can be reviewed on its own.

**Files:**
- Modify: `manifest.json`
- Modify: `content.js` — new section before `// ── Page UI bootstrap ───` (currently content.js:3721); panel section inside `openPanel()` before the `// ── Query editor height ───` row (currently content.js:3597); `closePanel()` (content.js:3654); the `readStored` call at content.js:3642
- Create: `test/fixtures/filter-forms.sample.json`

**Interfaces:**
- Consumes: `lfNormalizeFilterForms`, `lfGetDslFilterAlias` from `dsl-state.js`.
- Produces:
  - `renderForms()` — repaints the button list from `filterForms` and the URL
  - `normalizeStoredForms(raw) -> { file: string, loaded: number, forms: [] }`
  - `loadFormsFile(file)` — parses a picked `File`, saves it, repaints
  - module-level `let filterForms`, `let formsSearch`, `let formsBox`, `let formsMeta`, `let formsSearchInput`
  - `const FORMS_KEY = "filterForms"`

- [ ] **Step 1: Load `dsl-state.js` before `content.js`**

In `manifest.json`, change the second content-script entry's `js` array:

```json
      "js": ["dsl-state.js", "suggest-presets.js", "content.js"],
```

- [ ] **Step 2: Add the filter forms section to `content.js`**

Insert immediately **before** the `// ── Page UI bootstrap ───` banner (content.js:3721):

```js
// ── Filter forms ──────────────────────────────────────────────────────────────
// A .json file of named Query DSL clauses, one button per name. The active form
// is deliberately not stored: the pill in the URL is the real state, so a
// reloaded or shared link lights the right button on its own.
const FORMS_KEY = "filterForms";

let filterForms = { file: "", loaded: 0, forms: [] };
let formsSearch = "";
let formsBox = null;
let formsMeta = null;
let formsSearchInput = null;

function normalizeStoredForms(raw) {
    const { forms } = lfNormalizeFilterForms(raw?.forms || []);
    return {
        file: String(raw?.file || ""),
        loaded: Number(raw?.loaded) || 0,
        forms,
    };
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
    const active = lfGetDslFilterAlias();
    const forms = filterForms.forms;

    if (formsMeta)
        formsMeta.textContent = forms.length
            ? `${filterForms.file || "forms"} · ${forms.length} forms · loaded ${formsAge(filterForms.loaded)}`
            : "";
    // The search box only earns its space once the list stops fitting at a glance
    if (formsSearchInput)
        formsSearchInput.style.display = forms.length > 8 ? "" : "none";

    formsBox.textContent = "";
    if (!forms.length) {
        formsBox.appendChild(
            el("span", `color:${th.empty};font-style:italic;`, "No filter forms — ⤑ Load a .json"),
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
        const { forms, skipped } = lfNormalizeFilterForms(raw);
        if (!forms.length) return lfToast("No valid filter forms in that file", 3500);

        filterForms = { file: file.name, loaded: Date.now(), forms };
        try {
            chrome.storage?.local?.set({ [FORMS_KEY]: filterForms });
        } catch {}
        renderForms();
        lfToast(
            skipped
                ? `Loaded ${forms.length} forms · ${skipped} skipped`
                : `Loaded ${forms.length} forms`,
        );
    };
    reader.readAsText(file);
}
```

`applyForm` is referenced here and written in Task 6. Add this placeholder directly below `loadFormsFile` so the section is loadable on its own; Task 6 replaces its body:

```js
function applyForm(form) {
    lfToast(`${form.name} — not wired up yet`);
}
```

- [ ] **Step 3: Draw the section inside `openPanel()`**

Insert immediately **before** the `// ── Query editor height ───` banner inside `openPanel()` (content.js:3597):

```js
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
```

- [ ] **Step 4: Fill the section when the panel opens**

Replace the `readStored` block at the end of `openPanel()` (content.js:3642-3651) with:

```js
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
    });
```

- [ ] **Step 5: Drop the references when the panel closes**

Replace `closePanel()` (content.js:3654-3658) with:

```js
function closePanel() {
    document.getElementById(PANEL_ID)?.remove();
    chipsBox = null;
    listBox = null;
    formsBox = null;
    formsMeta = null;
    formsSearchInput = null;
}
```

- [ ] **Step 6: Add a fixture to load by hand**

Create `test/fixtures/filter-forms.sample.json` — this is the file the manual pass picks, and it deliberately exercises the body-key strip and one skippable entry:

```json
[
  {
    "name": "level ERROR",
    "dsl": { "match_phrase": { "level": "ERROR" } }
  },
  {
    "name": "errors with a trace",
    "dsl": {
      "bool": {
        "must": [{ "match_phrase": { "level": "ERROR" } }, { "exists": { "field": "trace_id" } }]
      }
    }
  },
  {
    "name": "pasted search body",
    "dsl": {
      "size": 500,
      "sort": [{ "@timestamp": "desc" }],
      "query": { "match_phrase": { "level": "INFO" } }
    }
  },
  { "name": "broken — no dsl" }
]
```

- [ ] **Step 7: Verify by hand**

Reload the unpacked extension at `chrome://extensions`, then hard-reload the OpenSearch Discover tab and open the panel with the `⌗ Fields` launcher.

1. The `FILTER FORMS` header, `⤑ Load` and `⟳` are there, above `QUERY EDITOR`, with the italic `No filter forms — ⤑ Load a .json` line and no search box.
2. `⤑ Load` → pick `test/fixtures/filter-forms.sample.json`. Three buttons appear, a toast reads `Loaded 3 forms · 1 skipped`, and the meta line reads `filter-forms.sample.json · 3 forms · loaded just now`.
3. Click a button. The toast reads `… — not wired up yet` (Task 6 replaces this).
4. Close and reopen the panel, then reload the page and reopen it. Both times the three buttons come back from storage.
5. Switch the panel theme light ↔ dark. The section repaints with the rest of the panel and the buttons survive.
6. Open a non-OpenSearch page. No launcher, no panel, and the devtools console is clean.

- [ ] **Step 8: Run the unit tests to confirm nothing regressed**

Run: `node --test test/`
Expected: PASS — `# pass 24`, `# fail 0`

- [ ] **Step 9: Commit**

```bash
git add manifest.json content.js test/fixtures/filter-forms.sample.json
git commit -m "feat: render loaded filter forms in the panel"
```

---

### Task 6: Click to apply, click again to clear

**Files:**
- Modify: `content.js` — replace the `applyForm` placeholder from Task 5; extend the `chrome.storage.onChanged` listener (content.js:3705-3713) and the `__LF_NAV__` message listener
- Modify: `manifest.json` (version)
- Modify: `README.md`

**Interfaces:**
- Consumes: `lfStripBodyKeys`, `lfSetDslFilter`, `lfClearDslFilter` from `dsl-state.js`; `renderForms`, `normalizeStoredForms`, `FORMS_KEY` from Task 5.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Replace the `applyForm` placeholder**

```js
// Clicking the lit button is the only remove gesture — there is no separate
// clear control. Both paths repaint from the URL rather than from a local flag.
function applyForm(form, isActive) {
    if (isActive) {
        const res = lfClearDslFilter();
        if (!res.ok) return lfToast(res.error, 4000);
        renderForms();
        return lfToast("Filter cleared");
    }

    const clean = lfStripBodyKeys(form.dsl);
    if (!clean.ok) return lfToast(`${form.name}: ${clean.error}`, 4000);

    const res = lfSetDslFilter(clean.query, form.name);
    if (!res.ok) return lfToast(res.error, 4000);
    renderForms();

    const notes = [`Filter · ${form.name}`];
    if (clean.dropped.length) notes.push(`dropped ${clean.dropped.join(", ")}`);
    if (!res.indexResolved)
        notes.push("index pattern unresolved — the pill may not render");
    lfToast(notes.join(" · "), notes.length > 1 ? 4500 : 2200);
}
```

- [ ] **Step 2: Repaint on navigation**

The user can also delete our pill with OpenSearch's own ✕. Extend the existing `__LF_HITS__` listener block by adding this listener directly below it (content.js:3716-3719):

```js
// Filters can also change from OpenSearch's own pill UI, and applying one of
// ours is itself a navigation — either way the lit button is re-derived here.
window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.type !== "__LF_NAV__") return;
    if (document.getElementById(PANEL_ID)) setTimeout(renderForms, 100);
});
```

- [ ] **Step 3: Keep the section in step with storage**

Replace the `chrome.storage.onChanged` listener (content.js:3705-3713) with:

```js
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
        }
    });
} catch {}
```

- [ ] **Step 4: Bump the version**

In `manifest.json`:

```json
  "version": "1.5.0",
```

- [ ] **Step 5: Document it in the README**

Add to the feature list in `README.md`:

```markdown
- **Filter forms** — load a `.json` file of named Query DSL clauses in the panel and apply any of
  them as a filter with one click. Click the lit button again to remove it. Filters you made by hand
  in OpenSearch are never touched.
```

- [ ] **Step 6: Run the unit tests**

Run: `node --test test/`
Expected: PASS — `# pass 24`, `# fail 0`

- [ ] **Step 7: Verify by hand — the full spec pass**

Reload the unpacked extension, hard-reload the Discover tab, open the panel, and load `test/fixtures/filter-forms.sample.json`.

1. Click `level ERROR`. A pill `LF: level ERROR` appears, the hit count changes, and the button is lit.
2. Click `errors with a trace`. There is still exactly one `LF:` pill, now `LF: errors with a trace`, and only that button is lit.
3. Click `errors with a trace` again. The pill is gone, no button is lit, and the hit count returns.
4. Add a filter by hand with OpenSearch's `+ Add filter`, then repeat steps 1–3. The hand-made filter survives every step.
5. Reload the page with `level ERROR` applied. The button is still lit, derived from the URL.
6. Click `pasted search body`. It applies, and the toast reads `Filter · pasted search body · dropped size, sort`.
7. Remove our pill with OpenSearch's own ✕ on the pill. Within a moment no button is lit.
8. Load a file that is not JSON (rename any `.js` to `.json`). A toast carries the parse error and the three buttons are untouched.
9. Load a name → clause map file and a `{ "forms": [...] }` file. Both produce the same buttons as the array form.
10. Open a non-Discover page (`/app/management`). No panel, no console errors.

- [ ] **Step 8: Commit**

```bash
git add content.js manifest.json README.md
git commit -m "feat: apply and clear filter forms from the panel"
```

---

## Notes for the reviewer

- Tasks 1–4 are covered by `node --test test/`. Tasks 5 and 6 are DOM and Chrome API code with no test runner in this repo; their verification is the manual pass written into the task.
- The one thing worth reading twice is `lfWriteState`: it rewrites the whole app-state param on every apply, so a rison value the codec cannot re-emit would be silently dropped from OpenSearch's state. That is what the round-trip test in Task 1 exists to protect.
