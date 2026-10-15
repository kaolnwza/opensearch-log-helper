---
name: log-helper-dev
description: Work on the OpenSearch Log Filter Helper Chrome extension — the in-page query editor, the JSON field extractor overlays, or the popup. Use when changing content.js / interceptor.js / popup.*, and whenever a change needs verifying, since the extension has no build step and no test runner; it is checked with a jsdom harness that fakes the Discover page.
---

# OpenSearch Log Filter Helper

A Chrome MV3 extension that rewrites the OpenSearch Dashboards **Discover**
page: it adds a query editor, pulls fields out of `json_payload` into inline
columns, and trims the page chrome. No build step — edit the file, then reload
at `chrome://extensions`.

## Layout

| file | world | what it does |
|---|---|---|
| `interceptor.js` | MAIN, `document_start` | Patches `fetch`/XHR and `history.pushState`. Broadcasts `__LF_HITS__` (parsed `json_payload` per row) and `__LF_NAV__` (query/time/nav change) via `postMessage`. |
| `suggest-presets.js` | isolated + popup | Autocomplete presets: the built-in field/value lists and `lfNormalizeStore()`. Loaded **before** `content.js` (and by `popup.html`) — both read its globals at load, so anything evaluating `content.js` must evaluate this first. |
| `content.js` | isolated, `document_idle` | Everything on the page: query editor, extractor overlays, `⌗ Fields` panel, chart/filter-bar controls. ~2900 lines, sectioned by `// ── Title ──` banners. |
| `popup.js/html/css` | popup | Container / payload filters, the extractor's field list, and the suggestion-preset manager. Talks to `content.js` over `chrome.runtime.sendMessage`. |

Shared state lives in `chrome.storage.local` (`extractFields`, `extractAuto`,
`theme`, `suggestPresets`) so the popup and the in-page panel stay in sync;
per-page preferences (editor height, panel position, hidden chart) live in
`localStorage` under `lf_*` keys.

The editor's autocomplete is entirely preset-driven: the popup owns the presets,
`content.js` re-reads them from `storage.onChanged` (no reload), and values seen
in the loaded logs are merged on top of the preset's own list at suggest time.
Never hard-code a field or container name in `content.js` again — it belongs in
`LF_BUILTIN_PRESET`.

## The query pipeline

The editor holds annotated, multi-line text; OpenSearch only ever receives one
clean line. The search runs as **DQL**, never Lucene — `ensureDqlLanguage()`
flips OpenSearch's own language switcher before every submit, so everything
below compiles to DQL. `compileQuery(src)` is the whole pipeline; call it rather
than re-spelling the steps. Order matters — each step assumes the previous ran:

```
editor text
  → stripQueryComments()   -- // # comments removed, lines joined
  → expandValueGroups()    f:("a", "b") → f:("a" OR "b") · also f=(…), f=~(…)
  → compileQuerySugar()    f="v" and f=~"v" → f:"v"
  → expandPrefixOps()      !f / -f → NOT f · +f → f
  → upperBooleans()        standalone and/or → AND/OR
  → ensureDqlLanguage()    switcher → DQL, awaited before the push
  → pushQueryToBar()       set value, Escape, blur, click submit
```

Groups run *before* the sugar: the sugar's value pattern backtracks onto the
`~` of a `f=~(…)` head and leaves the group stranded otherwise. Prefixes run
*after* it, so a bare value the sugar has since quoted (`-5`, `a!b`) sits
behind a protected range and is left alone.

DQL's whole operator set is `and` / `or` / `not` — no regex, no comma lists, no
`!`/`-`/`+` prefixes. Anything else Lucene accepted has to be translated into
that set, or OpenSearch reads it as part of a field name and the search quietly
matches nothing instead of erroring. So `=` and `=~` both compile to `f:"v"` —
OpenSearch picks `term` vs `match` from the field's own mapping (keyword vs
text), and the two operators are kept for the author's intent, not because they
compile differently. `setQueryLanguage()` takes the *internal* id
(`kuery`), which is never the label shown — the switcher reads "DQL"/"KQL";
`LANGUAGE_LABELS` maps between them, so compare with `matchesLanguage()`.

Every step that rewrites text must skip `"quoted strings"` and `/regex/`
literals. Two helpers exist for that — use them instead of a bare regex:

- `stripLineComment(line)` — scans a line, tracking quote/regex state.
- `protectedRanges(q)` — index ranges covered by strings/regex; check with
  `ranges.some(([a, b]) => idx > a && idx < b)`.

## House rules

**Never focus OpenSearch's query bar.** Focusing it opens the recent-searches
popover, and a dispatched Enter then runs a *history entry* instead of the
query. Set the value, send Escape, blur, click `[data-test-subj="querySubmitButton"]`.

**Assume React re-renders everything.** Anything injected next to OpenSearch's
own DOM is re-seated by the 1s watcher in `watchQueryBar()` — move the same
node (listeners survive), never rebuild it. Style overrides on their elements
need `!important` or re-application.

**Don't fight the page.** The auto-collapse sidebar feature was removed because
OpenSearch re-renders the sidebar open while results load, so clicking it shut
produced a flicker loop. If a feature has to re-apply itself repeatedly against
the page's own state, cap the attempts or drop the feature.

**Colours come from the theme.** `T()` returns the active palette (`THEMES.light`
/ `.dark`); never hard-code a hex. Adding a colour means adding a key to both
themes.

**Editor keys are ours, everything else is native.** Only ⌘↵, ⌘/, ⌥⇧F, ⌥↓ and
Tab are intercepted; arrows, Home/End and Enter must stay native. ⌥⇧F is matched
on `e.code === "KeyF"` because ⌥⇧F is a dead key on a Mac layout.

## Verifying a change

There is no test runner. Run the extension against a fake Discover page in
jsdom — this catches ordering, event and DOM-shape bugs in seconds:

```bash
cd <scratchpad> && npm i jsdom
node smoke.js   # see harness.js in this skill folder for the template
```

Copy `harness.js` from this skill directory as the starting point. Gotchas that
will otherwise waste time:

- **jsdom's `postMessage` leaves `event.source` null**, and `content.js` checks
  `e.source !== window`. Dispatch a `MessageEvent` with `source: window` yourself.
- **No layout engine**: `getBoundingClientRect()` returns zeros, so anything
  positioned from the caret or filtered by screen position is skipped. Stub it.
- `scrollIntoView`, `execCommand` are missing — the code guards them, keep it
  that way.
- The 1s watcher keeps the process alive; end the script with `process.exit(0)`.
- Wait ~700ms after eval before asserting: the page UI mounts only once
  `waitFor(queryInput)` resolves (polls every 400ms).
- `content.js` registers **several** `storage.onChanged` listeners. A stub that
  keeps only the last one silently tests the wrong feature — collect them all
  (`fireStorageChange` in the template).

The popup takes the same treatment: load `popup.html` into jsdom (no
`runScripts`, so its `<script src>` tags stay inert), `window.eval`
`suggest-presets.js` then `popup.js`, and drive it with real click / keydown
events. Note the storage stub keeps live object references where Chrome would
serialise — hold on to the object you want to assert about, not its id.

Assert on observable behaviour — what got pushed to the query bar, which DOM
node was inserted, how many clicks were dispatched — not on internals, which
`window.eval` cannot reach anyway (top-level `let` is not on `window`).

Always finish with a sweep of the existing harness files; several fixes here
regressed an earlier one.
