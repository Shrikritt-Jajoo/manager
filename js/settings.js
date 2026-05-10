'use strict';
// Phase 7: removed duplicate Starfield.init(); added tab switching logic.
(async () => {
  await AppState.init();
  Shell.bindNavButtons();
  SettingsPage.init();
})();

const SettingsPage = {
  _activeTab: 'visual',

  init() {
    this._loadValues();
    this._bindTabs();
    this._bindAll();
  },

  // ---- Tab switching ---------------------------------------------------
  _bindTabs() {
    document.querySelectorAll('.stab').forEach(btn => {
      btn.onclick = () => this._switchTab(btn.dataset.tab);
    });
  },

  _switchTab(name) {
    this._activeTab = name;
    // Update tab buttons
    document.querySelectorAll('.stab').forEach(btn => {
      const active = btn.dataset.tab === name;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active);
    });
    // Show/hide panels
    document.querySelectorAll('[data-tab-panel]').forEach(panel => {
      panel.classList.toggle('hidden', panel.dataset.tabPanel !== name);
    });
  },

  // ---- Load persisted values into controls ----------------------------
  _loadValues() {
    const s = AppState.getSettings();
    this._setSegActive('grain',       s.grain        || 'medium');
    this._setSegActive('starSpeed',   s.starSpeed    || 'slow');
    this._setSegActive('starDensity', s.starDensity  || 'medium');

    const fontSel = document.getElementById('fontSelect');
    if (fontSel) fontSel.value = s.font || 'Inter, system-ui, sans-serif';

    const ac = document.getElementById('accentColor');
    if (ac) ac.value = s.accentColor || '#BFAE99';

    (s.starBodyColors || []).forEach((c, i) => {
      const el = document.querySelector(`[data-star-col="${i}"]`);
      if (el) el.value = c;
    });
    (s.starGlowColors || []).forEach((c, i) => {
      const el = document.querySelector(`[data-glow-col="${i}"]`);
      if (el) el.value = c;
    });

    const fd = document.getElementById('focusDuration');
    if (fd) fd.value = s.focusDuration || 25;

    const tas = document.getElementById('toggleAutoStep');
    if (tas) {
      tas.classList.toggle('on', s.autoStep !== false);
      tas.setAttribute('aria-checked', s.autoStep !== false);
    }

    const gk = document.getElementById('geminiKey');
    if (gk) gk.value = s.geminiKey || '';

    const gmStatus = document.getElementById('gmailStatus');
    if (gmStatus && s.gmailConnected) gmStatus.textContent = `Connected: ${s.gmailAddress}`;

    const ast = document.getElementById('autoSendTime');
    if (ast) ast.value = s.autoSendTime || '07:00';

    const tas2 = document.getElementById('toggleAutoSend');
    if (tas2) {
      tas2.classList.toggle('on', !!s.autoSend);
      tas2.setAttribute('aria-checked', !!s.autoSend);
    }
  },

  _setSegActive(group, val) {
    document.querySelectorAll(`[data-seg="${group}"]`).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === val);
    });
  },

  // ---- Bind all controls -----------------------------------------------
  _bindAll() {
    // Segmented controls
    document.querySelectorAll('.seg-btn').forEach(btn => {
      btn.onclick = async () => {
        const group = btn.dataset.seg, val = btn.dataset.val;
        this._setSegActive(group, val);
        await AppState.saveSettings({ [group]: val });
        Starfield.rebuild();
      };
    });

    // Font
    const fontSel = document.getElementById('fontSelect');
    if (fontSel) fontSel.onchange = async () =>
      await AppState.saveSettings({ font: fontSel.value });

    // Accent colour
    const ac = document.getElementById('accentColor');
    if (ac) ac.oninput = async () => await AppState.saveSettings({ accentColor: ac.value });

    // Star body colours
    document.querySelectorAll('[data-star-col]').forEach(inp => {
      inp.oninput = async () => {
        const cols = Array.from(document.querySelectorAll('[data-star-col]')).map(el => el.value);
        await AppState.saveSettings({ starBodyColors: cols });
        Starfield.rebuild();
      };
    });

    // Glow colours
    document.querySelectorAll('[data-glow-col]').forEach(inp => {
      inp.oninput = async () => {
        const cols = Array.from(document.querySelectorAll('[data-glow-col]')).map(el => el.value);
        await AppState.saveSettings({ starGlowColors: cols });
        Starfield.rebuild();
      };
    });

    // Focus duration
    const fd = document.getElementById('focusDuration');
    if (fd) fd.onchange = async () =>
      await AppState.saveSettings({ focusDuration: parseInt(fd.value) || 25 });

    // Auto-step toggle
    const tas = document.getElementById('toggleAutoStep');
    if (tas) tas.onclick = async () => {
      const next = !tas.classList.contains('on');
      tas.classList.toggle('on', next);
      tas.setAttribute('aria-checked', next);
      await AppState.saveSettings({ autoStep: next });
    };

    // Gemini key — save on blur
    const gk = document.getElementById('geminiKey');
    if (gk) gk.onblur = async () =>
      await AppState.saveSettings({ geminiKey: gk.value.trim() });

    // Test AI connection
    const testBtn = document.getElementById('testAiBtn');
    const testRes = document.getElementById('aiTestResult');
    if (testBtn) testBtn.onclick = async () => {
      if (testRes) testRes.textContent = 'Testing…';
      try {
        await AI.ping();
        if (testRes) testRes.textContent = '✓ Connected';
      } catch(e) {
        if (testRes) testRes.textContent = '✗ ' + e.message;
      }
    };

    // Gmail connect
    const gmBtn = document.getElementById('gmailConnectBtn');
    if (gmBtn) gmBtn.onclick = async () => {
      try {
        await Gmail.connect();
        const s  = AppState.getSettings();
        const st = document.getElementById('gmailStatus');
        if (st) st.textContent = `Connected: ${s.gmailAddress}`;
        Shell.toast('Gmail connected!');
      } catch(e) { Shell.toast('Gmail: ' + e.message); }
    };

    // Auto-send time
    const ast = document.getElementById('autoSendTime');
    if (ast) ast.onchange = async () =>
      await AppState.saveSettings({ autoSendTime: ast.value });

    // Auto-send toggle
    const tas2 = document.getElementById('toggleAutoSend');
    if (tas2) tas2.onclick = async () => {
      const next = !tas2.classList.contains('on');
      tas2.classList.toggle('on', next);
      tas2.setAttribute('aria-checked', next);
      await AppState.saveSettings({ autoSend: next });
    };

    // Export
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.onclick = async () => {
      const payload = {
        tasks:          AppState.get('tasks'),
        subtasks:       AppState.get('subtasks'),
        slots:          AppState.get('slots'),
        scheduleBlocks: AppState.get('scheduleBlocks'),
        focusSessions:  AppState.get('focusSessions'),
        goals:          AppState.get('goals'),
        exportedAt:     new Date().toISOString()
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'chronoflow-export.json'; a.click();
      URL.revokeObjectURL(url);
      Shell.toast('Exported!');
    };

    // Import
    const importBtn  = document.getElementById('importBtn');
    const importFile = document.getElementById('importFile');
    const importStat = document.getElementById('importStatus');
    if (importBtn)  importBtn.onclick  = () => importFile.click();
    if (importFile) importFile.onchange = async () => {
      try {
        const text = await importFile.files[0].text();
        const data = JSON.parse(text);
        for (const store of ['tasks','subtasks','slots','scheduleBlocks','focusSessions','goals']) {
          if (Array.isArray(data[store])) {
            await DB.clear(store);
            for (const item of data[store]) await DB.put(store, item);
            AppState.get(store).length = 0;
            data[store].forEach(item => AppState.get(store).push(item));
          }
        }
        if (importStat) importStat.textContent = 'Import complete';
        Shell.toast('Data imported!');
      } catch(e) {
        if (importStat) importStat.textContent = 'Import failed: ' + e.message;
      }
    };

    // Clear completed tasks
    const ccBtn = document.getElementById('clearCompletedBtn');
    if (ccBtn) ccBtn.onclick = async () => {
      if (!await Shell.confirm('Delete all completed tasks?')) return;
      const completed = AppState.get('tasks').filter(t => t.isCompleted);
      for (const t of completed) await AppState.remove('tasks', t.id);
      Shell.toast('Cleared completed tasks');
    };

    // Factory reset
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) resetBtn.onclick = async () => {
      if (!await Shell.confirm('FACTORY RESET — delete all data? This cannot be undone.')) return;
      if (!await Shell.confirm('Are you absolutely sure? All tasks, sessions, and settings will be lost.')) return;
      for (const store of ['tasks','subtasks','slots','scheduleBlocks','focusSessions','goals']) {
        await DB.clear(store);
        AppState.get(store).length = 0;
      }
      for (const k of ['currentTaskId','currentSubtaskId','focusActive','focusTimerRemain',
                        'onboardingComplete','streakData','gmailToken','settings']) {
        await DB.setMeta(k, undefined);
      }
      Shell.toast('Reset complete — reloading…');
      setTimeout(() => window.location.href = 'index.html', 1200);
    };

    // Restart onboarding
    const robBtn = document.getElementById('restartOnboardingBtn');
    if (robBtn) robBtn.onclick = async () => {
      await DB.setMeta('onboardingComplete', false);
      window.location.href = 'index.html';
    };
  }
};
