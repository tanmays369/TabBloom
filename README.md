# TabBloom

**Intelligently organize, group, and save all your open tabs with a beautiful interface.**

TabBloom is a Firefox extension (WebExtensions, Manifest V3) that captures every open tab across every window and presents them in a two-panel UI with intelligent, deterministic grouping. It does not rely on any external AI, LLM, or heavyweight framework — the entire grouping engine is pure vanilla JavaScript running a multi-stage pipeline that normalizes URLs, extracts structural signals, clusters by contextual similarity, and deduplicates near-identical entries.

---

## What Makes TabBloom Special

Most tab managers group by exact URL or by bare domain. TabBloom does neither. It runs a **7-stage deterministic pipeline** that understands the _structure_ of URLs:

| Stage | What it does |
|---|---|
| **1. URL Normalization** | Strips query params, fragments, tracking tokens (`utm_*`, `fbclid`, `gclid`, 26+ trackers), normalizes trailing slashes, lowercases host, removes `www.` |
| **2. Domain Extraction** | Subdomain-aware extraction; handles `about:`, `file:`, `moz-extension:`, `data:`, `blob:` as special categories |
| **3. Path Tokenization** | Splits pathname into semantic segments, filters out pure numeric IDs, UUIDs, hex hashes, date-like segments (`2024-03-15`), long random strings (32+ chars), and file extensions |
| **4. Contextual Clustering** | Builds cluster keys from domain + path prefix with **namespace-aware depth** — short first segments like `/r/`, `/u/`, `@user` get 3 levels of depth; regular paths get 2. Labels are derived as human-readable breadcrumbs (`Issues › Pull requests`) |
| **5. Title Similarity Merge** | Tokenizes titles, strips 80+ stopwords, computes Jaccard similarity. Clusters within the same domain with overlap >= 0.35 are merged |
| **6. Singleton Merge** | When a domain has 3+ one-tab clusters alongside larger groups, the singletons collapse into an "Other Pages" cluster to reduce noise |
| **7. Deduplication** | Detects near-identical tabs by normalized URL or by title similarity >= 0.85. Keeps the tab with the longer title, marks duplicates with a count badge |

The result: `github.com/user/repo/issues/42` and `github.com/user/repo/pull/17` appear under the same group. `arxiv.org/abs/2301.12345` and `arxiv.org/pdf/2301.12345` cluster together. `medium.com/@author/article-one` and `medium.com/@author/article-two` are grouped by author. No hardcoded domain rules — the pipeline is entirely structural.

---

## Features

### Intelligent Grouping
- **Context mode** — full 7-stage pipeline producing semantic clusters
- **Domain mode** — flat grouping by domain, sorted by tab count
- **Window mode** — one group per browser window with domain previews
- Toggle freely between all three from the top bar

### Window-Aware Hierarchy
- Groups are nested under collapsible window sections ("Window 1", "Window 2", ...)
- Groups that span multiple windows are collected in a "Shared Across Windows" section
- Window badges on shared groups show exactly which windows contain them
- Each window section header shows the total tab count

### Session Management
- **Save** any snapshot with a custom name (auto-suggested as `Apr 9, 2:30 PM — github, stackoverflow`)
- **Restore** a saved session — recreates each window with its original tabs
- **Export** any session as formatted JSON to clipboard
- **Delete** sessions you no longer need
- Up to 100 sessions stored in `browser.storage.local`

### Session Analysis
- Click the analysis button on any saved session to open an **enlarged detail view**
- **Stat cards** — total tabs, windows, and unique domains at a glance
- **Domain distribution chart** — horizontal bar chart showing the top 10 domains, color-coded with Monokai accent colors
- **Per-window breakdown** — each window listed with its tab count and domain count
- Smooth animated transition between the session list and the analysis view

### Theming
- Three modes: **System** (follows OS preference), **Light**, **Dark**
- Cycle with the theme button in the top bar; preference persists across sessions
- Monokai-inspired palette:
  - Dark: `#272822` background, `#f8f8f2` text, classic Monokai accent colors (green `#a6e22e`, orange `#fd971f`, red `#f92672`, cyan `#66d9ef`, purple `#ae81ff`, yellow `#e6db74`)
  - Light: warm off-white `#f8f7f4` background, dark text `#2a2a28`, muted versions of the same accents
- All UI elements — badges, icons, charts, buttons — adapt automatically via CSS custom properties

### UI Details
- **Group icons** — each group card has a color-coded letter circle derived from the domain name (deterministic hash to one of 6 accent colors)
- **Tab badges** — active tabs get a green dot, pinned tabs get an orange "Pin" badge, duplicates show a count (e.g. ×2)
- **Search** — real-time filtering across group names, domains, tab titles, and URLs with debounced input
- **Copy URLs** — one click to copy all URLs in a group to clipboard
- **Open All** — reopen every tab in a group at once
- **Keyboard** — `Escape` closes any open dialog or modal; `Enter` confirms the save dialog
- **Toast notifications** — non-intrusive feedback for save, restore, copy, delete, and theme changes
- **Toolbar badge** — live tab count on the extension icon, updated on tab create/remove

---

## Installation

### From source (temporary add-on)

1. Clone or download this repository:

```bash
git clone <repo-url>
cd tabbloom
```

2. Open Firefox and navigate to:

```
about:debugging#/runtime/this-firefox
```

3. Click **"Load Temporary Add-on..."**

4. Select the `manifest.json` file from the project directory.

5. The TabBloom icon appears in the toolbar. Click it to open the popup.

> **Note:** Temporary add-ons are removed when Firefox restarts. For persistent installation, the extension must be signed and distributed through [addons.mozilla.org](https://addons.mozilla.org).

### Requirements

- Firefox **109.0** or later (Manifest V3 support)
- No build step, no dependencies, no bundler — load the directory directly

---

## Usage

### Opening the popup

Click the TabBloom icon in the Firefox toolbar. The popup loads all tabs across all open windows and immediately groups them.

### Navigating groups

- The **left panel** shows grouped clusters organized under window sections
- Click any group card to view its tabs in the **right panel**
- Click a window section header to collapse/expand it
- Use the **search bar** to filter groups by domain, label, title, or URL

### Switching modes

Use the toggle in the top bar:

| Mode | Behavior |
|---|---|
| **Context** | Full intelligent pipeline — structural clusters with title merging and dedup |
| **Domain** | One group per domain, sorted by tab count descending |
| **Window** | One group per browser window, showing a domain preview |

### Saving and restoring sessions

1. Click **Save** — a dialog appears with an auto-generated name
2. Edit the name if desired, press `Enter` or click **Save**
3. Click **History** to see all saved sessions
4. From the session list:
   - Click the **analysis icon** to see domain charts and window breakdown
   - Click **Export** to copy the session as JSON
   - Click **Restore** to reopen all tabs in their original window structure
   - Click **×** to delete a session

### Changing the theme

Click the theme button (circle icon) in the top-right corner. It cycles through:

1. **System** — follows your OS dark/light preference
2. **Light** — warm off-white Monokai light
3. **Dark** — classic Monokai dark

The choice persists in `browser.storage.local`.

---

## File Structure

```
tabbloom/
├── manifest.json      Extension manifest (Manifest V3, Firefox)
├── background.js      Tab capture, session persistence, badge, message router
├── grouper.js         Pure grouping engine — no DOM, no browser API
├── popup.html         Two-panel popup shell with modals
├── popup.js           UI controller — rendering, interactions, theming
├── styles.css         Full CSS with Monokai light/dark/system themes
├── icons/
│   ├── icon-48.png    Toolbar icon (48×48)
│   └── icon-96.png    Toolbar icon (96×96)
└── README.md
```

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                    popup.html                        │
│  ┌──────────┐  ┌────────────────────────────────┐   │
│  │ Left     │  │ Right                          │   │
│  │ Panel    │  │ Panel                          │   │
│  │          │  │                                │   │
│  │ Window 1 │  │ Tab list for selected group    │   │
│  │  ├ grp1  │  │ ┌─────────────────────────┐   │   │
│  │  └ grp2  │  │ │ favicon │ title │ [Open] │   │   │
│  │ Window 2 │  │ │ favicon │ title │ [Open] │   │   │
│  │  └ grp3  │  │ │ ...                     │   │   │
│  │ Shared   │  │ └─────────────────────────┘   │   │
│  │  └ grp4  │  │                                │   │
│  └──────────┘  └────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────┘
                       │ sendMessage
           ┌───────────▼───────────┐
           │    background.js      │
           │  ┌─────────────────┐  │
           │  │   grouper.js    │  │  ← pure module, no side effects
           │  │  (7-stage pipe) │  │
           │  └─────────────────┘  │
           │  captureAllTabs()     │
           │  getSessionData()     │
           │  saveSession()        │
           │  restoreSession()     │
           │  browser.storage.local│
           └───────────────────────┘
```

**Data flow:**

1. `popup.js` sends `GET_SESSION_DATA` to `background.js`
2. `background.js` calls `browser.tabs.query({})` to capture all tabs
3. Tabs are passed to `Grouper.groupTabs()` (the pure engine in `grouper.js`)
4. The grouped result is returned to `popup.js` for rendering
5. Results are **memoized** — a hash of `tabId:url` pairs is compared, and grouping only re-runs when tabs actually change

---

## Grouping Pipeline Detail

The engine in `grouper.js` is designed as an **IIFE module** that exports a pure API. It has zero DOM access and zero browser API calls, making it independently testable.

### Public API

```javascript
Grouper.groupTabs(tabs, windowLabels)       // Context mode: full 7-stage pipeline
Grouper.groupByDomainFlat(tabs, windowLabels) // Domain mode: flat by domain
Grouper.groupByWindow(tabs, windowLabels)    // Window mode: one group per window
Grouper.normalizeUrl(url)                    // Stage 1
Grouper.stripTracking(url)                   // Tracking param removal
Grouper.extractDomain(url)                   // Stage 2
Grouper.extractPathTokens(url)               // Stage 3
Grouper.tokenizeTitle(title)                 // Title tokenizer (used in stages 5–7)
Grouper.jaccardSimilarity(setA, setB)        // Set similarity metric
Grouper.isInternalUrl(url)                   // Classify internal protocols
```

### Cluster key examples

| URL | Cluster key | Label |
|---|---|---|
| `github.com/user/repo/issues/42` | `github.com/user/repo` | `User › Repo` |
| `github.com/user/repo/pull/17` | `github.com/user/repo` | `User › Repo` |
| `reddit.com/r/javascript/comments/abc` | `reddit.com/r/javascript` | `R › Javascript` |
| `medium.com/@author/my-article` | `medium.com/@author/my-article` | `@author › My article` |
| `arxiv.org/abs/2301.12345` | `arxiv.org/abs` | `Abs` |
| `docs.python.org/3/library/os` | `docs.python.org/3/library` | `3 › Library` |
| `about:preferences` | `about` | `about` |

### Tracking params stripped

`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `fbclid`, `gclid`, `dclid`, `msclkid`, `mc_cid`, `mc_eid`, `_ga`, `_gid`, `yclid`, `ref`, `ref_src`, `ref_url`, `source`, `share_source`, `spm`, `si`, `feature`, `context`, `sxsrf`, `ved`, `uact`, `oq`, `sclient`

### Path tokens filtered

Segments matching any of these patterns are dropped during tokenization:

| Pattern | Example |
|---|---|
| Pure numeric | `/42`, `/12345` |
| Hex hash (8+ chars) | `/a1b2c3d4e5f6` |
| UUID | `/550e8400-e29b-41d4-a716-446655440000` |
| Date-like | `/2024-03-15`, `/2024-03` |
| Long random (32+ chars) | `/xKj9mN2pQ...` |
| File extensions | `.html`, `.php`, `.aspx` |

---

## Performance

- Handles **200–300 tabs** without perceptible lag
- Background script **memoizes** grouping results — a hash of all `tabId:url` pairs is compared, and the pipeline only re-runs when the set of tabs actually changes
- Efficient `Map` and `Set` data structures throughout
- Search uses **debounced input** (100ms) to avoid excessive re-renders
- Popup dimensions are 800×600px (Firefox maximum for extension popups)

---

## Permissions

| Permission | Why |
|---|---|
| `tabs` | Read URL, title, favicon, windowId, pinned/active state for all open tabs |
| `storage` | Persist saved sessions and theme preference in `browser.storage.local` |

No network permissions. No remote requests. Everything runs locally.

---

## Constraints

- **No external AI or LLM** — grouping is fully deterministic and local
- **No heavy frameworks** — vanilla JavaScript, no React, no Vue, no build step
- **No hardcoded domain rules** — the pipeline is structural; it works on any URL shape
- **Firefox only** — uses `browser.*` WebExtensions API and Gecko-specific manifest fields
- **Manifest V3** — background scripts (not service workers, as Firefox MV3 supports persistent background pages)

---

## Data Schema

Sessions are stored in `browser.storage.local` under the key `sessions`:

```json
{
  "sessions": [
    {
      "name": "Apr 9, 2:30 PM — github, stackoverflow",
      "timestamp": 1712678400000,
      "totalTabs": 42,
      "totalWindows": 3,
      "windows": [
        {
          "windowId": 1,
          "label": "Window 1",
          "tabs": [
            {
              "url": "https://github.com/user/repo",
              "title": "user/repo: Description",
              "favIconUrl": "https://github.com/favicon.ico",
              "windowId": 1,
              "tabId": 101,
              "index": 0,
              "pinned": false,
              "active": true,
              "timestamp": 1712678400000
            }
          ]
        }
      ],
      "groups": [
        {
          "key": "github.com/user/repo",
          "domain": "github.com",
          "label": "User › Repo",
          "tabCount": 5,
          "windowBadges": ["Window 1"],
          "shared": false,
          "tabs": []
        }
      ]
    }
  ]
}
```

---

## License

MIT
