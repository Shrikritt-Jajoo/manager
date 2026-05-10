'use strict';
// =========================================================
// manager ai.js  v2  (Phase C)
// Extends v1: breakdownGoal + ping preserved verbatim.
// New in v2:
//   AI.runJob(jobId)     — full registered-job pipeline
//   AI.gatherInputs(job) — collect store snapshots
//   AI.applyOutputs(job, items, accept) — write approved items
//   AI.isOnline()        — offline guard (checks ChronoFlow.serverMode
//                           OR navigator.onLine for direct API calls)
//   AI._callGemini(key, body) — shared fetch helper
//   AI._getKey()         — reads aiConfig store then settings fallback
// All methods are safe to call without a Gemini key — they
// throw a friendly Error('No Gemini API key configured') that
// Shell.toast() can display directly.
// =========================================================

const AI = {
  MODEL:    'gemini-2.5-flash-lite-preview-06-17',
  ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/',

  // ---- Key resolution ---------------------------------------------------
  // Prefers aiConfig store (set in Settings AI panel) then falls back to
  // legacy settings.geminiKey so old configs keep working.
  _getKey() {
    const cfg = AppState.getConfig('aiConfig');
    if (cfg && cfg.geminiKey) return cfg.geminiKey;
    return AppState.getSettings().geminiKey || '';
  },

  // Legacy alias used by planner.js breakdownGoal path
  _key() { return this._getKey(); },

  // ---- Offline guard ----------------------------------------------------
  // For direct Gemini API calls we only need the device to be online
  // (navigator.onLine). Server mode is irrelevant here — the API call
  // goes to googleapis.com, not our server.
  isOnline() {
    return navigator.onLine !== false;
  },

  // ---- Shared Gemini fetch ----------------------------------------------
  async _callGemini(key, body) {
    if (!this.isOnline()) throw new Error('No internet connection — AI unavailable offline');
    const url = `${this.ENDPOINT}${this.MODEL}:generateContent?key=${encodeURIComponent(key)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error('[AI] Gemini error:', err);
      throw new Error(`Gemini API error ${resp.status}`);
    }
    return resp.json();
  },

  // ---- gatherInputs -----------------------------------------------------
  // Builds a plain-object snapshot of every store listed in job.inputSources.
  // Returns { tasks, slots, goals, scheduleBlocks, focusSessions,
  //           subtasks, settings, today }
  gatherInputs(job) {
    const sources = job.inputSources || [];
    const out = { today: Utils.formatDate(new Date()) };
    const arrayStores = ['tasks','subtasks','slots','scheduleBlocks',
                         'focusSessions','goals','registeredAiJobs'];
    for (const src of sources) {
      if (arrayStores.includes(src)) {
        out[src] = AppState.get(src);
      } else if (src === 'settings') {
        out.settings = AppState.getSettings();
      }
    }
    return out;
  },

  // ---- fillTemplate ----------------------------------------------------
  // Replaces {key} tokens in job.userMessageTemplate with JSON-serialised
  // values from the gathered inputs object.
  _fillTemplate(template, inputs) {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      const val = inputs[key];
      if (val === undefined) return '';
      if (typeof val === 'string') return val;
      return JSON.stringify(val, null, 0);
    });
  },

  // ---- runJob -----------------------------------------------------------
  // Full pipeline for a registered AI job.
  // Returns the raw parsed output from Gemini (shape depends on
  // job.outputSchema.type).
  // Callers (planner sidebar, home.js, stats.js) handle the
  // accept/reject UI and then call applyOutputs().
  async runJob(jobId) {
    const key = this._getKey();
    if (!key) throw new Error('No Gemini API key configured');
    if (!this.isOnline()) throw new Error('No internet connection — AI unavailable offline');

    const job = AppState.get('registeredAiJobs').find(j => j.id === jobId);
    if (!job) throw new Error(`Unknown AI job: ${jobId}`);

    const inputs  = this.gatherInputs(job);
    const userMsg = this._fillTemplate(job.userMessageTemplate, inputs);

    // Build a JSON schema for the response based on outputSchema.type
    const schema = this._schemaForJob(job);

    const body = {
      systemInstruction: { parts: [{ text: job.systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMsg }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.35,
        maxOutputTokens: 4096
      }
    };

    const data = await this._callGemini(key, body);
    const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error('Empty Gemini response');

    return JSON.parse(raw);
  },

  // ---- _schemaForJob ---------------------------------------------------
  // Returns a Gemini responseSchema object appropriate for the job type.
  _schemaForJob(job) {
    const type = job.outputSchema && job.outputSchema.type;

    if (type === 'data') {
      // Generic array of patch objects keyed by store
      return {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action:  { type: 'string', enum: ['create','update','delete'] },
                id:      { type: 'string' },
                payload: { type: 'object' }
              },
              required: ['action','payload']
            }
          },
          summary: { type: 'string' }
        },
        required: ['items','summary']
      };
    }

    if (type === 'email') {
      return {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          body:    { type: 'string' }
        },
        required: ['subject','body']
      };
    }

    if (type === 'weekly-review') {
      return {
        type: 'object',
        properties: {
          markdown: { type: 'string' }
        },
        required: ['markdown']
      };
    }

    // Fallback: free-form object
    return { type: 'object' };
  },

  // ---- applyOutputs ----------------------------------------------------
  // Writes accepted items from a 'data' job result back into AppState.
  // acceptedIndices: Set<number> of indices the user approved.
  // If job.acceptRejectPerItem is false, pass null to apply all.
  async applyOutputs(job, result, acceptedIndices) {
    if (!result || !result.items) return 0;
    const store  = job.outputSchema && job.outputSchema.store;
    if (!store) return 0;

    let applied = 0;
    result.items.forEach((item, i) => {
      if (acceptedIndices !== null && !acceptedIndices.has(i)) return;
      const { action, id, payload } = item;
      if (action === 'create') {
        const newItem = Object.assign({ id: Utils.uid(store.slice(0,-1)) }, payload,
          { createdAt: new Date().toISOString() });
        AppState.add(store, newItem);
        applied++;
      } else if (action === 'update' && id) {
        AppState.update(store, id, payload);
        applied++;
      } else if (action === 'delete' && id) {
        AppState.remove(store, id);
        applied++;
      }
    });
    return applied;
  },

  // ---- breakdownGoal ---------------------------------------------------
  // Preserved verbatim from v1 — planner.js calls this directly.
  async breakdownGoal(title, description) {
    const key = this._getKey();
    if (!key) throw new Error('No Gemini API key configured');
    if (!this.isOnline()) throw new Error('No internet connection — AI unavailable offline');

    const existingTasks = AppState.get('tasks').map(t => t.title).join(', ') || 'none';
    const todayStr = Utils.formatDate(new Date());

    const systemInstruction = `You are a senior academic coach and productivity strategist with deep expertise in helping students and knowledge workers achieve complex goals. You specialise in decomposing ambitious goals into concrete, executable work units that can be scheduled across days and weeks.

Your task is to analyse a goal and produce a precise, realistic breakdown of the work required to achieve it. You must think like both a subject matter expert (knowing what the real sub-problems are) and a project manager (knowing how work is actually sequenced and estimated).

THINKING PROTOCOL — follow these steps internally before producing output:
1. Identify the core deliverable of the goal and what "done" looks like
2. List every distinct category of work required (do not merge unrelated work)
3. For each category, identify the smallest independently completable unit of work
4. Estimate time honestly — do not optimistically underestimate
5. Assign type, priority, and energy need based on the actual cognitive demand
6. For each task, identify the single most important first action — not a vague intention but a concrete physical action a person can start in under 60 seconds

CONSTRAINTS:
- Produce between 3 and 8 tasks — no more, no fewer
- Each task must be independently schedulable (has a clear start and end)
- Steps must be specific enough that someone with no context can execute them without asking a clarifying question
- Do not produce motivational language, encouragement, or meta-commentary
- Do not produce tasks that are really sub-points of each other — each task must represent genuinely distinct work
- Time estimates must be realistic for a focused, uninterrupted work session, not optimistic best-case durations`;

    const userMessage = `GOAL TITLE: ${title}

GOAL DESCRIPTION: ${description || 'No additional description provided.'}

CURRENT CONTEXT:
- Today's date: ${todayStr}
- Existing tasks in backlog: ${existingTasks}
- Available task types: deep, study, revision, admin, creative, maintenance, errand, meeting

EXAMPLE OF GOOD OUTPUT (for a different goal — use this format only, not this content):

Goal: "Complete IB Extended Essay on solenoid inductance"
Output tasks:
  Task 1: "Draft research question and define scope"
    type: deep, estimatedMinutes: 60, priority: 5, effort: 4, energyNeed: 4
    nextStep: "Write a one-paragraph statement of the research question and list 3 variables you will control"
    subtasks: [
      { title: "Define scope", steps: [
          "Write one paragraph stating the research question precisely",
          "List the independent, dependent, and controlled variables",
          "Confirm scope fits 4000-word limit by counting anticipated sections"
      ]},
      { title: "Survey existing literature", steps: [
          "Search Google Scholar for 5 papers on solenoid inductance measurement",
          "Annotate each paper: key finding, methodology, relevance to your question",
          "Build a reference list in the correct IB citation format"
      ]}
    ]

Now produce the breakdown for the goal provided above. Think step by step before producing output. Your entire response must be valid JSON matching the schema exactly.`;

    const schema = {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          minItems: 3,
          maxItems: 8,
          items: {
            type: 'object',
            required: ['title','type','estimatedMinutes','priority','effort','energyNeed','nextStep','subtasks'],
            properties: {
              title:            { type: 'string' },
              type:             { type: 'string', enum: ['deep','study','revision','admin','meeting','errand','creative','maintenance'] },
              estimatedMinutes: { type: 'integer', minimum: 15, maximum: 480 },
              priority:         { type: 'integer', minimum: 1, maximum: 5 },
              effort:           { type: 'integer', minimum: 1, maximum: 5 },
              energyNeed:       { type: 'integer', minimum: 1, maximum: 5 },
              nextStep:         { type: 'string' },
              subtasks: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['title','steps'],
                  properties: {
                    title: { type: 'string' },
                    steps: { type: 'array', minItems: 1, items: { type: 'string' } }
                  }
                }
              }
            }
          }
        }
      },
      required: ['tasks']
    };

    const body = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.4,
        maxOutputTokens: 4096
      }
    };

    const data = await this._callGemini(key, body);
    const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error('Empty Gemini response');
    return JSON.parse(raw).tasks;
  },

  // ---- ping ------------------------------------------------------------
  // Preserved verbatim from v1.
  async ping() {
    const key = this._getKey();
    if (!key) throw new Error('No key');
    const data = await this._callGemini(key, {
      contents: [{ role:'user', parts:[{ text:'Say "ok"' }] }]
    });
    if (!data) throw new Error('No response');
    return true;
  }
};
