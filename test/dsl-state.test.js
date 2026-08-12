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
    const expected = [{ name: "cus1", dsl }];

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
    assert.deepStrictEqual(plain(lfNormalizeFilterForms(null)), { forms: [], skipped: 0 });
    assert.deepStrictEqual(plain(lfNormalizeFilterForms("nope")), { forms: [], skipped: 0 });
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
