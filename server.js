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

app.post('/api/tasks', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!API_KEY || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Invalid or missing API key' });

// ── Manual Task Add (from dashboard UI → server → synced to Notion by Cowork) ──
const MANUAL_TASKS_PATH = path.join(__dirname, 'data', 'manual-tasks.json');

app.post('/api/tasks/add', ensureAuth, (req, res) => {
  try {
    const { title, priority } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const id = 'manual-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const task = { id, title, text: title, done: false, priority: priority || 'Medium', due: null, context: 'Manual', owner: 'Sophie', notionSynced: false, addedAt: new Date().toISOString() };
    // Append to manual-tasks queue for Notion sync
    const dir = path.dirname(MANUAL_TASKS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const existing = fs.existsSync(MANUAL_TASKS_PATH) ? JSON.parse(fs.readFileSync(MANUAL_TASKS_PATH, 'utf8')) : [];
    existing.push(task);
    fs.writeFileSync(MANUAL_TASKS_PATH, JSON.stringify(existing, null, 2));
    // Also append to the main tasks.json so it shows immediately
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
});
  }
  try {
    const dir = path.dirname(TASKS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TASKS_PATH, JSON.stringify(req.body, null, 2));
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error writing tasks:', err);
    res.status(500).json({ error: 'Failed to write tasks' });
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
