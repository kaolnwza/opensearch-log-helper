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

// ── App-state URL param ───────────────────────────────────────────────────────
// The params sit in the *hash's* query string ("#/?_g=…&_q=…"), not the URL's,
// so URLSearchParams on location.search never sees them. Pairs are split by
// hand and their values left percent-encoded exactly as they arrived: rewriting
// one param must not reformat the others.

// encodeURIComponent leaves !'()* alone already; these two would otherwise turn
// a readable rison param into a wall of escapes.
function lfEncodeParamValue(str) {
    return encodeURIComponent(str).replace(/%2C/g, ",").replace(/%3A/g, ":");
}

function lfSplitHash(hash) {
    const qAt = hash.indexOf("?");
    const head = qAt < 0 ? hash : hash.slice(0, qAt);
    const rest = qAt < 0 ? "" : hash.slice(qAt + 1);
    const pairs = rest
        ? rest.split("&").map((p) => {
              const eq = p.indexOf("=");
              return eq < 0 ? [p, ""] : [p.slice(0, eq), p.slice(eq + 1)];
          })
        : [];
    return { head, pairs };
}

// data-explorer keeps filters in _q, classic Discover in _a — whichever decodes
// to an object with a `filters` key is the one to rewrite.
function lfFindFilterParam(href) {
    const at = String(href).indexOf("#");
    if (at < 0) return null;
    const { head, pairs } = lfSplitHash(String(href).slice(at + 1));

    for (const name of ["_q", "_a"]) {
        const idx = pairs.findIndex((p) => p[0] === name);
        if (idx < 0) continue;
        let state;
        try {
            state = lfRisonDecode(decodeURIComponent(pairs[idx][1]));
        } catch {
            // Never overwrite state we could not read
            return { error: `Could not read ${name} from the URL` };
        }
        if (state && typeof state === "object" && "filters" in state)
            return { head, pairs, idx, name, state };
    }
    return null;
}

function lfWriteState(found, state) {
    const pairs = found.pairs.slice();
    pairs[found.idx] = [found.name, lfEncodeParamValue(lfRisonEncode(state))];
    location.hash =
        found.head + "?" + pairs.map(([k, v]) => `${k}=${v}`).join("&");
}
