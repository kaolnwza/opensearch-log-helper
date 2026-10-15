# OpenSearch Log Helper

A Chrome extension that supercharges OpenSearch Dashboards Discover.

Searches run as **DQL**, not Lucene — the extension flips OpenSearch's own query
language switcher before every search, and compiles what you write in the editor
into DQL on the way to the query bar.

## Install

1. Clone or download this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** → select this folder
5. Add `json_payload` to Selected fields

No query-language setup needed — the extension switches OpenSearch to DQL before
each search.

## Query editor

An in-page, multi-line editor sits under the search bar. It is the main way in:
write the query annotated and spread over as many lines as you like, and
OpenSearch receives one clean line.

| Key | Does |
|---|---|
| `⌘↵` | Run the query |
| `⌘/` | Comment / uncomment the selected lines |
| `⌥⇧F` | Format |
| `⌥↓` | Copy the current line |
| `Tab` | Accept the autocomplete suggestion |

Comment markers are `--`, `//` and `#`; commented lines are stripped before the
query runs, so notes can live next to the clause they explain.

### Shorthand

DQL's whole operator set is `and` / `or` / `not`, so the editor accepts a
friendlier syntax and translates it:

| You write | Runs as | |
|---|---|---|
| `level="ERROR"` | `level:"ERROR"` | quotes optional: `level=ERROR` |
| `json_payload=~nil` | `json_payload:"nil"` | same clause — see below |
| `ns:("a", "b", "c")` | `ns:("a" OR "b" OR "c")` | DQL has no comma lists |
| `!level="ERROR"` | `NOT level:"ERROR"` | `-` works too |
| `+level="ERROR"` | `level:"ERROR"` | every AND clause is required already |
| `level="A" and ...` | `level:"A" AND ...` | `and`/`or` upper-cased as you type |

`=` and `=~` compile to the same clause on purpose. DQL has no regex operator —
OpenSearch picks `term` or `match` from the field's own mapping (keyword vs
text), so `kubernetes.container_name=x` becomes a `term` query while
`json_payload=~x` becomes a `match`. Keep using whichever reads better; the two
are kept apart for your sake, not the engine's.

> `NOT field:"x"` also matches documents with **no** `field` at all. To exclude
> only documents that have it, write `field:* and not field:"x"`.

Autocomplete is preset-driven — see *Editor suggestion presets* below.

## Features

- **JSON Field Extractor** — inline column overlay showing fields pulled out of
  `json_payload`, one column per field
    - Dracula Dark / White themes
    - Resizable, drag-to-reorder columns (saved in localStorage)
    - Collapsible full JSON viewer with syntax highlighting
    - `coalesce(field1, field2)` support
    - Level-based colour coding (ERROR=red, WARN=orange, INFO=green, DEBUG=blue)
    - A trace button per row that pivots to that request's id in a time window
    - Works even when `json_payload` is **not** a selected column (via the fetch
      interceptor)
    - Starts on the `dev` preset until you save a field list of your own
- **Click to filter** — every overlay cell offers filter-for / filter-out / copy
- **Editor suggestion presets** — one autocomplete preset per project, saved in
  extension storage: the field names the editor completes
  (`kubernetes.container_name`, `json_payload.loan_app_id`, …) and the values
  offered after an operator. New / rename / duplicate / delete from the popup,
  plus a ↺ button that restores the built-in preset. Values found in the loaded
  logs are suggested on top of the preset's own list.
- **Hide/Show columns** — hide the raw Time / container_name / json_payload
  columns so only the overlay shows
- **Page chrome** — whole-page dark mode, and a toggle for OpenSearch's own
  "▽ ⊕ Add filter" strip (hidden by default, since everything here goes through
  the query string)
- **Themes** — Dracula Dark / White, applied to the popup and the in-page UI together
- **Pop-out window** — pin the popup as a floating window so it stays open while
  you click around OpenSearch

The `⌗ Fields` button in the bottom-right corner opens the same controls in the
page itself, so you can pick fields straight out of the logs.

## Developing

No build step: edit a file, then hit reload on `chrome://extensions`.

| File | World | Does |
|---|---|---|
| `interceptor.js` | MAIN, `document_start` | Patches `fetch`/XHR and `history.pushState`, broadcasting parsed hits and nav changes |
| `suggest-presets.js` | isolated + popup | The autocomplete presets; must load before `content.js` |
| `content.js` | isolated, `document_idle` | Everything on the page: editor, overlays, `⌗ Fields` panel, page chrome |
| `popup.*` | popup | Extractor field list, presets, theme, page toggles |

There is no test runner. Changes are checked by running the extension against a
fake Discover page in jsdom — see `.claude/skills/log-helper-dev/` for the
harness template and the house rules worth reading before changing the query
pipeline.
