'use strict';
const Gmail = {
  CLIENT_ID: '',   // set from settings or hard-code your OAuth client ID here
  SCOPE:     'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email',
  _token:    null,

  async connect() {
    return new Promise((resolve, reject) => {
      if (!window.google || !window.google.accounts) {
        reject(new Error('Google Identity Services not loaded. Run via http://localhost.'));
        return;
      }
      const clientId = AppState.getSettings().gmailClientId || this.CLIENT_ID;
      if (!clientId) { reject(new Error('No Gmail OAuth Client ID configured')); return; }

      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: this.SCOPE,
        callback: async (resp) => {
          if (resp.error) { reject(new Error(resp.error)); return; }
          this._token = resp;
          await AppState.setMeta('gmailToken', resp);
          try {
            const info = await this._getUserInfo();
            await AppState.saveSettings({ gmailConnected: true, gmailAddress: info.email });
          } catch(e) {}
          resolve(resp);
        }
      });
      client.requestAccessToken();
    });
  },

  async _getUserInfo() {
    const t = this._token || await this._loadToken();
    const r = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
      headers: { Authorization: `Bearer ${t.access_token}` }
    });
    return r.json();
  },

  async _loadToken() {
    if (!this._token) this._token = AppState.getMeta('gmailToken');
    return this._token;
  },

  _buildEmailBody(blocks) {
    const today = Utils.formatDate(new Date());
    let lines = [`Subject: ChronoFlow · Your Schedule for ${today}`,
      'From: me', 'To: me', 'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8', '', `Good morning,`,
      ``, `Here is your planned schedule for today:`,
      ``, `──────────────────────────────`];

    const tasks = AppState.get('tasks');
    const subtasks = AppState.get('subtasks');

    let totalMins = 0;
    for (const b of blocks) {
      const task = tasks.find(t => t.id === b.taskId);
      if (!b.taskId || !task) continue;
      const start = Utils.formatTime(new Date(b.start));
      const end   = Utils.formatTime(new Date(b.end));
      lines.push(`${start} – ${end}  ${b.title}  [${b.minutes} min]`);
      const activeSub = subtasks.find(s => s.taskId === b.taskId && !s.isCompleted);
      if (activeSub) {
        const step = activeSub.steps[activeSub.currentStepIndex] || activeSub.steps[0];
        lines.push(`               Subtask: ${activeSub.title}`);
        if (step) lines.push(`               Next step: ${step}`);
      } else if (task.nextStep) {
        lines.push(`               Next step: ${task.nextStep}`);
      }
      lines.push('');
      totalMins += b.minutes;
    }

    lines.push(`──────────────────────────────`);
    lines.push(`Total planned focus: ${Utils.formatDuration(totalMins)}`);
    const backlog = AppState.get('tasks').filter(t => !t.isCompleted).length;
    lines.push(`Tasks in backlog: ${backlog}`);
    const pinned = AppState.get('tasks').filter(t => t.isPinned && !t.isCompleted).map(t=>t.title).join(', ');
    if (pinned) lines.push(`Pinned: ${pinned}`);
    lines.push('', 'Have a focused day.', '— ChronoFlow');

    return lines.join('\r\n');
  },

  async sendSchedule(blocks) {
    const t = await this._loadToken();
    if (!t) throw new Error('Not connected to Gmail');
    const raw     = this._buildEmailBody(blocks);
    const encoded = btoa(unescape(encodeURIComponent(raw)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${t.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw: encoded })
    });
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error?.message || 'Gmail send failed');
    }
    return true;
  }
};
