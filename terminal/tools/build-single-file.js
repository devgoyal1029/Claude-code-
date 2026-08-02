#!/usr/bin/env node
/* =============================================================================
 * build-single-file.js — bundle the whole site into one self-contained page.
 *
 *   node tools/build-single-file.js  ->  dist/verdict-demo.html
 *
 * Everything is inlined: CSS, JS, and the webfonts as base64 data URIs, so the
 * page makes zero network requests and can be opened from anywhere.
 *
 * The live backend cannot exist inside a single file, so the bundle runs on the
 * deterministic simulation and the masthead badge says SIMULATED. The real
 * product (`node server/server.js`) is the live one; this is the UI to click
 * through.
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* Pages in nav order. `home` is the entry route. */
const PAGES = [
  ['home', 'index.html'], ['markets', 'markets.html'], ['quote', 'quote.html'],
  ['terminal', 'terminal.html'], ['section', 'section.html'], ['article', 'article.html'],
  ['watchlist', 'watchlist.html'], ['search', 'search.html'], ['video', 'video.html'],
  ['podcasts', 'podcasts.html'], ['newsletters', 'newsletters.html'], ['subscribe', 'subscribe.html']
];

/* ---- fonts: only the weights actually used, base64'd into the CSS ---- */
const FONTS = [
  ['Archivo', 500], ['Archivo', 600], ['Archivo', 700], ['Archivo', 800], ['Archivo', 900],
  ['NunitoSans', 400], ['NunitoSans', 600], ['NunitoSans', 700],
  ['RobotoMono', 400], ['RobotoMono', 500], ['RobotoMono', 700]
];
const FAMILY = { Archivo: 'Archivo', NunitoSans: 'Nunito Sans', RobotoMono: 'Roboto Mono' };

function inlineFonts(css) {
  // drop the file-based @font-face block; re-emit it with data URIs
  css = css.replace(/@font-face \{ font-family: '(Archivo|Nunito Sans|Roboto Mono)';[\s\S]*?\}\n/g, '');
  const faces = FONTS.map(([file, weight]) => {
    const buf = fs.readFileSync(path.join(ROOT, 'fonts', `${file}-${weight}.woff2`));
    return `@font-face{font-family:'${FAMILY[file]}';font-weight:${weight};font-display:swap;` +
           `src:url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2')}`;
  }).join('\n');
  return faces + '\n' + css;
}

/* ---- pull the markup and the page script out of each page ---- */
function extract(file) {
  const html = read(file);
  const bodyOpen = html.indexOf('<body');
  const bodyTagEnd = html.indexOf('>', bodyOpen) + 1;
  const firstScript = html.indexOf('<script src=', bodyTagEnd);
  const markup = html.slice(bodyTagEnd, firstScript).trim();

  const m = html.match(/<script>\s*IV\.ready\(function \(\) \{([\s\S]*)\}\);\s*<\/script>/);
  if (!m) throw new Error('no page script found in ' + file);

  const bodyClass = (html.match(/<body class="([^"]*)"/) || [, ''])[1];
  const styleBlocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(x => x[1]).join('\n');
  const usesTerminalCss = html.includes('css/terminal.css');

  return { markup, script: m[1], bodyClass, styleBlocks, usesTerminalCss };
}

const pages = {};
PAGES.forEach(([route, file]) => { pages[route] = extract(file); });

const siteCss = inlineFonts(read('css/site.css'));
const termCss = read('css/terminal.css');
const pageCss = Object.values(pages).map(p => p.styleBlocks).filter(Boolean).join('\n');

const libs = ['js/config.js', 'js/data.js', 'js/market.js', 'js/api.js',
              'js/charts.js', 'js/components.js'].map(read).join('\n;\n');

const out = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VERDICT — India, Markets, Money and Power</title>
<meta name="description" content="India-first financial news, markets data and a keyboard-driven terminal. Single-file demo of the full interface.">
<style>
${siteCss}
${termCss}
${pageCss}
/* The bundle is one document, so every route shares one body. */
html, body { min-height: 100%; }
body.term { height: 100vh; }
#demoNote {
  position: fixed; left: 50%; transform: translateX(-50%); bottom: 14px; z-index: 200;
  background: var(--ink); color: var(--bg); font-family: var(--ui); font-size: 12px;
  padding: 9px 15px; display: flex; gap: 12px; align-items: center;
  box-shadow: var(--shadow); border-left: 4px solid var(--amber); max-width: calc(100vw - 28px);
}
#demoNote b { color: var(--amber); }
#demoNote button { background: none; border: 0; color: inherit; font-size: 15px; line-height: 1; }
@media (max-width: 700px) { #demoNote { font-size: 11px; padding: 8px 12px; } }
</style>
</head>
<body>
<div id="root"></div>

<script>
/* ---------------------------------------------------------------------------
 * Backend shim. There is no server inside a single file, so IV reports
 * simulated mode and every page renders against the deterministic tape. The
 * masthead badge reads SIMULATED as a result — the same code path the real
 * site uses when its server is unreachable.
 * ------------------------------------------------------------------------ */
window.IV = {
  ready: (fn) => fn(),
  watch: () => {},
  get mode() { return 'sim'; },
  status: () => ({ mode: 'sim', session: null, sources: [], lastUpdate: null, newsCount: 0, errors: [] }),
  history: () => Promise.reject(new Error('no backend in the single-file demo')),
  fundamentals: () => Promise.reject(new Error('no backend in the single-file demo')),
  news: () => Promise.reject(new Error('no backend in the single-file demo')),
  search: () => Promise.reject(new Error('no backend in the single-file demo'))
};
</script>

<script>
${libs}
</script>

<script>
/* --------------------------------------------------------------- router --- */
const PAGES = ${JSON.stringify(
  Object.fromEntries(Object.entries(pages).map(([k, v]) =>
    [k, { markup: v.markup, script: v.script, bodyClass: v.bodyClass }]))
)};

const FILE_TO_ROUTE = ${JSON.stringify(Object.fromEntries(PAGES.map(([r, f]) => [f, r])))};

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || 'home';
  const [route, query] = raw.split('?');
  return { route: PAGES[route] ? route : 'home', query: query || '' };
}

/* Page scripts start intervals (clocks, tickers, players). In the real site a
   navigation destroys them; here one document survives every route, so they are
   tracked and cleared on the way out — otherwise they keep writing into a DOM
   that no longer exists. */
let pageTimers = [];
const realSetInterval = window.setInterval.bind(window);
const realSetTimeout = window.setTimeout.bind(window);
function trackTimers(on) {
  if (on) {
    window.setInterval = (...a) => { const id = realSetInterval(...a); pageTimers.push(['i', id]); return id; };
    window.setTimeout = (...a) => { const id = realSetTimeout(...a); pageTimers.push(['t', id]); return id; };
  } else {
    window.setInterval = realSetInterval;
    window.setTimeout = realSetTimeout;
  }
}
function clearPageTimers() {
  pageTimers.forEach(([kind, id]) => kind === 'i' ? clearInterval(id) : clearTimeout(id));
  pageTimers = [];
}

let current = null;
function render() {
  const { route, query } = parseHash();
  const page = PAGES[route];
  clearPageTimers();

  /* Page scripts read location.search; keep it in sync with the hash so they
     work unmodified. */
  history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);

  document.body.className = page.bodyClass || '';
  document.body.innerHTML = '<div id="root"></div>';
  document.getElementById('root').outerHTML = page.markup;

  trackTimers(true);
  try {
    new Function(page.script)();
  } catch (err) {
    console.error('page "' + route + '" failed:', err);
    document.body.insertAdjacentHTML('beforeend',
      '<p style="padding:40px;font-family:var(--ui)">This view failed to render: ' +
      String(err.message).replace(/[<>&]/g, '') + '</p>');
  } finally {
    trackTimers(false);
  }
  current = route;
  showNote();
  window.scrollTo(0, 0);
}

/* Internal .html links become hash routes. */
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) return;
  const [file, query] = href.split('?');
  const route = FILE_TO_ROUTE[file];
  if (!route) return;
  e.preventDefault();
  location.hash = route + (query ? '?' + query : '');
}, true);

window.addEventListener('hashchange', render);

/* --------------------------------------------------------------- notice --- */
function showNote() {
  if (sessionStorage.getItem('iv.noteDismissed')) return;
  if (document.getElementById('demoNote')) return;
  const el = document.createElement('div');
  el.id = 'demoNote';
  el.innerHTML = '<span><b>Interface demo</b> — prices and headlines are a local simulation. ' +
    'The live build (real NSE data + Indian press) runs with <b>node server/server.js</b>.</span>' +
    '<button aria-label="Dismiss">&times;</button>';
  el.querySelector('button').onclick = () => {
    sessionStorage.setItem('iv.noteDismissed', '1');
    el.remove();
  };
  document.body.appendChild(el);
}

render();
</script>
</body>
</html>
`;

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const target = path.join(ROOT, 'dist', 'verdict-demo.html');
fs.writeFileSync(target, out);
console.log(`built ${target}  ${(out.length / 1024).toFixed(0)} KB  ` +
            `(${Object.keys(pages).length} routes, ${FONTS.length} fonts inlined)`);
