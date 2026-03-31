#!/usr/bin/env python3
"""
Build calendarDays JSON from raw Google Calendar data and push to dashboard cache.
"""
import json
import subprocess
from datetime import datetime, timedelta

FERMAT_DOMAIN = "fermatcommerce.com"

def load_file_events(path):
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict) and 'text' in data[0]:
        parsed = json.loads(data[0]['text'])
    else:
        parsed = data
    return parsed.get('events', [])

def parse_dt(dt_obj):
    """Parse a start/end object to a datetime in PT."""
    if 'dateTime' in dt_obj:
        raw = dt_obj['dateTime']
        # Parse ISO format with offset
        if '+' in raw[10:] or raw.count('-') > 2:
            # Has timezone offset like -07:00
            dt = datetime.fromisoformat(raw)
            return dt
        else:
            return datetime.fromisoformat(raw)
    elif 'date' in dt_obj:
        return None  # all-day
    return None

def fmt_time(dt):
    if dt is None:
        return ""
    hour = dt.hour
    minute = dt.minute
    ampm = "AM" if hour < 12 else "PM"
    if hour == 0:
        hour = 12
    elif hour > 12:
        hour -= 12
    if minute == 0:
        return f"{hour}:{minute:02d} {ampm}"
    return f"{hour}:{minute:02d} {ampm}"

def get_date_str(event):
    """Get the date string (YYYY-MM-DD) for an event in PT."""
    start = event.get('start', {})
    if 'dateTime' in start:
        dt = parse_dt(start)
        if dt:
            # The offset is already in PT (events were requested in America/Los_Angeles)
            return dt.strftime('%Y-%m-%d')
    elif 'date' in start:
        return start['date']
    return None

def classify_type(event):
    """Classify event as external, 1on1, or internal."""
    num = event.get('numAttendees', 1)
    creator = event.get('creator', {}).get('email', '')
    organizer = event.get('organizer', {}).get('email', '')

    # Check organizer domain
    all_emails = [creator, organizer]

    has_external = False
    for email in all_emails:
        if email and '@' in email:
            domain = email.split('@')[1]
            if domain != FERMAT_DOMAIN and not domain.endswith('.google.com') and not domain.endswith('.calendar.google.com') and 'group.calendar' not in domain and 'imip.me.com' not in domain:
                has_external = True

    if has_external:
        return "external"

    if num == 2:
        return "1on1"

    return "internal"

def should_skip(event):
    """Skip cancelled or declined events."""
    if event.get('status') == 'cancelled':
        return True
    rsvp = event.get('myResponseStatus', '')
    if rsvp == 'declined':
        return True
    return False

def format_event(event):
    """Format a single event into the dashboard schema."""
    start_dt = parse_dt(event.get('start', {}))
    end_dt = parse_dt(event.get('end', {}))

    return {
        "time": fmt_time(start_dt),
        "end": fmt_time(end_dt),
        "title": event.get('summary', '(No title)'),
        "type": classify_type(event),
        "rsvp": event.get('myResponseStatus', 'needsAction'),
        "link": event.get('htmlLink', ''),
    }

def format_allday_event(event):
    """Format an all-day event."""
    return {
        "time": "All day",
        "end": "",
        "title": event.get('summary', '(No title)'),
        "type": classify_type(event),
        "rsvp": event.get('myResponseStatus', 'needsAction'),
        "link": event.get('htmlLink', ''),
    }

def build_label(date_str):
    dt = datetime.strptime(date_str, '%Y-%m-%d')
    return dt.strftime('%a, %b %-d')

def is_weekend(date_str):
    dt = datetime.strptime(date_str, '%Y-%m-%d')
    return dt.weekday() >= 5

# Load all data
rishabh_w1 = load_file_events('/Users/sophieweiler/.claude/projects/-Users-sophieweiler/41c13027-bc22-4fd1-8c8f-57ecd59e5550/tool-results/mcp-claude_ai_Google_Calendar-gcal_list_events-1774776093679.txt')
shreyas_w1 = load_file_events('/Users/sophieweiler/.claude/projects/-Users-sophieweiler/41c13027-bc22-4fd1-8c8f-57ecd59e5550/tool-results/mcp-claude_ai_Google_Calendar-gcal_list_events-1774776094690.txt')

# Week 2 data was returned inline - load from saved files
rishabh_w2 = json.load(open('/tmp/sophie-dashboard/rishabh_w2_inline.json'))
shreyas_w2 = json.load(open('/tmp/sophie-dashboard/shreyas_w2_inline.json'))

rishabh_all = rishabh_w1 + rishabh_w2
shreyas_all = shreyas_w1 + shreyas_w2

# Generate all 14 dates
start_date = datetime(2026, 3, 29)
dates = [(start_date + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(14)]

# Bucket events by date
rishabh_by_date = {d: [] for d in dates}
shreyas_by_date = {d: [] for d in dates}

for event in rishabh_all:
    if should_skip(event):
        continue
    if event.get('allDay'):
        # All-day events span multiple dates
        start_d = event.get('start', {}).get('date')
        end_d = event.get('end', {}).get('date')
        if start_d and end_d:
            d = datetime.strptime(start_d, '%Y-%m-%d')
            end = datetime.strptime(end_d, '%Y-%m-%d')
            while d < end:
                ds = d.strftime('%Y-%m-%d')
                if ds in rishabh_by_date:
                    rishabh_by_date[ds].append(format_allday_event(event))
                d += timedelta(days=1)
    else:
        ds = get_date_str(event)
        if ds and ds in rishabh_by_date:
            rishabh_by_date[ds].append(format_event(event))

for event in shreyas_all:
    if should_skip(event):
        continue
    if event.get('allDay'):
        start_d = event.get('start', {}).get('date')
        end_d = event.get('end', {}).get('date')
        if start_d and end_d:
            d = datetime.strptime(start_d, '%Y-%m-%d')
            end = datetime.strptime(end_d, '%Y-%m-%d')
            while d < end:
                ds = d.strftime('%Y-%m-%d')
                if ds in shreyas_by_date:
                    shreyas_by_date[ds].append(format_allday_event(event))
                d += timedelta(days=1)
    else:
        ds = get_date_str(event)
        if ds and ds in shreyas_by_date:
            shreyas_by_date[ds].append(format_event(event))

# Build calendarDays array
calendar_days = []
for d in dates:
    calendar_days.append({
        "date": d,
        "label": build_label(d),
        "isWeekend": is_weekend(d),
        "rishabh": rishabh_by_date[d],
        "shreyas": shreyas_by_date[d],
    })

payload = {
    "calendarDays": calendar_days,
    "lastUpdated": datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
    "source": "mcp-fetch"
}

# Save payload to file for curl
with open('/tmp/sophie-dashboard/calendar-cache-payload.json', 'w') as f:
    json.dump(payload, f)

# Print stats
total_r = sum(len(v) for v in rishabh_by_date.values())
total_s = sum(len(v) for v in shreyas_by_date.values())
print(f"Rishabh: {total_r} events across 14 days")
print(f"Shreyas: {total_s} events across 14 days")
print(f"Payload saved to /tmp/sophie-dashboard/calendar-cache-payload.json")
