/* =============================================================================
 * split-deploy.test.js — proves the shared-hosting split actually works.
 *
 * On Hostinger Premium/Business the pages and the backend sit on different
 * origins, which is the one arrangement the same-origin dev setup never
 * exercises: cross-origin fetch, cross-origin EventSource, and a build whose
 * API base points somewhere else entirely. This runs that arrangement for
 * real — statics from one port, the API from another, a mock upstream behind
 * it — and checks the page goes LIVE.
 *
 *   node tests/split-deploy.test.js
 * ========================================================================== */

'use strict';

const path = require('path');
const { spawn, spawnSync } = require('child_process');

const MOCK_PORT = 8902;
const API_PORT = 8903;
const WEB_PORT = 8904;
const ROOT = path.resolve(__dirname, '..');
const EXEC = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';

let pass = 0, fail = 0;
const ok = (cond, msg, extra) => {
  if (cond) { pass++; console.log(' ok   ' + msg); }
  else { fail++; console.log('FAIL  ' + msg + (extra ? '\n        ' + extra : '')); }
};
const wait = (ms) => new Promise(r => setTimeout(r, ms));

let playwright;
try { playwright = require('playwright'); }
catch (_) {
  try { playwright = require('/opt/node22/lib/node_modules/playwright'); }
  catch (_2) { console.error('playwright not found — npm i -D playwright'); process.exit(2); }
}

async function portFree(port) {
  try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(700) }); return false; }
  catch (_) { return true; }
}

async function waitFor(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { await fetch(url); return true; } catch (_) { await wait(150); }
  }
  return false;
}

(async () => {
  for (const p of [MOCK_PORT, API_PORT, WEB_PORT]) {
    if (!await portFree(p)) {
      console.error(`port ${p} is already in use — a stale server would invalidate this test`);
      process.exit(2);
    }
  }

  /* ---- 1. build the upload bundle against a different origin -------------- */
  const apiOrigin = `http://localhost:${API_PORT}`;
  const build = spawnSync(process.execPath, ['tools/build-static.js', apiOrigin],
    { cwd: ROOT, encoding: 'utf8' });
  ok(build.status === 0, 'build-static.js produces an upload bundle', build.stderr);

  const fs = require('fs');
  const OUT = path.join(ROOT, 'dist', 'static');
  const cfg = fs.readFileSync(path.join(OUT, 'js', 'config.js'), 'utf8');
  ok(cfg.includes(`'${apiOrigin}/api'`), 'the bundle points at the remote backend, not /api');
  ok(!fs.existsSync(path.join(OUT, 'server')), 'server/ is not shipped to the static host');
  ok(fs.existsSync(path.join(OUT, '.htaccess')), '.htaccess ships with the bundle');

  const httpsRefused = spawnSync(process.execPath, ['tools/build-static.js', 'http://example.com'],
    { cwd: ROOT, encoding: 'utf8' });
  ok(httpsRefused.status !== 0, 'a plain-http remote backend is refused (mixed content)');

  /* ---- 2. stand up the two origins ---------------------------------------- */
  const procs = [];
  const stop = () => procs.forEach(p => { try { p.kill('SIGKILL'); } catch (_) {} });

  procs.push(spawn(process.execPath, ['tests/mock-upstream.js'],
    { cwd: ROOT, env: { ...process.env, MOCK_PORT: String(MOCK_PORT) }, stdio: 'ignore' }));
  await waitFor(`http://127.0.0.1:${MOCK_PORT}/__mxcount`);

  const mock = `http://127.0.0.1:${MOCK_PORT}`;
  procs.push(spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT, stdio: 'ignore',
    env: {
      ...process.env,
      PORT: String(API_PORT),
      IV_YAHOO_BASE: `${mock}/yahoo`,
      IV_YAHOO_COOKIE_URL: `${mock}/cookie`,
      IV_COINGECKO_BASE: `${mock}/cg`,
      IV_FX_BASE: `${mock}/fx`,
      IV_RSS_MOCK: `${mock}/rss`,
      IV_MARKETAUX_BASE: `${mock}/marketaux`,
      IV_MARKETAUX: 'mock-token',
      /* The market is closed while this runs, and a closed market only pushes
         a frame a minute. Tighten it so the SSE check does not sit and wait. */
      IV_POLL_OPEN: '600',
      IV_POLL_CLOSED: '600'
    }
  }));
  ok(await waitFor(`http://127.0.0.1:${API_PORT}/api/health`), 'backend is up on its own origin');

  /* Serve the bundle exactly as a static host would — no Node behind it. */
  procs.push(spawn('python3', ['-m', 'http.server', String(WEB_PORT), '--directory', OUT],
    { cwd: ROOT, stdio: 'ignore' }));
  ok(await waitFor(`http://127.0.0.1:${WEB_PORT}/index.html`), 'pages are up on a static host');

  /* ---- 3. the browser has to bridge the two ------------------------------- */
  const browser = await playwright.chromium.launch({ executablePath: EXEC });
  const pg = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  const errs = [];
  /* The mock's article photos point at a hostname that does not resolve, which
     is the fallback path the browser suite already covers — not a defect here. */
  const imageNoise = (t) => /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|images\.example\.test/.test(t);
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error' && !imageNoise(m.text())) errs.push(m.text()); });

  /* Not networkidle: a live page holds an SSE connection open forever, so the
     network never goes idle — which is the point. */
  await pg.goto(`http://localhost:${WEB_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => window.IV && window.IV.mode, null, { timeout: 15000 }).catch(() => {});

  const mode = await pg.evaluate(() => window.IV && window.IV.mode);
  ok(mode === 'live', `cross-origin fetch works — page reports mode=${mode}`);

  const badge = (await pg.textContent('#srcLabel').catch(() => '') || '').trim();
  ok(badge.startsWith('LIVE'), `badge reads LIVE on a split deploy (got "${badge}")`);

  const cors = errs.filter(e => /CORS|Access-Control|Mixed Content/i.test(e));
  ok(cors.length === 0, 'no CORS or mixed-content errors', cors.slice(0, 2).join(' | '));

  const priced = await pg.evaluate(() =>
    [...document.querySelectorAll('[data-sym]')].filter(el => /\d/.test(el.textContent)).length);
  ok(priced > 0, `quotes rendered from the remote backend (${priced} elements)`);

  /* SSE is the piece most likely to break across origins or behind a proxy. */
  const streamed = await pg.evaluate(() => new Promise(resolve => {
    const base = (window.IV_CONFIG.api && window.IV_CONFIG.api.base) || '/api';
    const es = new EventSource(base + '/stream');
    const done = (v) => { es.close(); resolve(v); };
    /* The server sends named events, not default messages. */
    es.addEventListener('quotes', (e) => {
      try { if ((JSON.parse(e.data).quotes || []).length) done(true); } catch (_) {}
    });
    es.onerror = () => done(false);
    setTimeout(() => done(false), 12000);
  }));
  ok(streamed, 'cross-origin EventSource delivers live tick frames');

  ok(errs.length === 0, 'no page errors on the split deploy', errs.slice(0, 3).join(' | '));

  await browser.close();
  stop();

  console.log(`\n${pass}/${pass + fail} split-deploy checks ${fail ? 'FAILED' : 'passed'}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
