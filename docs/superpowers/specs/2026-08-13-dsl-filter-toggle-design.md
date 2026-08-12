# DSL Filter Mode for the Query Editor

Date: 2026-08-13
Status: Approved, ready for implementation planning

## Problem

The in-page query editor writes Lucene into the OpenSearch query bar. Anything Lucene cannot
express — `minimum_should_match`, nested `bool` shapes, `range` on `@timestamp` independent of the
time picker — has to be written in OpenSearch's own "Edit as Query DSL" filter popover. That popover
is unforgiving: pasting a full search body into it (`size`, `_source`, `sort` alongside `query`)
crashes its label builder with `input.charAt is not a function`, and it offers no way to keep a
filter around for reuse.

## Goal

1. A `Lucene | DSL` toggle in the query editor. In DSL mode the editor holds raw Query DSL JSON and
   applying it writes a custom filter pill instead of query-bar text.
2. A named library of saved DSL filters, reachable from a `⛃ Filter by ▾` button in the editor
   toolbar and manageable from the extension popup, including export/import as `.json`.

## Non-goals

- No Lucene ⇄ DSL translation in either direction.
- No autocomplete inside DSL mode (the Lucene-mode suggestion list is suppressed there).
- No support for search-body keys (`size`, `sort`, `_source`, …); they are stripped, not honoured.

---

## Architecture

Two new files, both plain scripts declaring globals, matching the `suggest-presets.js` pattern
already in the repo. Keeping them out of `content.js` matters — that file is already ~3,800 lines.

| File | Loaded by | Responsibility |
|---|---|---|
| `dsl-query.js` | content scripts + `popup.html` | Pure data. Store shape/normaliser, and DSL text → clause normalisation. No DOM, no `location`, no top-level side effects. |
| `dsl-state.js` | content scripts only | Page state. Rison encode/decode, reading and writing the OpenSearch app-state URL param, building/replacing/reading/removing our filter pill. |

`manifest.json` content-script `js` array becomes:

```json
["dsl-query.js", "dsl-state.js", "suggest-presets.js", "content.js"]
```

`popup.html` gains one `<script src="dsl-query.js">` before `popup.js`.

### Why the URL, not the DSL popover

Filters live in the rison-encoded app-state URL param. Writing them there needs no DOM automation,
so it does not break when OpenSearch changes its popover markup, and it sidesteps the Ace/Monaco
editor inside that popover, which ignores the native value setter the rest of this extension relies
on. The trade-off accepted here is owning a small rison codec.

---

## Data shapes

### Saved filter store

```js
chrome.storage.local["dslFilters"] = {
  active: "cus1",
  filters: {
    cus1: { name: "cus1", json: "<raw text exactly as typed>" }
  }
}
```

`json` is stored as raw text rather than a re-serialised object so formatting and `//` comment lines
survive a save/load round-trip. Unlike `suggestPresets`, an empty store is legal — there is no
built-in filter to fall back on.

`lfNormalizeDslStore(raw)` coerces every `name` and `json` to a string, drops entries that are not
objects, and returns `{ active, filters }` with `active` pointing at an existing entry or `null` when
the store is empty. Every read goes through it, on both the popup and page side.

Live sync: `content.js` subscribes to `chrome.storage.onChanged` for `dslFilters` and re-renders the
drop-panel if it is open, mirroring how `suggestPresets` already works.

### Filter pill

```json
{
  "$state": { "store": "appState" },
  "meta": {
    "alias": "LF DSL",
    "type": "custom",
    "key": "query",
    "index": "<indexPatternId>",
    "disabled": false,
    "negate": false,
    "value": "<compact JSON string of query>"
  },
  "query": { "bool": { "…": "…" } }
}
```

`meta.alias` is both the pill's visible label and our ownership marker.

---

## Behaviour

### Editor mode

- `editorMode` is `"lucene"` or `"dsl"`, persisted in `localStorage` under `lf_editor_mode`
  (page-scoped visual state, matching the other `lf_*` keys).
- Two buffers, never cross-written: `lf_query_src` (existing, Lucene) and `lf_dsl_src` (new). The DSL
  buffer is seeded on first use with:

  ```json
  {
    "bool": {
      "must": []
    }
  }
  ```

- `setValue` / `saveQuerySource` write to whichever key the current mode owns. Toggling saves the
  current buffer, loads the other, repaints, and swaps the placeholder and footer hint. The editor is
  re-seated, not rebuilt: height, scroll, and listeners survive.

### Toolbar per mode

| Button | Lucene mode | DSL mode |
|---|---|---|
| `▶ Run` (⌘↵) | Push compiled query to the query bar (existing behaviour) | Normalise and write the filter pill |
| `// Comment` (⌘/) | Unchanged | Unchanged — `//` and `#` lines are stripped before parsing |
| `≡ Format` (⌥⇧F) | `formatQuery` | `JSON.stringify(JSON.parse(src), null, 2)`; toast carrying the parse error on failure |
| `⇩ Pull` | Copy query-bar text into the editor | Copy our pill's `query` back into the editor |
| `✕` | Clear text | Clear text only; the pill survives (removing it is `▶ Run` on an empty editor) |

### Colouring

DSL mode paints via a new `colourJson(src)` that tokenises raw text using the existing theme tokens
(`T().key`, `.str`, `.num`, `.bool_t`, `.bool_f`). The existing `syntaxHighlight()` cannot be reused
directly: it takes a parsed object, and editor text is invalid JSON for most of the time it is being
typed. Comment lines keep their italic `T().comment` treatment through the same line-splitting
wrapper `colourQuery` already uses.

### Normalising DSL before it becomes a pill

`lfNormalizeDsl(text)` returns `{ ok, query, dropped[], error }`:

1. Strip `//` and `#` comment lines. `dsl-query.js` carries its own `lfStripJsonComments(text)` rather
   than calling `content.js`'s `stripLineComment`: the popup loads `dsl-query.js` without
   `content.js`, so the file must stand alone. The JSON version is also simpler — it only has to
   respect `"quoted strings"`, with no `/regex/` literals to protect.
2. `JSON.parse`. On failure, return the parser's message verbatim.
3. If the result has a top-level `query` key, unwrap to it.
4. Delete search-body-only keys: `size`, `from`, `sort`, `_source`, `aggs`, `aggregations`,
   `track_total_hits`, `highlight`, `timeout`, `search_after`. Collect the names into `dropped` so
   the toast can name them — nothing is removed silently.
5. Fail if what remains is not a non-empty object.

Anything else passes through untouched: `{"bool": …}`, `{"match": …}`, and `{"range": …}` are all
valid clauses, so there is no allowlist of clause names to fall out of date.

This step is the fix for the crash that motivated the feature. A pasted search body is reduced to its
`query` clause rather than being handed to OpenSearch whole.

### Applying

`dsl-state.js` exposes `lfSetDslFilter(clause)`, `lfGetDslFilter()`, and `lfClearDslFilter()`.

Apply sequence:

1. Read the app-state param — `_q` first, then `_a`; the one that decodes to an object carrying a
   `filters` key wins.
2. Rison-decode it.
3. Drop every entry whose `meta.alias === "LF DSL"`.
4. Push the new pill (skipped when the editor is empty, which makes `▶ Run` on an empty editor the
   remove gesture).
5. Rison-encode, rebuild the hash, assign `location.hash`.

The assignment fires `hashchange`, which OpenSearch's URL state sync listens for, and which
`interceptor.js` already rebroadcasts as `__LF_NAV__`, so the extractor overlays refresh themselves
with no extra wiring.

Index-pattern id is resolved in order: the `meta.index` of any filter already in the state, then
`_a.metadata.indexPattern`, then omitted. When omitted, the pill is still written and a toast says
the index pattern could not be resolved, so a user seeing a mis-rendered pill knows why.

### Rison subset

Encode and decode only what app state uses: objects `(k:v,…)`, arrays `!(a,b)`, `!t` / `!f` / `!n`,
numbers, bare ids where the character set allows, and `'…'` strings with `!'` and `!!` escapes.
Round-tripping an untouched param must be lossless — that is the property the implementation should
be tested against first, since every apply rewrites the whole param.

### `⛃ Filter by ▾` drop-panel

Anchored under the toolbar button, themed with `T()` like the rest of the injected UI:

```
┌─ saved ─────────────────┐
│ 🔍 search…              │
│ cus1        [▶][✎][✕]  │
│ errors-10h  [▶][✎][✕]  │
│ + Save current as…      │
└─────────────────────────┘
```

- Row click: load that filter's text into the editor, switching to DSL mode first if needed. Nothing
  is queried.
- `▶`: load and apply in one step.
- `✎`: rename in place. `✕`: delete, with the row's name in a confirm toast.
- `+ Save current as…`: name row, saves the editor's current DSL text.
- Empty store shows a single "No saved filters yet" line above `+ Save current as…`.

### Popup section

A "Custom DSL filters" section below the existing suggestion presets:

- Select of saved filters, plus a New / Rename / Duplicate / Delete row reusing the existing
  `openNameRow` / `commitName` machinery.
- A JSON textarea bound to the selected filter, with a validity marker driven by `lfNormalizeDsl` —
  it shows the parse error or the list of keys that would be dropped.
- `Load into editor` and `Apply now`, which send the two new actions to the content script.
- `⤓ Export all` downloads the whole store as one `.json`; `⤑ Import` reads a file, validates it
  through `lfNormalizeDslStore`, and merges by name, suffixing conflicts ` (2)`, ` (3)`, ….

### New message actions

Added to the `chrome.runtime.onMessage` switch in `content.js`, following the existing
`{ ok, … }` / `{ ok: false, error }` convention:

| Action | Payload | Effect |
|---|---|---|
| `loadDsl` | `{ json }` | Switch editor to DSL mode, fill it, do not apply |
| `applyDsl` | `{ json }` | Same, then apply the pill |
| `getDsl` | — | Return the editor's current DSL text (backs "Save current as…" from the popup) |

---

## Error handling

| Situation | Response |
|---|---|
| Invalid JSON on Run or Format | Toast with the parser's own message; nothing is written to the URL |
| Body-only keys present | Applied without them; toast names each dropped key |
| Parsed value is not a non-empty object | Toast "DSL must be a query clause object"; nothing applied |
| No app-state param in the URL | Toast "Filter state not found in the URL — is this Discover?" |
| Index-pattern id unresolvable | Pill still written; toast notes the pill may not render until a filter exists |
| Rison decode fails on an existing param | Abort the write and toast; never overwrite state we could not read |

---

## Verification

The repo has no test runner, so verification is the manual pass below, run after reloading the
unpacked extension and hard-reloading the OpenSearch tab.

1. Toggle to DSL. The skeleton appears. Toggle back. The Lucene text is intact. Toggle again. The DSL
   text is intact.
2. Paste a full search body (the `cus1` example plus `size` / `sort` / `_source`). Run. The pill
   `LF DSL` appears, the hit count changes, and the toast names the dropped keys.
3. Run again after an edit. Still exactly one `LF DSL` pill.
4. Clear the editor and Run. The pill is gone. Filters created by hand in OpenSearch are untouched
   throughout.
5. `⇩ Pull` in DSL mode returns the applied clause.
6. Break the JSON deliberately. Run. A toast carries the parse error and the URL does not change.
7. Save as `cus1`, reload the page, open `⛃ Filter by`, click `cus1`. The editor fills, nothing runs.
   `▶` on the row applies it.
8. Export, then import the file into a clean browser profile. The list matches.
9. Load a non-Discover page. No editor, no toolbar, no console errors (the `isOpenSearchPage()`
   guard).

## Open items deferred

- Field-name autocomplete inside DSL strings.
- Jumping the caret to the offset in a `JSON.parse` error message.
- More than one owned pill at a time (named pills).
