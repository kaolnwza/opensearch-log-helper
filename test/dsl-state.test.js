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
    const empty = {
        forms: [],
        skipped: 0,
        dns: [],
        links: [],
        suggests: [],
        color: "",
        formsColor: "",
        linksColor: "",
    };
    assert.deepStrictEqual(plain(lfNormalizeFilterForms(null)), empty);
    assert.deepStrictEqual(plain(lfNormalizeFilterForms("nope")), empty);
});

test("reads button-link entries and inherits the group dns", () => {
    const { lfNormalizeFilterForms } = load();
    const res = lfNormalizeFilterForms([
        {
            dns: ["logs.corp.example"],
            forms: [{ name: "f", dsl: { match_all: {} } }],
            "button-link": [
                { name: "runbook", url: "https://run.example/x" },
                { name: "own dns", url: "http://a.example", dns: ["*"] },
            ],
        },
    ]);
    assert.deepStrictEqual(plain(res.links), [
        { name: "runbook", url: "https://run.example/x", dns: ["logs.corp.example"] },
        { name: "own dns", url: "http://a.example", dns: ["*"] },
    ]);
    assert.strictEqual(res.skipped, 0);
});

test("takes button-link beside a top-level forms array and in a map file", () => {
    const { lfNormalizeFilterForms } = load();
    const link = { name: "x", url: "https://x.example/" };
    const expected = [{ name: "x", url: "https://x.example/", dns: [] }];

    const withForms = lfNormalizeFilterForms({
        forms: [{ name: "f", dsl: { match_all: {} } }],
        "button-link": [link],
    });
    assert.deepStrictEqual(plain(withForms.links), expected);
    assert.deepStrictEqual(plain(withForms.forms.map((f) => f.name)), ["f"]);

    // in a map file `button-link` is the link list, never a form named that
    const asMap = lfNormalizeFilterForms({
        cus1: { term: { customer_id: "cus1" } },
        "button-link": [link],
    });
    assert.deepStrictEqual(plain(asMap.links), expected);
    assert.deepStrictEqual(plain(asMap.forms.map((f) => f.name)), ["cus1"]);
});

// A shared forms file is executable input: a javascript: url would run in the
// page the moment its button is clicked.
test("skips links that are not http(s)", () => {
    const { lfNormalizeFilterForms } = load();
    const res = lfNormalizeFilterForms([
        {
            "button-link": [
                { name: "ok", url: "https://ok.example" },
                { name: "xss", url: "javascript:alert(1)" },
                { name: "data", url: "data:text/html,<script>x</script>" },
                { name: "rel", url: "/app/discover" },
                { name: "no url" },
                { name: "", url: "https://nameless.example" },
                "nonsense",
            ],
        },
    ]);
    assert.deepStrictEqual(plain(res.links.map((l) => l.name)), ["ok"]);
    assert.strictEqual(res.skipped, 6);
});

test("a group colour reaches its forms and links, and an entry overrides it", () => {
    const { lfNormalizeFilterForms } = load();
    const res = lfNormalizeFilterForms([
        {
            color: "#ff79c6",
            forms: [
                { name: "inherits", dsl: { match_all: {} } },
                { name: "own", color: "rebeccapurple", dsl: { match_all: {} } },
            ],
            "button-link": [
                { name: "inherits", url: "https://a.example" },
                { name: "own", color: "#0f0", url: "https://b.example" },
            ],
        },
        { name: "uncoloured", dsl: { match_all: {} } },
    ]);
    assert.deepStrictEqual(plain(res.forms.map((f) => f.color || null)), [
        "#ff79c6",
        "rebeccapurple",
        null, // an uncoloured form carries no color key at all
    ]);
    assert.deepStrictEqual(plain(res.links.map((l) => l.color)), ["#ff79c6", "#0f0"]);
});

test("forms-color and links-color paint the two sections apart", () => {
    const { lfNormalizeFilterForms } = load();
    const res = lfNormalizeFilterForms([
        {
            color: "#111111",
            "forms-color": "#ff5555",
            "links-color": "#50fa7b",
            forms: [{ name: "f", dsl: { match_all: {} } }],
            "button-link": [{ name: "l", url: "https://a.example" }],
        },
        {
            // only the shared key: both sections take it
            color: "#bd93f9",
            forms: [{ name: "f2", dsl: { match_all: {} } }],
            "button-link": [{ name: "l2", url: "https://b.example" }],
        },
    ]);
    assert.deepStrictEqual(plain(res.forms.map((f) => f.color)), ["#ff5555", "#bd93f9"]);
    assert.deepStrictEqual(plain(res.links.map((l) => l.color)), ["#50fa7b", "#bd93f9"]);
});

test("file-wide section colours fall back to a file-wide color", () => {
    const { lfNormalizeFilterForms } = load();
    const both = lfNormalizeFilterForms({
        color: "#111111",
        "links-color": "#50fa7b",
        forms: [{ name: "f", dsl: { match_all: {} } }],
    });
    assert.strictEqual(both.formsColor, "#111111");
    assert.strictEqual(both.linksColor, "#50fa7b");

    const none = lfNormalizeFilterForms([{ name: "f", dsl: { match_all: {} } }]);
    assert.deepStrictEqual([none.formsColor, none.linksColor], ["", ""]);
});

// A colour is written straight into a style attribute
test("drops a colour that is not a hex or a bare word", () => {
    const { lfNormalizeFilterForms, lfSafeColor } = load();
    for (const bad of [
        "red;background:url(x)",
        "#12345",
        "rgb(1,2,3)",
        "var(--x)",
        "expression(alert(1))",
        42,
    ])
        assert.strictEqual(lfSafeColor(bad), "", String(bad));

    const res = lfNormalizeFilterForms({
        color: "red;background:url(x)",
        forms: [{ name: "f", color: "#abc", dsl: { match_all: {} } }],
    });
    assert.strictEqual(res.color, "");
    assert.strictEqual(res.forms[0].color, "#abc");
});

test("a top-level colour is not read as a form named color", () => {
    const { lfNormalizeFilterForms } = load();
    const res = lfNormalizeFilterForms({
        color: "#ff79c6",
        cus1: { term: { customer_id: "cus1" } },
    });
    assert.deepStrictEqual(plain(res.forms.map((f) => f.name)), ["cus1"]);
    assert.strictEqual(res.color, "#ff79c6");
    assert.strictEqual(res.skipped, 0);
});

test("keeps a form's fields, inheriting group then file", () => {
    const { lfNormalizeFilterForms } = load();
    const dsl = { match_all: {} };
    const res = lfNormalizeFilterForms({
        fields: ["level"],
        forms: [
            { name: "own", dsl, fields: ["message.code", "message.data"] },
            {
                name: "group",
                dsl,
                // a group's list reaches the forms that do not carry one
            },
        ],
    });
    assert.deepStrictEqual(plain(res.forms.map((f) => f.fields)), [
        ["message.code", "message.data"],
        ["level"],
    ]);

    const grouped = lfNormalizeFilterForms([
        { fields: ["a"], forms: [{ name: "g", dsl }, { name: "o", dsl, fields: ["b"] }] },
    ]);
    assert.deepStrictEqual(plain(grouped.forms.map((f) => f.fields)), [["a"], ["b"]]);
});

test("drops junk fields and leaves a form without a fields key", () => {
    const { lfNormalizeFilterForms } = load();
    const res = lfNormalizeFilterForms([
        { name: "junk", dsl: { match_all: {} }, fields: [1, "", "  ", { a: 1 }, []] },
        { name: "dupes", dsl: { match_all: {} }, fields: ["a", " a ", "b"] },
        { name: "none", dsl: { match_all: {} } },
    ]);
    assert.strictEqual(res.forms[0].fields, undefined);
    assert.deepStrictEqual(plain(res.forms[1].fields), ["a", "b"]);
    assert.strictEqual(res.forms[2].fields, undefined);
    assert.strictEqual(res.skipped, 0); // a bad field list does not kill the form
});

test("a top-level fields list is not read as a form named fields", () => {
    const { lfNormalizeFilterForms } = load();
    const res = lfNormalizeFilterForms({
        fields: ["message.code"],
        cus1: { term: { customer_id: "cus1" } },
    });
    assert.deepStrictEqual(plain(res.forms.map((f) => f.name)), ["cus1"]);
    assert.deepStrictEqual(plain(res.forms[0].fields), ["message.code"]);
    assert.strictEqual(res.skipped, 0);
});

test("a links-only group is not counted as a skipped form", () => {
    const { lfNormalizeFilterForms } = load();
    const res = lfNormalizeFilterForms([
        { dns: ["*"], "button-link": [{ name: "x", url: "https://x.example" }] },
    ]);
    assert.deepStrictEqual(plain(res.forms), []);
    assert.strictEqual(res.skipped, 0);
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

// ── suggest blocks ────────────────────────────────────────────────────────────

test("reads a group's suggest block and gates it by the group dns", () => {
    const { lfNormalizeFilterForms } = load();
    const res = lfNormalizeFilterForms([
        {
            dns: ["logs.prod.example"],
            suggest: { "kubernetes.container_name": ["core-a", "core-b"] },
            forms: [{ name: "f", dsl: { match_all: {} } }],
        },
    ]);
    assert.strictEqual(res.skipped, 0);
    assert.deepStrictEqual(plain(res.suggests), [
        {
            values: { "kubernetes.container_name": ["core-a", "core-b"] },
            dns: ["logs.prod.example"],
        },
    ]);
});

// A file that only teaches the editor container names carries no forms at all
test("takes a suggest block as the whole of a group, and beside a forms array", () => {
    const { lfNormalizeFilterForms } = load();
    const bare = lfNormalizeFilterForms([
        { dns: ["a.example"], suggest: { level: ["INFO"] } },
    ]);
    assert.deepStrictEqual(plain(bare.forms), []);
    assert.deepStrictEqual(plain(bare.suggests), [
        { values: { level: ["INFO"] }, dns: ["a.example"] },
    ]);
    assert.strictEqual(bare.skipped, 0);

    const beside = lfNormalizeFilterForms({
        dns: ["b.example"],
        suggest: { level: ["WARN"] },
        forms: [{ name: "f", dsl: { match_all: {} } }],
    });
    assert.deepStrictEqual(plain(beside.suggests), [
        { values: { level: ["WARN"] }, dns: ["b.example"] },
    ]);
});

// `suggest` in a map file names the suggestions, never a form called "suggest"
test("keeps suggest out of the forms of a name → clause map", () => {
    const { lfNormalizeFilterForms } = load();
    const res = lfNormalizeFilterForms({
        suggest: { level: ["ERROR"] },
        errors: { match: { level: "ERROR" } },
    });
    assert.deepStrictEqual(plain(res.forms.map((f) => f.name)), ["errors"]);
    assert.deepStrictEqual(plain(res.suggests), [
        { values: { level: ["ERROR"] }, dns: [] },
    ]);
});

test("drops junk inside a suggest block instead of throwing", () => {
    const { lfNormalizeFilterForms } = load();
    const res = lfNormalizeFilterForms([
        // not an object at all
        { dns: ["a.example"], suggest: ["core-a"], forms: [] },
        // a field whose values are unusable leaves nothing behind
        { dns: ["b.example"], suggest: { level: "INFO", other: [] }, forms: [] },
        // blanks and duplicates are dropped, order is kept
        { suggest: { level: ["  INFO ", "INFO", "", 7, "WARN"] }, forms: [] },
    ]);
    assert.deepStrictEqual(plain(res.suggests), [
        { values: { level: ["INFO", "WARN"] }, dns: [] },
    ]);
    assert.strictEqual(res.skipped, 2);
});

test("normalises the flattened suggests a store hands back", () => {
    const { lfNormalizeSuggests } = load();
    assert.deepStrictEqual(plain(lfNormalizeSuggests(null)), []);
    assert.deepStrictEqual(
        plain(
            lfNormalizeSuggests([
                { values: { level: ["INFO"] }, dns: "A.Example" },
                { values: {} }, // nothing left to offer
                "junk",
            ]),
        ),
        [{ values: { level: ["INFO"] }, dns: ["a.example"] }],
    );
});

test("the bundled forms file parses and carries its container names", () => {
    const { lfNormalizeFilterForms } = load();
    const raw = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "config", "forms.config.json"), "utf8"),
    );
    const res = lfNormalizeFilterForms(raw);
    assert.strictEqual(res.skipped, 0);
    assert.strictEqual(res.suggests.length, 1);
    const names = res.suggests[0].values["kubernetes.container_name"];
    assert.ok(names.length > 40, `expected a full container list, got ${names.length}`);
    assert.deepStrictEqual(plain(res.suggests[0].dns), ["logging-prd.aws.clicxapp.tech"]);
});
