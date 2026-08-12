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
