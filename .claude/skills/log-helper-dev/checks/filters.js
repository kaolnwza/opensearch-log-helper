// The contains pill: what Discover's own filter list is handed, what is left
// for the query bar, and how a pill comes off again. Needs BOTH halves in one
// window — content.js and interceptor.js.
//   NODE_PATH=<dir with jsdom> node filters.js      (LF_DIR to point elsewhere)
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const DIR = process.env.LF_DIR || path.resolve(__dirname, "../../../..");
const SCRIPTS = ["suggest-presets.js", "content.js", "interceptor.js"];

const html = `<!doctype html><html><body>
  <form class="osdQueryBar"><div class="euiFormControlLayout">
    <textarea data-test-subj="queryInput"></textarea>
  </div></form>
  <button data-test-subj="querySubmitButton">Refresh</button>
  <div class="globalFilterGroup__wrapper"><button data-test-subj="addFilter">Add filter</button></div>
  <div class="dscCanvas"><table><thead><tr><th>time</th></tr></thead>
    <tbody><tr><td>2026-08-03</td></tr></tbody></table></div>
</body></html>`;

const dom = new JSDOM(html, {
    url: "https://logs.example.com/app/data-explorer/discover",
    runScripts: "outside-only",
    pretendToBeVisual: true,
});
const { window } = dom;

const store = {};
const onChangedFns = [];
window.chrome = {
    storage: {
        local: {
            get: (keys, cb) =>
                cb(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((k) => [k, store[k]]))),
            set: (o) => Object.assign(store, o),
        },
        onChanged: { addListener: (fn) => onChangedFns.push(fn) },
    },
    runtime: { onMessage: { addListener: () => {} } },
};

window.Element.prototype.getBoundingClientRect = () => ({
    left: 100, top: 200, bottom: 218, right: 110, width: 10, height: 18,
});

// Both halves talk over window.postMessage and each checks `e.source ===
// window`, which jsdom leaves null — so route it through a MessageEvent that
// carries the source, the way the real browser does.
window.postMessage = (data) =>
    window.dispatchEvent(new window.MessageEvent("message", { data, source: window }));

// interceptor.js wraps window.fetch; jsdom has none, so stand one up that
// answers with whatever the test put in `fetchBody`.
let fetchBody = null;
window.fetch = async () => ({
    ok: true,
    status: 200,
    clone: () => ({ json: async () => fetchBody ?? { responses: [] } }),
});

SCRIPTS.forEach((f) => window.eval(fs.readFileSync(`${DIR}/${f}`, "utf8")));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (type, data = {}) =>
    window.dispatchEvent(
        new window.MessageEvent("message", { data: { type, ...data }, source: window }),
    );

const VALUE = "063b813d-dd59-489b-b19d-4d0b15709ccc";
const ALIAS = "json_payload =~ 063b813d-dd59-489b-b19d-4d0b…";
const FIELDS = ["json_payload", "json_payload.*"];

(async () => {
    const errors = [];
    window.addEventListener("error", (e) => errors.push(e.message));

    send("__LF_HITS__", { payloads: [{ level: "ERROR", msg: "boom" }] });
    await wait(700); // the page UI mounts after waitFor(queryInput) resolves

    const editor = window.document.getElementById("lf-editor");
    const ta = editor.querySelector("textarea");
    const osd = window.document.querySelector('[data-test-subj="queryInput"]');

    let submitted = null;
    window.document
        .querySelector('[data-test-subj="querySubmitButton"]')
        .addEventListener("click", () => (submitted = osd.value));

    const type = (v) => {
        ta.value = v;
        ta.selectionStart = ta.selectionEnd = v.length;
        ta.dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    const key = (k, opts = {}) =>
        ta.dispatchEvent(
            new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }),
        );

    // Discover's own filter list, as React would hold it on the search bar
    const existing = {
        meta: { alias: "by hand", index: "idx-42" },
        query: { match_phrase: { level: "ERROR" } },
    };
    let applied = null;
    const props = {
        filters: [existing],
        indexPatterns: [{ id: "idx-42" }],
        onFiltersUpdated: (f) => (applied = f),
    };
    window.document.querySelector('[data-test-subj="addFilter"]')["__reactFiber$test"] = {
        memoizedProps: props,
        return: null,
    };

    const run = async (src) => {
        applied = null;
        submitted = null;
        type(src);
        key("Enter", { metaKey: true });
        // pushQueryToBar re-checks its own submit at 700ms; let that settle, or
        // the previous run's re-fire lands in the middle of the next assertion
        await wait(1100);
        // the page would re-render with the list it was handed — carry it over,
        // or every run starts from the same stale props
        if (applied) props.filters = applied;
    };
    let bad = 0;
    const check = (name, got, want) => {
        const ok = JSON.stringify(got) === JSON.stringify(want);
        if (!ok) bad++;
        console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
        if (!ok) console.log(`     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
    };

    // 1. the reported query: pill through Discover's own filter list
    await run(
        `kubernetes.pod_namespace:(\n  "dgl-document", "dgl-account"\n)\nAND kubernetes.container_name=adaptor-account-cdd\nAND json_payload=~"${VALUE}"`,
    );
    check("filter list was handed back", Array.isArray(applied), true);
    check("hand-added filter kept, ours appended", applied?.length, 2);
    check("the kept one is untouched", applied?.[0], existing);
    check("pill is labelled and marked as ours", applied?.[1]?.meta, {
        alias: ALIAS,
        disabled: false,
        key: "json_payload",
        lf: true,
        negate: false,
        type: "custom",
        index: "idx-42",
    });
    check("pill is app state", applied?.[1]?.$state, { store: "appState" });
    // Every clause names the field *and* its subtree: a dynamically mapped
    // payload is an object, and a query on an object's own name matches
    // nothing while raising no error — which is what hid the document.
    check("pill is a should over every mapping", applied?.[1]?.query, {
        bool: {
            minimum_should_match: 1,
            should: [
                { multi_match: { type: "phrase", query: VALUE, fields: FIELDS, lenient: true } },
                { wildcard: { json_payload: { value: `*${VALUE}*`, case_insensitive: true } } },
                {
                    query_string: {
                        fields: FIELDS,
                        query: "*063b813d\\-dd59\\-489b\\-b19d\\-4d0b15709ccc*",
                        analyze_wildcard: true,
                        lenient: true,
                    },
                },
            ],
        },
    });
    check(
        "the rest of the chain went to the query bar",
        submitted,
        'kubernetes.pod_namespace:("dgl-document" OR "dgl-account") AND kubernetes.container_name:"adaptor-account-cdd"',
    );
    check(
        "URL untouched — no hash surgery, nothing to reload",
        decodeURIComponent(window.location.href).includes("lf"),
        false,
    );

    // 2. dropping the clause takes our pill off and leaves the other one
    await run(`kubernetes.pod_namespace:("dgl-document")\nAND kubernetes.container_name=adaptor-account-cdd`);
    check("only the hand-added filter is left", applied, [existing]);
    check(
        "query still ran",
        submitted,
        'kubernetes.pod_namespace:("dgl-document") AND kubernetes.container_name:"adaptor-account-cdd"',
    );

    // 3. with no pill of ours up, a plain query does not touch the filter list
    await run('level="ERROR"');
    check("filter list left alone", applied, null);
    check("query ran as usual", submitted, 'level:"ERROR"');

    // 4. a pill that has been through the page's own filter state can come
    // back without `meta.lf`, and switching `=~` to `=` then left it up for
    // good. The label is the second mark, so it still goes.
    const roundTripped = {
        $state: { store: "appState" },
        meta: {
            alias: ALIAS,
            disabled: false,
            index: "idx-42",
            key: "json_payload",
            negate: false,
            type: "custom",
        },
        query: { bool: { minimum_should_match: 1, should: [] } },
    };
    props.filters = [existing, roundTripped];
    await run(`json_payload="${VALUE}"`);
    check("pill without its meta key is still taken off", applied, [existing]);
    check("the = clause ran as DQL", submitted, `json_payload:"${VALUE}"`);

    // 5. a pill is replaced, not stacked, when `=~` runs twice
    await run(`json_payload=~"${VALUE}"`);
    check("one pill of ours, not two", applied?.length, 2);
    await run('json_payload=~"4d0b15709ccc"');
    check("still one pill of ours", applied?.length, 2);
    check("and it is the new value", applied?.[1]?.meta?.alias, "json_payload =~ 4d0b15709ccc");

    // 6. two `=~` clauses in a row: each takes one `and` with it, and the
    // chain that is left must not end on a dangling one
    props.filters = [];
    await run(
        `kubernetes.container_name=core-application-submit-flow\nAND json_payload=~"NXMPS261022000012"\nAND json_payload.msg=~"update loan app status from"`,
    );
    check("both clauses became pills", applied?.length, 2);
    check(
        "no dangling AND left in the query",
        submitted,
        'kubernetes.container_name:"core-application-submit-flow"',
    );
    check("each pill carries its own field", applied?.map((f) => f.meta.alias), [
        "json_payload =~ NXMPS261022000012",
        "json_payload.msg =~ update loan app status from",
    ]);

    // ...the same, with the lifted clauses at the head of the chain
    await run(
        `json_payload=~"NXMPS261022000012"\nAND json_payload.msg=~"update loan"\nAND kubernetes.container_name=core-application-submit-flow`,
    );
    check(
        "nothing dangling at the head either",
        submitted,
        'kubernetes.container_name:"core-application-submit-flow"',
    );

    // ...and three in a row, with plain clauses interleaved
    await run(`a=1\nAND json_payload=~"x-y-z"\nAND json_payload=~"p-q-r"\nAND b=2\nAND json_payload=~"m-n-o"`);
    check("the plain clauses still read as a chain", submitted, 'a:"1" AND b:"2"');
    check("one pill each", applied?.length, 3);

    // ...and nothing but `=~` leaves an empty query, not an orphan AND
    await run(`json_payload=~"x-y-z"\nAND json_payload=~"p-q-r"`);
    check("nothing left to run", submitted, "");

    // 7. a search error is read out instead of OpenSearch's blank "Error" —
    // through the real fetch patch, and from the *second* _msearch response,
    // since a shard failure arrives inside a 200 that otherwise reads as
    // "nothing matched"
    const reason = "Can not use [wildcard] query on a flat_object field";
    const toast = () => window.document.getElementById("lf-toast")?.textContent;
    fetchBody = {
        responses: [
            { hits: { hits: [] }, _shards: { failed: 0 } },
            { _shards: { failures: [{ reason: { type: "query_shard_exception", reason } }] } },
        ],
    };
    await window.fetch("/opensearch/_msearch");
    await wait(50);
    check("reason shown instead of a blank Error", toast()?.includes(reason), true);

    // and a response that only found nothing stays quiet
    fetchBody = { responses: [{ hits: { hits: [] }, _shards: { failed: 0 } }] };
    window.document.getElementById("lf-toast").textContent = "untouched";
    await window.fetch("/opensearch/_msearch");
    await wait(50);
    check("a clean response says nothing", toast(), "untouched");

    console.log(bad ? `\n${bad} failing` : "\nall cases pass");
    console.log("page errors:", errors); // must be []
    process.exit(0); // the 1s watcher would keep node alive
})();
