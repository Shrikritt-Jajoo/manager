'use strict';
const AppState = (() => {
  const _data   = { tasks:[], subtasks:[], slots:[], scheduleBlocks:[], focusSessions:[], goals:[] };
  const _meta   = {};
  const _subs   = {};   // store -> [fn]
  const _msubs  = {};   // metaKey -> [fn]

  const DEFAULT_SETTINGS = {
    grain: 'medium',
    starSpeed: 'slow',
    starDensity: 'medium',
    font: 'Inter, system-ui, sans-serif',
    accentColor: '#BFAE99',
    starBodyColors: ['#e6e2ff','#ffeae0','#f4defc','#eeeeee'],
    starGlowColors: ['#486eff','#a848ff','#ff4894','#48c4da','#ff9448','#82ffaa'],
    focusDuration: 25,
    autoStep: true,
    geminiKey: '',
    gmailConnected: false,
    gmailAddress: '',
    autoSendTime: '07:00',
    autoSend: false
  };

  return {
    get data() { return _data; },

    async init() {
      const stores = ['tasks','subtasks','slots','scheduleBlocks','focusSessions','goals'];
      for (const s of stores) {
        _data[s] = await DB.getAll(s);
      }
      const metaKeys = ['currentTaskId','currentSubtaskId','focusActive','focusStartedAt',
                        'focusTimerRemain','onboardingComplete','streakData','gmailToken','settings'];
      for (const k of metaKeys) {
        _meta[k] = await DB.getMeta(k);
      }
      if (!_meta.settings) _meta.settings = DEFAULT_SETTINGS;
      else _meta.settings = Utils.deepMerge(DEFAULT_SETTINGS, _meta.settings);
      this._applySettings();
    },

    get(store)       { return _data[store] || []; },
    getMeta(key)     { return _meta[key]; },
    getSettings()    { return _meta.settings || DEFAULT_SETTINGS; },

    async setMeta(key, value) {
      _meta[key] = value;
      await DB.setMeta(key, value);
      (_msubs[key] || []).forEach(fn => fn(value));
    },

    async add(store, item) {
      _data[store].push(item);
      await DB.put(store, item);
      this._emit(store);
      return item;
    },

    async update(store, id, patch) {
      const idx = _data[store].findIndex(x => x.id === id);
      if (idx === -1) return;
      _data[store][idx] = Object.assign({}, _data[store][idx], patch);
      await DB.put(store, _data[store][idx]);
      this._emit(store);
      return _data[store][idx];
    },

    async remove(store, id) {
      _data[store] = _data[store].filter(x => x.id !== id);
      await DB.delete(store, id);
      this._emit(store);
    },

    async saveSettings(patch) {
      _meta.settings = Utils.deepMerge(_meta.settings || {}, patch);
      await DB.setMeta('settings', _meta.settings);
      this._applySettings();
      (_msubs['settings'] || []).forEach(fn => fn(_meta.settings));
    },

    on(store, fn)    { (_subs[store]  = _subs[store]  || []).push(fn); },
    onMeta(key, fn)  { (_msubs[key]   = _msubs[key]   || []).push(fn); },
    _emit(store)     { (_subs[store]  || []).forEach(fn => fn(_data[store])); },
    emit(store) { this._emit(store); },

    _applySettings() {
      const s = _meta.settings;
      if (!s) return;
      document.documentElement.style.setProperty('--font', s.font);
      document.documentElement.style.setProperty('--accent', s.accentColor);

      const grainMap = { none:[0,0], light:[.28,.18], medium:[.47,.30], heavy:[.62,.42] };
      const g = grainMap[s.grain] || grainMap.medium;
      document.documentElement.style.setProperty('--grain-opacity-1', g[0]);
      document.documentElement.style.setProperty('--grain-opacity-2', g[1]);

      if (s.font && s.font !== 'Inter, system-ui, sans-serif') {
        const name = s.font.split(',')[0].replace(/'/g,'').trim();
        const id   = 'gfont-' + name.replace(/\s/g,'');
        if (!document.getElementById(id)) {
          const link = document.createElement('link');
          link.id   = id;
          link.rel  = 'stylesheet';
          link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@300;400;500&display=swap`;
          document.head.appendChild(link);
        }
      }
    }
  };
})();
