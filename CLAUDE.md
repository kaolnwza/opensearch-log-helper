# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension that augments **OpenSearch Dashboards Discover**. No build step, no
package.json, no dependencies, no tests — the source files in the repo root *are* what Chrome loads.

## Dev loop

There is no build or test command. To exercise a change:

1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder (first time only)
2. After editing any file, hit **Reload** on the extension card, then hard-reload the OpenSearch tab
   (content scripts are only injected on page load)
3. Two separate consoles: the page devtools console shows `content.js` + `interceptor.js`; the popup
   has its own console (right-click popup → Inspect)

`.claude/launch.json` defines a `popup-preview` config that serves the folder over
`python3 -m http.server 7823` — useful for iterating on `popup.html`/`popup.css` layout alone, but the
`chrome.*` APIs are unavailable there so most of `popup.js` no-ops.

Bump `version` in `manifest.json` when shipping a user-visible change.

## Architecture

Three execution contexts, all defined in `manifest.json`, injected only on URLs matching `*/app/*`:

| File | World | Role |
|---|---|---|
| `interceptor.js` | MAIN, `document_start` | Patches `fetch`/`XHR`/`history`, posts data to the page |
| `suggest-presets.js` | isolated, `document_idle` | Shared preset defaults + storage normaliser |
| `content.js` | isolated, `document_idle` | Everything else: overlays, editor, panel, filters |
| `popup.js` / `popup.html` | extension popup | Thin remote control over `chrome.tabs.sendMessage` |

### The data path (why `interceptor.js` exists)

Discover renders `json_payload` as a truncated cell, and only if the user selected that column. So the
real values are taken off the wire instead: `interceptor.js` runs in the **MAIN** world (content scripts
can't patch the page's `fetch`), catches `_search`/`_msearch` responses, parses each hit's
`json_payload`, grafts the sibling `_source.kubernetes` object onto it, and `postMessage`s the array as
`__LF_HITS__`. `content.js` caches it in `cachedPayloads` — indexed positionally, matching table row
order — and every overlay, suggestion value, and trace pivot reads from that cache.

Discover is an SPA, so the same file also patches `history.pushState`/`replaceState` and posts
`__LF_NAV__`; `content.js` uses that to purge stale overlays and re-run auto-apply.

Value resolution per row is a three-tier fallback (`resolveSpec` / `enrichFromRow`, content.js:794-885):
cached parsed JSON → regex scrape of the row's raw text → the matching sibling table column by header
name (works even when that column is hidden). Field specs support `coalesce(a, b)`, parsed by
`parseSpec`.

### Popup ⇄ content contract

`popup.js` never touches the DOM of the page. It calls `sendToContent(action, payload)`, which lands in
the single `chrome.runtime.onMessage` switch at the bottom of `content.js` (~line 3742). Adding a
feature that the popup triggers means: a case in that switch, a function in `content.js`, and a call in
`popup.js`. Handlers return `{ ok, ... }` or `{ ok: false, error }`; the listener returns `true` for the
async ones.

`content.js` also hosts an **in-page panel** (`lf-panel`, launched by a floating `lf-launcher` button)
that duplicates much of the extractor UI so the user doesn't have to keep the popup open. Panel state
and popup state are separate — the panel keeps its own `panelFields`.

### Persistence split

- **`chrome.storage.local`** — anything the popup and the page both need: `containerTags`,
  `payloadTags`, `payloadMode`, `extractFields`, `extractAuto`, `theme`, `suggestPresets`
  (the `LF_SUGGEST_KEY` store) and `filterForms` (`LF_FORMS_KEY`, the normalised forms file).
  `content.js` subscribes to `chrome.storage.onChanged` for `suggestPresets`, so preset edits apply
  live without a reload, and for `filterForms` — which it takes whether or not the panel is up,
  since its `suggest` block also feeds the editor's value completions.
- **`localStorage`** (page-scoped, `lf_*` keys) — purely visual state: `lf_col_widths`, `lf_theme`,
  `lf_query_src`, `lf_editor_height`, `lf_panel_open`, `lf_page_dark`, `lf_chart_hidden`,
  `lf_filter_bar`.

`dsl-state.js` and `suggest-presets.js` load before `content.js` and are both `<script>`-included by
`popup.html`, so the two sides share `lfNormalizeStore()` / `lfBuiltinPreset()` and, for the forms
store, `lfNormalizeFilterForms()` / `lfNormalizeSuggests()` / `lfHostMatches()`. Every read of either
store must go through its normaliser — they tolerate whatever an older version left behind (the
preset one always yields at least one preset). Changing a stored shape means changing it in that one
file.

### Custom query editor

`content.js` renders its own textarea over the query bar (section "Query editor", ~line 1918) because
OpenSearch's own bar hijacks arrow keys for its history popup. It adds, on top of Lucene:

- `#` comment lines (`stripLineComment` respects quotes and `/regex/` literals)
- shorthand ops: `field="v"` → `field:"v"`, `field=~"v"` → `field:/.*v.*/` (`compileQuerySugar`;
  `protectedRanges` keeps operators inside strings/regexes literal)
- bare `and`/`or` auto-uppercased, a formatter, and syntax colouring behind the transparent textarea

Submitting deliberately **never focuses** the OpenSearch input — focusing it opens the recent-searches
list, which would swallow the Enter key. `pushQueryToBar` sets the value natively (`setNativeValue`
uses the React value-setter) and clicks the submit button; `queryLanded` then verifies a distinctive
word from the query reached the `_q=(query:(…))` URL state and retries if not.

## Conventions

- **Page-safety guard**: the selectors in `SELECTORS` are loose enough to match a search box on half
  the web, so nothing renders until `isOpenSearchPage()` (checks `OSD_MARKERS`) passes. Any new
  injected UI must sit behind that check — see `initPageUI()`.
- **Selector lists, not selectors**: OpenSearch/Kibana markup varies by version. Add candidates to the
  arrays in `SELECTORS` / `LANG_SWITCH_BUTTON` / `SIDEBAR_SELECTED_LIST` and resolve with
  `findElement` / `findAllElements` (first match wins) rather than hardcoding one.
- **Async DOM waits** go through `waitFor(fn, timeout, interval)`.
- **Theming**: all injected colours come from the `THEMES.light` / `THEMES.dark` token maps, read via
  `T()`. Never inline a hex value in new UI — add a token.
- **Indentation**: `content.js` and `suggest-presets.js` use 4 spaces; `popup.js`/`popup.html`/
  `popup.css` use 2. Match the file.
- Comments in this codebase explain *why* (the OpenSearch quirk being worked around), not what. Keep
  that when adding to the section banners (`// ── Name ───`).

## User setup assumptions

The extension expects `json_payload` in Selected fields and Query Language set to Lucene (the popup can
switch the language via the `setQueryLanguage` action).
