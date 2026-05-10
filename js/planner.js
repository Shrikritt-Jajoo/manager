'use strict';
(async () => {
  await AppState.init();
  Starfield.init();
  Shell.bindNavButtons();
  Planner.init();
})();

const Planner = {
  _selectedTaskId: null,

  init() {
    this._render();
    this._bindForms();
    AppState.on('tasks',          () => this._render());
    AppState.on('subtasks',       () => this._renderDetail());
    AppState.on('goals',          () => this._renderGoals());
    AppState.on('slots',          () => this._renderSlots());
    AppState.on('scheduleBlocks', () => this._renderSchedule());
  },

  _render() {
    this._renderBacklog();
    this._renderGoals();
    this._renderSlots();
    this._renderSchedule();
    this._renderDetail();
  },

  // ── Backlog ──────────────────────────────────────────────────────────────
  _renderBacklog() {
    const el = document.getElementById('backlogList');
    if (!el) return;
    const tasks = AppState.get('tasks').filter(t => !t.isCompleted);
    if (!tasks.length) {
      el.innerHTML = '<div style="font-size:13px;color:var(--text-faint);padding:var(--sp4) 0">No tasks yet. Use Quick Capture or break down a goal.</div>';
      return;
    }
    el.innerHTML = tasks.map(t => this._taskCardHTML(t)).join('');
    this._bindCardActions(el);
  },

  _taskCardHTML(t) {
    const prog = t.progressPercent || 0;
    const hrs  = Utils.hoursUntil(t.deadline);
    const deadlineTag = t.deadline
      ? `<span class="tag${hrs < 24 ? ' warn' : ''}">${Utils.formatShortDate(new Date(t.deadline))}</span>` : '';
    return `<div class="task-card${t.id === this._selectedTaskId ? ' selected' : ''}" data-task-id="${t.id}">
      <div class="tc-title">${Utils.escapeHtml(t.title)}</div>
      <div class="tc-tags">
        <span class="tag">${t.type || 'task'}</span>
        <span class="tag">${Utils.formatDuration(t.remainingMinutes || t.estimatedMinutes || 30)} left</span>
        ${t.isPinned ? '<span class="tag accent">Pinned</span>' : ''}
        ${deadlineTag}
      </div>
      <div class="prog-track tc-prog"><div class="prog-fill" style="width:${prog}%"></div></div>
      <div class="tc-actions">
        <button class="abtn sm" data-action="select" data-id="${t.id}">Details</button>
        <button class="abtn sm" data-action="focus"  data-id="${t.id}">Focus</button>
        <button class="abtn sm" data-action="set-current" data-id="${t.id}">Set Current</button>
      </div>
    </div>`;
  },

  _bindCardActions(container) {
    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const { action, id } = btn.dataset;
        if (action === 'select')      { this._selectedTaskId = id; this._renderBacklog(); this._renderDetail(); }
        if (action === 'focus')       { await this._startFocus(id); }
        if (action === 'set-current') { await AppState.setMeta('currentTaskId', id); Shell.toast('Set as current task'); }
      };
    });
    container.querySelectorAll('.task-card').forEach(card => {
      card.ondblclick = () => {
        this._selectedTaskId = card.dataset.taskId;
        this._renderBacklog();
        this._renderDetail();
      };
    });
  },

  async _startFocus(taskId) {
    await AppState.setMeta('currentTaskId', taskId);
    await AppState.setMeta('focusActive', false);
    window.location.href = `focus.html?taskId=${encodeURIComponent(taskId)}`;
  },

  // ── Goals ────────────────────────────────────────────────────────────────
  _renderGoals() {
    const el = document.getElementById('goalsList');
    if (!el) return;
    const goals = AppState.get('goals');
    if (!goals.length) { el.innerHTML = '<div style="font-size:11px;color:var(--text-faint)">No goals yet.</div>'; return; }
    el.innerHTML = goals.map(g => `
      <div class="goal-item">
        <div class="goal-info">
          <div class="goal-title">${Utils.escapeHtml(g.title)}</div>
          ${g.description ? `<div class="goal-desc">${Utils.escapeHtml(g.description)}</div>` : ''}
        </div>
        <div class="goal-actions">
          <button class="abtn sm" data-action="breakdown" data-id="${g.id}">Break down</button>
          <button class="abtn sm danger" data-action="del-goal" data-id="${g.id}">×</button>
        </div>
      </div>`).join('');
    el.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = async () => {
        const { action, id } = btn.dataset;
        if (action === 'del-goal') {
          if (await Shell.confirm('Delete this goal?')) await AppState.remove('goals', id);
        }
        if (action === 'breakdown') await this._breakdownGoal(id);
      };
    });
  },

  async _breakdownGoal(goalId) {
    const goal = AppState.get('goals').find(g => g.id === goalId);
    if (!goal) return;
    const key = AppState.getSettings().geminiKey;
    if (!key) { Shell.toast('Add Gemini API key in Settings first'); return; }
    Shell.toast('Asking AI to break down goal…');
    try {
      const tasks = await AI.breakdownGoal(goal.title, goal.description);
      for (const t of tasks) {
        const taskId = Utils.uid('task');
        await AppState.add('tasks', {
          id: taskId, goalId: goal.id, title: t.title, type: t.type || 'deep',
          estimatedMinutes: t.estimatedMinutes || 30, remainingMinutes: t.estimatedMinutes || 30,
          progressPercent: 0, priority: t.priority || 3, effort: t.effort || 3,
          energyNeed: t.energyNeed || 3, deadline: null, nextStep: t.nextStep || '',
          notes: '', isPinned: false, isCompleted: false, createdAt: new Date().toISOString(), completedAt: null
        });
        for (let si = 0; si < (t.subtasks || []).length; si++) {
          const st = t.subtasks[si];
          await AppState.add('subtasks', {
            id: Utils.uid('sub'), taskId, title: st.title, steps: st.steps || [],
            currentStepIndex: 0, isCompleted: false, order: si, createdAt: new Date().toISOString()
          });
        }
      }
      Shell.toast(`Created ${tasks.length} tasks from goal`);
    } catch(err) {
      console.error(err);
      Shell.toast('AI breakdown failed — add tasks manually');
    }
  },

  // ── Slots ────────────────────────────────────────────────────────────────
  _renderSlots() {
    const el = document.getElementById('slotsList');
    if (!el) return;
    const slots = AppState.get('slots');
    if (!slots.length) { el.innerHTML = '<div style="font-size:11px;color:var(--text-faint)">No slots yet.</div>'; return; }
    el.innerHTML = slots.map(s => `
      <div class="slot-item">
        <div class="slot-info">${Utils.escapeHtml(s.label)} · ${Utils.formatTime(new Date(s.start))}–${Utils.formatTime(new Date(s.end))} · E${s.energyLevel} · ${s.recurring}</div>
        <button class="abtn sm danger" data-del-slot="${s.id}">×</button>
      </div>`).join('');
    el.querySelectorAll('[data-del-slot]').forEach(btn => {
      btn.onclick = async () => await AppState.remove('slots', btn.dataset.delSlot);
    });
  },

  // ── Schedule ─────────────────────────────────────────────────────────────
  _renderSchedule() {
    const el = document.getElementById('scheduleList');
    if (!el) return;
    const blocks = AppState.get('scheduleBlocks')
      .filter(b => { const d = new Date(b.start); const t = new Date(); return d.toDateString() === t.toDateString(); })
      .sort((a,b) => new Date(a.start) - new Date(b.start));
    if (!blocks.length) { el.innerHTML = '<div style="font-size:13px;color:var(--text-faint);padding:var(--sp3) 0">No schedule yet. Add slots then click Plan My Day.</div>'; return; }
    el.innerHTML = blocks.map(b => `
      <div class="sched-block">
        <div class="sched-time">${Utils.formatTime(new Date(b.start))} – ${Utils.formatTime(new Date(b.end))}</div>
        <div class="sched-title">${Utils.escapeHtml(b.title)}</div>
        <div class="sched-dur">${b.minutes}m</div>
        <span class="tag${b.isManual ? ' accent' : ''}">${b.isManual ? 'Manual' : 'Auto'}</span>
      </div>`).join('');
  },

  // ── Detail panel ──────────────────────────────────────────────────────────
  _renderDetail() {
    const empty   = document.getElementById('detailEmpty');
    const content = document.getElementById('detailContent');
    if (!this._selectedTaskId) {
      if (empty)   empty.style.display   = '';
      if (content) content.style.display = 'none';
      return;
    }
    const task = AppState.get('tasks').find(t => t.id === this._selectedTaskId);
    if (!task) { this._selectedTaskId = null; this._renderDetail(); return; }
    if (empty)   empty.style.display   = 'none';
    if (content) content.style.display = '';

    const subs = AppState.get('subtasks').filter(s => s.taskId === task.id);
    const hasSubs = subs.length > 0;

    content.innerHTML = `
      <form id="taskEditForm" data-id="${task.id}">
        <div class="form-row">
          <div class="form-group" style="flex:2">
            <label>Title</label>
            <input name="title" value="${Utils.escapeHtml(task.title)}" required>
          </div>
          <div class="form-group">
            <label>Type</label>
            <select name="type">${['deep','study','revision','admin','meeting','errand','creative','maintenance'].map(v=>`<option value="${v}"${task.type===v?' selected':''}>${v}</option>`).join('')}</select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Est. min</label><input type="number" name="estimatedMinutes" value="${task.estimatedMinutes||30}" min="5" max="480"></div>
          <div class="form-group"><label>Remaining</label><input type="number" name="remainingMinutes" value="${task.remainingMinutes||task.estimatedMinutes||30}" min="0" max="480"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Priority</label><input type="number" name="priority" value="${task.priority||3}" min="1" max="5"></div>
          <div class="form-group"><label>Effort</label><input type="number" name="effort" value="${task.effort||3}" min="1" max="5"></div>
          <div class="form-group"><label>Energy need</label><input type="number" name="energyNeed" value="${task.energyNeed||3}" min="1" max="5"></div>
        </div>
        <div class="form-group"><label>Deadline</label><input type="datetime-local" name="deadline" value="${task.deadline ? task.deadline.slice(0,16) : ''}" style="color-scheme:dark"></div>
        ${!hasSubs ? `<div class="form-group"><label>Next step</label><input name="nextStep" value="${Utils.escapeHtml(task.nextStep||'')}"></div>` : '<div style="font-size:11px;color:var(--text-faint);padding:var(--sp2) 0">Plan managed through subtasks.</div>'}
        <div class="form-group"><label>Notes</label><textarea name="notes" rows="2">${Utils.escapeHtml(task.notes||'')}</textarea></div>
        <div class="form-actions">
          <button class="abtn sm" type="submit">Save</button>
          <button class="abtn sm" type="button" data-action="pin" data-id="${task.id}">${task.isPinned ? 'Unpin' : 'Pin'}</button>
          <button class="abtn sm" type="button" data-action="complete" data-id="${task.id}">Complete</button>
          <button class="abtn sm danger" type="button" data-action="delete" data-id="${task.id}">Delete</button>
        </div>
      </form>

      <div style="margin-top:var(--sp6)">
        <div class="section-head">Subtasks</div>
        <div class="st-list" id="stList">${this._subtasksHTML(subs)}</div>
        <button class="add-st-btn" id="addSubtaskBtn">+ Add subtask</button>
      </div>`;

    this._bindDetailEvents(content, task);
    this._bindSubtaskEvents(content, task.id);
  },

  _subtasksHTML(subs) {
    if (!subs.length) return '<div style="font-size:11px;color:var(--text-faint)">No subtasks yet.</div>';
    return subs.map((s, si) => `
      <div class="st-item" data-sub-id="${s.id}">
        <div class="st-header">
          <input class="st-title-input" data-sub-title="${s.id}" value="${Utils.escapeHtml(s.title)}">
          <span class="st-progress">Step ${(s.currentStepIndex||0)+1}/${s.steps.length||1}</span>
          <button class="st-del" data-del-sub="${s.id}" aria-label="Delete subtask">×</button>
        </div>
        <div class="st-steps" id="steps-${s.id}">
          ${s.steps.map((step, i) => `
            <div class="step-row${i === s.currentStepIndex ? ' current-step' : ''}" data-step-idx="${i}" data-sub-id="${s.id}">
              <span class="step-num">${i+1}.</span>
              <input class="step-input" data-step-input="${s.id}-${i}" value="${Utils.escapeHtml(step)}">
              <button class="step-del" data-del-step="${s.id}" data-step-i="${i}" aria-label="Delete step">×</button>
            </div>`).join('')}
          <button class="st-add-step" data-add-step="${s.id}">+ Add step</button>
        </div>
      </div>`).join('');
  },

  _bindDetailEvents(content, task) {
    const form = content.querySelector('#taskEditForm');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        await AppState.update('tasks', task.id, {
          title:            fd.get('title'),
          type:             fd.get('type'),
          estimatedMinutes: parseInt(fd.get('estimatedMinutes')) || 30,
          remainingMinutes: parseInt(fd.get('remainingMinutes')) || 30,
          priority:         parseInt(fd.get('priority')) || 3,
          effort:           parseInt(fd.get('effort'))   || 3,
          energyNeed:       parseInt(fd.get('energyNeed')) || 3,
          deadline:         fd.get('deadline') ? new Date(fd.get('deadline')).toISOString() : null,
          nextStep:         fd.get('nextStep') || '',
          notes:            fd.get('notes')    || ''
        });
        Shell.toast('Task saved');
      };
    }
    content.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = async () => {
        const { action, id } = btn.dataset;
        if (action === 'pin')      { await AppState.update('tasks', id, { isPinned: !task.isPinned }); this._renderDetail(); }
        if (action === 'complete') { await AppState.update('tasks', id, { isCompleted: true, progressPercent: 100, completedAt: new Date().toISOString() }); this._selectedTaskId = null; this._render(); }
        if (action === 'delete')   { if (await Shell.confirm('Delete this task?')) { await AppState.remove('tasks', id); this._selectedTaskId = null; this._render(); } }
      };
    });
  },

  _bindSubtaskEvents(content, taskId) {
    const addBtn = content.querySelector('#addSubtaskBtn');
    if (addBtn) addBtn.onclick = async () => {
      const subs = AppState.get('subtasks').filter(s => s.taskId === taskId);
      const task = AppState.get('tasks').find(t => t.id === taskId);
      const newSub = {
        id: Utils.uid('sub'), taskId, title: 'New subtask', steps: ['First step'],
        currentStepIndex: 0, isCompleted: false, order: subs.length, createdAt: new Date().toISOString()
      };
      if (task && task.nextStep && !subs.length) {
        newSub.steps = [task.nextStep];
        await AppState.update('tasks', taskId, { nextStep: '' });
      }
      await AppState.add('subtasks', newSub);
      this._renderDetail();
    };

    content.querySelectorAll('[data-del-sub]').forEach(btn => {
      btn.onclick = async () => {
        if (await Shell.confirm('Delete subtask and all its steps?')) {
          await AppState.remove('subtasks', btn.dataset.delSub);
          this._renderDetail();
        }
      };
    });

    content.querySelectorAll('[data-sub-title]').forEach(inp => {
      inp.onblur = async () => {
        await AppState.update('subtasks', inp.dataset.subTitle, { title: inp.value });
      };
    });

    content.querySelectorAll('[data-step-input]').forEach(inp => {
      const [subId, idxStr] = inp.dataset.stepInput.split('-');
      inp.onblur = async () => {
        const sub = AppState.get('subtasks').find(s => s.id === subId);
        if (!sub) return;
        const steps = [...sub.steps];
        steps[parseInt(idxStr)] = inp.value;
        await AppState.update('subtasks', subId, { steps });
      };
    });

    content.querySelectorAll('[data-add-step]').forEach(btn => {
      btn.onclick = async () => {
        const sub = AppState.get('subtasks').find(s => s.id === btn.dataset.addStep);
        if (!sub) return;
        await AppState.update('subtasks', sub.id, { steps: [...sub.steps, 'New step'] });
        this._renderDetail();
      };
    });

    content.querySelectorAll('[data-del-step]').forEach(btn => {
      btn.onclick = async () => {
        const sub = AppState.get('subtasks').find(s => s.id === btn.dataset.delStep);
        if (!sub) return;
        const steps = sub.steps.filter((_, i) => i !== parseInt(btn.dataset.stepI));
        await AppState.update('subtasks', sub.id, { steps, currentStepIndex: Math.max(0, sub.currentStepIndex - (parseInt(btn.dataset.stepI) <= sub.currentStepIndex ? 1 : 0)) });
        this._renderDetail();
      };
    });
  },

  // ── Forms ────────────────────────────────────────────────────────────────
  _bindForms() {
    const qf = document.getElementById('quickForm');
    if (qf) qf.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(qf);
      const title = fd.get('title').trim();
      if (!title) return;
      await AppState.add('tasks', {
        id: Utils.uid('task'), title, type: 'focus',
        estimatedMinutes: 30, remainingMinutes: 30, progressPercent: 0,
        priority: 3, effort: 3, energyNeed: 3, deadline: null, nextStep: '',
        notes: '', isPinned: false, isCompleted: false, goalId: null,
        createdAt: new Date().toISOString(), completedAt: null
      });
      qf.reset();
    };

    const gf = document.getElementById('goalForm');
    if (gf) gf.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(gf);
      await AppState.add('goals', { id: Utils.uid('goal'), title: fd.get('title'), description: fd.get('description') || '', createdAt: new Date().toISOString() });
      gf.reset();
    };

    const sf = document.getElementById('slotForm');
    if (sf) sf.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(sf);
      const start = new Date(fd.get('start'));
      const end   = new Date(fd.get('end'));
      if (end <= start) { Shell.toast('End must be after start'); return; }
      await AppState.add('slots', {
        id: Utils.uid('slot'), label: fd.get('label'),
        start: start.toISOString(), end: end.toISOString(),
        energyLevel: parseInt(fd.get('energyLevel')) || 3,
        recurring: fd.get('recurring') || 'none', daysOfWeek: [1,2,3,4,5]
      });
      sf.reset();
    };

    const planBtn = document.getElementById('planDayBtn');
    if (planBtn) planBtn.onclick = async () => {
      Shell.toast('Building schedule…');
      const schedule = await Scheduler.buildSchedule();
      await DB.clear('scheduleBlocks');
      for (const b of schedule) await DB.put('scheduleBlocks', b);
      AppState.get('scheduleBlocks').length = 0;
      schedule.forEach(b => AppState.get('scheduleBlocks').push(b));
      AppState._emit('scheduleBlocks');
      Shell.toast(`Schedule ready — ${schedule.length} blocks`);
    };

    const sendBtn = document.getElementById('sendScheduleBtn');
    if (sendBtn) sendBtn.onclick = async () => {
      const blocks = AppState.get('scheduleBlocks');
      try {
        await Gmail.sendSchedule(blocks);
        Shell.toast('Schedule emailed!');
      } catch(e) {
        Shell.toast('Gmail send failed: ' + e.message);
      }
    };
  }
};
