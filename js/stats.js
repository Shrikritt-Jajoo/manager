'use strict';
(async () => {
  await AppState.init();
  Starfield.init();
  Shell.bindNavButtons();
  Stats.init();
})();

const Stats = {
  init() {
    this._render();
  },

  _render() {
    this._renderToday();
    this._renderStreak();
    this._renderWeekChart();
    this._renderRateChart();
  },

  _renderToday() {
    const today   = Utils.todayKey();
    const sessions = AppState.get('focusSessions').filter(s => s.startedAt.startsWith(today));
    const focusMins = sessions.reduce((a, s) => a + (s.actualMinutes || 0), 0);
    const completed = AppState.get('tasks').filter(t => t.isCompleted && t.completedAt && t.completedAt.startsWith(today)).length;

    const el1 = document.getElementById('statFocusMin');
    const el2 = document.getElementById('statSessions');
    const el3 = document.getElementById('statCompleted');
    if (el1) el1.textContent = focusMins;
    if (el2) el2.textContent = sessions.length;
    if (el3) el3.textContent = completed;
  },

  _renderStreak() {
    const streak = AppState.getMeta('streakData') || { count: 0, dailyLog: {} };
    const el = document.getElementById('statStreak');
    if (el) el.textContent = streak.count || 0;

    const dotsEl = document.getElementById('streakDots');
    if (!dotsEl) return;

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'));
    }

    dotsEl.innerHTML = days.map(d => {
      const val   = streak.dailyLog ? (streak.dailyLog[d] || 0) : 0;
      const filled = val >= 60;
      const dayName = new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' });
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px">
        <div class="s-dot${filled ? ' filled' : ''}" title="${d}: ${val} progress"></div>
        <div style="font-size:9px;color:var(--text-faint);letter-spacing:.08em">${dayName}</div>
      </div>`;
    }).join('');
  },

  _renderWeekChart() {
    const canvas = document.getElementById('weekChart');
    if (!canvas) return;
    const ctx  = canvas.getContext('2d');
    const W    = canvas.offsetWidth || 700;
    const H    = canvas.offsetHeight || 180;
    canvas.width  = W;
    canvas.height = H;

    const days = [], labels = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      days.push(key);
      labels.push(d.toLocaleDateString(undefined, { weekday: 'short' }));
    }

    const sessions = AppState.get('focusSessions');
    const values = days.map(d => sessions.filter(s => s.startedAt.startsWith(d)).reduce((a,s) => a + (s.actualMinutes||0), 0));
    const maxVal = Math.max(...values, 1);

    ctx.clearRect(0, 0, W, H);

    const padL = 10, padR = 10, padT = 16, padB = 28;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const barW   = Math.floor(chartW / 7 * 0.55);
    const gap    = chartW / 7;

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#BFAE99';

    // grid lines
    for (let g = 0; g <= 4; g++) {
      const y = padT + chartH - (g / 4) * chartH;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(245,247,251,.06)';
      ctx.lineWidth = 1;
      ctx.moveTo(padL, y); ctx.lineTo(W - padR, y);
      ctx.stroke();
    }

    values.forEach((v, i) => {
      const x    = padL + gap * i + gap / 2 - barW / 2;
      const barH = Math.max(2, (v / maxVal) * chartH);
      const y    = padT + chartH - barH;

      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(x, y, barW, barH);
      ctx.globalAlpha = 1;

      // label
      ctx.fillStyle = 'rgba(245,247,251,.45)';
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], padL + gap * i + gap / 2, H - 8);

      if (v > 0) {
        ctx.fillStyle = accent;
        ctx.font = '9px Inter, system-ui, sans-serif';
        ctx.fillText(v + 'm', padL + gap * i + gap / 2, y - 4);
      }
    });
  },

  _renderRateChart() {
    const canvas = document.getElementById('rateChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const all  = AppState.get('tasks');
    const done = all.filter(t => t.isCompleted).length;
    const total= all.length;
    const rate = total ? Math.round(done / total * 100) : 0;

    const el = document.getElementById('statRate');
    if (el) el.textContent = `${rate}%`;

    const W = 120, H = 120;
    ctx.clearRect(0, 0, W, H);
    const cx = W/2, cy = H/2, r = 48, lw = 7;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#BFAE99';

    // track
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(245,247,251,.09)';
    ctx.lineWidth = lw;
    ctx.stroke();

    if (rate > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (rate / 100) * Math.PI * 2);
      ctx.strokeStyle = accent;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }
};
