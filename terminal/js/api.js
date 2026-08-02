/* =============================================================================
 * api.js — the seam between the UI and whatever is behind it.
 *
 * Every page calls API.*; no page calls fetch() directly. When live.js has a
 * backend (IV.mode === 'live') these resolve to real data through it; otherwise
 * they resolve from the local simulation. Pages never need to know which.
 * ========================================================================== */

(function () {
  'use strict';
  const DATA = window.IV_DATA;

  /* Live or not is decided by live.js at boot and exposed as IV.mode. Never
     test CFG.features.liveData here — it is the string 'auto', which is truthy
     and would send stubbed calls at the placeholder endpoints. */
  const isLive = () => !!(window.IV && window.IV.mode === 'live');

  /* ---- vendor payload -> internal shape. Edit these, not the pages. ---- */
  const normalise = {
    quote: (raw) => ({
      sym: raw.symbol, last: +raw.price, prevClose: +raw.previousClose,
      open: +raw.open, high: +raw.high, low: +raw.low, volume: +raw.volume
    }),
    bar: (raw) => ({ t: +raw.timestamp, o: +raw.open, h: +raw.high, l: +raw.low, c: +raw.close, v: +raw.volume }),
    article: (raw) => ({
      id: raw.id, t: raw.headline, d: raw.summary, s: raw.section,
      a: raw.authorId, ts: Date.parse(raw.publishedAt), mins: raw.readMinutes,
      sym: raw.symbols || [], tags: raw.tags || [], p: !!raw.premium
    })
  };

  const API = {
    normalise,

    /* Quotes are kept current by live.js (SSE + polling); reading them from
       Market is always correct in both live and simulated mode. */
    async quotes(symbols) {
      if (window.IV) IV.watch(symbols);
      return Market.quotes(symbols);
    },

    /* Real OHLC when the backend is up, simulated bars when it is not. */
    async history(sym, range) {
      if (isLive()) {
        try {
          const j = await IV.history(sym, range);
          if (j && j.bars && j.bars.length) {
            Market.setHistory(sym, range, j.bars);
            return j.bars;
          }
        } catch (err) {
          console.warn('live history unavailable for', sym, range, err.message);
        }
      }
      return Market.history(sym, range);
    },

    /* Real ratios when the backend can get them. When it cannot, the result is
       flagged unavailable and the page shows dashes — it never silently swaps
       in simulated numbers. */
    async fundamentals(sym) {
      if (isLive()) {
        try {
          const fa = await IV.fundamentals(sym);
          if (fa && fa.available) return fa;
          return { available: false, reason: (fa && fa.reason) || 'not available upstream' };
        } catch (err) {
          return { available: false, reason: err.message };
        }
      }
      return Object.assign({ available: true, source: 'simulated' }, Market.fundamentals(sym));
    },

    async news(opts) {
      const o = opts || {};
      if (isLive()) {
        try {
          const j = await IV.news({
            section: o.section || '', symbol: o.symbol || '', q: o.q || '', limit: o.limit || 50
          });
          if (j && j.items) return j.items;
        } catch (err) { console.warn('live news unavailable:', err.message); }
      }
      {
        let list = DATA.ARTICLES.slice();
        if (o.section) list = list.filter(a => a.s === o.section);
        if (o.symbol) list = list.filter(a => (a.sym || []).includes(o.symbol));
        if (o.q) {
          const t = o.q.toLowerCase();
          list = list.filter(a => a.t.toLowerCase().includes(t) || a.d.toLowerCase().includes(t));
        }
        list.sort((x, y) => y.ts - x.ts);
        return list.slice(0, o.limit || 50);
      }
    },

    /* Local search always works; the backend widens it across the live wire. */
    async search(term) {
      const localResult = Market.search(term);
      if (isLive()) {
        try {
          const j = await IV.search(term);
          return {
            securities: localResult.securities,
            articles: (j.articles && j.articles.length) ? j.articles : localResult.articles
          };
        } catch (err) { /* fall through to local */ }
      }
      return localResult;
    },

    /* No calendar provider is wired up yet, so this always serves the local
       schedule. Point it at a vendor here when you have one. */
    async calendar(kind) {
      return kind === 'earnings' ? DATA.EARNINGS : DATA.ECO_CALENDAR;
    },

    /* Live ticks arrive over SSE inside live.js; subscribers just listen to
       Market either way. */
    connectStream(symbols, onTick) {
      return Market.subscribe(onTick);
    },

    /* Write paths. There is no signup or billing backend, so these stay
       stubbed rather than firing at a placeholder URL. Wire them to your own
       endpoint when one exists. */
    async subscribeNewsletter(email, ids) {
      await wait(450);
      return { ok: true, email, ids, stub: true };
    },
    async startSubscription(plan, email) {
      await wait(600);
      return { ok: true, plan, email, stub: true };
    }
  };

  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  window.API = API;
})();
