const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Config ──
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET       = process.env.SESSION_SECRET || 'sophie-dashboard-secret-change-me';
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : process.env.BASE_URL || `http://localhost:${PORT}`;

const ALLOWED_DOMAIN = 'fermatcommerce.com';

// ── Session ──
app.set('trust proxy', 1);
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// ── Passport ──
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: `${BASE_URL}/auth/google/callback`
  }, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value || '';
    const domain = email.split('@')[1];
    if (domain !== ALLOWED_DOMAIN) {
      return done(null, false, { message: `Only @${ALLOWED_DOMAIN} accounts allowed.` });
    }
    return done(null, {
      id: profile.id, email, name: profile.displayName,
      photo: profile.photos?.[0]?.value,
      accessToken,
      refreshToken
    });
  }));
}

// ── Auth routes ──
app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.readonly'],
  hd: ALLOWED_DOMAIN,
  accessType: 'offline',
  prompt: 'consent'
}));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/denied' }),
  (req, res) => res.redirect('/')
);

app.get('/auth/denied', (req, res) => {
  res.status(403).send(`
    <div style="font-family:system-ui;max-width:400px;margin:100px auto;text-align:center;color:#ccc;background:#1a1a2e;padding:40px;border-radius:12px">
      <h2 style="color:#e84e44">Access Denied</h2>
      <p>Only <strong>@${ALLOWED_DOMAIN}</strong> Google Workspace accounts can access this dashboard.</p>
      <a href="/auth/google" style="color:#d4af37">Try again</a>
    </div>
  `);
});

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

// ── Auth middleware ──
function ensureAuth(req, res, next) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return next();
  if (req.isAuthenticated()) return next();
  res.redirect('/auth/google');
}

// ── JSON body parsing ──
app.use(express.json({ limit: '1mb' }));

// ── Health check ──
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const API_KEY = process.env.DASHBOARD_API_KEY;

// ── Tasks API (Notion-synced via Cowork) ──
const TASKS_PATH = path.join(__dirname, 'data', 'tasks.json');

app.get('/api/tasks', ensureAuth, (req, res) => {
  try {
    if (fs.existsSync(TASKS_PATH)) {
      const data = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
      res.json(data);
    } else {
      res.json({ tasks: [], lastUpdated: null, source: 'none' });
    }
  } catch (err) {
    console.error('Error reading tasks:', err);
    res.status(500).json({ error: 'Failed to read tasks' });
  }
});

// ── Manual Task file path ──
const MANUAL_TASKS_PATH = path.join(__dirname, 'data', 'manual-tasks.json');

app.post('/api/tasks', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!API_KEY || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  try {
    const dir = path.dirname(TASKS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Merge manual tasks that haven't synced to Notion yet
    const incomingTasks = req.body.tasks || [];
    const incomingIds = new Set(incomingTasks.map(t => t.id));
    const incomingTitles = new Set(incomingTasks.map(t => (t.title || t.text || '').toLowerCase()));
    const manualTasks = fs.existsSync(MANUAL_TASKS_PATH) ? JSON.parse(fs.readFileSync(MANUAL_TASKS_PATH, 'utf8')) : [];
    const merged = [...incomingTasks];
    manualTasks.forEach(m => {
      if (!incomingIds.has(m.id) && !incomingTitles.has((m.title || m.text || '').toLowerCase())) {
        merged.push(m);
      }
    });

    const data = { ...req.body, tasks: merged, lastUpdated: new Date().toISOString() };
    fs.writeFileSync(TASKS_PATH, JSON.stringify(data, null, 2));
    res.json({ ok: true, savedAt: data.lastUpdated });
  } catch (err) {
    console.error('Error writing tasks:', err);
    res.status(500).json({ error: 'Failed to write tasks' });
  }
});

// ── Manual Task Add (from dashboard UI) ──
app.post('/api/tasks/add', ensureAuth, (req, res) => {
  try {
    const { title, priority } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const id = 'manual-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const task = { id, title, text: title, done: false, priority: priority || 'Medium', due: null, context: 'Manual', owner: 'Sophie', notionSynced: false, addedAt: new Date().toISOString() };
    const dir = path.dirname(MANUAL_TASKS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const existing = fs.existsSync(MANUAL_TASKS_PATH) ? JSON.parse(fs.readFileSync(MANUAL_TASKS_PATH, 'utf8')) : [];
    existing.push(task);
    fs.writeFileSync(MANUAL_TASKS_PATH, JSON.stringify(existing, null, 2));
    // Also append to main tasks.json so it shows immediately
    if (fs.existsSync(TASKS_PATH)) {
      const data = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
      data.tasks.push(task);
      data.lastUpdated = new Date().toISOString();
      fs.writeFileSync(TASKS_PATH, JSON.stringify(data, null, 2));
    }
    res.json({ ok: true, task });
  } catch (err) {
    console.error('Error adding manual task:', err);
    res.status(500).json({ error: 'Failed to add task' });
  }
})

// ── Bidirectional Sync (dashboard refresh pushes local state, gets merged result) ──
app.post('/api/tasks/sync', ensureAuth, (req, res) => {
  try {
    const { doneIds = [], doneTitles = [], manualTasks = [] } = req.body;
    const dir = path.dirname(TASKS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // 1. Merge incoming manual tasks into manual-tasks.json
    const existingManual = fs.existsSync(MANUAL_TASKS_PATH)
      ? JSON.parse(fs.readFileSync(MANUAL_TASKS_PATH, 'utf8')) : [];
    const manualIdSet = new Set(existingManual.map(m => m.id));
    const manualTitleSet = new Set(existingManual.map(m => (m.title || m.text || '').toLowerCase()));
    manualTasks.forEach(m => {
      if (!manualIdSet.has(m.id) && !manualTitleSet.has((m.title || m.text || '').toLowerCase())) {
        existingManual.push(m);
        manualIdSet.add(m.id);
      }
    });
    fs.writeFileSync(MANUAL_TASKS_PATH, JSON.stringify(existingManual, null, 2));

    // 2. Load current tasks.json (populated by hourly Notion sync)
    let data = fs.existsSync(TASKS_PATH)
      ? JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'))
      : { tasks: [], lastUpdated: null, source: 'none' };

    // 3. Merge manual tasks into main task list
    const taskIdSet = new Set(data.tasks.map(t => t.id));
    const taskTitleSet = new Set(data.tasks.map(t => (t.title || t.text || '').toLowerCase()));
    existingManual.forEach(m => {
      if (!taskIdSet.has(m.id) && !taskTitleSet.has((m.title || m.text || '').toLowerCase())) {
        data.tasks.push(m);
      }
    });

    // 4. Apply done states from dashboard localStorage
    const doneIdSet = new Set(doneIds);
    const doneTitleSet = new Set(doneTitles);
    data.tasks.forEach(t => {
      const norm = (t.title || t.text || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (doneIdSet.has(t.id) || doneTitleSet.has(norm)) {
        t.done = true;
      }
    });

    // 5. Save updated tasks.json and return merged list
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(TASKS_PATH, JSON.stringify(data, null, 2));
    res.json(data);
  } catch (err) {
    console.error('Error in bidirectional sync:', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// ── Action Items API ──
const ACTION_ITEMS_PATH = path.join(__dirname, 'data', 'action-items.json');

app.get('/api/action-items', ensureAuth, (req, res) => {
  try {
    if (fs.existsSync(ACTION_ITEMS_PATH)) {
      const data = JSON.parse(fs.readFileSync(ACTION_ITEMS_PATH, 'utf8'));
      res.json(data);
    } else {
      res.json({ items: [], lastUpdated: null, source: 'none' });
    }
  } catch (err) {
    console.error('Error reading action items:', err);
    res.status(500).json({ error: 'Failed to read action items' });
  }
});

app.post('/api/action-items', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!API_KEY || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  try {
    const dir = path.dirname(ACTION_ITEMS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ACTION_ITEMS_PATH, JSON.stringify(req.body, null, 2));
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error writing action items:', err);
    res.status(500).json({ error: 'Failed to write action items' });
  }
});

// ── Open Loops API ──
const OPEN_LOOPS_PATH = path.join(__dirname, 'data', 'open-loops.json');

app.get('/api/open-loops', ensureAuth, (req, res) => {
  try {
    if (fs.existsSync(OPEN_LOOPS_PATH)) {
      const data = JSON.parse(fs.readFileSync(OPEN_LOOPS_PATH, 'utf8'));
      res.json(data);
    } else {
      res.json({ loops: [], lastUpdated: null });
    }
  } catch (err) {
    console.error('Error reading open loops:', err);
    res.status(500).json({ error: 'Failed to read open loops' });
  }
});

app.post('/api/open-loops', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!API_KEY || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  try {
    const dir = path.dirname(OPEN_LOOPS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OPEN_LOOPS_PATH, JSON.stringify(req.body, null, 2));
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error writing open loops:', err);
    res.status(500).json({ error: 'Failed to write open loops' });
  }
});

// ── Candidates API ──
const CANDIDATES_PATH = path.join(__dirname, 'data', 'candidates.json');

app.get('/api/candidates', ensureAuth, (req, res) => {
  try {
    if (fs.existsSync(CANDIDATES_PATH)) {
      const data = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));
      res.json(data);
    } else {
      res.json({ candidates: [], lastUpdated: null });
    }
  } catch (err) {
    console.error('Error reading candidates:', err);
    res.status(500).json({ error: 'Failed to read candidates' });
  }
});

app.post('/api/candidates', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!API_KEY || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  try {
    const dir = path.dirname(CANDIDATES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(req.body, null, 2));
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error writing candidates:', err);
    res.status(500).json({ error: 'Failed to write candidates' });
  }
});

app.patch('/api/candidates/:id', ensureAuth, (req, res) => {
  try {
    if (!fs.existsSync(CANDIDATES_PATH)) {
      return res.status(404).json({ error: 'No candidates data' });
    }
    const data = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));
    const candidate = data.candidates.find(c => c.id === req.params.id);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    Object.assign(candidate, req.body);
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(data, null, 2));
    res.json({ ok: true, candidate });
  } catch (err) {
    console.error('Error updating candidate:', err);
    res.status(500).json({ error: 'Failed to update candidate' });
  }
});

// ── Calendar API ──
const CALENDAR_PATH = path.join(__dirname, 'data', 'calendar.json');

// ── Live Google Calendar helpers ──
const CAL_IDS = ['rishabh@fermatcommerce.com', 'shreyas@fermatcommerce.com'];
const CAL_NAMES = ['rishabh', 'shreyas'];

async function refreshGoogleToken(refreshToken) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const data = await resp.json();
  return data.access_token || null;
}

async function fetchGCalEvents(token, calendarId, timeMin, timeMax) {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
    timeZone: 'America/New_York'
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    console.error(`GCal API error for ${calendarId}: ${resp.status} ${errText.substring(0, 200)}`);
    return { items: [], error: resp.status, calendarId };
  }
  const data = await resp.json();
  return { items: data.items || [], calendarId };
}

function fmtTime(dateTime) {
  if (!dateTime) return '';
  const d = new Date(dateTime);
  let h = d.getHours(); const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return m === 0 ? `${h}:00 ${ampm}` : `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function classifyEvent(ev) {
  const s = (ev.summary || '').toLowerCase();
  if (s.includes('external') || s.includes('demo') || s.includes('intro')) return 'external';
  return 'internal';
}

function transformEvents(items) {
  return items
    .filter(ev => ev.start?.dateTime)
    .map(ev => ({
      time: fmtTime(ev.start.dateTime),
      end: fmtTime(ev.end?.dateTime),
      title: ev.summary || '(No title)',
      type: classifyEvent(ev),
      rsvp: (ev.attendees || []).find(a => a.self)?.responseStatus || 'accepted',
      link: ev.htmlLink || ''
    }))
    .sort((a, b) => {
      const ta = new Date('2026-01-01 ' + a.time);
      const tb = new Date('2026-01-01 ' + b.time);
      return ta - tb;
    });
}

app.get('/api/calendar', ensureAuth, async (req, res) => {
  try {
    const user = req.user;
    let token = user?.accessToken;
    const refresh = user?.refreshToken;

    // Try refresh if we have a refresh token
    if (refresh) {
      const fresh = await refreshGoogleToken(refresh);
      if (fresh) { token = fresh; user.accessToken = fresh; }
    }

    console.log('Calendar auth:', { hasToken: !!token, hasRefresh: !!refresh, email: user?.email });

    if (!token) {
      // Fallback to static file
      if (fs.existsSync(CALENDAR_PATH)) {
        return res.json(JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf8')));
      }
      return res.json({ calendarDays: [], lastUpdated: null });
    }

    // Fetch next 7 days
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setDate(end.getDate() + 7);

    const results = await Promise.all(
      CAL_IDS.map(id => fetchGCalEvents(token, id, now, end))
    );

    // Collect debug info
    const debug = results.map(r => ({
      calendarId: r.calendarId,
      error: r.error || null,
      eventCount: r.items.length
    }));
    console.log('Calendar fetch results:', JSON.stringify(debug));

    // Group by date
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dayMap = {};

    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const dow = d.getDay();
      dayMap[key] = {
        date: key,
        label: `${dayNames[dow]}, ${monthNames[d.getMonth()]} ${d.getDate()}`,
        isWeekend: dow === 0 || dow === 6,
        rishabh: [],
        shreyas: []
      };
    }

    CAL_NAMES.forEach((name, idx) => {
      const items = results[idx].items;
      items.forEach(ev => {
        if (!ev.start?.dateTime) return;
        const key = ev.start.dateTime.slice(0, 10);
        if (dayMap[key]) {
          dayMap[key][name].push(...transformEvents([ev]));
        }
      });
    });

    const calendarDays = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
    const payload = { calendarDays, lastUpdated: new Date().toISOString(), debug };

    // Cache to file for fallback
    const dir = path.dirname(CALENDAR_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CALENDAR_PATH, JSON.stringify(payload, null, 2));

    res.json(payload);
  } catch (err) {
    console.error('Error fetching live calendar:', err);
    // Fallback to cached file
    if (fs.existsSync(CALENDAR_PATH)) {
      return res.json(JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf8')));
    }
    res.status(500).json({ error: 'Failed to fetch calendar' });
  }
});

app.post('/api/calendar', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!API_KEY || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  try {
    const dir = path.dirname(CALENDAR_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CALENDAR_PATH, JSON.stringify(req.body, null, 2));
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error writing calendar:', err);
    res.status(500).json({ error: 'Failed to write calendar' });
  }
});

// ── Marketing Events API ──
const EVENTS_PATH = path.join(__dirname, 'data', 'events.json');

app.get('/api/events', ensureAuth, (req, res) => {
  try {
    if (fs.existsSync(EVENTS_PATH)) {
      res.json(JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf8')));
    } else {
      res.json({ events: [], lastUpdated: null });
    }
  } catch (err) {
    console.error('Error reading marketing events:', err);
    res.status(500).json({ error: 'Failed to read marketing events' });
  }
});

app.post('/api/events', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!API_KEY || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  try {
    const dir = path.dirname(EVENTS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(EVENTS_PATH, JSON.stringify(req.body, null, 2));
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error writing marketing events:', err);
    res.status(500).json({ error: 'Failed to write marketing events' });
  }
});

// ── Utilities API ──
const UTILITIES_PATH = path.join(__dirname, 'data', 'utilities.json');

app.get('/api/utilities', ensureAuth, (req, res) => {
  try {
    if (fs.existsSync(UTILITIES_PATH)) {
      res.json(JSON.parse(fs.readFileSync(UTILITIES_PATH, 'utf8')));
    } else {
      res.json({ lastUpdated: null });
    }
  } catch (err) {
    console.error('Error reading utilities:', err);
    res.status(500).json({ error: 'Failed to read utilities' });
  }
});

app.post('/api/utilities', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!API_KEY || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  try {
    const dir = path.dirname(UTILITIES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(UTILITIES_PATH, JSON.stringify(req.body, null, 2));
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error writing utilities:', err);
    res.status(500).json({ error: 'Failed to write utilities' });
  }
});

// ── Weekly Pulse API ──
const WEEKLY_PULSE_PATH = path.join(__dirname, 'data', 'weekly-pulse.json');

app.get('/api/weekly-pulse', ensureAuth, (req, res) => {
  try {
    if (fs.existsSync(WEEKLY_PULSE_PATH)) {
      res.json(JSON.parse(fs.readFileSync(WEEKLY_PULSE_PATH, 'utf8')));
    } else {
      res.json({ lastUpdated: null });
    }
  } catch (err) {
    console.error('Error reading weekly pulse:', err);
    res.status(500).json({ error: 'Failed to read weekly pulse' });
  }
});

app.post('/api/weekly-pulse', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!API_KEY || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  try {
    const dir = path.dirname(WEEKLY_PULSE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(WEEKLY_PULSE_PATH, JSON.stringify(req.body, null, 2));
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error writing weekly pulse:', err);
    res.status(500).json({ error: 'Failed to write weekly pulse' });
  }
});

// ── FPPC Events API ──
const FPPC_PATH = path.join(__dirname, 'data', 'fppc.json');

app.get('/api/fppc', ensureAuth, (req, res) => {
  try {
    if (fs.existsSync(FPPC_PATH)) {
      res.json(JSON.parse(fs.readFileSync(FPPC_PATH, 'utf8')));
    } else {
      res.json({ fppcEvents: [], lastUpdated: null });
    }
  } catch (err) {
    console.error('Error reading fppc events:', err);
    res.status(500).json({ error: 'Failed to read fppc events' });
  }
});

app.post('/api/fppc', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!API_KEY || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  try {
    const dir = path.dirname(FPPC_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FPPC_PATH, JSON.stringify(req.body, null, 2));
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error writing fppc events:', err);
    res.status(500).json({ error: 'Failed to write fppc events' });
  }
});

// ── Protected dashboard ──
app.get('/', ensureAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.use(ensureAuth, express.static(__dirname));

// ── Start ──
app.listen(PORT, () => {
  console.log(`Dashboard running on ${BASE_URL}`);
  if (!GOOGLE_CLIENT_ID) console.log('\u26a0\ufe0f GOOGLE_CLIENT_ID not set - auth disabled (dev mode)');
});
