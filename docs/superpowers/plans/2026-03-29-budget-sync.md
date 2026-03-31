# Budget Auto-Fill + Notion + Google Sheet Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-fill budget estimates from existing research data, sync budget to Notion, and create a Google Sheet with estimated costs that stays in sync with the dashboard — for all offsites.

**Architecture:** (1) Server-side function computes estimated costs from research data (hotel rate × rooms × nights, venue cost, etc.), (2) Notion budget table syncs bidirectionally, (3) Google Sheet created per offsite with estimated column that auto-updates via server API, (4) Dashboard budget tile shows correct computed totals and remains editable.

**Tech Stack:** Node.js/Express, Google Sheets API (googleapis), Notion API (@notionhq/client)

---

## Current State

**Q2 2026 budget data:**
- `budget.estimated`: `null` (top-level) — dashboard falls back to hardcoded `$13,500`
- All 6 category `estimated` values: `null`
- But research data EXISTS with real numbers:
  - Hotel: `rate: 420`, `rooms: 6`, `nights: 2` → $5,040
  - Venue: `estimatedCost: "$1,500-2,000"` → ~$1,750
  - Transportation: "People arrange own flights" → $0 (company doesn't cover)
  - Food & Beverage: DoorDash x2 days + dinner → ~$1,500-2,000
  - Activity: escape room ~$360-450, cooking ~$675-1,125 → ~$500 mid-range
  - Misc: buffer → ~$500

**The hardcoded `|| 13500` fallback on line 4061 is wrong** — should compute from categories or show $0.

---

### Task 1: Auto-fill budget estimates from research data

**Files:**
- Modify: `/tmp/sophie-dashboard/server.js`

Add a function `computeBudgetEstimates(offsite)` that derives estimated costs from the offsite's existing logistics and research data. This runs on GET requests and when creating new offsites, but NEVER overwrites a manually-set estimate.

- [ ] **Step 1: Add computeBudgetEstimates function after computeTravelNeeds**

```javascript
function computeBudgetEstimates(offsite) {
  if (!offsite || !offsite.logistics) return;
  var l = offsite.logistics;
  var budget = l.budget;
  if (!budget || !budget.categories) return;

  budget.categories.forEach(function(cat) {
    // Only auto-fill if estimated is null (never overwrite manual edits)
    if (cat.estimated !== null) return;

    var est = null;
    switch (cat.category) {
      case 'Hotel':
        if (l.hotel && l.hotel.rate && l.hotel.rooms && l.hotel.nights) {
          est = l.hotel.rate * l.hotel.rooms * l.hotel.nights;
        } else if (l.hotel && l.hotel.rate && l.hotel.nights) {
          // If rooms not set yet, estimate from attendees minus locals
          var locals = (offsite.attendees || []).filter(function(a) { return a.needsHotel === false; }).length;
          var roomsNeeded = (offsite.attendees || []).length - locals;
          if (roomsNeeded > 0) est = l.hotel.rate * roomsNeeded * l.hotel.nights;
        }
        break;
      case 'Venue':
      case 'Venue / Coworking':
        if (l.venue && l.venue.estimatedCost) {
          // Parse "$1,500-2,000" → take midpoint
          var costStr = l.venue.estimatedCost.replace(/[$,]/g, '');
          var parts = costStr.split('-').map(Number).filter(function(n) { return !isNaN(n); });
          if (parts.length === 2) est = Math.round((parts[0] + parts[1]) / 2);
          else if (parts.length === 1) est = parts[0];
        }
        break;
      case 'Transportation':
        // Default to 0 — people arrange own flights unless data says otherwise
        est = 0;
        break;
      case 'Food & Beverage':
        // Estimate: DoorDash $25/person x attendees x 2 days + dinner $75/person
        var numAttendees = (offsite.attendees || []).length || 9;
        est = (25 * numAttendees * 2) + (75 * numAttendees);
        break;
      case 'Social Activity':
        if (l.activityResearch && l.activityResearch.length > 0) {
          // Use the selected activity's cost, or average of options
          var selected = l.activityResearch.find(function(a) { return a.selected; });
          if (selected && selected.estimatedCost) {
            var match = selected.estimatedCost.match(/\$[\d,]+-[\d,]+\s+total/i) || selected.estimatedCost.match(/\$([\d,]+)/);
            if (match) {
              var nums = selected.estimatedCost.match(/\d[\d,]*/g).map(function(n) { return parseInt(n.replace(/,/g,'')); });
              est = nums.length >= 2 ? Math.round((nums[nums.length-2] + nums[nums.length-1]) / 2) : nums[0];
            }
          } else {
            // Average across all options
            var totals = [];
            l.activityResearch.forEach(function(a) {
              if (a.estimatedCost) {
                var nums = a.estimatedCost.match(/\d[\d,]*/g);
                if (nums) {
                  var parsed = nums.map(function(n) { return parseInt(n.replace(/,/g,'')); });
                  totals.push(parsed[parsed.length-1]); // take the higher bound
                }
              }
            });
            if (totals.length > 0) est = Math.round(totals.reduce(function(a,b){return a+b;},0) / totals.length);
          }
        }
        break;
      case 'Miscellaneous':
      case 'Misc':
        est = 500; // default buffer
        break;
    }

    if (est !== null) {
      cat.autoEstimated = est;  // Store auto-computed value separately
      cat.estimated = est;       // Fill in the estimate
    }
  });

  // Compute top-level total from categories
  var total = budget.categories.reduce(function(sum, c) { return sum + (c.estimated || 0); }, 0);
  if (budget.estimated === null || budget.estimated === 0) {
    budget.estimated = total;
  }
}
```

- [ ] **Step 2: Call computeBudgetEstimates in GET /api/offsite**

In the GET handler, after `computeTravelNeeds(o)`, add `computeBudgetEstimates(o)`:

```javascript
// After: computeTravelNeeds(o);
computeBudgetEstimates(o);
```

- [ ] **Step 3: Call it in the create endpoint too**

After the new offsite is constructed in POST /api/offsite/create, call `computeBudgetEstimates(newOffsite)` before saving.

- [ ] **Step 4: Verify syntax**

Run: `node -c /tmp/sophie-dashboard/server.js`

- [ ] **Step 5: Commit**

```bash
cd /tmp/sophie-dashboard && git add server.js && git commit -m "feat: auto-fill budget estimates from research data"
```

---

### Task 2: Fix the hardcoded $13,500 fallback in dashboard

**Files:**
- Modify: `/tmp/sophie-dashboard/dashboard.html`

- [ ] **Step 1: Remove the `|| 13500` fallback on line 4061**

Replace:
```javascript
var budgetEstimate = budgetCategories.reduce(function(s,c) { return s + (c.estimated || 0); }, 0) || 13500;
```

With:
```javascript
var budgetEstimate = budgetCategories.reduce(function(s,c) { return s + (c.estimated || 0); }, 0);
```

The server now computes estimates from research data — no need for a hardcoded fallback.

- [ ] **Step 2: Also update the overview budget bar (line 3443-3444)**

These already use `budget.estimated` which will now be correct from the server. No change needed — just verify they work with the new data.

- [ ] **Step 3: Show "(auto-estimated)" label when a category has autoEstimated set**

In the budget table rows (line 4403-4411), add a subtle indicator when a value was auto-computed:

Find the budget row rendering and after the estimated input, add:
```javascript
(c.autoEstimated && c.estimated === c.autoEstimated ? ' <span style="font-size:9px;color:var(--text-muted)">(auto)</span>' : '')
```

- [ ] **Step 4: Verify JS syntax and copy to dashboard-v2.html**

- [ ] **Step 5: Commit**

```bash
cd /tmp/sophie-dashboard && git add dashboard.html dashboard-v2.html && git commit -m "fix: remove hardcoded budget fallback, show auto-estimated labels"
```

---

### Task 3: Auto-fill Q2 budget categories with real numbers

**Files:**
- Modify: `/tmp/sophie-dashboard/data/offsite-data.json`

The server's `computeBudgetEstimates` will auto-fill on GET, but we should also seed the Q2 data with correct numbers so the data file is accurate.

- [ ] **Step 1: Update Q2 budget categories with computed estimates**

Based on the existing research data:

| Category | Calculation | Estimated |
|----------|------------|-----------|
| Hotel | $420/room × 6 rooms × 2 nights | $5,040 |
| Venue / Coworking | midpoint of $1,500-$2,000 | $1,750 |
| Transportation | People arrange own | $0 |
| Food & Beverage | DoorDash ($25×9×2) + dinner ($75×9) | $1,125 |
| Social Activity | Escape room midpoint ($360-$450) | $405 |
| Miscellaneous | Buffer | $500 |
| **Total** | | **$8,820** |

Update each category's `"estimated"` field. Set `"autoEstimated"` to the same value so the dashboard shows "(auto)" label. Keep `committed` and `actual` as `null`.

- [ ] **Step 2: Update the top-level budget.estimated**

Set `"estimated": 8820`.

- [ ] **Step 3: Validate JSON**

- [ ] **Step 4: Commit**

```bash
cd /tmp/sophie-dashboard && git add data/offsite-data.json && git commit -m "feat: seed Q2 budget with auto-computed estimates from research"
```

---

### Task 4: Create Notion budget table

**Files:**
- Modify: `/tmp/sophie-dashboard/server.js` (add sync endpoint)

Create a Notion database under the offsite page that stores budget categories. The monitor skill will sync this bidirectionally.

- [ ] **Step 1: Add POST /api/offsite/:id/budget/notion-sync endpoint**

```javascript
app.post('/api/offsite/:id/budget/notion-sync', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== (process.env.DASHBOARD_API_KEY || 'sophie-dashboard-secret-change-me')) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  try {
    const data = loadOffsiteData();
    let offsite = null;
    for (const year of Object.values(data.offsites)) {
      offsite = year.find(o => o.id === req.params.id);
      if (offsite) break;
    }
    if (!offsite) return res.status(404).json({ error: 'Offsite not found' });
    if (!offsite.notionPageId) return res.status(400).json({ error: 'No Notion page for this offsite' });

    const budget = offsite.logistics && offsite.logistics.budget;
    if (!budget || !budget.categories) return res.status(400).json({ error: 'No budget data' });

    // Check if budget database already exists
    let dbId = offsite.notionBudgetDbId;

    if (!dbId) {
      // Create a new database under the offsite page
      const db = await notion.databases.create({
        parent: { page_id: offsite.notionPageId },
        title: [{ text: { content: offsite.name + ' — Budget' } }],
        properties: {
          'Category': { title: {} },
          'Estimated': { number: { format: 'dollar' } },
          'Committed': { number: { format: 'dollar' } },
          'Actual': { number: { format: 'dollar' } },
          'Notes': { rich_text: {} },
          'Status': { select: { options: [
            { name: 'Not Started', color: 'gray' },
            { name: 'Researching', color: 'yellow' },
            { name: 'Booked', color: 'blue' },
            { name: 'Confirmed', color: 'green' }
          ]}}
        }
      });
      dbId = db.id;
      offsite.notionBudgetDbId = dbId;
    }

    // Upsert each category as a row
    for (const cat of budget.categories) {
      // Search for existing row
      const existing = await notion.databases.query({
        database_id: dbId,
        filter: { property: 'Category', title: { equals: cat.category } }
      });

      const props = {
        'Category': { title: [{ text: { content: cat.category } }] },
        'Estimated': { number: cat.estimated || 0 },
        'Committed': { number: cat.committed || 0 },
        'Actual': { number: cat.actual || 0 },
        'Notes': { rich_text: [{ text: { content: cat.notes || '' } }] }
      };

      if (existing.results.length > 0) {
        await notion.pages.update({ page_id: existing.results[0].id, properties: props });
      } else {
        await notion.pages.create({ parent: { database_id: dbId }, properties: props });
      }
    }

    // Save the dbId back
    fs.writeFileSync(OFFSITE_PATH, JSON.stringify({ ...data, lastSynced: new Date().toISOString() }, null, 2));
    res.json({ ok: true, notionBudgetDbId: dbId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

- [ ] **Step 2: Add GET endpoint to pull budget FROM Notion back to dashboard**

```javascript
app.get('/api/offsite/:id/budget/notion-sync', async (req, res) => {
  try {
    const data = loadOffsiteData();
    let offsite = null;
    for (const year of Object.values(data.offsites)) {
      offsite = year.find(o => o.id === req.params.id);
      if (offsite) break;
    }
    if (!offsite) return res.status(404).json({ error: 'Offsite not found' });
    if (!offsite.notionBudgetDbId) return res.status(400).json({ error: 'No Notion budget database' });

    const results = await notion.databases.query({ database_id: offsite.notionBudgetDbId });
    const budget = offsite.logistics && offsite.logistics.budget;
    if (!budget || !budget.categories) return res.status(400).json({ error: 'No budget data' });

    let updated = false;
    for (const row of results.results) {
      const catName = row.properties['Category'].title[0]?.text?.content;
      const cat = budget.categories.find(c => c.category === catName);
      if (!cat) continue;

      const notionEst = row.properties['Estimated'].number;
      const notionComm = row.properties['Committed'].number;
      const notionAct = row.properties['Actual'].number;
      const notionNotes = row.properties['Notes'].rich_text[0]?.text?.content || '';

      // Notion wins for committed and actual (Evelyn edits there)
      // Dashboard wins for estimated (auto-computed)
      if (notionComm !== null && notionComm !== cat.committed) { cat.committed = notionComm; updated = true; }
      if (notionAct !== null && notionAct !== cat.actual) { cat.actual = notionAct; updated = true; }
      if (notionNotes && notionNotes !== cat.notes) { cat.notes = notionNotes; updated = true; }
    }

    if (updated) {
      budget.committed = budget.categories.reduce((s,c) => s + (c.committed || 0), 0);
      budget.actual = budget.categories.reduce((s,c) => s + (c.actual || 0), 0);
      fs.writeFileSync(OFFSITE_PATH, JSON.stringify({ ...data, lastSynced: new Date().toISOString() }, null, 2));
    }

    res.json({ ok: true, updated, budget });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

- [ ] **Step 3: Verify syntax**

- [ ] **Step 4: Commit**

```bash
cd /tmp/sophie-dashboard && git add server.js && git commit -m "feat: add Notion budget table sync endpoints"
```

---

### Task 5: Create Google Sheet with estimated costs

**Files:**
- Modify: `/tmp/sophie-dashboard/server.js`
- Modify: `/tmp/sophie-dashboard/package.json` (add googleapis dependency)

- [ ] **Step 1: Install googleapis**

```bash
cd /tmp/sophie-dashboard && npm install googleapis
```

- [ ] **Step 2: Add Google Sheets helper at the top of server.js**

```javascript
const { google } = require('googleapis');

function getGoogleAuth() {
  // Uses service account or OAuth token from environment
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    return new google.auth.JWT(key.client_email, null, key.private_key, [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file'
    ]);
  }
  return null;
}
```

- [ ] **Step 3: Add POST /api/offsite/:id/budget/sheet-sync endpoint**

```javascript
app.post('/api/offsite/:id/budget/sheet-sync', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== (process.env.DASHBOARD_API_KEY || 'sophie-dashboard-secret-change-me')) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  try {
    const auth = getGoogleAuth();
    if (!auth) return res.status(400).json({ error: 'Google Sheets not configured (set GOOGLE_SERVICE_ACCOUNT_KEY)' });

    const data = loadOffsiteData();
    let offsite = null;
    for (const year of Object.values(data.offsites)) {
      offsite = year.find(o => o.id === req.params.id);
      if (offsite) break;
    }
    if (!offsite) return res.status(404).json({ error: 'Offsite not found' });

    const budget = offsite.logistics && offsite.logistics.budget;
    if (!budget || !budget.categories) return res.status(400).json({ error: 'No budget data' });

    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });
    let spreadsheetId = offsite.budgetSheetId;

    if (!spreadsheetId) {
      // Create new spreadsheet
      const spreadsheet = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: offsite.name + ' — Budget Estimates' },
          sheets: [{ properties: { title: 'Budget' } }]
        }
      });
      spreadsheetId = spreadsheet.data.spreadsheetId;
      offsite.budgetSheetId = spreadsheetId;

      // Share with Evelyn
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: { type: 'user', role: 'writer', emailAddress: 'evelyn@fermatcommerce.com' }
      });
      // Share with Sophie
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: { type: 'user', role: 'writer', emailAddress: 'sophie@fermatcommerce.com' }
      });
    }

    // Build the data: Header + category rows + total row
    const values = [
      ['Category', 'Estimated Cost', 'Notes', 'Source'],
      ...budget.categories.map(c => [
        c.category,
        c.estimated || 0,
        c.notes || '',
        c.autoEstimated ? 'Auto-computed from research' : 'Manual'
      ]),
      [],
      ['TOTAL', budget.estimated || budget.categories.reduce((s,c) => s + (c.estimated||0), 0), '', ''],
      [],
      ['Offsite', offsite.name, '', ''],
      ['Dates', offsite.dates, '', ''],
      ['City', offsite.city, '', ''],
      ['Approver', budget.approver || 'Evelyn', '', ''],
      ['Status', budget.approved ? 'Approved' : 'Pending Approval', '', ''],
      [],
      ['Last synced', new Date().toISOString(), '', '']
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Budget!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values }
    });

    // Format: bold header, currency format on column B
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          { repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 } } },
            fields: 'userEnteredFormat(textFormat,backgroundColor)'
          }},
          { repeatCell: {
            range: { sheetId: 0, startColumnIndex: 1, endColumnIndex: 2, startRowIndex: 1, endRowIndex: budget.categories.length + 2 },
            cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '$#,##0' } } },
            fields: 'userEnteredFormat.numberFormat'
          }}
        ]
      }
    });

    // Save sheet ID back
    fs.writeFileSync(OFFSITE_PATH, JSON.stringify({ ...data, lastSynced: new Date().toISOString() }, null, 2));
    res.json({ ok: true, spreadsheetId, url: 'https://docs.google.com/spreadsheets/d/' + spreadsheetId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

- [ ] **Step 4: Verify syntax**

- [ ] **Step 5: Commit**

```bash
cd /tmp/sophie-dashboard && git add server.js package.json package-lock.json && git commit -m "feat: add Google Sheet budget sync with auto-share to Evelyn"
```

---

### Task 6: Add budget sync to the monitor skill

**Files:**
- Modify: `/Users/sophieweiler/Documents/Claude/Scheduled/leadership-offsite-monitor/SKILL.md`

- [ ] **Step 1: Add a new section "6. Budget Sync" at the end of "What to Monitor"**

```markdown
### 6. Budget Sync

After updating all logistics data, sync the budget to keep Notion and Google Sheet current:

**Step 1: Push budget to Notion**
```bash
curl -X POST "https://sophie-dashboard-production.up.railway.app/api/offsite/[OFFSITE_ID]/budget/notion-sync" \
  -H "Authorization: Bearer sophie-dashboard-secret-change-me"
```

**Step 2: Pull any changes FROM Notion back** (Evelyn may have updated committed/actual in Notion)
```bash
curl -X GET "https://sophie-dashboard-production.up.railway.app/api/offsite/[OFFSITE_ID]/budget/notion-sync"
```

**Step 3: Sync estimated costs to Google Sheet**
```bash
curl -X POST "https://sophie-dashboard-production.up.railway.app/api/offsite/[OFFSITE_ID]/budget/sheet-sync" \
  -H "Authorization: Bearer sophie-dashboard-secret-change-me"
```

This keeps all three in sync: Dashboard ↔ Notion ↔ Google Sheet.

**Sync rules:**
- Dashboard is source of truth for `estimated` (auto-computed from research)
- Notion is source of truth for `committed` and `actual` (Evelyn edits there)
- Google Sheet receives `estimated` only (for sharing with Evelyn for approval)
- If Evelyn edits estimated in Notion, that manual edit takes precedence over auto-compute
```

- [ ] **Step 2: Save the skill file**

---

### Task 7: Add "Sync Budget" button to dashboard logistics tab

**Files:**
- Modify: `/tmp/sophie-dashboard/dashboard.html`

- [ ] **Step 1: Add a sync button below the budget table**

After the budget table rows, add:

```javascript
'<div style="margin-top:10px;display:flex;gap:8px;align-items:center">' +
  '<button onclick="syncBudgetToNotion()" style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:4px 10px;border-radius:4px;font-size:10px;cursor:pointer">Sync to Notion</button>' +
  '<button onclick="syncBudgetToSheet()" style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:4px 10px;border-radius:4px;font-size:10px;cursor:pointer">Sync to Google Sheet</button>' +
  (OFFSITE.budgetSheetId ? '<a href="https://docs.google.com/spreadsheets/d/' + OFFSITE.budgetSheetId + '" target="_blank" style="font-size:10px;color:var(--blue);text-decoration:underline">Open Sheet</a>' : '') +
'</div>'
```

- [ ] **Step 2: Add the sync functions**

```javascript
function syncBudgetToNotion() {
  var offsiteId = DATA.activeOffsiteId || '2026-Q2';
  fetch('/api/offsite/' + offsiteId + '/budget/notion-sync', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer sophie-dashboard-secret-change-me' }
  }).then(function(r) { return r.json(); })
    .then(function(d) { if (d.ok) alert('Budget synced to Notion!'); else alert('Error: ' + d.error); });
}

function syncBudgetToSheet() {
  var offsiteId = DATA.activeOffsiteId || '2026-Q2';
  fetch('/api/offsite/' + offsiteId + '/budget/sheet-sync', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer sophie-dashboard-secret-change-me' }
  }).then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.ok) {
        alert('Budget synced to Google Sheet!');
        if (d.url) window.open(d.url, '_blank');
      } else alert('Error: ' + d.error);
    });
}
```

- [ ] **Step 3: Verify JS syntax, copy to dashboard-v2.html**

- [ ] **Step 4: Commit**

```bash
cd /tmp/sophie-dashboard && git add dashboard.html dashboard-v2.html && git commit -m "feat: add budget sync buttons for Notion and Google Sheet"
```

---

### Task 8: Final validation and deploy

- [ ] **Step 1: Validate all files**

```bash
cd /tmp/sophie-dashboard
node -c server.js
node -e "JSON.parse(require('fs').readFileSync('data/offsite-data.json','utf8')); console.log('JSON OK')"
# Verify dashboard JS
```

- [ ] **Step 2: Verify Q2 data integrity**

```bash
node -e "
const d=JSON.parse(require('fs').readFileSync('data/offsite-data.json','utf8'));
const q2=d.offsites['2026'].find(o=>o.id==='2026-Q2');
console.log('Q2 budget estimated:', q2.logistics.budget.estimated);
console.log('Q2 hotel:', q2.logistics.hotel.name);
console.log('Q2 dinner:', q2.logistics.dinner.name);
console.log('Q2 venue:', q2.logistics.venue.name);
console.log('Q2 attendees:', q2.attendees.length);
"
```

- [ ] **Step 3: Push and deploy**

```bash
git push origin main
```

---

## Sync Architecture

```
Dashboard (editable budget table)
    ↕ auto-compute estimates from research
    ↕ PATCH /api/offsite/:id/logistics
    ↓
Server (offsite-data.json)
    ↕ POST /api/offsite/:id/budget/notion-sync
    ↓
Notion (budget database under offsite page)
    ← Evelyn edits committed/actual here
    → GET /api/offsite/:id/budget/notion-sync pulls changes back
    ↓
Google Sheet (estimated costs only)
    ← POST /api/offsite/:id/budget/sheet-sync
    → Shared with Evelyn for budget approval
```

**Who owns what:**
- `estimated` → Dashboard/server auto-computes from research, editable by Sophie
- `committed` → Notion (Evelyn updates as bookings are made)
- `actual` → Notion (Evelyn updates as invoices come in)
- Google Sheet → READ-ONLY sync of estimated, for Evelyn's review

## Applied to All Events

- Task 1 (computeBudgetEstimates) runs on every GET, so all offsites benefit
- Task 4 (Notion sync) uses `:id` parameter, works for any offsite
- Task 5 (Google Sheet) uses `:id` parameter, creates separate sheet per offsite
- Task 6 (monitor skill) syncs budget for whichever offsite is active
- Q3/Q4 already have budget.categories from the backfill — estimates will auto-fill when research data is added
