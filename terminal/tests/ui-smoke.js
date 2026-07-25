/* =============================================================================
 * ui-smoke.js — headless smoke + interaction tests for the terminal site.
 *
 *   npx http-server terminal -p 8899 &        (or: python3 -m http.server 8899 --directory terminal)
 *   node terminal/tests/ui-smoke.js
 *
 * Set BASE to point somewhere else. Requires playwright + a Chromium binary;
 * PW_CHROMIUM overrides the executable path.
 * ========================================================================== */

const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8899/';
const EXEC = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';

let playwright;
try {
  playwright = require('playwright');
} catch (_) {
  try { playwright = require('/opt/node22/lib/node_modules/playwright'); }
  catch (_2) { console.error('playwright not found — npm i -D playwright'); process.exit(2); }
}

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) failures++; console.log(`${cond ? ' ok ' : 'FAIL'}  ${msg}`); };

const PAGES = [
  'index.html', 'markets.html', 'quote.html?s=NVDA', 'article.html?id=a02',
  'section.html?s=technology', 'terminal.html', 'watchlist.html', 'video.html',
  'podcasts.html', 'newsletters.html', 'subscribe.html', 'search.html?q=oil'
];

(async () => {
  const browser = await playwright.chromium.launch({ executablePath: EXEC });

  /* ---- 1. every page renders clean at desktop, mobile, and in dark mode ---- */
  for (const viewport of [{ width: 1440, height: 950 }, { width: 390, height: 844 }, { width: 320, height: 720 }]) {
    for (const scheme of ['light', 'dark']) {
      for (const p of PAGES) {
        const ctx = await browser.newContext({ viewport, colorScheme: scheme });
        const pg = await ctx.newPage();
        const errs = [];
        pg.on('pageerror', e => errs.push(e.message));
        pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
        await pg.goto(BASE + p, { waitUntil: 'networkidle' });
        await pg.waitForTimeout(1500);
        const overflow = await pg.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const text = await pg.evaluate(() => document.body.innerText.length);
        ok(errs.length === 0 && overflow <= 2 && text > 800,
          `${viewport.width}px ${scheme} ${p} (text=${text} overflow=${overflow}) ${errs[0] || ''}`);
        await ctx.close();
      }
    }
  }

  /* ---- 2. interactions ---- */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));

  await pg.goto(BASE + 'terminal.html', { waitUntil: 'networkidle' });
  await pg.fill('#cmd', 'NVDA US EQUITY FA'); await pg.click('#go'); await pg.waitForTimeout(500);
  ok((await pg.textContent('.t-panel:nth-child(1) .ttl')).includes('NVDA'), 'terminal: security + function command');
  ok((await pg.textContent('.t-panel:nth-child(1) .t-body')).includes('P/E'), 'terminal: FA renders ratios');
  await pg.fill('#cmd', 'DEPTH'); await pg.press('#cmd', 'Enter'); await pg.waitForTimeout(400);
  ok((await pg.textContent('.t-panel:nth-child(2) .t-body')).includes('SPREAD'), 'terminal: DEPTH order book');
  await pg.fill('#cmd', 'BTC GP 1Y'); await pg.press('#cmd', 'Enter'); await pg.waitForTimeout(400);
  ok((await pg.textContent('#tSec')).includes('BTC'), 'terminal: active security follows the command');
  await pg.fill('#cmd', 'GARBAGEXYZ'); await pg.press('#cmd', 'Enter');
  ok((await pg.textContent('#footMsg')).includes('UNKNOWN'), 'terminal: unknown command is reported');
  await pg.fill('#cmd', 'TO'); await pg.waitForTimeout(200);
  ok(await pg.isVisible('#ac.open'), 'terminal: command autocomplete');
  const ph = await pg.evaluate(() => document.querySelector('.t-panel').getBoundingClientRect().height);
  ok(ph > 150 && ph < 700, `terminal: panels stay inside the viewport (${Math.round(ph)}px)`);

  await pg.goto(BASE + 'watchlist.html', { waitUntil: 'networkidle' });
  const before = await pg.$$eval('#tbl tbody tr', r => r.length);
  await pg.fill('#add', 'TSLA'); await pg.click('#addBtn'); await pg.waitForTimeout(400);
  ok(await pg.$$eval('#tbl tbody tr', r => r.length) === before + 1, 'watchlist: add symbol');
  await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(300);
  ok((await pg.textContent('#tbl')).includes('TSLA'), 'watchlist: persists across reloads');

  await pg.evaluate(() => localStorage.clear());
  let walled = null;
  for (const id of ['a01', 'a02', 'a04', 'a06']) {
    await pg.goto(BASE + 'article.html?id=' + id, { waitUntil: 'networkidle' });
    if (await pg.isVisible('.paywall-inner')) { walled = id; break; }
  }
  ok(walled === 'a06', `paywall: meters ${3} free premium reads (walled at ${walled})`);
  await pg.evaluate(() => localStorage.setItem('iv.subscriber', 'true'));
  await pg.reload({ waitUntil: 'networkidle' });
  ok(!(await pg.isVisible('.paywall-inner')), 'paywall: lifted for subscribers');

  await pg.goto(BASE + 'index.html', { waitUntil: 'networkidle' });
  await pg.keyboard.press('/'); await pg.waitForTimeout(250);
  await pg.fill('#searchInput', 'nvid'); await pg.waitForTimeout(350);
  ok((await pg.textContent('#searchResults')).includes('NVDA'), 'search: fuzzy security match');

  await pg.goto(BASE + 'quote.html?s=SPX', { waitUntil: 'networkidle' });
  await pg.click('#ranges button[data-r="1Y"]');
  await pg.click('#types button[data-t="candle"]');
  await pg.waitForTimeout(350);
  await pg.hover('#chart'); await pg.waitForTimeout(200);
  ok((await pg.textContent('#hoverInfo')).includes('O '), 'quote: chart ranges, types and crosshair');
  await pg.click('#themeBtn'); await pg.waitForTimeout(150);
  const t1 = await pg.getAttribute('html', 'data-theme');
  await pg.reload({ waitUntil: 'networkidle' });
  ok(t1 === await pg.getAttribute('html', 'data-theme'), 'theme: choice persists');

  await pg.goto(BASE + 'markets.html', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(700);
  await pg.click('.hm-cell'); await pg.waitForTimeout(400);
  ok((await pg.textContent('#hmMode')).includes('back to sectors'), 'markets: heat map drill-in');

  ok(errs.length === 0, 'no runtime errors during interaction' + (errs[0] ? ': ' + errs[0] : ''));

  await browser.close();
  console.log(`\n${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
