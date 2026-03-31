# Offsite Logistics Everywhere — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the logistics system (hotel, venue, dinner, activity with status pipelines, research options, and email-derived state) work for ALL offsites — not just Q2 2026 — so every future offsite automatically gets the same treatment.

**Architecture:** Three changes: (1) the `/api/offsite/create` endpoint seeds full logistics structure with empty research arrays and status pipelines, (2) the monitor skill auto-detects which offsite is active and monitors it dynamically instead of hardcoding Q2, (3) the dashboard renders the logistics tab generically for any offsite without hardcoded dates.

**Tech Stack:** Node.js/Express server, vanilla JS dashboard, scheduled Cowork skill

---

## Current Problems

1. **`/api/offsite/create`** seeds logistics with bare `{confirmed:false}` objects — no `status`, `statusDetail`, `selectedOption`, research arrays, or budget categories
2. **Monitor skill** hardcodes Q2 2026: specific Notion page IDs, "april 20" search terms, calendar date ranges `2026-04-19 to 2026-04-22`
3. **Dashboard** hardcodes meal dates as "Mon 4/20" and "Tue 4/21", and `daysUntil` calculation uses hardcoded `new Date('2026-04-20')`
4. **Q3/Q4 placeholders** have empty `logistics: {}` — when activated, they won't have the research/status structure

---

### Task 1: Fix `/api/offsite/create` to seed full logistics structure

**Files:**
- Modify: `/tmp/sophie-dashboard/server.js:544`

- [ ] **Step 1: Update the newOffsite logistics object in the create endpoint**

Replace the bare logistics seed (line 544) with a full structure that includes status fields, research arrays, and budget categories:

```javascript
// In app.post('/api/offsite/create', ...) — replace the logistics line:
logistics: {
  hotel: { name: 'TBD', confirmed: false, status: 'Not Started', statusDetail: '', selectedOption: null, confirmationDetails: '', rate: null, nights: 2, rooms: null, roomsNote: '', contactPerson: 'Alice Zhao (travel agent, alice.zhao@fora.travel)' },
  venue: { name: 'TBD', address: '', confirmed: false, status: 'Not Started', statusDetail: '', selectedOption: null, confirmationDetails: '', capacity: '10+', estimatedCost: '' },
  dinner: { name: 'TBD', confirmed: false, status: 'Not Started', statusDetail: '', selectedOption: null, confirmationDetails: '', reservationDate: '', partySize: null, bookedVia: '', requirement: 'Strong vegetarian options + private dining' },
  activity: { name: 'TBD', confirmed: false, status: 'Not Started', statusDetail: '', selectedOption: null, confirmationDetails: '', lesson: 'Group activity + dinner is a proven combo. Escape room was a hit in Denver.' },
  hotelResearch: [],
  weworkResearch: [],
  dinnerResearch: [],
  activityResearch: [],
  meals: { day1Lunch: { link: '', notes: '' }, day2Lunch: { link: '', notes: '' } },
  budget: {
    estimated: null,
    approved: false,
    committed: 0,
    actual: 0,
    approver: 'Evelyn',
    categories: [
      { category: 'Hotel', estimated: null, committed: 0, actual: 0, notes: '' },
      { category: 'Venue', estimated: null, committed: 0, actual: 0, notes: '' },
      { category: 'Transportation', estimated: null, committed: 0, actual: 0, notes: '' },
      { category: 'Food & Beverage', estimated: null, committed: 0, actual: 0, notes: '' },
      { category: 'Social Activity', estimated: null, committed: 0, actual: 0, notes: '' },
      { category: 'Misc', estimated: null, committed: 0, actual: 0, notes: '' }
    ]
  },
  aliceCorrespondence: { threadSubject: '', lastEmailDate: '', summary: '', nextStep: '', keyEmails: [] },
  coordinationContacts: [
    { name: 'Alice Zhao', role: 'Travel agent (Fora Travel)', email: 'alice.zhao@fora.travel', reachOutFor: 'Hotel bookings, group rates, flight coordination' }
  ]
},
```

- [ ] **Step 2: Verify syntax**

Run: `node -c /tmp/sophie-dashboard/server.js`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd /tmp/sophie-dashboard && git add server.js && git commit -m "feat: seed full logistics structure when creating new offsites"
```

---

### Task 2: Backfill Q3/Q4 placeholders with logistics structure

**Files:**
- Modify: `/tmp/sophie-dashboard/data/offsite-data.json` (Q3 at ~line 1868, Q4 at ~line 1884)

- [ ] **Step 1: Replace empty logistics for Q3**

Find `"id": "2026-Q3"` and replace its `"logistics": {}` with:

```json
"logistics": {
  "hotel": { "name": "TBD", "confirmed": false, "status": "Not Started", "statusDetail": "", "selectedOption": null, "confirmationDetails": "", "rate": null, "nights": 2, "rooms": null, "contactPerson": "Alice Zhao (travel agent, alice.zhao@fora.travel)" },
  "venue": { "name": "TBD", "address": "", "confirmed": false, "status": "Not Started", "statusDetail": "", "selectedOption": null, "confirmationDetails": "" },
  "dinner": { "name": "TBD", "confirmed": false, "status": "Not Started", "statusDetail": "", "selectedOption": null, "confirmationDetails": "", "reservationDate": "", "partySize": null, "requirement": "Strong vegetarian options + private dining" },
  "activity": { "name": "TBD", "confirmed": false, "status": "Not Started", "statusDetail": "", "selectedOption": null, "confirmationDetails": "" },
  "hotelResearch": [],
  "weworkResearch": [],
  "dinnerResearch": [],
  "activityResearch": [],
  "meals": { "day1Lunch": { "link": "", "notes": "" }, "day2Lunch": { "link": "", "notes": "" } },
  "budget": { "estimated": null, "approved": false, "committed": 0, "actual": 0, "approver": "Evelyn", "categories": [
    { "category": "Hotel", "estimated": null, "committed": 0, "actual": 0, "notes": "" },
    { "category": "Venue", "estimated": null, "committed": 0, "actual": 0, "notes": "" },
    { "category": "Transportation", "estimated": null, "committed": 0, "actual": 0, "notes": "" },
    { "category": "Food & Beverage", "estimated": null, "committed": 0, "actual": 0, "notes": "" },
    { "category": "Social Activity", "estimated": null, "committed": 0, "actual": 0, "notes": "" },
    { "category": "Misc", "estimated": null, "committed": 0, "actual": 0, "notes": "" }
  ] },
  "aliceCorrespondence": { "threadSubject": "", "lastEmailDate": "", "summary": "", "nextStep": "", "keyEmails": [] },
  "coordinationContacts": [
    { "name": "Alice Zhao", "role": "Travel agent (Fora Travel)", "email": "alice.zhao@fora.travel", "reachOutFor": "Hotel bookings, group rates, flight coordination" }
  ]
}
```

- [ ] **Step 2: Do the same for Q4**

Same structure for `"id": "2026-Q4"`.

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('/tmp/sophie-dashboard/data/offsite-data.json','utf8')); console.log('JSON OK')"`

- [ ] **Step 4: Commit**

```bash
cd /tmp/sophie-dashboard && git add data/offsite-data.json && git commit -m "feat: backfill Q3/Q4 placeholders with full logistics structure"
```

---

### Task 3: Remove hardcoded dates from dashboard

**Files:**
- Modify: `/tmp/sophie-dashboard/dashboard.html`

- [ ] **Step 1: Fix the daysUntil calculation (~line 4038)**

Replace:
```javascript
var daysUntil = Math.ceil((new Date('2026-04-20') - new Date()) / 86400000);
```

With:
```javascript
var offsiteDates = OFFSITE.dates || '';
var daysUntil = 0;
if (offsiteDates && offsiteDates !== 'TBD') {
  try {
    var dateStr = offsiteDates.includes('202') ? offsiteDates : OFFSITE.year + ' ' + offsiteDates;
    daysUntil = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  } catch(e) {}
}
```

- [ ] **Step 2: Fix meal planning labels (~line 4364)**

Replace:
```javascript
'<div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:4px">Day 1 Lunch (Mon 4/20):</div>' +
```
and
```javascript
'<div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:4px">Day 2 Lunch (Tue 4/21):</div>' +
```

With dynamic labels that derive from offsite dates:
```javascript
// Before the meal card (add these lines):
var day1Label = 'Day 1';
var day2Label = 'Day 2';
if (offsiteDates && offsiteDates !== 'TBD') {
  try {
    var ds = offsiteDates.includes('202') ? offsiteDates : OFFSITE.year + ' ' + offsiteDates;
    var d1 = new Date(ds);
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    day1Label = 'Day 1 (' + days[d1.getDay()] + ' ' + (d1.getMonth()+1) + '/' + d1.getDate() + ')';
    var d2 = new Date(d1); d2.setDate(d2.getDate()+1);
    day2Label = 'Day 2 (' + days[d2.getDay()] + ' ' + (d2.getMonth()+1) + '/' + d2.getDate() + ')';
  } catch(e) {}
}
```

Then use `day1Label` and `day2Label` in the meal card HTML instead of the hardcoded strings.

- [ ] **Step 3: Verify JS syntax**

Run: `node -e "const fs=require('fs'); const h=fs.readFileSync('/tmp/sophie-dashboard/dashboard.html','utf8'); const m=h.match(/<script[^>]*>([\\s\\S]*?)<\\/script>/g); m.forEach((s,i)=>{try{new Function(s.replace(/<\\/?script[^>]*>/g,''))}catch(e){console.log('Block '+i+': '+e.message)}}); console.log('JS OK')"`

- [ ] **Step 4: Copy to dashboard-v2.html**

```bash
cp /tmp/sophie-dashboard/dashboard.html /tmp/sophie-dashboard/dashboard-v2.html
```

- [ ] **Step 5: Commit**

```bash
cd /tmp/sophie-dashboard && git add dashboard.html dashboard-v2.html && git commit -m "fix: remove hardcoded dates from dashboard logistics rendering"
```

---

### Task 4: Make monitor skill offsite-agnostic

**Files:**
- Modify: `/Users/sophieweiler/Documents/Claude/Scheduled/leadership-offsite-monitor/SKILL.md`

- [ ] **Step 1: Replace hardcoded offsite detection with dynamic logic**

At the top of the "What to Monitor" section, add a new section:

```markdown
## Step 0: Identify the Active Offsite

Before monitoring, determine WHICH offsite to track:

1. Fetch all offsites:
   ```
   GET https://sophie-dashboard-production.up.railway.app/api/offsite
   ```

2. Find the active offsite — the one with:
   - `status` = "Planning" (not "Complete" or "Placeholder")
   - If multiple are "Planning", pick the one with the nearest future date
   - If none are "Planning", pick the nearest "Placeholder" that has dates set

3. From the active offsite, extract:
   - `id` (e.g., "2026-Q2") — used for the API update endpoint
   - `dates` (e.g., "April 20-21, 2026") — used to calculate calendar search windows
   - `city` (e.g., "New York City") — used to determine who is local
   - `notionPageId` — used for checklist sync
   - `attendees` — used for travel checks

4. Compute travel search window from dates:
   - arrival day = first date minus 1 day
   - departure day = last date plus 1 day
   - Use these for `gcal_list_events` timeMin/timeMax

**All subsequent monitoring uses these dynamic values — never hardcode dates, cities, or Notion page IDs.**
```

- [ ] **Step 2: Replace hardcoded travel needs table**

Replace the static attendee table with:

```markdown
## Attendee Locations & Travel Logic

Each attendee has a home location stored in the offsite data. The server's `computeTravelNeeds()` function automatically determines who is local vs. needs travel based on comparing each attendee's `location` field to the offsite's `city`.

**The monitor does NOT need to compute travel needs** — the server does this automatically on every GET request. Instead, the monitor should:
- Check calendars for flight/hotel events matching the offsite dates
- Update `flightBooked`, `hotelConfirmed`, `travelCardIssued` when evidence is found
- Auto-mark ALL three fields as `true` for local attendees (the server handles this too via `computeTravelNeeds`, but the monitor should verify)
- Flag missing Marriott numbers regardless of location (Marriott numbers are personal, not event-dependent)
```

- [ ] **Step 3: Replace hardcoded Slack search**

Replace:
```
slack_search_public_and_private with query: "offsite OR leadership offsite OR april 20 OR agenda OR pre-read after:[yesterday]"
```

With:
```
slack_search_public_and_private with query: "offsite OR leadership offsite OR [OFFSITE_CITY] OR [OFFSITE_DATES_KEYWORD] OR agenda OR pre-read after:[yesterday]"
```

Where `[OFFSITE_CITY]` and `[OFFSITE_DATES_KEYWORD]` are derived from the active offsite's city and dates in Step 0.

- [ ] **Step 4: Replace hardcoded calendar checks**

Replace:
```
gcal_list_events for rishabh@fermatcommerce.com, timeMin: 2026-04-19, timeMax: 2026-04-22
gcal_list_events for shreyas@fermatcommerce.com, timeMin: 2026-04-19, timeMax: 2026-04-22
```

With:
```
For each non-local attendee in the active offsite:
  gcal_list_events for [attendee.email], timeMin: [arrival_day], timeMax: [departure_day]
```

Where arrival/departure days are computed from the offsite dates in Step 0.

- [ ] **Step 5: Replace hardcoded Notion page ID**

Replace:
```
notion-fetch with id: 3291ad76fd2a81ab8b67f63e59d54a43
```

With:
```
notion-fetch with id: [active_offsite.notionPageId]
```

Skip this step if `notionPageId` is null (placeholder offsites won't have one).

- [ ] **Step 6: Replace hardcoded staleness check endpoint**

Replace:
```
GET https://sophie-dashboard-production.up.railway.app/api/offsite/2026-Q2
```

With:
```
GET https://sophie-dashboard-production.up.railway.app/api/offsite/[active_offsite.id]
```

- [ ] **Step 7: Commit the skill**

No git commit needed — skill files are not in the dashboard repo. Just save.

---

### Task 5: Add `PATCH /api/offsite/:id/logistics` endpoint for targeted updates

**Files:**
- Modify: `/tmp/sophie-dashboard/server.js`

The monitor currently has to POST the entire offsite data blob. Add a targeted endpoint so it can update just one logistics category without overwriting everything else.

- [ ] **Step 1: Add the PATCH endpoint after the existing POST /api/offsite**

```javascript
// PATCH a single logistics category for an offsite
app.patch('/api/offsite/:id/logistics', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== (process.env.DASHBOARD_API_KEY || 'sophie-dashboard-secret-change-me')) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  try {
    const data = loadOffsiteData();
    let found = null;
    for (const year of Object.values(data.offsites)) {
      found = year.find(o => o.id === req.params.id);
      if (found) break;
    }
    if (!found) return res.status(404).json({ error: 'Offsite not found' });

    if (!found.logistics) found.logistics = {};

    // Merge each key from request body into logistics
    for (const [key, value] of Object.entries(req.body)) {
      if (typeof value === 'object' && !Array.isArray(value) && found.logistics[key] && typeof found.logistics[key] === 'object') {
        // Merge object fields (don't overwrite entire object)
        Object.assign(found.logistics[key], value);
      } else {
        found.logistics[key] = value;
      }
    }

    const dir = path.dirname(OFFSITE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OFFSITE_PATH, JSON.stringify({ ...data, lastSynced: new Date().toISOString() }, null, 2));
    res.json({ ok: true, updated: Object.keys(req.body) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

- [ ] **Step 2: Verify syntax**

Run: `node -c /tmp/sophie-dashboard/server.js`

- [ ] **Step 3: Commit**

```bash
cd /tmp/sophie-dashboard && git add server.js && git commit -m "feat: add PATCH endpoint for targeted logistics updates"
```

---

### Task 6: Update monitor skill to use PATCH endpoint

**Files:**
- Modify: `/Users/sophieweiler/Documents/Claude/Scheduled/leadership-offsite-monitor/SKILL.md`

- [ ] **Step 1: Replace the POST update instruction**

In the "How to Update" section, replace the single POST with targeted PATCH calls:

```markdown
## How to Update

After gathering all data, update ONLY the fields that changed using targeted PATCH calls:

**Update a single logistics category:**
```bash
curl -X PATCH "https://sophie-dashboard-production.up.railway.app/api/offsite/[OFFSITE_ID]/logistics" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sophie-dashboard-secret-change-me" \
  -d '{"hotel": {"status": "Booking", "statusDetail": "Alice is booking Moxy"}}'
```

**Update research arrays:**
```bash
curl -X PATCH "https://sophie-dashboard-production.up.railway.app/api/offsite/[OFFSITE_ID]/logistics" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sophie-dashboard-secret-change-me" \
  -d '{"dinnerResearch": [...]}'
```

**Update Alice correspondence:**
```bash
curl -X PATCH "https://sophie-dashboard-production.up.railway.app/api/offsite/[OFFSITE_ID]/logistics" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sophie-dashboard-secret-change-me" \
  -d '{"aliceCorrespondence": {"summary": "...", "nextStep": "...", "lastEmailDate": "..."}}'
```

This prevents race conditions and accidental data loss from overwriting the entire offsite blob.

**For non-logistics fields** (attendees, phases, themes), still use the full POST:
```bash
curl -X POST "https://sophie-dashboard-production.up.railway.app/api/offsite" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sophie-dashboard-secret-change-me" \
  -d '{...full offsite data...}'
```
```

- [ ] **Step 2: Save the skill file**

---

### Task 7: Push everything and deploy

**Files:**
- All modified files

- [ ] **Step 1: Final validation**

```bash
cd /tmp/sophie-dashboard
node -c server.js
node -e "JSON.parse(require('fs').readFileSync('data/offsite-data.json','utf8')); console.log('JSON OK')"
node -e "const fs=require('fs'); const h=fs.readFileSync('dashboard.html','utf8'); const m=h.match(/<script[^>]*>([\\s\\S]*?)<\\/script>/g); m.forEach((s,i)=>{try{new Function(s.replace(/<\\/?script[^>]*>/g,''))}catch(e){console.log('Block '+i+': '+e.message)}}); console.log('JS OK')"
```

- [ ] **Step 2: Push to deploy**

```bash
git push origin main
```

---

## Summary of Changes

| What | Before | After |
|------|--------|-------|
| New offsite logistics | Bare `{confirmed:false}` | Full structure with status, research arrays, budget categories |
| Q3/Q4 placeholders | Empty `{}` | Full logistics structure ready to use |
| Dashboard dates | Hardcoded "Mon 4/20", "Tue 4/21" | Derived from offsite dates dynamically |
| Monitor targets | Hardcoded Q2 2026 | Auto-detects active offsite |
| Monitor calendar | Hardcoded Apr 19-22 | Computed from offsite dates |
| Monitor Notion | Hardcoded page ID | Uses offsite's notionPageId |
| Monitor Slack | Hardcoded "april 20" | Uses offsite city + dates |
| Update mechanism | Full POST (entire data blob) | Targeted PATCH per category |
