// Autocomplete presets for the in-page query editor.
//
// Loaded by both the popup and content.js (as the first content script, so its
// globals exist before content.js runs) — the two must agree on the shape kept
// in chrome.storage.local, so the defaults and the normaliser live here.
//
// Stored shape:  { active: "<id>", presets: { "<id>": { name, fields, values } } }
//   fields — field paths offered while typing a field name
//   values — field path → the values offered after its operator. Values seen in
//            the loaded logs are merged in on top of these at suggest time.

var LF_SUGGEST_KEY = "suggestPresets";

var LF_BUILTIN_PRESET_ID = "builtin";

var LF_BUILTIN_PRESET = {
    name: "Loan (built-in)",
    fields: [
        "kubernetes",
        "kubernetes.container_name",
        "json_payload",
        "json_payload.loan_app_id",
        "json_payload.tag",
        "json_payload.msg",
        "json_payload.trace_id",
        "json_payload.span_id",
        "json_payload.wf_traceparent",
        "json_payload.level",
    ],
    values: {
        "kubernetes.container_name": [
            "adaptor-account-cdd",
            "adaptor-account-dcb-vb",
            "adaptor-application-ccd",
            "adaptor-application-channel",
            "adaptor-application-ncb",
            "adaptor-document-alfresco",
            "adaptor-document-cmlos",
            "adaptor-document-email",
            "adaptor-document-signing",
            "adaptor-document-statement",
            "batch-account-stamp-duty-export",
            "batch-application-geography",
            "batch-application-notification",
            "batch-application-occupation",
            "batch-application-update-expired",
            "core-account-accept",
            "core-account-activate-flow",
            "core-account-calc-stamp-duty",
            "core-account-deduct-fees",
            "core-account-setup-revolvingloan",
            "core-account-update-kyc",
            "core-application-appform-package",
            "core-application-ccd-master",
            "core-application-compliant-check",
            "core-application-decision",
            "core-application-dre-consume",
            "core-application-ncb-consume",
            "core-application-personal-info",
            "core-application-request-consent",
            "core-application-request-form",
            "core-application-submit-flow",
            "core-document-alfresco-consume",
            "core-document-flow",
            "core-document-follow-up",
            "core-document-generate-report-go",
            "core-document-mgmt",
            "core-document-resend-contract",
            "core-document-send-email",
            "core-document-signing",
            "core-document-statement-consume",
            "core-foundation-centralize-log",
            "core-product-master",
            "dgl-vb",
            "orch-account-accept",
            "orch-application-form-mgmt",
            "orch-application-partner",
            "orch-document-mgmt",
            "orch-document-partner",
            "orch-document-upload",
            "orch-product-management",
            "orch-schedule",
            "proc-gotenberg",
        ],
    },
};

// A fresh copy every time — callers mutate what they get back.
function lfBuiltinPreset() {
    return {
        name: LF_BUILTIN_PRESET.name,
        fields: LF_BUILTIN_PRESET.fields.slice(),
        values: Object.fromEntries(
            Object.entries(LF_BUILTIN_PRESET.values).map(([k, v]) => [k, v.slice()]),
        ),
    };
}

var LF_STRINGS = (a) =>
    Array.isArray(a) ? a.map(String).filter((s) => s.trim()) : [];

// Storage can hold anything an older version (or a bad edit) left behind, and
// the suggestion code assumes arrays it can iterate — so every read goes
// through here and always comes back with at least one usable preset.
function lfNormalizeStore(raw) {
    const presets = {};
    const src = raw && typeof raw === "object" ? raw.presets : null;

    if (src && typeof src === "object") {
        for (const [id, p] of Object.entries(src)) {
            if (!p || typeof p !== "object") continue;
            const values = {};
            if (p.values && typeof p.values === "object")
                for (const [field, list] of Object.entries(p.values))
                    values[field] = LF_STRINGS(list);
            presets[id] = {
                name: String(p.name || id),
                fields: LF_STRINGS(p.fields),
                values,
            };
        }
    }

    if (!Object.keys(presets).length) presets[LF_BUILTIN_PRESET_ID] = lfBuiltinPreset();

    const active =
        raw && presets[raw.active] ? raw.active : Object.keys(presets).sort()[0];
    return { active, presets };
}

function lfActivePreset(store) {
    return store.presets[store.active] || lfBuiltinPreset();
}
