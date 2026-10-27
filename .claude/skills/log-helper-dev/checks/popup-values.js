// The popup's value editor: which field it opens on, and .txt import/export.
//   NODE_PATH=<dir with jsdom> node popup-values.js  (LF_DIR to point elsewhere)
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const DIR = process.env.LF_DIR || path.resolve(__dirname, "../../../..");

// popup.html's own <script src> tags stay inert under "outside-only" — the
// scripts are evaluated by hand, in load order. It has to be "outside-only"
// and not left off: without it window.eval is Node's eval, with no document.
const dom = new JSDOM(fs.readFileSync(`${DIR}/popup.html`, "utf8"), {
    url: "chrome-extension://lf/popup.html",
    runScripts: "outside-only",
    pretendToBeVisual: true,
});
const { window } = dom;

// The storage stub keeps live references where Chrome would serialise, so
// hold on to the object asserted about, not its id
const store = {};
window.chrome = {
    storage: { local: { get: (k, cb) => cb({}), set: (o) => Object.assign(store, o) } },
    tabs: { query: async () => [{ id: 1 }], sendMessage: async () => ({ ok: true, hidden: false }) },
    runtime: { getManifest: () => ({ version: "9.9.9" }) },
};

// Downloads: record what an <a download> click would have saved. jsdom's own
// Blob cannot be read back (no .text()), so stand in one that keeps its parts.
const saved = [];
const RealBlob = window.Blob;
window.Blob = class {
    constructor(parts, opts) {
        this.parts = parts;
        this.type = opts?.type;
        this.real = new RealBlob(parts, opts);
    }
    text() {
        return this.parts.join("");
    }
};
window.URL.createObjectURL = (blob) => {
    saved.push({ blob });
    return "blob:lf/1";
};
window.URL.revokeObjectURL = () => {};
const origClick = window.HTMLElement.prototype.click;
window.HTMLElement.prototype.click = function () {
    if (this.tagName === "A" && this.download) {
        saved[saved.length - 1].name = this.download;
        return;
    }
    return origClick.apply(this, arguments);
};

["suggest-presets.js", "popup.js"].forEach((f) =>
    window.eval(fs.readFileSync(`${DIR}/${f}`, "utf8")),
);

const $ = (id) => window.document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
    if (!ok) console.log(`     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
};
// a File whose text() the popup awaits
const txt = (body) => ({
    name: "containers.txt",
    text: async () => body,
});
const pickFile = async (body) => {
    const input = $("file-values");
    Object.defineProperty(input, "files", { value: [txt(body)], configurable: true });
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    await wait(20);
};
const values = () =>
    store.suggestPresets.presets[store.suggestPresets.active].values[$("suggest-value-field").value];

(async () => {
    const errors = [];
    window.addEventListener("error", (e) => errors.push(e.message));

    // 1. the badge says what is actually loaded
    check("version badge comes from the manifest", $("version").textContent, "v9.9.9");

    // 2. it opens on the field that has values, not on its parent path
    check(
        "value editor lands on kubernetes.container_name",
        $("suggest-value-field").value,
        "kubernetes.container_name",
    );
    const builtin = window.eval("lfBuiltinPreset()").values["kubernetes.container_name"];
    check(
        "and shows the built-in list",
        $("suggest-value-box").querySelectorAll(".tag").length,
        builtin.length,
    );

    // 3. the shipped list itself: sorted, no duplicates — it is edited by
    // pasting batches in, which is exactly how a duplicate gets through
    check("built-in container list is sorted", builtin, [...builtin].sort());
    check("and has no duplicates", new Set(builtin).size, builtin.length);

    // 4. export writes one value per line, named after the field
    $("btn-values-export").dispatchEvent(new window.Event("click", { bubbles: true }));
    await wait(20);
    check("exported file is named after the field", saved[0]?.name, "kubernetes.container_name.txt");
    const text = await saved[0].blob.text();
    check("one value per line", text.trim().split("\n"), builtin);

    // 5. import replaces: the file is the list, so what it leaves out is gone
    await pickFile("core-new-service\n# a comment\n\n  core-document-flow  \ncore-new-service\n");
    const after = values();
    check("the file is the whole list now", after, ["core-new-service", "core-document-flow"]);
    check("a value repeated in the file lands once", after.filter((v) => v === "core-new-service").length, 1);
    check("comments and blank lines are skipped", after.includes("# a comment"), false);
    check("the box re-rendered", $("suggest-value-box").querySelectorAll(".tag").length, after.length);

    // ...and a column-formatted file, which is how these lists arrive from a
    // terminal. A single space stays inside the value; two or more is a gap.
    await pickFile("core-a    core-b\tcore-c\ndocument borrower info\n");
    check("columns split, a single space does not", values(), [
        "core-a",
        "core-b",
        "core-c",
        "document borrower info",
    ]);

    // 6. a file with nothing usable in it is refused, not applied — an empty
    // list would be an expensive way to lose a preset
    const columns = values();
    await pickFile("\n#only a comment\n   \n");
    check("an empty file leaves the list alone", values(), columns);
    check("and says so", $("status").className, "status error");

    console.log(bad ? `\n${bad} failing` : "\nall cases pass");
    console.log("page errors:", errors);
    process.exit(0);
})();
