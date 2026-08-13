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
  pill. Click the lit button again to clear. The bundled `filter-forms.sample.json` is loaded on
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

- **Links** — the same file may carry a `button-link` list beside its forms; each entry becomes a
  button in the panel's LINKS section that opens its `url` in a new tab. The section only appears
  when the file has links for this host.

  ```json
  [
    {
      "dns": ["logs.prod.example"],
      "forms": [{ "name": "prod errors", "dsl": { "match_phrase": { "level": "ERROR" } } }],
      "button-link": [{ "name": "runbook", "url": "https://wiki.example/runbook" }]
    }
  ]
  ```

  A link inherits its group's `dns` and may override it with its own, exactly like a form. Only
  `http://` and `https://` urls are kept — anything else is dropped when the file loads, so a shared
  file cannot smuggle a `javascript:` url into the page.

  Three older shapes still load unchanged: a flat array of forms, a single
  `{ "dns": …, "forms": [ … ] }` object, and a `{ "name": clause }` map. A top-level `"query"`
  wrapper and search-body keys (`size`, `sort`, `_source`, …) are stripped, so a body pasted straight
  out of the dev console works.
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
