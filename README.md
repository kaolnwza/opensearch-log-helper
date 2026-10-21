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
| `json_payload=~nil` | a **contains filter pill** | query DSL — see below |
| `t=~"a-b-c-d"` | `t*:("a-b-c-d" OR "b-c-d" OR *a-b-c-d*)` | when it can't be a pill |
| `ns:("a", "b", "c")` | `ns:("a" OR "b" OR "c")` | DQL has no comma lists |
| `!level="ERROR"` | `NOT level:"ERROR"` | `-` works too |
| `+level="ERROR"` | `level:"ERROR"` | every AND clause is required already |
| `level="A" and ...` | `level:"A" AND ...` | `and`/`or` upper-cased as you type |

`=` is the whole-value clause: OpenSearch picks `term` or `match` from the
field's own mapping (keyword vs text), so `kubernetes.container_name="x"` has to
match that whole keyword and `json_payload="x"` that whole phrase.

`=~` means **contains**, and it asks for the value two ways at once. A quoted
value alone cannot find a fragment of an analysed field: the phrase has to line
up with the analyser's tokens, and the standard analyser cuts at `-` but not at
`_`. A payload holding

```
"wf_traceparent": "01a10f52-…-9ef2eebff491_90963507-9cbc-…"
```

indexes `9ef2eebff491_90963507` as a single token, so the whole value matches as
a phrase while `json_payload="90963507-9cbc-…"` opens on a token no document has
— the fragment starts in the middle of one. Dropping its first part lines the
rest of the phrase back up with the document's tokens, which is the second
spelling `=~` sends.

A **whole-value** field has no tokens to line up with in the first place: a
`keyword`, or the `flat_object` that stores a `json_payload` as one string per
leaf, matches the complete value or nothing. There only a wildcard reaches
inside the value — and [DQL][dql] takes `*` "in both search terms and field
names" but **never inside a quoted phrase**, which is the one thing a fragment
search needs.

And `json_payload` may be no field at all. A payload mapped dynamically is an
**object**: what the mapping holds are its leaves — `json_payload.msg`,
`json_payload.wf_traceparent` — and a query against the object's own name is a
query against an unmapped field, which matches no document and **raises no
error**. That reads exactly like "nothing matched", which is how it stayed
hidden through several attempts; the same value found as free text (no field
name) searches every field and does match. So every spelling `=~` sends names
the field *and its subtree* — `f.*` in a `fields` list, `f*` in DQL, both
expanded against the mapping — and whichever of the two the payload turns out
to be, one of them is real.

So `=~` does not go through DQL at all. A clause on the top level of an AND
chain is lifted out of the query text and sent as a **filter pill carrying raw
query DSL** — the same thing *Add filter → Edit as Query DSL* writes by hand,
where none of DQL's rules apply:

```json
{ "bool": { "minimum_should_match": 1, "should": [
  { "multi_match":  { "type": "phrase", "query": "90963507-9cbc-4683-8832-7a91ce1219ad",
                      "fields": ["json_payload", "json_payload.*"], "lenient": true } },
  { "multi_match":  { "type": "phrase", "query": "9cbc-4683-8832-7a91ce1219ad",
                      "fields": ["json_payload", "json_payload.*"], "lenient": true } },
  { "wildcard":     { "json_payload": { "value": "*063b813d-dd59-…*",
                                        "case_insensitive": true } } },
  { "query_string": { "fields": ["json_payload", "json_payload.*"],
                      "query": "*063b813d\\-dd59\\-…*",
                      "analyze_wildcard": true, "lenient": true } }
]}}
```

One `should` per mapping: the whole value, the phrase from its second part on
(an analysed field, where the fragment starts mid-token — the standard analyser
cuts at `-` but not at `_`, so `…97a2ba292d92_063b813d-dd59…` holds no token
`063b813d`), and two wildcards for a whole-value field. Whichever the mapping
answers, the fragment is found.

The **term-level `wildcard`** is the one this cluster's `json_payload` answers,
and it is there because `query_string`'s wildcard is not the same query: that
one goes through the field's analyser first (`analyze_wildcard`) and comes back
empty on this field. The term-level form takes neither a field pattern nor
`lenient`, which is why the `query_string` form stays alongside it — that is
what reaches a *leaf* of the subtree (`json_payload.wf_traceparent`) when the
value lives there rather than in the field itself. A `phrase` `multi_match` over one field *is*
`match_phrase` — the form the query bar itself sends for a quoted DQL value —
but it takes the `f.*` subtree pattern, and it takes `lenient`, which
`match_phrase` cannot. Every clause with a `fields` pattern is a lenient one,
so a leaf of the subtree that cannot answer it (a date, a number, a field that
takes no wildcard) is skipped rather than failing the shard — which is what
makes the pattern usable at all. The term-level `wildcard` names one field and
has no `lenient`, so on a field type that takes no wildcard it is refused and
the search fails — with the reason in a toast, now that shard failures are read
out.

The pill is an ordinary filter: it shows up labelled `json_payload ~ 90963507…`,
and the filter bar's own menu edits, negates, disables or deletes it.

**No page reload, and no URL rewriting.** The pill goes into Discover's own
filter list — the `filterManager` React holds in the search bar's props — so it
lands the same way one you added by clicking a value does, and the search
re-runs by itself. Props are page objects, invisible to a content script, so
`interceptor.js` (which already runs in the page world) does that half and
answers whether it found the list; if it ever cannot, the clause stays in the
query as DQL and the editor says so. The query itself takes its usual route,
set in the query bar and submitted.

Re-running replaces the pill from the last run and leaves every other filter,
including the ones you added by clicking a value, alone.

A rejected search also gets a readable toast now: OpenSearch's own notice says
only *Error*, while the reason sits in the response the interceptor already
reads. A **shard failure** is worth the most here — it arrives inside a `200`
with no hits, so without the toast it is indistinguishable from "nothing
matched" — and an `_msearch` answers per request, so every response in the
batch is checked, not just the first.

A clause that cannot be a pill — inside a group, next to `or`, negated — stays
in the query text and compiles to the DQL form instead, under the subtree field
name `f*`: the value as written, OR the phrase from its second part on, OR
`*value*` unquoted (dropped when the value holds whitespace or DQL punctuation,
which force quoting). Same three spellings, within what DQL can say. If the page keeps no query state in its URL,
the editor falls back to that form too.

> Still nothing found? Then the field answers none of the three, and the query
> is not where the problem is. Check `GET <index>/_mapping/field/json_payload*`
> in Dev Tools — and note `=` is **not** subtree-aware, since it means one
> named field: on an object payload, write the leaf (`json_payload.msg="x"`).
> If the leaves come back as `flat_object`, they have no inverted index of
> their own, so reach one by its JSON path or have the pipeline index it as
> `keyword`.

[dql]: https://docs.opensearch.org/latest/dashboards/dql/

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
