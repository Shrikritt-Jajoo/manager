'use strict';
// =========================================================
// manager state.js  v2
// Extended from v1: added settings/gmailConfig/aiConfig/
//                   registeredAiJobs stores + AI job seeding.
// ALL v1 APIs preserved: getMeta, setMeta, getSettings,
//                        saveSettings, onMeta — Onboarding
//                        and starfield.js continue to work.
// =========================================================

const AppState = (() => {
  // ── In-memory caches ──────────────────────────────────────────────────
  const _data = {
    tasks:[], subtasks:[], slots:[], scheduleBlocks:[],
    focusSessions:[], goals:[], registeredAiJobs:[]
  };

  // Singleton config objects (keyed by 'main')
  let _settings   = null;
  let _gmailCfg   = null;
  let _aiCfg      = null;

  // Legacy meta cache (for non-settings meta keys via DB.getMeta)
  const _meta  = {};

  // Subscriptions: store/key -> [fn, ...]
  const _subs  = {};  // store name -> [fn]
  const _msubs = {};  // meta key  -> [fn]

  // ── Default settings (merged on top of persisted) ─────────────────────
  const DEFAULT_SETTINGS = {
    grain:          'medium',
    starSpeed:      'slow',
    starDensity:    'medium',
    font:           'Inter, system-ui, sans-serif',
    accentColor:    '#BFAE99',
    starBodyColors: ['#e6e2ff','#ffeae0','#f4defc','#eeeeee'],
    starGlowColors: ['#486eff','#a848ff','#ff4894','#48c4da','#ff9448','#82ffaa'],
    focusDuration:  25,
    autoStep:       true,
    geminiKey:      '',
    gmailConnected: false,
    gmailAddress:   '',
    autoSendTime:   '07:00',
    autoSend:       false
  };

  // ── DEFAULT AI JOBS (seeded once on first init) ───────────────────────
  const DEFAULT_AI_JOBS = [
    {
      id: 'goal-decomposition',
      jobId: 'goal-decomposition',
      label: 'Goal Decomposition',
      trigger: 'planner-sidebar',
      systemPrompt: 'You are a productivity coach embedded in ChronoFlow, a task and time-management app. You have full knowledge of the app architecture from AGENTS.md. Your job is to help the user break down a vague goal into concrete, schedulable tasks that fit inside their available time slots. Always respond with valid JSON when asked to output data. Never modify locked files. Always go through accept/reject flow — never auto-apply.',
      userMessageTemplate: 'My goal: {goalTitle}\nDescription: {goalDescription}\nExisting tasks: {tasks}\nAvailable slots: {slots}\nToday: {today}\n\nHelp me break this goal into concrete subtasks I can schedule.',
      inputSources: ['tasks','slots','goals','settings'],
      outputSchema: { type: 'data', store: 'tasks', items: [] },
      acceptRejectPerItem: true,
      lockedFiles: [],
      addedBy: 'system',
      addedAt: new Date().toISOString()
    },
    {
      id: 'task-critique',
      jobId: 'task-critique',
      label: 'Task Critique',
      trigger: 'planner-sidebar',
      systemPrompt: 'You are a productivity coach in ChronoFlow. Review the user\'s task list and suggest improvements: better time estimates, clearer next steps, priority adjustments, or tasks to remove. Respond with valid JSON. Never auto-apply — always present suggestions for user review.',
      userMessageTemplate: 'My current tasks: {tasks}\nMy slots: {slots}\nSettings: {settings}\nToday: {today}\n\nReview my task list and suggest improvements.',
      inputSources: ['tasks','slots','settings'],
      outputSchema: { type: 'data', store: 'tasks', items: [] },
      acceptRejectPerItem: true,
      lockedFiles: [],
      addedBy: 'system',
      addedAt: new Date().toISOString()
    },
    {
      id: 'daily-email',
      jobId: 'daily-email',
      label: 'Daily Email Summary',
      trigger: 'home',
      systemPrompt: 'You are a scheduling assistant in ChronoFlow. Compose a concise, well-formatted plain-text daily schedule email for the user. Include their scheduled blocks, top priority tasks, and any deadlines today. Keep it under 300 words.',
      userMessageTemplate: 'Schedule blocks: {scheduleBlocks}\nTasks: {tasks}\nSettings: {settings}\nToday: {today}\n\nWrite my daily schedule email.',
      inputSources: ['scheduleBlocks','tasks','settings'],
      outputSchema: { type: 'email', subject: '', body: '' },
      acceptRejectPerItem: false,
      lockedFiles: [],
      addedBy: 'system',
      addedAt: new Date().toISOString()
    },
    {
      id: 'backlog-cleanup',
      jobId: 'backlog-cleanup',
      label: 'Backlog Cleanup',
      trigger: 'planner-sidebar',
      systemPrompt: 'You are a productivity coach in ChronoFlow. Help the user clean up their task backlog by identifying stale tasks (no progress, old deadline, low priority) and suggesting archiving, deletion, or re-prioritisation. Respond with valid JSON suggestions.',
      userMessageTemplate: 'All tasks: {tasks}\nFocus sessions: {focusSessions}\nToday: {today}\n\nHelp me clean up my backlog.',
      inputSources: ['tasks','focusSessions'],
      outputSchema: { type: 'data', store: 'tasks', items: [] },
      acceptRejectPerItem: true,
      lockedFiles: [],
      addedBy: 'system',
      addedAt: new Date().toISOString()
    },
    {
      id: 'weekly-review',
      jobId: 'weekly-review',
      label: 'Weekly Review',
      trigger: 'stats',
      systemPrompt: 'You are a productivity coach in ChronoFlow. Generate a concise weekly review in Markdown based on the user\'s focus sessions, completed tasks, and stats. Include: what went well, what to improve, and 3 focus intentions for next week.',
      userMessageTemplate: 'Focus sessions this week: {focusSessions}\nCompleted tasks: {tasks}\nToday: {today}\n\nWrite my weekly review.',
      inputSources: ['focusSessions','tasks'],
      outputSchema: { type: 'weekly-review', markdown: '' },
      acceptRejectPerItem: false,
      lockedFiles: [],
      addedBy: 'system',
      addedAt: new Date().toISOString()
    }
  ];

  // ── Private helpers ───────────────────────────────────────────────────
  function _emit(store) {
    (_subs[store] || []).forEach(fn => fn(
      KP_KEY_STORES.has(store) ? _getSingleton(store) : _data[store]
    ));
  }

  function _getSingleton(store) {
    if (store === 'settings')   return _settings;
    if (store === 'gmailConfig') return _gmailCfg;
    if (store === 'aiConfig')    return _aiCfg;
    return null;
  }

  function _applySettings(s) {
    if (!s) return;
    document.documentElement.style.setProperty('--accent', s.accentColor || '#BFAE99');
    // font intentionally removed per Phase 0.5 — use device default
    const grainMap = { none:[0,0], light:[.28,.18], medium:[.47,.30], heavy:[.62,.42] };
    const g = grainMap[s.grain] || grainMap.medium;
    document.documentElement.style.setProperty('--grain-opacity-1', g[0]);
    document.documentElement.style.setProperty('--grain-opacity-2', g[1]);
  }

  return {
    // ── Initialise ───────────────────────────────────────────────────────
    async init() {
      // 1. Load all array stores
      for (const s of Object.keys(_data)) {
        _data[s] = await DB.getAll(s);
      }

      // 2. Load singleton stores
      const rawSettings = await DB.get('settings', 'main');
      _settings = Utils.deepMerge(DEFAULT_SETTINGS, rawSettings || {});
      _gmailCfg = await DB.get('gmailConfig', 'main') || {
        key: 'main', clientId: '', accessToken: '', expiresAt: 0
      };
      _aiCfg    = await DB.get('aiConfig', 'main') || {
        key: 'main', geminiKey: '', model: 'gemini-2.0-flash'
      };

      // 3. Load legacy meta keys (for Onboarding compat)
      const metaKeys = ['currentTaskId','currentSubtaskId','focusActive',
                        'focusStartedAt','focusTimerRemain','onboardingComplete',
                        'streakData'];
      for (const k of metaKeys) {
        _meta[k] = await DB.getMeta(k);
      }

      // 4. Seed default AI jobs if store is empty
      if (_data.registeredAiJobs.length === 0) {
        for (const job of DEFAULT_AI_JOBS) {
          _data.registeredAiJobs.push(job);
          await DB.put('registeredAiJobs', job);
        }
      }

      // 5. Apply settings to DOM
      _applySettings(_settings);
    },

    // ── Array store API (existing — unchanged) ───────────────────────────
    get(store) { return _data[store] || []; },

    async add(store, item) {
      _data[store].push(item);
      await DB.put(store, item);
      _emit(store);
      return item;
    },

    async update(store, id, patch) {
      const idx = _data[store].findIndex(x => x.id === id);
      if (idx === -1) return;
      _data[store][idx] = Object.assign({}, _data[store][idx], patch,
        { updatedAt: new Date().toISOString() });
      await DB.put(store, _data[store][idx]);
      _emit(store);
      return _data[store][idx];
    },

    async remove(store, id) {
      _data[store] = _data[store].filter(x => x.id !== id);
      await DB.delete(store, id);
      _emit(store);
    },

    // ── Singleton store API (new) ────────────────────────────────────────
    // Used by ai.js, settings.js for aiConfig / gmailConfig / settings
    getConfig(store) { return _getSingleton(store); },

    async setConfig(store, value) {
      const row = Object.assign({ key: 'main' }, value);
      if (store === 'settings')    _settings  = row;
      if (store === 'gmailConfig') _gmailCfg  = row;
      if (store === 'aiConfig')    _aiCfg     = row;
      await DB.put(store, row);
      if (store === 'settings') _applySettings(row);
      _emit(store);
    },

    // ── Legacy API — PRESERVED for shell.js / Onboarding / starfield ─────
    getMeta(key)     { return _meta[key]; },

    async setMeta(key, value) {
      _meta[key] = value;
      await DB.setMeta(key, value);
      (_msubs[key] || []).forEach(fn => fn(value));
    },

    getSettings()    { return _settings || DEFAULT_SETTINGS; },

    async saveSettings(patch) {
      _settings = Utils.deepMerge(_settings || DEFAULT_SETTINGS, patch);
      _settings.key = 'main';
      await DB.put('settings', _settings);
      _applySettings(_settings);
      (_msubs['settings'] || []).forEach(fn => fn(_settings));
      _emit('settings');
    },

    onMeta(key, fn) { (_msubs[key] = _msubs[key] || []).push(fn); },

    // ── Subscription API ─────────────────────────────────────────────────
    on(store, fn) {
      (_subs[store] = _subs[store] || []).push(fn);
      // Return unsubscribe function (for ai.js session cleanup)
      return () => {
        _subs[store] = (_subs[store] || []).filter(f => f !== fn);
      };
    },

    off(store, fn) {
      _subs[store] = (_subs[store] || []).filter(f => f !== fn);
    },

    emit(store) { _emit(store); }
  };
})();
