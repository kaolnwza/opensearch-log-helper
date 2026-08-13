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

// Objects built inside the vm are cross-realm, so deepStrictEqual would reject
// them on prototype identity alone. Structure is what these tests care about.
const plain = (v) => JSON.parse(JSON.stringify(v));

// A real Discover app-state param, verbatim.
const REAL_Q =
    "(filters:!(('$state':(store:appState)," +
    "meta:(alias:'LF: cus1',disabled:!f,index:a1b2,key:query,negate:!f,type:custom," +
    "value:'{\"term\":{\"customer_id\":\"cus1\"}}')," +
    "query:(term:(customer_id:cus1))))," +
    "query:(language:lucene,query:'level:ERROR'))";

test("rison round-trips an untouched param losslessly", () => {
    const { lfRisonEncode, lfRisonDecode } = load();
    assert.strictEqual(lfRisonEncode(lfRisonDecode(REAL_Q)), REAL_Q);
});

// OpenSearch sometimes quotes a string that needs no quotes. Re-emitting it
// bare changes the bytes but not the value — that is the guarantee on offer.
test("rison round-trips redundant quoting by value, not by byte", () => {
    const { lfRisonEncode, lfRisonDecode } = load();
    const src = "(filters:!(),index:'a1b2')";
    assert.strictEqual(lfRisonEncode(lfRisonDecode(src)), "(filters:!(),index:a1b2)");
    assert.deepStrictEqual(plain(lfRisonDecode(lfRisonEncode(lfRisonDecode(src)))), {
        filters: [],
        index: "a1b2",
    });
});

test("rison decodes scalars", () => {
    const { lfRisonDecode } = load();
    assert.deepStrictEqual(plain(lfRisonDecode("(a:!t,b:!f,c:!n,d:1.5,e:-2,f:bare,g:'q!'uoted')")), {
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
    assert.deepStrictEqual(plain(lfRisonDecode("(a:!(),b:(),c:!(1,!(2)))")), {
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
    assert.deepStrictEqual(plain(found.state.filters), []);
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

test("normalises the three accepted file shapes to the same forms", () => {
    const { lfNormalizeFilterForms } = load();
    const dsl = { term: { customer_id: "cus1" } };
    const expected = [{ name: "cus1", dsl, dns: [] }];

    assert.deepStrictEqual(plain(lfNormalizeFilterForms([{ name: "cus1", dsl }]).forms), expected);
    assert.deepStrictEqual(plain(lfNormalizeFilterForms({ forms: [{ name: "cus1", dsl }] }).forms), expected);
    assert.deepStrictEqual(plain(lfNormalizeFilterForms({ cus1: dsl }).forms), expected);
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
    assert.deepStrictEqual(plain(res.forms.map((f) => f.name)), ["ok"]);
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
    assert.deepStrictEqual(plain(res.forms.map((f) => f.name)), ["dup", "dup (2)", "dup (3)"]);
});

test("normalising junk yields an empty list, not a throw", () => {
    const { lfNormalizeFilterForms } = load();
    assert.deepStrictEqual(plain(lfNormalizeFilterForms(null)), { forms: [], skipped: 0, dns: [] });
    assert.deepStrictEqual(plain(lfNormalizeFilterForms("nope")), { forms: [], skipped: 0, dns: [] });
});

test("strips search-body keys and names them", () => {
    const { lfStripBodyKeys } = load();
    const res = lfStripBodyKeys({
        size: 500,
        sort: [{ "@timestamp": "desc" }],
        bool: { must: [] },
    });
    assert.deepStrictEqual(plain(res), { ok: true, query: { bool: { must: [] } }, dropped: ["size", "sort"] });
});

test("unwraps a top-level query key", () => {
    const { lfStripBodyKeys } = load();
    assert.deepStrictEqual(plain(lfStripBodyKeys({ query: { term: { a: 1 } } }).query), { term: { a: 1 } });
});

test("rejects anything that is not a clause object", () => {
    const { lfStripBodyKeys } = load();
    assert.strictEqual(lfStripBodyKeys(null).ok, false);
    assert.strictEqual(lfStripBodyKeys([]).ok, false);
    assert.strictEqual(lfStripBodyKeys({}).ok, false);
    assert.strictEqual(lfStripBodyKeys({ size: 10 }).ok, false);
    assert.match(lfStripBodyKeys({}).error, /not a query clause object/);
});

const WITH_FOREIGN =
    "http://osd.local/app/data-explorer/discover#/?" +
    "_q=(filters:!((meta:(alias:!n,index:'idx-1',key:level,negate:!f)," +
    "query:(match_phrase:(level:ERROR)))),query:(language:lucene,query:''))";

test("applying writes one owned pill and keeps foreign filters", () => {
    const ctx = load(WITH_FOREIGN);
    const res = ctx.lfSetDslFilter({ term: { customer_id: "cus1" } }, "cus1");
    assert.deepStrictEqual(plain(res), { ok: true, indexResolved: true });

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
    assert.deepStrictEqual(plain(ours.$state), { store: "appState" });
    assert.deepStrictEqual(plain(ours.query), { term: { customer_id: "cus1" } });
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
    assert.deepStrictEqual(plain(ctx.lfClearDslFilter()), { ok: true });
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
    assert.deepStrictEqual(plain(ctx.lfSetDslFilter({ term: { a: 1 } }, "x")), {
        ok: true,
        indexResolved: true,
    });
    assert.strictEqual(ctx.lfFindFilterParam(ctx.location.href).state.filters[0].meta.index, "idx-7");

    const bare = load("http://osd.local/app/discover#/?_q=(filters:!())");
    const res = bare.lfSetDslFilter({ term: { a: 1 } }, "x");
    assert.deepStrictEqual(plain(res), { ok: true, indexResolved: false });
    assert.strictEqual(bare.lfFindFilterParam(bare.location.href).state.filters[0].meta.index, undefined);
});

test("refuses to write when there is no app state, and says why", () => {
    const ctx = load("http://example.com/app/other");
    assert.deepStrictEqual(plain(ctx.lfSetDslFilter({ term: { a: 1 } }, "x")), {
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

test("sweeps the raw hash for an index pattern the structured lookup misses", () => {
    // Some builds nest the id under discover state rather than metadata
    const href =
        "http://osd.local/app/data-explorer/discover#?_q=(filters:!())" +
        "&_a=(discover:(savedSearch:s1,indexPattern:'nested-99'))";
    const ctx = load(href);
    const res = ctx.lfSetDslFilter({ term: { a: 1 } }, "x");
    assert.deepStrictEqual(plain(res), { ok: true, indexResolved: true });
    assert.strictEqual(
        ctx.lfFindFilterParam(ctx.location.href).state.filters[0].meta.index,
        "nested-99",
    );
});

test("converts leaf clauses to Lucene", () => {
    const { lfDslToLucene } = load();
    const luc = (c) => lfDslToLucene(c).lucene;
    assert.strictEqual(luc({ match_phrase: { level: "ERROR" } }), "level:ERROR");
    assert.strictEqual(luc({ term: { "kubernetes.container_name": "api" } }), "kubernetes.container_name:api");
    assert.strictEqual(luc({ match: { msg: "payment failed" } }), 'msg:"payment failed"');
    assert.strictEqual(luc({ term: { level: { value: "WARN" } } }), "level:WARN");
    assert.strictEqual(luc({ exists: { field: "trace_id" } }), "_exists_:trace_id");
    assert.strictEqual(luc({ prefix: { path: "/api" } }), "path:/api*");
    assert.strictEqual(luc({ terms: { level: ["ERROR", "WARN"] } }), "(level:ERROR OR level:WARN)");
    assert.strictEqual(luc({ query_string: { query: "a AND b" } }), "(a AND b)");
    assert.strictEqual(luc({ match_all: {} }), "*");
});

test("converts ranges, including date math and open ends", () => {
    const { lfDslToLucene } = load();
    const luc = (c) => lfDslToLucene(c).lucene;
    assert.strictEqual(luc({ range: { "@timestamp": { gte: "now-1h" } } }), "@timestamp:[now-1h TO *]");
    assert.strictEqual(luc({ range: { took: { gte: 100, lte: 500 } } }), "took:[100 TO 500]");
    assert.strictEqual(luc({ range: { took: { gt: 100, lt: 500 } } }), "took:{100 TO 500}");
});

test("converts bool must / should / must_not", () => {
    const { lfDslToLucene } = load();
    const luc = (c) => lfDslToLucene(c).lucene;

    assert.strictEqual(
        luc({
            bool: {
                must: [{ match_phrase: { level: "ERROR" } }, { exists: { field: "trace_id" } }],
            },
        }),
        "(level:ERROR AND _exists_:trace_id)",
    );
    assert.strictEqual(
        luc({ bool: { must_not: [{ match_phrase: { level: "DEBUG" } }] } }),
        "NOT level:DEBUG",
    );
    assert.strictEqual(
        luc({ bool: { should: [{ term: { a: 1 } }, { term: { b: 2 } }] } }),
        "(a:1 OR b:2)",
    );
    assert.strictEqual(
        luc({
            bool: {
                must: [{ term: { env: "prod" } }],
                must_not: [{ term: { level: "DEBUG" } }],
            },
        }),
        "(env:prod AND NOT level:DEBUG)",
    );
    // filter behaves as must
    assert.strictEqual(luc({ bool: { filter: [{ term: { a: 1 } }] } }), "a:1");
});

test("reports clauses with no Lucene equivalent instead of guessing", () => {
    const { lfDslToLucene } = load();
    const res = lfDslToLucene({ script: { script: "doc['a'].value > 1" } });
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /no Lucene equivalent/);
    assert.strictEqual(lfDslToLucene({ bool: { must: [{ script: {} }] } }).ok, false);
    assert.strictEqual(lfDslToLucene(null).ok, false);
});

test("carries dns through, on the file and on a form", () => {
    const { lfNormalizeFilterForms } = load();
    const res = lfNormalizeFilterForms({
        dns: "OSD.corp.example",
        forms: [
            { name: "everywhere", dsl: { match_all: {} } },
            { name: "prod only", dsl: { match_all: {} }, dns: ["logs.prod.example"] },
            { name: "any sub", dsl: { match_all: {} }, dns: "*.dev.example" },
        ],
    });
    assert.deepStrictEqual(plain(res.dns), ["osd.corp.example"]); // lowercased
    assert.deepStrictEqual(plain(res.forms.map((f) => f.dns)), [
        [],
        ["logs.prod.example"],
        ["*.dev.example"],
    ]);
});

test("dns in a name → clause map gates the file, it is not a form", () => {
    const { lfNormalizeFilterForms } = load();
    const res = lfNormalizeFilterForms({ dns: ["a.example"], cus1: { term: { a: 1 } } });
    assert.deepStrictEqual(plain(res.forms.map((f) => f.name)), ["cus1"]);
    assert.deepStrictEqual(plain(res.dns), ["a.example"]);
});

test("matches hosts exactly, by wildcard, and by subdomain", () => {
    const { lfHostMatches } = load();
    assert.strictEqual(lfHostMatches([], "anything.example"), true); // ungated
    assert.strictEqual(lfHostMatches(["*"], "anything.example"), true);
    assert.strictEqual(lfHostMatches(["logs.example"], "logs.example"), true);
    assert.strictEqual(lfHostMatches(["logs.example"], "LOGS.example"), true);
    assert.strictEqual(lfHostMatches(["logs.example"], "other.example"), false);
    assert.strictEqual(lfHostMatches(["*.corp.example"], "osd.corp.example"), true);
    assert.strictEqual(lfHostMatches(["*.corp.example"], "corp.example"), true);
    assert.strictEqual(lfHostMatches(["*.corp.example"], "corp.example.evil.com"), false);
    assert.strictEqual(lfHostMatches(["a.example", "b.example"], "b.example"), true);
});

test("accepts an array of groups, each with its own dns", () => {
    const { lfNormalizeFilterForms } = load();
    const d = { match_all: {} };
    const res = lfNormalizeFilterForms([
        {
            dns: ["logs.prod.example"],
            forms: [
                { name: "prod a", dsl: d },
                { name: "prod b", dsl: d },
            ],
        },
        {
            dns: ["*.dev.example"],
            forms: [
                { name: "dev a", dsl: d },
                // a form's own dns wins over the group's
                { name: "dev but really prod", dsl: d, dns: ["logs.prod.example"] },
            ],
        },
    ]);
    assert.strictEqual(res.skipped, 0);
    assert.deepStrictEqual(
        plain(res.forms.map((f) => [f.name, f.dns])),
        [
            ["prod a", ["logs.prod.example"]],
            ["prod b", ["logs.prod.example"]],
            ["dev a", ["*.dev.example"]],
            ["dev but really prod", ["logs.prod.example"]],
        ],
    );
});

test("mixes groups and bare forms in one array", () => {
    const { lfNormalizeFilterForms } = load();
    const d = { match_all: {} };
    const res = lfNormalizeFilterForms([
        { name: "loose", dsl: d },
        { dns: ["a.example"], forms: [{ name: "grouped", dsl: d }] },
        { dns: ["b.example"], forms: [{ name: "no dsl" }] },
    ]);
    assert.deepStrictEqual(plain(res.forms.map((f) => f.name)), ["loose", "grouped"]);
    assert.strictEqual(res.skipped, 1);
});

test("a group with an empty dns leaves its forms ungated", () => {
    const { lfNormalizeFilterForms, lfHostMatches } = load();
    const res = lfNormalizeFilterForms([{ forms: [{ name: "x", dsl: { match_all: {} } }] }]);
    assert.deepStrictEqual(plain(res.forms[0].dns), []);
    assert.strictEqual(lfHostMatches(res.forms[0].dns, "anywhere.example"), true);
});
