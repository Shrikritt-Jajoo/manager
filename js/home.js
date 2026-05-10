'use strict';
let PageInit;

(async () => {
  await AppState.init();
  Starfield.init();

  const onb = AppState.getMeta('onboardingComplete');
  if (!onb) { Onboarding.start(); return; }

  Shell.bindNavButtons();
  HomeController.init();
})();

const HomeController = {
  _hideTimer: null,
  _tickTimer: null,
  _focusInterval: null,
  _remain: 0,
  _paused: false,
  _pausedAt: 0,
  _elapsedS: 0,

  init() {
    this._tick();
    this._tickTimer = setInterval(() => this._tick(), 1000);
    this._bindUI();
    this._loadTask();
    this._checkFocusState();

    AppState.onMeta('currentTaskId',    () => this._loadTask());
    AppState.onMeta('currentSubtaskId', () => this._loadTask());
    AppState.onMeta('focusActive',      () => this._checkFocusState());
    AppState.on('tasks',                () => this._loadTask());
  },

  _tick() {
    const now  = new Date();
    const tEl  = document.getElementById('clockTime');
    const dEl  = document.getElementById('clockDate');
    if (tEl) tEl.textContent = Utils.formatTime(now);
    if (dEl) dEl.textContent = Utils.formatDate(now);
  },

  _bindUI() {
    const ui = document.getElementById('ui');
    const showUI = () => {
      document.getElementById('nav').classList.add('show');
      document.getElementById('brBlock').classList.add('show');
      document.getElementById('strip').classList.add('show');
      ui.classList.add('show-masks');
      clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => {
        if (!AppState.getMeta('focusActive')) {
          document.getElementById('nav').classList.remove('show');
          document.getElementById('brBlock').classList.remove('show');
          document.getElementById('strip').classList.remove('show');
          ui.classList.remove('show-masks');
        }
      }, 2600);
    };
    window.addEventListener('mousemove', showUI, { passive: true });
    window.addEventListener('mousedown', showUI, { passive: true });
    window.addEventListener('keydown',   showUI, { passive: true });

    document.getElementById('stepPrev').addEventListener('click', () => this._navigateStep(-1));
    document.getElementById('stepNext').addEventListener('click', () => this._navigateStep(1));
    document.getElementById('homePauseBtn').addEventListener('click', () => this._togglePause());
    document.getElementById('homeEndBtn').addEventListener('click',   () => this._endFocus());
  },

  async _loadTask() {
    const taskId = AppState.getMeta('currentTaskId');
    const tasks  = AppState.get('tasks');
    const task   = tasks.find(t => t.id === taskId);

    const nameEl = document.getElementById('brTaskName');
    const progEl = document.getElementById('brProg');
    const subEl  = document.getElementById('stripSub');
    const stepEl = document.getElementById('stripStep');

    if (!task) {
      if (nameEl) nameEl.textContent = '—';
      if (progEl) progEl.style.width = '0%';
      if (subEl)  subEl.textContent  = 'No task selected';
      if (stepEl) stepEl.textContent = 'Go to Planner to add tasks';
      return;
    }

    if (nameEl) nameEl.textContent = task.title;
    if (progEl) progEl.style.width = `${task.progressPercent || 0}%`;

    const subId    = AppState.getMeta('currentSubtaskId');
    const subtasks = AppState.get('subtasks').filter(s => s.taskId === task.id && !s.isCompleted);
    const sub      = subtasks.find(s => s.id === subId) || subtasks[0];

    if (sub) {
      const step = sub.steps[sub.currentStepIndex] || sub.steps[0] || '—';
      if (subEl)  subEl.textContent  = sub.title;
      if (stepEl) stepEl.textContent = step;
    } else {
      if (subEl)  subEl.textContent  = task.title;
      if (stepEl) stepEl.textContent = task.nextStep || 'No step defined — edit in Planner';
    }
  },

  async _navigateStep(dir) {
    const taskId   = AppState.getMeta('currentTaskId');
    const subtasks = AppState.get('subtasks').filter(s => s.taskId === taskId && !s.isCompleted);
    if (!subtasks.length) return;

    let subId = AppState.getMeta('currentSubtaskId');
    let subIdx = subtasks.findIndex(s => s.id === subId);
    if (subIdx === -1) subIdx = 0;

    let sub = subtasks[subIdx];
    let stepIdx = sub.currentStepIndex || 0;

    stepIdx += dir;
    if (stepIdx < 0) {
      subIdx = Math.max(0, subIdx - 1);
      sub = subtasks[subIdx];
      stepIdx = sub.steps.length - 1;
    } else if (stepIdx >= sub.steps.length) {
      subIdx = Math.min(subtasks.length - 1, subIdx + 1);
      sub = subtasks[subIdx];
      stepIdx = 0;
    }

    await AppState.update('subtasks', sub.id, { currentStepIndex: stepIdx });
    await AppState.setMeta('currentSubtaskId', sub.id);
    this._loadTask();
  },

  _checkFocusState() {
    const active = AppState.getMeta('focusActive');
    const clockTime   = document.getElementById('clockTime');
    const clockDate   = document.getElementById('clockDate');
    const focusTimer  = document.getElementById('homeFocusTimer');
    const focusCtrl   = document.getElementById('focusCtrlHover');
    const brTimer     = document.getElementById('brTimer');

    if (active) {
      clockTime.classList.add('hidden');
      clockDate.classList.add('hidden');
      focusTimer.classList.remove('hidden');
      focusCtrl.classList.remove('hidden');

      const startedAt = AppState.getMeta('focusStartedAt');
      const settings  = AppState.getSettings();
      const planned   = (settings.focusDuration || 25) * 60;
      const saved     = AppState.getMeta('focusTimerRemain');
      this._remain    = saved !== undefined ? saved : planned;
      this._paused    = false;
      this._elapsedS  = 0;

      clearInterval(this._focusInterval);
      this._focusInterval = setInterval(() => this._focusTick(), 1000);
      this._focusTick();
      this._updateBrTimer();

      // keep masks subtly visible during focus
      document.getElementById('ui').classList.add('show-masks');
      document.getElementById('brBlock').classList.add('show');
      document.getElementById('strip').classList.add('show');
    } else {
      clearInterval(this._focusInterval);
      clockTime.classList.remove('hidden');
      clockDate.classList.remove('hidden');
      focusTimer.classList.add('hidden');
      focusCtrl.classList.add('hidden');
      if (brTimer) brTimer.textContent = '—';
    }
  },

  _focusTick() {
    if (this._paused) return;
    if (this._remain > 0) {
      this._remain--;
      this._elapsedS++;
    }
    const el = document.getElementById('homeFocusTimer');
    if (el) el.textContent = Utils.formatCountdown(this._remain);
    AppState.setMeta('focusTimerRemain', this._remain);
    this._updateBrTimer();
    if (this._remain === 0) this._endFocus();
  },

  _updateBrTimer() {
    const el = document.getElementById('brTimer');
    if (el) el.textContent = `FOCUS TIMER · ${Utils.formatCountdown(this._remain)}`;
  },

  _togglePause() {
    const btn = document.getElementById('homePauseBtn');
    const el  = document.getElementById('homeFocusTimer');
    this._paused = !this._paused;
    if (btn) btn.textContent = this._paused ? 'Resume' : 'Pause';
    if (el)  el.classList.toggle('paused', this._paused);
  },

  async _endFocus() {
    clearInterval(this._focusInterval);
    const taskId = AppState.getMeta('currentTaskId');
    const task   = AppState.get('tasks').find(t => t.id === taskId);
    await AppState.setMeta('focusActive', false);
    // Navigate to focus page for post-session modal
    const actualMins = Math.ceil(this._elapsedS / 60);
    sessionStorage.setItem('cf_session', JSON.stringify({
      taskId, actualMins, startedAt: AppState.getMeta('focusStartedAt')
    }));
    window.location.href = `focus.html?end=1&taskId=${encodeURIComponent(taskId||'')}`;
  }
};
