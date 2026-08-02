/* =============================================================================
 * api.js — the seam between the UI and whatever is behind it.
 *
 * Every page calls API.*; nothing calls fetch() directly. With
 * IV_CONFIG.features.liveData === false these resolve from the local
 * simulation. Flip the flag, fill in IV_CONFIG.keys/endpoints, and adapt the
 * `normalise*` functions to your vendor's payload — no page code changes.
 * ========================================================================== */

(function () {
  'use strict';
  const CFG = window.IV_CONFIG;
  const DATA = window.IV_DATA;

  const live = () => CFG.features.liveData;

  function url(base, params) {
    const u = new URL(base);
    Object.entries(params || {}).forEach(([k, v]) => v != null && u.searchParams.set(k, v));
    return u.toString();
  }

  async function get(endpoint, params, keyName) {
    const res = await fetch(url(endpoint, params), {
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + CFG.keys[keyName || 'marketData']
      }
    });
    if (!res.ok) throw new Error(endpoint + ' -> HTTP ' + res.status);
    return res.json();
  }

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
      if (window.IV && IV.mode === 'live') {
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

    async fundamentals(sym) {
      if (!live()) return Market.fundamentals(sym);
      return get(CFG.endpoints.fundamentals, { symbol: sym });
    },

    async news(opts) {
      const o = opts || {};
      if (window.IV && IV.mode === 'live') {
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
      if (window.IV && IV.mode === 'live') {
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

    async calendar(kind) {
      if (!live()) return kind === 'earnings' ? DATA.EARNINGS : DATA.ECO_CALENDAR;
      return get(CFG.endpoints.calendar, { kind });
    },

    /* Websocket streaming. No-op in simulation; Market's own timer drives ticks. */
    connectStream(symbols, onTick) {
      if (!live()) return Market.subscribe(onTick);
      const ws = new WebSocket(CFG.endpoints.stream + '?token=' + encodeURIComponent(CFG.keys.streaming));
      ws.addEventListener('open', () => ws.send(JSON.stringify({ action: 'subscribe', symbols })));
      ws.addEventListener('message', (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
        (msg.ticks || []).forEach(t => Market.ingest(t.symbol, +t.price));
        onTick(Market.quotes(symbols));
      });
      return () => ws.close();
    },

    /* Write paths — stubbed so forms behave without a backend. */
    async subscribeNewsletter(email, ids) {
      if (!live()) { await wait(450); return { ok: true, email, ids, stub: true }; }
      return post(CFG.endpoints.newsletter, { email, newsletters: ids });
    },
    async startSubscription(plan, email) {
      if (!live()) { await wait(600); return { ok: true, plan, email, stub: true }; }
      return post(CFG.endpoints.subscribe, { plan, email });
    }
  };

  async function post(endpoint, body) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CFG.keys.news },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(endpoint + ' -> HTTP ' + res.status);
    return res.json();
  }
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  window.API = API;
})();
