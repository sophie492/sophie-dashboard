# Multi-Hack-Week Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Hack Week hub from a single flat data object to a year-keyed multi-event collection with a selector, auto-selection of the Planning hack week, and per-event isolation of teams/scores/schedule/checklist.

**Architecture:** The data file changes from `{ config, teams, schedule, ... }` to `{ hackweeks: { "2025": [...], "2026": [...], ... } }`. Server endpoints gain `:id` routing. The dashboard auto-selects the hack week with `status: "Planning"` and adds a dropdown to switch between events. The inline `DATA.hackWeek` stays as a fallback for the planning checklist but `renderHackWeek()` pulls all data from the API response keyed by the selected hack week id.

**Tech Stack:** Express, Google Sheets API, existing single-file dashboard pattern.

---

### Task 1: Migrate hackweek-data.json to multi-event structure

**Files:**
- Modify: `data/hackweek-data.json`

This is a data migration. We restructure the flat object into `{ hackweeks: { year: [...] } }` with stubs for past/future hack weeks and the full #3 data as the Planning entry.

- [ ] **Step 1: Write a migration script and run it**

Create and run a one-time Node script. Do NOT hand-edit the JSON — it's too large and error-prone.

```bash
cd ~/sophie-dashboard && node -e "
const fs = require('fs');
const old = JSON.parse(fs.readFileSync('data/hackweek-data.json', 'utf8'));

// Build the new structure
const newData = {
  hackweeks: {
    '2025': [
      {
        id: 'hw-2025-jun',
        number: 1,
        name: 'Hack Week #1 — Hack me if you can',
        half: 'H2',
        targetDate: '2025-06-09',
        status: 'Complete',
        notionHub: old.config.previousHackWeeks.june2025Notion || '',
        slackChannel: '#hack-week-jun-2025',
        lessonsLearned: old.lessonsLearned.find(l => l.hackWeek.includes('June 2025'))?.lessons || [],
        teams: [], scores: [], schedule: {},
        checklist: { phases: [] },
        rubric: [], resourceLinks: [], prizeCategories: [],
        teamFormationRules: [], logistics: {}, reviews: []
      }
    ],
    '2026': [
      {
        id: 'hw-2026-jan',
        number: 2,
        name: 'Hack Week #2',
        half: 'H1',
        targetDate: '2026-01-26',
        status: 'Complete',
        notionHub: old.config.previousHackWeeks.jan2026Notion || '',
        signupSheet: old.config.previousHackWeeks.jan2026Signup || '',
        slackChannel: '#hack-week-jan-2026',
        lessonsLearned: old.lessonsLearned.find(l => l.hackWeek.includes('January 2026'))?.lessons || [],
        teams: [], scores: [], schedule: {},
        checklist: { phases: [] },
        rubric: [], resourceLinks: [], prizeCategories: [],
        teamFormationRules: [], logistics: {}, reviews: []
      },
      {
        id: 'hw-2026-jun',
        number: 3,
        name: old.config.name || 'Hack Week #3',
        half: 'H2',
        targetDate: old.config.targetDate || '2026-06-08',
        status: 'Planning',
        notionHub: old.config.notionHub || '',
        slackChannel: old.config.slackChannel || '#hack-week-jun-2026',
        signupSheet: 'https://docs.google.com/spreadsheets/d/1qf2DWzf9852ARQFBnMxv1T5b5r_Zj73_VJyniG5HAv0/edit',
        sheetTabMatch: 'jun 2026',
        teams: old.teams || [],
        scores: old.scores || [],
        schedule: old.schedule || {},
        checklist: old.checklist || { phases: [] },
        rubric: old.rubric || [],
        resourceLinks: old.resourceLinks || [],
        prizeCategories: old.prizeCategories || [],
        teamFormationRules: old.teamFormationRules || [],
        logistics: old.logistics || {},
        reviews: old.reviews || [],
        lessonsLearned: []
      }
    ],
    '2027': [
      {
        id: 'hw-2027-jan',
        number: 4,
        name: 'Hack Week #4',
        half: 'H1',
        targetDate: '2027-01-11',
        status: 'Future',
        planningStart: 'Late October 2026',
        notionHub: '', slackChannel: '',
        teams: [], scores: [], schedule: {},
        checklist: { phases: [] },
        rubric: [], resourceLinks: [], prizeCategories: [],
        teamFormationRules: [], logistics: {}, reviews: [],
        lessonsLearned: []
      }
    ]
  },
  schedulingTips: old.schedulingTips || [],
  lastSynced: old.lastSynced || new Date().toISOString(),
  lastSheetSync: old.lastSheetSync || null
};

fs.writeFileSync('data/hackweek-data.json', JSON.stringify(newData, null, 2));
console.log('Migration complete');
console.log('Years:', Object.keys(newData.hackweeks));
console.log('2025:', newData.hackweeks['2025'].length, 'entries');
console.log('2026:', newData.hackweeks['2026'].length, 'entries');
console.log('2027:', newData.hackweeks['2027'].length, 'entries');
console.log('Planning:', newData.hackweeks['2026'][1].name, '-', newData.hackweeks['2026'][1].status);
"
```

Expected output:
```
Migration complete
Years: [ '2025', '2026', '2027' ]
2025: 1 entries
2026: 2 entries
2027: 1 entries
Planning: Hack Week #3 - Planning
```

- [ ] **Step 2: Verify the migrated JSON**

```bash
cd ~/sophie-dashboard && node -e "
const d = JSON.parse(require('fs').readFileSync('data/hackweek-data.json','utf8'));
console.log('Valid JSON');
console.log('Has hackweeks:', !!d.hackweeks);
console.log('No old config:', !d.config);
console.log('No old teams:', !d.teams);
const hw3 = d.hackweeks['2026'][1];
console.log('HW3 id:', hw3.id);
console.log('HW3 status:', hw3.status);
console.log('HW3 has schedule:', !!hw3.schedule.day1);
console.log('HW3 has rubric:', hw3.rubric.length);
console.log('HW3 has prizeCategories:', hw3.prizeCategories.length);
console.log('HW1 lessons:', d.hackweeks['2025'][0].lessonsLearned.length);
console.log('HW2 lessons:', d.hackweeks['2026'][0].lessonsLearned.length);
"
```

- [ ] **Step 3: Commit**

```bash
git add data/hackweek-data.json
git commit -m "feat(hackweek): migrate to multi-event structure keyed by year"
```

---

### Task 2: Update server endpoints for multi-hack-week

**Files:**
- Modify: `server.js` — the Hack Week API section (lines ~1466-1627)

Three changes: update `GET /api/hackweek` to handle the new structure, add `GET /api/hackweek/:id`, and change `PATCH /api/hackweek/scores` to `PATCH /api/hackweek/:id/scores`.

- [ ] **Step 1: Add a helper function to find a hack week by id**

Find the line `const HACKWEEK_PATH = path.join(DATA_DIR, 'hackweek-data.json');` (line ~1467). Add after it:

```javascript
function loadHackweekData() {
  try { return fs.existsSync(HACKWEEK_PATH) ? JSON.parse(fs.readFileSync(HACKWEEK_PATH, 'utf8')) : { hackweeks: {} }; }
  catch(e) { return { hackweeks: {} }; }
}

function findHackweekById(data, id) {
  for (const year of Object.values(data.hackweeks || {})) {
    const found = year.find(hw => hw.id === id);
    if (found) return found;
  }
  return null;
}

function findPlanningHackweek(data) {
  for (const year of Object.values(data.hackweeks || {})) {
    const found = year.find(hw => hw.status === 'Planning');
    if (found) return found;
  }
  return null;
}
```

- [ ] **Step 2: Replace GET /api/hackweek**

Find the existing `app.get('/api/hackweek', ...)` block (lines ~1469-1479). Replace the entire block with:

```javascript
app.get('/api/hackweek', (req, res) => {
  try {
    const data = loadHackweekData();
    // Compute daysUntil for each non-Complete hack week
    Object.values(data.hackweeks || {}).forEach(year => {
      year.forEach(hw => {
        if (hw.targetDate && hw.status !== 'Complete') {
          hw.daysUntil = Math.ceil((new Date(hw.targetDate) - new Date()) / 86400000);
        }
      });
    });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

- [ ] **Step 3: Add GET /api/hackweek/:id**

Insert after the `app.get('/api/hackweek', ...)` block, before `app.post('/api/hackweek', ...)`:

```javascript
app.get('/api/hackweek/:id', (req, res) => {
  try {
    const data = loadHackweekData();
    const hw = findHackweekById(data, req.params.id);
    if (!hw) return res.status(404).json({ error: 'Hack week not found' });
    if (hw.targetDate && hw.status !== 'Complete') {
      hw.daysUntil = Math.ceil((new Date(hw.targetDate) - new Date()) / 86400000);
    }
    res.json(hw);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

- [ ] **Step 4: Replace PATCH /api/hackweek/scores with PATCH /api/hackweek/:id/scores**

Find the existing `app.patch('/api/hackweek/scores', ...)` block (line ~1577). Replace the ENTIRE block (from `// ── Hack Week Scoring ──` through the closing `});`) with:

```javascript
// ── Hack Week Scoring ──
app.patch('/api/hackweek/:id/scores', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== (process.env.DASHBOARD_API_KEY || 'sophie-dashboard-secret-change-me')) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  try {
    const { team, judge, idea, code, demo } = req.body;
    if (!team || !judge) return res.status(400).json({ error: 'team and judge required' });

    // Validate scores are 1-10
    for (const [key, val] of Object.entries({ idea, code, demo })) {
      if (val !== undefined && (typeof val !== 'number' || val < 1 || val > 10)) {
        return res.status(400).json({ error: key + ' must be a number 1-10' });
      }
    }

    const data = loadHackweekData();
    const hw = findHackweekById(data, req.params.id);
    if (!hw) return res.status(404).json({ error: 'Hack week not found' });
    if (!hw.scores) hw.scores = [];

    // Validate team exists (if teams are loaded)
    if (hw.teams && hw.teams.length > 0) {
      const teamExists = hw.teams.some(t => t.name.toLowerCase() === team.toLowerCase());
      if (!teamExists) return res.status(400).json({ error: 'Team not found: ' + team, availableTeams: hw.teams.map(t => t.name) });
    }

    // Upsert: find existing score for same judge+team combo
    const existingIdx = hw.scores.findIndex(s => s.team.toLowerCase() === team.toLowerCase() && s.judge.toLowerCase() === judge.toLowerCase());

    if (existingIdx >= 0) {
      const existing = hw.scores[existingIdx];
      if (idea !== undefined) existing.idea = idea;
      if (code !== undefined) existing.code = code;
      if (demo !== undefined) existing.demo = demo;
      existing.submittedAt = new Date().toISOString();
    } else {
      hw.scores.push({
        team: team,
        judge: judge,
        idea: idea || null,
        code: code || null,
        demo: demo || null,
        submittedAt: new Date().toISOString()
      });
    }

    fs.writeFileSync(HACKWEEK_PATH, JSON.stringify(data, null, 2));
    res.json({ ok: true, scoresCount: hw.scores.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

- [ ] **Step 5: Verify syntax**

```bash
cd ~/sophie-dashboard && node -e "new Function(require('fs').readFileSync('server.js', 'utf8')); console.log('Syntax OK')"
```

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat(hackweek): update endpoints for multi-event structure with :id routing"
```

---

### Task 3: Update server sheet sync for multi-hack-week

**Files:**
- Modify: `server.js` — the `syncHackweekTeamsFromSheet` function (lines ~1498-1574)

The sync now needs to find the Planning hack week, use its `signupSheet` and `sheetTabMatch`, and write teams to that specific hack week's `teams` array.

- [ ] **Step 1: Replace the syncHackweekTeamsFromSheet function**

Find the entire `async function syncHackweekTeamsFromSheet()` block (from `async function syncHackweekTeamsFromSheet() {` through its closing `}`). Replace with:

```javascript
async function syncHackweekTeamsFromSheet() {
  try {
    const auth = await getGoogleSheetsAuth();
    if (!auth) { console.log('[HW Sheet] No auth - skipping sync'); return; }

    const data = loadHackweekData();
    const planning = findPlanningHackweek(data);
    if (!planning) { console.log('[HW Sheet] No Planning hack week found - skipping sync'); return; }

    // Use the hack week's own signup sheet, or fall back to default
    const sheetId = (planning.signupSheet || '').match(/\/d\/([^/]+)/)?.[1] || HACKWEEK_SHEET_ID;

    const sheets = google.sheets({ version: 'v4', auth });

    // Get all sheet tabs
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const sheetTabs = spreadsheet.data.sheets.map(s => s.properties.title);

    // Find the right tab using the hack week's sheetTabMatch or name
    const tabMatch = (planning.sheetTabMatch || planning.name || '').toLowerCase();
    let targetTab = sheetTabs.find(t => t.toLowerCase().includes(tabMatch));
    if (!targetTab) targetTab = sheetTabs[sheetTabs.length - 1];

    console.log('[HW Sheet] Reading tab:', targetTab, 'for', planning.name);

    const range = targetTab + '!A1:Z100';
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: range
    });

    const rows = result.data.values;
    if (!rows || rows.length < 2) {
      console.log('[HW Sheet] No data rows found');
      return;
    }

    // Row 1 = headers, dynamically map columns
    const headers = rows[0].map(h => h.toLowerCase().trim());
    const colMap = {
      name: headers.findIndex(h => h.includes('team') && h.includes('name') || h === 'team'),
      members: headers.findIndex(h => h.includes('member') || h.includes('people') || h.includes('who')),
      idea: headers.findIndex(h => h.includes('idea') || h.includes('description') || h.includes('project')),
      techStack: headers.findIndex(h => h.includes('tech') || h.includes('stack') || h.includes('technolog')),
      loomUrl: headers.findIndex(h => h.includes('loom') || h.includes('video') || h.includes('demo link'))
    };

    if (colMap.name === -1) colMap.name = 0;

    const teams = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const name = (colMap.name >= 0 && row[colMap.name]) ? row[colMap.name].trim() : '';
      if (!name) continue;

      const membersRaw = (colMap.members >= 0 && row[colMap.members]) ? row[colMap.members] : '';
      const members = membersRaw.split(/[,\n]+/).map(m => m.trim()).filter(Boolean);

      teams.push({
        name: name,
        members: members,
        idea: (colMap.idea >= 0 && row[colMap.idea]) ? row[colMap.idea].trim() : '',
        techStack: (colMap.techStack >= 0 && row[colMap.techStack]) ? row[colMap.techStack].trim() : '',
        loomUrl: (colMap.loomUrl >= 0 && row[colMap.loomUrl]) ? row[colMap.loomUrl].trim() : '',
        sheetRow: i + 1
      });
    }

    // Write teams to the Planning hack week
    planning.teams = teams;
    data.lastSheetSync = new Date().toISOString();
    fs.writeFileSync(HACKWEEK_PATH, JSON.stringify(data, null, 2));
    console.log('[HW Sheet] Synced', teams.length, 'teams for', planning.name);
  } catch (e) {
    console.error('[HW Sheet] Sync error:', e.message);
  }
}
```

- [ ] **Step 2: Verify syntax**

```bash
cd ~/sophie-dashboard && node -e "new Function(require('fs').readFileSync('server.js', 'utf8')); console.log('Syntax OK')"
```

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(hackweek): update sheet sync to target Planning hack week"
```

---

### Task 4: Update dashboard — hack week selector and data wiring

**Files:**
- Modify: `dashboard.html`

This task updates the dashboard to work with the multi-event structure. Four edits:

1. Update `fetchHackweekData` to extract all hack weeks and auto-select the Planning one
2. Add a selector dropdown above the sub-tabs in `renderHackWeek()`
3. Update `renderHackWeek()` to pull data from the selected hack week object
4. Update the sidebar and overview card to use API data instead of `DATA.hackWeek`

- [ ] **Step 1: Add hack week selection state and update fetchHackweekData**

Find the lines (around line 3388):
```javascript
let _hackweekApiData = null;
```

Replace with:
```javascript
let _hackweekApiData = null;
let _allHackweeks = [];
let _selectedHackweekId = null;
```

Then find `async function fetchHackweekData()` (around line 3397). Replace the entire function with:

```javascript
async function fetchHackweekData() {
  try {
    const res = await fetch('/api/hackweek');
    if (res.ok) {
      const data = await res.json();
      _hackweekApiData = data;
      // Flatten all hack weeks into a sorted list
      _allHackweeks = [];
      Object.values(data.hackweeks || {}).forEach(function(year) {
        year.forEach(function(hw) { _allHackweeks.push(hw); });
      });
      _allHackweeks.sort(function(a,b) { return (a.targetDate||'').localeCompare(b.targetDate||''); });
      // Auto-select the Planning one, or most recent Complete
      if (!_selectedHackweekId) {
        var planning = _allHackweeks.find(function(hw) { return hw.status === 'Planning'; });
        if (planning) { _selectedHackweekId = planning.id; }
        else {
          var completed = _allHackweeks.filter(function(hw) { return hw.status === 'Complete'; });
          if (completed.length > 0) _selectedHackweekId = completed[completed.length - 1].id;
        }
      }
    }
  } catch(e) { console.warn('[Hackweek] API fetch failed:', e.message); }
}
```

- [ ] **Step 2: Add a helper to get the selected hack week**

Find the line `fetchHackweekData();` (around line 3621). Add BEFORE it:

```javascript
function getSelectedHackweek() {
  return _allHackweeks.find(function(hw) { return hw.id === _selectedHackweekId; }) || {};
}

function switchHackweek(id) {
  _selectedHackweekId = id;
  renderProjectsPage();
}
```

- [ ] **Step 3: Rewrite renderHackWeek() to use selected hack week from API**

Find the beginning of `renderHackWeek()` (line ~4939). Replace everything from `function renderHackWeek() {` through the line `const hwPrevious = (hwConfig.previousHackWeeks) || {};` (the data extraction block) with:

```javascript
function renderHackWeek() {
  const hw_selected = getSelectedHackweek();
  if (!hw_selected.id && !DATA.hackWeek) return '';

  // Use selected hack week from API, fall back to inline DATA for phases
  const hwApi = hw_selected;
  const isComplete = hw_selected.status === 'Complete';
  const isFuture = hw_selected.status === 'Future';

  // Phases: use API checklist if available, fall back to inline DATA.hackWeek
  const phases = (hwApi.checklist && hwApi.checklist.phases && hwApi.checklist.phases.length > 0) ? hwApi.checklist.phases : (DATA.hackWeek ? DATA.hackWeek.phases : []);

  const totalTasks = phases.reduce(function(s,p) { return s + (p.tasks||p.items||[]).length; }, 0);
  const doneTasks = phases.reduce(function(s,p) { return s + (p.tasks||p.items||[]).filter(function(t){return t.done;}).length; }, 0);
  const pct = totalTasks ? Math.round((doneTasks/totalTasks)*100) : 0;
  const daysUntil = hwApi.daysUntil || Math.ceil((new Date(hwApi.targetDate || DATA.hackWeek?.targetDate || '2026-06-08') - new Date()) / 86400000);

  // Build phaseHtml from phases (only for Planning hack weeks)
  let phaseHtml = '';
  if (!isComplete && !isFuture && phases.length > 0) {
    phases.forEach(function(p, pi) {
      var tasks = p.tasks || p.items || [];
      var pDone = tasks.filter(function(t){return t.done;}).length;
      var pTotal = tasks.length;
      var allDone = pDone === pTotal;
      var isFirst = pi === 0;

      phaseHtml += '<div class="hw-phase' + (allDone?' phase-done':'') + '" data-hwphase="' + pi + '">' +
        '<div class="hw-phase-head" onclick="toggleHWPhase(this)" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">' +
          '<span class="hw-chevron" style="font-size:10px;color:var(--text-muted);transition:transform .2s;transform:rotate(' + (isFirst?'90':'0') + 'deg)">&#9654;</span>' +
          '<span style="font-size:11px;font-weight:700;color:' + (allDone?'var(--green)':'var(--text)') + ';flex:1">' + (p.name || p.deadline || '') + '</span>' +
          '<span style="font-size:9px;color:var(--text-muted);font-weight:600">' + (p.deadline || '') + '</span>' +
          '<span style="font-size:9px;padding:2px 6px;border-radius:4px;font-weight:700;' + (allDone?'background:var(--green-soft);color:var(--green)':'background:var(--surface);color:var(--text-muted)') + '">' + pDone + '/' + pTotal + '</span>' +
        '</div>' +
        '<div class="hw-phase-body" style="display:' + (isFirst?'block':'none') + ';padding:4px 0 4px 18px">';

      tasks.forEach(function(t, ti) {
        phaseHtml += '<div class="hw-task' + (t.done?' checked':'') + '" data-hwphase="' + pi + '" data-hwtask="' + ti + '" onclick="toggleHWTask(this)" style="display:flex;align-items:flex-start;gap:8px;padding:5px 4px;border-radius:5px;cursor:pointer;transition:background .15s;font-size:11px">' +
          '<div class="task-checkbox' + (t.done?' checked':'') + '"></div>' +
          '<span style="color:' + (t.done?'var(--text-muted)':'var(--text-dim)') + ';' + (t.done?'text-decoration:line-through;opacity:.5':'') + ';line-height:1.3">' + (t.text || t.item || '') + '</span>' +
        '</div>';
      });
      phaseHtml += '</div></div>';
    });
  }

  var barColor = pct >= 75 ? 'var(--green)' : pct >= 40 ? 'var(--yellow)' : 'var(--accent)';

  // Extract data from the selected hack week
  var hwTeams = hwApi.teams || [];
  var hwSchedule = hwApi.schedule || {};
  var hwLogistics = hwApi.logistics || {};
  var hwBudget = hwLogistics.budget || {};
  var hwJudges = hwLogistics.judges || [];
  var hwContacts = hwLogistics.keyContacts || (DATA.hackWeek ? DATA.hackWeek.keyContacts : {}) || {};
  var hwRubric = hwApi.rubric || [];
  var hwResourceLinks = hwApi.resourceLinks || [];
  var hwScores = hwApi.scores || [];
  var hwPrizes = hwApi.prizeCategories || [];
  var hwTeamRules = hwApi.teamFormationRules || [];
  var hwLessons = hwApi.lessonsLearned || [];

  // For Archive tab: collect all completed hack weeks
  var completedHackweeks = _allHackweeks.filter(function(hw) { return hw.status === 'Complete'; });

  var budgetTotal = (hwBudget.prizes||0) + (hwBudget.travel||0) + (hwBudget.food||0) + (hwBudget.social||0);
```

- [ ] **Step 4: Add the hack week selector dropdown**

Find the tab navigation return block. It currently starts with:
```
  <div class="hw-hub-nav">
    <button class="hw-hub-nav-btn active" data-hw-tab="hw-overview">Overview</button>
```

Add BEFORE this `<div class="hw-hub-nav">` line (inside the return template literal):

```javascript
  <!-- Hack Week Selector -->
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
    <select onchange="switchHackweek(this.value)" style="padding:6px 10px;border-radius:6px;background:var(--surface);border:1px solid var(--border);color:var(--text);font-size:12px;font-weight:600;font-family:inherit;cursor:pointer">
      ${_allHackweeks.map(function(hw) {
        var label = hw.name + ' — ' + (hw.targetDate ? new Date(hw.targetDate).toLocaleDateString('en-US', {month:'short', year:'numeric'}) : 'TBD');
        var statusBadge = hw.status === 'Planning' ? ' (Active)' : hw.status === 'Future' ? ' (Future)' : '';
        return '<option value="' + hw.id + '"' + (hw.id === _selectedHackweekId ? ' selected' : '') + '>' + label + statusBadge + '</option>';
      }).join('')}
    </select>
    ${isComplete ? '<span style="font-size:10px;padding:3px 8px;border-radius:4px;background:var(--green-soft);color:var(--green);font-weight:700">Complete</span>' : ''}
    ${isFuture ? '<span style="font-size:10px;padding:3px 8px;border-radius:4px;background:var(--surface);color:var(--text-muted);font-weight:700">Future</span>' : ''}
  </div>
```

- [ ] **Step 5: Update the Overview tab header to use selected hack week name**

In the Overview tab pane, find the line:
```
        <div class="card-title">&#129470; Hack Week #3</div>
```

Replace with:
```
        <div class="card-title">&#129470; ${hwApi.name || 'Hack Week'}</div>
```

Also find the `daysUntil` badge line and make it conditional on non-Complete:
```
          <span class="badge ${daysUntil<=14?'tag-yellow':'tag-blue'}">${daysUntil}d away</span>
```

Replace with:
```
          ${!isComplete ? '<span class="badge ' + (daysUntil<=14?'tag-yellow':'tag-blue') + '">' + daysUntil + 'd away</span>' : '<span class="badge tag-green">Complete</span>'}
```

And update the dates/Slack/teams info line to use hwApi:
```
          <div style="font-size:11px;color:var(--text-muted)"><strong style="color:var(--text)">Dates:</strong> ${hwConfig.dates || hw.dates}</div>
          <div style="font-size:11px;color:var(--text-muted)"><strong style="color:var(--text)">Slack:</strong> ${hwConfig.slackChannel || '#hack-week-jun-2026'}</div>
```

Replace with:
```
          <div style="font-size:11px;color:var(--text-muted)"><strong style="color:var(--text)">Dates:</strong> ${hwApi.targetDate ? new Date(hwApi.targetDate + 'T12:00:00').toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'}) : 'TBD'}</div>
          <div style="font-size:11px;color:var(--text-muted)"><strong style="color:var(--text)">Slack:</strong> ${hwApi.slackChannel || ''}</div>
```

- [ ] **Step 6: Update the Archive tab to list all completed hack weeks**

Find the Archive tab content. Replace the entire `<div class="hw-hub-tab-pane" data-hw-pane="hw-archive">` through its closing `</div>` with:

```javascript
  <!-- TAB: Archive -->
  <div class="hw-hub-tab-pane" data-hw-pane="hw-archive">
    ${completedHackweeks.length > 0 ? completedHackweeks.map(function(hw_past) {
      return '<div class="card" style="margin-bottom:12px">' +
        '<div class="card-head"><span class="card-title">&#128218; ' + hw_past.name + '</span>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
        (hw_past.notionHub ? '<a href="' + hw_past.notionHub + '" target="_blank" style="font-size:10px;color:var(--gold);text-decoration:none">Notion &#8599;</a>' : '') +
        (hw_past.signupSheet ? '<a href="' + hw_past.signupSheet + '" target="_blank" style="font-size:10px;color:var(--text-muted);text-decoration:none">Sheet &#8599;</a>' : '') +
        '<button onclick="switchHackweek(\'' + hw_past.id + '\')" style="font-size:9px;padding:2px 8px;border-radius:4px;background:var(--surface);border:1px solid var(--border);color:var(--gold);cursor:pointer;font-family:inherit">View &#8599;</button>' +
        '</div></div>' +
        '<div class="card-body" style="padding:10px 14px">' +
        ((hw_past.lessonsLearned || []).length > 0 ? '<ul style="margin:0;padding-left:18px;font-size:11px;color:var(--text-dim);line-height:1.8">' +
        hw_past.lessonsLearned.map(function(l) { return '<li>' + l + '</li>'; }).join('') +
        '</ul>' : '<div style="font-size:11px;color:var(--text-muted)">No lessons recorded.</div>') +
        '</div></div>';
    }).join('') : '<div class="card"><div class="card-body" style="padding:40px;text-align:center;color:var(--text-muted)"><div style="font-size:24px;margin-bottom:8px">&#128218;</div><div>No past hack weeks archived yet.</div></div></div>'}

    ${_allHackweeks.filter(function(hw) { return hw.status === 'Future'; }).length > 0 ? '<div style="margin-top:16px"><div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Upcoming</div>' + _allHackweeks.filter(function(hw) { return hw.status === 'Future'; }).map(function(hw_future) {
      return '<div class="card" style="margin-bottom:8px;opacity:0.7"><div class="card-head"><span class="card-title">' + hw_future.name + '</span><span style="font-size:10px;color:var(--text-muted)">' + (hw_future.targetDate ? new Date(hw_future.targetDate + 'T12:00:00').toLocaleDateString('en-US', {month:'short', year:'numeric'}) : 'TBD') + '</span></div>' +
        (hw_future.planningStart ? '<div class="card-body" style="padding:6px 14px"><div style="font-size:11px;color:var(--text-muted)">Planning starts: ' + hw_future.planningStart + '</div></div>' : '') +
        '</div>';
    }).join('') + '</div>' : ''}
  </div>
```

- [ ] **Step 7: Update the page header to show selected hack week name**

Find in `renderProjectsPage()` the line:
```
        <div class="page-header"><div class="page-title">&#129470; Hack Week #3</div></div>
```

Replace with:
```
        <div class="page-header"><div class="page-title">&#129470; ${(getSelectedHackweek().name || 'Hack Week')}</div></div>
```

- [ ] **Step 8: Update sidebar hack week progress to use API data**

Find the sidebar hack week progress calculation (around line 1587):
```
  const hwTotal=DATA.hackWeek?DATA.hackWeek.phases.reduce((s,p)=>s+p.tasks.length,0):0;
  const hwDone=DATA.hackWeek?DATA.hackWeek.phases.reduce((s,p)=>s+p.tasks.filter(t=>t.done).length,0):0;
```

Replace with:
```
  const _hwSidebar = (function(){ var hw = getSelectedHackweek(); var ph = (hw.checklist && hw.checklist.phases && hw.checklist.phases.length > 0) ? hw.checklist.phases : (DATA.hackWeek ? DATA.hackWeek.phases : []); return ph; })();
  const hwTotal=_hwSidebar.reduce(function(s,p){return s+(p.tasks||p.items||[]).length;},0);
  const hwDone=_hwSidebar.reduce(function(s,p){return s+(p.tasks||p.items||[]).filter(function(t){return t.done;}).length;},0);
```

- [ ] **Step 9: Update overview card to use API data**

Find the overview card hack week section (around line 1938):
```
  const hw=DATA.hackWeek;
  let hwDone=0,hwTotal=0;
  if(hw){hw.phases.forEach(p=>{p.tasks.forEach(t=>{hwTotal++;if(t.done)hwDone++;});});}
  const hwPct=hwTotal>0?Math.round(hwDone/hwTotal*100):0;
```

Replace with:
```
  const hw=(function(){ var sel = getSelectedHackweek(); if (sel.id) return sel; return DATA.hackWeek; })();
  let hwDone=0,hwTotal=0;
  if(hw){var hwPhases = (hw.checklist && hw.checklist.phases && hw.checklist.phases.length > 0) ? hw.checklist.phases : (hw.phases || []); hwPhases.forEach(function(p){(p.tasks||p.items||[]).forEach(function(t){hwTotal++;if(t.done)hwDone++;});});}
  const hwPct=hwTotal>0?Math.round(hwDone/hwTotal*100):0;
```

Also update the card display below (around line 1964):
```
          <div style="font-size:11px;color:var(--text-dim)">${hw.dates}</div>
```

Replace with:
```
          <div style="font-size:11px;color:var(--text-dim)">${hw.targetDate ? new Date(hw.targetDate + 'T12:00:00').toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : (hw.dates || '')}</div>
```

- [ ] **Step 10: Verify backtick count and structure**

```bash
cd ~/sophie-dashboard && node -e "
const h=require('fs').readFileSync('dashboard.html','utf8');
const b=(h.match(/\x60/g)||[]).length;
console.log('Backticks:', b, b%2===0?'OK':'PROBLEM');
console.log('Has selector:', h.includes('switchHackweek'));
console.log('Has getSelectedHackweek:', h.includes('getSelectedHackweek'));
console.log('Has _allHackweeks:', h.includes('_allHackweeks'));
console.log('Has _selectedHackweekId:', h.includes('_selectedHackweekId'));
console.log('Has completedHackweeks:', h.includes('completedHackweeks'));
"
```

- [ ] **Step 11: Commit**

```bash
git add dashboard.html
git commit -m "feat(hackweek): add multi-event selector, auto-select Planning hack week, archive all completed"
```

---

### Task 5: End-to-end verification

**Files:** None (read-only verification)

- [ ] **Step 1: Verify JSON structure**

```bash
cd ~/sophie-dashboard && node -e "
const d = JSON.parse(require('fs').readFileSync('data/hackweek-data.json','utf8'));
console.log('Has hackweeks:', !!d.hackweeks);
var all = [];
Object.entries(d.hackweeks).forEach(function(e) { console.log('Year', e[0] + ':', e[1].length, 'entries'); e[1].forEach(function(hw) { all.push(hw); console.log('  -', hw.id, hw.name, '(' + hw.status + ')'); }); });
console.log('Total hack weeks:', all.length);
console.log('Planning:', all.filter(function(h){return h.status==='Planning';}).length);
console.log('Complete:', all.filter(function(h){return h.status==='Complete';}).length);
console.log('Future:', all.filter(function(h){return h.status==='Future';}).length);
"
```

- [ ] **Step 2: Verify server syntax and start**

```bash
cd ~/sophie-dashboard && node -e "new Function(require('fs').readFileSync('server.js', 'utf8')); console.log('Server syntax OK')"
```

Then start server and test API:

```bash
cd ~/sophie-dashboard && PORT=3999 node server.js &
SERVER_PID=$!
sleep 3

echo "=== GET /api/hackweek ==="
curl -s http://localhost:3999/api/hackweek | node -e "
var c=[];process.stdin.on('data',function(d){c.push(d);});process.stdin.on('end',function(){
var d=JSON.parse(Buffer.concat(c));
console.log('Has hackweeks:', !!d.hackweeks);
var all=[];Object.values(d.hackweeks).forEach(function(y){y.forEach(function(h){all.push(h);});});
console.log('Total:', all.length);
var p = all.find(function(h){return h.status==='Planning';});
console.log('Planning:', p ? p.id : 'NONE');
console.log('Planning has daysUntil:', p ? p.daysUntil : 'N/A');
});"

echo ""
echo "=== GET /api/hackweek/hw-2026-jun ==="
curl -s http://localhost:3999/api/hackweek/hw-2026-jun | node -e "
var c=[];process.stdin.on('data',function(d){c.push(d);});process.stdin.on('end',function(){
var d=JSON.parse(Buffer.concat(c));
console.log('id:', d.id);
console.log('status:', d.status);
console.log('teams:', (d.teams||[]).length);
console.log('rubric:', (d.rubric||[]).length);
});"

echo ""
echo "=== PATCH /api/hackweek/hw-2026-jun/scores ==="
curl -s -X PATCH http://localhost:3999/api/hackweek/hw-2026-jun/scores \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sophie-dashboard-secret-change-me" \
  -d '{"team":"Test","judge":"Shreyas","idea":8,"code":7,"demo":9}'

echo ""
# Clean up test score
node -e "
var fs=require('fs');
var d=JSON.parse(fs.readFileSync('data/hackweek-data.json','utf8'));
d.hackweeks['2026'][1].scores=d.hackweeks['2026'][1].scores.filter(function(s){return s.team!=='Test';});
fs.writeFileSync('data/hackweek-data.json',JSON.stringify(d,null,2));
console.log('Cleaned test score');
"

kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null
```

- [ ] **Step 3: Verify dashboard structure**

```bash
cd ~/sophie-dashboard && node -e "
var h=require('fs').readFileSync('dashboard.html','utf8');
var b=(h.match(/\x60/g)||[]).length;
console.log('Backticks:', b, b%2===0?'OK':'PROBLEM');
console.log('Has switchHackweek:', h.includes('switchHackweek'));
console.log('Has getSelectedHackweek:', h.includes('getSelectedHackweek'));
console.log('Has _allHackweeks:', h.includes('_allHackweeks'));
console.log('Has completedHackweeks:', h.includes('completedHackweeks'));
console.log('No hardcoded Hack Week #3 in page title:', !h.includes('page-title\">&#129470; Hack Week #3'));
"
```
