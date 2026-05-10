# AGENTS.md — ChronoFlow / manager

This file is the single source of truth for any AI agent (GitHub Copilot,
OpenAI Codex, Gemini, or similar) working inside this repository.
Read it in full before making any change. If a rule here conflicts with a
general coding guideline, **this file wins**.

---

## 1. Project overview

`manager` is a personal productivity web app called **ChronoFlow**.
It runs in two modes:

| Mode | How to detect | Storage |
|------|---------------|---------|
| **Server mode** | `GET /api/ping` returns 200 | JSON files in `data/` via Rust server |
| **Standalone mode** | `/api/ping` fails or times out | IndexedDB in the browser |

The frontend is plain HTML + CSS + vanilla JS (no build step, no bundler).
The backend is a single Rust binary (`cargo run`) built with Actix-Web 4.

---

## 2. Repository layout

```
manager/
├── src/
│   └── main.rs          # Rust server — Actix-Web, all /api/* routes
├── data/                # Live JSON store files (gitignored except .gitkeep)
├── versions/            # Snapshot directories (gitignored except .gitkeep)
├── css/
│   ├── tokens.css       # CSS custom properties (colours, spacing, motion)
│   ├── reset.css        # Box-sizing / margin reset
│   ├── grain.css        # SVG grain overlay
│   ├── shell.css        # Nav, masks, toast, confirm, onboarding, progress
│   ├── starfield.css    # Canvas positioning
│   ├── home.css
│   ├── planner.css
│   ├── focus.css
│   ├── stats.css
│   └── settings.css
├── js/
│   ├── db.js            # DB facade + ChronoFlow.detect() + page bootstrap
│   ├── utils.js         # Pure helpers (uid, dates, escapeHtml, …)
│   ├── state.js         # AppState — in-memory cache + DB read/write
│   ├── starfield.js     # Canvas starfield animation
│   ├── shell.js         # Shell.toast / Shell.confirm / Onboarding
│   ├── scheduler.js     # Scheduler.buildSchedule / rescheduleUnfinished
│   ├── gmail.js         # Gmail OAuth + send
│   ├── ai.js            # AI job runner (Phase C)
│   ├── home.js          # Home page controller
│   ├── planner.js       # Planner page controller
│   ├── focus.js         # Focus timer controller
│   ├── stats.js         # Stats page controller
│   └── settings.js      # Settings page controller
├── index.html           # Home page
├── planner.html
├── focus.html
├── stats.html
├── settings.html
├── Cargo.toml
└── AGENTS.md            # ← you are here
```

---

## 3. Script load order (all pages)

Every HTML page loads scripts in this exact order.  
**Do not reorder. Do not add a script before `db.js`.**

```
db.js → utils.js → state.js → starfield.js → shell.js
→ scheduler.js → gmail.js → ai.js
→ <page-specific>.js   (home.js / planner.js / focus.js / stats.js / settings.js)
```

`db.js` fires a `DOMContentLoaded` listener that calls
`ChronoFlow.detect()` and `Starfield.init()` automatically.
Page-specific JS must **not** call `Starfield.init()` — it will
already have been called.

---

## 4. Data stores

### 4.1 Array stores (`keyPath: 'id'`)

| Store | Key fields |
|-------|------------|
| `tasks` | `id, title, type, estimatedMinutes, remainingMinutes, progressPercent, priority, effort, energyNeed, deadline, nextStep, notes, isPinned, isCompleted, goalId, createdAt, completedAt` |
| `subtasks` | `id, taskId, title, steps[], currentStepIndex, isCompleted, order, createdAt` |
| `slots` | `id, label, start, end, energyLevel, recurring, daysOfWeek[]` |
| `scheduleBlocks` | `id, title, start, end, minutes, isManual, taskId` |
| `focusSessions` | `id, taskId, subtaskId, startedAt, endedAt, plannedMinutes, actualMinutes, progressDelta, notes` |
| `goals` | `id, title, description, createdAt` |
| `registeredAiJobs` | `id, jobId, label, trigger, systemPrompt, userMessageTemplate, inputSources[], outputSchema, acceptRejectPerItem, lockedFiles[], addedBy, addedAt` |

### 4.2 Singleton stores (`keyPath: 'key'`, always `key: 'main'`)

| Store | Key fields |
|-------|------------|
| `settings` | `key, grain, starSpeed, starDensity, accentColor, starBodyColors[], starGlowColors[], focusDuration, autoStep, geminiKey, gmailConnected, gmailAddress, autoSendTime, autoSend` |
| `gmailConfig` | `key, clientId, accessToken, expiresAt` |
| `aiConfig` | `key, geminiKey, model` |

### 4.3 AppState API

```js
AppState.init()               // call once per page, awaited
AppState.get(store)           // → array (array stores)
AppState.add(store, item)     // → item
AppState.update(store, id, patch) // → updated item
AppState.remove(store, id)    // → void
AppState.getConfig(store)     // → singleton object
AppState.setConfig(store, value) // saves singleton
AppState.getSettings()        // → settings object (merged with defaults)
AppState.saveSettings(patch)  // partial merge + persist
AppState.getMeta(key)         // legacy meta access
AppState.setMeta(key, value)  // legacy meta write
AppState.on(store, fn)        // subscribe → returns unsubscribe fn
AppState.off(store, fn)       // unsubscribe
AppState.emit(store)          // trigger subscribers manually
```

**Never call `AppState._emit()`** — it is private. Use `AppState.emit()`.

---

## 5. Server API (`src/main.rs`)

All routes are served by the Rust binary on `http://127.0.0.1:4000`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/api/ping` | — | `{"ok":true}` |
| `GET` | `/api/data?store=<name>` | — | JSON array or object |
| `POST` | `/api/data?store=<name>` | JSON array or object | `{"ok":true}` |
| `POST` | `/api/versions/snapshot?name=<n>` | — | `{"name":"<n>"}` |
| `GET` | `/api/versions` | — | `[{"name","createdAt"},…]` |
| `POST` | `/api/versions/restore?name=<n>` | — | `{"ok":true}` |
| `DELETE` | `/api/versions?name=<n>` | — | `{"ok":true}` |
| `GET` | `/*` | — | Static file from repo root |

All write endpoints use an atomic `tmp → rename` pattern and a global
`Mutex<()>` to prevent torn writes. Unknown store names return 400.

To start: `cargo run` from the repo root.

---

## 6. AI job system

### 6.1 Registered jobs (seeded by `state.js`)

| `id` | `trigger` | `outputSchema.type` | `acceptRejectPerItem` |
|------|-----------|---------------------|-----------------------|
| `goal-decomposition` | `planner-sidebar` | `data` (store: tasks) | true |
| `task-critique` | `planner-sidebar` | `data` (store: tasks) | true |
| `daily-email` | `home` | `email` | false |
| `backlog-cleanup` | `planner-sidebar` | `data` (store: tasks) | true |
| `weekly-review` | `stats` | `weekly-review` | false |

### 6.2 AI.js public API

```js
AI.runJob(jobId)                         // full pipeline → raw result object
AI.gatherInputs(job)                     // → {tasks, slots, …, today}
AI.applyOutputs(job, result, acceptedSet)// writes approved items, returns count
AI.breakdownGoal(title, description)     // → tasks[]
AI.ping()                                // connectivity test → true
AI.isOnline()                            // → bool (navigator.onLine)
```

### 6.3 Output schemas

**`data`** (accept/reject per item):
```json
{ "items": [ { "action": "create|update|delete", "id": "<optional>", "payload": {} } ], "summary": "" }
```

**`email`**:
```json
{ "subject": "", "body": "" }
```

**`weekly-review`**:
```json
{ "markdown": "" }
```

---

## 7. Agent rules — READ CAREFULLY

### 7.1 Never auto-apply AI output
All AI job results **must go through an accept/reject UI** before any
data is written. Never call `AI.applyOutputs()` without first showing
the user the proposed changes and receiving explicit approval.
`acceptRejectPerItem: true` means each item gets its own accept/reject
control. `false` means the whole result is accepted or rejected as one.

### 7.2 Locked files
The following files must **never be modified** by an AI agent without
explicit human instruction in this file or a direct commit from the
repository owner:

- `AGENTS.md` (this file)
- `src/main.rs`
- `js/db.js`
- `js/state.js`
- `js/shell.js`
- `Cargo.toml`

If a registered AI job lists files in its `lockedFiles[]` array, those
files are also off-limits for that job's output.

### 7.3 No bundler, no framework
The frontend is intentionally zero-dependency vanilla JS. Do not add
npm, Webpack, Vite, React, Vue, TypeScript, or any build step. If you
need a helper, add a plain `.js` file in `js/` and insert it into the
script load order in every HTML file at the correct position.

### 7.4 Script load order is sacred
See §3. Any new JS file must be inserted at the correct position.
A file that depends on `AppState` must come after `state.js`.
A file that depends on `AI` must come after `ai.js`.

### 7.5 CSS token usage
All colours, spacing, and transitions must use the custom properties
defined in `css/tokens.css`. Do not hardcode hex colours or pixel
values that duplicate a token. The only exception is canvas 2D
rendering (stats.js charts) which must read tokens at runtime via
`getComputedStyle(document.documentElement).getPropertyValue('--accent')`.

### 7.6 DB facade
All persistence goes through `DB.*` (server mode) or `_idb.*`
(IndexedDB fallback), both surfaced via the `AppState` API.
Never write to `localStorage` or `sessionStorage` for app data.
`sessionStorage` is acceptable only for transient focus-session
cross-page state (`cf_session` key in `focus.js`).

### 7.7 Offline / no-key guard
Before calling any Gemini endpoint, check:
1. `AI.isOnline()` — throw if false
2. `AI._getKey()` — throw if empty

Both checks are already inside `AI.runJob()`, `AI.breakdownGoal()`,
and `AI.ping()`. If you add a new AI call path, you must include both
checks.

### 7.8 Atomic writes (server side)
All Rust handlers that write files must use the tmp-file-then-rename
pattern already established in `write_store()`. Never write directly
to the final `.json` path.

### 7.9 Data directory
`data/` and `versions/` are gitignored (except `.gitkeep`). Never
commit actual user data files. Never read from these directories in
frontend JS — all reads go through `/api/data`.

---

## 8. CSS token reference

```css
--bg              #000000
--text            #f5f7fb
--text-muted      rgba(245,247,251,.55)
--text-faint      rgba(245,247,251,.28)
--accent          #BFAE99  (overridden at runtime by settings.accentColor)
--accent-text     #000000
--progress-track  rgba(255,255,255,.09)
--font            Inter, system-ui, sans-serif
--sp1 … --sp8     0.25rem steps
--t-fast          .18s ease
--t-base          .22s ease
--t-slow          .38s ease
--t-mask          .40s ease
--t-prog          width .6s ease
--clip            polygon(10px 0, 100% 0, …)   angular clip-path
```

---

## 9. Running locally

```bash
# Start the server (serves frontend + API on port 4000)
cargo run

# Open in browser
open http://127.0.0.1:4000
```

If you open the HTML files directly (`file://`) the app falls back to
IndexedDB automatically — no server needed for standalone use.

---

## 10. Phase history

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Audit + rename; DB v2; AppState v2; starfield fix | ✅ |
| 0.5 | Offline hardening — skip fonts, keep GSI + AI guards | ✅ |
| A | Page bootstrap — `ChronoFlow.detect()` + `Starfield.init()` in `db.js` | ✅ |
| B | `state.js` + `DEFAULT_AI_JOBS` | ✅ (completed in Phase 0) |
| 1–3 | Dual storage, AppState, nav shell | ✅ (completed in Phase 0) |
| 4–6 | Planner, Focus, Stats — remove duplicate `Starfield.init()`, fix `AppState.emit` | ✅ |
| C | `ai.js` v2 — full job-runner pipeline | ✅ |
| D | `server.rs` — Actix-Web server, all `/api/*` routes | ✅ |
| F | `AGENTS.md` | ✅ |
| 7 | Settings tabbed layout | ⏳ |
| E | Per-page AI trigger wiring | ⏳ |
| G | Settings AI panels | ⏳ |
| H | Offline AI guard (wired in Phase C) | ✅ |
