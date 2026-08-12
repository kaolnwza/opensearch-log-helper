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
- **Filter forms** — load a `.json` file of named Query DSL clauses in the panel and apply any of
  them as a filter with one click. Click the lit button again to remove it. Filters you made by hand
  in OpenSearch are never touched. The bundled `filter-forms.sample.json` is loaded on first run,
  both as a working set and as the file format to copy.
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
