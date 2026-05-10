'use strict';
const Utils = {
  uid(prefix = 'id') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  },

  formatTime(date) {
    return new Intl.DateTimeFormat(undefined, { hour:'2-digit', minute:'2-digit', hour12: false }).format(date);
  },

  formatDate(date) {
    return new Intl.DateTimeFormat(undefined, {
      weekday:'long', day:'numeric', month:'long', year:'numeric'
    }).format(date);
  },

  formatShortDate(date) {
    return new Intl.DateTimeFormat(undefined, { month:'short', day:'numeric' }).format(date);
  },

  formatDuration(mins) {
    if (!mins) return '0 min';
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60), m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  },

  formatCountdown(secs) {
    const s = Math.max(0, secs);
    const m = Math.floor(s / 60), ss = s % 60;
    return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  },

  todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },

  hoursUntil(iso) {
    if (!iso) return 9999;
    return (new Date(iso) - Date.now()) / 3600000;
  },

  hexToRgb(hex) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? [parseInt(r[1],16), parseInt(r[2],16), parseInt(r[3],16)] : [255,255,255];
  },

  deepMerge(target, source) {
    const out = Object.assign({}, target);
    for (const k in source) {
      if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k]))
        out[k] = Utils.deepMerge(target[k] || {}, source[k]);
      else
        out[k] = source[k];
    }
    return out;
  }
};
