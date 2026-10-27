// The DQL side of the query pipeline: what the editor compiles and pushes to
// the query bar. No interceptor.js on purpose — without the page world, `=~`
// falls back to its DQL spelling, which is what this sweeps.
//   NODE_PATH=<dir with jsdom> node smoke.js      (LF_DIR to point elsewhere)
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

// Set LF_DIR when running from a scratch copy; the fallback is the checkout
// this file is committed in.
const DIR = process.env.LF_DIR || path.resolve(__dirname, "../../../..");
// content.js reads suggest-presets.js's globals at load — same order as the manifest
const SCRIPTS = ["suggest-presets.js", "content.js"];

// Only include the parts of Discover the feature under test needs
const html = `<!doctype html><html><body>
  <form class="osdQueryBar"><div class="euiFormControlLayout">
    <textarea data-test-subj="queryInput"></textarea>
  </div></form>
  <button data-test-subj="querySubmitButton">Refresh</button>
  <div class="globalFilterGroup__wrapper"><button data-test-subj="addFilter">Add filter</button></div>
  <div class="dscCanvas">
    <div class="dscTimechart__header">Aug 1 - Aug 3 per <select><option>Auto</option></select></div>
    <div data-test-subj="discoverChart"><div class="echChart">chart</div></div>
    <table><thead><tr><th>time</th><th>kubernetes.container_name</th><th>json_payload</th></tr></thead>
      <tbody><tr>
        <td>2026-08-03</td><td>core-document-flow</td>
        <td>{"time":"2026-08-03T13:46:48Z","level":"ERROR","msg":"document borrower info is nil","loan_app_id":"PBCL1"}</td>
      </tr></tbody>
    </table>
  </div>
</body></html>`;

const dom = new JSDOM(html, {
    url: "https://logs.example.com/app/data-explorer/discover",
    runScripts: "outside-only",
    pretendToBeVisual: true,
});
const { window } = dom;

// chrome.* stub — `store` doubles as an assertion target
const store = {};
// content.js registers several storage listeners; fire() drives them all
const onChangedFns = [];
const fireStorageChange = (changes, area = "local") =>
    onChangedFns.forEach((fn) => fn(changes, area));
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

// jsdom has no layout: stub any rect the feature reads (caret popup, left-edge
// checks, …). Return per-element values when a test needs to tell them apart.
window.Element.prototype.getBoundingClientRect = () => ({
    left: 100, top: 200, bottom: 218, right: 110, width: 10, height: 18,
});

SCRIPTS.forEach((f) => window.eval(fs.readFileSync(`${DIR}/${f}`, "utf8")));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// jsdom's postMessage drops `source`, which content.js requires — dispatch by hand
const send = (type, data = {}) =>
    window.dispatchEvent(
        new window.MessageEvent("message", { data: { type, ...data }, source: window }),
    );

(async () => {
    const errors = [];
    window.addEventListener("error", (e) => errors.push(e.message));

    // Search results, as the interceptor would broadcast them
    send("__LF_HITS__", {
        payloads: [{ level: "ERROR", msg: "boom", kubernetes: { container_name: "core-document-flow" } }],
    });

    await wait(700); // the page UI mounts after waitFor(queryInput) resolves

    const editor = window.document.getElementById("lf-editor");
    const ta = editor.querySelector("textarea");
    const osd = window.document.querySelector('[data-test-subj="queryInput"]');

    let submitted = null;
    window.document
        .querySelector('[data-test-subj="querySubmitButton"]')
        .addEventListener("click", () => (submitted = osd.value));

    const type = (v, caret = v.length) => {
        ta.value = v;
        ta.selectionStart = ta.selectionEnd = caret;
        ta.dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    const key = (k, opts = {}) =>
        ta.dispatchEvent(
            new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }),
        );

    // `=~` names the field *and* its subtree (`f*`, which DQL takes in a
    // field name): a dynamically mapped json_payload is an object, and a
    // query on an object's own name matches nothing and raises no error.
    const cases = [
        // the reported case: the fragment starts mid-token, so the phrase
        // without its first part is what lines up with the analyser
        [
            'json_payload=~"90963507-9cbc-4683-8832-7a91ce1219ad"',
            'json_payload*:("90963507-9cbc-4683-8832-7a91ce1219ad" OR "9cbc-4683-8832-7a91ce1219ad" OR *90963507-9cbc-4683-8832-7a91ce1219ad*)',
        ],
        // the user's query, in full
        [
            'kubernetes.pod_namespace:(\n  "dgl-document", "dgl-application"\n, "dgl-protocol"\n)\n AND json_payload=~"90963507-9cbc-4683-8832-7a91ce1219ad"',
            'kubernetes.pod_namespace:("dgl-document" OR "dgl-application" OR "dgl-protocol") AND json_payload*:("90963507-9cbc-4683-8832-7a91ce1219ad" OR "9cbc-4683-8832-7a91ce1219ad" OR *90963507-9cbc-4683-8832-7a91ce1219ad*)',
        ],
        // one part: a trailing wildcard is safe, a leading one is not
        ["json_payload=~nil", 'json_payload*:("nil" OR *nil*)'],
        // too little left after dropping the first part — no alternative;
        // whitespace cannot go in unquoted, so no wildcard alternative either
        ['json_payload=~"borrower info"', 'json_payload*:"borrower info"'],
        // nor can DQL's own punctuation — only the phrase alternative is left
        [
            'json_payload=~"path=/api/v1/accounts/loc-create"',
            'json_payload*:("path=/api/v1/accounts/loc-create" OR "api/v1/accounts/loc-create")',
        ],
        // a bare value keeps its own leading "-" prefix operator
        ['-json_payload=~"a-b-c-d"', 'NOT json_payload*:("a-b-c-d" OR "b-c-d" OR *a-b-c-d*)'],
        // = is still the exact clause, and single-field on purpose
        ['json_payload.level="ERROR"', 'json_payload.level:"ERROR"'],
        // mixed, with a comment line and a boolean
        [
            'json_payload.level="ERROR"\n-- a note\nand json_payload.msg=~"a-b-c-d"',
            'json_payload.level:"ERROR" AND json_payload.msg*:("a-b-c-d" OR "b-c-d" OR *a-b-c-d*)',
        ],
        // negation still wraps the whole contains clause
        ['!json_payload=~"a-b-c-d"', 'NOT json_payload*:("a-b-c-d" OR "b-c-d" OR *a-b-c-d*)'],
        // value groups: = / : stay whole-value lists, =~ becomes contains
        [
            'kubernetes.container_name=("core-document-flow", "orch-schedule")',
            'kubernetes.container_name:("core-document-flow" OR "orch-schedule")',
        ],
        [
            'json_payload=~("a-b-c-d", "c")',
            'json_payload*:(("a-b-c-d" OR "b-c-d" OR *a-b-c-d*) OR ("c" OR *c*))',
        ],
        // native `:` is passed through untouched — raw wildcards still possible
        ["json_payload:*90963507*", "json_payload:*90963507*"],
        // nothing to match on → the value is passed through as before
        ['json_payload=~"*"', 'json_payload*:"*"'],
        // non-ASCII parts survive the split
        [
            'json_payload=~"ลูกค้า-a-b-c"',
            'json_payload*:("ลูกค้า-a-b-c" OR "a-b-c" OR *ลูกค้า-a-b-c*)',
        ],
    ];

    let bad = 0;
    for (const [src, want] of cases) {
        submitted = null;
        type(src);
        key("Enter", { metaKey: true });
        // No interceptor.js here on purpose: this harness covers the DQL
        // fallback, which waits out the page world before compiling.
        // 900ms is the floor (pushQueryToBar re-fires at 700) and flakes
        // there, so leave room.
        await wait(1100);
        const ok = submitted === want;
        if (!ok) bad++;
        console.log(
            `${ok ? "ok  " : "FAIL"} ${JSON.stringify(src)}` +
                (ok ? "" : `\n     got  ${JSON.stringify(submitted)}\n     want ${JSON.stringify(want)}`),
        );
    }
    console.log(bad ? `\n${bad} failing` : "\nall cases pass");

    console.log("page errors:", errors); // must be []
    process.exit(0); // the 1s watcher would keep node alive
})();
