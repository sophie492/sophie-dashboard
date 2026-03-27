const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const path = require('path');
const fs = require('fs');
const { Client } = require('@notionhq/client');

const app = express();
const PORT = process.env.PORT || 3000;

// ââ Config ââ
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET       = process.env.SESSION_SECRET || 'sophie-dashboard-secret-change-me';
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : process.env.BASE_URL || `http://localhost:${PORT}`;

const ALLOWED_DOMAIN = 'fermatcommerce.com';

// ââ Session ââ
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

// ââ Passport ââ
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

// ââ Auth routes ââ
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

// ââ Auth middleware ââ
function ensureAuth(req, res, next) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return next();
  if (req.isAuthenticated()) return next();
  res.redirect('/auth/google');
}

// ââ JSON body parsing ââ
app.use(express.json({ limit: '1mb' }));

// ââ Health check ââ
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const API_KEY = process.env.DASHBOARD_API_KEY;

// -- Notion integration (bidirectional sync) --
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const notion = NOTION_TOKEN ? new Client({ auth: NOTION_TOKEN }) : null;
if (notion) console.log('[Notion] Integration enabled, DB:', NOTION_DB_ID);
else console.log('[Notion] No NOTION_TOKEN set - write-back disabled');

async function createNotionTask({ title, priority, due, source }) {
  if (!notion || !NOTION_DB_ID) return null;
  try {
    const properties = {
      Task: { title: [{ text: { content: title } }] },
      Priority: { select: { name: priority || 'Medium' } },
      Source: { rich_text: [{ text: { content: source || 'Dashboard' } }] },
      Done: { checkbox: false }
    };
    if (due) properties['Due Date'] = { date: { start: due } };
    const page = await notion.pages.create({ parent: { database_id: NOTION_DB_ID }, properties });
    console.log(`[Notion] Created task "${title}" -> ${page.id}`);
    return page.id;
  } catch (err) {
    console.error('[Notion] Failed to create task:', err.message);
    return null;
  }
}

async function updateNotionTaskDone(notionPageId, done) {
  if (!notion || !notionPageId) return false;
  try {
    await notion.pages.update({ page_id: notionPageId, properties: { Done: { checkbox: done } } });
    console.log(`[Notion] Updated ${notionPageId} done=${done}`);
    return true;
  } catch (err) {
    console.error('[Notion] Failed to update done:', err.message);
    return false;
  }
}

async function findNotionTaskByTitle(title) {
  if (!notion || !NOTION_DB_ID) return null;
  try {
    const resp = await notion.databases.query({
      database_id: NOTION_DB_ID,
      filter: { property: 'Task', title: { equals: title } },
      page_size: 1
    });
    return resp.results[0]?.id || null;
  } catch (err) {
    console.error('[Notion] Failed to find task by title:', err.message);
    return null;
  }
}

// ââ Tasks API (Notion-synced via Cowork) ââ
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

// ââ Manual Task file path ââ
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

// ââ Manual Task Add (from dashboard UI) ââ
// -- GET authoritative done states from Notion-synced tasks --
app.get('/api/tasks/done-states', (req, res) => {
  const authHeader = req.headers.authorization;
  const isBearer = API_KEY && authHeader === `Bearer ${API_KEY}`;
  const isAuthed = isBearer || (req.isAuthenticated && req.isAuthenticated());
  if (!isAuthed) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const tasks = fs.existsSync(TASKS_PATH) ? JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8')) : { tasks: [] };
    // Return map of task IDs and normalized titles to their Notion-authoritative done state
    const doneStates = {};
    (tasks.tasks || []).forEach(t => {
      if (t.id) doneStates[t.id] = { done: !!t.done, title: t.title || t.text || '' };
    });
    res.json({ doneStates, lastUpdated: tasks.lastUpdated });
  } catch (err) {
    console.error('Error reading done states:', err);
    res.status(500).json({ error: 'Failed to read done states' });
  }
});

// -- GET manual tasks + done states via Bearer token (for scheduled task sync) --
app.get('/api/tasks/manual', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!API_KEY || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  try {
    const manual = fs.existsSync(MANUAL_TASKS_PATH) ? JSON.parse(fs.readFileSync(MANUAL_TASKS_PATH, 'utf8')) : [];
    const tasks = fs.existsSync(TASKS_PATH) ? JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8')) : { tasks: [] };
    res.json({ manualTasks: manual, allTasks: tasks.tasks || [], lastUpdated: tasks.lastUpdated });
  } catch (err) {
    console.error('Error reading manual tasks:', err);
    res.status(500).json({ error: 'Failed to read manual tasks' });
  }
});

// -- Mark manual tasks as synced to Notion (for scheduled task) --
app.post('/api/tasks/mark-synced', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!API_KEY || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  try {
    const { syncedTasks = [] } = req.body;
    if (!syncedTasks.length) return res.json({ ok: true, updated: 0 });
    const titleToPageId = {};
    syncedTasks.forEach(s => { titleToPageId[s.title.toLowerCase()] = s.notionPageId; });
    // Update manual-tasks.json
    if (fs.existsSync(MANUAL_TASKS_PATH)) {
      const manual = JSON.parse(fs.readFileSync(MANUAL_TASKS_PATH, 'utf8'));
      manual.forEach(t => {
        const key = (t.title || t.text || '').toLowerCase();
        if (titleToPageId[key]) { t.notionSynced = true; t.notionPageId = titleToPageId[key]; }
      });
      fs.writeFileSync(MANUAL_TASKS_PATH, JSON.stringify(manual, null, 2));
    }
    // Update tasks.json
    if (fs.existsSync(TASKS_PATH)) {
      const data = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
      (data.tasks || []).forEach(t => {
        const key = (t.title || t.text || '').toLowerCase();
        if (titleToPageId[key]) { t.notionSynced = true; t.notionPageId = titleToPageId[key]; }
      });
      fs.writeFileSync(TASKS_PATH, JSON.stringify(data, null, 2));
    }
    res.json({ ok: true, updated: syncedTasks.length });
  } catch (err) {
    console.error('Error marking tasks synced:', err);
    res.status(500).json({ error: 'Failed to mark tasks synced' });
  }
});

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
    // Write-back to Notion (async, don't block response)
    createNotionTask({ title, priority: priority || 'Medium', source: 'Dashboard' }).then(notionId => {
      if (notionId) {
        task.notionPageId = notionId;
        task.notionSynced = true;
        // Update the saved files with the Notion ID
        try {
          const manual = fs.existsSync(MANUAL_TASKS_PATH) ? JSON.parse(fs.readFileSync(MANUAL_TASKS_PATH, 'utf8')) : [];
          const mt = manual.find(m => m.id === task.id);
          if (mt) { mt.notionPageId = notionId; mt.notionSynced = true; }
          fs.writeFileSync(MANUAL_TASKS_PATH, JSON.stringify(manual, null, 2));
          if (fs.existsSync(TASKS_PATH)) {
            const data = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
            const t = data.tasks.find(t => t.id === task.id);
            if (t) { t.notionPageId = notionId; t.notionSynced = true; }
            fs.writeFileSync(TASKS_PATH, JSON.stringify(data, null, 2));
          }
        } catch(e) { console.error('[Notion] Failed to save notionId:', e.message); }
      }
    });
    res.json({ ok: true, task });
  } catch (err) {
    console.error('Error adding manual task:', err);
    res.status(500).json({ error: 'Failed to add task' });
  }
})


// -- Task completion write-back to Notion --
app.post('/api/tasks/complete', ensureAuth, async (req, res) => {
  try {
    const { taskId, title, done } = req.body;
    if (!taskId && !title) return res.status(400).json({ error: 'taskId or title required' });

    // 1. Find the Notion page ID - check tasks.json first, then query Notion by title
    let notionPageId = null;
    if (fs.existsSync(TASKS_PATH)) {
      const data = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
      const task = data.tasks.find(t => t.id === taskId || t.notionPageId === taskId);
      if (task) notionPageId = task.notionPageId;
    }
    if (!notionPageId && fs.existsSync(MANUAL_TASKS_PATH)) {
      const manual = JSON.parse(fs.readFileSync(MANUAL_TASKS_PATH, 'utf8'));
      const task = manual.find(t => t.id === taskId);
      if (task) notionPageId = task.notionPageId;
    }
    // If still no Notion ID, try finding by title in Notion
    if (!notionPageId && title) {
      notionPageId = await findNotionTaskByTitle(title);
    }

    // 2. Update Notion
    let notionUpdated = false;
    if (notionPageId) {
      notionUpdated = await updateNotionTaskDone(notionPageId, done !== false);
    }

    // 3. Update local JSON files
    if (fs.existsSync(TASKS_PATH)) {
      const data = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
      const task = data.tasks.find(t => t.id === taskId);
      if (task) {
        task.done = done !== false;
        data.lastUpdated = new Date().toISOString();
        fs.writeFileSync(TASKS_PATH, JSON.stringify(data, null, 2));
      }
    }

    res.json({ ok: true, notionUpdated, notionPageId });
  } catch (err) {
    console.error('Error completing task:', err);
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

// ââ Bidirectional Sync (dashboard refresh pushes local state, gets merged result) ââ
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

// ââ Action Items API ââ
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

// ââ Open Loops API ââ
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

// ââ Candidates API ââ
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

// ââ Calendar API ââ
const CALENDAR_PATH = path.join(__dirname, 'data', 'calendar.json');

// ââ Live Google Calendar helpers ââ
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
    timeZone: 'America/Los_Angeles'
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
  // Parse local time directly from ISO string (already in PT from GCal API)
  var match = dateTime.match(/T(\d{2}):(\d{2})/);
  if (!match) return '';
  var h = parseInt(match[1], 10);
  var m = parseInt(match[2], 10);
  var ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return m === 0 ? h + ':00 ' + ampm : h + ':' + String(m).padStart(2, '0') + ' ' + ampm;
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

    // Try refresh token
    if (refresh) {
      const fresh = await refreshGoogleToken(refresh);
      if (fresh) { token = fresh; user.accessToken = fresh; }
    }

    if (token) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setDate(end.getDate() + 7);

      const results = await Promise.all(
        CAL_IDS.map(id => fetchGCalEvents(token, id, now, end))
      );

      // Check if we actually got events (no 403s)
      const totalEvents = results.reduce((sum, r) => sum + r.items.length, 0);

      if (totalEvents > 0) {
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
          results[idx].items.forEach(ev => {
            if (!ev.start?.dateTime) return;
            const key = ev.start.dateTime.slice(0, 10);
            if (dayMap[key]) {
              dayMap[key][name].push(...transformEvents([ev]));
            }
          });
        });

        const calendarDays = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
        const payload = { calendarDays, lastUpdated: new Date().toISOString(), source: 'live' };

        // Cache successful live data
        const dir = path.dirname(CALENDAR_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CALENDAR_PATH, JSON.stringify(payload, null, 2));

        return res.json(payload);
      }
    }

    // Fallback: serve cached file (kept fresh by scheduled task)
    if (fs.existsSync(CALENDAR_PATH)) {
      return res.json(JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf8')));
    }
    res.json({ calendarDays: [], lastUpdated: null });
  } catch (err) {
    console.error('Error in calendar endpoint:', err);
    if (fs.existsSync(CALENDAR_PATH)) {
      return res.json(JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf8')));
    }
    res.status(500).json({ error: 'Failed to fetch calendar' });
  }
});

app.get('/api/calendar/debug', ensureAuth, async (req, res) => {
  try {
    const user = req.user;
    let token = user?.accessToken;
    const refresh = user?.refreshToken;
    if (refresh) {
      const fresh = await refreshGoogleToken(refresh);
      if (fresh) { token = fresh; user.accessToken = fresh; }
    }
    if (!token) return res.json({ error: 'no token', hasRefresh: !!refresh });

    const tests = ['primary', 'rishabh@fermatcommerce.com', 'shreyas@fermatcommerce.com'];
    const results = [];
    const now = new Date();
    now.setHours(0,0,0,0);
    const end = new Date(now); end.setDate(end.getDate() + 1);
    for (const calId of tests) {
      const params = new URLSearchParams({
        timeMin: now.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: 'true',
        maxResults: '5',
        timeZone: 'America/New_York'
      });
      const resp = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const body = await resp.text();
      results.push({ calId, status: resp.status, body: body.substring(0, 300) });
    }
    res.json({ email: user?.email, hasToken: !!token, hasRefresh: !!refresh, results });
  } catch (err) {
    res.json({ error: err.message });
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

// ââ Marketing Events API (live from FermÃ t Events calendar) ââ
const EVENTS_PATH = path.join(__dirname, 'data', 'events.json');
const FERMAT_EVENTS_CAL = 'c_e611ed498cde340f125c26be2ef1b329409ea41fe820481f13eacc332e7c0446@group.calendar.google.com';

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function shortName(name) {
  // Abbreviate common event names
  const abbrevs = {
    'salesforce team kick off': 'Salesforce SKO',
    'shoptalk spring': 'Shoptalk',
    'cannes lions': 'Cannes Lions',
    'dreamforce salesforce': 'Dreamforce',
    'connections - salesforce': 'Connections',
    'cab spring': 'CAB Spring',
    'cab fall': 'CAB Fall',
    'tinuiti live': 'Tinuiti Live',
    'retail ai summit': 'Retail AI Summit'
  };
  const lower = name.toLowerCase().replace(/ - .*$/, '').trim();
  for (const [key, val] of Object.entries(abbrevs)) {
    if (lower.startsWith(key)) return val;
  }
  // Default: first 3 words, max 25 chars
  const words = name.replace(/ - .*$/, '').trim().split(/\s+/).slice(0, 3).join(' ');
  return words.length > 25 ? words.slice(0, 25) + 'â¦' : words;
}

function fmtDateRange(startDate, endDate) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const s = new Date(startDate + 'T12:00:00');
  const e = new Date(endDate + 'T12:00:00');
  e.setDate(e.getDate() - 1); // GCal end dates are exclusive
  if (s.getMonth() === e.getMonth()) {
    return `${months[s.getMonth()]} ${s.getDate()}-${e.getDate()}, ${s.getFullYear()}`;
  }
  return `${months[s.getMonth()]} ${s.getDate()} - ${months[e.getMonth()]} ${e.getDate()}, ${s.getFullYear()}`;
}

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
}

function extractNotionLink(desc) {
  if (!desc) return '';
  const match = desc.match(/https:\/\/www\.notion\.so\/fermat-commerce\/[^\s"<)]+/);
  return match ? match[0] : '';
}

function deriveEventStatus(startDate, endDate) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const s = new Date(startDate + 'T00:00:00');
  const e = new Date(endDate + 'T00:00:00');
  if (now >= s && now < e) return 'In Progress';
  if (now >= e) return 'Completed';
  return 'Confirmed';
}

function extractCity(location) {
  if (!location) return '';
  // Try to get city from "Venue, Address, City, State ZIP, Country"
  const parts = location.split(',').map(p => p.trim());
  if (parts.length >= 3) return parts[parts.length - 3] + ', ' + parts[parts.length - 2].replace(/\s+\d{5}.*/, '');
  if (parts.length >= 2) return parts[1];
  return location;
}

function transformToMktEvents(calItems) {
  // Filter to all-day events only (multi-day conferences, not individual sessions)
  const allDay = calItems.filter(ev => ev.start?.date && ev.end?.date);

  return allDay.map(ev => {
    const startDate = ev.start.date;
    const endDateExclusive = ev.end.date;
    // Compute inclusive endDate
    const endD = new Date(endDateExclusive + 'T12:00:00');
    endD.setDate(endD.getDate() - 1);
    const endDate = endD.toISOString().slice(0, 10);

    const desc = ev.description || '';
    const plainDesc = stripHtml(desc);
    const attendees = ev.attendees || [];
    const fermatTeam = attendees
      .filter(a => a.email?.endsWith('@fermatcommerce.com'))
      .map(a => a.displayName || a.email.split('@')[0]);

    const hasRishabh = attendees.some(a => a.email === 'rishabh@fermatcommerce.com');
    const hasShreyas = attendees.some(a => a.email === 'shreyas@fermatcommerce.com');
    const teamNames = fermatTeam.filter(n =>
      !['rishabh', 'shreyas', 'Rishabh Jain', 'Shreyas Kulkarni'].includes(n)
    );

    // Try to determine if virtual
    const isVirtual = !ev.location && (desc.includes('zoom') || desc.includes('luma.com') || desc.includes('webinar'));
    const locStr = ev.location || '';

    return {
      id: slugify(ev.summary || 'event-' + startDate),
      name: ev.summary || 'Untitled Event',
      shortName: shortName(ev.summary || 'Event'),
      dates: fmtDateRange(startDate, endDateExclusive),
      startDate,
      endDate,
      location: extractCity(locStr),
      venue: locStr.split(',')[0] || '',
      type: isVirtual ? 'Event: Virtual' : 'Event: IRL',
      status: deriveEventStatus(startDate, endDateExclusive),
      description: plainDesc.slice(0, 500),
      rishabh: hasRishabh,
      shreyas: hasShreyas,
      team: teamNames,
      todos: [],
      calendarLink: ev.htmlLink || '',
      notionLink: extractNotionLink(desc),
      details: {
        attendees: attendees.length > 0
          ? `${attendees.length} attendee${attendees.length > 1 ? 's' : ''}`
          : '',
        fermatTeam: fermatTeam.join(', ')
      }
    };
  }).sort((a, b) => a.startDate.localeCompare(b.startDate));
}

// ââ Event Enrichment Data (from Notion, Slack, Granola, Gmail) ââ
const EVENT_ENRICHMENT = {
  'shoptalk': {
    notionLink: 'https://www.notion.so/fermat-commerce/3121ad76fd2a804c9027f08c6025a87f',
    venue: 'Mandalay Bay Convention Center',
    location: 'Las Vegas, NV',
    type: 'Event: IRL',
    description: 'GlamSuite activation at Mandalay Bay â 30 controlled appointment slots targeting 20-24 enterprise retailers ($100M+ GMV). U Beauty case study ready for showcase. Lead list negotiated with Shoptalk team. 700-attendee CommerceNext party co-hosting.',
    team: ['Maya Juchtman', 'Gillian', 'Jess', 'Stephen'],
    details: {
      goal: 'Influenced pipeline target: $600K-$1.2M',
      format: '30 controlled appointment slots over 2 days',
      targetAccounts: 'Gap (CTO Sven Gerjets), Macy\'s (Max Magni), American Eagle (Craig Brommers), ELC, Lululemon (CAITO Ranju Das)',
      activationType: 'GlamSuite â branded activation booth + exec meetings',
      keyIntel: 'Gillian targeting Gap CTO + Macy\'s + AE. Jess targeting Lululemon CAITO. Stephen monitoring Walmart. ELC executive dinner planned.',
      owner: 'Maya Juchtman',
      successMetrics: '20-24 qualified meetings with enterprise retailers ($100M+ GMV)'
    }
  },
  'cannes': {
    notionLink: 'https://www.notion.so/fermat-commerce/2231ad76fd2a8010b171fe03d6d26e4c',
    venue: 'Coco Loco',
    location: 'Cannes, France',
    type: 'Event: IRL',
    description: '"The Oasis at Cannes Lions 2026" â two-day lounge activation June 22-23 at Coco Loco. Partners: FERMÃT, VMG, Attentive. Fireside chats, Caribbean food & cocktails. Adweek sponsorship confirmed. Affiliate partnership with Attentive approved.',
    team: ['Maya Juchtman', 'Alice Zhao'],
    details: {
      goal: 'Brand presence at premier advertising festival; executive relationship building',
      format: 'Two-day lounge activation with fireside chats, Caribbean theme',
      partners: 'VMG (co-host), Attentive (affiliate partner), Adweek (media sponsor)',
      activationType: 'The Oasis â branded lounge with programming',
      keyIntel: 'VMG workshop confirmed. Attentive joining as partner. Villa being booked via Fora Travel (Alice Zhao coordinating). Adweek sponsorship secured.',
      owner: 'Maya Juchtman',
      travelNote: 'Villa arrangements via Fora Travel agent Alice Zhao'
    }
  },
  'cab spring': {
    notionLink: 'https://www.notion.so/fermat-commerce/2f01ad76fd2a80158e3ede34eb6b3a11',
    description: '2nd Customer Advisory Board â customer retention and strategic feedback event. Focus on deepening relationships with existing enterprise customers and gathering product feedback.',
    details: {
      goal: 'Customer retention + strategic product feedback',
      format: 'Customer Advisory Board meeting',
      activationType: 'CAB â intimate executive roundtable',
      keyIntel: 'Second CAB session. Bissell has expressed interest in participating.',
      owner: 'Sophie'
    }
  },
  'tinuiti live': {
    notionLink: 'https://www.notion.so/fermat-commerce/3221ad76fd2a80f9bd79c22377c63a21',
    venue: 'Civic Hall',
    location: 'New York, NY',
    type: 'Event: IRL',
    description: 'Tinuiti Live at Civic Hall NYC â Travel Sponsor ($7,500 investment). 250+ in-person attendees, 10 travel stipends included. Positioning: "From Performance Ads to Performance Experiences."',
    details: {
      goal: 'Brand positioning as performance experience leader; lead generation',
      format: '250+ in-person conference',
      sponsorshipTier: 'Travel Sponsor â $7,500',
      perks: '10 travel stipends, brand presence',
      activationType: 'Sponsored conference with speaking opportunity',
      keyIntel: 'Messaging theme: "From Performance Ads to Performance Experiences." Strong DTC and retail audience.',
      owner: 'Maya Juchtman'
    }
  },
  'beyond the buy box': {
    notionLink: 'https://www.notion.so/fermat-commerce/31f1ad76fd2a80078868e0a8fb1df1a7',
    venue: 'Amazon Studios',
    location: 'Culver City, CA',
    type: 'Event: IRL',
    description: 'Tinuiti x Amazon symposium at Amazon Studios â ~40-45 attendees, intimate executive format. Jess McDaid attending. Targets: Sony, Skechers, Carter\'s, NÃ©cessaire.',
    team: ['Jess McDaid'],
    details: {
      goal: 'Executive-level relationship building with Amazon-focused brands',
      format: 'Intimate symposium, ~40-45 attendees',
      targetAccounts: 'Sony, Skechers, Carter\'s, NÃ©cessaire',
      activationType: 'Tinuiti/Amazon co-hosted executive symposium',
      keyIntel: 'Jess McDaid is primary attendee. High-value networking with Amazon-centric enterprise brands.',
      owner: 'Marketing'
    }
  },
  'salesforce': {
    notionLink: '',
    description: 'Salesforce Team Kick Off in Atlanta â 200 Salesforce org attendees. Studio Science co-sponsoring. Strong partner alignment opportunity.',
    details: {
      goal: 'Partner ecosystem alignment with Salesforce',
      format: 'Team kickoff event, 200 attendees',
      keyIntel: 'Studio Science co-sponsoring. Good opportunity for Salesforce Commerce Cloud integration positioning.',
      owner: 'Marketing'
    }
  },
  'etail': {
    description: 'eTail West â completed successfully. Storm King dinner held. Met with HP, Sephora, Bose, Bombas. Strong brand engagement.',
    details: {
      keyIntel: 'Successful event. Storm King dinner highlight. Key meetings: HP, Sephora, Bose, Bombas.',
      owner: 'Marketing'
    }
  },
  'c-suite': {
    description: 'C-Suite Webinar â 20-person peer-to-peer format. Intimate executive digital event for senior leadership.',
    type: 'Event: Virtual',
    details: {
      goal: 'Executive thought leadership and relationship building',
      format: '20-person peer-to-peer webinar',
      activationType: 'Virtual executive roundtable',
      keyIntel: 'Small, curated format designed for high engagement with C-level prospects.',
      owner: 'Marketing'
    }
  },
  'millennium': {
    description: 'Millennium Alliance meetings â executive networking series. Ongoing relationship building with enterprise decision-makers.',
    details: {
      goal: 'Enterprise executive pipeline development',
      format: 'Curated executive meetings',
      owner: 'Marketing'
    }
  },
  'retail ai': {
    description: 'Retail AI Summit â industry conference focused on AI applications in retail and commerce.',
    details: {
      goal: 'Position FERMÃT as AI-forward commerce platform',
      format: 'Industry conference',
      owner: 'Marketing'
    }
  }
};

function enrichEvents(events) {
  return events.map(ev => {
    const nameLower = (ev.name || '').toLowerCase();
    let enrichment = null;

    // Match event to enrichment data by keyword
    for (const [key, data] of Object.entries(EVENT_ENRICHMENT)) {
      if (nameLower.includes(key)) {
        enrichment = data;
        break;
      }
    }

    if (!enrichment) return ev;

    // Merge enrichment â only override empty/default fields
    const enriched = { ...ev };

    if (enrichment.notionLink && !enriched.notionLink) {
      enriched.notionLink = enrichment.notionLink;
    }
    if (enrichment.venue && (!enriched.venue || enriched.venue === '')) {
      enriched.venue = enrichment.venue;
    }
    if (enrichment.location && (!enriched.location || enriched.location === '')) {
      enriched.location = enrichment.location;
    }
    if (enrichment.type) {
      enriched.type = enrichment.type;
    }
    if (enrichment.description && (!enriched.description || enriched.description.length < 50)) {
      enriched.description = enrichment.description;
    }
    if (enrichment.team && enriched.team.length === 0) {
      enriched.team = enrichment.team;
    }

    // Deep-merge details
    enriched.details = { ...enriched.details, ...(enrichment.details || {}) };

    return enriched;
  });
}

app.get('/api/events', ensureAuth, async (req, res) => {
  try {
    const user = req.user;
    let token = user?.accessToken;
    const refresh = user?.refreshToken;

    if (refresh) {
      const fresh = await refreshGoogleToken(refresh);
      if (fresh) { token = fresh; user.accessToken = fresh; }
    }

    if (token) {
      const now = new Date();
      // Look back 30 days and forward 12 months
      const timeMin = new Date(now);
      timeMin.setDate(timeMin.getDate() - 30);
      const timeMax = new Date(now);
      timeMax.setMonth(timeMax.getMonth() + 12);

      const result = await fetchGCalEvents(token, FERMAT_EVENTS_CAL, timeMin, timeMax);

      if (result.items && result.items.length > 0 && !result.error) {
        const rawEvents = transformToMktEvents(result.items);
        const events = enrichEvents(rawEvents);
        const payload = { events, lastUpdated: new Date().toISOString(), source: 'live' };

        // Cache for fallback
        const dir = path.dirname(EVENTS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(EVENTS_PATH, JSON.stringify(payload, null, 2));

        return res.json(payload);
      }
    }

    // Fallback: cached file
    if (fs.existsSync(EVENTS_PATH)) {
      return res.json(JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf8')));
    }
    res.json({ events: [], lastUpdated: null });
  } catch (err) {
    console.error('Error in events endpoint:', err);
    if (fs.existsSync(EVENTS_PATH)) {
      return res.json(JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf8')));
    }
    res.status(500).json({ error: 'Failed to fetch events' });
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

// ââ Utilities API ââ
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

// ââ Weekly Pulse API ââ
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

// ââ FPPC Events API ââ
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


// ── News Feed API (Daily Brief tab) ──
const NEWS_PATH = path.join(__dirname, 'data', 'news.json');

app.get('/api/news', ensureAuth, (req, res) => {
  try {
    if (fs.existsSync(NEWS_PATH)) {
      const data = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf8'));
      res.json(data);
    } else {
      res.json({ newsFeed: [], newsDigest: null, fermatNewsroom: [], lastUpdated: null });
    }
  } catch (err) {
    console.error('Error reading news:', err);
    res.status(500).json({ error: 'Failed to read news' });
  }
});

app.post('/api/news', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!API_KEY || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  try {
    const dir = path.dirname(NEWS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = { ...req.body, lastUpdated: new Date().toISOString() };
    fs.writeFileSync(NEWS_PATH, JSON.stringify(data, null, 2));
    res.json({ ok: true, savedAt: data.lastUpdated });
  } catch (err) {
    console.error('Error writing news:', err);
    res.status(500).json({ error: 'Failed to write news' });
  }
});

// ── Weekly Pulse API ──
const PULSE_PATH = path.join(__dirname, 'data', 'pulse.json');

app.get('/api/pulse', ensureAuth, (req, res) => {
  try {
    if (fs.existsSync(PULSE_PATH)) {
      const data = JSON.parse(fs.readFileSync(PULSE_PATH, 'utf8'));
      res.json(data);
    } else {
      res.json({ weeklyPulse: null, lastUpdated: null });
    }
  } catch (err) {
    console.error('Error reading pulse:', err);
    res.status(500).json({ error: 'Failed to read pulse' });
  }
});

app.post('/api/pulse', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!API_KEY || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  try {
    const dir = path.dirname(PULSE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = { ...req.body, lastUpdated: new Date().toISOString() };
    fs.writeFileSync(PULSE_PATH, JSON.stringify(data, null, 2));
    res.json({ ok: true, savedAt: data.lastUpdated });
  } catch (err) {
    console.error('Error writing pulse:', err);
    res.status(500).json({ error: 'Failed to write pulse' });
  }
});

// ââ Protected dashboard ââ
app.get('/', ensureAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.use(ensureAuth, express.static(__dirname));

// ââ Start ââ
app.listen(PORT, () => {
  console.log(`Dashboard running on ${BASE_URL}`);
  if (!GOOGLE_CLIENT_ID) console.log('\u26a0\ufe0f GOOGLE_CLIENT_ID not set - auth disabled (dev mode)');
});
