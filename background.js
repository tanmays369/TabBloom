/**
 * TabBloom — Background Script
 *
 * Captures tabs, runs grouping, manages named sessions,
 * and keeps the toolbar badge updated.
 */

let cachedSessionData = null;
let lastTabHash = "";

/* ------------------------------------------------------------------ */
/*  Tab Capture                                                       */
/* ------------------------------------------------------------------ */

async function captureAllTabs() {
  const tabs = await browser.tabs.query({});
  return tabs.map(t => ({
    url:        t.url || "",
    title:      t.title || "(untitled)",
    favIconUrl: t.favIconUrl || "",
    windowId:   t.windowId,
    tabId:      t.id,
    index:      t.index,
    pinned:     !!t.pinned,
    active:     !!t.active,
    timestamp:  Date.now(),
  }));
}

function buildWindowLabels(tabs) {
  const ids = [...new Set(tabs.map(t => t.windowId))].sort((a, b) => a - b);
  const labels = new Map();
  ids.forEach((id, i) => labels.set(id, `Window ${i + 1}`));
  return labels;
}

function buildWindowStructure(tabs, windowLabels) {
  const map = new Map();
  for (const tab of tabs) {
    if (!map.has(tab.windowId)) {
      map.set(tab.windowId, {
        windowId: tab.windowId,
        label: windowLabels.get(tab.windowId) || `Window ${tab.windowId}`,
        tabs: [],
      });
    }
    map.get(tab.windowId).tabs.push(tab);
  }
  return [...map.values()];
}

/* ------------------------------------------------------------------ */
/*  Memoized Grouping                                                 */
/* ------------------------------------------------------------------ */

function computeTabHash(tabs) {
  return tabs.map(t => `${t.tabId}:${t.url}`).sort().join("|");
}

async function getSessionData(forceRefresh = false) {
  const tabs = await captureAllTabs();
  const hash = computeTabHash(tabs);

  if (!forceRefresh && hash === lastTabHash && cachedSessionData) {
    return cachedSessionData;
  }

  const windowLabels = buildWindowLabels(tabs);
  const groups   = Grouper.groupTabs(tabs, windowLabels);
  const windows  = buildWindowStructure(tabs, windowLabels);

  cachedSessionData = {
    timestamp:    Date.now(),
    windows,
    groups,
    totalTabs:    tabs.length,
    totalWindows: windows.length,
  };
  lastTabHash = hash;
  updateBadge(tabs.length);
  return cachedSessionData;
}

/* ------------------------------------------------------------------ */
/*  Badge                                                             */
/* ------------------------------------------------------------------ */

function updateBadge(count) {
  try {
    browser.action.setBadgeText({ text: count > 0 ? String(count) : "" });
    browser.action.setBadgeBackgroundColor({ color: "#49483e" });
    browser.action.setBadgeTextColor({ color: "#f8f8f2" });
  } catch { /* badge API may not exist in older FF */ }
}

/* ------------------------------------------------------------------ */
/*  Session Persistence                                               */
/* ------------------------------------------------------------------ */

function autoSessionName(data) {
  const d = new Date(data.timestamp);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  const domains = new Map();
  for (const w of data.windows) {
    for (const t of w.tabs) {
      const dom = Grouper.extractDomain(t.url);
      if (dom !== "about" && dom !== "browser" && dom !== "other") {
        domains.set(dom, (domains.get(dom) || 0) + 1);
      }
    }
  }
  const top = [...domains.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([d]) => d.split(".")[0]);

  const suffix = top.length ? ` — ${top.join(", ")}` : "";
  return `${date}, ${time}${suffix}`;
}

function makeSerializable(data) {
  return {
    ...data,
    windows: data.windows.map(w => ({
      ...w,
      tabs: w.tabs.map(t => ({ ...t })),
    })),
    groups: data.groups.map(g => ({
      ...g,
      tabs: g.tabs.map(t => ({ ...t })),
    })),
  };
}

async function saveSession(name) {
  const data = await getSessionData(true);
  const { sessions = [] } = await browser.storage.local.get("sessions");

  const entry = makeSerializable(data);
  entry.name = name || autoSessionName(data);

  sessions.unshift(entry);
  if (sessions.length > 100) sessions.length = 100;
  await browser.storage.local.set({ sessions });
  return entry;
}

async function getSessions() {
  const { sessions = [] } = await browser.storage.local.get("sessions");
  return sessions;
}

async function deleteSession(index) {
  const { sessions = [] } = await browser.storage.local.get("sessions");
  if (index < 0 || index >= sessions.length) return false;
  sessions.splice(index, 1);
  await browser.storage.local.set({ sessions });
  return true;
}

async function renameSession(index, newName) {
  const { sessions = [] } = await browser.storage.local.get("sessions");
  if (index < 0 || index >= sessions.length) return false;
  sessions[index].name = newName;
  await browser.storage.local.set({ sessions });
  return true;
}

async function exportSession(index) {
  const { sessions = [] } = await browser.storage.local.get("sessions");
  if (index < 0 || index >= sessions.length) return null;
  return JSON.stringify(sessions[index], null, 2);
}

async function restoreSession(index) {
  const sessions = await getSessions();
  if (index < 0 || index >= sessions.length) return false;

  const session = sessions[index];
  for (const win of session.windows) {
    const created = await browser.windows.create({});
    for (const tab of win.tabs) {
      try {
        await browser.tabs.create({ windowId: created.id, url: tab.url });
      } catch { /* skip unrestorable tabs */ }
    }
    try {
      const first = (await browser.tabs.query({ windowId: created.id }))[0];
      if (first && (first.url === "about:newtab" || first.url === "about:blank")) {
        await browser.tabs.remove(first.id);
      }
    } catch {}
  }
  return true;
}

/* ------------------------------------------------------------------ */
/*  Message Router                                                    */
/* ------------------------------------------------------------------ */

browser.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "GET_SESSION_DATA":   return getSessionData(msg.forceRefresh);
    case "SAVE_SESSION":       return saveSession(msg.name);
    case "GET_SESSIONS":       return getSessions();
    case "DELETE_SESSION":     return deleteSession(msg.index);
    case "RENAME_SESSION":     return renameSession(msg.index, msg.name);
    case "EXPORT_SESSION":     return exportSession(msg.index);
    case "RESTORE_SESSION":    return restoreSession(msg.index);
    default:                   return Promise.resolve(null);
  }
});

/* ------------------------------------------------------------------ */
/*  Init badge on install / startup                                   */
/* ------------------------------------------------------------------ */

browser.tabs.query({}).then(tabs => updateBadge(tabs.length)).catch(() => {});
browser.tabs.onCreated.addListener(() => {
  browser.tabs.query({}).then(tabs => updateBadge(tabs.length)).catch(() => {});
});
browser.tabs.onRemoved.addListener(() => {
  setTimeout(() => {
    browser.tabs.query({}).then(tabs => updateBadge(tabs.length)).catch(() => {});
  }, 100);
});
