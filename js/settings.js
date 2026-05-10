'use strict';
// Phase 7: removed duplicate Starfield.init(); added tab switching logic.
// Phase G: built out #aiJobsPanel — job cards with enable toggle + run-now + output UI.
// Glass patch: added glass appearance controls (blur, tint opacity, tint colour, bg colour).
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
    this._buildAiJobsPanel();
    // Apply persisted glass settings immediately on load
    this.applyGlassSettings();
  },

  // ---- Tab switching ---------------------------------------------------
  _bindTabs() {
    document.querySelectorAll('.stab').forEach(btn => {
      btn.onclick = () => this._switchTab(btn.dataset.tab);
    });
  },

  _switchTab(name) {
    this._activeTab = name;
    document.querySelectorAll('.stab').forEach(btn => {
      const active = btn.dataset.tab === name;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active);
    });
    document.querySelectorAll('[data-tab-panel]').forEach(panel => {
      panel.classList.toggle('hidden', panel.dataset.tabPanel !== name);
    });
    // Scroll content back to top when switching tabs
    const layout = document.getElementById('settingsLayout');
    if (layout) layout.scrollTop = 0;
  },

  // ---- Apply glass settings live via injected <style> -----------------
  // Overrides CSS variables and backdrop-filter values so all glass
  // surfaces on every page pick up the changes after a reload.
  // On the settings page itself we inject a live <style> tag so the
  // preview is immediate.
  applyGlassSettings() {
    const s      = AppState.getSettings();
    const blur   = s.glassBlur        != null ? s.glassBlur        : 18;
    const opPct  = s.glassTintOpacity != null ? s.glassTintOpacity : 6;
    const tint   = s.glassTintColor   || '#BFAE99';
    const bg     = s.bgColor          || '#000000';

    // Parse hex tint to r,g,b
    const rgb = Utils.hexToRgb(tint) || [191, 174, 153];
    const op      = opPct / 100;
    const opModal = Math.min(opPct * 1.7, 30) / 100;
    const opPanel = Math.max(opPct * 0.85, 0) / 100;
    const blurHeavy = Math.round(blur * 1.78);
    const blurLight = Math.round(blur * 0.78);

    let tag = document.getElementById('_glassOverride');
    if (!tag) {
      tag = document.createElement('style');
      tag.id = '_glassOverride';
      document.head.appendChild(tag);
    }
    tag.textContent = `
      html, body, #starCanvas { background: ${bg} !important; }
      .glass {
        background: rgba(${rgb},${op.toFixed(3)}) !important;
        backdrop-filter: blur(${blur}px) saturate(1.5) brightness(0.88) !important;
        -webkit-backdrop-filter: blur(${blur}px) saturate(1.5) brightness(0.88) !important;
      }
      .glass-modal {
        background: rgba(${rgb},${opModal.toFixed(3)}) !important;
        backdrop-filter: blur(${blurHeavy}px) saturate(1.8) brightness(0.78) !important;
        -webkit-backdrop-filter: blur(${blurHeavy}px) saturate(1.8) brightness(0.78) !important;
      }
      .glass-panel {
        background: rgba(${rgb},${opPanel.toFixed(3)}) !important;
        backdrop-filter: blur(${blur}px) saturate(1.5) brightness(0.88) !important;
        -webkit-backdrop-filter: blur(${blur}px) saturate(1.5) brightness(0.88) !important;
      }
      .panel, .br-block, .strip, .metric-card, .session-modal,
      .onb-box, .confirm-box {
        background: rgba(${rgb},${op.toFixed(3)}) !important;
        backdrop-filter: blur(${blur}px) saturate(1.5) brightness(0.88) !important;
        -webkit-backdrop-filter: blur(${blur}px) saturate(1.5) brightness(0.88) !important;
      }
      .onb-box, .confirm-box, .session-modal {
        background: rgba(${rgb},${opModal.toFixed(3)}) !important;
        backdrop-filter: blur(${blurHeavy}px) saturate(1.8) brightness(0.78) !important;
        -webkit-backdrop-filter: blur(${blurHeavy}px) saturate(1.8) brightness(0.78) !important;
      }
    `;
  },

  // ---- AI Jobs Panel ---------------------------------------------------
  _buildAiJobsPanel() {
    const panel = document.getElementById('aiJobsPanel');
    if (!panel) return;

    const jobs    = AppState.get('registeredAiJobs');
    const aiCfg   = AppState.getConfig('aiConfig') || {};
    const disabled = new Set(aiCfg.disabledJobs || []);

    if (!jobs.length) {
      panel.innerHTML = '<div style="font-size:12px;color:var(--text-faint);margin-top:var(--sp5)">No AI jobs registered.</div>';
      return;
    }

    panel.innerHTML = '';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-muted);margin-top:var(--sp6);margin-bottom:var(--sp3)';
    title.textContent = 'Registered Jobs';
    panel.appendChild(title);

    jobs.forEach(job => {
      const isEnabled = !disabled.has(job.id);
      const card = document.createElement('div');
      card.style.cssText = 'border-bottom:1px solid rgba(245,247,251,.06);padding:var(--sp4) 0;margin-bottom:var(--sp3)';
      card.dataset.jobCard = job.id;

      const header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;gap:var(--sp3);flex-wrap:wrap';

      const labelEl = document.createElement('div');
      labelEl.style.cssText = 'font-size:13px;color:var(--text);flex:1;font-weight:500';
      labelEl.textContent = job.label || job.id;

      const triggerBadge = document.createElement('span');
      triggerBadge.style.cssText = 'font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);background:rgba(191,174,153,.12);padding:2px 7px';
      triggerBadge.textContent = job.trigger || 'manual';

      const toggleBtn = document.createElement('button');
      toggleBtn.className = `toggle${isEnabled ? ' on' : ''}`;
      toggleBtn.setAttribute('role', 'switch');
      toggleBtn.setAttribute('aria-checked', isEnabled);
      toggleBtn.setAttribute('aria-label', `Enable ${job.label}`);
      toggleBtn.onclick = async () => {
        const cfg     = AppState.getConfig('aiConfig') || {};
        const disSet  = new Set(cfg.disabledJobs || []);
        const nowOn   = !toggleBtn.classList.contains('on');
        if (nowOn) disSet.delete(job.id); else disSet.add(job.id);
        toggleBtn.classList.toggle('on', nowOn);
        toggleBtn.setAttribute('aria-checked', nowOn);
        await AppState.setConfig('aiConfig', Object.assign({}, cfg, { disabledJobs: [...disSet] }));
        Shell.toast(nowOn ? `${job.label} enabled` : `${job.label} disabled`);
      };

      const runBtn = document.createElement('button');
      runBtn.className = 'abtn sm';
      runBtn.textContent = 'Run now';
      runBtn.onclick = () => this._runJobFromSettings(job, card);

      header.appendChild(labelEl);
      header.appendChild(triggerBadge);
      header.appendChild(toggleBtn);
      header.appendChild(runBtn);

      const promptPre = document.createElement('div');
      promptPre.style.cssText = 'font-size:11px;color:var(--text-faint);margin-top:var(--sp3);white-space:pre-wrap;max-height:60px;overflow:hidden;cursor:pointer;border-top:1px solid rgba(245,247,251,.05);padding-top:var(--sp3)';
      promptPre.title = 'Click to expand system prompt';
      promptPre.textContent = (job.systemPrompt || '').slice(0, 120) + ((job.systemPrompt||'').length > 120 ? '…' : '');
      promptPre.onclick = () => {
        const expanded = promptPre.style.maxHeight !== 'none';
        promptPre.style.maxHeight = expanded ? 'none' : '60px';
        promptPre.style.overflow  = expanded ? 'visible' : 'hidden';
        if (expanded) promptPre.textContent = job.systemPrompt || '';
        else promptPre.textContent = (job.systemPrompt || '').slice(0, 120) + '…';
      };

      const outputArea = document.createElement('div');
      outputArea.dataset.jobOutput = job.id;
      outputArea.style.display = 'none';
      outputArea.style.marginTop = 'var(--sp4)';

      card.appendChild(header);
      card.appendChild(promptPre);
      card.appendChild(outputArea);
      panel.appendChild(card);
    });
  },

  async _runJobFromSettings(job, card) {
    const outputArea = card.querySelector(`[data-job-output="${job.id}"]`);
    if (!outputArea) return;
    if (!AI.isOnline()) { Shell.toast('No internet — AI unavailable offline'); return; }
    if (!AI._getKey())  { Shell.toast('Add Gemini API key above first'); return; }
    outputArea.style.display = '';
    outputArea.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">Running…</div>';
    try {
      const result = await AI.runJob(job.id);
      this._renderJobOutput(job, result, outputArea);
    } catch(e) {
      outputArea.innerHTML = `<div style="font-size:12px;color:var(--text-faint)">✗ ${Utils.escapeHtml(e.message)}</div>`;
      Shell.toast('AI error: ' + e.message);
    }
  },

  _renderJobOutput(job, result, outputArea) {
    outputArea.innerHTML = '';
    const type = job.outputSchema && job.outputSchema.type;
    if (type === 'email') {
      const subjectEl = document.createElement('div');
      subjectEl.style.cssText = 'font-size:12px;color:var(--text-muted);margin-bottom:var(--sp2)';
      subjectEl.textContent = 'Subject: ' + (result.subject || '(none)');
      const bodyEl = document.createElement('div');
      bodyEl.style.cssText = 'font-size:12px;color:var(--text-faint);white-space:pre-wrap;max-height:200px;overflow-y:auto;padding:var(--sp3)';
      bodyEl.textContent = result.body || '';
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:var(--sp3);margin-top:var(--sp3)';
      const sendBtn = document.createElement('button'); sendBtn.className='abtn sm'; sendBtn.textContent='Send via Gmail';
      sendBtn.onclick = async () => {
        try { await Gmail.sendSchedule(AppState.get('scheduleBlocks'), result.subject, result.body); Shell.toast('Email sent!'); outputArea.style.display='none'; }
        catch(e) { Shell.toast('Send failed: ' + e.message); }
      };
      const discardBtn = document.createElement('button'); discardBtn.className='abtn sm danger'; discardBtn.textContent='Discard';
      discardBtn.onclick = () => { outputArea.style.display='none'; outputArea.innerHTML=''; };
      actions.appendChild(sendBtn); actions.appendChild(discardBtn);
      outputArea.appendChild(subjectEl); outputArea.appendChild(bodyEl); outputArea.appendChild(actions);
      return;
    }
    if (type === 'weekly-review') {
      const mdEl = document.createElement('div');
      mdEl.style.cssText = 'font-size:12px;color:var(--text-muted);white-space:pre-wrap;max-height:300px;overflow-y:auto;padding:var(--sp3)';
      mdEl.textContent = result.markdown || '';
      const actions = document.createElement('div'); actions.style.cssText='display:flex;gap:var(--sp3);margin-top:var(--sp3)';
      const copyBtn = document.createElement('button'); copyBtn.className='abtn sm'; copyBtn.textContent='Copy';
      copyBtn.onclick = () => navigator.clipboard.writeText(result.markdown||'').then(()=>Shell.toast('Copied!')).catch(()=>Shell.toast('Copy failed'));
      const discardBtn = document.createElement('button'); discardBtn.className='abtn sm danger'; discardBtn.textContent='Discard';
      discardBtn.onclick = () => { outputArea.style.display='none'; outputArea.innerHTML=''; };
      actions.appendChild(copyBtn); actions.appendChild(discardBtn);
      outputArea.appendChild(mdEl); outputArea.appendChild(actions);
      return;
    }
    if (!result || !result.items || !result.items.length) {
      outputArea.innerHTML = '<div style="font-size:12px;color:var(--text-faint)">No suggestions returned.</div>';
      return;
    }
    const accepted = new Set();
    const summary = document.createElement('div');
    summary.style.cssText = 'font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:var(--sp3)';
    summary.textContent = result.summary || 'AI suggestions';
    const listEl = document.createElement('div');
    result.items.forEach((item, i) => {
      accepted.add(i);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-start;gap:var(--sp3);padding:var(--sp2) 0;border-bottom:1px solid rgba(245,247,251,.04)';
      const chk = document.createElement('input'); chk.type='checkbox'; chk.checked=true; chk.style.marginTop='3px';
      chk.onchange = () => chk.checked ? accepted.add(i) : accepted.delete(i);
      const label = document.createElement('div'); label.style.cssText='font-size:12px;color:var(--text-muted);flex:1';
      const actionTag = `<span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-right:5px">${Utils.escapeHtml(item.action||'')}</span>`;
      const titleStr = item.payload && item.payload.title ? Utils.escapeHtml(item.payload.title) : (item.id || JSON.stringify(item.payload||{}).slice(0,80));
      label.innerHTML = actionTag + titleStr;
      row.appendChild(chk); row.appendChild(label); listEl.appendChild(row);
    });
    const actions = document.createElement('div'); actions.style.cssText='display:flex;gap:var(--sp3);margin-top:var(--sp4)';
    const applyBtn = document.createElement('button'); applyBtn.className='abtn sm'; applyBtn.textContent='Apply selected';
    applyBtn.onclick = async () => {
      const count = await AI.applyOutputs(job, result, accepted);
      Shell.toast(`Applied ${count} change${count!==1?'s':''}`);
      outputArea.style.display='none'; outputArea.innerHTML='';
    };
    const discardBtn = document.createElement('button'); discardBtn.className='abtn sm danger'; discardBtn.textContent='Discard all';
    discardBtn.onclick = () => { outputArea.style.display='none'; outputArea.innerHTML=''; };
    actions.appendChild(applyBtn); actions.appendChild(discardBtn);
    outputArea.appendChild(summary); outputArea.appendChild(listEl); outputArea.appendChild(actions);
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

    // Glass controls
    const bgCol = document.getElementById('bgColor');
    if (bgCol) bgCol.value = s.bgColor || '#000000';

    const tintCol = document.getElementById('glassTintColor');
    if (tintCol) tintCol.value = s.glassTintColor || '#BFAE99';

    const tintOp = document.getElementById('glassTintOpacity');
    const tintOpVal = document.getElementById('glassTintOpacityVal');
    if (tintOp) {
      const v = s.glassTintOpacity != null ? s.glassTintOpacity : 6;
      tintOp.value = v;
      if (tintOpVal) tintOpVal.textContent = v + '%';
    }

    const blurEl = document.getElementById('glassBlur');
    const blurVal = document.getElementById('glassBlurVal');
    if (blurEl) {
      const v = s.glassBlur != null ? s.glassBlur : 18;
      blurEl.value = v;
      if (blurVal) blurVal.textContent = v + 'px';
    }

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

    // ── Glass controls ──────────────────────────────────────────────

    // Background colour
    const bgCol = document.getElementById('bgColor');
    if (bgCol) bgCol.oninput = async () => {
      await AppState.saveSettings({ bgColor: bgCol.value });
      this.applyGlassSettings();
    };

    // Glass tint colour
    const tintCol = document.getElementById('glassTintColor');
    if (tintCol) tintCol.oninput = async () => {
      await AppState.saveSettings({ glassTintColor: tintCol.value });
      this.applyGlassSettings();
    };

    // Glass tint opacity
    const tintOp = document.getElementById('glassTintOpacity');
    const tintOpVal = document.getElementById('glassTintOpacityVal');
    if (tintOp) tintOp.oninput = async () => {
      const v = parseInt(tintOp.value);
      if (tintOpVal) tintOpVal.textContent = v + '%';
      await AppState.saveSettings({ glassTintOpacity: v });
      this.applyGlassSettings();
    };

    // Glass blur intensity
    const blurEl = document.getElementById('glassBlur');
    const blurVal = document.getElementById('glassBlurVal');
    if (blurEl) blurEl.oninput = async () => {
      const v = parseInt(blurEl.value);
      if (blurVal) blurVal.textContent = v + 'px';
      await AppState.saveSettings({ glassBlur: v });
      this.applyGlassSettings();
    };

    // ── Star colours ────────────────────────────────────────────────
    document.querySelectorAll('[data-star-col]').forEach(inp => {
      inp.oninput = async () => {
        const cols = Array.from(document.querySelectorAll('[data-star-col]')).map(el => el.value);
        await AppState.saveSettings({ starBodyColors: cols });
        Starfield.rebuild();
      };
    });

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

    // Gemini key
    const gk = document.getElementById('geminiKey');
    if (gk) gk.onblur = async () =>
      await AppState.saveSettings({ geminiKey: gk.value.trim() });

    // Test AI
    const testBtn = document.getElementById('testAiBtn');
    const testRes = document.getElementById('aiTestResult');
    if (testBtn) testBtn.onclick = async () => {
      if (testRes) testRes.textContent = 'Testing…';
      try { await AI.ping(); if (testRes) testRes.textContent = '✓ Connected'; }
      catch(e) { if (testRes) testRes.textContent = '✗ ' + e.message; }
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

    // Clear completed
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
