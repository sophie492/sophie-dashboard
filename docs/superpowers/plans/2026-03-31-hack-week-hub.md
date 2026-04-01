# Hack Week Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the Hack Week section into a full hub with Overview/Schedule/Teams/Judging/Archive tabs, Google Sheet team sync, scoring tracker, and rich content.

**Architecture:** Three files change: `data/hackweek-data.json` gets new fields (rubric, resourceLinks, scores), `server.js` gets a Google Sheet sync cron + PATCH scores endpoint, and `dashboard.html` gets restructured sub-tabs with new rendered sections. All data flows through `/api/hackweek` — the dashboard fetches once on load.

**Tech Stack:** Express, Google Sheets API (googleapis), existing hackweek-data.json persistence.

---

### Task 1: Seed data — add rubric, resourceLinks, scores to hackweek-data.json

**Files:**
- Modify: `data/hackweek-data.json`

- [ ] **Step 1: Add new fields to hackweek-data.json**

Open `data/hackweek-data.json` and add these three top-level fields after the existing `"reviews": []` field (before the closing `"lastSynced"` line):

```json
"rubric": [
  { "criterion": "Quality of Idea", "weight": 0.333, "description": "Originality, feasibility, and potential impact of the project concept" },
  { "criterion": "Code Quality", "weight": 0.333, "description": "Architecture, reliability, test coverage, and production-readiness" },
  { "criterion": "Demo Quality", "weight": 0.334, "description": "Clarity, engagement, and polish of the demo presentation" }
],
"resourceLinks": [
  { "label": "GitHub Org", "url": "https://github.com/fermatcommerce", "icon": "github" },
  { "label": "Figma Workspace", "url": "", "icon": "figma" },
  { "label": "Notion Hub", "url": "https://www.notion.so/3291ad76fd2a81b8a66ff9d04b4a1bbe", "icon": "notion" },
  { "label": "API Docs", "url": "", "icon": "docs" }
],
"scores": [],
```

- [ ] **Step 2: Verify JSON is valid**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('data/hackweek-data.json','utf8')); console.log('Valid JSON')"
```
Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add data/hackweek-data.json
git commit -m "feat(hackweek): add rubric, resourceLinks, scores fields to seed data"
```

---

### Task 2: Server — Google Sheet team sync cron

**Files:**
- Modify: `server.js` (insert after the existing `app.post('/api/hackweek', ...)` block ending at line ~1493, before the BD Notion Sync section at line ~1495)

- [ ] **Step 1: Add the hackweek sheet sync function**

Insert after line 1493 (after the closing `});` of `app.post('/api/hackweek', ...)`), before the `// ── BD Notion Sync ──` comment:

```javascript
// ── Hack Week Google Sheet Sync ──
const HACKWEEK_SHEET_ID = '1qf2DWzf9852ARQFBnMxv1T5b5r_Zj73_VJyniG5HAv0';

async function syncHackweekTeamsFromSheet() {
  try {
    const auth = await getGoogleSheetsAuth();
    if (!auth) { console.log('[HW Sheet] No auth - skipping sync'); return; }

    const sheets = google.sheets({ version: 'v4', auth });

    // Get all sheet tabs to find the right one for current hack week
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: HACKWEEK_SHEET_ID });
    const sheetTabs = spreadsheet.data.sheets.map(s => s.properties.title);

    // Look for a tab matching current hack week (e.g. "Hack Week #3" or "Jun 2026")
    // Fall back to last tab if no match (most recent hack week)
    const hwData = fs.existsSync(HACKWEEK_PATH) ? JSON.parse(fs.readFileSync(HACKWEEK_PATH, 'utf8')) : {};
    const hwName = (hwData.config && hwData.config.name) || 'Hack Week #3';
    let targetTab = sheetTabs.find(t => t.toLowerCase().includes(hwName.toLowerCase()));
    if (!targetTab) targetTab = sheetTabs.find(t => t.toLowerCase().includes('jun 2026') || t.toLowerCase().includes('#3'));
    if (!targetTab) targetTab = sheetTabs[sheetTabs.length - 1]; // last tab = most recent

    console.log('[HW Sheet] Reading tab:', targetTab, 'from', sheetTabs.length, 'tabs');

    const range = targetTab + '!A1:Z100';
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: HACKWEEK_SHEET_ID,
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

    // Fallback: if 'team' header not found, try first column
    if (colMap.name === -1) colMap.name = 0;

    const teams = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const name = (colMap.name >= 0 && row[colMap.name]) ? row[colMap.name].trim() : '';
      if (!name) continue; // skip empty rows

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

    // Merge into existing hackweek data (preserve other fields)
    const existing = fs.existsSync(HACKWEEK_PATH) ? JSON.parse(fs.readFileSync(HACKWEEK_PATH, 'utf8')) : {};
    existing.teams = teams;
    existing.lastSheetSync = new Date().toISOString();
    const dir = path.dirname(HACKWEEK_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HACKWEEK_PATH, JSON.stringify(existing, null, 2));
    console.log('[HW Sheet] Synced', teams.length, 'teams from sheet');
  } catch (e) {
    console.error('[HW Sheet] Sync error:', e.message);
  }
}
```

- [ ] **Step 2: Register the cron in the app.listen block**

Find the `app.listen(PORT, () => {` block (line ~3925) and add the hackweek sheet sync after the task cron lines. Insert after the line `console.log('[Task Cron] Auto-refresh every 15 min');` (line ~3935):

```javascript
  // Refresh hack week teams from Google Sheet on startup + every 30 min
  syncHackweekTeamsFromSheet();
  setInterval(syncHackweekTeamsFromSheet, 30 * 60 * 1000);
  console.log('[HW Sheet] Auto-refresh every 30 min');
```

- [ ] **Step 3: Add to the skills/cron health endpoint**

Find the `skills` array in the `/api/system/health` endpoint (line ~3819). Add after the `offsite-monitor` entry (line ~3824):

```javascript
    { id: 'hackweek-sheet', name: 'Hack Week Sheet Sync', schedule: 'Every 30 min', ...ranToday(HACKWEEK_PATH, 'lastSheetSync') }
```

- [ ] **Step 4: Test the server starts**

Run:
```bash
cd ~/sophie-dashboard && node -e "
const fs = require('fs');
const src = fs.readFileSync('server.js', 'utf8');
// Check syntax
try { new Function(src); console.log('Syntax OK'); } catch(e) { console.log('Syntax error:', e.message); }
"
```
Expected: `Syntax OK`

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(hackweek): add Google Sheet team sync cron (every 30 min)"
```

---

### Task 3: Server — PATCH /api/hackweek/scores endpoint

**Files:**
- Modify: `server.js` (insert after the hackweek sheet sync function added in Task 2, before `// ── BD Notion Sync ──`)

- [ ] **Step 1: Add the scores PATCH endpoint**

Insert after the `syncHackweekTeamsFromSheet` function (added in Task 2), before `// ── BD Notion Sync ──`:

```javascript
// ── Hack Week Scoring ──
app.patch('/api/hackweek/scores', (req, res) => {
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

    const data = fs.existsSync(HACKWEEK_PATH) ? JSON.parse(fs.readFileSync(HACKWEEK_PATH, 'utf8')) : {};
    if (!data.scores) data.scores = [];

    // Validate team exists (if teams are loaded)
    if (data.teams && data.teams.length > 0) {
      const teamExists = data.teams.some(t => t.name.toLowerCase() === team.toLowerCase());
      if (!teamExists) return res.status(400).json({ error: 'Team not found: ' + team, availableTeams: data.teams.map(t => t.name) });
    }

    // Upsert: find existing score for same judge+team combo
    const existingIdx = data.scores.findIndex(s => s.team.toLowerCase() === team.toLowerCase() && s.judge.toLowerCase() === judge.toLowerCase());
    const scoreEntry = {
      team: team,
      judge: judge,
      idea: idea || null,
      code: code || null,
      demo: demo || null,
      submittedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      // Merge: only overwrite fields that are provided
      const existing = data.scores[existingIdx];
      if (idea !== undefined) existing.idea = idea;
      if (code !== undefined) existing.code = code;
      if (demo !== undefined) existing.demo = demo;
      existing.submittedAt = new Date().toISOString();
    } else {
      data.scores.push(scoreEntry);
    }

    fs.writeFileSync(HACKWEEK_PATH, JSON.stringify(data, null, 2));
    res.json({ ok: true, scoresCount: data.scores.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

- [ ] **Step 2: Verify syntax**

Run:
```bash
cd ~/sophie-dashboard && node -e "
const fs = require('fs');
try { new Function(fs.readFileSync('server.js', 'utf8')); console.log('Syntax OK'); } catch(e) { console.log('Syntax error:', e.message); }
"
```
Expected: `Syntax OK`

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(hackweek): add PATCH /api/hackweek/scores endpoint for judge scoring"
```

---

### Task 4: Dashboard — restructure sub-tabs and render Overview tab

**Files:**
- Modify: `dashboard.html` — the `renderHackWeek()` function (starting at line 4939)

This is the largest task. It replaces the return value of `renderHackWeek()` (lines 5000-5097) with the new 5-tab structure. The function preamble (lines 4939-4999) stays mostly the same — we add new data extraction variables and replace the returned HTML.

- [ ] **Step 1: Add new data extraction variables**

Find the line `const hwReviews = hwApi.reviews || [];` (line 4986). Add after it:

```javascript
  const hwRubric = hwApi.rubric || [];
  const hwResourceLinks = hwApi.resourceLinks || [];
  const hwScores = hwApi.scores || [];
  const hwPrizes = hwApi.prizeCategories || [];
  const hwTeamRules = hwApi.teamFormationRules || [];
  const hwLessons = hwApi.lessonsLearned || [];
  const hwPrevious = (hwConfig.previousHackWeeks) || {};
```

- [ ] **Step 2: Replace the tab navigation buttons**

Find the existing tab nav (lines 5001-5007):
```javascript
  <div class="hw-hub-nav">
    <button class="hw-hub-nav-btn active" data-hw-tab="hw-current">Current Hack Week</button>
    <button class="hw-hub-nav-btn" data-hw-tab="hw-teams">Teams</button>
    <button class="hw-hub-nav-btn" data-hw-tab="hw-schedule">Schedule</button>
    <button class="hw-hub-nav-btn" data-hw-tab="hw-logistics">Logistics</button>
    <button class="hw-hub-nav-btn" data-hw-tab="hw-reviews">Reviews</button>
  </div>
```

Replace with:
```javascript
  <div class="hw-hub-nav">
    <button class="hw-hub-nav-btn active" data-hw-tab="hw-overview">Overview</button>
    <button class="hw-hub-nav-btn" data-hw-tab="hw-schedule">Schedule</button>
    <button class="hw-hub-nav-btn" data-hw-tab="hw-teams">Teams</button>
    <button class="hw-hub-nav-btn" data-hw-tab="hw-judging">Judging</button>
    <button class="hw-hub-nav-btn" data-hw-tab="hw-archive">Archive</button>
  </div>
```

- [ ] **Step 3: Replace the Overview (formerly Current) tab pane**

Find the existing current tab (lines 5009-5039, from `<!-- TAB: Current Hack Week -->` through its closing `</div>`). Replace the entire block `<div class="hw-hub-tab-pane active" data-hw-pane="hw-current">...</div>` with:

```javascript
  <!-- TAB: Overview -->
  <div class="hw-hub-tab-pane active" data-hw-pane="hw-overview">
    <div class="card">
      <div class="card-head">
        <div class="card-title">&#129470; Hack Week #3</div>
        <div class="card-badges">
          <span class="badge ${daysUntil<=14?'tag-yellow':'tag-blue'}">${daysUntil}d away</span>
          <a href="${hw.notionUrl || hwConfig.notionHub || ''}" target="_blank" style="font-size:10px;color:var(--gold)">Notion &#8599;</a>
        </div>
      </div>
      <div class="card-body" style="padding:10px 14px">
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
          <div style="font-size:11px;color:var(--text-muted)"><strong style="color:var(--text)">Dates:</strong> ${hwConfig.dates || hw.dates}</div>
          <div style="font-size:11px;color:var(--text-muted)"><strong style="color:var(--text)">Slack:</strong> ${hwConfig.slackChannel || '#hack-week-jun-2026'}</div>
          <div style="font-size:11px;color:var(--text-muted)"><strong style="color:var(--text)">Teams:</strong> ${hwTeams.length} signed up</div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:12px;font-weight:700;color:var(--text)">Planning Progress</span>
          <span style="font-size:10px;color:var(--text-muted)">${doneTasks}/${totalTasks} tasks (${pct}%)</span>
        </div>
        <div style="height:6px;background:var(--surface);border-radius:3px;overflow:hidden;border:1px solid var(--border);margin-bottom:10px">
          <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width .5s"></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
          <span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--surface);border:1px solid var(--border);color:var(--text-dim)">&#9881; ${hwContacts.engineeringLead || 'TBD'}</span>
          <span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--surface);border:1px solid var(--border);color:var(--text-dim)">&#128203; ${hwContacts.operations || 'TBD'}</span>
          <span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--surface);border:1px solid var(--border);color:var(--text-dim)">&#127919; ${hwJudges.length > 0 ? hwJudges.join(', ') : (hw.keyContacts ? hw.keyContacts.judges : 'TBD')}</span>
        </div>
        ${phaseHtml}
      </div>
    </div>

    <!-- Logistics folded into Overview -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
      <div class="card" style="padding:14px;border-left:3px solid var(--gold)">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);font-weight:700">Budget</div>
        <div style="font-size:18px;font-weight:800;color:var(--gold);margin-top:4px">$${budgetTotal.toLocaleString()}</div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:4px">
          Prizes: $${(hwBudget.prizes||0).toLocaleString()} | Travel: $${(hwBudget.travel||0).toLocaleString()} | Food: $${(hwBudget.food||0).toLocaleString()} | Social: $${(hwBudget.social||0).toLocaleString()}
        </div>
        <div style="font-size:10px;margin-top:4px;color:${hwBudget.approved?'var(--green)':'var(--yellow)'}">
          ${hwBudget.approved ? '&#10003; Approved' : '&#9679; Pending approval from ' + (hwBudget.approver || 'Finance')}
        </div>
      </div>
      <div class="card" style="padding:14px;border-left:3px solid var(--lavender)">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);font-weight:700">Key Contacts</div>
        <div style="margin-top:6px;font-size:11px;line-height:1.8">
          <div><span style="color:var(--text-muted)">Eng Lead:</span> <strong>${hwContacts.engineeringLead || 'TBD'}</strong></div>
          <div><span style="color:var(--text-muted)">Ops:</span> <strong>${hwContacts.operations || 'TBD'}</strong></div>
          <div><span style="color:var(--text-muted)">BLR:</span> <strong>${hwContacts.blrLogistics || 'TBD'}</strong></div>
          <div><span style="color:var(--text-muted)">Finance:</span> <strong>${hwContacts.finance || 'TBD'}</strong></div>
        </div>
      </div>
    </div>
  </div>
```

- [ ] **Step 4: Replace the Teams tab pane**

Find the existing teams tab (lines 5042-5049). Replace the entire `<div class="hw-hub-tab-pane" data-hw-pane="hw-teams">...</div>` block with:

```javascript
  <!-- TAB: Teams -->
  <div class="hw-hub-tab-pane" data-hw-pane="hw-teams">
    <div class="card" style="margin-bottom:12px">
      <div class="card-head"><span class="card-title">Team Sign-ups</span><span style="font-size:11px;color:var(--text-muted)">${hwTeams.length} teams</span></div>
      <div class="card-body" style="padding:${hwTeams.length > 0 ? '10px 14px' : '20px'};${hwTeams.length === 0 ? 'text-align:center;color:var(--text-muted)' : ''}">
        ${hwTeams.length > 0 ? hwTeams.map(t => `
          <div style="padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-weight:700;color:var(--text);font-size:13px">${t.name}</span>
              ${t.loomUrl ? '<a href="' + t.loomUrl + '" target="_blank" style="font-size:9px;color:var(--gold);text-decoration:none">&#127909; Loom</a>' : ''}
            </div>
            <div style="font-size:11px;color:var(--text-dim);margin-bottom:3px">&#128101; ${(t.members||[]).join(', ') || 'No members listed'}</div>
            ${t.idea ? '<div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">&#128161; ' + t.idea + '</div>' : ''}
            ${t.techStack ? '<div style="font-size:10px;color:var(--text-muted)">&#9881; ' + t.techStack + '</div>' : ''}
          </div>
        `).join('') : '<div style="font-size:24px;margin-bottom:8px">&#128101;</div><div>No teams signed up yet.</div><div style="font-size:11px;margin-top:4px">Teams will appear here once the Google Sheet is populated.</div>'}
      </div>
    </div>

    <!-- Team Formation Rules -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-head"><span class="card-title">Team Formation Rules</span></div>
      <div class="card-body" style="padding:10px 14px">
        ${hwTeamRules.length > 0 ? '<ul style="margin:0;padding-left:18px;font-size:12px;color:var(--text-dim);line-height:1.8">' + hwTeamRules.map(r => '<li>' + r + '</li>').join('') + '</ul>' : '<div style="font-size:12px;color:var(--text-muted)">No rules configured yet.</div>'}
      </div>
    </div>

    <!-- Resource Links -->
    <div class="card">
      <div class="card-head"><span class="card-title">Resources</span></div>
      <div class="card-body" style="padding:10px 14px">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${hwResourceLinks.map(link => {
            const icons = {github:'&#128187;',figma:'&#127912;',notion:'&#128221;',docs:'&#128196;'};
            const icon = icons[link.icon] || '&#128279;';
            if (!link.url) return '<span style="font-size:11px;padding:6px 12px;border-radius:6px;background:var(--surface);border:1px solid var(--border);color:var(--text-muted)">' + icon + ' ' + link.label + ' (not set)</span>';
            return '<a href="' + link.url + '" target="_blank" style="font-size:11px;padding:6px 12px;border-radius:6px;background:var(--surface);border:1px solid var(--border);color:var(--gold);text-decoration:none;transition:background .15s;font-weight:600" onmouseover="this.style.background=\'rgba(219,203,119,0.08)\'" onmouseout="this.style.background=\'var(--surface)\'">' + icon + ' ' + link.label + ' &#8599;</a>';
          }).join('')}
        </div>
      </div>
    </div>
  </div>
```

- [ ] **Step 5: Keep the Schedule tab as-is (lines 5052-5054)**

The schedule tab stays. But we need to add countdown badges per day. Replace the schedule HTML generation block. Find the `let scheduleHtml = dayNames.map(...)` block (lines 4991-4995). Replace it with:

```javascript
  let scheduleHtml = dayNames.map((d,i) => {
    const day = hwSchedule[d] || {theme:'TBD',events:[]};
    // Calculate countdown for each day (June 8 + i days)
    const dayDate = new Date(hwConfig.targetDate || hw.targetDate || '2026-06-08');
    dayDate.setDate(dayDate.getDate() + i);
    const now = new Date();
    const dayDiff = Math.ceil((dayDate - now) / 86400000);
    const countdownBadge = dayDiff > 0 ? '<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--blue-soft);color:var(--blue);font-weight:700;margin-left:8px">in ' + dayDiff + 'd</span>' : dayDiff === 0 ? '<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--green-soft);color:var(--green);font-weight:700;margin-left:8px">Today</span>' : '<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--surface);color:var(--text-muted);font-weight:700;margin-left:8px">Completed</span>';
    const evts = day.events.length > 0 ? day.events.map(e => '<div style="padding:4px 0;font-size:11px;color:var(--text-dim);border-bottom:1px solid var(--border)">' + (e.time||'') + ' ' + (e.name||e) + '</div>').join('') : '<div style="padding:8px 0;font-size:11px;color:var(--text-muted);font-style:italic">No events scheduled yet</div>';
    return '<div class="card" style="margin-bottom:8px"><div class="card-head"><span class="card-title">' + dayLabels[i] + '</span><span style="display:flex;align-items:center"><span style="font-size:10px;color:var(--gold)">' + day.theme + '</span>' + countdownBadge + '</span></div><div class="card-body" style="padding:8px 14px">' + evts + '</div></div>';
  }).join('');
```

- [ ] **Step 6: Replace the Logistics tab with the Judging tab**

Find the existing logistics tab (lines 5057-5087). Replace the entire `<div class="hw-hub-tab-pane" data-hw-pane="hw-logistics">...</div>` block with:

```javascript
  <!-- TAB: Judging -->
  <div class="hw-hub-tab-pane" data-hw-pane="hw-judging">
    <!-- Rubric -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-head"><span class="card-title">Judging Rubric</span><span style="font-size:10px;color:var(--text-muted)">Equal weight (1/3 each)</span></div>
      <div class="card-body" style="padding:10px 14px">
        ${hwRubric.length > 0 ? hwRubric.map(r => `
          <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:10px;padding:3px 8px;border-radius:4px;background:var(--gold-soft, rgba(219,203,119,0.1));color:var(--gold);font-weight:700;min-width:40px;text-align:center">${Math.round(r.weight * 100)}%</span>
            <div>
              <div style="font-size:12px;font-weight:700;color:var(--text)">${r.criterion}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${r.description}</div>
            </div>
          </div>
        `).join('') : '<div style="font-size:12px;color:var(--text-muted)">No rubric configured yet.</div>'}
        <div style="margin-top:10px">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);font-weight:700;margin-bottom:6px">Judges</div>
          ${hwJudges.map(j => '<span style="font-size:11px;padding:3px 8px;border-radius:4px;background:var(--surface);border:1px solid var(--border);color:var(--text);margin-right:4px;display:inline-block;margin-bottom:4px">' + j + '</span>').join('')}
        </div>
      </div>
    </div>

    <!-- Scores -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-head"><span class="card-title">Scores</span><span style="font-size:10px;color:var(--text-muted)">${hwScores.length} submissions</span></div>
      <div class="card-body" style="padding:${hwScores.length > 0 ? '0' : '20px'};${hwScores.length === 0 ? 'text-align:center;color:var(--text-muted)' : 'overflow-x:auto'}">
        ${hwScores.length > 0 ? (() => {
          // Aggregate scores by team
          const teamScoreMap = {};
          hwScores.forEach(s => {
            if (!teamScoreMap[s.team]) teamScoreMap[s.team] = [];
            teamScoreMap[s.team].push(s);
          });
          let tableHtml = '<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="border-bottom:2px solid var(--border)">';
          tableHtml += '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-weight:700">Team</th>';
          tableHtml += '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-weight:700">Judge</th>';
          tableHtml += '<th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:700">Idea</th>';
          tableHtml += '<th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:700">Code</th>';
          tableHtml += '<th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:700">Demo</th>';
          tableHtml += '<th style="padding:8px 6px;text-align:center;color:var(--gold);font-weight:700">Avg</th>';
          tableHtml += '</tr></thead><tbody>';
          hwScores.forEach(s => {
            const vals = [s.idea, s.code, s.demo].filter(v => v !== null && v !== undefined);
            const avg = vals.length > 0 ? (vals.reduce((a,b) => a+b, 0) / vals.length).toFixed(1) : '-';
            tableHtml += '<tr style="border-bottom:1px solid var(--border)">';
            tableHtml += '<td style="padding:6px 10px;font-weight:600;color:var(--text)">' + s.team + '</td>';
            tableHtml += '<td style="padding:6px 10px;color:var(--text-dim)">' + s.judge + '</td>';
            tableHtml += '<td style="padding:6px;text-align:center;color:var(--text-dim)">' + (s.idea || '-') + '</td>';
            tableHtml += '<td style="padding:6px;text-align:center;color:var(--text-dim)">' + (s.code || '-') + '</td>';
            tableHtml += '<td style="padding:6px;text-align:center;color:var(--text-dim)">' + (s.demo || '-') + '</td>';
            tableHtml += '<td style="padding:6px;text-align:center;color:var(--gold);font-weight:700">' + avg + '</td>';
            tableHtml += '</tr>';
          });
          // Summary row per team
          const teamNames = Object.keys(teamScoreMap);
          if (teamNames.length > 0) {
            tableHtml += '<tr style="border-top:2px solid var(--border)"><td colspan="6" style="padding:6px 10px;font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase">Team Averages</td></tr>';
            teamNames.sort((a,b) => {
              const aScores = teamScoreMap[a]; const bScores = teamScoreMap[b];
              const aAvg = aScores.reduce((s,sc) => { const v = [sc.idea,sc.code,sc.demo].filter(x=>x!=null); return s + (v.length?v.reduce((a,b)=>a+b,0)/v.length:0); }, 0) / aScores.length;
              const bAvg = bScores.reduce((s,sc) => { const v = [sc.idea,sc.code,sc.demo].filter(x=>x!=null); return s + (v.length?v.reduce((a,b)=>a+b,0)/v.length:0); }, 0) / bScores.length;
              return bAvg - aAvg;
            });
            teamNames.forEach((tn, idx) => {
              const scores = teamScoreMap[tn];
              const avgIdea = scores.filter(s=>s.idea!=null).reduce((a,s)=>a+s.idea,0) / (scores.filter(s=>s.idea!=null).length || 1);
              const avgCode = scores.filter(s=>s.code!=null).reduce((a,s)=>a+s.code,0) / (scores.filter(s=>s.code!=null).length || 1);
              const avgDemo = scores.filter(s=>s.demo!=null).reduce((a,s)=>a+s.demo,0) / (scores.filter(s=>s.demo!=null).length || 1);
              const overall = ((avgIdea + avgCode + avgDemo) / 3).toFixed(1);
              tableHtml += '<tr style="background:' + (idx === 0 ? 'rgba(219,203,119,0.05)' : 'transparent') + '">';
              tableHtml += '<td style="padding:6px 10px;font-weight:700;color:var(--text)">' + (idx === 0 ? '&#127942; ' : '') + tn + '</td>';
              tableHtml += '<td style="padding:6px 10px;color:var(--text-muted);font-size:10px">' + scores.length + ' judge' + (scores.length>1?'s':'') + '</td>';
              tableHtml += '<td style="padding:6px;text-align:center;color:var(--text-dim)">' + avgIdea.toFixed(1) + '</td>';
              tableHtml += '<td style="padding:6px;text-align:center;color:var(--text-dim)">' + avgCode.toFixed(1) + '</td>';
              tableHtml += '<td style="padding:6px;text-align:center;color:var(--text-dim)">' + avgDemo.toFixed(1) + '</td>';
              tableHtml += '<td style="padding:6px;text-align:center;color:var(--gold);font-weight:700">' + overall + '</td>';
              tableHtml += '</tr>';
            });
          }
          tableHtml += '</tbody></table>';
          return tableHtml;
        })() : '<div style="font-size:24px;margin-bottom:8px">&#128202;</div><div>No scores submitted yet.</div><div style="font-size:11px;margin-top:4px">Judges submit scores via API after demo day.</div>'}
      </div>
    </div>

    <!-- Prizes -->
    <div class="card">
      <div class="card-head"><span class="card-title">Prizes</span><span style="font-size:10px;color:var(--gold)">$${hwPrizes.reduce((s,p) => s + (p.amount||0), 0).toLocaleString()} total</span></div>
      <div class="card-body" style="padding:10px 14px">
        <div style="display:grid;grid-template-columns:repeat(${hwPrizes.length || 3}, 1fr);gap:10px">
          ${hwPrizes.map(p => {
            const icons = {'Best Use of AI':'&#129302;','Highest Customer Impact':'&#128165;','Best Internal Tool / Most Useful DevTool':'&#128736;'};
            const icon = icons[p.category] || '&#127942;';
            return '<div style="padding:12px;border-radius:8px;background:var(--surface);border:1px solid var(--border);text-align:center"><div style="font-size:20px;margin-bottom:6px">' + icon + '</div><div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:4px">' + p.category + '</div><div style="font-size:16px;font-weight:800;color:var(--gold)">$' + (p.amount||0).toLocaleString() + '</div></div>';
          }).join('')}
        </div>
      </div>
    </div>
  </div>
```

- [ ] **Step 7: Replace the Reviews tab with the Archive tab**

Find the existing reviews tab (lines 5090-5097). Replace the entire `<div class="hw-hub-tab-pane" data-hw-pane="hw-reviews">...</div>` block with:

```javascript
  <!-- TAB: Archive -->
  <div class="hw-hub-tab-pane" data-hw-pane="hw-archive">
    ${hwLessons.length > 0 ? hwLessons.map(hw_past => {
      const notionLink = hw_past.hackWeek.includes('June 2025') ? hwPrevious.june2025Notion :
                         hw_past.hackWeek.includes('January 2026') ? hwPrevious.jan2026Notion : '';
      const sheetLink = hw_past.hackWeek.includes('January 2026') ? hwPrevious.jan2026Signup : '';
      return '<div class="card" style="margin-bottom:12px">' +
        '<div class="card-head"><span class="card-title">&#128218; ' + hw_past.hackWeek + '</span>' +
        '<div style="display:flex;gap:8px">' +
        (notionLink ? '<a href="' + notionLink + '" target="_blank" style="font-size:10px;color:var(--gold);text-decoration:none">Notion &#8599;</a>' : '') +
        (sheetLink ? '<a href="' + sheetLink + '" target="_blank" style="font-size:10px;color:var(--text-muted);text-decoration:none">Sheet &#8599;</a>' : '') +
        '</div></div>' +
        '<div class="card-body" style="padding:10px 14px">' +
        '<ul style="margin:0;padding-left:18px;font-size:11px;color:var(--text-dim);line-height:1.8">' +
        hw_past.lessons.map(l => '<li>' + l + '</li>').join('') +
        '</ul></div></div>';
    }).join('') : '<div class="card"><div class="card-body" style="padding:40px;text-align:center;color:var(--text-muted)"><div style="font-size:24px;margin-bottom:8px">&#128218;</div><div>No past hack weeks archived yet.</div></div></div>'}
  </div>
```

- [ ] **Step 8: Verify the dashboard HTML doesn't have syntax issues**

Run:
```bash
cd ~/sophie-dashboard && node -e "
const html = require('fs').readFileSync('dashboard.html', 'utf8');
// Check for unmatched template literals (basic check)
const backticks = (html.match(/\`/g) || []).length;
console.log('Backticks:', backticks, backticks % 2 === 0 ? '(even - OK)' : '(odd - PROBLEM)');
// Check for basic HTML structure
console.log('Has hw-overview pane:', html.includes('data-hw-pane=\"hw-overview\"'));
console.log('Has hw-judging pane:', html.includes('data-hw-pane=\"hw-judging\"'));
console.log('Has hw-archive pane:', html.includes('data-hw-pane=\"hw-archive\"'));
console.log('No old hw-current pane:', !html.includes('data-hw-pane=\"hw-current\"'));
console.log('No old hw-logistics pane:', !html.includes('data-hw-pane=\"hw-logistics\"'));
console.log('No old hw-reviews pane:', !html.includes('data-hw-pane=\"hw-reviews\"'));
"
```
Expected: All checks pass (even backticks, new panes exist, old panes removed).

- [ ] **Step 9: Commit**

```bash
git add dashboard.html
git commit -m "feat(hackweek): restructure hub with Overview/Schedule/Teams/Judging/Archive tabs

Add countdown badges to schedule, team formation rules, resource links,
judging rubric with scores table, prize cards, and past hack week archive."
```

---

### Task 5: Wire up the sidebar progress counter

**Files:**
- Modify: `dashboard.html` — update sidebar hack week progress display

The sidebar progress counter (line ~1587-1588) already works and doesn't need changes since the `DATA.hackWeek.phases` structure is unchanged. However, verify the tab switching still works for the renamed tabs.

- [ ] **Step 1: Verify the tab switching event handler works with new tab names**

The event handler at lines 3606-3618 uses `dataset.hwTab` and `data-hw-pane` dynamically — it doesn't hardcode tab names. Confirm by reading the handler. No code changes needed.

- [ ] **Step 2: End-to-end verification**

Run the server locally and verify all 5 tabs render:
```bash
cd ~/sophie-dashboard && timeout 5 node server.js 2>&1 || true
```

Check that the server starts without errors. Then test the API endpoint:
```bash
curl -s http://localhost:3000/api/hackweek | node -e "
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  const d = JSON.parse(Buffer.concat(chunks));
  console.log('Has rubric:', Array.isArray(d.rubric));
  console.log('Has resourceLinks:', Array.isArray(d.resourceLinks));
  console.log('Has scores:', Array.isArray(d.scores));
  console.log('Teams count:', (d.teams||[]).length);
  console.log('Rubric items:', (d.rubric||[]).length);
});
"
```
Expected: rubric=true, resourceLinks=true, scores=true, rubric items=3.

- [ ] **Step 3: Test the scores endpoint**

```bash
curl -s -X PATCH http://localhost:3000/api/hackweek/scores \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sophie-dashboard-secret-change-me" \
  -d '{"team":"Test Team","judge":"Shreyas","idea":8,"code":7,"demo":9}'
```
Expected: `{"ok":true,"scoresCount":1}`

Then clean up the test score:
```bash
cd ~/sophie-dashboard && node -e "
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('data/hackweek-data.json','utf8'));
d.scores = d.scores.filter(s => s.team !== 'Test Team');
fs.writeFileSync('data/hackweek-data.json', JSON.stringify(d, null, 2));
console.log('Cleaned up test score');
"
```

- [ ] **Step 4: Final commit (if any cleanup needed)**

```bash
git status
# If clean, no commit needed. If changes, stage and commit.
```
