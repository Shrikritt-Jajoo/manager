'use strict';
const Shell = {
  _toastTimer: null,

  // Phase 0: added type parameter for AI system compatibility
  // type: 'info' | 'success' | 'error' | 'warning' (currently all styled the same;
  //       type is accepted so ai.js calling Shell.toast(msg, type, duration) does not throw)
  toast(msg, typeOrDuration, duration) {
    let dur = 2800;
    // Handle both old signature toast(msg, duration) and new toast(msg, type, duration)
    if (typeof typeOrDuration === 'number') {
      dur = typeOrDuration;
    } else if (typeof duration === 'number') {
      dur = duration;
    }
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), dur);
  },

  confirm(msg) {
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'confirm-overlay';
      ov.innerHTML = `
        <div class="confirm-box" role="dialog" aria-modal="true">
          <div class="confirm-msg">${Utils.escapeHtml(msg)}</div>
          <div class="confirm-actions">
            <button class="abtn sm" id="cfNo">Cancel</button>
            <button class="abtn sm" id="cfYes">Confirm</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      ov.querySelector('#cfNo').onclick  = () => { ov.remove(); resolve(false); };
      ov.querySelector('#cfYes').onclick = () => { ov.remove(); resolve(true);  };
    });
  },

  navigate(page) { window.location.href = page; },

  bindNavButtons() {
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.nav));
    });
  }
};

// Phase 0: AppShell alias — ai.js from chronoflow calls AppShell.toast()
// This single alias means ai.js can be copied verbatim with zero changes.
const AppShell = Shell;

// ── Onboarding ────────────────────────────────────────────────────────────────
const Onboarding = {
  _step: 0,
  _slots: [],
  _focusDur: 25,
  _goalTitle: '',
  _goalDesc: '',
  STEPS: 6,

  async check() {
    await AppState.init();
    const done = AppState.getMeta('onboardingComplete');
    if (!done) this.start();
    else { this._bootPage(); }
  },

  _bootPage() {
    Shell.bindNavButtons();
    if (typeof PageInit !== 'undefined') PageInit();
  },

  start() {
    this._step = 0;
    this._render();
  },

  _render() {
    const existing = document.getElementById('onbOverlay');
    if (existing) existing.remove();

    const ov = document.createElement('div');
    ov.id = 'onbOverlay';
    ov.className = 'onb-overlay';
    ov.innerHTML = this._stepHTML();
    document.body.appendChild(ov);
    this._bindStep(ov);
  },

  _dots() {
    return Array.from({ length: this.STEPS }, (_, i) =>
      `<div class="onb-dot${i === this._step ? ' active' : ''}"></div>`
    ).join('');
  },

  _stepHTML() {
    const d = this._dots();
    switch (this._step) {
      case 0: return `
        <div class="onb-box">
          <div class="onb-title">ChronoFlow</div>
          <div class="onb-sub">Your focus OS. It hides when you work.<br>It surfaces when you need it.<br>Let's set up your workspace.</div>
          <button class="abtn" id="onbNext">Begin</button>
          <div class="onb-dots">${d}</div>
        </div>`;
      case 1: return `
        <div class="onb-box">
          <div class="onb-title">What are you working on?</div>
          <div class="onb-sub">Add your first goal. ChronoFlow can use AI to break it into tasks for you.</div>
          <div class="onb-form">
            <input class="onb-input" id="onbGoalTitle" placeholder="Goal title (e.g. Pass Physics HL)" value="${Utils.escapeHtml(this._goalTitle)}">
            <textarea class="onb-input" id="onbGoalDesc" placeholder="Description (optional)" rows="2">${Utils.escapeHtml(this._goalDesc)}</textarea>
          </div>
          <div class="onb-actions">
            <button class="onb-skip" id="onbSkip">Skip</button>
            <button class="abtn" id="onbNext">Continue</button>
          </div>
          <div class="onb-dots">${d}</div>
        </div>`;
      case 2: return `
        <div class="onb-box">
          <div class="onb-title">When do you work?</div>
          <div class="onb-sub">Add your available time slots. ChronoFlow schedules tasks inside these windows.</div>
          <div class="onb-form">
            <div class="onb-slot-row">
              <input type="text"  class="onb-input" id="slotLabel" placeholder="Label (e.g. Morning Focus)" style="width:160px">
              <input type="time"  id="slotStart" value="09:00">
              <span style="color:var(--text-muted);font-size:12px">to</span>
              <input type="time"  id="slotEnd" value="17:00">
            </div>
            <div class="energy-row" id="slotEnergy" aria-label="Energy level">
              ${[1,2,3,4,5].map(i => `<div class="e-dot${i<=3?' on':''}" data-e="${i}" role="radio" aria-checked="${i<=3}" tabindex="0"></div>`).join('')}
              <span style="font-size:11px;color:var(--text-muted);letter-spacing:.14em">ENERGY</span>
            </div>
            <button class="abtn sm" id="addSlotBtn">+ Add slot</button>
            <div class="onb-slots-list" id="onbSlotsList">${this._slotsHTML()}</div>
          </div>
          <div class="onb-actions">
            <button class="onb-skip" id="onbSkip">Skip (use 9–5 default)</button>
            <button class="abtn" id="onbNext">Continue</button>
          </div>
          <div class="onb-dots">${d}</div>
        </div>`;
      case 3: return `
        <div class="onb-box">
          <div class="onb-title">How long is your default focus session?</div>
          <div class="onb-sub">You can change this anytime in Settings.</div>
          <div class="onb-timer-opts">
            <button class="abtn${this._focusDur===25?' active':''}" data-dur="25">25 min</button>
            <button class="abtn${this._focusDur===45?' active':''}" data-dur="45">45 min</button>
            <button class="abtn${this._focusDur===90?' active':''}" data-dur="90">90 min</button>
          </div>
          <div class="onb-actions" style="margin-top:var(--sp4)">
            <button class="abtn" id="onbNext">Continue</button>
          </div>
          <div class="onb-dots">${d}</div>
        </div>`;
      case 4: return `
        <div class="onb-box">
          <div class="onb-title">Connect Gmail</div>
          <div class="onb-sub">ChronoFlow can email your daily schedule each morning.<br><span style="font-size:11px;opacity:.5">Requires running via http://localhost — see README.</span></div>
          <div class="onb-actions">
            <button class="onb-skip" id="onbSkip">Skip for now</button>
            <button class="abtn" id="gmailOnbBtn">Connect Gmail</button>
          </div>
          <div class="onb-dots">${d}</div>
        </div>`;
      case 5: return `
        <div class="onb-box">
          <div class="onb-title">You're ready.</div>
          <div class="onb-sub">Move your mouse to reveal the interface.<br>Start by adding your first task in the Planner.</div>
          <div class="onb-actions">
            <button class="abtn" id="onbFinish">Go to Planner</button>
          </div>
          <div class="onb-dots">${d}</div>
        </div>`;
      default: return '';
    }
  },

  _slotsHTML() {
    if (!this._slots.length) return '<div style="font-size:11px;color:var(--text-faint)">No slots added yet.</div>';
    return this._slots.map((sl, i) =>
      `<div class="onb-slot-item">
        <span>${Utils.escapeHtml(sl.label)} · ${sl.startT}–${sl.endT} · E${sl.energy}</span>
        <button data-rm="${i}">×</button>
      </div>`
    ).join('');
  },

  _energyLevel(ov) {
    const on = ov.querySelectorAll('#slotEnergy .e-dot.on');
    return on.length || 3;
  },

  _bindStep(ov) {
    const back = ov.querySelector('#onbBack');
    if (back) back.onclick = () => { this._step = Math.max(0, this._step - 1); this._render(); };

    const next = ov.querySelector('#onbNext');
    const skip = ov.querySelector('#onbSkip');

    if (this._step === 1 && next) {
      next.onclick = () => {
        this._goalTitle = ov.querySelector('#onbGoalTitle').value.trim();
        this._goalDesc  = ov.querySelector('#onbGoalDesc').value.trim();
        this._step++; this._render();
      };
    }

    if (this._step === 2) {
      ov.querySelectorAll('.e-dot').forEach(dot => {
        dot.onclick = dot.onkeydown = (e) => {
          if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
          const val = parseInt(dot.dataset.e);
          ov.querySelectorAll('.e-dot').forEach((d, i) => {
            d.classList.toggle('on', i < val);
            d.setAttribute('aria-checked', i < val);
          });
        };
      });

      const addSlotBtn = ov.querySelector('#addSlotBtn');
      if (addSlotBtn) addSlotBtn.onclick = () => {
        const label  = ov.querySelector('#slotLabel').value.trim() || 'Work';
        const startT = ov.querySelector('#slotStart').value;
        const endT   = ov.querySelector('#slotEnd').value;
        const energy = this._energyLevel(ov);
        if (startT >= endT) { Shell.toast('End time must be after start'); return; }
        this._slots.push({ label, startT, endT, energy });
        ov.querySelector('#onbSlotsList').innerHTML = this._slotsHTML();
        this._bindSlotRemove(ov);
      };
      this._bindSlotRemove(ov);

      if (skip) skip.onclick = async () => {
        if (!this._slots.length) {
          this._slots.push({ label:'Work', startT:'09:00', endT:'17:00', energy:3 });
        }
        this._step++; this._render();
      };
      if (next) next.onclick = () => { this._step++; this._render(); };
    }

    if (this._step === 3) {
      ov.querySelectorAll('[data-dur]').forEach(btn => {
        btn.onclick = () => {
          this._focusDur = parseInt(btn.dataset.dur);
          ov.querySelectorAll('[data-dur]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        };
      });
      if (next) next.onclick = () => { this._step++; this._render(); };
    }

    if (this._step === 4) {
      const gmailBtn = ov.querySelector('#gmailOnbBtn');
      if (gmailBtn) gmailBtn.onclick = async () => {
        try { await Gmail.connect(); Shell.toast('Gmail connected!'); } catch(e) { Shell.toast('Gmail connect failed — skip for now'); }
        this._step++; this._render();
      };
      if (skip) skip.onclick = () => { this._step++; this._render(); };
    }

    if (this._step === 5) {
      const fin = ov.querySelector('#onbFinish');
      if (fin) fin.onclick = async () => { await this._finish(); };
    }

    if (this._step === 0 && next) next.onclick = () => { this._step++; this._render(); };
    if (skip && this._step === 1) skip.onclick = () => { this._step++; this._render(); };
  },

  _bindSlotRemove(ov) {
    ov.querySelectorAll('[data-rm]').forEach(btn => {
      btn.onclick = () => {
        this._slots.splice(parseInt(btn.dataset.rm), 1);
        ov.querySelector('#onbSlotsList').innerHTML = this._slotsHTML();
        this._bindSlotRemove(ov);
      };
    });
  },

  async _finish() {
    if (this._goalTitle) {
      await AppState.add('goals', {
        id: Utils.uid('goal'), title: this._goalTitle,
        description: this._goalDesc, createdAt: new Date().toISOString()
      });
    }

    const today = new Date();
    for (const sl of this._slots) {
      const [sh,sm] = sl.startT.split(':').map(Number);
      const [eh,em] = sl.endT.split(':').map(Number);
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), sh, sm);
      const end   = new Date(today.getFullYear(), today.getMonth(), today.getDate(), eh, em);
      await AppState.add('slots', {
        id: Utils.uid('slot'), label: sl.label,
        start: start.toISOString(), end: end.toISOString(),
        energyLevel: sl.energy, recurring: 'daily', daysOfWeek: [1,2,3,4,5]
      });
    }

    // saveSettings still works exactly as before
    await AppState.saveSettings({ focusDuration: this._focusDur });
    await AppState.setMeta('onboardingComplete', true);

    const ov = document.getElementById('onbOverlay');
    if (ov) ov.remove();
    window.location.href = 'planner.html';
  }
};
