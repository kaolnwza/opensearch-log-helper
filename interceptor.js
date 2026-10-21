// Runs in page (MAIN) world — patches fetch + XHR to capture OpenSearch
// search responses and broadcast json_payload values to the content script.
(function () {
  function broadcast(hits) {
    const payloads = hits.map((h) => {
      const src = h._source || {};
      const jp  = src.json_payload;
      if (!jp) return null;
      // Normalise: might already be an object or a JSON string
      let obj = (typeof jp === "object") ? jp : null;
      if (obj === null) { try { obj = JSON.parse(jp); } catch { return jp; } }
      // Attach sibling _source fields the extractor may reference
      // (e.g. kubernetes.container_name) without clobbering json_payload keys.
      if (obj && typeof obj === "object" && src.kubernetes && obj.kubernetes === undefined) {
        obj = { ...obj, kubernetes: src.kubernetes };
      }
      return obj;
    });
    window.postMessage({ type: "__LF_HITS__", payloads }, "*");
  }

  function extractHits(data) {
    try {
      return (
        data?.hits?.hits ||
        data?.responses?.[0]?.hits?.hits ||
        []
      );
    } catch { return []; }
  }

  // OpenSearch's own toast for a failed search says only "Error", so the one
  // thing worth knowing — why the query was rejected — is pulled out here.
  // A shard failure comes back inside a 200 with no hits, which otherwise
  // reads as "nothing matched"; an _msearch answers per request, and the one
  // that failed is not always the first.
  function responseError(r) {
    const of = (x) => (typeof x === "string" ? x : x?.caused_by?.reason || x?.reason);
    const shard = r?._shards?.failures?.[0]?.reason || r?.error?.failed_shards?.[0]?.reason;
    return of(shard) || of(r?.error) || null;
  }

  function searchError(data) {
    const rs = data?.responses;
    if (Array.isArray(rs)) {
      for (const r of rs) {
        const reason = responseError(r);
        if (reason) return reason;
      }
    }
    return responseError(data);
  }

  function broadcastError(data, ok) {
    const reason = searchError(data);
    if (reason || !ok)
      window.postMessage(
        { type: "__LF_SEARCH_ERR__", reason: reason || "search request failed" },
        "*",
      );
  }

  // ── Detect navigation / query changes ───────────────────────────────────
  // OpenSearch Discover updates the URL via history.pushState / replaceState
  // whenever the query, filters, or time range changes.
  function broadcastNav() {
    window.postMessage({ type: "__LF_NAV__" }, "*");
  }

  const origPush    = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...a) {
    origPush.apply(this, a);
    broadcastNav();
  };
  history.replaceState = function (...a) {
    origReplace.apply(this, a);
    broadcastNav();
  };
  window.addEventListener("hashchange", broadcastNav);
  window.addEventListener("popstate",   broadcastNav);

  // ── Filters ─────────────────────────────────────────────────────────────
  // DQL cannot express a substring search; a filter carrying raw query DSL can.
  // Only page JS can hand Discover one: the filter list lives in the data
  // plugin's filterManager, which React keeps in the search bar's props — and
  // props are page objects, invisible from the content script's world. So the
  // content script posts the filters and this runs them in.
  const FIBER_RE = /^__reactFiber\$|^__reactInternalInstance\$/;

  function fiberOf(node) {
    const key = Object.keys(node).find((k) => FIBER_RE.test(k));
    return key ? node[key] : null;
  }

  // Walk up from `node` for the nearest props that can change the filter list.
  function filterProps(node) {
    for (let f = fiberOf(node); f; f = f.return) {
      const p = f.memoizedProps;
      if (p && (p.filterManager || typeof p.onFiltersUpdated === "function"))
        return p;
    }
    return null;
  }

  // Any of these sits under the search bar, so its fiber chain reaches the
  // filter bar whichever way this build renders it.
  const FILTER_ROOTS = [
    '[data-test-subj="addFilter"]',
    ".globalFilterGroup__wrapper",
    '[data-test-subj="globalQueryBar"]',
    '[data-test-subj="queryInput"]',
  ];

  // Replace the filters marked as ours and leave every other one — including
  // the ones added by clicking a value — exactly where it is.
  function setFilters(incoming, marker) {
    for (const sel of FILTER_ROOTS) {
      const node = document.querySelector(sel);
      if (!node) continue;
      const props = filterProps(node);
      if (!props) continue;

      const current = props.filterManager?.getFilters?.() || props.filters || [];
      const index =
        props.indexPatterns?.[0]?.id || current[0]?.meta?.index || undefined;
      const next = incoming.map((f) => ({
        ...f,
        meta: { ...f.meta, index: f.meta?.index || index },
      }));
      const kept = current.filter((f) => !f?.meta?.[marker]);

      if (props.filterManager?.setFilters) props.filterManager.setFilters([...kept, ...next]);
      else props.onFiltersUpdated([...kept, ...next]);
      return true;
    }
    return false;
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.type !== "__LF_SET_FILTERS__") return;
    let ok = false;
    try {
      ok = setFilters(e.data.filters || [], e.data.marker || "lf");
    } catch {}
    window.postMessage({ type: "__LF_FILTERS__", ok }, "*");
  });

  // ── Patch fetch ─────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    const url = (typeof args[0] === "string" ? args[0] : args[0]?.url) || "";
    if (url.includes("_search") || url.includes("_msearch")) {
      res.clone().json().then((data) => {
        const hits = extractHits(data);
        if (hits.length) broadcast(hits);
        broadcastError(data, res.ok);
      }).catch(() => {});
    }
    return res;
  };

  // ── Patch XHR ───────────────────────────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__lfUrl = url;
    return origOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      const url = this.__lfUrl || "";
      if (!url.includes("_search") && !url.includes("_msearch")) return;
      try {
        const data = JSON.parse(this.responseText);
        const hits = extractHits(data);
        if (hits.length) broadcast(hits);
        broadcastError(data, this.status < 400);
      } catch {}
    });
    return origSend.apply(this, args);
  };
})();
