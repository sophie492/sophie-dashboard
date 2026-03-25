const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const path = require('path');
const fs = require('fs');
const { Client } = require('@notionhq/client');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Config ──
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET       = process.env.SESSION_SECRET || 'sophie-dashboard-secret-change-me';
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : process.env.BASE_URL || `http://localhost:${PORT}`;

// Allowed email domain
const ALLOWED_DOMAIN = 'fermatcommerce.com';

// ── Notion Config ──
const NOTION_API_KEY     = process.env.NOTION_API_KEY;
const NOTION_TASKS_DB_ID = process.env.NOTION_TASKS_DB_ID || 'ec04c3e35f534ee487592c1fb304991e';
const notion = NOTION_API_KEY ? new Client({ auth: NOTION_API_KEY }) : null;

// ── Session ──
app.set('trust proxy', 1);
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
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
      photo: profile.photos?.[0]?.value
    });
  }));
}

// ── Auth routes ──
app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email'], hd: ALLOWED_DOMAIN
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

// ── Notion Tasks API ──
app.get('/api/tasks', ensureAuth, async (req, res) => {
  if (!notion) {
    return res.json({ tasks: [], error: 'Notion not configured', source: 'none' });
  }
  try {
    const response = await notion.databases.query({
      database_id: NOTION_TASKS_DB_ID,
      filter: {
        and: [
          { property: 'Done', checkbox: { equals: false } },
          {
            or: [
              { property: 'Task', title: { does_not_contain: '[ARCHIVED]' } }
            ]
          }
        ]
      },
      sorts: [
        { property: 'Priority', direction: 'ascending' },
        { property: 'Due Date', direction: 'ascending' }
      ]
    });

    const priorityOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };

    const tasks = response.results.map(page => {
      const props = page.properties;
      const title = props['Task']?.title?.map(t => t.plain_text).join('') || '';
      const done = props['Done']?.checkbox || false;
      const priority = props['Priority']?.select?.name || 'Medium';
      const dueDate = props['Due Date']?.date?.start || null;
      const source = props['Source']?.rich_text?.map(t => t.plain_text).join('') || '';
      const sourceLink = props['Source Link']?.url || '';

      return {
        id: page.id,
        title,
        done,
        priority,
        due: dueDate,
        context: source || (sourceLink ? `Source: ${sourceLink}` : 'From Notion Task Tracker')
      };
    });

    // Sort: High > Medium > Low, then by due date
    tasks.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 1;
      const pb = priorityOrder[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      if (a.due && b.due) return a.due.localeCompare(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return 0;
    });

    res.json({ tasks, lastUpdated: new Date().toISOString(), source: 'notion' });
  } catch (err) {
    console.error('Error fetching Notion tasks:', err);
    res.status(500).json({ tasks: [], error: 'Failed to fetch tasks from Notion' });
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

const API_KEY = process.env.DASHBOARD_API_KEY;

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

// ── Protected dashboard ──
app.get('/', ensureAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.use(ensureAuth, express.static(__dirname));

// ── Start ──
app.listen(PORT, () => {
  console.log(`Dashboard running on ${BASE_URL}`);
  if (!GOOGLE_CLIENT_ID) console.log('\u26a0\ufe0f GOOGLE_CLIENT_ID not set — auth disabled (dev mode)');
  if (!NOTION_API_KEY) console.log('\u26a0\ufe0f NOTION_API_KEY not set — /api/tasks will return empty');
  else console.log('\u2705 Notion integration active — DB: ' + NOTION_TASKS_DB_ID);
});
