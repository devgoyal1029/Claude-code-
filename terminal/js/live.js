/* =============================================================================
 * live.js — turns the site from a simulation into a live product.
 *
 * On boot it asks the backend whether real data is available:
 *   · yes → pulls real quotes + real headlines, pushes them into Market and
 *           IV_DATA, stops the simulator, opens an SSE stream for live ticks.
 *   · no  → leaves the deterministic simulation running and flags the UI as
 *           SIMULATED, so a demo without a server still works and is never
 *           mistaken for real data.
 *
 * Page scripts call IV.ready(fn) instead of running immediately, so they render
 * once against whichever dataset won.
 * ========================================================================== */

(function () {
  'use strict';

  const CFG = window.IV_CONFIG;
  const BASE = (CFG.api && CFG.api.base) || '/api';

  const state = {
    mode: 'booting',        // 'live' | 'sim' | 'booting'
    session: null,
    sources: [],
    lastUpdate: null,
    newsCount: 0,
    errors: [],
    stream: null,
    pollMs: 15000,
    watched: new Set()
  };

  const queue = [];
  let booted = false;

  function ready(fn) {
    if (booted) { try { fn(); } catch (e) { console.error(e); } return; }
    queue.push(fn);
  }
  function flush() {
    booted = true;
    while (queue.length) {
      const fn = queue.shift();
      try { fn(); } catch (e) { console.error(e); }
    }
    window.dispatchEvent(new CustomEvent('iv:datasource', { detail: snapshot() }));
  }

  const snapshot = () => ({
    mode: state.mode, session: state.session, sources: state.sources.slice(),
    lastUpdate: state.lastUpdate, newsCount: state.newsCount, errors: state.errors.slice()
  });

  async function getJSON(path, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 6000);
    try {
      const res = await fetch(BASE + path, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  /* ------------------------------------------------------------ bootstrap -- */
  async function boot() {
    let health = null;
    try {
      health = await getJSON('/health', 3500);
    } catch (err) {
      state.errors.push('backend unreachable: ' + err.message);
    }

    if (!health || !health.live) {
      state.mode = 'sim';
      if (health && !health.live) state.errors.push('backend up but upstream data unavailable');
      return flush();
    }

    state.mode = 'live';
    state.session = health.session;
    state.pollMs = health.pollMs || 15000;
    state.sources = Object.entries(health.providers || {})
      .filter(([, v]) => v && v !== 'not configured').map(([k]) => k);

    Market.setMode('live');

    /* Pull the whole universe once, plus the newsroom, before the page draws. */
    const wanted = Market.quotes().map(q => q.sym);
    const [qres, nres] = await Promise.allSettled([
      getJSON('/quotes?symbols=' + encodeURIComponent(wanted.join(',')), 12000),
      getJSON('/news?limit=120', 12000)
    ]);

    if (qres.status === 'fulfilled' && qres.value.quotes) {
      Market.applyQuotes(qres.value.quotes);
      state.lastUpdate = Date.now();
      (qres.value.missing || []).forEach(s => Market.markUnavailable(s));
    } else {
      state.errors.push('quotes: ' + (qres.reason && qres.reason.message));
    }

    if (nres.status === 'fulfilled' && (nres.value.items || []).length) {
      IV_DATA.setLiveArticles(nres.value.items);
      state.newsCount = nres.value.items.length;
    } else {
      state.errors.push('news: ' + (nres.reason && nres.reason.message || 'empty'));
    }

    flush();
    openStream();
    startPolling();
    refreshNews();
  }

  /* ----------------------------------------------------------- streaming -- */
  function openStream() {
    if (!window.EventSource) return;
    try {
      const es = new EventSource(BASE + '/stream');
      state.stream = es;
      es.addEventListener('quotes', (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
        if (msg.quotes && msg.quotes.length) {
          Market.applyQuotes(msg.quotes);
          state.lastUpdate = Date.now();
          state.session = state.session || {};
          if (msg.session) state.session = Object.assign({}, state.session, { state: msg.session });
          window.dispatchEvent(new CustomEvent('iv:datasource', { detail: snapshot() }));
        }
      });
      es.addEventListener('error', () => {
        /* EventSource retries on its own; polling below is the safety net. */
      });
    } catch (err) {
      state.errors.push('stream: ' + err.message);
    }
  }

  /* Polling covers every symbol on the page, including ones outside the
     server's stream list. */
  function startPolling() {
    const tick = async () => {
      const syms = [...new Set([...state.watched, ...visibleSymbols()])];
      if (syms.length) {
        try {
          const r = await getJSON('/quotes?symbols=' + encodeURIComponent(syms.join(',')), 9000);
          if (r.quotes) { Market.applyQuotes(r.quotes); state.lastUpdate = Date.now(); }
        } catch (err) { /* transient; stream and next poll cover it */ }
      }
      setTimeout(tick, state.pollMs);
    };
    setTimeout(tick, state.pollMs);
  }

  function visibleSymbols() {
    const out = new Set();
    document.querySelectorAll('[data-sym],[data-c],[data-w],[data-tsym],[data-s]').forEach(el => {
      const v = el.dataset.sym || el.dataset.c || el.dataset.w || el.dataset.tsym || el.dataset.s;
      if (v && Market.quote(v)) out.add(v);
    });
    const page = new URLSearchParams(location.search).get('s');
    if (page && Market.quote(page.toUpperCase())) out.add(page.toUpperCase());
    return out;
  }

  function refreshNews() {
    setInterval(async () => {
      try {
        const r = await getJSON('/news?limit=120', 10000);
        if (r.items && r.items.length) {
          IV_DATA.setLiveArticles(r.items);
          state.newsCount = r.items.length;
          window.dispatchEvent(new CustomEvent('iv:news', { detail: r.items }));
        }
      } catch (_) {}
    }, 120000);
  }

  window.IV = {
    ready,
    watch: (syms) => (syms || []).forEach(s => state.watched.add(s)),
    status: snapshot,
    get mode() { return state.mode; },
    history: async (sym, range) => getJSON(`/history?symbol=${encodeURIComponent(sym)}&range=${range}`, 12000),
    fundamentals: async (sym) => getJSON('/fundamentals?symbol=' + encodeURIComponent(sym), 12000),
    news: async (params) => getJSON('/news?' + new URLSearchParams(params || {}), 10000),
    search: async (q) => getJSON('/search?q=' + encodeURIComponent(q), 8000)
  };

  /* Navigating away cancels in-flight polls; the browser surfaces that as an
     unhandled "Failed to fetch". It is not an error condition — swallow only
     that class and let everything else through to the console. */
  window.addEventListener('unhandledrejection', (ev) => {
    const msg = String((ev.reason && ev.reason.message) || ev.reason || '');
    if (/Failed to fetch|NetworkError|The user aborted|signal is aborted/i.test(msg)) {
      ev.preventDefault();
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
