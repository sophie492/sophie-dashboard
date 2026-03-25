const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Config ──
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'sophie-dashboard-secret-change-me';
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : process.env.BASE_URL || `http://localhost:${PORT}`;

// Allowed email domain — only @fermatcommerce.com can access
const ALLOWED_DOMAIN = 'fermatcommerce.com';

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
      id: profile.id,
      email,
      name: profile.displayName,
      photo: profile.photos?.[0]?.value
    });
  }));
}

// ── Auth routes ──
app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
  hd: ALLOWED_DOMAIN // Hint to Google to show only Workspace accounts
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
  // If Google OAuth isn't configured, let everyone through (local dev)
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return next();
  }
  if (req.isAuthenticated()) return next();
  res.redirect('/auth/google');
}

// ── JSON body parsing (for action-items API) ──
app.use(express.json({ limit: '1mb' }));

// ── Health check (no auth needed) ──
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Action Items API ──
const ACTION_ITEMS_PATH = path.join(__dirname, 'data', 'action-items.json');

// GET - serve current action items (protected by auth)
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

// POST - update action items (requires API key)
const API_KEY = process.env.DASHBOARD_API_KEY;
app.post('/api/action-items', (req, res) => {
  // Authenticate via API key (used by CEO daily brief skill)
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

// ── Protected dashboard ──
app.get('/', ensureAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Serve static assets (CSS/JS/images if any) behind auth
app.use(ensureAuth, express.static(path.join(__dirname, 'public')));

// ── Start ──
app.listen(PORT, () => {
  console.log(`Dashboard running on ${BASE_URL}`);
  if (!GOOGLE_CLIENT_ID) {
    console.log('\u26a0\ufe0f  GOOGLE_CLIENT_ID not set \u2014 auth disabled (dev mode)');
  }
});
