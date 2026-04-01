# Hack Week Hub — Design Spec

## Overview

Expand the existing Hack Week section of Sophie's EA Dashboard into a full hub with 5 sub-tabs: Overview, Schedule, Teams, Judging, Archive. Add Google Sheet team sync, judging/scoring tracker, and rich content sections.

**Target event:** Hack Week #3, week of June 8, 2026 (~8 teams expected).

## Current State

### What exists
- `data/hackweek-data.json` — config, empty `teams[]`, 5-day schedule, 4-phase planning checklist, team rules, prize categories, judges, contacts, lessons learned, past hack week Notion links
- `GET /api/hackweek` and `POST /api/hackweek` endpoints in server.js (lines 1466-1493)
- `renderHackWeek()` in dashboard.html (line 4939) with 5 sub-tabs: Current Hack Week, Teams, Schedule, Logistics, Reviews
- Checkbox toggling with localStorage + server sync
- Google Sheets API access via service account already configured

### What changes
- Sub-tabs restructured: Current/Teams/Schedule/Logistics/Reviews → **Overview/Schedule/Teams/Judging/Archive**
- New server cron for Google Sheet team sync
- New PATCH endpoint for scoring
- New data fields: rubric, resourceLinks, scores
- New UI sections: countdown timers, rules, resource links, rubric, scoring display, prizes, archive

## Architecture

### Data Model Changes (hackweek-data.json)

Add these top-level fields:

```json
{
  "rubric": [
    { "criterion": "Quality of Idea", "weight": 0.333, "description": "Originality, feasibility, and potential impact" },
    { "criterion": "Code Quality", "weight": 0.333, "description": "Architecture, reliability, and production-readiness" },
    { "criterion": "Demo Quality", "weight": 0.334, "description": "Clarity, engagement, and polish of presentation" }
  ],
  "resourceLinks": [
    { "label": "GitHub Org", "url": "", "icon": "github" },
    { "label": "Figma Workspace", "url": "", "icon": "figma" },
    { "label": "Notion Hub", "url": "https://www.notion.so/3291ad76fd2a81b8a66ff9d04b4a1bbe", "icon": "notion" },
    { "label": "API Docs", "url": "", "icon": "docs" }
  ],
  "scores": []
}
```

Scores array structure (populated via PATCH endpoint):
```json
{
  "team": "Team Name",
  "judge": "Shreyas",
  "idea": 8,
  "code": 7,
  "demo": 9,
  "submittedAt": "2026-06-12T..."
}
```

Teams array structure (populated via Google Sheet sync):
```json
{
  "name": "Team Alpha",
  "members": ["Alice", "Bob", "Carol"],
  "idea": "AI-powered inventory forecasting",
  "techStack": "Python, React, GPT-4",
  "loomUrl": "",
  "sheetRow": 2
}
```

### Server Changes (server.js)

#### 1. Google Sheet Team Sync Cron

- Read from sheet ID `1qf2DWzf9852ARQFBnMxv1T5b5r_Zj73_VJyniG5HAv0`
- Create a new sheet/tab per hack week (e.g., "Hack Week #3 - Jun 2026")
- Read row 1 as headers, dynamically map columns
- Expected columns (flexible mapping): Team Name, Members, Idea/Description, Tech Stack, Loom URL
- Sync on startup + every 30 minutes
- Write to `teams[]` in hackweek-data.json (merge, don't overwrite other fields)
- Log sync results: `[HW Sheet Cron] Synced N teams`

#### 2. PATCH `/api/hackweek/scores`

- Auth: Bearer token (same as other PATCH endpoints)
- Body: `{ team, judge, idea, code, demo }` — scores 1-10
- Validates: team exists in teams[], scores are 1-10
- Upserts: if same judge+team combo exists, update it
- Stores in `scores[]` array in hackweek-data.json

#### 3. Add to system health/skills display

- Add `hackweek-sheet` to the cron status list alongside calendar-cron, task-cron, etc.

### Dashboard Changes (dashboard.html)

#### Tab Structure

Replace current 5 sub-tabs with:

```
Overview | Schedule | Teams | Judging | Archive
```

#### Tab: Overview
Combines current "Current Hack Week" + "Logistics" content:
- Hack Week #3 header with countdown badge (Nd away)
- Dates, Slack channel, Notion link
- Planning progress bar + phase checklists (existing)
- Budget card (prizes/travel/food/social with approval status)
- Judges card (list of judges)
- Key contacts grid (engineering lead, operations, BLR logistics, finance)

#### Tab: Schedule
- 5-day cards (existing schedule render)
- Add countdown per day: "in X days" or "today" or "completed"
- Each day shows theme + events list

#### Tab: Teams
Three sections stacked:

1. **Team Sign-ups** — team cards from Google Sheet sync showing name, members, idea, tech stack, Loom link (if available). Count badge.
2. **Team Formation Rules** — render `teamFormationRules` array as a styled list (teams of 2-4, no solo, cross-functional >50%, PMs/designers encouraged)
3. **Resource Links** — render `resourceLinks` as icon+label links in a row

#### Tab: Judging
Three sections stacked:

1. **Judging Rubric** — 3 criteria with weights (equal 1/3) and descriptions, plus judges list
2. **Scores** — table/grid showing scores per team per judge. Columns: Team, Judge, Idea, Code, Demo, Total. If no scores yet, show empty state.
3. **Prizes** — 3 prize categories with $1,000 amounts each, styled cards

#### Tab: Archive
- Card per past hack week (June 2025, January 2026)
- Each shows: name, Notion link, key lessons learned (bulleted)
- Links to Notion pages and signup sheets from `previousHackWeeks` in config

## File Changes Summary

| File | Change |
|------|--------|
| `data/hackweek-data.json` | Add `rubric`, `resourceLinks`, `scores` fields |
| `server.js` | Add Sheet sync cron, PATCH `/api/hackweek/scores` endpoint, cron status entry |
| `dashboard.html` | Restructure sub-tabs, add countdown timers, rules section, resource links, rubric, scores table, prizes, archive tab |

## Constraints

- Single edit per file per agent (no overlapping edits)
- PATCH for data changes, never full POST
- Use Intl.DateTimeFormat for any PT date formatting
- Never auto-rewrite dashboard.html wholesale — targeted edits only
- Google Sheet column mapping must be dynamic (read headers from row 1)
- All subagents use Opus model
