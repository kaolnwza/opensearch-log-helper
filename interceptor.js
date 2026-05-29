// Runs in page (MAIN) world — patches fetch + XHR to capture OpenSearch
// search responses and broadcast json_payload values to the content script.
(function () {
  function broadcast(hits) {
    const payloads = hits.map((h) => {
      const src = h._source || {};
      const jp  = src.json_payload;
      if (!jp) return null;
      // Normalise: might already be an object or a JSON string
      if (typeof jp === "object") return jp;
      try { return JSON.parse(jp); } catch { return jp; }
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

  // ── Patch fetch ─────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    const url = (typeof args[0] === "string" ? args[0] : args[0]?.url) || "";
    if (url.includes("_search") || url.includes("_msearch")) {
      res.clone().json().then((data) => {
        const hits = extractHits(data);
        if (hits.length) broadcast(hits);
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
        const hits = extractHits(JSON.parse(this.responseText));
        if (hits.length) broadcast(hits);
      } catch {}
    });
    return origSend.apply(this, args);
  };
})();
