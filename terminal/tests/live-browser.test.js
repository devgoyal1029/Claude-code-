/* =============================================================================
 * live-browser.test.js — proves the BROWSER consumes the live backend.
 *
 * Boots mock upstream + real server, drives Chromium against it, and asserts
 * the page renders server-supplied prices and headlines (not the simulation),
 * shows the LIVE badge, streams updates over SSE — then, with the server gone,
 * falls back and labels itself SIMULATED.
 *
 *   node tests/live-browser.test.js
 * ========================================================================== */

'use strict';

const path = require('path');
const { spawn } = require('child_process');

const MOCK_PORT = 8897;
const API_PORT = 8082;
const ROOT = path.resolve(__dirname, '..');
const EXEC = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';

let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require('/opt/node22/lib/node_modules/playwright'); }

let pass = 0, fail = 0;
const ok = (c, m, extra) => {
  if (c) { pass++; console.log(' ok   ' + m); }
  else { fail++; console.log('FAIL  ' + m + (extra ? '\n        ' + extra : '')); }
};
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  /* An orphan from a previous run would silently serve live data and make the
     offline-fallback assertions meaningless. Refuse to start. */
  for (const port of [MOCK_PORT, API_PORT]) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(700) });
      console.error(`port ${port} is already in use — kill the stale process first ` +
                    `(pkill -f server/server.js)`);
      process.exit(2);
    } catch (_) { /* free, as expected */ }
  }

  const mock = require('./mock-upstream');
  await new Promise(r => mock.server.listen(MOCK_PORT, r));

  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(API_PORT),
      IV_YAHOO_BASE: `http://127.0.0.1:${MOCK_PORT}/yahoo`,
      IV_COINGECKO_BASE: `http://127.0.0.1:${MOCK_PORT}/cg`,
      IV_FX_BASE: `http://127.0.0.1:${MOCK_PORT}/fx`,
      IV_RSS_MOCK: `http://127.0.0.1:${MOCK_PORT}/rss`,
      IV_QUOTE_TTL: '400',
      IV_POLL_OPEN: '800',
      IV_POLL_CLOSED: '800'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  srv.stdout.on('data', d => log += d);
  srv.stderr.on('data', d => log += d);

  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${API_PORT}/api/health`); break; }
    catch (_) { await wait(150); }
  }

  const browser = await playwright.chromium.launch({ executablePath: EXEC });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const pg = await ctx.newPage();
  const errs = [];
  const benignRef = (t) => /example\.test|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|Failed to fetch/.test(t);
  pg.on('pageerror', e => errs.push(e.message));
  const benign = (t) => /example\.test|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|Failed to fetch/.test(t);
  pg.on('console', m => { if (m.type() === 'error' && !benign(m.text())) errs.push(m.text()); });

  const BASE = `http://127.0.0.1:${API_PORT}`;

  // ---- home page against the live backend ---------------------------------
  await pg.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(2500);

  const mode = await pg.evaluate(() => window.IV && IV.mode);
  ok(mode === 'live', `client detected live mode (got "${mode}")`, log.slice(-300));

  const badge = (await pg.textContent('#srcLabel') || '').trim();
  ok(badge.startsWith('LIVE'), `masthead badge reads LIVE (got "${badge}")`);

  const marketMode = await pg.evaluate(() => Market.mode);
  ok(marketMode === 'live', 'simulator stood down in favour of real data');

  // the number on screen must equal what the API served
  const apiQuote = await (await fetch(`${BASE}/api/quotes?symbols=NIFTY`)).json();
  const apiLast = apiQuote.quotes[0].last;
  const uiLast = await pg.evaluate(() => Market.quote('NIFTY').last);
  ok(Math.abs(uiLast - apiLast) / apiLast < 0.02,
    `NIFTY on screen matches the API (ui=${uiLast} api=${apiLast})`);

  const cellText = await pg.textContent('#mktHero .mkt-cell .px');
  ok(cellText && cellText.replace(/[^\d.]/g, '').length > 4,
    `market strip renders a real price (${cellText})`);

  const source = await pg.evaluate(() => Market.quote('NIFTY').source);
  ok(source === 'yahoo', `quote carries its provenance (source=${source})`);

  // ---- real headlines replaced the fixture corpus --------------------------
  const isLiveNews = await pg.evaluate(() => IV_DATA.isLive);
  ok(isLiveNews === true, 'newsroom switched to the live feed');
  const lead = (await pg.textContent('.lead .hl-xl') || '').trim();
  ok(lead.length > 10, `lead headline rendered from the wire ("${lead.slice(0, 60)}…")`);
  const leadHref = await pg.getAttribute('.lead .card', 'href');
  ok(leadHref && leadHref.startsWith('http'), 'live stories link out to the publisher');
  const target = await pg.getAttribute('.lead .card', 'target');
  ok(target === '_blank', 'external stories open in a new tab');

  const wireCount = await pg.$$eval('#wire li', els => els.length);
  ok(wireCount > 3, `wire rail populated from the feed (${wireCount} lines)`);

  // ---- SSE actually moves the tape ----------------------------------------
  await fetch(`http://127.0.0.1:${MOCK_PORT}/__drift`);
  const before = await pg.evaluate(() => Market.quote('NIFTY').last);
  await pg.waitForTimeout(3000);
  const after = await pg.evaluate(() => Market.quote('NIFTY').last);
  ok(before !== after, `price updated live without a reload (${before} -> ${after})`);

  // ---- quote page pulls real OHLC -----------------------------------------
  await pg.goto(BASE + '/quote.html?s=RELIANCE', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(2500);
  const px = (await pg.textContent('#qPx') || '').trim();
  ok(px && px !== '—' && px.length > 3, `quote page shows a live price (${px})`);
  const barCount = await pg.evaluate(async () => (await API.history('RELIANCE', '1D')).length);
  ok(barCount > 20, `chart series came from the backend (${barCount} bars)`);

  // ---- terminal shows the live feed state ---------------------------------
  await pg.goto(BASE + '/terminal.html', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(2200);
  const feed = (await pg.textContent('#stFeed') || '').trim();
  ok(feed.startsWith('LIVE'), `terminal status bar reads LIVE (got "${feed}")`);
  await pg.fill('#cmd', 'NIFTY IND');
  await pg.press('#cmd', 'Enter');
  await pg.waitForTimeout(800);
  const indPanel = await pg.textContent('.t-panel:nth-child(1) .t-body');
  ok(indPanel.includes('NIFTY') && indPanel.includes('SENSEX'),
    'IND function lists the India indices with live values');

  ok(errs.length === 0, 'no console/page errors in live mode', errs.slice(0, 3).join(' | '));

  // ---- kill the backend: must degrade, not break --------------------------
  await new Promise(resolve => {
    srv.once('exit', resolve);
    srv.kill('SIGKILL');
    setTimeout(resolve, 3000);
  });
  await wait(500);
  const pg2 = await ctx.newPage();
  const errs2 = [];
  pg2.on('pageerror', e => errs2.push(e.message));
  // serve the same files statically without the API
  const staticSrv = spawn(process.execPath, ['-e', `
    const http=require('http'),fs=require('fs'),path=require('path');
    const ROOT=${JSON.stringify(ROOT)};
    http.createServer((q,s)=>{
      if(q.url.startsWith('/api/')){s.writeHead(503);return s.end('{}');}
      const f=path.join(ROOT,q.url==='/'?'/index.html':q.url.split('?')[0]);
      fs.readFile(f,(e,b)=>{ if(e){s.writeHead(404);return s.end('no');}
        const ext=path.extname(f);
        s.writeHead(200,{'Content-Type':ext==='.js'?'text/javascript':ext==='.css'?'text/css':'text/html'});
        s.end(b);});
    }).listen(${API_PORT});
  `], { stdio: 'ignore' });
  await wait(900);
  let apiDead = false;
  try {
    const probe = await fetch(`${BASE}/api/health`);
    apiDead = !probe.ok;
  } catch (_) { apiDead = true; }
  ok(apiDead, 'backend is confirmed down before testing the fallback');

  await pg2.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await pg2.waitForTimeout(4200);
  const mode2 = await pg2.evaluate(() => window.IV && IV.mode);
  ok(mode2 === 'sim', `falls back to simulation when the API is down (got "${mode2}")`);
  const badge2 = (await pg2.textContent('#srcLabel') || '').trim();
  ok(badge2 === 'SIMULATED', `badge warns the data is not real (got "${badge2}")`);
  const stillRenders = await pg2.evaluate(() => document.body.innerText.length);
  ok(stillRenders > 2000, 'page still fully renders with no backend');
  ok(errs2.length === 0, 'no errors in fallback mode', errs2.slice(0, 3).join(' | '));

  staticSrv.kill();
  await browser.close();
  try { mock.server.close(); } catch (_) {}

  console.log(`\n${pass}/${pass + fail} live-browser checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
