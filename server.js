const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const cookieParser = require('cookie-parser');
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
app.use(cookieParser());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 90 * 24 * 60 * 60 * 1000 // 90 days — "trust this device"
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
  (req, res) => {
    // Set a long-lived remember-me cookie that survives server restarts
    const crypto = require('crypto');
    const payload = JSON.stringify({ email: req.user.email, name: req.user.name, id: req.user.id });
    const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    const token = Buffer.from(payload).toString('base64') + '.' + hmac;
    res.cookie('remember_me', token, {
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    res.redirect('/');
  }
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

  // Check remember-me cookie — auto-login without OAuth redirect
  const token = req.cookies?.remember_me;
  if (token) {
    try {
      const crypto = require('crypto');
      const [payloadB64, hmac] = token.split('.');
      const payload = Buffer.from(payloadB64, 'base64').toString('utf8');
      const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
      if (hmac === expected) {
        const user = JSON.parse(payload);
        if (user.email && user.email.endsWith('@' + ALLOWED_DOMAIN)) {
          req.login(user, (err) => {
            if (err) return res.redirect('/auth/google');
            return next();
          });
          return;
        }
      }
    } catch (e) { /* invalid cookie, fall through to OAuth */ }
  }

  res.redirect('/auth/google');
}

// ââ JSON body parsing ââ
app.use(express.json({ limit: '1mb' }));

// ââ Health check ââ
app.get('/health', (req, res) => res.json({
  status: 'ok',
  notion: !!NOTION_TOKEN,
  notionClient: !!notion,
  notionDbId: NOTION_DB_ID ? NOTION_DB_ID.slice(0,8)+'...' : null,
  tasksJsonExists: fs.existsSync(path.join(__dirname, 'data', 'tasks.json')),
  manualTasksJsonExists: fs.existsSync(path.join(__dirname, 'data', 'manual-tasks.json'))
}));

// ── Direct Notion task toggle — no session auth required, uses API key ──
app.post('/api/notion/toggle-task', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== (process.env.DASHBOARD_API_KEY || 'sophie-dashboard-secret-change-me')) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  if (!notion) return res.status(503).json({ error: 'Notion not configured' });
  const { pageId, done } = req.body;
  if (!pageId) return res.status(400).json({ error: 'pageId required' });
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: { Done: { checkbox: !!done } }
    });
    console.log(`[Notion Direct] ${done ? 'Checked' : 'Unchecked'}: ${pageId}`);
    res.json({ ok: true, notionUpdated: true, pageId });
  } catch (err) {
    console.error(`[Notion Direct] Failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── Direct Notion task creation — no session auth, uses API key ──
app.post('/api/notion/create-task', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== (process.env.DASHBOARD_API_KEY || 'sophie-dashboard-secret-change-me')) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  if (!notion) return res.status(503).json({ error: 'Notion not configured' });
  const { title, priority } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  try {
    const notionTitle = '[Sophie] ' + title;
    const pageId = await createNotionTask({ title: notionTitle, priority: priority || 'Medium', source: 'Dashboard' });
    console.log(`[Notion Direct] Created task: "${title}" -> ${pageId}`);
    res.json({ ok: true, notionPageId: pageId });
  } catch (err) {
    console.error(`[Notion Direct] Create failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── Live CEO Action Items from Notion ──
const NOTION_ACTION_ITEMS_DB = 'a4ad0b7234f44b5eb568fc270e253b09';

app.get('/api/action-items/live', async (req, res) => {
  // No session auth — use API key or allow unauthenticated (read-only summary)
  if (!notion) return res.status(503).json({ error: 'Notion not configured' });
  try {
    const response = await notion.databases.query({
      database_id: NOTION_ACTION_ITEMS_DB,
      filter: {
        or: [
          { property: 'Status', select: { equals: 'Open' } },
          { property: 'Status', select: { equals: 'Stale' } },
          { property: 'Status', select: { equals: 'Escalated' } }
        ]
      },
      sorts: [{ property: 'Priority', direction: 'ascending' }]
    });

    const items = response.results.map(page => {
      const p = page.properties;
      const title = p['Action Item']?.title?.[0]?.plain_text || '';
      const status = p.Status?.select?.name || 'Open';
      const priorityRaw = p.Priority?.select?.name || 'Medium';
      const category = p.Category?.select?.name || '';
      const owner = p.Owner?.select?.name || category.split(' ')[0] || '';
      const account = p.Account?.rich_text?.[0]?.plain_text || '';
      const dateRaised = p['Date Raised']?.date?.start || '';
      const source = p.Source?.rich_text?.[0]?.plain_text || '';

      // Map priority to dashboard color
      let priority = 'yellow';
      if (priorityRaw === 'High' || status === 'Stale' || status === 'Escalated') priority = 'red';
      else if (priorityRaw === 'Low') priority = 'green';

      // Calculate age
      let age = '';
      if (dateRaised) {
        const days = Math.floor((Date.now() - new Date(dateRaised).getTime()) / 86400000);
        age = days + 'd';
      }

      // Determine owner for person filtering
      let personOwner = '';
      if (category.includes('Rishabh')) personOwner = 'Rishabh';
      else if (category.includes('Shreyas')) personOwner = 'Shreyas';
      else if (category.includes('Sophie')) personOwner = 'Sophie';

      return {
        text: title + (account ? ' — ' + account : '') + (status === 'Stale' ? ' [STALE ' + age + ']' : ''),
        priority,
        source: source || 'Notion',
        owner: personOwner,
        category,
        age,
        status,
        notionId: page.id
      };
    });

    res.json({
      items,
      totalToday: items.length,
      lastUpdated: new Date().toISOString(),
      source: 'notion-ceo-brief'
    });
  } catch (err) {
    console.error('[Notion Live] Action items query failed:', err.message);
    res.status(500).json({ error: 'Notion query failed' });
  }
});

// ── Resolve/Create CEO Action Items in Notion ──
app.post('/api/action-items/resolve', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== (process.env.DASHBOARD_API_KEY || 'sophie-dashboard-secret-change-me')) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  if (!notion) return res.status(503).json({ error: 'Notion not configured' });
  const { notionId, resolution } = req.body;
  if (!notionId) return res.status(400).json({ error: 'notionId required' });
  try {
    const props = { Status: { select: { name: 'Done' } } };
    if (resolution) props['Resolution Notes'] = { rich_text: [{ text: { content: resolution } }] };
    await notion.pages.update({ page_id: notionId, properties: props });
    console.log(`[Action Items] Resolved: ${notionId}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Action Items] Resolve failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/action-items/create', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== (process.env.DASHBOARD_API_KEY || 'sophie-dashboard-secret-change-me')) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  if (!notion) return res.status(503).json({ error: 'Notion not configured' });
  const { text, priority, category } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const properties = {
      'Action Item': { title: [{ text: { content: text } }] },
      Status: { select: { name: 'Open' } },
      Priority: { select: { name: priority === 'red' ? 'High' : priority === 'green' ? 'Low' : 'Medium' } },
      Category: { select: { name: category || 'Rishabh to act' } },
      'Date Raised': { date: { start: new Date().toISOString().slice(0, 10) } },
      Source: { rich_text: [{ text: { content: 'Dashboard' } }] }
    };
    const page = await notion.pages.create({ parent: { database_id: NOTION_ACTION_ITEMS_DB }, properties });
    console.log(`[Action Items] Created: "${text}" -> ${page.id}`);
    res.json({ ok: true, notionId: page.id });
  } catch (err) {
    console.error('[Action Items] Create failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Checkbox State Persistence (all task lists) ──
const CHECKBOX_PATH = path.join(__dirname, 'data', 'checkbox-states.json');

function loadCheckboxStates() {
  try { return fs.existsSync(CHECKBOX_PATH) ? JSON.parse(fs.readFileSync(CHECKBOX_PATH, 'utf8')) : {}; } catch(e) { return {}; }
}
function saveCheckboxStates(states) {
  const dir = path.dirname(CHECKBOX_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CHECKBOX_PATH, JSON.stringify(states, null, 2));
}

app.get('/api/checkbox-states', (req, res) => {
  res.json(loadCheckboxStates());
});

app.post('/api/checkbox-states', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== (process.env.DASHBOARD_API_KEY || 'sophie-dashboard-secret-change-me')) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  try {
    const { key, checked } = req.body;
    if (!key) return res.status(400).json({ error: 'key required' });
    const states = loadCheckboxStates();
    states[key] = { checked: !!checked, updatedAt: new Date().toISOString() };
    saveCheckboxStates(states);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Toggle Notion to_do block by text match ──
app.post('/api/notion/toggle-todo', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== (process.env.DASHBOARD_API_KEY || 'sophie-dashboard-secret-change-me')) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  if (!notion) return res.status(503).json({ error: 'Notion not configured' });
  const { pageId, text, checked } = req.body;
  if (!pageId || !text) return res.status(400).json({ error: 'pageId and text required' });
  try {
    // Get all blocks from the page
    let allBlocks = [];
    let cursor;
    do {
      const resp = await notion.blocks.children.list({ block_id: pageId, page_size: 100, start_cursor: cursor });
      allBlocks = allBlocks.concat(resp.results);
      cursor = resp.has_more ? resp.next_cursor : null;
    } while (cursor);

    // Find the matching to_do block by text
    const normalize = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const targetNorm = normalize(text);
    const match = allBlocks.find(b => {
      if (b.type !== 'to_do') return false;
      const blockText = (b.to_do.rich_text || []).map(t => t.plain_text).join('');
      return normalize(blockText).includes(targetNorm.slice(0, 30)) || targetNorm.includes(normalize(blockText).slice(0, 30));
    });

    if (!match) return res.status(404).json({ error: 'to_do block not found for: ' + text.slice(0, 40) });

    await notion.blocks.update({
      block_id: match.id,
      to_do: { checked: !!checked }
    });
    console.log(`[Notion] Toggled to_do "${text.slice(0, 30)}" → ${checked}`);
    res.json({ ok: true, blockId: match.id });
  } catch (err) {
    console.error('[Notion] Toggle to_do failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── CEO Brief Data Storage ──
const BRIEF_PATH = path.join(__dirname, 'data', 'ceo-brief.json');

app.get('/api/ceo-brief', (req, res) => {
  // No auth required — read-only summary data
  try {
    if (fs.existsSync(BRIEF_PATH)) {
      const data = JSON.parse(fs.readFileSync(BRIEF_PATH, 'utf8'));
      res.json(data);
    } else {
      res.json({ flagged: [], priorities: [], actionItems: [], lastUpdated: null });
    }
  } catch (err) {
    console.error('Error reading CEO brief:', err);
    res.status(500).json({ error: 'Failed to read brief data' });
  }
});

app.post('/api/ceo-brief', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== (process.env.DASHBOARD_API_KEY || 'sophie-dashboard-secret-change-me')) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  try {
    const dir = path.dirname(BRIEF_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = { ...req.body, lastUpdated: new Date().toISOString() };
    fs.writeFileSync(BRIEF_PATH, JSON.stringify(data, null, 2));
    console.log('[CEO Brief] Data saved:', data.flagged?.length, 'flagged,', data.priorities?.length, 'priorities');
    res.json({ ok: true, savedAt: data.lastUpdated });
  } catch (err) {
    console.error('Error writing CEO brief:', err);
    res.status(500).json({ error: 'Failed to write brief data' });
  }
});

// Notion write test (remove after debugging)
app.get('/health/notion-test', async (req, res) => {
  if (!notion) return res.json({ error: 'notion client is null', NOTION_TOKEN: !!NOTION_TOKEN });
  try {
    // Try to read a known task
    const testId = '3301ad76-fd2a-812f-a13c-f5b1b927fcda';
    const page = await notion.pages.retrieve({ page_id: testId });
    const done = page.properties.Done?.checkbox;
    // Toggle it and toggle back
    await notion.pages.update({ page_id: testId, properties: { Done: { checkbox: !done } } });
    await notion.pages.update({ page_id: testId, properties: { Done: { checkbox: done } } });
    res.json({ success: true, taskTitle: page.properties.Task?.title?.[0]?.plain_text, doneState: done, message: 'Toggled and restored' });
  } catch (err) {
    res.json({ error: err.message, code: err.code });
  }
});

const API_KEY = process.env.DASHBOARD_API_KEY;

// -- Notion integration (bidirectional sync) --
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID || 'ec04c3e35f534ee487592c1fb304991e';
const notion = NOTION_TOKEN ? new Client({ auth: NOTION_TOKEN }) : null;
if (notion) console.log('[Notion] Integration enabled, DB:', NOTION_DB_ID);
else console.log('[Notion] No NOTION_TOKEN set - write-back disabled');

async function createNotionTask({ title, priority, due, source }) {
  if (!notion || !NOTION_DB_ID) return null;
  try {
    // Dedup check: search Notion for similar tasks before creating
    const existing = await notion.databases.query({
      database_id: NOTION_DB_ID,
      filter: {
        and: [
          { property: 'Task', title: { does_not_contain: '[ARCHIVED]' } },
          { property: 'Done', checkbox: { equals: false } }
        ]
      },
      page_size: 100
    });
    const newTitle = title.replace(/^\[Sophie\]\s*/i, '').toLowerCase();
    for (const page of existing.results) {
      const existingTitle = (page.properties.Task?.title?.[0]?.plain_text || '').replace(/^\[Sophie\]\s*/i, '').toLowerCase();
      // Check similarity using the dedup engine
      if (typeof taskSimilarity === 'function') {
        const score = taskSimilarity(newTitle, existingTitle);
        if (score >= DEDUP_THRESHOLD) {
          console.log(`[Notion] Skipped duplicate: "${title}" matches "${existingTitle}" (score: ${score.toFixed(2)})`);
          return page.id; // Return existing page ID instead of creating
        }
      } else {
        // Fallback: exact normalized match
        const normNew = newTitle.replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
        const normExisting = existingTitle.replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
        if (normNew === normExisting) {
          console.log(`[Notion] Skipped exact duplicate: "${title}"`);
          return page.id;
        }
      }
    }

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

async function archiveNotionTask(notionPageId, currentTitle) {
  if (!notion || !notionPageId) return false;
  try {
    const archivedTitle = currentTitle.startsWith('[ARCHIVED]') ? currentTitle : '[ARCHIVED] ' + currentTitle;
    await notion.pages.update({
      page_id: notionPageId,
      properties: {
        Task: { title: [{ text: { content: archivedTitle } }] },
        Done: { checkbox: true }
      }
    });
    console.log(`[Notion] Archived + marked done: ${notionPageId}`);
    return true;
  } catch (err) {
    console.error('[Notion] Failed to archive:', err.message);
    return false;
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
    const task = { id, title, text: title, done: false, priority: priority || 'Medium', due: null, context: 'Manual', owner: 'Sophie', notionSynced: false, addedAt: new Date().toISOString(), lastModifiedAt: new Date().toISOString(), lastModifiedBy: 'dashboard' };
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
    console.log(`[Complete] Received: taskId=${taskId}, title=${(title||'').slice(0,40)}, done=${done}`);
    if (!taskId && !title) return res.status(400).json({ error: 'taskId or title required' });

    // 1. Find the Notion page ID
    let notionPageId = null;

    // Check if taskId itself is a valid Notion UUID (from live endpoint)
    if (taskId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)) {
      notionPageId = taskId;
    }

    // Check tasks.json
    if (!notionPageId && fs.existsSync(TASKS_PATH)) {
      const data = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
      const task = data.tasks.find(t => t.id === taskId || t.notionPageId === taskId);
      if (task) notionPageId = task.notionPageId;
    }
    if (!notionPageId && fs.existsSync(MANUAL_TASKS_PATH)) {
      const manual = JSON.parse(fs.readFileSync(MANUAL_TASKS_PATH, 'utf8'));
      const task = manual.find(t => t.id === taskId);
      if (task) notionPageId = task.notionPageId;
    }

    // Query Notion directly by title (try with and without [Sophie] prefix)
    if (!notionPageId && title && notion) {
      notionPageId = await findNotionTaskByTitle('[Sophie] ' + title);
      if (!notionPageId) notionPageId = await findNotionTaskByTitle(title);
    }

    // 2. Update Notion
    console.log(`[Complete] Resolved notionPageId=${notionPageId}`);
    let notionUpdated = false;
    if (notionPageId) {
      notionUpdated = await updateNotionTaskDone(notionPageId, done !== false);
      console.log(`[Complete] Notion update result: ${notionUpdated}`);
    } else {
      console.log(`[Complete] WARNING: Could not resolve notionPageId for taskId=${taskId}`);
    }

    // 3. Update local JSON files
    if (fs.existsSync(TASKS_PATH)) {
      const data = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
      const task = data.tasks.find(t => t.id === taskId);
      if (task) {
        task.done = done !== false;
        task.lastModifiedAt = new Date().toISOString();
        task.lastModifiedBy = 'dashboard';
        data.lastUpdated = new Date().toISOString();
        fs.writeFileSync(TASKS_PATH, JSON.stringify(data, null, 2));
      }
    }

    // Also update manual tasks with lastModifiedAt
    if (fs.existsSync(MANUAL_TASKS_PATH)) {
      const manual = JSON.parse(fs.readFileSync(MANUAL_TASKS_PATH, 'utf8'));
      const mt = manual.find(t => t.id === taskId);
      if (mt) {
        mt.lastModifiedAt = new Date().toISOString();
        mt.lastModifiedBy = 'dashboard';
        fs.writeFileSync(MANUAL_TASKS_PATH, JSON.stringify(manual, null, 2));
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
  const attendees = ev.attendees || [];
  const fermatDomain = 'fermatcommerce.com';

  // Filter out resource calendars and the organizer's own email
  const realAttendees = attendees.filter(a => !a.resource && a.email);

  // Check for external attendees (non-fermatcommerce.com)
  const externalAttendees = realAttendees.filter(a => !a.email.endsWith('@' + fermatDomain));
  const internalAttendees = realAttendees.filter(a => a.email.endsWith('@' + fermatDomain));

  // If there are external attendees, it's an external meeting
  if (externalAttendees.length > 0) return 'external';

  // If exactly 2 real attendees (both internal), it's a 1:1
  if (realAttendees.length === 2 && internalAttendees.length === 2) return '1on1';

  // Everything else is internal
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
      const daysAhead = Math.min(parseInt(req.query.days) || 14, 30);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setDate(end.getDate() + daysAhead);

      const results = await Promise.all(
        CAL_IDS.map(id => fetchGCalEvents(token, id, now, end))
      );

      // Check if we actually got events (no 403s)
      const totalEvents = results.reduce((sum, r) => sum + r.items.length, 0);

      if (totalEvents > 0) {
        const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const dayMap = {};

        for (let i = 0; i < daysAhead; i++) {
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


// ── Notion Live Database IDs ──
const NOTION_TASK_DB = process.env.NOTION_DB_ID || 'ec04c3e35f534ee487592c1fb304991e';
const NOTION_MKT_EVENTS_DB = '19fd16cfaa714c6ebc783a8cc23ba1cf';
const NOTION_OFFSITES_PARENT = 'ca7532fd33714488ba26507ff5bed79b';
const NOTION_HACKWEEK_PARENT = '2b01ad76fd2a81a39933d57ffed44277';

// ── Live Tasks from Notion ──
app.get('/api/tasks/live', ensureAuth, async (req, res) => {
  if (!notion) return res.status(503).json({ error: 'Notion not configured' });
  try {
    const response = await notion.databases.query({
      database_id: NOTION_TASK_DB,
      filter: {
        and: [
          { property: 'Task', title: { contains: '[Sophie]' } },
          { property: 'Task', title: { does_not_contain: '[ARCHIVED]' } }
        ]
      },
      sorts: [{ property: 'Priority', direction: 'ascending' }]
    });
    const tasks = response.results.map(page => {
      const props = page.properties;
      const titleRaw = props.Task?.title?.[0]?.plain_text || '';
      const title = titleRaw.replace(/^\[Sophie\]\s*/, '');
      return {
        id: page.id,
        notionPageId: page.id,
        title,
        done: props.Done?.checkbox || false,
        priority: props.Priority?.select?.name || 'Medium',
        due: props['Due Date']?.date?.start || null,
        context: props.Source?.rich_text?.[0]?.plain_text || '',
        sourceLink: props['Source Link']?.url || '',
        owner: 'Sophie'
      };
    });
    res.json({ tasks, lastUpdated: new Date().toISOString(), source: 'notion-live' });
  } catch (err) {
    console.error('[Notion Live] Tasks query failed:', err.message);
    res.status(500).json({ error: 'Notion query failed' });
  }
});

// ── Live MKT Events from Notion ──
app.get('/api/events/live', ensureAuth, async (req, res) => {
  if (!notion) return res.status(503).json({ error: 'Notion not configured' });
  try {
    let allResults = [];
    let cursor;
    do {
      const response = await notion.databases.query({
        database_id: NOTION_MKT_EVENTS_DB,
        page_size: 100,
        start_cursor: cursor
      });
      allResults = allResults.concat(response.results);
      cursor = response.has_more ? response.next_cursor : null;
    } while (cursor);

    const events = allResults.map(page => {
      const props = page.properties;
      const name = props.Name?.title?.[0]?.plain_text || props.Event?.title?.[0]?.plain_text || '';
      const startDate = props['Start Date']?.date?.start || props.Date?.date?.start || props['Event Date']?.date?.start || '';
      const endDate = props['End Date']?.date?.start || props['Start Date']?.date?.end || props.Date?.date?.end || startDate;
      const location = props.Location?.rich_text?.[0]?.plain_text || props.Location?.select?.name || '';
      const type = props.Type?.select?.name || props['Event Type']?.select?.name || '';
      const status = props.Status?.select?.name || props.Stage?.select?.name || '';
      return {
        id: page.id,
        name,
        startDate,
        endDate: endDate || startDate,
        location,
        type,
        status,
        notionLink: 'https://notion.so/' + page.id.replace(/-/g, ''),
        url: page.url
      };
    }).filter(e => e.name && e.startDate);

    events.sort((a, b) => a.startDate.localeCompare(b.startDate));
    res.json({ events, lastUpdated: new Date().toISOString() });
  } catch (err) {
    console.error('[Notion Live] Events query failed:', err.message);
    res.status(500).json({ error: 'Notion query failed' });
  }
});

// ── Offsite child pages from Notion ──
app.get('/api/projects/offsites', ensureAuth, async (req, res) => {
  if (!notion) return res.status(503).json({ error: 'Notion not configured' });
  try {
    const children = await notion.blocks.children.list({ block_id: NOTION_OFFSITES_PARENT, page_size: 50 });
    const childPages = children.results.filter(b => b.type === 'child_page');
    const projects = childPages.map(child => ({
      id: child.id,
      title: child.child_page?.title || 'Untitled',
      url: 'https://notion.so/' + child.id.replace(/-/g, '')
    }));
    res.json({ projects, lastUpdated: new Date().toISOString() });
  } catch (err) {
    console.error('[Notion Live] Offsites query failed:', err.message);
    res.status(500).json({ error: 'Notion query failed' });
  }
});

// ── Hack week child pages from Notion ──
app.get('/api/projects/hackweeks', ensureAuth, async (req, res) => {
  if (!notion) return res.status(503).json({ error: 'Notion not configured' });
  try {
    const children = await notion.blocks.children.list({ block_id: NOTION_HACKWEEK_PARENT, page_size: 50 });
    const childPages = children.results.filter(b => b.type === 'child_page');
    const projects = childPages.map(child => ({
      id: child.id,
      title: child.child_page?.title || 'Untitled',
      url: 'https://notion.so/' + child.id.replace(/-/g, '')
    }));
    res.json({ projects, lastUpdated: new Date().toISOString() });
  } catch (err) {
    console.error('[Notion Live] Hack weeks query failed:', err.message);
    res.status(500).json({ error: 'Notion query failed' });
  }
});

// ── Project page checklist from Notion ──
app.get('/api/projects/:pageId/checklist', ensureAuth, async (req, res) => {
  if (!notion) return res.status(503).json({ error: 'Notion not configured' });
  try {
    const pageId = req.params.pageId;
    let allBlocks = [];
    let cursor;
    do {
      const resp = await notion.blocks.children.list({ block_id: pageId, page_size: 100, start_cursor: cursor });
      allBlocks = allBlocks.concat(resp.results);
      cursor = resp.has_more ? resp.next_cursor : null;
    } while (cursor);

    const phases = [];
    let currentPhase = { name: 'General', tasks: [] };
    allBlocks.forEach(b => {
      if (b.type === 'heading_2' || b.type === 'heading_3') {
        if (currentPhase.tasks.length > 0 || phases.length > 0) phases.push(currentPhase);
        const text = b[b.type]?.rich_text?.map(t => t.plain_text).join('') || '';
        currentPhase = { name: text, tasks: [] };
      } else if (b.type === 'to_do') {
        const text = b.to_do.rich_text?.map(t => t.plain_text).join('') || '';
        currentPhase.tasks.push({ blockId: b.id, text, done: b.to_do.checked || false });
      }
    });
    if (currentPhase.tasks.length > 0) phases.push(currentPhase);

    const totalTasks = phases.reduce((s, p) => s + p.tasks.length, 0);
    const doneTasks = phases.reduce((s, p) => s + p.tasks.filter(t => t.done).length, 0);

    res.json({
      id: pageId,
      phases,
      totalTasks,
      doneTasks,
      pct: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
      lastUpdated: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Notion Live] Checklist query failed:', err.message);
    res.status(500).json({ error: 'Notion query failed' });
  }
});

// ── Toggle a Notion checkbox block ──
app.patch('/api/projects/toggle-block/:blockId', ensureAuth, async (req, res) => {
  if (!notion) return res.status(503).json({ error: 'Notion not configured' });
  try {
    const { checked } = req.body;
    await notion.blocks.update({
      block_id: req.params.blockId,
      to_do: { checked: !!checked }
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Notion Live] Block toggle failed:', err.message);
    res.status(500).json({ error: 'Failed to update' });
  }
});

// ââ Protected dashboard ââ
// ── Smart Task Dedup Engine ──
function extractEntities(text) {
  const lower = text.toLowerCase();
  const companies = ['criteo','symbiotica','sakara','tapestry','bissell','gnc','greylock',
    'tinuiti','away','murad','glossier','spanx','albertsons','j.jill','perry ellis',
    'backcountry','moma','stripe','salesforce','anthropic','webflow','vmg','omaha',
    'gen digital','shopify','sephora','pandora','fabletics','knitwell','brooks running',
    'meta','fermat','podcast'];
  const people = ['rishabh','shreyas','sophie','evelyn','jess','bharat','jennifer','saunder',
    'isabel','khushy','daniel','alec','james','talia','gillian','rhea','maya','ashley',
    'mehdi','anshuman','alice','sarah','becky','helena','jack','matt kruer','kira','jillian'];

  // Action verb GROUPS — verbs in the same group are synonymous
  const actionGroups = {
    scheduling: ['schedule','book','reschedule','set up call','set up meeting','calendar invite'],
    followup: ['follow up','reply','respond','reach out','nudge','check in','ping'],
    sending: ['send','email','draft','forward','share'],
    creation: ['create','build','prepare','write','set up','organize','plan','launch','execute'],
    review: ['review','approve','sign','check','confirm','verify'],
    fixing: ['fix','update','resolve','debug'],
    logistics: ['issue','collect','connect','coordinate','print','order','get']
  };

  const foundCompanies = companies.filter(c => lower.includes(c));
  const foundPeople = people.filter(p => lower.includes(p));

  // Find which action groups match
  const foundActionGroups = [];
  for (const [group, verbs] of Object.entries(actionGroups)) {
    if (verbs.some(v => lower.includes(v))) foundActionGroups.push(group);
  }

  return { companies: foundCompanies, people: foundPeople, actionGroups: foundActionGroups };
}

function taskSimilarity(a, b) {
  const entA = extractEntities(a);
  const entB = extractEntities(b);

  const sharedCompanies = entA.companies.filter(c => entB.companies.includes(c));
  const sharedPeople = entA.people.filter(p => entB.people.includes(p));
  // Actions only match if they're in the SAME group (schedule≠follow up)
  const sharedActionGroups = entA.actionGroups.filter(g => entB.actionGroups.includes(g));

  // Exact normalized match — always a duplicate
  const normA = a.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const normB = b.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  if (normA === normB) return 1.0;

  // Entity-based scoring — requires action match to reach threshold
  let score = 0;
  if (sharedCompanies.length > 0) score += 0.3;
  if (sharedPeople.length > 0) score += 0.15;
  if (sharedActionGroups.length > 0) score += 0.25;
  // Bonus: all three match = very likely duplicate
  if (sharedCompanies.length > 0 && sharedPeople.length > 0 && sharedActionGroups.length > 0) score += 0.15;

  // Word overlap ratio
  const wordsA = new Set(normA.split(' ').filter(w => w.length > 2));
  const wordsB = new Set(normB.split(' ').filter(w => w.length > 2));
  const shared = [...wordsA].filter(w => wordsB.has(w));
  const overlap = shared.length / Math.max(wordsA.size, wordsB.size, 1);
  score = Math.max(score, overlap * 0.8);

  return score;
}

const DEDUP_THRESHOLD = 0.65; // Raised from 0.55 — better to show a duplicate than hide a real task

app.get('/api/tasks/deduped', ensureAuth, async (req, res) => {
  if (!notion) return res.status(503).json({ error: 'Notion not configured' });
  try {
    // 1. Get Notion tasks
    const response = await notion.databases.query({
      database_id: NOTION_TASK_DB,
      filter: {
        and: [
          { property: 'Task', title: { contains: '[Sophie]' } },
          { property: 'Task', title: { does_not_contain: '[ARCHIVED]' } }
        ]
      },
      sorts: [{ property: 'Priority', direction: 'ascending' }]
    });
    const notionTasks = response.results.map(page => {
      const props = page.properties;
      const titleRaw = props.Task?.title?.[0]?.plain_text || '';
      return {
        id: page.id,
        notionPageId: page.id,
        title: titleRaw.replace(/^\[Sophie\]\s*/, ''),
        done: props.Done?.checkbox || false,
        priority: props.Priority?.select?.name || 'Medium',
        due: props['Due Date']?.date?.start || null,
        context: props.Source?.rich_text?.[0]?.plain_text || '',
        sourceLink: props['Source Link']?.url || '',
        owner: 'Sophie',
        source: 'notion',
        lastModifiedAt: page.last_edited_time
      };
    });

    // 2. Dedup WITHIN Notion tasks — archive duplicates at the source
    const dupLog = [];
    const archiveQueue = [];
    const kept = [];

    for (let i = 0; i < notionTasks.length; i++) {
      const task = notionTasks[i];
      let isDup = false;

      for (const existing of kept) {
        const score = taskSimilarity(task.title, existing.title);
        if (score >= DEDUP_THRESHOLD) {
          // Duplicate found — decide which to keep
          if (task.done && !existing.done) {
            // Task is done, existing is not — the undone one is the stale duplicate
            // But wait — the done one means work IS complete, so keep the done one
            // and archive the undone duplicate
            archiveQueue.push({ id: existing.id, title: existing.title, reason: 'Duplicate of done task: ' + task.title });
            dupLog.push({ archived: existing.title, kept: task.title, score, reason: 'undone duplicate of done task' });
            // Replace existing with the done version
            const idx = kept.indexOf(existing);
            kept[idx] = task;
            isDup = true;
            break;
          } else if (!task.done && existing.done) {
            // Existing is done, new task is undone — archive the undone one
            archiveQueue.push({ id: task.id, title: task.title, reason: 'Duplicate of done task: ' + existing.title });
            dupLog.push({ archived: task.title, kept: existing.title, score, reason: 'undone duplicate of done task' });
            isDup = true;
            break;
          } else {
            // Both same done state — archive the newer one (later in the list)
            archiveQueue.push({ id: task.id, title: task.title, reason: 'Duplicate of: ' + existing.title });
            dupLog.push({ archived: task.title, kept: existing.title, score, reason: 'newer duplicate' });
            isDup = true;
            break;
          }
        }
      }

      if (!isDup) kept.push(task);
    }

    // 3. Archive duplicates in Notion (async, don't block response)
    if (archiveQueue.length > 0) {
      console.log(`[Dedup] Archiving ${archiveQueue.length} duplicates in Notion`);
      archiveQueue.forEach(dup => {
        archiveNotionTask(dup.id, '[Sophie] ' + dup.title).catch(e =>
          console.error(`[Dedup] Failed to archive ${dup.id}:`, e.message)
        );
      });
    }

    // 4. Merge manual tasks
    const manualTasks = fs.existsSync(MANUAL_TASKS_PATH)
      ? JSON.parse(fs.readFileSync(MANUAL_TASKS_PATH, 'utf8'))
      : [];

    manualTasks.forEach(m => {
      if (kept.some(n => n.id === m.id || n.id === m.notionPageId)) return;

      let bestMatch = null;
      let bestScore = 0;
      kept.forEach(n => {
        const score = taskSimilarity(m.title, n.title);
        if (score > bestScore) { bestScore = score; bestMatch = n; }
      });

      if (bestScore >= DEDUP_THRESHOLD) {
        dupLog.push({ archived: m.title, kept: bestMatch.title, score: bestScore, reason: 'manual duplicate' });
      } else {
        m.source = 'manual';
        m.lastModifiedAt = m.addedAt || new Date().toISOString();
        kept.push(m);
      }
    });

    res.json({
      tasks: kept,
      duplicatesArchived: archiveQueue.length,
      duplicatesFound: dupLog,
      lastUpdated: new Date().toISOString(),
      source: 'notion-deduped'
    });
  } catch (err) {
    console.error('[Notion Dedup] Query failed:', err.message);
    res.status(500).json({ error: 'Dedup query failed' });
  }
});

app.post('/api/tasks/reconcile', ensureAuth, async (req, res) => {
  if (!notion) return res.status(503).json({ error: 'Notion not configured' });
  try {
    const { localTasks } = req.body; // Tasks from dashboard localStorage
    if (!Array.isArray(localTasks)) return res.status(400).json({ error: 'localTasks array required' });

    // 1. Get current Notion state
    const response = await notion.databases.query({
      database_id: NOTION_TASK_DB,
      filter: {
        and: [
          { property: 'Task', title: { contains: '[Sophie]' } },
          { property: 'Task', title: { does_not_contain: '[ARCHIVED]' } }
        ]
      }
    });

    const notionTasks = new Map();
    response.results.forEach(page => {
      const props = page.properties;
      const title = (props.Task?.title?.[0]?.plain_text || '').replace(/^\[Sophie\]\s*/, '');
      notionTasks.set(page.id, {
        id: page.id,
        title,
        done: props.Done?.checkbox || false,
        lastModifiedAt: page.last_edited_time
      });
    });

    const actions = [];

    // 2. For each local task, resolve conflicts
    localTasks.forEach(local => {
      const notionVersion = notionTasks.get(local.notionPageId) || notionTasks.get(local.id);

      if (!notionVersion) {
        // Local task not in Notion -- create it (unless it's been soft-deleted)
        if (!local._deleted) {
          actions.push({ action: 'create-in-notion', task: local });
        }
        return;
      }

      // Both exist -- compare modification times
      const localTime = new Date(local.lastModifiedAt || 0).getTime();
      const notionTime = new Date(notionVersion.lastModifiedAt || 0).getTime();

      if (local.done !== notionVersion.done) {
        if (localTime > notionTime) {
          // Dashboard is newer -- push to Notion
          actions.push({ action: 'update-notion', pageId: notionVersion.id, done: local.done });
        } else {
          // Notion is newer -- update local
          actions.push({ action: 'update-local', taskId: local.id, done: notionVersion.done });
        }
      }

      // Remove from map so we can detect Notion-only tasks
      notionTasks.delete(notionVersion.id);
    });

    // 3. Tasks in Notion but not local -- include them (new tasks added in Notion)
    const newFromNotion = [];
    notionTasks.forEach(task => {
      newFromNotion.push(task);
    });

    // 4. Execute Notion updates
    for (const act of actions) {
      if (act.action === 'update-notion') {
        await updateNotionTaskDone(act.pageId, act.done);
      } else if (act.action === 'create-in-notion' && act.task.title) {
        await createNotionTask({
          title: act.task.title,
          priority: act.task.priority || 'Medium',
          source: 'Dashboard'
        });
      }
    }

    res.json({
      actions,
      newFromNotion,
      resolved: actions.length,
      lastUpdated: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Reconcile] Failed:', err.message);
    res.status(500).json({ error: 'Reconciliation failed' });
  }
});

// ── Podcast API ──
try {
  const createPodcastRouter = require('./podcast-api.js');
  app.use('/api/podcast', createPodcastRouter(null));
  console.log('[Podcast] API mounted at /api/podcast');
} catch (e) {
  console.log('[Podcast] podcast-api.js not found, podcast API disabled');
}

app.get('/', ensureAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.use(ensureAuth, express.static(__dirname));

// ââ Start ââ
app.listen(PORT, () => {
  console.log(`Dashboard running on ${BASE_URL}`);
  if (!GOOGLE_CLIENT_ID) console.log('\u26a0\ufe0f GOOGLE_CLIENT_ID not set - auth disabled (dev mode)');
});
