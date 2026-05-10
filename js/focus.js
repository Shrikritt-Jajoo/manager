'use strict';
(async () => {
  await AppState.init();
  Starfield.init();
  Shell.bindNavButtons();
  FocusController.init();
})();

const FocusController = {
  _taskId:    null,
  _remain:    0,
  _elapsedS:  0,
  _paused:    false,
  _pausedAt:  0,
  _interval:  null,
  _startedAt: null,
  _plannedMins: 25,

  async init() {
    const params = new URLSearchParams(window.location.search);
    const isEnd  = params.get('end') === '1';
    const rawTask = params.get('taskId');

    if (isEnd) {
      const saved = sessionStorage.getItem('cf_session');
      if (saved) {
        const { taskId, actualMins, startedAt } = JSON.parse(saved);
        sessionStorage.removeItem('cf_session');
        this._taskId    = taskId;
        this._elapsedS  = actualMins * 60;
        this._startedAt = startedAt;
        this._showPostModal(taskId, actualMins);
        return;
      }
    }

    this._taskId = rawTask || AppState.getMeta('currentTaskId');
    if (!this._taskId) { Shell.toast('No task selected'); return; }

    const settings = AppState.getSettings();
    this._plannedMins = settings.focusDuration || 25;
    const saved = AppState.getMeta('focusTimerRemain');
    this._remain = (saved && AppState.getMeta('focusActive')) ? saved : this._plannedMins * 60;
    this._elapsedS = 0;
    this._paused   = false;
    this._startedAt = new Date().toISOString();

    await AppState.setMeta('focusActive',    true);
    await AppState.setMeta('focusStartedAt', this._startedAt);
    await AppState.setMeta('currentTaskId',  this._taskId);

    this._renderTask();
    this._bindControls();
    this._startInterval();

    if ('wakeLock' in navigator) {
      try { await navigator.wakeLock.request('screen'); } catch(e) {}
    }
  },

  _renderTask() {
    const task = AppState.get('tasks').find(t => t.id === this._taskId);
    if (!task) return;

    const titleEl = document.getElementById('focusTaskTitle');
    const stepEl  = document.getElementById('focusStepText');
    const progEl  = document.getElementById('focusProg');

    if (titleEl) titleEl.textContent = task.title;
    if (progEl)  progEl.style.width  = `${task.progressPercent || 0}%`;

    const subtasks = AppState.get('subtasks').filter(s => s.taskId === task.id && !s.isCompleted);
    const subId    = AppState.getMeta('currentSubtaskId');
    const sub      = subtasks.find(s => s.id === subId) || subtasks[0];

    if (sub && stepEl) {
      const step = sub.steps[sub.currentStepIndex] || sub.steps[0];
      stepEl.textContent = step || sub.title;
    } else if (stepEl) {
      stepEl.textContent = task.nextStep || '—';
    }
  },

  _bindControls() {
    const pauseBtn = document.getElementById('focusPauseBtn');
    const endBtn   = document.getElementById('focusEndBtn');
    if (pauseBtn) pauseBtn.addEventListener('click', () => this._togglePause());
    if (endBtn)   endBtn.addEventListener('click',   () => this._end());
  },

  _startInterval() {
    this._interval = setInterval(() => {
      if (this._paused) return;
      if (this._remain > 0) { this._remain--; this._elapsedS++; }
      const el = document.getElementById('focusTimerBig');
      if (el) el.textContent = Utils.formatCountdown(this._remain);
      AppState.setMeta('focusTimerRemain', this._remain);
      if (this._remain === 0) { clearInterval(this._interval); this._end(); }
    }, 1000);
  },

  _togglePause() {
    const btn = document.getElementById('focusPauseBtn');
    const el  = document.getElementById('focusTimerBig');
    this._paused = !this._paused;
    if (btn) btn.textContent = this._paused ? 'Resume' : 'Pause';
    if (el)  el.classList.toggle('paused', this._paused);
  },

  _end() {
    clearInterval(this._interval);
    const actualMins = Math.ceil(this._elapsedS / 60);
    this._showPostModal(this._taskId, actualMins);
  },

  _showPostModal(taskId, actualMins) {
    const ov   = document.getElementById('sessionModalOverlay');
    const sub  = document.getElementById('smSub');
    const range= document.getElementById('smRange');
    const rVal = document.getElementById('smRangeVal');
    if (!ov) return;

    const task = AppState.get('tasks').find(t => t.id === taskId);
    const curProg = task ? (task.progressPercent || 0) : 0;

    if (sub)   sub.textContent   = `You worked for ${actualMins} minute${actualMins !== 1 ? 's' : ''}.`;
    if (range) { range.value = curProg; if (rVal) rVal.textContent = `${curProg}%`; }
    if (range) range.addEventListener('input', () => { if (rVal) rVal.textContent = `${range.value}%`; });

    ov.classList.remove('hidden');

    document.getElementById('smDiscard').onclick = async () => {
      await AppState.setMeta('focusActive', false);
      ov.classList.add('hidden');
      window.location.href = 'index.html';
    };

    document.getElementById('smSave').onclick = async () => {
      const prog  = parseInt(range.value);
      const notes = document.getElementById('smNotes').value;
      await this._saveSession(taskId, actualMins, prog, curProg, notes);
      ov.classList.add('hidden');
      window.location.href = 'index.html';
    };
  },

  async _saveSession(taskId, actualMins, newProg, oldProg, notes) {
    const task = AppState.get('tasks').find(t => t.id === taskId);
    if (!task) return;

    const rem = Math.max(0, Math.ceil(task.estimatedMinutes * (1 - newProg / 100)));
    await AppState.update('tasks', taskId, {
      progressPercent: newProg,
      remainingMinutes: rem
    });

    await AppState.add('focusSessions', {
      id:            Utils.uid('session'),
      taskId,
      subtaskId:     AppState.getMeta('currentSubtaskId') || null,
      startedAt:     this._startedAt || new Date().toISOString(),
      endedAt:       new Date().toISOString(),
      plannedMinutes: this._plannedMins,
      actualMinutes:  actualMins,
      progressDelta:  newProg - oldProg,
      notes
    });

    // update streak
    await this._updateStreak(newProg - oldProg, task.estimatedMinutes || 30);

    // auto-advance step
    if (AppState.getSettings().autoStep) {
      const subId    = AppState.getMeta('currentSubtaskId');
      const subtasks = AppState.get('subtasks').filter(s => s.taskId === taskId && !s.isCompleted);
      const sub      = subtasks.find(s => s.id === subId) || subtasks[0];
      if (sub) {
        const next = sub.currentStepIndex + 1;
        if (next < sub.steps.length) {
          await AppState.update('subtasks', sub.id, { currentStepIndex: next });
        }
      }
    }

    if (newProg >= 100) {
      await AppState.update('tasks', taskId, { isCompleted: true, completedAt: new Date().toISOString() });
      await Scheduler.rescheduleUnfinished();
    }

    await AppState.setMeta('focusActive', false);
    await AppState.setMeta('focusTimerRemain', undefined);
  },

  async _updateStreak(delta, estimatedMinutes) {
    const key  = Utils.todayKey();
    let streak = AppState.getMeta('streakData') || { lastDate: null, count: 0, dailyLog: {} };
    streak.dailyLog = streak.dailyLog || {};
    streak.dailyLog[key] = (streak.dailyLog[key] || 0) + delta;

    // recalculate streak: eligible if dailyLog[date] >= 60 (progress points)
    const dates = Object.keys(streak.dailyLog).sort().reverse();
    let count = 0;
    let prev  = null;
    for (const d of dates) {
      if (streak.dailyLog[d] < 60) break;
      if (prev) {
        const diff = (new Date(prev) - new Date(d)) / 86400000;
        if (diff > 1) break;
      }
      count++;
      prev = d;
    }
    streak.count    = count;
    streak.lastDate = dates[0] || null;
    await AppState.setMeta('streakData', streak);
  }
};
