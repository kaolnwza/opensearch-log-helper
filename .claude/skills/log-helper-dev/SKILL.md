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
| `interceptor.js` | MAIN, `document_start` | Patches `fetch`/XHR and `history.pushState`. Broadcasts `__LF_HITS__` (parsed `json_payload` per row), `__LF_NAV__` (query/time/nav change) and `__LF_SEARCH_ERR__` (the reason behind OpenSearch's blank "Error" toast — including a shard failure, which arrives inside a `200` with no hits and is otherwise indistinguishable from "nothing matched"; every `_msearch` response is checked, not just the first). Also owns the filter list: on `__LF_SET_FILTERS__` it walks React's fibers to the search bar's props and calls `filterManager.setFilters` / `onFiltersUpdated`, answering `__LF_FILTERS__` — props are page objects, so only this world can reach them. |
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
  → compileQuerySugar()    f="v" → f:"v" · f=~"a-b" → f*:("a-b" or … or *a-b*)
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
matches nothing instead of erroring. So `=` compiles to `f:"v"` and leaves the
rest to OpenSearch, which picks `term` vs `match` from the field's own mapping
(keyword vs text) — either way the clause has to match a whole keyword or a
whole phrase.

`=~` is the one that finds a *fragment*, and DQL cannot express it: quoting
makes a phrase, which has to line up with the analyser's tokens, and DQL takes
wildcards "in both search terms and field names" but *never inside a quoted
phrase*. **So `=~` leaves DQL.** `extractContains()` lifts every `=~` clause
sitting on the top level of an AND chain out of the query line, and
`containsFilter()` sends it as a filter carrying raw query DSL — one
`bool.should` per mapping (whole value · phrase from the second part on ·
term-level `wildcard` · `query_string: *value*` over the subtree), which is
what the bar's own *Edit as Query DSL* writes by hand.

**The two wildcards are not the same query.** `query_string`'s goes through the
field's analyser (`analyze_wildcard`) and finds nothing on the KTB cluster's
`json_payload`; the term-level `wildcard` (with `case_insensitive`) is the one
that answers, and it is the clause the feature rests on. It is kept company by
the `query_string` form because a term-level wildcard names exactly one field
and takes no `lenient` — only the pattern form reaches a *leaf* of the subtree,
and only it is safe on a leaf that takes no wildcard.

**A clause names the field and its subtree, never the field alone.** A
dynamically mapped `json_payload` is an *object*; the mapping holds its leaves,
and a query on an object's own name hits an unmapped field — which matches
nothing **and raises no error**, so it reads as "nothing matched". That cost
four wrong fixes. `fieldSubtree()` gives the DSL side `[f, "f.*"]` and
`containsField()` gives DQL `f*`; both are field patterns, expanded against the
mapping. The price is that every clause must be a form that takes `lenient`
(`multi_match` of type `phrase` rather than `match_phrase`, `query_string`
rather than `wildcard`), or a leaf that cannot answer it fails the whole shard.
`=` stays single-field on purpose: it means the one field the author named.

`applyContainsFilters()` posts them to the page world and waits for its answer;
the pill lands in Discover's own filter list, which is a React state change, so
the search re-runs by itself. The query then goes out through `pushQueryToBar()`
as always. **Do not write filters into the URL hash.** That was tried: the
state sync on the KTB cluster's build ignores a hash assignment, so the pill
never attached, the query bar kept its previous text, and every run needed a
manual reload — including runs with no `=~` in them, which went through the URL
only to clear a stale pill. `meta.lf` marks a pill as ours, so the next run
replaces it and leaves hand-added filters alone, and a run with none left sends
an empty list (`containsPills` remembers whether there is anything to take
off).

A clause that cannot be a pill (inside a group, next to `or`, negated) stays in
the query, and so does everything when the page keeps no query state in its URL.
`containsValue()` then OR's the same three spellings into the field's own value
list (`f:(a or b)` ≡ `f:a or f:b`):

| alternative | the mapping it is for |
|---|---|
| the value as written | the fragment is the whole value — never finds less than `=` |
| phrase minus its first part (`FIRST_PART_RE`) | analysed text, fragment starting mid-token: the standard analyser breaks at `-` but not `_`, so `…9ef2eebff491_90963507-9cbc…` has no token `90963507` for `"90963507-9cbc-…"` to start on |
| `*value*`, unquoted (`BARE_SAFE_RE`) | whole-value field — `keyword`, or the `flat_object` that holds a json_payload as one string per leaf, where no phrase can match a fragment |

all three under `containsField()`'s `f*`, for the same reason the pill uses the
subtree.


It shortens a phrase only while `CONTAINS_MIN_PARTS` parts remain (`"borrower
info"` must not become `"info"`), and drops `*value*` when the value cannot go
unquoted — whitespace or DQL punctuation. **Read the mapping, and the DQL docs, before theorising about the analyser.**
Four fixes here went out on guesses about the analyser that the field's own
behaviour had already ruled out, while the actual cause — the name being an
object rather than a leaf — produces a silent empty result that looks identical
to a bad query. When a clause finds nothing, first ask whether the *field*
exists: `GET <index>/_mapping/field/<name>*`, or whether the same value is
found as free text with no field name (which searches `*`, so it matches a
leaf the named clause never reached).

`setQueryLanguage()` takes the *internal* id
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

The filter path needs **both halves in one window** — eval `interceptor.js`
after `content.js` — and two things the real browser does for free:

- `window.postMessage` must be replaced with a `MessageEvent` dispatch carrying
  `source: window`, or the two halves ignore each other (both check `e.source`)
  and every run waits out the 500 ms timeout instead.
- `window.fetch` has to exist *before* `interceptor.js` is evaluated, since it
  wraps it; jsdom has none. A stub returning `{ ok, status, clone: () => ({
  json: async () => body }) }` is enough to drive the hit and error paths.
- Discover's props have to be faked: hang `__reactFiber$test =
  { memoizedProps: { filters, indexPatterns, onFiltersUpdated }, return: null }`
  on `[data-test-subj="addFilter"]` and assert on what `onFiltersUpdated` was
  handed.

Space runs ~900 ms apart in any harness that submits more than once:
`pushQueryToBar()` re-fires its own submit at 700 ms, and that lands in the
middle of the next assertion. A harness without `interceptor.js` exercises the
DQL fallback instead, which is what `smoke.js` is for — so a change here needs
*both* runs.

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
