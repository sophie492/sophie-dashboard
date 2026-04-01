const express = require('express');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const DATA_PATH = path.join(DATA_DIR, 'podcast-data.json');

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

          if (notion) {
            const epRef = data.episodes.find(e => e.id === req.params.episodeId);
            if (epRef && epRef.notionLink) {
              const nPageId = epRef.notionLink.replace('https://www.notion.so/fermat-commerce/', '').replace('https://notion.so/', '').split('?')[0].split('/').pop();
              notion.blocks.children.list({ block_id: nPageId, page_size: 100 }).then(blocks => {
                const todoBlock = blocks.results.find(b => b.type === 'to_do' && b.to_do.rich_text.some(t => t.plain_text.includes(todo.text.slice(0, 20))));
                if (todoBlock) {
                  notion.blocks.update({ block_id: todoBlock.id, to_do: { checked: status === 'Done' } });
                  console.log('[Podcast] Notion todo synced:', todo.text.slice(0, 30));
                }
              }).catch(e => console.warn('[Podcast] Notion sync failed:', e.message));
            }
          }

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

        if (notion) {
          // Log launch task status change
          console.log('[Podcast] Launch task toggled:', task.text ? task.text.slice(0, 30) : req.params.taskId, status);
        }

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
        // Sync to Notion if guest has a Notion page
        if (notion && guest.notionPageId) {
          try {
            notion.pages.update({
              page_id: guest.notionPageId,
              properties: { 'Outreach Status': { select: { name: outreachStatus } } }
            }).then(() => console.log('[Podcast] Guest status synced to Notion:', guest.name, '->', outreachStatus))
              .catch(e => console.warn('[Podcast] Notion guest sync failed:', e.message));
          } catch (e) { console.warn('[Podcast] Notion guest sync error:', e.message); }
        }
        return res.json({ ok: true });
      }
      res.status(404).json({ error: 'Guest not found' });
    } catch (e) {
      console.error('Error updating guest:', e);
      res.status(500).json({ error: 'Failed to update' });
    }
  });

  // ── Templates ──
  router.get('/templates', (req, res) => {
    const data = loadData();
    res.json(data.templates || []);
  });

  router.patch('/templates/:templateId', async (req, res) => {
    const authHeader = req.headers.authorization;
    const apiKey = process.env.DASHBOARD_API_KEY;
    if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
      return res.status(401).json({ error: 'Invalid or missing API key' });
    }
    try {
      const { template, name, category } = req.body;
      const data = loadData();
      if (!data.templates) data.templates = [];
      const tmpl = data.templates.find(t => t.id === req.params.templateId);
      if (!tmpl) return res.status(404).json({ error: 'Template not found' });
      if (template !== undefined) tmpl.template = template;
      if (name !== undefined) tmpl.name = name;
      if (category !== undefined) tmpl.category = category;
      saveData(data);
      // Sync back to Notion
      if (notion && tmpl.notionPageId) {
        try {
          await notion.pages.update({
            page_id: tmpl.notionPageId,
            properties: {
              'Template Content': { rich_text: [{ text: { content: (template || tmpl.template).slice(0, 2000) } }] },
              ...(name ? { 'Template Name': { title: [{ text: { content: name } }] } } : {}),
              ...(category ? { 'Category': { select: { name: category } } } : {})
            }
          });
          console.log('[Podcast] Template synced to Notion:', tmpl.name);
        } catch(e) { console.warn('[Podcast] Notion template sync failed:', e.message); }
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Content Distribution ──
  router.get('/content-distribution', (req, res) => {
    const data = loadData();
    res.json(data.contentDistribution || []);
  });

  router.patch('/content-distribution/:channelId', (req, res) => {
    try {
      const { status, notes, publishedUrl, scheduledDate } = req.body;
      const data = loadData();
      const dist = data.contentDistribution || [];
      for (const ep of dist) {
        const ch = ep.channels.find(c => c.id === req.params.channelId);
        if (ch) {
          if (status) ch.status = status;
          if (notes !== undefined) ch.notes = notes;
          if (publishedUrl !== undefined) ch.publishedUrl = publishedUrl;
          if (scheduledDate !== undefined) ch.scheduledDate = scheduledDate;
          saveData(data);
          return res.json({ ok: true });
        }
      }
      res.status(404).json({ error: 'Channel not found' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Create New Episode ──
  router.post('/episodes/create', (req, res) => {
    const authHeader = req.headers.authorization;
    const apiKey = process.env.DASHBOARD_API_KEY;
    if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
      return res.status(401).json({ error: 'Invalid or missing API key' });
    }
    try {
      const { title, guest, guestCompany, recordingDate, publishDate, topicId } = req.body;
      if (!title) return res.status(400).json({ error: 'title required' });

      const data = loadData();
      if (!data.episodes) data.episodes = [];

      // Generate episode number
      const maxNum = data.episodes.reduce((max, ep) => Math.max(max, ep.number || 0), 0);
      const number = maxNum + 1;
      const id = 'ep-' + number;

      // Default production checklist
      const todos = [
        { id: 't1', text: 'Confirm guest and schedule recording', phase: 'Pre-Production', owner: 'Sophie', dueDate: recordingDate || '', done: false },
        { id: 't2', text: 'Send guest prep brief (topics, format, logistics)', phase: 'Pre-Production', owner: 'Sophie', dueDate: '', done: false },
        { id: 't3', text: 'Prep Rishabh with talking points and guest background', phase: 'Pre-Production', owner: 'Sophie', dueDate: '', done: false },
        { id: 't4', text: 'Set up recording (Riverside/Zoom, test audio)', phase: 'Pre-Production', owner: 'Sophie', dueDate: '', done: false },
        { id: 't5', text: 'Record episode', phase: 'Recording', owner: 'Rishabh', dueDate: recordingDate || '', done: false },
        { id: 't6', text: 'Send raw recording to editor', phase: 'Post-Production', owner: 'Sophie', dueDate: '', done: false },
        { id: 't7', text: 'Editor delivers final cut', phase: 'Post-Production', owner: 'Editor', dueDate: '', done: false },
        { id: 't8', text: 'Review and approve final edit', phase: 'Post-Production', owner: 'Rishabh', dueDate: '', done: false },
        { id: 't9', text: 'Write show notes and description', phase: 'Publishing', owner: 'Sophie', dueDate: '', done: false },
        { id: 't10', text: 'Create episode artwork', phase: 'Publishing', owner: 'Jennifer', dueDate: '', done: false },
        { id: 't11', text: 'Upload to podcast host and schedule', phase: 'Publishing', owner: 'Sophie', dueDate: publishDate || '', done: false },
        { id: 't12', text: 'Draft LinkedIn teaser post', phase: 'Promotion', owner: 'Jennifer', dueDate: '', done: false },
        { id: 't13', text: 'Create social clips (3-5)', phase: 'Promotion', owner: 'Jennifer', dueDate: '', done: false },
        { id: 't14', text: 'Send episode announcement email', phase: 'Promotion', owner: 'Sophie', dueDate: '', done: false },
        { id: 't15', text: 'Share in Slack', phase: 'Promotion', owner: 'Sophie', dueDate: '', done: false }
      ];

      const newEp = {
        id: id,
        number: number,
        title: title,
        guest: guest || '',
        guestCompany: guestCompany || '',
        recordingDate: recordingDate || 'TBD',
        publishDate: publishDate || 'TBD',
        phase: 'Pre-Production',
        notionLink: '',
        todos: todos
      };

      data.episodes.push(newEp);
      saveData(data);

      // Create Notion page if Notion is available
      if (notion) {
        const PODCAST_HUB = '32f1ad76fd2a816191b0da22a6d0b2ce';
        notion.pages.create({
          parent: { page_id: PODCAST_HUB },
          properties: { title: [{ text: { content: 'Episode ' + number + ': ' + title } }] },
          children: [
            { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: 'Episode ' + number + ': ' + title } }] } },
            { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'Guest: ' + (guest || 'TBD') + (guestCompany ? ' (' + guestCompany + ')' : '') } }] } },
            { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'Recording: ' + (recordingDate || 'TBD') + ' | Publish: ' + (publishDate || 'TBD') } }] } },
            { object: 'block', type: 'divider', divider: {} },
            { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ text: { content: 'Production Checklist' } }] } },
            ...todos.map(t => ({
              object: 'block', type: 'to_do', to_do: { rich_text: [{ text: { content: t.text + ' (' + t.owner + ')' } }], checked: false }
            }))
          ]
        }).then(page => {
          newEp.notionLink = 'https://www.notion.so/' + page.id.replace(/-/g, '');
          saveData(data);
          console.log('[Podcast] Episode Notion page created:', newEp.notionLink);
        }).catch(e => console.warn('[Podcast] Notion page creation failed:', e.message));
      }

      res.json({ ok: true, episode: newEp });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Auto-generate distribution matrix for a new episode
  router.post('/content-distribution/generate', (req, res) => {
    try {
      const { episodeId } = req.body;
      const data = loadData();
      const ep = data.episodes.find(e => e.id === episodeId);
      if (!ep) return res.status(404).json({ error: 'Episode not found' });

      // Check if already exists
      if (!data.contentDistribution) data.contentDistribution = [];
      if (data.contentDistribution.find(d => d.episodeId === episodeId)) {
        return res.json({ ok: true, message: 'Already exists' });
      }

      const prefix = episodeId + '-';
      data.contentDistribution.push({
        episodeId,
        episodeTitle: ep.title,
        channels: [
          {id:prefix+'li-teaser',channel:'LinkedIn',type:'Teaser post',status:'Not Started',owner:'Jennifer',scheduledDate:null,publishedUrl:null,notes:''},
          {id:prefix+'li-insight',channel:'LinkedIn',type:'Key insight post',status:'Not Started',owner:'Jennifer',scheduledDate:null,publishedUrl:null,notes:''},
          {id:prefix+'li-recap',channel:'LinkedIn',type:'Recap post',status:'Not Started',owner:'Jennifer',scheduledDate:null,publishedUrl:null,notes:''},
          {id:prefix+'email',channel:'Email',type:'Episode announcement',status:'Not Started',owner:'Sophie',scheduledDate:null,publishedUrl:null,notes:''},
          {id:prefix+'slack',channel:'Slack',type:'Internal share',status:'Not Started',owner:'Sophie',scheduledDate:null,publishedUrl:null,notes:''},
          {id:prefix+'blog',channel:'Blog',type:'Blog post',status:'Not Started',owner:'Sophie',scheduledDate:null,publishedUrl:null,notes:''},
          {id:prefix+'social',channel:'Social Pilot',type:'3-5 clips',status:'Not Started',owner:'Jennifer',scheduledDate:null,publishedUrl:null,notes:''},
          {id:prefix+'ads',channel:'Google Ads',type:'Retargeting ad',status:'Not Started',owner:'Jennifer',scheduledDate:null,publishedUrl:null,notes:''}
        ]
      });
      saveData(data);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
