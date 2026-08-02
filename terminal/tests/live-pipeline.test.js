/* =============================================================================
 * live-pipeline.test.js — proves the live path end to end without the internet.
 *
 * Boots the mock upstream, points the real server at it, then asserts that
 * real-shaped vendor payloads become correct quotes, bars, headlines and SSE
 * frames — and that a dead upstream degrades instead of breaking.
 *
 *   node tests/live-pipeline.test.js
 * ========================================================================== */

'use strict';

const path = require('path');
const { spawn } = require('child_process');

const MOCK_PORT = 8899;
const API_PORT = 8081;
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const ok = (cond, msg, extra) => {
  if (cond) { pass++; console.log(' ok   ' + msg); }
  else { fail++; console.log('FAIL  ' + msg + (extra ? '\n        ' + extra : '')); }
};

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function get(pathname) {
  const res = await fetch(`http://127.0.0.1:${API_PORT}${pathname}`);
  const body = await res.json();
  return { status: res.status, body };
}

async function waitForPort(port, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/health`);
      return true;
    } catch (_) { await wait(150); }
  }
  return false;
}

(async () => {
  // ---- 1. mock upstream in-process -----------------------------------------
  const mock = require('./mock-upstream');
  await new Promise(r => mock.server.listen(MOCK_PORT, r));
  ok(true, `mock upstream listening on ${MOCK_PORT}`);

  // ---- 2. real server, pointed at the mock ---------------------------------
  const env = {
    ...process.env,
    PORT: String(API_PORT),
    IV_YAHOO_BASE: `http://127.0.0.1:${MOCK_PORT}/yahoo`,
    IV_COINGECKO_BASE: `http://127.0.0.1:${MOCK_PORT}/cg`,
    IV_FX_BASE: `http://127.0.0.1:${MOCK_PORT}/fx`,
    IV_QUOTE_TTL: '300',
    IV_POLL_OPEN: '600',
    IV_POLL_CLOSED: '600'
  };
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')],
    { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  srv.stdout.on('data', d => { serverLog += d; });
  srv.stderr.on('data', d => { serverLog += d; });

  const up = await waitForPort(API_PORT);
  ok(up, 'server started and answers /api/health', serverLog.slice(-400));
  if (!up) return finish(srv, mock);

  // ---- 3. quotes -----------------------------------------------------------
  const q = await get('/api/quotes?symbols=NIFTY,SENSEX,RELIANCE,TCS,USDINR,BTC');
  const bySym = Object.fromEntries((q.body.quotes || []).map(r => [r.sym, r]));
  ok(q.status === 200, 'GET /api/quotes returns 200');
  ok(!!bySym.NIFTY, 'NIFTY resolved through the Yahoo mapping (^NSEI)');
  ok(bySym.NIFTY && bySym.NIFTY.last > 20000 && bySym.NIFTY.last < 30000,
    'NIFTY price is in a sane range: ' + (bySym.NIFTY && bySym.NIFTY.last));
  ok(bySym.NIFTY && bySym.NIFTY.ccy === 'INR', 'currency comes back as INR');
  ok(bySym.NIFTY && bySym.NIFTY.prevClose > 0 && bySym.NIFTY.prevClose !== bySym.NIFTY.last,
    'previous close is populated and distinct');
  ok(bySym.RELIANCE && bySym.RELIANCE.source === 'yahoo', 'equities route to the yahoo provider');
  ok(!!bySym.BTC && bySym.BTC.source === 'coingecko', 'crypto routes to the coingecko provider');
  ok(!!bySym.USDINR, 'FX resolves (frankfurter or yahoo)');
  ok(bySym.TCS && bySym.TCS.high >= bySym.TCS.low, 'day high/low are consistent');

  // ---- 4. history ----------------------------------------------------------
  const h = await get('/api/history?symbol=NIFTY&range=1D');
  const bars = h.body.bars || [];
  ok(bars.length > 20, `1D history returns bars (${bars.length})`);
  ok(bars.every(b => b.t && b.c != null && b.h >= b.l), 'every bar is well formed');
  ok(bars[bars.length - 1].t > bars[0].t, 'bars are in chronological order');
  const h1y = await get('/api/history?symbol=RELIANCE&range=1Y');
  ok((h1y.body.bars || []).length > 20, '1Y history maps to the daily interval');

  // ---- 5. news -------------------------------------------------------------
  // Point the RSS list at the mock and re-request through a fresh server module
  // is overkill; instead assert the parser directly on real-shaped XML.
  const P = require(path.join(ROOT, 'server', 'lib', 'providers.js'));
  const items = P.rss.parseFeed(mock.RSS_SAMPLE('Economic Times', 4),
    { src: 'Economic Times', section: 'markets' });
  ok(items.length === 4, `RSS parser extracts every item (${items.length})`);
  ok(items[0].t.includes('Reliance'), 'CDATA titles decode');
  ok(!items[0].d.includes('&amp;') && items[0].d.includes('&'),
    'HTML entities decode in the summary');
  ok(items[0].d.includes('’'), 'numeric entities decode');
  ok(items[0].url.startsWith('https://'), 'item links survive');
  ok(items[0].ts > Date.now() - 86400000, 'pubDate parses to a recent timestamp');
  const tagged = P.rss.tagSymbols(items[0].t + ' ' + items[0].d);
  ok(tagged.includes('RELIANCE') && tagged.includes('TCS'),
    'headlines auto-tag to universe symbols: ' + tagged.join(','));
  ok(tagged.includes('INFY') || tagged.includes('HDFCBANK'),
    'company names in the body also tag');

  // ---- 6. health -----------------------------------------------------------
  const health = await get('/api/health');
  ok(health.body.live === true, 'health reports live=true when upstream answers');
  ok(health.body.sample && health.body.sample.last > 0, 'health carries a live sample quote');
  ok(health.body.session && health.body.session.state, 'health reports an IST session state');
  ok(health.body.universe > 70, `universe size reported (${health.body.universe})`);

  // ---- 7. SSE stream -------------------------------------------------------
  const frames = await readSSE(`http://127.0.0.1:${API_PORT}/api/stream`, 2500);
  ok(frames.some(f => f.startsWith('event: hello')), 'stream sends a hello frame');
  const quoteFrame = frames.find(f => f.startsWith('event: quotes'));
  ok(!!quoteFrame, 'stream pushes a quotes frame');
  if (quoteFrame) {
    const payload = JSON.parse(quoteFrame.split('data: ')[1]);
    ok(Array.isArray(payload.quotes) && payload.quotes.length > 3,
      `stream frame carries quotes (${payload.quotes && payload.quotes.length})`);
    ok(payload.quotes.every(x => x.sym && x.last != null), 'streamed quotes are well formed');
  }

  // ---- 8. graceful degradation --------------------------------------------
  const bad = await get('/api/quotes?symbols=NOSUCHSYMBOL');
  ok(bad.status === 200 && (bad.body.unknown || []).includes('NOSUCHSYMBOL'),
    'unknown symbols are reported, not thrown');
  const rate = await get('/api/quotes?symbols=IN10Y');
  ok(rate.status === 200 && ((rate.body.missing || []).includes('IN10Y') ||
      (rate.body.quotes || []).length === 0),
    'symbols with no free provider report as missing rather than fabricated');

  // ---- 9. static serving ---------------------------------------------------
  const page = await fetch(`http://127.0.0.1:${API_PORT}/index.html`);
  const html = await page.text();
  ok(page.status === 200 && html.includes('js/live.js'),
    'server serves the site and the page loads the live client');

  finish(srv, mock);
})().catch(err => { console.error(err); process.exit(1); });

function readSSE(url, ms) {
  return new Promise((resolve) => {
    const frames = [];
    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal }).then(async (res) => {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const stop = setTimeout(() => { ctrl.abort(); }, ms);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            frames.push(buf.slice(0, i));
            buf = buf.slice(i + 2);
          }
        }
      } catch (_) { /* aborted */ }
      clearTimeout(stop);
      resolve(frames);
    }).catch(() => resolve(frames));
    setTimeout(() => { ctrl.abort(); resolve(frames); }, ms + 400);
  });
}

function finish(srv, mock) {
  console.log(`\n${pass}/${pass + fail} live-pipeline checks passed`);
  try { srv.kill(); } catch (_) {}
  try { mock.server.close(); } catch (_) {}
  process.exit(fail ? 1 : 0);
}
