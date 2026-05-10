'use strict';
const Scheduler = {
  MIN_CHUNK: 15,
  MAX_CHUNK: 90,
  BUFFER:    10,

  computeScore(task) {
    let s = 0;
    const h = Utils.hoursUntil(task.deadline);
    if (h <= 0)        s += 100;
    else if (h < 6)    s += 50;
    else if (h < 12)   s += 35;
    else if (h < 24)   s += 25;
    else if (h < 72)   s += 15;
    else               s += 5;
    if (task.isPinned) s += 40;
    s += (task.priority - 3) * 8;
    s += (task.effort   - 3) * 4;
    const rem = task.remainingMinutes || task.estimatedMinutes || 30;
    if (h > 0 && h < 9999) {
      const ratio = rem / (h * 60);
      if (ratio > .8) s += 30;
      else if (ratio > .5) s += 15;
    }
    const p = task.progressPercent || 0;
    if (p > 0 && p < 100) s += 12;
    return s;
  },

  slotFit(task, slot) {
    let s = 0;
    const te = task.energyNeed || 3, se = slot.energyLevel || 3;
    s += Math.max(0, 15 - Math.abs(se - te) * 5);
    if (['deep','study'].includes(task.type)) {
      if (se >= 4) s += 10;
      if (se <= 2) s -= 10;
    }
    if (['admin','errand'].includes(task.type) && se <= 3) s += 5;
    return s;
  },

  _expandSlotToToday(slot) {
    const today = new Date();
    const s = new Date(slot.start), e = new Date(slot.end);
    if (slot.recurring === 'none') return slot;
    const dow = today.getDay();
    if (slot.recurring === 'weekdays' && (dow === 0 || dow === 6)) return null;
    const ns = new Date(today.getFullYear(), today.getMonth(), today.getDate(), s.getHours(), s.getMinutes());
    const ne = new Date(today.getFullYear(), today.getMonth(), today.getDate(), e.getHours(), e.getMinutes());
    return { ...slot, start: ns.toISOString(), end: ne.toISOString() };
  },

  async buildSchedule() {
    const tasks  = AppState.get('tasks').filter(t => !t.isCompleted);
    const allSlots = AppState.get('slots');
    const manuals  = AppState.get('scheduleBlocks').filter(b => b.isManual);

    const slots = allSlots
      .map(sl => this._expandSlotToToday(sl))
      .filter(Boolean)
      .sort((a,b) => new Date(a.start) - new Date(b.start));

    const scored = tasks
      .map(t => ({ task: t, score: this.computeScore(t) }))
      .sort((a,b) => b.score - a.score);

    const remaining = new Map(tasks.map(t => [t.id, t.remainingMinutes || t.estimatedMinutes || 30]));
    const schedule  = [...manuals.map(b => ({ ...b, preserved: true }))];

    for (const mb of manuals) {
      const r = remaining.get(mb.taskId);
      if (r !== undefined) remaining.set(mb.taskId, Math.max(0, r - mb.minutes));
    }

    for (const slot of slots) {
      let cursor   = new Date(slot.start).getTime();
      const slotEnd = new Date(slot.end).getTime();

      while (cursor < slotEnd) {
        const avail = Math.floor((slotEnd - cursor) / 60000);
        if (avail < this.MIN_CHUNK) break;

        const candidates = scored
          .filter(({ task }) => (remaining.get(task.id) || 0) > 0)
          .map(({ task, score }) => ({ task, score: score + this.slotFit(task, slot) }))
          .sort((a,b) => b.score - a.score);

        if (!candidates.length) break;

        const { task } = candidates[0];
        const rem   = remaining.get(task.id);
        const chunk = Math.min(rem, avail, this.MAX_CHUNK);
        if (chunk < this.MIN_CHUNK) break;

        const blockStart = new Date(cursor);
        const blockEnd   = new Date(cursor + chunk * 60000);

        schedule.push({
          id:       Utils.uid('block'),
          taskId:   task.id,
          slotId:   slot.id,
          title:    task.title,
          start:    blockStart.toISOString(),
          end:      blockEnd.toISOString(),
          minutes:  chunk,
          isManual: false,
          bufferAfter: this.BUFFER,
          preserved: false
        });

        remaining.set(task.id, rem - chunk);
        cursor += (chunk + this.BUFFER) * 60000;
      }
    }

    return schedule.sort((a,b) => new Date(a.start) - new Date(b.start));
  },

  async rescheduleUnfinished() {
    const tasks = AppState.get('tasks');
    for (const t of tasks) {
      if (!t.isCompleted) {
        const p   = t.progressPercent || 0;
        const rem = Math.ceil((t.estimatedMinutes || 30) * (1 - p / 100));
        await AppState.update('tasks', t.id, { remainingMinutes: Math.max(rem, 5) });
      }
    }
    const schedule = await this.buildSchedule();
    await DB.clear('scheduleBlocks');
    for (const b of schedule) await DB.put('scheduleBlocks', b);
    AppState.get('scheduleBlocks').length = 0;
    schedule.forEach(b => AppState.get('scheduleBlocks').push(b));
    return schedule;
  }
};
