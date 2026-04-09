/**
 * TabBloom — Deterministic Grouping Engine
 *
 * Pure module: no DOM access, no browser API calls.
 * Exposes three grouping strategies: context, domain-flat, and window.
 */

const Grouper = (() => {

  const STOPWORDS = new Set([
    "a","an","the","and","or","but","in","on","at","to","for","of","is",
    "it","by","with","as","from","that","this","be","are","was","were",
    "been","has","have","had","do","does","did","will","would","shall",
    "should","may","might","can","could","not","no","so","if","then",
    "than","too","very","just","about","above","after","before","between",
    "into","through","during","out","off","over","under","again","further",
    "page","home","index","default","untitled","new","tab","loading",
    "null","undefined","error","welcome","login","sign","click","here",
    "read","more","view","show","hide","open","close","next","prev",
    "previous","first","last","all","none","search","results","result",
  ]);

  const TRACKING_PARAMS = new Set([
    "utm_source","utm_medium","utm_campaign","utm_term","utm_content",
    "fbclid","gclid","dclid","msclkid","mc_cid","mc_eid","_ga","_gid",
    "yclid","ref","ref_src","ref_url","source","share_source","spm",
    "si","feature","context","sxsrf","ved","uact","oq","sclient",
  ]);

  const INTERNAL_PROTOCOLS = [
    "about:", "moz-extension:", "chrome:", "chrome-extension:",
    "data:", "blob:", "file:", "view-source:", "resource:",
  ];

  const TITLE_MERGE_THRESHOLD  = 0.35;
  const DEDUP_TITLE_THRESHOLD  = 0.85;
  const SINGLETON_MERGE_MIN    = 3;

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                           */
  /* ------------------------------------------------------------------ */

  function isInternalUrl(url) {
    if (!url) return true;
    for (const p of INTERNAL_PROTOCOLS) {
      if (url.startsWith(p)) return true;
    }
    return false;
  }

  function safeDecode(str) {
    try { return decodeURIComponent(str); } catch { return str; }
  }

  /* ------------------------------------------------------------------ */
  /*  1. URL Normalization                                              */
  /* ------------------------------------------------------------------ */

  function normalizeUrl(raw) {
    if (!raw || isInternalUrl(raw)) return raw || "";
    try {
      const u = new URL(raw);
      let host = u.hostname.toLowerCase();
      if (host.startsWith("www.")) host = host.slice(4);
      let path = safeDecode(u.pathname).replace(/\/+$/, "") || "/";
      return `${u.protocol}//${host}${path}`;
    } catch {
      return raw;
    }
  }

  function stripTracking(raw) {
    if (!raw || isInternalUrl(raw)) return raw || "";
    try {
      const u = new URL(raw);
      for (const key of [...u.searchParams.keys()]) {
        if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
      }
      return u.toString();
    } catch {
      return raw;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  2. Domain Extraction (subdomain-aware)                            */
  /* ------------------------------------------------------------------ */

  function extractDomain(raw) {
    if (!raw) return "other";
    if (isInternalUrl(raw)) {
      if (raw.startsWith("about:")) return "about";
      if (raw.startsWith("file:"))  return "local-files";
      return "browser";
    }
    try {
      let host = new URL(raw).hostname.toLowerCase();
      if (host.startsWith("www.")) host = host.slice(4);
      return host;
    } catch {
      return "other";
    }
  }

  /* ------------------------------------------------------------------ */
  /*  3. Path Tokenization                                              */
  /* ------------------------------------------------------------------ */

  const RE_PURE_NUMERIC   = /^\d+$/;
  const RE_HEX_HASH       = /^[0-9a-f]{8,}$/i;
  const RE_UUID            = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const RE_DATE_SEG        = /^\d{4}-\d{2}(-\d{2})?$/;
  const RE_LONG_RANDOM     = /^[a-z0-9_-]{32,}$/i;
  const RE_FILE_EXT        = /\.[a-z]{2,5}$/;

  function extractPathTokens(raw) {
    if (!raw || isInternalUrl(raw)) {
      if (raw && raw.startsWith("about:")) {
        const page = raw.slice(6).split(/[?#]/)[0];
        return page ? [page.toLowerCase()] : [];
      }
      return [];
    }
    try {
      const path = safeDecode(new URL(raw).pathname);
      return path
        .split("/")
        .filter(Boolean)
        .map(s => s.toLowerCase().replace(RE_FILE_EXT, ""))
        .filter(s => s.length > 0)
        .filter(s => !RE_PURE_NUMERIC.test(s))
        .filter(s => !RE_HEX_HASH.test(s))
        .filter(s => !RE_UUID.test(s))
        .filter(s => !RE_DATE_SEG.test(s))
        .filter(s => !RE_LONG_RANDOM.test(s));
    } catch {
      return [];
    }
  }

  /* ------------------------------------------------------------------ */
  /*  4. Cluster Key + Label                                            */
  /* ------------------------------------------------------------------ */

  function buildClusterKey(tab) {
    const domain = extractDomain(tab.url);
    if (domain === "about" || domain === "browser" || domain === "other" || domain === "local-files") {
      return domain;
    }
    const tokens = extractPathTokens(tab.url);
    if (tokens.length === 0) return domain;

    const first = tokens[0];
    const isNamespace = first.length <= 2 || first.startsWith("@") || first.startsWith("~");
    const depth = isNamespace
      ? Math.min(3, tokens.length)
      : Math.min(2, tokens.length);

    return `${domain}/${tokens.slice(0, depth).join("/")}`;
  }

  function deriveLabel(key, domain) {
    if (key === domain) return domain;
    const segments = key.split("/").slice(1);
    if (segments.length === 0) return domain;
    return segments
      .map(s => s.replace(/[-_]+/g, " "))
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" \u203A ");
  }

  /* ------------------------------------------------------------------ */
  /*  5. Initial Clustering                                             */
  /* ------------------------------------------------------------------ */

  function assignInitialClusters(tabs) {
    const clusters = new Map();
    for (const tab of tabs) {
      const key = buildClusterKey(tab);
      if (!clusters.has(key)) {
        const domain = extractDomain(tab.url);
        clusters.set(key, {
          key,
          domain,
          label: deriveLabel(key, domain),
          tabs: [],
          windowIds: new Set(),
        });
      }
      const c = clusters.get(key);
      c.tabs.push(tab);
      c.windowIds.add(tab.windowId);
    }
    return clusters;
  }

  /* ------------------------------------------------------------------ */
  /*  6. Title Similarity Merge                                         */
  /* ------------------------------------------------------------------ */

  function tokenizeTitle(title) {
    if (!title) return new Set();
    return new Set(
      title
        .toLowerCase()
        .replace(/[''""]/g, "'")
        .split(/[\s\-_|·:,./()[\]{}<>#@!?;=+*&^%$~`"'\\]+/)
        .map(t => t.trim())
        .filter(t => t.length > 1 && !STOPWORDS.has(t))
    );
  }

  function jaccardSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const t of setA) if (setB.has(t)) intersection++;
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  function clusterTitleBag(cluster) {
    const bag = new Set();
    for (const tab of cluster.tabs) {
      for (const t of tokenizeTitle(tab.title)) bag.add(t);
    }
    return bag;
  }

  function mergeClustersByTitleSimilarity(clusters) {
    const arr = [...clusters.values()];
    const merged = new Map();
    const consumed = new Set();

    for (let i = 0; i < arr.length; i++) {
      if (consumed.has(i)) continue;
      const base = arr[i];
      const baseBag = clusterTitleBag(base);

      for (let j = i + 1; j < arr.length; j++) {
        if (consumed.has(j)) continue;
        if (arr[j].domain !== base.domain) continue;

        const sim = jaccardSimilarity(baseBag, clusterTitleBag(arr[j]));
        if (sim >= TITLE_MERGE_THRESHOLD) {
          for (const tab of arr[j].tabs) base.tabs.push(tab);
          for (const wid of arr[j].windowIds) base.windowIds.add(wid);
          for (const t of clusterTitleBag(arr[j])) baseBag.add(t);
          if (arr[j].tabs.length > base.tabs.length - arr[j].tabs.length) {
            base.label = arr[j].label;
          }
          consumed.add(j);
        }
      }
      merged.set(base.key, base);
    }
    return merged;
  }

  /* ------------------------------------------------------------------ */
  /*  7. Singleton Cluster Merge                                        */
  /* ------------------------------------------------------------------ */

  function mergeSingletonClusters(clusters) {
    const domainSingletons = new Map();

    for (const [key, cluster] of clusters) {
      if (cluster.tabs.length === 1) {
        const d = cluster.domain;
        if (!domainSingletons.has(d)) domainSingletons.set(d, []);
        domainSingletons.get(d).push(key);
      }
    }

    for (const [domain, keys] of domainSingletons) {
      if (keys.length < SINGLETON_MERGE_MIN) continue;

      let hasLarger = false;
      for (const c of clusters.values()) {
        if (c.domain === domain && c.tabs.length > 1) { hasLarger = true; break; }
      }
      if (!hasLarger) continue;

      const mergedKey = `${domain}/_other`;
      const merged = {
        key: mergedKey,
        domain,
        label: "Other Pages",
        tabs: [],
        windowIds: new Set(),
      };

      for (const k of keys) {
        const c = clusters.get(k);
        for (const tab of c.tabs) merged.tabs.push(tab);
        for (const wid of c.windowIds) merged.windowIds.add(wid);
        clusters.delete(k);
      }
      clusters.set(mergedKey, merged);
    }
    return clusters;
  }

  /* ------------------------------------------------------------------ */
  /*  8. De-duplication                                                 */
  /* ------------------------------------------------------------------ */

  function deduplicateTabs(clusters) {
    for (const cluster of clusters.values()) {
      const seen = new Map();
      const deduped = [];

      for (const tab of cluster.tabs) {
        const norm = normalizeUrl(stripTracking(tab.url));
        if (seen.has(norm)) {
          const entry = seen.get(norm);
          entry.count++;
          if ((tab.title || "").length > (entry.tab.title || "").length) {
            entry.tab = tab;
          }
          continue;
        }

        let foundSimilar = false;
        const titleTokens = tokenizeTitle(tab.title);
        for (const [, existing] of seen) {
          if (jaccardSimilarity(titleTokens, tokenizeTitle(existing.tab.title)) >= DEDUP_TITLE_THRESHOLD) {
            existing.count++;
            if ((tab.title || "").length > (existing.tab.title || "").length) {
              existing.tab = tab;
            }
            foundSimilar = true;
            break;
          }
        }

        if (!foundSimilar) {
          const entry = { tab, count: 1 };
          seen.set(norm, entry);
          deduped.push(entry);
        }
      }
      cluster.tabs = deduped.map(e => ({ ...e.tab, dupCount: e.count }));
    }
    return clusters;
  }

  /* ------------------------------------------------------------------ */
  /*  9. Window Metadata Annotation                                     */
  /* ------------------------------------------------------------------ */

  function annotateWithWindowMetadata(clusters, windowLabels) {
    const result = [];
    for (const cluster of clusters.values()) {
      const windowBadges = [...cluster.windowIds]
        .sort((a, b) => a - b)
        .map(wid => windowLabels.get(wid) || `W${wid}`);
      result.push({
        key: cluster.key,
        domain: cluster.domain,
        label: cluster.label,
        tabCount: cluster.tabs.length,
        windowBadges,
        shared: cluster.windowIds.size > 1,
        tabs: cluster.tabs,
      });
    }
    result.sort((a, b) => {
      if (a.domain < b.domain) return -1;
      if (a.domain > b.domain) return 1;
      return b.tabCount - a.tabCount;
    });
    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  Context Pipeline (full)                                           */
  /* ------------------------------------------------------------------ */

  function groupTabs(tabs, windowLabels) {
    let clusters = assignInitialClusters(tabs);
    clusters = mergeClustersByTitleSimilarity(clusters);
    clusters = mergeSingletonClusters(clusters);
    clusters = deduplicateTabs(clusters);
    return annotateWithWindowMetadata(clusters, windowLabels);
  }

  /* ------------------------------------------------------------------ */
  /*  Domain-flat Grouping                                              */
  /* ------------------------------------------------------------------ */

  function groupByDomainFlat(tabs, windowLabels) {
    const map = new Map();
    for (const tab of tabs) {
      const domain = extractDomain(tab.url);
      if (!map.has(domain)) {
        map.set(domain, { tabs: [], windowIds: new Set() });
      }
      const g = map.get(domain);
      g.tabs.push(tab);
      g.windowIds.add(tab.windowId);
    }

    const result = [];
    for (const [domain, g] of map) {
      const badges = [...g.windowIds].sort((a, b) => a - b)
        .map(wid => windowLabels.get(wid) || `W${wid}`);
      result.push({
        key: `domain:${domain}`,
        domain,
        label: domain,
        tabCount: g.tabs.length,
        windowBadges: badges,
        shared: g.windowIds.size > 1,
        tabs: g.tabs,
      });
    }
    return result.sort((a, b) => b.tabCount - a.tabCount);
  }

  /* ------------------------------------------------------------------ */
  /*  Window Grouping                                                   */
  /* ------------------------------------------------------------------ */

  function groupByWindow(tabs, windowLabels) {
    const map = new Map();
    for (const tab of tabs) {
      const wid = tab.windowId;
      if (!map.has(wid)) {
        const label = windowLabels.get(wid) || `Window ${wid}`;
        map.set(wid, { label, tabs: [], wid });
      }
      map.get(wid).tabs.push(tab);
    }

    const result = [];
    for (const [wid, g] of map) {
      const domains = [...new Set(g.tabs.map(t => extractDomain(t.url)))];
      const domainPreview = domains.slice(0, 3).join(", ") + (domains.length > 3 ? "…" : "");
      result.push({
        key: `window:${wid}`,
        domain: g.label,
        label: domainPreview,
        tabCount: g.tabs.length,
        windowBadges: [windowLabels.get(wid) || `W${wid}`],
        shared: false,
        tabs: g.tabs,
      });
    }
    return result.sort((a, b) => b.tabCount - a.tabCount);
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  return {
    normalizeUrl,
    stripTracking,
    extractDomain,
    extractPathTokens,
    tokenizeTitle,
    jaccardSimilarity,
    isInternalUrl,
    groupTabs,
    groupByDomainFlat,
    groupByWindow,
  };
})();

if (typeof globalThis !== "undefined") {
  globalThis.Grouper = Grouper;
}
