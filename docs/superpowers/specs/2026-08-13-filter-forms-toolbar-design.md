# Filter Forms Toolbar

Date: 2026-08-13
Status: Approved, ready for implementation planning

## Problem

Reusing a non-trivial OpenSearch filter today means rebuilding it by hand in the "Edit as Query DSL"
popover every time. The popover keeps nothing, so a filter shared between teammates travels as a
pasted blob of JSON and has to be re-entered per person, per tab.

## Goal

A `FILTER FORMS` section in the in-page panel (`lf-panel`). The user loads one `.json` file holding
named Query DSL clauses; each becomes a button. Clicking a button applies that clause as a filter
pill and OpenSearch re-queries. Clicking the active button again removes it.

## Non-goals

- No editing of forms inside the extension. The `.json` file is the source of truth; edit it and
  re-load.
- No popup UI. This feature lives entirely in the in-page panel.
- No Lucene ⇄ DSL translation.
- No support for search-body keys (`size`, `sort`, `_source`, …); they are stripped, not honoured.
- One form active at a time.

---

## Architecture

One new file, a plain script declaring globals, matching the `suggest-presets.js` pattern already in
the repo. Keeping it out of `content.js` matters — that file is already ~3,800 lines.

| File | Loaded by | Responsibility |
|---|---|---|
| `dsl-state.js` | content scripts only | Rison encode/decode, reading and writing the OpenSearch app-state URL param, building/replacing/reading/removing our filter pill. Touches `location` only; no DOM queries, no top-level side effects. |

`manifest.json` content-script `js` array becomes:

```json
["dsl-state.js", "suggest-presets.js", "content.js"]
```

Everything else — the store normaliser, the file picker, the button list — is a new section in
`content.js` alongside the existing panel code.

`dsl-state.js` is deliberately scoped to be the same module the deferred
[DSL filter mode design](2026-08-13-dsl-filter-toggle-design.md) needs. Building it here means that
feature inherits it rather than duplicating it.

### Why the URL, not the DSL popover

Filters live in the rison-encoded app-state URL param. Writing them there needs no DOM automation, so
it does not break when OpenSearch changes its popover markup, and it sidesteps the Ace/Monaco editor
inside that popover, which ignores the native value setter the rest of this extension relies on. The
trade-off accepted here is owning a small rison codec.

Assigning `location.hash` fires `hashchange`, which OpenSearch's URL state sync listens for and which
`interceptor.js` already rebroadcasts as `__LF_NAV__`. The extractor overlays therefore refresh
themselves with no extra wiring, and no explicit re-query call is needed.

---

## Data shapes

### Store

```js
chrome.storage.local["filterForms"] = {
  file: "customer-filters.json",   // source label shown under the section header
  loaded: 1786555268123,           // epoch ms, rendered as a relative age
  forms: [
    { name: "cus1", dsl: { bool: { must: [ { term: { customer_id: "cus1" } } ] } } }
  ]
}
```

The active form is **not** persisted. It lives in the URL as the pill, which is the real source of
truth and survives reload and link-sharing on its own. The panel derives the highlighted button from
`lfGetDslFilterAlias()` when it opens.

### Accepted file shapes

All three normalise to the canonical array:

```jsonc
[ { "name": "cus1", "dsl": {…} } ]     // canonical
{ "forms": [ … ] }                      // wrapped
{ "cus1": {…}, "5xx": {…} }             // name → dsl map
```

The map form is cheap to support and is what a hand-written file tends to look like. An entry's `dsl`
may also be `{ "query": {…} }`, which is unwrapped to the inner clause.

### `lfNormalizeFilterForms(raw)`

Keeps entries that are objects carrying a non-empty string `name` and an object `dsl`; drops
everything else. Duplicate names are suffixed ` (2)`, ` (3)`, …. Returns
`{ forms, skipped }` so the caller can report the count. Every read of the store goes through it, so
whatever an older version left behind is tolerated.

### Filter pill

```json
{
  "$state": { "store": "appState" },
  "meta": {
    "alias": "LF: cus1",
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

`meta.alias` does three jobs: the pill's visible label, our ownership marker (prefix `LF: `), and the
name the panel matches to decide which button is lit.

---

## Behaviour

### Panel section

Rendered in `openPanel()` above the existing `QUERY EDITOR` row, themed with `T()` like the rest of
the injected UI:

```
FILTER FORMS                       ⤑ Load  ⟳
customer-filters.json · 6 forms · loaded 2h ago
┌───────────────────────────────────┐
│ 🔍 search…                        │
│ [ cus1 ] [ cus1 errors ] [ 5xx ]  │
│ [ timeout ] [ prod only ] [ … ]   │
└───────────────────────────────────┘
```

- Buttons wrap in a flex container. They reuse `panelButton()` but with `flex:0` so each sizes to its
  name. The active button gets the `primary` treatment (`th.border` background), which is how the
  rest of the panel already signals state.
- `⤑ Load` clicks a hidden `<input type="file" accept=".json">`. The same input is reused, with
  `value` reset to `""` after each pick so re-selecting the same file still fires `change`.
- `⟳` re-reads storage and re-syncs the highlight from the URL, for when the user has changed filters
  by hand in OpenSearch.
- The search box appears only when there are more than 8 forms. It filters by case-insensitive name
  substring.
- An empty store shows one italic `th.empty` line: `No filter forms — ⤑ Load a .json`.
- Names longer than ~22 characters are truncated, with the full name on the `title` attribute.

`content.js` subscribes to `chrome.storage.onChanged` for `filterForms` and re-renders when the panel
is open, mirroring how `suggestPresets` already works.

The section sits inside `initPageUI()`, so the existing `isOpenSearchPage()` guard covers it. No new
guard is needed.

### Clicking an inactive button

1. Strip search-body-only keys from the clause: `size`, `from`, `sort`, `_source`, `aggs`,
   `aggregations`, `track_total_hits`, `highlight`, `timeout`, `search_after`. A file exported from
   someone's dev console carries them, and they crash OpenSearch's label builder with
   `input.charAt is not a function`. Dropped key names go into the toast — nothing is removed
   silently.
2. Read the app-state param: `_q` first, then `_a`; the one that decodes to an object carrying a
   `filters` key wins.
3. Rison-decode it, then drop every entry whose `meta.alias` starts with `LF: `. Filters the user
   created by hand in OpenSearch are left alone.
4. Push the new pill.
5. Rison-encode, rebuild the hash, assign `location.hash`.

### Clicking the active button

Steps 2, 3 and 5 only — no push. The pill disappears and the highlight clears. This is the only
remove gesture; there is no separate clear control.

### Index pattern id

Resolved in order: the `meta.index` of any filter already in the state, then `_a.metadata.indexPattern`,
then omitted. When omitted the pill is still written and a toast says the index pattern could not be
resolved, so a user seeing a mis-rendered pill knows why.

### Rison subset

Encode and decode only what app state uses: objects `(k:v,…)`, arrays `!(a,b)`, `!t` / `!f` / `!n`,
numbers, bare ids where the character set allows, and `'…'` strings with `!'` and `!!` escapes.
Round-tripping an untouched param must be lossless — that is the property to get right first, since
every apply rewrites the whole param.

### `dsl-state.js` surface

| Function | Returns |
|---|---|
| `lfSetDslFilter(clause, name)` | `{ ok }` or `{ ok: false, error }` |
| `lfClearDslFilter()` | `{ ok }` or `{ ok: false, error }` |
| `lfGetDslFilterAlias()` | The active form's name, or `null` |

---

## Error handling

| Situation | Response |
|---|---|
| Picked file is not JSON | Toast with the parser's own message; the existing store is untouched |
| Some entries invalid | Valid ones loaded; toast `Loaded 4 forms · 2 skipped` |
| Zero valid entries | Toast `No valid filter forms in that file`; store untouched |
| Body-only keys in a clause | Applied without them; toast names each dropped key |
| Clause is not a non-empty object | Toast `cus1: not a query clause object`; nothing applied |
| No app-state param in the URL | Toast `Filter state not found in the URL — is this Discover?` |
| Rison decode fails on an existing param | Abort the write and toast; never overwrite state we could not read |

---

## Verification

The repo has no test runner, so verification is the manual pass below, run after reloading the
unpacked extension and hard-reloading the OpenSearch tab.

1. Load a file with three forms. The buttons appear and the count line reads `3 forms`.
2. Click `cus1`. A pill `LF: cus1` appears, the hit count changes, and the button is highlighted.
3. Click `5xx`. There is exactly one `LF:` pill, now `LF: 5xx`, and only one button is highlighted.
4. Click `5xx` again. The pill is gone, no button is highlighted, and the hit count returns.
5. Add a filter by hand in OpenSearch, then cycle through presets. The hand-made filter survives
   every step.
6. Reload the page with `cus1` active. The button is still highlighted, derived from the URL.
7. Load a file whose clause carries `size` and `sort`. It applies, and the toast names both.
8. Load a malformed file. A toast carries the parse error and the previous list is intact.
9. Load a map-shaped file, then a `{ "forms": [...] }` file. Both produce the same buttons.
10. Load a non-Discover page. No panel, no console errors (the `isOpenSearchPage()` guard).

## Open items deferred

- Editing or creating forms inside the extension.
- More than one form active at a time.
- Exporting the current filter state back out to a `.json` file.
