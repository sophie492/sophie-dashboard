# Smart Attendance + Auto Budget Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `attending` field to attendees that cascades into room counts, budget estimates, and dinner party sizes. Set up a shared Google Drive folder for offsite budget sheets. Auto-sync budget on every edit + monitor run.

**Architecture:** (1) Add `attending` boolean to every attendee, default Khushy to false, (2) All computed values (rooms, budget, party size) filter by `attending === true`, (3) One Google Drive folder "Leadership Offsites" with per-quarter sheets, (4) Budget syncs on dashboard edit AND monitor runs.

**Tech Stack:** Node.js/Express, Google Sheets/Drive API, vanilla JS dashboard

---

## Current Problems

1. **No `attending` field** — everyone is assumed attending, but Khushy rarely attends
2. **Room count wrong** — shows 6 (old) or 5 (after Isabel fix) but should be 4 (Khushy not attending)
3. **Budget uses all 9 attendees** — F&B estimate counts all 9 for DoorDash + dinner
4. **Dinner party size** — shows 8 in data, should auto-compute from attending count
5. **No auto-sync** — budget only syncs when you click a button
6. **No shared folder** — sheets would be scattered in Drive

---

### Task 1: Add `attending` field to data

**Files:**
- Modify: `/tmp/sophie-dashboard/data/offsite-data.json`

- [ ] **Step 1: Add `attending` to defaultRoster**

For each person in `defaultRoster`, add `"attending": true` — except Khushy who gets `"attending": false`.

Also fix Isabel's `needsHotel`/`needsFlight` in the roster to `false` (she's NYC, `computeTravelNeeds` fixes this at runtime but the roster data should be correct).

- [ ] **Step 2: Add `attending` to Q2 attendees**

For each attendee in `offsites.2026[Q2].attendees`, add `"attending": true` except Khushy who gets `"attending": false`.

- [ ] **Step 3: Validate JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('data/offsite-data.json','utf8')); console.log('OK')"
```

- [ ] **Step 4: Commit**

```bash
git add data/offsite-data.json && git commit -m "feat: add attending field to all attendees, Khushy defaults false"
```

---

### Task 2: Update `computeTravelNeeds` and `computeBudgetEstimates` to filter by attending

**Files:**
- Modify: `/tmp/sophie-dashboard/server.js`

- [ ] **Step 1: Update computeTravelNeeds to skip non-attending**

In `computeTravelNeeds`, at the end where rooms are counted (line ~478):

Replace:
```javascript
const roomsNeeded = offsite.attendees.filter(a => a.needsHotel).length;
```

With:
```javascript
const roomsNeeded = offsite.attendees.filter(a => a.attending !== false && a.needsHotel).length;
```

- [ ] **Step 2: Update computeBudgetEstimates to use attending count**

In `computeBudgetEstimates`, the Hotel case uses rooms. Update the fallback room computation:

Replace:
```javascript
var locals = (offsite.attendees || []).filter(function(a) { return a.needsHotel === false; }).length;
var roomsNeeded = (offsite.attendees || []).length - locals;
```

With:
```javascript
var attending = (offsite.attendees || []).filter(function(a) { return a.attending !== false; });
var locals = attending.filter(function(a) { return a.needsHotel === false; }).length;
var roomsNeeded = attending.length - locals;
```

And for the F&B case, replace:
```javascript
var numAttendees = (offsite.attendees || []).length || 9;
```

With:
```javascript
var numAttendees = (offsite.attendees || []).filter(function(a) { return a.attending !== false; }).length || 9;
```

- [ ] **Step 3: Update hotel.rooms to use attending count in computeTravelNeeds**

After `roomsNeeded` is computed, also set `offsite.logistics.hotel.rooms = roomsNeeded;` so the data stays correct.

- [ ] **Step 4: Add a computed `attendingCount` to the offsite response**

At the end of `computeTravelNeeds`, add:
```javascript
offsite.attendingCount = (offsite.attendees || []).filter(a => a.attending !== false).length;
```

This lets the dashboard use the count without recomputing.

- [ ] **Step 5: Verify syntax**

```bash
node -c server.js
```

- [ ] **Step 6: Commit**

```bash
git add server.js && git commit -m "feat: all computed values filter by attending field"
```

---

### Task 3: Update offsite create endpoint to respect attending defaults

**Files:**
- Modify: `/tmp/sophie-dashboard/server.js`

- [ ] **Step 1: In POST /api/offsite/create, after cloning defaultRoster, set attending**

Find the line:
```javascript
attendees: JSON.parse(JSON.stringify(data.defaultRoster || [])),
```

After this line, the `newOffsite.attendees` will already have the `attending` field from the roster. No change needed IF the roster has it. Since Task 1 adds it to the roster, this is already handled.

But verify: if `data.defaultRoster` has `attending` on each person, it carries through. Confirm by reading the create code. No code change needed for this step — just verification.

- [ ] **Step 2: Commit** (skip if no changes)

---

### Task 4: Update dashboard attendees tab with attending toggle

**Files:**
- Modify: `/tmp/sophie-dashboard/dashboard.html`

- [ ] **Step 1: Add "Attending" column to the attendees table**

Add a new first column after the name column. Find the attendee table header (around line 4257):

```javascript
'<th style="padding:8px;text-align:left">Name</th>' +
```

Add after it:
```javascript
'<th style="padding:8px;text-align:center">Attending</th>' +
```

- [ ] **Step 2: Add attending toggle to each row**

In the attendeeRows map function, add a cell before the Marriott column:

```javascript
'<td style="padding:6px 8px;text-align:center">' +
  '<button class="offsite-status-toggle" onclick="toggleAttendeeStatus(\'' + a.name.replace(/'/g, "\\'") + '\',\'attending\')" style="background:' + (a.attending !== false ? 'var(--green-soft)' : 'var(--red-soft)') + ';color:' + (a.attending !== false ? 'var(--green)' : 'var(--red)') + ';border:1px solid ' + (a.attending !== false ? 'var(--green)' : 'var(--red)') + ';padding:2px 8px;border-radius:4px;font-size:10px;cursor:pointer;font-family:inherit">' + (a.attending !== false ? '✓ Yes' : '✗ No') + '</button>' +
'</td>' +
```

- [ ] **Step 3: Update the summary line to show attending count**

Replace the `travelers` and `confirmed` counting to filter by attending:

```javascript
var attendingList = attendees.filter(function(a) { return a.attending !== false; });
var travelers = attendingList.filter(function(a) { return a.needsHotel !== false; });
var confirmed = travelers.filter(function(a) { return a.hotelConfirmed && a.flightBooked; }).length;
var locals = attendingList.filter(function(a) { return a.needsHotel === false || a.needsFlight === false; }).length;
var notAttending = attendees.length - attendingList.length;
```

Update the summary text:
```javascript
attendingList.length + '/' + attendees.length + ' attending' +
(notAttending > 0 ? ' <span style="font-size:10px;color:var(--text-muted)">(' + notAttending + ' not attending)</span>' : '') +
' &middot; ' + confirmed + '/' + travelers.length + ' travelers confirmed' +
(locals > 0 ? ' <span style="font-size:10px;color:var(--text-muted)">(' + locals + ' local)</span>' : '')
```

- [ ] **Step 4: Grey out non-attending rows**

In the attendeeRows map, wrap the `<tr>` with a conditional opacity:

```javascript
'<tr style="border-bottom:1px solid var(--border);font-size:11px;' + (a.attending === false ? 'opacity:0.4' : '') + '">' +
```

- [ ] **Step 5: Verify JS syntax, copy to dashboard-v2.html**

- [ ] **Step 6: Commit**

```bash
git add dashboard.html dashboard-v2.html && git commit -m "feat: add attending toggle to attendees tab, grey out non-attending"
```

---

### Task 5: Update Q2 budget estimates to use correct attending count

**Files:**
- Modify: `/tmp/sophie-dashboard/data/offsite-data.json`

After Tasks 1-2, the server will auto-recompute on GET. But we should also fix the static data so it's correct at rest.

- [ ] **Step 1: Update Q2 hotel budget**

With 4 non-local attending (Rishabh, Shreyas, Saunder, Bharat): $420 × 4 × 2 = **$3,360**

Update the Hotel category:
```json
{ "category": "Hotel", "estimated": 3360, "autoEstimated": 3360, "notes": "4 rooms x 2 nights x $420/room (Moxy NYC Chelsea)" }
```

- [ ] **Step 2: Update hotel.rooms**

Set `"rooms": 4` in `logistics.hotel`.

- [ ] **Step 3: Update F&B estimate**

With 8 attending: $25 × 8 × 2 + $75 × 8 = **$1,000**

Update F&B category:
```json
{ "category": "Food & Beverage", "estimated": 1000, "autoEstimated": 1000, "notes": "DoorDash $25/person x 8 x 2 days + dinner $75/person x 8" }
```

- [ ] **Step 4: Update dinner party size**

Set `"partySize": 8` in `logistics.dinner` (was 8 already, but the note said it might need updating).

- [ ] **Step 5: Update top-level budget.estimated**

$3,360 + $1,750 + $0 + $1,000 + $405 + $500 = **$7,015**

- [ ] **Step 6: Update hotel.roomsNote**

Set `"roomsNote": "4 rooms — Khushy not attending, 4 NYC locals (Evelyn, Jess, Isabel, Jennifer)"`.

- [ ] **Step 7: Validate JSON, commit**

```bash
git add data/offsite-data.json && git commit -m "fix: budget reflects 8 attending (Khushy not attending), 4 hotel rooms"
```

---

### Task 6: Set up shared Google Drive folder

**Files:**
- Modify: `/tmp/sophie-dashboard/server.js`

- [ ] **Step 1: Update the sheet-sync endpoint to create/use a shared folder**

Find the `app.post('/api/offsite/:id/budget/sheet-sync'` endpoint. Before creating the spreadsheet, add folder logic:

```javascript
// Get or create shared offsite folder
let folderId = process.env.OFFSITE_BUDGET_FOLDER_ID;
if (!folderId) {
  // Search for existing folder
  const folderSearch = await drive.files.list({
    q: "name='Leadership Offsites' and mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: 'files(id)'
  });
  if (folderSearch.data.files.length > 0) {
    folderId = folderSearch.data.files[0].id;
  } else {
    // Create folder
    const folder = await drive.files.create({
      requestBody: {
        name: 'Leadership Offsites',
        mimeType: 'application/vnd.google-apps.folder'
      }
    });
    folderId = folder.data.id;
    // Share folder with Evelyn and Sophie
    await drive.permissions.create({
      fileId: folderId,
      requestBody: { type: 'user', role: 'writer', emailAddress: 'evelyn@fermatcommerce.com' }
    });
    await drive.permissions.create({
      fileId: folderId,
      requestBody: { type: 'user', role: 'writer', emailAddress: 'sophie@fermatcommerce.com' }
    });
  }
}
```

Then when creating the spreadsheet, move it into the folder:

```javascript
// After creating the spreadsheet, move it to the folder
if (folderId) {
  await drive.files.update({
    fileId: spreadsheetId,
    addParents: folderId,
    fields: 'id, parents'
  });
}
```

- [ ] **Step 2: Update sheet data to include attending count**

In the values array that gets written to the sheet, add:
```javascript
['Attending', offsite.attendingCount || attendingList.length, '', ''],
['Hotel Rooms', budget.categories.find(c => c.category === 'Hotel') ? budget.categories.find(c => c.category === 'Hotel').estimated : 0, '', ''],
```

- [ ] **Step 3: Verify syntax, commit**

```bash
git add server.js && git commit -m "feat: shared Leadership Offsites folder, sheets include attending count"
```

---

### Task 7: Auto-sync budget on every dashboard edit

**Files:**
- Modify: `/tmp/sophie-dashboard/dashboard.html`

- [ ] **Step 1: Update updateOffsiteBudget function to trigger sync after save**

Find the `updateOffsiteBudget` function. After the successful POST, add auto-sync calls:

```javascript
function updateOffsiteBudget(category, field, value) {
  if (!_offsiteApiData || !_activeOffsiteId) return;
  var offsite = getOffsiteById(_activeOffsiteId);
  if (!offsite || !offsite.logistics || !offsite.logistics.budget) return;
  var cat = offsite.logistics.budget.categories.find(function(c) { return c.category === category; });
  if (!cat) return;
  var cleanVal = String(value).replace(/[$,]/g, '');
  cat[field] = parseFloat(cleanVal) || null;
  // Clear autoEstimated since user manually edited
  if (field === 'estimated') { cat.autoEstimated = null; }
  fetch('/api/offsite', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer sophie-dashboard-secret-change-me'},
    body: JSON.stringify(_offsiteApiData)
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok) {
      console.log('[Offsite] Budget updated: ' + category + ' ' + field + ' = ' + value);
      // Auto-sync to Notion and Sheet (fire and forget)
      fetch('/api/offsite/' + _activeOffsiteId + '/budget/notion-sync', {
        method: 'POST', headers: { 'Authorization': 'Bearer sophie-dashboard-secret-change-me' }
      }).catch(function() {});
      fetch('/api/offsite/' + _activeOffsiteId + '/budget/sheet-sync', {
        method: 'POST', headers: { 'Authorization': 'Bearer sophie-dashboard-secret-change-me' }
      }).catch(function() {});
    }
  }).catch(function(e) { console.error('[Offsite] Budget update failed:', e); });
}
```

- [ ] **Step 2: Also auto-sync when attending is toggled**

In the `toggleAttendeeStatus` function, after the successful POST, if the field was 'attending', trigger budget re-sync since room count and estimates change:

Find the `.then` after the POST in toggleAttendeeStatus and add:
```javascript
if (field === 'attending') {
  // Re-fetch offsite data to get recomputed budget
  fetch('/api/offsite/' + _activeOffsiteId).then(function(r) { return r.json(); }).then(function(updated) {
    // Sync recomputed budget
    fetch('/api/offsite/' + _activeOffsiteId + '/budget/notion-sync', {
      method: 'POST', headers: { 'Authorization': 'Bearer sophie-dashboard-secret-change-me' }
    }).catch(function() {});
    fetch('/api/offsite/' + _activeOffsiteId + '/budget/sheet-sync', {
      method: 'POST', headers: { 'Authorization': 'Bearer sophie-dashboard-secret-change-me' }
    }).catch(function() {});
  });
}
```

- [ ] **Step 3: Verify JS syntax, copy to dashboard-v2.html**

- [ ] **Step 4: Commit**

```bash
git add dashboard.html dashboard-v2.html && git commit -m "feat: auto-sync budget to Notion+Sheet on every edit and attending toggle"
```

---

### Task 8: Final validation and deploy

- [ ] **Step 1: Validate all files**

```bash
node -c server.js
node -e "JSON.parse(require('fs').readFileSync('data/offsite-data.json','utf8')); console.log('JSON OK')"
# Dashboard JS validation
```

- [ ] **Step 2: Full integrity check**

```bash
node -e "
const d=JSON.parse(require('fs').readFileSync('data/offsite-data.json','utf8'));
const q2=d.offsites['2026'].find(o=>o.id==='2026-Q2');
// Attending
const att=q2.attendees.filter(a=>a.attending!==false);
console.log('Attending:', att.length, att.map(a=>a.name).join(', '));
console.log('Not attending:', q2.attendees.filter(a=>a.attending===false).map(a=>a.name).join(', '));
// Budget
console.log('Budget total:', q2.logistics.budget.estimated);
console.log('Hotel rooms:', q2.logistics.hotel.rooms);
// Verify other data untouched
console.log('Hotel:', q2.logistics.hotel.name);
console.log('Dinner:', q2.logistics.dinner.name);
console.log('Venue:', q2.logistics.venue.name);
console.log('Themes:', q2.themes.length);
"
```

- [ ] **Step 3: Push and deploy**

```bash
git push origin main
```
