// Template: run content.js against a fake OpenSearch Discover page.
//   cd <scratchpad> && npm i jsdom && LF_DIR=/path/to/checkout node harness.js
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

// Set LF_DIR when running from a scratch copy; the fallback is the checkout
// this file is committed in.
const DIR = process.env.LF_DIR || path.resolve(__dirname, "../../..");
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

    type('json_payload.level="ERROR"\n-- a note\nAND json_payload.msg=~nil');
    key("Enter", { metaKey: true });
    await wait(300);
    console.log("submitted:", JSON.stringify(submitted));

    console.log("page errors:", errors); // must be []
    process.exit(0); // the 1s watcher would keep node alive
})();
