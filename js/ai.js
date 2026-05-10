'use strict';
const AI = {
  MODEL:    'gemini-2.5-flash-lite-preview-06-17',
  ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/',

  _key() { return AppState.getSettings().geminiKey || ''; },

  async breakdownGoal(title, description) {
    const key = this._key();
    if (!key) throw new Error('No Gemini API key configured');

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

    const url = `${this.ENDPOINT}${this.MODEL}:generateContent?key=${encodeURIComponent(key)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error('Gemini error:', err);
      throw new Error(`Gemini API error ${resp.status}`);
    }

    const data = await resp.json();
    const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error('Empty Gemini response');
    return JSON.parse(raw).tasks;
  },

  async ping() {
    const key = this._key();
    if (!key) throw new Error('No key');
    const url = `${this.ENDPOINT}${this.MODEL}:generateContent?key=${encodeURIComponent(key)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role:'user', parts:[{ text:'Say "ok"' }] }] })
    });
    if (!resp.ok) throw new Error(`${resp.status}`);
    return true;
  }
};
