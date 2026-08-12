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
