// index.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { nanoid } = require('nanoid');

const DB_FILE = path.join(__dirname, 'db.json');
const PORT = process.env.PORT || 5000;

// --- Simple JSON DB helpers (synchronous for simplicity) ---
function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(getInitialData(), null, 2), 'utf8');
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}
function getInitialData() {
  const now = new Date().toISOString();
  return {
    highlights: [
      { id: 'h1', title: 'Destaque: Economia global em foco', summary: 'Resumo do destaque.', image: 'https://picsum.photos/seed/hl1/800/450', url: 'https://exemplo.com/destaque-1', publishedAt: now, sourceId: 's1' }
    ],
    news: [
      { id: 'n1', title: 'Mercados subiram hoje', summary: 'Resumo da notícia de mercado.', url: 'https://noticias.ex/n1', image: 'https://picsum.photos/seed/n1/400/300', publishedAt: now, sourceId: 's1' },
      { id: 'n2', title: 'Tecnologia: nova versão lançada', summary: 'Resumo da notícia tech.', url: 'https://noticias.ex/n2', image: 'https://picsum.photos/seed/n2/400/300', publishedAt: now, sourceId: 's2' }
    ],
    images: [
      { id: 'img1', title: 'Paisagem', url: 'https://picsum.photos/seed/img1/1200/800', thumb: 'https://picsum.photos/seed/img1/400/300', sourceId: 's3' }
    ],
    sources: [
      { id: 's1', name: 'Exemplo News', url: 'https://noticias.ex' },
      { id: 's2', name: 'TechToday', url: 'https://techtoday.ex' },
      { id: 's3', name: 'Pics', url: 'https://picsum.photos' }
    ],
    trending: [
      { id: 't1', topic: 'Economia', score: 92 },
      { id: 't2', topic: 'IA', score: 88 }
    ],
    likes: {
      articles: { 'n1': 12, 'n2': 5 },
      images: { 'img1': 3 }
    ],
    createdAt: now
  };
}

// --- App setup ---
const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

// Helper: pagination & search
function paginate(array, page = 1, limit = 10) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
  const start = (p - 1) * l;
  return {
    page: p,
    limit: l,
    total: array.length,
    pages: Math.ceil(array.length / l),
    data: array.slice(start, start + l)
  };
}

// --- Endpoints ---
// Health
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// GET highlights
app.get('/api/v1/highlights', (req, res) => {
  const db = readDB();
  res.set('Cache-Control', 'public, max-age=60'); // cache 60s
  res.json({ items: db.highlights });
});

// GET news (supports ?q=&page=&limit=&source=)
app.get('/api/v1/news', (req, res) => {
  const { q, page, limit, source } = req.query;
  const db = readDB();
  let items = db.news.slice();
  if (source) items = items.filter(x => x.sourceId === source);
  if (q) {
    const ql = q.toLowerCase();
    items = items.filter(x => (x.title && x.title.toLowerCase().includes(ql)) || (x.summary && x.summary.toLowerCase().includes(ql)));
  }
  const pag = paginate(items, page, limit);
  res.set('Cache-Control', 'public, max-age=30');
  res.json(pag);
});

// GET single article
app.get('/api/v1/news/:id', (req, res) => {
  const db = readDB();
  const item = db.news.find(n => n.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const likes = (db.likes.articles[item.id] || 0);
  res.set('Cache-Control', 'public, max-age=30');
  res.json({ ...item, likes });
});

// GET images (supports q)
app.get('/api/v1/images', (req, res) => {
  const { q, page, limit } = req.query;
  const db = readDB();
  let items = db.images.slice();
  if (q) {
    const ql = q.toLowerCase();
    items = items.filter(x => (x.title && x.title.toLowerCase().includes(ql)));
  }
  const pag = paginate(items, page, limit);
  res.set('Cache-Control', 'public, max-age=60');
  res.json(pag);
});

// GET sources
app.get('/api/v1/sources', (req, res) => {
  const db = readDB();
  res.json({ items: db.sources });
});

// GET trending
app.get('/api/v1/trending', (req, res) => {
  const db = readDB();
  res.json({ items: db.trending });
});

// SEARCH (unified) -> returns combined results
app.get('/api/v1/search', (req, res) => {
  const { q, page, limit } = req.query;
  if (!q) return res.status(400).json({ error: 'q parameter required' });
  const db = readDB();
  const ql = q.toLowerCase();
  const news = db.news.filter(n => (n.title && n.title.toLowerCase().includes(ql)) || (n.summary && n.summary.toLowerCase().includes(ql))).map(x => ({ type: 'news', ...x }));
  const images = db.images.filter(i => (i.title && i.title.toLowerCase().includes(ql))).map(x => ({ type: 'image', ...x }));
  const combined = [...news, ...images];
  const pag = paginate(combined, page, limit);
  res.json(pag);
});

// POST like { type: 'article'|'image', id: 'n1' }
app.post('/api/v1/like', (req, res) => {
  const { type, id } = req.body || {};
  if (!type || !id) return res.status(400).json({ error: 'type and id required' });
  const db = readDB();
  if (!db.likes[type + 's']) db.likes[type + 's'] = {};
  db.likes[type + 's'][id] = (db.likes[type + 's'][id] || 0) + 1;
  writeDB(db);
  res.json({ id, type, likes: db.likes[type + 's'][id] });
});

// POST feedback
app.post('/api/v1/feedback', (req, res) => {
  const { message, context } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });
  const db = readDB();
  db.feedback = db.feedback || [];
  db.feedback.push({ id: nanoid(8), message, context: context || null, createdAt: new Date().toISOString() });
  writeDB(db);
  res.json({ status: 'ok' });
});

// Admin: add sample news (for testing) - in real world protect this
app.post('/api/v1/admin/news', (req, res) => {
  const { title, summary, url, image, sourceId } = req.body || {};
  if (!title || !url) return res.status(400).json({ error: 'title and url required' });
  const db = readDB();
  const item = { id: 'n' + nanoid(6), title, summary: summary || '', url, image: image || '', publishedAt: new Date().toISOString(), sourceId: sourceId || null };
  db.news.unshift(item);
  writeDB(db);
  res.json({ created: item });
});

// fallback
app.use((req, res) => res.status(404).json({ error: 'not found' }));

// Start
app.listen(PORT, () => console.log(`Explorer API running on http://localhost:${PORT}/api/v1`));
