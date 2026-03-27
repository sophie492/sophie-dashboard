const express = require('express');
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'data', 'podcast-data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading podcast data:', e);
  }
  return { config: {}, episodes: [], guests: [], launchTasks: [], topics: [], reviews: [], lastSynced: null };
}

function saveData(data) {
  try {
    const dir = path.dirname(DATA_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error writing podcast data:', e);
  }
}

// This function is no longer used but kept for future Notion direct integration
module.exports = function createPodcastRouter(notion) {
  const router = express.Router();

  // ── GET /config ──
  router.get('/config', (req, res) => {
    const data = loadData();
    res.json(data.config || {
      cadence: 'Biweekly',
      calendarLink: 'https://calendar.google.com/calendar/embed?src=c_21b6e1a02f18829886a8a2c2c60f00f9b55325d8ec0e977ded08722818901913%40group.calendar.google.com',
      slackChannel: 'https://getfermat.slack.com/archives/C0AP4APKLJ1',
      notionHub: 'https://www.notion.so/fermat-commerce/32f1ad76fd2a816191b0da22a6d0b2ce',
      nextKickoff: null
    });
  });

  // ── GET /episodes ──
  router.get('/episodes', (req, res) => {
    const data = loadData();
    res.json(data.episodes || []);
  });

  // ── GET /guests ──
  router.get('/guests', (req, res) => {
    const data = loadData();
    res.json(data.guests || []);
  });

  // ── GET /launch-tasks ──
  router.get('/launch-tasks', (req, res) => {
    const data = loadData();
    res.json(data.launchTasks || []);
  });

  // ── GET /topics ──
  router.get('/topics', (req, res) => {
    const data = loadData();
    res.json(data.topics || []);
  });

  // ── GET /reviews ──
  router.get('/reviews', (req, res) => {
    const data = loadData();
    res.json(data.reviews || []);
  });

  // ── POST /sync — bulk update all data (called by Cowork automation) ──
  router.post('/sync', (req, res) => {
    // Authenticate via API key (same pattern as action-items)
    const authHeader = req.headers.authorization;
    const apiKey = process.env.DASHBOARD_API_KEY;
    if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
      return res.status(401).json({ error: 'Invalid or missing API key' });
    }
    try {
      const data = req.body;
      data.lastSynced = new Date().toISOString();
      saveData(data);
      res.json({ ok: true, savedAt: data.lastSynced });
    } catch (e) {
      console.error('Error syncing podcast data:', e);
      res.status(500).json({ error: 'Failed to sync' });
    }
  });

  // ── PATCH /episodes/:episodeId/todos/:taskId ──
  router.patch('/episodes/:episodeId/todos/:taskId', (req, res) => {
    try {
      const { status } = req.body;
      if (!['To Do', 'In Progress', 'Done', 'Skipped'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      const data = loadData();
      const ep = data.episodes.find(e => e.id === req.params.episodeId);
      if (ep) {
        const todo = ep.todos.find(t => t.id === req.params.taskId);
        if (todo) {
          todo.status = status;
          todo.done = status === 'Done';
          saveData(data);
          return res.json({ ok: true });
        }
      }
      res.status(404).json({ error: 'Task not found' });
    } catch (e) {
      console.error('Error updating todo:', e);
      res.status(500).json({ error: 'Failed to update' });
    }
  });

  // ── PATCH /launch-tasks/:taskId ──
  router.patch('/launch-tasks/:taskId', (req, res) => {
    try {
      const { status } = req.body;
      if (!['Not Started', 'In Progress', 'Waiting', 'Done'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      const data = loadData();
      const task = data.launchTasks.find(t => t.id === req.params.taskId);
      if (task) {
        task.status = status;
        task._done = status === 'Done';
        saveData(data);
        return res.json({ ok: true });
      }
      res.status(404).json({ error: 'Task not found' });
    } catch (e) {
      console.error('Error updating launch task:', e);
      res.status(500).json({ error: 'Failed to update' });
    }
  });

  // ── PATCH /guests/:guestId ──
  router.patch('/guests/:guestId', (req, res) => {
    try {
      const { outreachStatus } = req.body;
      if (!['Not Started', 'Drafting', 'Sent', 'In Conversation', 'Confirmed', 'Declined'].includes(outreachStatus)) {
        return res.status(400).json({ error: 'Invalid outreach status' });
      }
      const data = loadData();
      const guest = data.guests.find(g => g.id === req.params.guestId);
      if (guest) {
        guest.outreachStatus = outreachStatus;
        saveData(data);
        return res.json({ ok: true });
      }
      res.status(404).json({ error: 'Guest not found' });
    } catch (e) {
      console.error('Error updating guest:', e);
      res.status(500).json({ error: 'Failed to update' });
    }
  });

  return router;
};
