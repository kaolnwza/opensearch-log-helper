// The "Add filter" strip is where a =~ pill is drawn, so it must be visible
// unless the user said otherwise. Checks the default and both stored choices.
//   NODE_PATH=<dir with jsdom> node fbcheck.js    (LF_DIR to point elsewhere)
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const DIR = process.env.LF_DIR || path.resolve(__dirname, "../../../..");

const run = (stored) => {
    const dom = new JSDOM(
        `<!doctype html><html><body>
      <form class="osdQueryBar"><div class="euiFormControlLayout">
        <textarea data-test-subj="queryInput"></textarea></div></form>
      <button data-test-subj="querySubmitButton">Refresh</button>
      <div class="globalFilterGroup__wrapper"><button data-test-subj="addFilter">Add filter</button></div>
    </body></html>`,
        { url: "https://logs.example.com/app/data-explorer/discover", runScripts: "outside-only", pretendToBeVisual: true },
    );
    const { window } = dom;
    if (stored !== null) window.localStorage.setItem("lf_filterbar_hidden", stored);
    window.chrome = {
        storage: {
            local: { get: (k, cb) => cb({}), set: () => {} },
            onChanged: { addListener: () => {} },
        },
        runtime: { onMessage: { addListener: () => {} } },
    };
    window.Element.prototype.getBoundingClientRect = () => ({
        left: 100, top: 200, bottom: 218, right: 110, width: 10, height: 18,
    });
    ["suggest-presets.js", "content.js"].forEach((f) =>
        window.eval(fs.readFileSync(`${DIR}/${f}`, "utf8")),
    );
    // the style element is the whole mechanism: present => strip hidden. It
    // goes in when the page UI mounts, which is after waitFor(queryInput).
    return new Promise((r) =>
        setTimeout(() => r(!!window.document.getElementById("lf-chrome-style")), 900),
    );
};

(async () => {
let bad = 0;
const check = (name, got, want) => {
    const ok = got === want;
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${got}, want ${want}`}`);
};

check("nothing stored: strip is shown", await run(null), false);
check('stored "1": the user hid it, stays hidden', await run("1"), true);
check('stored "0": shown', await run("0"), false);
check("a stale value is not read as hidden", await run("true"), false);

console.log(bad ? `\n${bad} failing` : "\nall cases pass");
process.exit(0);
})();
