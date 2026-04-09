/**
 * TabBloom — Popup UI Controller
 */

(() => {
  const $ = (id) => document.getElementById(id);

  const $stats         = $("stats");
  const $groupList     = $("groupList");
  const $detail        = $("detailPanel");
  const $modeToggle    = $("modeToggle");
  const $searchInput   = $("searchInput");
  const $btnSave       = $("btnSave");
  const $btnSessions   = $("btnSessions");
  const $btnRefresh    = $("btnRefresh");
  const $btnTheme      = $("btnTheme");
  const $saveOverlay   = $("saveOverlay");
  const $saveNameInput = $("saveNameInput");
  const $saveCancelBtn = $("saveCancelBtn");
  const $saveConfirmBtn= $("saveConfirmBtn");
  const $modal         = $("modalOverlay");
  const $modalClose    = $("modalClose");
  const $modalHeader   = $modal.querySelector(".modal-header h2");
  const $modalEl       = $modal.querySelector(".modal");
  const $sessionList   = $("sessionList");
  const $toastContainer= $("toastContainer");

  /* ---------------------------------------------------------------- */
  /*  State                                                           */
  /* ---------------------------------------------------------------- */

  let currentData  = null;
  let selectedKey  = null;
  let groupMode    = "context";
  let searchQuery  = "";
  let currentTheme = "system";
  const collapsedSections = new Set();

  /* ---------------------------------------------------------------- */
  /*  Icon color palette                                              */
  /* ---------------------------------------------------------------- */

  const ICON_PALETTE = [
    { bg: "var(--accent-green-bg)",  fg: "var(--accent-green)" },
    { bg: "var(--accent-cyan-bg)",   fg: "var(--accent-cyan)" },
    { bg: "var(--accent-orange-bg)", fg: "var(--accent-orange)" },
    { bg: "var(--accent-purple-bg)", fg: "var(--accent-purple)" },
    { bg: "var(--accent-yellow-bg)", fg: "var(--accent-yellow)" },
    { bg: "var(--accent-red-bg)",    fg: "var(--accent-red)" },
  ];

  const BAR_COLORS = [
    "var(--accent-cyan)", "var(--accent-green)", "var(--accent-orange)",
    "var(--accent-purple)", "var(--accent-yellow)", "var(--accent-red)",
  ];

  function domainHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function iconForDomain(domain) {
    const idx = domainHash(domain) % ICON_PALETTE.length;
    const c = ICON_PALETTE[idx];
    const letter = (domain || "?")[0].toUpperCase();
    return { letter, bg: c.bg, fg: c.fg };
  }

  /* ---------------------------------------------------------------- */
  /*  Theme                                                           */
  /* ---------------------------------------------------------------- */

  const THEME_ICONS = { system: "\u25D1", light: "\u2600", dark: "\u263E" };
  const THEME_ORDER = ["system", "light", "dark"];

  async function initTheme() {
    try {
      const { theme } = await browser.storage.local.get("theme");
      if (theme) currentTheme = theme;
    } catch {}
    applyTheme();
  }

  function applyTheme() {
    const root = document.documentElement;
    if (currentTheme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", currentTheme);
    }
    $btnTheme.textContent = THEME_ICONS[currentTheme];
    $btnTheme.title = `Theme: ${currentTheme}`;
  }

  function cycleTheme() {
    const idx = THEME_ORDER.indexOf(currentTheme);
    currentTheme = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    applyTheme();
    browser.storage.local.set({ theme: currentTheme }).catch(() => {});
    toast(`Theme: ${currentTheme}`, "info");
  }

  $btnTheme.addEventListener("click", cycleTheme);

  /* ---------------------------------------------------------------- */
  /*  Toast                                                           */
  /* ---------------------------------------------------------------- */

  function toast(message, type = "success") {
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.textContent = message;
    $toastContainer.appendChild(el);
    requestAnimationFrame(() => el.classList.add("visible"));
    setTimeout(() => {
      el.classList.remove("visible");
      setTimeout(() => el.remove(), 200);
    }, 2200);
  }

  /* ---------------------------------------------------------------- */
  /*  Data                                                            */
  /* ---------------------------------------------------------------- */

  async function loadData(forceRefresh = false) {
    try {
      currentData = await browser.runtime.sendMessage({
        type: "GET_SESSION_DATA", forceRefresh,
      });
      if (!currentData) throw new Error();
    } catch {
      currentData = await buildLocalData();
    }
    render();
  }

  async function buildLocalData() {
    const tabs = (await browser.tabs.query({})).map(t => ({
      url: t.url || "", title: t.title || "(untitled)",
      favIconUrl: t.favIconUrl || "", windowId: t.windowId,
      tabId: t.id, index: t.index, pinned: !!t.pinned,
      active: !!t.active, timestamp: Date.now(),
    }));

    const ids = [...new Set(tabs.map(t => t.windowId))].sort((a, b) => a - b);
    const wl = new Map();
    ids.forEach((id, i) => wl.set(id, `Window ${i + 1}`));

    const groups = Grouper.groupTabs(tabs, wl);
    const windowMap = new Map();
    for (const tab of tabs) {
      if (!windowMap.has(tab.windowId)) {
        windowMap.set(tab.windowId, {
          windowId: tab.windowId, label: wl.get(tab.windowId), tabs: [],
        });
      }
      windowMap.get(tab.windowId).tabs.push(tab);
    }

    return {
      timestamp: Date.now(), windows: [...windowMap.values()],
      groups, totalTabs: tabs.length, totalWindows: windowMap.size,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Grouping Modes                                                  */
  /* ---------------------------------------------------------------- */

  function windowLabelsMap() {
    if (!currentData) return new Map();
    const ids = [...new Set(currentData.windows.map(w => w.windowId))].sort((a, b) => a - b);
    const m = new Map();
    ids.forEach((id, i) => m.set(id, `Window ${i + 1}`));
    return m;
  }

  function allTabs() {
    return currentData ? currentData.windows.flatMap(w => w.tabs) : [];
  }

  function computeGroups() {
    if (!currentData) return [];
    const tabs = allTabs();
    const wl = windowLabelsMap();
    switch (groupMode) {
      case "domain": return Grouper.groupByDomainFlat(tabs, wl);
      case "window": return Grouper.groupByWindow(tabs, wl);
      default:       return currentData.groups;
    }
  }

  function filteredGroups() {
    const groups = computeGroups();
    if (!searchQuery) return groups;
    const q = searchQuery.toLowerCase();
    return groups.filter(g =>
      g.domain.toLowerCase().includes(q) ||
      g.label.toLowerCase().includes(q) ||
      g.tabs.some(t =>
        (t.title || "").toLowerCase().includes(q) ||
        (t.url || "").toLowerCase().includes(q)
      )
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Hierarchy                                                       */
  /* ---------------------------------------------------------------- */

  function buildHierarchy(groups) {
    if (groupMode === "window") {
      return { sections: [{ key: "_all", label: "All Windows", count: null, groups }], shared: [] };
    }

    const windowTabCounts = new Map();
    if (currentData) {
      for (const w of currentData.windows) windowTabCounts.set(w.label, w.tabs.length);
    }

    const byWindow = new Map();
    const shared = [];

    for (const g of groups) {
      if (g.shared) {
        shared.push(g);
      } else {
        const wLabel = g.windowBadges[0] || "Unknown";
        if (!byWindow.has(wLabel)) byWindow.set(wLabel, []);
        byWindow.get(wLabel).push(g);
      }
    }

    const sections = [];
    for (const [label, windowGroups] of byWindow) {
      sections.push({
        key: `win:${label}`, label,
        count: windowTabCounts.get(label) || windowGroups.reduce((s, g) => s + g.tabCount, 0),
        groups: windowGroups,
      });
    }
    sections.sort((a, b) => a.label.localeCompare(b.label));
    return { sections, shared };
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  function render() {
    if (!currentData) return;

    const tw = currentData.totalWindows;
    $stats.textContent = `${currentData.totalTabs} tabs \u00B7 ${tw} window${tw !== 1 ? "s" : ""}`;

    const groups = filteredGroups();
    renderGroupList(groups);

    if (selectedKey) {
      const match = groups.find(g => g.key === selectedKey);
      if (match) { renderDetail(match); return; }
    }
    if (groups.length) {
      selectedKey = groups[0].key;
      document.querySelectorAll(".group-card").forEach((c, i) =>
        c.classList.toggle("selected", i === 0)
      );
      renderDetail(groups[0]);
    } else {
      selectedKey = null;
      renderDetailEmpty();
    }
  }

  /* ---- Group list ---- */

  function renderGroupList(groups) {
    $groupList.innerHTML = "";

    if (groups.length === 0) {
      $groupList.innerHTML = `<div class="group-empty">${searchQuery ? "No matches" : "No tabs"}</div>`;
      return;
    }

    const { sections, shared } = buildHierarchy(groups);
    const needsSections = sections.length > 1 || shared.length > 0;

    if (!needsSections && sections.length === 1) {
      for (const g of sections[0].groups) $groupList.appendChild(buildGroupCard(g));
      return;
    }

    for (const section of sections) {
      $groupList.appendChild(buildWindowSection(section.key, section.label, section.count, section.groups));
    }
    if (shared.length) {
      $groupList.appendChild(buildWindowSection("_shared", "Shared Across Windows", null, shared));
    }
  }

  function buildWindowSection(key, label, count, groups) {
    const section = document.createElement("div");
    section.className = "window-section" + (collapsedSections.has(key) ? " collapsed" : "");

    const header = document.createElement("div");
    header.className = "window-header";
    header.innerHTML = `
      <span class="window-header-caret">\u25BE</span>
      <span class="window-header-label">${esc(label)}</span>
      ${count != null ? `<span class="window-header-count">${count} tabs</span>` : ""}
    `;
    header.addEventListener("click", () => {
      section.classList.toggle("collapsed");
      if (section.classList.contains("collapsed")) collapsedSections.add(key);
      else collapsedSections.delete(key);
    });

    const body = document.createElement("div");
    body.className = "window-body";
    for (const g of groups) body.appendChild(buildGroupCard(g));

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  function buildGroupCard(g) {
    const card = document.createElement("div");
    card.className = "group-card" + (g.key === selectedKey ? " selected" : "");
    card.tabIndex = 0;

    const hasPinned = g.tabs.some(t => t.pinned);
    const icon = iconForDomain(g.domain);

    card.innerHTML = `
      <div class="group-top">
        <span class="group-icon" style="background:${icon.bg};color:${icon.fg}">${esc(icon.letter)}</span>
        <span class="group-domain">${esc(g.domain)}</span>
        <span class="group-count">${g.tabCount}</span>
      </div>
      ${g.label !== g.domain ? `<div class="group-label" title="${esc(g.label)}">${esc(g.label)}</div>` : ""}
      <div class="group-footer">
        ${g.shared ? g.windowBadges.map(b => `<span class="badge badge-window">${esc(b)}</span>`).join("") : ""}
        ${g.shared ? '<span class="badge badge-shared">Shared</span>' : ""}
        ${hasPinned ? '<span class="badge badge-pinned">Pinned</span>' : ""}
      </div>
    `;

    card.addEventListener("click", () => selectGroup(g, card));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectGroup(g, card); }
    });
    return card;
  }

  function selectGroup(group, card) {
    selectedKey = group.key;
    document.querySelectorAll(".group-card").forEach(c => c.classList.remove("selected"));
    card.classList.add("selected");
    renderDetail(group);
  }

  /* ---- Detail panel ---- */

  function renderDetail(group) {
    const titleText = group.label !== group.domain
      ? `${esc(group.domain)} \u2014 ${esc(group.label)}`
      : esc(group.domain);

    const parts = [`${group.tabCount} tab${group.tabCount !== 1 ? "s" : ""}`];
    if (group.shared) parts.push("Shared across windows");
    const pinned = group.tabs.filter(t => t.pinned).length;
    if (pinned) parts.push(`${pinned} pinned`);

    $detail.innerHTML = `
      <div class="detail-header">
        <div class="detail-header-info">
          <h2 title="${titleText}">${titleText}</h2>
          <p>${parts.join(" \u00B7 ")}</p>
        </div>
        <div class="detail-actions">
          <button class="btn btn-sm" id="btnCopyUrls">Copy URLs</button>
          <button class="btn btn-sm btn-primary" id="btnOpenAll">Open All</button>
        </div>
      </div>
      <div class="detail-body">
        <div class="tab-list" id="tabListInner"></div>
      </div>
    `;

    $("btnOpenAll").addEventListener("click", () => {
      for (const tab of group.tabs) browser.tabs.create({ url: tab.url });
      toast(`Opened ${group.tabs.length} tab${group.tabs.length !== 1 ? "s" : ""}`, "info");
    });

    $("btnCopyUrls").addEventListener("click", async () => {
      const text = group.tabs.map(t => t.url).join("\n");
      try { await navigator.clipboard.writeText(text); toast("URLs copied"); }
      catch { toast("Could not copy", "warn"); }
    });

    const list = $("tabListInner");
    for (const tab of group.tabs) list.appendChild(buildTabItem(tab));
  }

  function buildTabItem(tab) {
    const item = document.createElement("div");
    item.className = "tab-item";

    const faviconHtml = tab.favIconUrl
      ? `<img class="tab-favicon" src="${esc(tab.favIconUrl)}" alt=""
           onerror="this.outerHTML='<div class=\\'tab-favicon-placeholder\\'>${esc((tab.title || "?")[0].toUpperCase())}</div>'">`
      : `<div class="tab-favicon-placeholder">${esc((tab.title || "?")[0].toUpperCase())}</div>`;

    const badges = [];
    if (tab.active)       badges.push('<span class="tab-badge-active" title="Active"></span>');
    if (tab.pinned)       badges.push('<span class="tab-badge-pinned">Pin</span>');
    if (tab.dupCount > 1) badges.push(`<span class="tab-dup">\u00D7${tab.dupCount}</span>`);

    item.innerHTML = `
      ${faviconHtml}
      <div class="tab-info">
        <div class="tab-title" title="${esc(tab.title)}">${esc(tab.title)}</div>
        <div class="tab-url" title="${esc(tab.url)}">${esc(shortUrl(tab.url))}</div>
      </div>
      <div class="tab-meta">
        ${badges.join("")}
        <button class="tab-open-btn">Open</button>
      </div>
    `;

    item.querySelector(".tab-open-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      browser.tabs.create({ url: tab.url });
    });
    return item;
  }

  function renderDetailEmpty() {
    $detail.innerHTML = `
      <div class="detail-empty">
        <div class="detail-empty-icon">&#9776;</div>
        <p>Select a group to browse its tabs</p>
      </div>`;
  }

  function shortUrl(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "");
      const path = u.pathname.length > 50 ? u.pathname.slice(0, 47) + "\u2026" : u.pathname;
      return host + (path && path !== "/" ? path : "");
    } catch {
      return url.length > 70 ? url.slice(0, 67) + "\u2026" : url;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Save Dialog                                                     */
  /* ---------------------------------------------------------------- */

  function openSaveDialog() {
    const d = new Date();
    const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    $saveNameInput.value = `${date}, ${time}`;
    $saveOverlay.classList.add("visible");
    setTimeout(() => { $saveNameInput.focus(); $saveNameInput.select(); }, 60);
  }

  function closeSaveDialog() { $saveOverlay.classList.remove("visible"); }

  async function confirmSave() {
    const name = $saveNameInput.value.trim() || undefined;
    closeSaveDialog();
    try {
      await browser.runtime.sendMessage({ type: "SAVE_SESSION", name });
    } catch {
      const data = currentData || await buildLocalData();
      const { sessions = [] } = await browser.storage.local.get("sessions");
      data.name = name || `Session ${sessions.length + 1}`;
      sessions.unshift(data);
      if (sessions.length > 100) sessions.length = 100;
      await browser.storage.local.set({ sessions });
    }
    toast("Session saved");
  }

  $btnSave.addEventListener("click", openSaveDialog);
  $saveCancelBtn.addEventListener("click", closeSaveDialog);
  $saveConfirmBtn.addEventListener("click", confirmSave);
  $saveNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmSave();
    if (e.key === "Escape") closeSaveDialog();
  });
  $saveOverlay.addEventListener("click", (e) => { if (e.target === $saveOverlay) closeSaveDialog(); });

  /* ---------------------------------------------------------------- */
  /*  Sessions Modal                                                  */
  /* ---------------------------------------------------------------- */

  let sessionsCache = null;

  function closeModal() {
    $modal.classList.remove("visible");
    $modalEl.classList.remove("enlarged");
    $modalHeader.textContent = "Session History";
    sessionsCache = null;
  }

  async function showSessions() {
    $modalEl.classList.remove("enlarged");
    $modalHeader.textContent = "Session History";
    $modal.classList.add("visible");

    let sessions;
    try {
      sessions = await browser.runtime.sendMessage({ type: "GET_SESSIONS" });
    } catch {
      const { sessions: s = [] } = await browser.storage.local.get("sessions");
      sessions = s;
    }
    sessionsCache = sessions;

    if (!sessions || sessions.length === 0) {
      $sessionList.innerHTML = '<div class="sessions-empty">No saved sessions yet.<br>Click <strong>Save</strong> to capture your tabs.</div>';
      return;
    }

    $sessionList.innerHTML = "";
    sessions.forEach((s, i) => {
      const d = new Date(s.timestamp);
      const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      const timeStr = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

      const row = document.createElement("div");
      row.className = "session-item";
      row.innerHTML = `
        <div class="session-info">
          <div class="session-name">${esc(s.name || `Session ${i + 1}`)}</div>
          <div class="session-meta">${dateStr} ${timeStr} \u00B7 ${s.totalTabs || "?"} tabs \u00B7 ${s.totalWindows || "?"} win</div>
        </div>
        <div class="session-actions">
          <button class="btn btn-sm" data-action="analyze" title="View analysis">&#9776;</button>
          <button class="btn btn-sm" data-action="export">Export</button>
          <button class="btn btn-sm btn-primary" data-action="restore">Restore</button>
          <button class="btn btn-sm btn-danger" data-action="delete">&times;</button>
        </div>
      `;

      row.querySelector('[data-action="analyze"]').addEventListener("click", () => {
        renderAnalysis(s, i);
      });

      row.querySelector('[data-action="restore"]').addEventListener("click", async () => {
        try { await browser.runtime.sendMessage({ type: "RESTORE_SESSION", index: i }); }
        catch { for (const win of s.windows) for (const tab of win.tabs) { try { await browser.tabs.create({ url: tab.url }); } catch {} } }
        closeModal();
        toast("Session restored", "info");
      });

      row.querySelector('[data-action="export"]').addEventListener("click", async () => {
        let json;
        try { json = await browser.runtime.sendMessage({ type: "EXPORT_SESSION", index: i }); }
        catch { json = JSON.stringify(s, null, 2); }
        try { await navigator.clipboard.writeText(json); toast("JSON copied"); }
        catch { toast("Could not copy", "warn"); }
      });

      row.querySelector('[data-action="delete"]').addEventListener("click", async () => {
        try { await browser.runtime.sendMessage({ type: "DELETE_SESSION", index: i }); }
        catch {
          const { sessions: ss = [] } = await browser.storage.local.get("sessions");
          ss.splice(i, 1);
          await browser.storage.local.set({ sessions: ss });
        }
        toast("Session deleted");
        showSessions();
      });

      $sessionList.appendChild(row);
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Session Analysis                                                */
  /* ---------------------------------------------------------------- */

  function analyzeSession(session) {
    const domainCounts = new Map();
    const windowInfo = [];
    let totalTabs = 0;

    for (const win of (session.windows || [])) {
      const winDomains = new Set();
      for (const tab of (win.tabs || [])) {
        const domain = Grouper.extractDomain(tab.url);
        domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
        winDomains.add(domain);
        totalTabs++;
      }
      windowInfo.push({
        label: win.label || `Window`,
        tabs: (win.tabs || []).length,
        domains: winDomains.size,
      });
    }

    const sorted = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]);
    return {
      totalTabs: totalTabs || session.totalTabs || 0,
      totalWindows: windowInfo.length || session.totalWindows || 0,
      totalDomains: domainCounts.size,
      topDomains: sorted.slice(0, 10),
      allDomains: sorted,
      windowInfo,
    };
  }

  function renderAnalysis(session, idx) {
    $modalEl.classList.add("enlarged");
    $modalHeader.textContent = "Session Analysis";

    const analysis = analyzeSession(session);
    const maxCount = analysis.topDomains.length > 0 ? analysis.topDomains[0][1] : 1;

    let barsHtml = "";
    analysis.topDomains.forEach(([domain, count], i) => {
      const pct = Math.max(4, Math.round((count / maxCount) * 100));
      const color = BAR_COLORS[i % BAR_COLORS.length];
      barsHtml += `
        <div class="chart-bar">
          <span class="chart-bar-label" title="${esc(domain)}">${esc(domain)}</span>
          <div class="chart-bar-track">
            <div class="chart-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="chart-bar-value">${count}</span>
        </div>`;
    });

    let windowsHtml = "";
    analysis.windowInfo.forEach((w) => {
      windowsHtml += `
        <div class="window-row">
          <span class="window-row-label">${esc(w.label)}</span>
          <span class="window-row-detail">${w.domains} domain${w.domains !== 1 ? "s" : ""}</span>
          <span class="window-row-count">${w.tabs} tab${w.tabs !== 1 ? "s" : ""}</span>
        </div>`;
    });

    const sessionName = esc(session.name || `Session ${idx + 1}`);
    const d = new Date(session.timestamp);
    const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const timeStr = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

    $sessionList.innerHTML = `
      <div class="analysis-header">
        <button class="btn btn-sm" id="btnAnalysisBack">\u2190 Back</button>
        <h3 title="${sessionName}">${sessionName}</h3>
        <span style="font-size:10px;color:var(--text-secondary)">${dateStr} ${timeStr}</span>
      </div>

      <div class="analysis-stats">
        <div class="stat-card">
          <div class="stat-value">${analysis.totalTabs}</div>
          <div class="stat-label">Tabs</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${analysis.totalWindows}</div>
          <div class="stat-label">Windows</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${analysis.totalDomains}</div>
          <div class="stat-label">Domains</div>
        </div>
      </div>

      ${analysis.topDomains.length > 0 ? `
      <div class="analysis-section">
        <h4>Domain Distribution (Top ${analysis.topDomains.length})</h4>
        <div class="chart">${barsHtml}</div>
      </div>` : ""}

      ${analysis.windowInfo.length > 0 ? `
      <div class="analysis-section">
        <h4>Per-Window Breakdown</h4>
        <div class="window-breakdown">${windowsHtml}</div>
      </div>` : ""}
    `;

    $sessionList.querySelector("#btnAnalysisBack").addEventListener("click", () => {
      showSessions();
    });
  }

  $btnSessions.addEventListener("click", showSessions);
  $modalClose.addEventListener("click", closeModal);
  $modal.addEventListener("click", (e) => { if (e.target === $modal) closeModal(); });

  /* ---------------------------------------------------------------- */
  /*  Mode Toggle                                                     */
  /* ---------------------------------------------------------------- */

  $modeToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mode]");
    if (!btn || btn.dataset.mode === groupMode) return;
    groupMode = btn.dataset.mode;
    $modeToggle.querySelectorAll(".btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedKey = null;
    render();
  });

  /* ---------------------------------------------------------------- */
  /*  Search                                                          */
  /* ---------------------------------------------------------------- */

  let searchTimer = null;
  $searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { searchQuery = $searchInput.value.trim(); render(); }, 100);
  });
  $searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { $searchInput.value = ""; searchQuery = ""; render(); $searchInput.blur(); }
  });

  /* ---------------------------------------------------------------- */
  /*  Refresh + Keyboard                                              */
  /* ---------------------------------------------------------------- */

  $btnRefresh.addEventListener("click", () => loadData(true));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if ($saveOverlay.classList.contains("visible")) { closeSaveDialog(); return; }
      if ($modal.classList.contains("visible")) { closeModal(); return; }
    }
  });

  /* ---------------------------------------------------------------- */
  /*  Helpers                                                         */
  /* ---------------------------------------------------------------- */

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  /* ---------------------------------------------------------------- */
  /*  Init                                                            */
  /* ---------------------------------------------------------------- */

  initTheme();
  loadData();

})();
