# OpenSearch Log Helper

A Chrome extension that supercharges OpenSearch Dashboards Discover with:

- **Container name filter** — tag-based multi-select with autocomplete (OR/AND, Must/Must NOT)
- **JSON Payload search** — multi-term regex/wildcard/match filter
- **JSON Field Extractor** — inline column overlay showing extracted fields from `json_payload` per row
    - Dracula Dark / White themes
    - Resizable columns (widths saved in localStorage)
    - Collapsible full JSON viewer with syntax highlighting
    - `coalesce(field1, field2)` support
    - Level-based colour coding (ERROR=red, WARN=orange, INFO=green, DEBUG=blue)
    - Works even when `json_payload` is **not** a selected column (via fetch interceptor)
- **Editor suggestion presets** — one autocomplete preset per project, saved in extension storage:
  the field names the in-page query editor completes (`kubernetes.container_name`,
  `json_payload.loan_app_id`, …) and the values offered after an operator. New / rename /
  duplicate / delete from the popup, plus a ↺ button that restores the built-in preset.
  Values found in the loaded logs are suggested on top of the preset's own list.
- **Filter forms** — load a `.json` file of named Query DSL clauses in the panel and click one to run
  it. The clause is translated to Lucene, written into the query editor (with the original DSL above
  it as comments) and run through the search bar; clauses Lucene cannot express fall back to a filter
  pill. Click the lit button again to clear. The bundled `config/forms.config.json` is loaded on
  first run, both as a working set and as the file format to copy:

  ```json
  [
    {
      "dns": ["logs.prod.example"],
      "forms": [
        { "name": "prod errors", "dsl": { "match_phrase": { "level": "ERROR" } } },
        { "name": "prod only", "dsl": { "term": { "env": "prod" } } }
      ]
    },
    {
      "dns": ["*.dev.example", "localhost"],
      "forms": [
        { "name": "dev noise", "dsl": { "term": { "env": "dev" } } },
        { "name": "everywhere", "dns": ["*"], "dsl": { "match_all": {} } }
      ]
    }
  ]
  ```

  `dns` limits where a form appears, matched against the hostname of the tab. Put it on a group to
  gate every form in that group, or on a single form to gate that one button — a form's own `dns`
  wins over its group's. Omit it, or use `"*"`, for everywhere; `"*.example.com"` matches any
  subdomain and the bare domain. Groups can be mixed with loose forms in the same array.

  Colours are optional, apply to the section header text only (the buttons keep the theme's own
  look), and the two sections take them apart: `forms-color` paints the **FILTER FORMS** header,
  `links-color` the **LINKS** header, and a plain `color` is what either falls back to. A single
  entry can still override its group with its own `color`, and where two coloured groups are visible
  on one host, the first one on show paints the header.

  ```json
  [
    {
      "dns": ["logs.prod.example"],
      "forms-color": "#ff5555",
      "links-color": "#50fa7b",
      "forms": [{ "name": "prod errors", "dsl": { "match_phrase": { "level": "ERROR" } } }],
      "button-link": [{ "name": "runbook", "url": "https://wiki.example/runbook" }]
    },
    {
      "dns": ["*.dev.example"],
      "color": "#6272a4",
      "forms": [{ "name": "dev noise", "dsl": { "term": { "env": "dev" } } }]
    }
  ]
  ```

  All three keys also work at the top level of a `{ "forms": … }` object, where they colour the whole
  file. Only `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` and bare colour words (`tomato`) are
  accepted; anything else is dropped, since the value is written into a style attribute.

  Three older shapes still load unchanged: a flat array of forms, a single
  `{ "dns": …, "forms": [ … ] }` object, and a `{ "name": clause }` map. A top-level `"query"`
  wrapper and search-body keys (`size`, `sort`, `_source`, …) are stripped, so a body pasted straight
  out of the dev console works.
- **Link buttons** — the same file can carry a `button-link` list beside its forms. Each entry becomes
  a button in the panel's **LINKS** section that opens its `url` in a new tab, so the dashboards and
  runbooks that belong next to those filters sit one click away:

  ```json
  [
    {
      "dns": ["logs.prod.example"],
      "forms": [{ "name": "prod errors", "dsl": { "match_phrase": { "level": "ERROR" } } }],
      "button-link": [
        { "name": "runbook", "url": "https://wiki.example/runbook" },
        { "name": "grafana", "dns": ["*"], "url": "https://grafana.example/d/abc" }
      ]
    }
  ]
  ```

  A link inherits its group's `dns` and may override it with its own, exactly like a form, and
  `button-link` also works at the top level of a `{ "forms": … }` object or a `{ "name": clause }`
  map file. The section stays hidden until the loaded file has a link for this host. Only `http://`
  and `https://` urls are kept — anything else is dropped at load time, so a shared file cannot
  smuggle a `javascript:` url into the page. A file of nothing but links is fine.
- **Hide/Show columns** — hide raw Time / container_name / json_payload columns, showing only the overlay
- **Pop-out window** — pin the popup as a floating window so it stays open while you click OpenSearch
- **Lucene filter clearing** — Clear buttons strip the field from the query bar

## Install

1. Clone or download this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** → select this folder
5. Add `json_payload` to Selected fields
6. Set Query Language to Lucene

After editing any file: **Reload** on the extension card, then hard-reload the OpenSearch tab.

## Tests

`dsl-state.js` (rison, filter-pill state, the forms/links file normaliser) is plain browser script
with no build step, so it is covered by Node's own runner:

```sh
node --test test/
```
