#!/usr/bin/env node
/* =============================================================================
 * server.js — the live backend.
 *
 *   node server/server.js            then open http://localhost:8080
 *
 * Serves the static site AND a JSON API that aggregates real market data and
 * real Indian financial news. It exists for two reasons:
 *   1. CORS — a browser cannot call Yahoo/NSE/RSS directly; the server can.
 *   2. Keys — vendor keys stay server-side, never shipped to the client.
 *
 * Zero dependencies. Node 18+ (uses global fetch).
 *
 * Routes
 *   GET /api/health                          provider status, session, config
 *   GET /api/quotes?symbols=NIFTY,RELIANCE   live quotes
 *   GET /api/history?symbol=NIFTY&range=1D   OHLCV bars
 *   GET /api/news?section=&symbol=&q=&limit= real headlines
 *   GET /api/wire                            newest headlines, wire format
 *   GET /api/search?q=                       securities + stories
 *   GET /api/stream                          Server-Sent Events, live ticks
 * ========================================================================== */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const F = require('./lib/fetcher');
const SYM = require('./lib/symbols');
const P = require('./lib/providers');

const ROOT = path.resolve(__dirname, '..');
const PORT = +(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

/* ------------------------------------------------------------- config ----- */
function loadConfig() {
  let file = {};
  const p = path.join(__dirname, 'config.json');
  if (fs.existsSync(p)) {
    try { file = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { console.warn('config.json is not valid JSON — ignoring:', e.message); }
  }
  const keys = Object.assign({
    twelvedata: '', finnhub: '', alphavantage: '', marketaux: '', newsapi: '',
    kiteApiKey: '', kiteAccessToken: ''
  }, file.keys || {});
  // env wins over the file
  for (const k of Object.keys(keys)) {
    const env = process.env['IV_' + k.toUpperCase()];
    if (env) keys[k] = env;
  }
  return {
    keys,
    pollOpenMs: +(file.pollOpenMs || process.env.IV_POLL_OPEN || 5000),
    pollClosedMs: +(file.pollClosedMs || process.env.IV_POLL_CLOSED || 60000),
    newsTtlMs: +(file.newsTtlMs || process.env.IV_NEWS_TTL || 120000),
    /* Marketaux is metered per request, and the free plan returns 3 articles
       per request no matter what `limit` asks for. Hourly refresh x 3 pages =
       72 requests/day, inside the 100/day allowance, for ~216 stories a day. */
    marketauxTtlMs: +(file.marketauxTtlMs || process.env.IV_MARKETAUX_TTL || 3600000),
    marketauxDailyBudget: +(file.marketauxDailyBudget || process.env.IV_MARKETAUX_BUDGET || 90),
    marketauxPagesPerRefresh: +(file.marketauxPagesPerRefresh || process.env.IV_MARKETAUX_PAGES || 3),
    marketauxPageSize: +(file.marketauxPageSize || process.env.IV_MARKETAUX_PAGE_SIZE || 3),
    quoteTtlMs: +(file.quoteTtlMs || process.env.IV_QUOTE_TTL || 5000),
    historyTtlMs: +(file.historyTtlMs || 300000),
    streamSymbols: file.streamSymbols || [
      'NIFTY', 'SENSEX', 'BANKNIFTY', 'FINNIFTY', 'INDIAVIX', 'USDINR', 'GOLD',
      'CRUDE', 'BTC', 'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY'
    ]
  };
}
const CFG = loadConfig();
const KEYED = P.keyed(CFG);

/* ============================================================ aggregation == */
/* Route each symbol to the first provider that can serve it, run the provider
   groups in parallel, and merge. A provider failing never fails the request —
   the symbols it owned are simply reported as unavailable. */
async function fetchQuotes(syms) {
  const groups = { yahoo: [], coingecko: [], frankfurter: [], twelvedata: [], finnhub: [] };
  const unknown = [];
  for (const s of syms) {
    const chain = SYM.providersFor(s);
    const pick = chain.find(p => {
      if (p === 'twelvedata') return !!CFG.keys.twelvedata;
      if (p === 'finnhub') return !!CFG.keys.finnhub;
      return p === 'yahoo' || p === 'coingecko' || p === 'frankfurter';
    });
    if (pick) groups[pick].push(s); else unknown.push(s);
  }

  const settled = await Promise.allSettled([
    groups.yahoo.length ? P.yahoo.quotes(groups.yahoo) : [],
    groups.coingecko.length ? P.coingecko.quotes(groups.coingecko) : [],
    groups.frankfurter.length ? P.frankfurter.quotes(groups.frankfurter) : [],
    groups.twelvedata.length ? KEYED.quotes(groups.twelvedata) : [],
    groups.finnhub.length ? KEYED.finnhubQuotes(groups.finnhub) : []
  ]);

  const out = [];
  const errors = [];
  settled.forEach((r, i) => {
    const name = Object.keys(groups)[i];
    if (r.status === 'fulfilled') out.push(...r.value);
    else errors.push({ provider: name, error: String(r.reason && r.reason.message || r.reason) });
  });

  /* Crypto and FX come back without a day range; fill from Yahoo if it had it. */
  const got = new Set(out.map(q => q.sym));
  const missing = syms.filter(s => !got.has(s));
  return { quotes: out, missing, unknown, errors };
}

const quotes = (syms) => F.cached(
  'q:' + syms.slice().sort().join(','),
  P.indiaSession().state === 'OPEN' ? CFG.quoteTtlMs : CFG.pollClosedMs,
  () => fetchQuotes(syms)
);

const history = (sym, range) => F.cached(
  `h:${sym}:${range}`,
  range === '1D' ? 60000 : CFG.historyTtlMs,
  async () => {
    try { return await P.yahoo.history(sym, range); }
    catch (err) {
      if (CFG.keys.twelvedata) {
        const u = SYM.get(sym);
        if (u && u.td) {
          const j = await F.json(`${P.BASE.twelvedata}/time_series?symbol=${u.td}` +
            `&interval=1day&outputsize=250&apikey=${CFG.keys.twelvedata}`);
          const bars = (j.values || []).reverse().map(v => ({
            t: Date.parse(v.datetime), o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +(v.volume || 0)
          }));
          return { bars, meta: null, source: 'twelvedata' };
        }
      }
      throw err;
    }
  }
);

/* Fundamentals change daily at most, so cache hard. If the upstream refuses
   (Yahoo gates quoteSummary behind a crumb that can fail), say so plainly —
   the client renders dashes rather than substituting simulated ratios. */
const fundamentals = (sym) => F.cached(`fa:${sym}`, 6 * 3600e3, async () => {
  try {
    return await P.yahoo.fundamentals(sym);
  } catch (err) {
    return { available: false, source: null, reason: String(err.message || err) };
  }
});

/* Marketaux gets its own, much longer cache than RSS: RSS is free to poll every
   two minutes, Marketaux is not. */
const enrichedNews = () => F.cached('news:marketaux', CFG.marketauxTtlMs,
  () => KEYED.news().catch(err => {
    console.warn('[news] marketaux unavailable:', err.message);
    return [];
  }));

const news = () => F.cached('news:all', CFG.newsTtlMs, async () => {
  const [feedItems, keyedItems] = await Promise.all([
    P.rss.fetchAll().catch(() => []),
    enrichedNews()
  ]);

  /* Merge on the headline. When the same story arrives from both, keep the RSS
     copy (better section tagging) but graft on what only Marketaux has: the
     photo and the sentiment score. */
  const key = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
  const byKey = new Map();
  feedItems.forEach(a => byKey.set(key(a.t), a));

  keyedItems.forEach(m => {
    const k = key(m.t);
    const existing = byKey.get(k);
    if (existing) {
      if (!existing.image && m.image) existing.image = m.image;
      if (existing.sentiment == null && m.sentiment != null) existing.sentiment = m.sentiment;
      if ((!existing.sym || !existing.sym.length) && m.sym.length) existing.sym = m.sym;
      existing.enrichedBy = 'marketaux';
    } else {
      byKey.set(k, m);
    }
  });

  const all = [...byKey.values()];
  all.forEach(a => { if (!a.sym || !a.sym.length) a.sym = P.rss.tagSymbols(a.t + ' ' + a.d); });
  all.sort((a, b) => b.ts - a.ts);
  return all;
});

/* ================================================================ routes == */
const routes = {
  '/api/health': async () => {
    const session = P.indiaSession();
    let sample = null;
    try {
      const r = await quotes(['NIFTY']);
      sample = r.quotes[0] || null;
    } catch (_) {}
    let newsCount = 0;
    try { newsCount = (await news()).length; } catch (_) {}
    return {
      ok: true,
      live: !!sample,
      session: { state: session.state, label: session.label, ist: session.ist.toISOString() },
      providers: {
        yahoo: 'no key required',
        coingecko: 'no key required',
        frankfurter: 'no key required',
        rss: P.rss.FEEDS.length + ' feeds',
        twelvedata: CFG.keys.twelvedata ? 'configured' : 'not configured',
        finnhub: CFG.keys.finnhub ? 'configured' : 'not configured',
        marketaux: CFG.keys.marketaux ? 'configured' : 'not configured',
        newsapi: CFG.keys.newsapi ? 'configured' : 'not configured'
      },
      upstreamHealth: F.health(),
      newsItems: newsCount,
      marketaux: CFG.keys.marketaux ? {
        budgetPerDay: CFG.marketauxDailyBudget,
        usedToday: P.marketaux.budget.used,
        remaining: P.marketaux.remaining(CFG),
        refreshMinutes: Math.round(CFG.marketauxTtlMs / 60000)
      } : null,
      sample,
      universe: SYM.all().length,
      pollMs: session.state === 'OPEN' ? CFG.pollOpenMs : CFG.pollClosedMs,
      serverTime: Date.now()
    };
  },

  '/api/quotes': async (u) => {
    const syms = (u.searchParams.get('symbols') || '')
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!syms.length) throw httpError(400, 'symbols parameter required');
    const r = await quotes(syms);
    return { ...r, session: P.indiaSession().state, ts: Date.now() };
  },

  '/api/history': async (u) => {
    const sym = (u.searchParams.get('symbol') || '').toUpperCase();
    const range = (u.searchParams.get('range') || '1D').toUpperCase();
    if (!sym) throw httpError(400, 'symbol parameter required');
    return await history(sym, range);
  },

  '/api/fundamentals': async (u) => {
    const sym = (u.searchParams.get('symbol') || '').toUpperCase();
    if (!sym) throw httpError(400, 'symbol parameter required');
    const def = SYM.get(sym);
    if (!def) throw httpError(404, 'unknown symbol ' + sym);
    if (def.cls !== 'equity') {
      return { available: false, reason: 'fundamentals apply to equities only', sym };
    }
    return { sym, ...(await fundamentals(sym)) };
  },

  '/api/news': async (u) => {
    let items = await news();
    const section = u.searchParams.get('section');
    const symbol = (u.searchParams.get('symbol') || '').toUpperCase();
    const q = (u.searchParams.get('q') || '').toLowerCase();
    const limit = Math.min(+(u.searchParams.get('limit') || 60), 200);
    if (section) items = items.filter(a => a.s === section);
    if (symbol) items = items.filter(a => (a.sym || []).includes(symbol));
    if (q) items = items.filter(a => (a.t + ' ' + a.d).toLowerCase().includes(q));
    return { items: items.slice(0, limit), total: items.length, ts: Date.now() };
  },

  '/api/wire': async () => {
    const items = await news();
    return {
      items: items.slice(0, 30).map(a => ({
        t: a.t.toUpperCase(), ts: a.ts, src: a.src, url: a.url,
        pr: /rbi|fed|inflation|rate|gdp|policy|crash|surge|plunge|record/i.test(a.t) ? 1
          : (a.sym && a.sym.length ? 2 : 3)
      })),
      ts: Date.now()
    };
  },

  '/api/search': async (u) => {
    const q = (u.searchParams.get('q') || '').trim().toLowerCase();
    if (!q) return { securities: [], articles: [] };
    const matches = SYM.UNIVERSE.filter(s =>
      s.sym.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 8);
    const [qs, items] = await Promise.all([
      matches.length ? quotes(matches.map(m => m.sym)).catch(() => ({ quotes: [] })) : { quotes: [] },
      news().catch(() => [])
    ]);
    return {
      securities: qs.quotes,
      articles: items.filter(a => (a.t + ' ' + a.d).toLowerCase().includes(q)).slice(0, 10)
    };
  }
};

/* ------------------------------------------------------------------ SSE --- */
const streamClients = new Set();
let streamTimer = null;

function startStream() {
  if (streamTimer) clearTimeout(streamTimer);
  const tick = async () => {
    const session = P.indiaSession();
    const wait = session.state === 'OPEN' ? CFG.pollOpenMs : CFG.pollClosedMs;
    if (streamClients.size) {
      try {
        const r = await quotes(CFG.streamSymbols);
        const payload = JSON.stringify({
          type: 'quotes', session: session.state, ts: Date.now(), quotes: r.quotes
        });
        for (const res of streamClients) {
          res.write(`event: quotes\ndata: ${payload}\n\n`);
        }
      } catch (err) {
        for (const res of streamClients) {
          res.write(`event: error\ndata: ${JSON.stringify({ error: String(err.message || err) })}\n\n`);
        }
      }
    }
    streamTimer = setTimeout(tick, wait);
  };
  streamTimer = setTimeout(tick, 1200);
}

function handleStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no'
  });
  res.write(`event: hello\ndata: ${JSON.stringify({
    ok: true, session: P.indiaSession().state, symbols: CFG.streamSymbols
  })}\n\n`);
  streamClients.add(res);
  const ka = setInterval(() => res.write(': keep-alive\n\n'), 25000);
  req.on('close', () => { clearInterval(ka); streamClients.delete(res); });
}

/* --------------------------------------------------------------- static --- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) return send(res, 403, { error: 'forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'not found', path: rel });
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache'
    });
    fs.createReadStream(file).pipe(res);
  });
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}
function httpError(code, msg) { const e = new Error(msg); e.status = code; return e; }

/* --------------------------------------------------------------- server --- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = u.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,OPTIONS'
    });
    return res.end();
  }

  if (pathname === '/api/stream') return handleStream(req, res);

  const route = routes[pathname];
  if (route) {
    const t0 = Date.now();
    try {
      const out = await route(u);
      out.tookMs = Date.now() - t0;
      return send(res, 200, out);
    } catch (err) {
      console.error(`[api] ${pathname} failed:`, err.message);
      return send(res, err.status || 502, {
        error: String(err.message || err),
        hint: 'Upstream provider unavailable. The page falls back to its offline simulation.',
        path: pathname
      });
    }
  }

  if (pathname.startsWith('/api/')) return send(res, 404, { error: 'unknown endpoint' });
  return serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  const s = P.indiaSession();
  console.log(`\n  VERDICT live server`);
  console.log(`  ────────────────────────────────────────────────`);
  console.log(`  site      http://localhost:${PORT}/`);
  console.log(`  health    http://localhost:${PORT}/api/health`);
  console.log(`  universe  ${SYM.all().length} symbols · ${P.rss.FEEDS.length} news feeds`);
  console.log(`  session   ${s.state} (${s.label}, IST ${s.ist.toISOString().slice(11, 16)})`);
  const keyed = Object.entries(CFG.keys).filter(([, v]) => v).map(([k]) => k);
  console.log(`  keys      ${keyed.length ? keyed.join(', ') : 'none — using free providers only'}`);
  console.log(`  polling   ${s.state === 'OPEN' ? CFG.pollOpenMs : CFG.pollClosedMs}ms\n`);
  startStream();
});

module.exports = { server, quotes, history, news, CFG };
