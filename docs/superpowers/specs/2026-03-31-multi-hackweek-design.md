# Multi-Hack-Week Support — Design Spec

## Overview

Convert the Hack Week hub from a single flat data object to a multi-event collection (like the offsite system), keyed by year. Each hack week has its own teams, scores, schedule, checklist, rubric, etc. The dashboard auto-selects the next upcoming one and provides a selector to view any hack week.

Cadence: every 6 months (H1 ~January, H2 ~June).

## Data Model

### hackweek-data.json — new structure

```json
{
  "hackweeks": {
    "2025": [
      {
        "id": "hw-2025-jun",
        "number": 1,
        "name": "Hack Week #1 — Hack me if you can",
        "half": "H2",
        "targetDate": "2025-06-09",
        "status": "Complete",
        "notionHub": "https://www.notion.so/2071ad76fd2a80068a91c8b89c261580",
        "slackChannel": "#hack-week-jun-2025",
        "lessonsLearned": ["First hack week...", "4-day format felt compressed...", ...],
        "teams": [],
        "scores": [],
        "schedule": {},
        "checklist": { "phases": [] },
        "rubric": [],
        "resourceLinks": [],
        "prizeCategories": [],
        "teamFormationRules": [],
        "logistics": {},
        "reviews": []
      }
    ],
    "2026": [
      {
        "id": "hw-2026-jan",
        "number": 2,
        "name": "Hack Week #2",
        "half": "H1",
        "targetDate": "2026-01-26",
        "status": "Complete",
        "notionHub": "https://www.notion.so/2b01ad76fd2a81a39933d57ffed44277",
        "signupSheet": "https://docs.google.com/spreadsheets/d/1qf2DWzf9852ARQFBnMxv1T5b5r_Zj73_VJyniG5HAv0/edit",
        "slackChannel": "#hack-week-jan-2026",
        "lessonsLearned": ["Holiday scheduling was painful...", ...],
        "teams": [],
        "scores": [],
        "schedule": {},
        "checklist": { "phases": [] },
        "rubric": [],
        "resourceLinks": [],
        "prizeCategories": [],
        "teamFormationRules": [],
        "logistics": {},
        "reviews": []
      },
      {
        "id": "hw-2026-jun",
        "number": 3,
        "name": "Hack Week #3",
        "half": "H2",
        "targetDate": "2026-06-08",
        "status": "Planning",
        "notionHub": "https://www.notion.so/3291ad76fd2a81b8a66ff9d04b4a1bbe",
        "slackChannel": "#hack-week-jun-2026",
        "signupSheet": "https://docs.google.com/spreadsheets/d/1qf2DWzf9852ARQFBnMxv1T5b5r_Zj73_VJyniG5HAv0/edit",
        "sheetTabMatch": "jun 2026",
        "teams": [],
        "scores": [],
        "schedule": { "day1": {...}, ... },
        "checklist": { "phases": [...] },
        "rubric": [{ "criterion": "Quality of Idea", ... }, ...],
        "resourceLinks": [...],
        "prizeCategories": [...],
        "teamFormationRules": [...],
        "logistics": { "budget": {...}, "judges": [...], "keyContacts": {...} },
        "reviews": []
      }
    ],
    "2027": [
      {
        "id": "hw-2027-jan",
        "number": 4,
        "name": "Hack Week #4",
        "half": "H1",
        "targetDate": "2027-01-11",
        "status": "Future",
        "notionHub": "",
        "slackChannel": "",
        "planningStart": "Late October 2026",
        "teams": [],
        "scores": [],
        "schedule": {},
        "checklist": { "phases": [] },
        "rubric": [],
        "resourceLinks": [],
        "prizeCategories": [],
        "teamFormationRules": [],
        "logistics": {},
        "reviews": [],
        "lessonsLearned": []
      }
    ]
  },
  "schedulingTips": [
    "January works well but watch for MLK Day and BLR Republic Day (Jan 26).",
    "June works well but watch for July 4th proximity.",
    "December is risky — holiday season makes it hard to get clean 5-day window."
  ],
  "lastSynced": "...",
  "lastSheetSync": "..."
}
```

### Key fields per hack week

| Field | Complete stubs | Planning/Future |
|-------|---------------|-----------------|
| id, number, name, half, targetDate, status | yes | yes |
| notionHub, slackChannel | yes (if known) | yes |
| lessonsLearned | yes (from existing data) | empty |
| teams, scores, schedule, checklist, rubric, etc. | empty arrays/objects | fully populated |
| signupSheet, sheetTabMatch | only if known | yes |
| planningStart | no | yes (for Future) |

### Status values

- `"Planning"` — active hack week, the one auto-selected by dashboard
- `"Complete"` — past hack week, read-only in dashboard
- `"Future"` — upcoming but not yet in planning, stub data

## Server Changes

### GET /api/hackweek

Returns the full `hackweek-data.json` object (same as before but now contains `hackweeks` collection). Computes `daysUntil` for each non-Complete hack week.

### GET /api/hackweek/:id

New endpoint. Finds the hack week by id across all years, returns it. Used if dashboard needs to fetch a single one.

### PATCH /api/hackweek/:id/scores

Replaces `PATCH /api/hackweek/scores`. The `:id` identifies which hack week the scores belong to. Same validation logic (team must exist, scores 1-10, upsert by judge+team).

### POST /api/hackweek (unchanged)

Still accepts a full data write (used by migration/seed scripts). Auth required.

### Sheet sync cron

- On each sync, find the hack week with `status: "Planning"`
- Use that hack week's `signupSheet` and `sheetTabMatch` to identify the correct sheet + tab
- Write teams to that specific hack week's `teams` array
- If no Planning hack week exists, skip sync

### Health endpoint

Unchanged — still tracks `lastSheetSync`.

## Dashboard Changes

### Auto-selection

On load, find the hack week with `status: "Planning"`. If none, find the most recent `"Complete"` one. Display it.

### Selector

Add a small dropdown above the sub-tabs (similar to the offsite selector pattern) showing all hack weeks:
- Format: "Hack Week #3 — Jun 2026 (Planning)" 
- Active one pre-selected
- Switching changes which hack week's data renders in all tabs

### Tab rendering

All 5 tabs (Overview, Schedule, Teams, Judging, Archive) render from the selected hack week's data. The code already reads from `hwApi` variables — just need to point those at the selected hack week object instead of the top-level.

### Archive tab change

The Archive tab currently shows past hack weeks from `lessonsLearned`. With multi-hack-week support, it should instead show all hack weeks with status "Complete" from the collection — each with their Notion link, lessons, and a button to switch to that hack week's full view.

### Read-only mode for Complete hack weeks

When viewing a Complete hack week:
- Checklists are display-only (no toggle)
- Scores table is display-only
- "This hack week is complete" badge shown

### DATA.hackWeek in dashboard.html

The inline `DATA.hackWeek` object (lines 838-900) contains the planning checklist phases. This needs to become hack-week-specific. The `renderHackWeek()` function should pull phases from the API data (`hwApi`) for the selected hack week, not from the static `DATA.hackWeek` inline object.

## Migration

Move existing data:
1. Current `hackweek-data.json` top-level fields → `hackweeks["2026"][1]` (hw-2026-jun, #3, Planning)
2. `lessonsLearned[0]` (June 2025) → `hackweeks["2025"][0]` stub
3. `lessonsLearned[1]` (January 2026) → `hackweeks["2026"][0]` stub  
4. `futureHackWeeks[0]` (#4) → `hackweeks["2027"][0]` stub
5. Remove top-level `config`, `teams`, `schedule`, `checklist`, `rubric`, `resourceLinks`, `scores`, `prizeCategories`, `teamFormationRules`, `logistics`, `reviews`, `lessonsLearned`, `futureHackWeeks`, `upcomingTimeline`
6. Keep `schedulingTips` at top level (shared across all hack weeks)

## File Changes Summary

| File | Change |
|------|--------|
| `data/hackweek-data.json` | Restructure from flat → `hackweeks` collection with migration |
| `server.js` | Add `GET /api/hackweek/:id`, change scores to `:id/scores`, update sheet sync to target Planning hack week |
| `dashboard.html` | Add hack week selector dropdown, pull phases from API data, read-only mode for Complete, update Archive tab |

## Constraints

- Same rules as before: PATCH for mutations, targeted edits only, Opus for subagents, never rewrite dashboard.html
- The inline `DATA.hackWeek` in dashboard.html can be simplified to just reference the active hack week's id — the actual data comes from the API
