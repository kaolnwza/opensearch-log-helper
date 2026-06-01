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
