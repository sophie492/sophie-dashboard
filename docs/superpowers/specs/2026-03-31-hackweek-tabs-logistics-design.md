# Hack Week Tabs + Logistics Pipeline — Design Spec

## Overview

Reorganize the hack week hub from a single checklist in Overview into 7 purpose-driven tabs, each with its own task list. Add an offsite-style research/confirmation pipeline for Travel and Social Events logistics.

## Tab Structure

### Tab 1: Overview
Aggregate dashboard. Shows:
- Planning progress bar (rollup of all tasks across all tabs)
- Countdown to hack week
- Budget card (prizes/travel/food/social with approval status)
- Key contacts card (engineering lead, ops, BLR logistics, finance)
- Hack week selector dropdown (existing)

No task checklist here — just the rollup percentage and status cards.

### Tab 2: Schedule
**7 tasks from the old checklist:**
1. Pick the dates — Avoid US and India holidays
2. Decide on cross-office schedule (SF & BLR async alignment)
3. Confirm the daily structure (Build → Demo → Optimize/Ship)
4. Cancel all internal meetings for hack week
5. Set up on-call schedule for customer-facing coverage
6. Block calendars with hack week events
7. Set up Loom recording workflow

Plus the existing 5-day schedule view with countdown badges.

### Tab 3: Teams
**9 tasks:**
1. Create team sign-up spreadsheet (Google Sheet)
2. Set team formation rules (2-4 people, cross-functional, no solo)
3. Set deadline for team/idea submission (~1 week before)
4. Send reminder nudges
5. Have Bharat/Shreyas review and approve all ideas
6. Lock all teams and ideas (~3 days before)
7. Confirm attendance
8. Decide on prizes and categories
9. Confirm judges

Plus existing: team cards from Google Sheet, team formation rules display, resource links.

### Tab 4: Logistics
**7 tasks:**
1. Get budget approved (Evelyn)
2. Assign a BLR logistics lead (Kunal/Sriram + Shiksha)
3. Arrange travel for remote employees
4. Coordinate BLR travel with Kunal/Sriram
5. Plan social events — team dinner (mid-week) + happy hour (end of week)
6. Set up late-night dinner policy (expense dinner past 6pm)
7. Distribute prizes ($1,000 per winning team)

Plus **offsite-style research/confirmation pipeline** for two categories:

#### Travel Pipeline
- Status: Not Started → Researching → Decided → Booked
- Research options: `travelResearch[]` — each option has `description`, `flightBudget`, `hotelBudget`, `hotelOptions`, `notes`
- Selection: "This one" button → selected option highlighted, confirmation details field
- Confirmation: free-text for booking confirmation numbers, dates
- Default seed from lessons learned: "$550-600 for flights, $350/night for hotels in SF"

#### Social Events Pipeline
- Status: Not Started → Researching → Decided → Booked
- Research options: `socialResearch[]` — each option has `name`, `type` (dinner/happy-hour), `venue`, `capacity`, `estimatedCost`, `notes`, `office` (SF/BLR)
- Selection + confirmation like travel
- Two sub-sections: Team Dinner (mid-week after demos) and Happy Hour (end of week)

Data structure per category (mirrors offsite):
```json
{
  "logistics": {
    "travel": {
      "status": "Not Started",
      "statusDetail": "",
      "selectedOption": null,
      "confirmationDetails": "",
      "travelResearch": []
    },
    "socialEvents": {
      "status": "Not Started",
      "statusDetail": "",
      "selectedOption": null,
      "confirmationDetails": "",
      "socialResearch": []
    },
    "budget": { ... },
    "judges": [...],
    "keyContacts": { ... }
  }
}
```

### Tab 5: Comms
**9 tasks:**
1. Create the #hack-week-[month-year] Slack channel
2. Draft and send kick-off announcement in #dev and #general
3. Draft Slack announcement templates
4. Post opening message in #hack-week channel
5. Encourage daily progress updates in Slack
6. Post shipping guidance
7. Post hack week recap in #general with all Loom links
8. Create LinkedIn content (coordinate with marketing)
9. Feature hack week at offsite/company events

### Tab 6: Judging
**6 tasks:**
1. Judges review all demos and Looms (2-3 days)
2. Pick winners across all categories
3. Announce winners at Town Hall (lock date + ensure judges available)
4. Have winning teams re-present polished demos
5. Send feedback survey (Google Form)
6. Hold planning retro (Sophie + Bharat + BLR leads)
7. Update checklist with new lessons learned
8. Track which projects made it to production (2-4 weeks later)

Plus existing: rubric display, scores table, prizes grid.

### Tab 7: Archive
Unchanged — past hack weeks with lessons learned, future hack weeks with planning dates.

## Data Model Changes

### Per hack week object — replace flat `checklist.phases` with per-tab task arrays:

```json
{
  "tasks": {
    "schedule": [
      { "text": "Pick the dates — Avoid US and India holidays", "done": false },
      ...
    ],
    "teams": [ ... ],
    "logistics": [ ... ],
    "comms": [ ... ],
    "judging": [ ... ]
  }
}
```

Remove `checklist` field entirely. Each task has `{ text, done }` and optionally `{ lesson }`.

### Logistics — add research arrays:

```json
{
  "logistics": {
    "travel": {
      "status": "Not Started",
      "statusDetail": "",
      "selectedOption": null,
      "confirmationDetails": "",
      "travelResearch": []
    },
    "socialEvents": {
      "status": "Not Started",
      "statusDetail": "",
      "selectedOption": null,
      "confirmationDetails": "",
      "socialResearch": []
    },
    "budget": { ... },
    "judges": [...],
    "keyContacts": { ... }
  }
}
```

## Server Changes

### PATCH /api/hackweek/:id/logistics

New endpoint (mirrors offsite pattern). Deep-merges request body into the hack week's `logistics` object. Auth required.

### PATCH /api/hackweek/:id/task

New endpoint. Toggles a task done/not-done by tab and index. Body: `{ tab: "schedule", index: 3, done: true }`. Persists to hackweek-data.json.

### Checkbox sync

Update checkbox key format to: `hackweek-{hwId}-{tab}-{index}` (e.g., `hackweek-hw-2026-jun-schedule-3`). This replaces the current `hackweek-{hwId}-{phaseIndex}-{taskIndex}` format.

## Dashboard Changes

### Tab navigation
Replace 5 tabs (Overview/Schedule/Teams/Judging/Archive) with 7 tabs (Overview/Schedule/Teams/Logistics/Comms/Judging/Archive).

### renderHackWeek()
Restructure to render per-tab task checklists from `hwApi.tasks[tabName]` instead of `hwApi.checklist.phases`.

### Overview tab
Remove the phase checklist. Show aggregate progress: total tasks done across all tabs. Keep budget + contacts + countdown.

### Logistics tab
Render two logistics category cards (Travel, Social Events) using the offsite's card pattern:
- Status dropdown (Not Started/Researching/Decided/Booked)
- Research options as cards with "This one" button
- Selected option highlighted with confirmation details input
- Collapsed "Other options considered" section
- Task checklist below the pipeline cards

### Comms tab
Simple task checklist with tasks grouped visually: Pre-event / During / Post-event.

### Progress rollup
Each tab's task count feeds into the sidebar percentage and overview progress bar. The sidebar shows the total across all tabs.

## File Changes

| File | Change |
|------|--------|
| `data/hackweek-data.json` | Replace `checklist.phases` with `tasks: { schedule, teams, logistics, comms, judging }`. Add `logistics.travel` and `logistics.socialEvents` with research arrays. |
| `server.js` | Add `PATCH /api/hackweek/:id/logistics` and `PATCH /api/hackweek/:id/task` endpoints. |
| `dashboard.html` | Add Logistics + Comms tabs, restructure renderHackWeek to use per-tab tasks, add logistics pipeline rendering (adapted from offsite pattern). |
