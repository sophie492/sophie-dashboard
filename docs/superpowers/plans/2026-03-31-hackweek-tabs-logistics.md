# Hack Week Tabs + Logistics Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize hack week tasks into 7 purpose-driven tabs with per-tab checklists, and add offsite-style research/confirmation pipelines for Travel and Social Events logistics.

**Architecture:** Data migration splits the flat `checklist.phases` into `tasks: { schedule, teams, logistics, comms, judging }` per-tab arrays. Two new server endpoints (`PATCH /:id/logistics` and `PATCH /:id/task`) handle logistics pipeline updates and task toggling. The dashboard replaces its 5-tab layout with 7 tabs, each rendering its own task checklist plus specialized content.

**Tech Stack:** Express, existing single-file dashboard pattern, offsite logistics card pattern as reference.

---

### Task 1: Migrate data — split checklist into per-tab task arrays + add logistics pipelines

**Files:**
- Modify: `data/hackweek-data.json`

- [ ] **Step 1: Run migration script**

```bash
cd ~/sophie-dashboard && node -e "
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('data/hackweek-data.json', 'utf8'));
const hw3 = d.hackweeks['2026'][1]; // Planning hack week

// Define per-tab task assignments
hw3.tasks = {
  schedule: [
    { text: 'Pick the dates — Avoid US and India holidays, check OOO schedules, BLR office holidays', done: false, lesson: 'Jan 2026: Holiday conflicts with MLK Day and BLR holiday caused last-minute schedule changes.' },
    { text: 'Decide on cross-office schedule (SF & BLR async alignment)', done: false },
    { text: 'Confirm the daily structure (Build → Demo → Optimize/Ship)', done: false },
    { text: 'Cancel all internal meetings for hack week', done: false },
    { text: 'Set up on-call schedule for customer-facing coverage', done: false },
    { text: 'Block calendars with hack week events', done: false },
    { text: 'Set up Loom recording workflow', done: false }
  ],
  teams: [
    { text: 'Create team sign-up spreadsheet (Google Sheet)', done: false },
    { text: 'Set team formation rules (2-4 people, cross-functional >50%, no solo, PMs/Designers encouraged)', done: false },
    { text: 'Set deadline for team/idea submission (~1 week before)', done: false },
    { text: 'Send reminder nudges for team formation', done: false },
    { text: 'Have Bharat/Shreyas review and approve all ideas', done: false },
    { text: 'Lock all teams and ideas (~3 days before)', done: false },
    { text: 'Confirm attendance in each office', done: false },
    { text: 'Decide on prizes and categories (AI, Customer Impact, Internal Tool)', done: false },
    { text: 'Confirm judges (Shreyas, Rishabh, Bharat + leadership)', done: false, lesson: 'Jan 2026: Both Bharat and Shreyas were absent for scheduled Town Hall announcement.' }
  ],
  logistics: [
    { text: 'Get budget approved — prizes, travel, food, social events (Evelyn)', done: false },
    { text: 'Assign a BLR logistics lead (Kunal/Sriram + Shiksha)', done: false },
    { text: 'Arrange travel for remote employees (budget \$550-600 flights, \$350/night hotel)', done: false, lesson: 'Jan 2026: \$400 flight budget and \$1,400 hotel budget were too tight.' },
    { text: 'Coordinate BLR travel with Kunal/Sriram', done: false },
    { text: 'Plan social events — team dinner (mid-week) + happy hour (end of week), both offices', done: false },
    { text: 'Set up late-night dinner policy (expense dinner if working past 6pm)', done: false },
    { text: 'Distribute prizes (\$1,000 per winning team, split among members)', done: false }
  ],
  comms: [
    { text: 'Create #hack-week-jun-2026 Slack channel', done: false },
    { text: 'Draft and send kick-off announcement in #dev and #general (have Bharat post)', done: false },
    { text: 'Draft Slack announcement templates', done: false },
    { text: 'Post opening message in #hack-week channel', done: false },
    { text: 'Encourage daily progress updates in Slack', done: false },
    { text: 'Post shipping guidance on Day 4', done: false },
    { text: 'Post hack week recap in #general with all team names, Loom links, winners', done: false },
    { text: 'Create LinkedIn content — coordinate timing with marketing', done: false },
    { text: 'Feature hack week at offsite/company events if applicable', done: false }
  ],
  judging: [
    { text: 'Judges review all demos and Looms (2-3 days)', done: false },
    { text: 'Pick winners across all categories', done: false },
    { text: 'Announce winners at Town Hall (lock date + ensure judges available!)', done: false, lesson: 'Jan 2026: Both Bharat and Shreyas were absent for scheduled Town Hall announcement.' },
    { text: 'Have winning teams re-present polished demos to company', done: false },
    { text: 'Send feedback survey (Google Form)', done: false },
    { text: 'Hold planning retro (Sophie + Bharat + BLR leads)', done: false },
    { text: 'Update master checklist with lessons learned', done: false },
    { text: 'Track which projects made it to production (2-4 weeks later)', done: false }
  ]
};

// Remove old checklist
delete hw3.checklist;

// Add logistics pipeline data (travel + social events)
if (!hw3.logistics.travel) {
  hw3.logistics.travel = {
    status: 'Not Started',
    statusDetail: '',
    selectedOption: null,
    confirmationDetails: '',
    travelResearch: []
  };
}
if (!hw3.logistics.socialEvents) {
  hw3.logistics.socialEvents = {
    status: 'Not Started',
    statusDetail: '',
    selectedOption: null,
    confirmationDetails: '',
    socialResearch: []
  };
}

fs.writeFileSync('data/hackweek-data.json', JSON.stringify(d, null, 2));

// Verify
var v = JSON.parse(fs.readFileSync('data/hackweek-data.json', 'utf8'));
var h = v.hackweeks['2026'][1];
var tabs = Object.keys(h.tasks);
var total = tabs.reduce(function(s,t) { return s + h.tasks[t].length; }, 0);
console.log('Tabs:', tabs.join(', '));
tabs.forEach(function(t) { console.log('  ' + t + ':', h.tasks[t].length, 'tasks'); });
console.log('Total:', total, 'tasks');
console.log('No checklist:', !h.checklist);
console.log('Has travel pipeline:', !!h.logistics.travel);
console.log('Has socialEvents pipeline:', !!h.logistics.socialEvents);
"
```

Expected:
```
Tabs: schedule, teams, logistics, comms, judging
  schedule: 7 tasks
  teams: 9 tasks
  logistics: 7 tasks
  comms: 9 tasks
  judging: 8 tasks
Total: 40 tasks
No checklist: true
Has travel pipeline: true
Has socialEvents pipeline: true
```

- [ ] **Step 2: Commit**

```bash
git add data/hackweek-data.json
git commit -m "feat(hackweek): split checklist into per-tab task arrays, add logistics pipelines"
```

---

### Task 2: Server — add PATCH endpoints for logistics and task toggling

**Files:**
- Modify: `server.js` (insert after the existing `PATCH /api/hackweek/:id/scores` block, before `// ── BD Notion Sync ──`)

- [ ] **Step 1: Add PATCH /api/hackweek/:id/logistics endpoint**

Insert after the closing `});` of the scores endpoint, before `// ── BD Notion Sync ──`:

```javascript
// ── Hack Week Logistics Pipeline ──
app.patch('/api/hackweek/:id/logistics', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== (process.env.DASHBOARD_API_KEY || 'sophie-dashboard-secret-change-me')) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  try {
    const data = loadHackweekData();
    const hw = findHackweekById(data, req.params.id);
    if (!hw) return res.status(404).json({ error: 'Hack week not found' });
    if (!hw.logistics) hw.logistics = {};

    // Deep merge logistics fields
    const body = req.body;
    Object.keys(body).forEach(key => {
      if (typeof body[key] === 'object' && !Array.isArray(body[key]) && hw.logistics[key] && typeof hw.logistics[key] === 'object') {
        Object.assign(hw.logistics[key], body[key]);
      } else {
        hw.logistics[key] = body[key];
      }
    });

    fs.writeFileSync(HACKWEEK_PATH, JSON.stringify(data, null, 2));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Hack Week Task Toggle ──
app.patch('/api/hackweek/:id/task', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== (process.env.DASHBOARD_API_KEY || 'sophie-dashboard-secret-change-me')) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  try {
    const { tab, index, done } = req.body;
    if (!tab || index === undefined) return res.status(400).json({ error: 'tab and index required' });

    const data = loadHackweekData();
    const hw = findHackweekById(data, req.params.id);
    if (!hw) return res.status(404).json({ error: 'Hack week not found' });
    if (!hw.tasks || !hw.tasks[tab]) return res.status(400).json({ error: 'Invalid tab: ' + tab });
    if (!hw.tasks[tab][index]) return res.status(400).json({ error: 'Invalid index: ' + index });

    hw.tasks[tab][index].done = !!done;
    fs.writeFileSync(HACKWEEK_PATH, JSON.stringify(data, null, 2));
    res.json({ ok: true, task: hw.tasks[tab][index] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

- [ ] **Step 2: Verify syntax**

```bash
cd ~/sophie-dashboard && node -e "new Function(require('fs').readFileSync('server.js', 'utf8')); console.log('Syntax OK')"
```

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(hackweek): add PATCH endpoints for logistics pipeline and task toggling"
```

---

### Task 3: Dashboard — rewrite renderHackWeek with 7 tabs

**Files:**
- Modify: `dashboard.html`

This is the big task. It replaces the entire `renderHackWeek()` function with the new 7-tab structure. The function currently runs from line ~4906 through the closing of the Archive tab pane + closing backtick/semicolon.

Since this is a large replacement, the implementer should:
1. Read the current `renderHackWeek()` function boundaries
2. Replace the entire function

The new function should:

**Data extraction (top of function):**
- Get selected hack week from `getSelectedHackweek()`
- Extract `hwApi.tasks` object (per-tab task arrays) — with keys: `schedule, teams, logistics, comms, judging`
- Calculate total tasks across ALL tabs for progress rollup
- Extract all existing variables (teams, schedule, logistics, rubric, scores, prizes, etc.)
- Extract logistics pipeline data: `hwApi.logistics.travel` and `hwApi.logistics.socialEvents`

**Helper: render a tab's task checklist**
Build a reusable function `renderHWTabTasks(tasks, tabName)` that generates checkbox task HTML. Each task div should have `data-hwtab="tabName"` and `data-hwtask="index"` attributes, and call `toggleHWTabTask(this)` on click.

**Tab navigation:**
```
Overview | Schedule | Teams | Logistics | Comms | Judging | Archive
```

**Tab pane contents:**

1. **Overview** — countdown, dates, Slack, team count, progress bar (total across all tabs), budget card, key contacts card. NO checklist here.

2. **Schedule** — task checklist (7 tasks) + existing 5-day schedule cards with countdown badges.

3. **Teams** — task checklist (9 tasks) + team sign-up cards from Google Sheet + team formation rules + resource links.

4. **Logistics** — task checklist (7 tasks) + two logistics pipeline cards:
   - **Travel** card: status dropdown (Not Started/Researching/Decided/Booked), research options with "Select" button, selected option highlight, confirmation details textarea. Uses `hwApi.logistics.travel`.
   - **Social Events** card: same pattern, uses `hwApi.logistics.socialEvents`.
   
   The logistics cards should follow the offsite pattern. Each card has:
   - Header with category name + status dropdown
   - If research options exist: cards for each option with a "This one" button
   - If an option is selected: it's highlighted at top with a confirmation details input
   - Status color coding: Not Started=gray, Researching=yellow, Decided=blue, Booked=green

5. **Comms** — task checklist (9 tasks), grouped visually with labels: "Pre-Event" (first 3), "During" (next 3), "Post-Event" (last 3).

6. **Judging** — task checklist (8 tasks) + existing rubric + scores table + prizes grid.

7. **Archive** — unchanged from current.

**Key implementation details:**
- All task checkboxes use `data-hwtab` and `data-hwtask` attributes (NOT the old `data-hwphase`/`data-hwtask` scheme)
- The `onclick` handler is `toggleHWTabTask(this)` (new function, not the old `toggleHWTask`)
- Status dropdown for logistics calls `updateHWLogisticsStatus(category, value)` (new function)
- "This one" button calls `selectHWLogisticsOption(category, idx)` (new function)
- Use `function(){}` syntax inside template literals, NOT arrow functions
- Use string concatenation with `+` inside template literals, NOT nested backticks

---

### Task 4: Dashboard — add toggleHWTabTask and logistics interaction functions

**Files:**
- Modify: `dashboard.html`

Replace the old `toggleHWTask` function and add new interaction functions.

- [ ] **Step 1: Replace toggleHWTask with toggleHWTabTask**

Find the old `function toggleHWTask(el)` and replace the entire function with:

```javascript
function toggleHWTabTask(el) {
  var tab = el.dataset.hwtab;
  var idx = +el.dataset.hwtask;
  var hwSel = getSelectedHackweek();
  if (!hwSel.tasks || !hwSel.tasks[tab] || !hwSel.tasks[tab][idx]) return;
  var task = hwSel.tasks[tab][idx];
  task.done = !task.done;
  var isChecked = task.done;

  var hwId = hwSel.id || 'default';
  var cbKey = 'hackweek-' + hwId + '-' + tab + '-' + idx;
  syncCheckbox(cbKey, isChecked, hwSel.notionPageId || '', task.text || '');

  // Also persist via PATCH /api/hackweek/:id/task
  fetch('/api/hackweek/' + hwId + '/task', {
    method: 'PATCH',
    headers: {'Content-Type':'application/json','Authorization':'Bearer sophie-dashboard-secret-change-me'},
    body: JSON.stringify({ tab: tab, index: idx, done: isChecked })
  }).catch(function(e) { console.warn('[HW Task] Toggle failed:', e.message); });

  // Update UI
  var cb = el.querySelector('.task-checkbox');
  var label = el.querySelector('span:last-child');
  if (isChecked) {
    el.classList.add('checked');
    cb.classList.add('checked');
    label.style.textDecoration = 'line-through';
    label.style.opacity = '.5';
    label.style.color = 'var(--text-muted)';
  } else {
    el.classList.remove('checked');
    cb.classList.remove('checked');
    label.style.textDecoration = '';
    label.style.opacity = '';
    label.style.color = 'var(--text-dim)';
  }

  // Update the tab's task counter
  var tabTasks = hwSel.tasks[tab];
  var tabDone = tabTasks.filter(function(t){return t.done;}).length;
  var tabTotal = tabTasks.length;
  var card = el.closest('.card');
  var counter = card ? card.querySelector('.hw-tab-task-counter') : null;
  if (counter) counter.textContent = tabDone + '/' + tabTotal;
}
```

- [ ] **Step 2: Add logistics interaction functions**

Add after `toggleHWTabTask`:

```javascript
function updateHWLogisticsStatus(category, value) {
  var hwSel = getSelectedHackweek();
  if (!hwSel.id || !hwSel.logistics || !hwSel.logistics[category]) return;
  hwSel.logistics[category].status = value;
  fetch('/api/hackweek/' + hwSel.id + '/logistics', {
    method: 'PATCH',
    headers: {'Content-Type':'application/json','Authorization':'Bearer sophie-dashboard-secret-change-me'},
    body: JSON.stringify({ [category]: { status: value } })
  }).then(function() { renderProjectsPage(); })
  .catch(function(e) { console.warn('[HW Logistics] Status update failed:', e.message); });
}

function selectHWLogisticsOption(category, idx) {
  var hwSel = getSelectedHackweek();
  if (!hwSel.id || !hwSel.logistics || !hwSel.logistics[category]) return;
  hwSel.logistics[category].selectedOption = idx;
  hwSel.logistics[category].status = 'Decided';
  fetch('/api/hackweek/' + hwSel.id + '/logistics', {
    method: 'PATCH',
    headers: {'Content-Type':'application/json','Authorization':'Bearer sophie-dashboard-secret-change-me'},
    body: JSON.stringify({ [category]: { selectedOption: idx, status: 'Decided' } })
  }).then(function() { renderProjectsPage(); })
  .catch(function(e) { console.warn('[HW Logistics] Selection failed:', e.message); });
}

function updateHWLogisticsConfirmation(category, value) {
  var hwSel = getSelectedHackweek();
  if (!hwSel.id || !hwSel.logistics || !hwSel.logistics[category]) return;
  hwSel.logistics[category].confirmationDetails = value;
  fetch('/api/hackweek/' + hwSel.id + '/logistics', {
    method: 'PATCH',
    headers: {'Content-Type':'application/json','Authorization':'Bearer sophie-dashboard-secret-change-me'},
    body: JSON.stringify({ [category]: { confirmationDetails: value } })
  }).catch(function(e) { console.warn('[HW Logistics] Confirmation update failed:', e.message); });
}
```

- [ ] **Step 3: Update loadServerCheckboxStates to use new key format**

Find the hack week section in `loadServerCheckboxStates()` and update it to use the new `hackweek-{id}-{tab}-{index}` key format:

```javascript
    // Apply to hack week tasks
    var _hwRestore = getSelectedHackweek();
    var _hwRestoreId = _hwRestore.id || 'default';
    if (_hwRestore.tasks) {
      Object.keys(_hwRestore.tasks).forEach(function(tab) {
        (_hwRestore.tasks[tab] || []).forEach(function(t, ti) {
          var s = states['hackweek-' + _hwRestoreId + '-' + tab + '-' + ti];
          if (s) t.done = s.checked;
        });
      });
    }
```

- [ ] **Step 4: Update sidebar progress calculation**

Find the sidebar hack week progress calculation and update it to use per-tab tasks:

```javascript
  const _hwSidebar = (function(){ var hw = getSelectedHackweek(); if (!hw.tasks) return []; var total = 0; var done = 0; Object.values(hw.tasks).forEach(function(arr) { arr.forEach(function(t) { total++; if (t.done) done++; }); }); return { total: total, done: done }; })();
  const hwTotal = _hwSidebar.total || 0;
  const hwDone = _hwSidebar.done || 0;
```

- [ ] **Step 5: Update overview card progress calculation**

Find the overview card hack week calculation and update:

```javascript
  const hw=getSelectedHackweek();
  let hwDone=0,hwTotal=0;
  if(hw && hw.tasks){Object.values(hw.tasks).forEach(function(arr){arr.forEach(function(t){hwTotal++;if(t.done)hwDone++;});});}
  const hwPct=hwTotal>0?Math.round(hwDone/hwTotal*100):0;
```

- [ ] **Step 6: Commit**

```bash
git add dashboard.html
git commit -m "feat(hackweek): add tab task toggling, logistics pipeline interactions, update progress calculations"
```

---

### Task 5: Push data to Railway + deploy + verify

**Files:** None (deployment + verification only)

- [ ] **Step 1: Verify syntax**

```bash
cd ~/sophie-dashboard && node -e "new Function(require('fs').readFileSync('server.js', 'utf8')); console.log('Server OK')"
cd ~/sophie-dashboard && node -e "const h=require('fs').readFileSync('dashboard.html','utf8'); const b=(h.match(/\x60/g)||[]).length; console.log('Backticks:', b, b%2===0?'OK':'PROBLEM'); console.log('Has toggleHWTabTask:', h.includes('toggleHWTabTask')); console.log('Has updateHWLogisticsStatus:', h.includes('updateHWLogisticsStatus')); console.log('Has hw-logistics pane:', h.includes('data-hw-pane=\"hw-logistics\"')); console.log('Has hw-comms pane:', h.includes('data-hw-pane=\"hw-comms\"')); console.log('Tabs count:', (h.match(/data-hw-tab=/g)||[]).length);"
```

- [ ] **Step 2: Push and deploy**

```bash
cd ~/sophie-dashboard && git push origin main && railway up 2>&1
```

Wait for deploy to succeed.

- [ ] **Step 3: Push migrated data to Railway persistent volume**

```bash
curl -s -X POST https://sophie-dashboard-production.up.railway.app/api/hackweek \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sophie-dashboard-secret-change-me" \
  -d @data/hackweek-data.json
```

- [ ] **Step 4: Verify API**

```bash
curl -s https://sophie-dashboard-production.up.railway.app/api/hackweek/hw-2026-jun | node -e "
var c=[];process.stdin.on('data',function(d){c.push(d);});process.stdin.on('end',function(){
var d=JSON.parse(Buffer.concat(c));
console.log('Has tasks:', !!d.tasks);
if (d.tasks) Object.keys(d.tasks).forEach(function(t) { console.log('  ' + t + ':', d.tasks[t].length); });
console.log('Has travel pipeline:', !!(d.logistics && d.logistics.travel));
console.log('Has socialEvents pipeline:', !!(d.logistics && d.logistics.socialEvents));
});"
```

- [ ] **Step 5: Test task toggle endpoint**

```bash
curl -s -X PATCH https://sophie-dashboard-production.up.railway.app/api/hackweek/hw-2026-jun/task \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sophie-dashboard-secret-change-me" \
  -d '{"tab":"schedule","index":0,"done":true}'

# Verify it persisted
curl -s https://sophie-dashboard-production.up.railway.app/api/hackweek/hw-2026-jun | node -e "
var c=[];process.stdin.on('data',function(d){c.push(d);});process.stdin.on('end',function(){
var d=JSON.parse(Buffer.concat(c));
console.log('schedule[0].done:', d.tasks.schedule[0].done);
});"

# Reset it
curl -s -X PATCH https://sophie-dashboard-production.up.railway.app/api/hackweek/hw-2026-jun/task \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sophie-dashboard-secret-change-me" \
  -d '{"tab":"schedule","index":0,"done":false}'
```
