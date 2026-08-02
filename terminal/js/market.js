/* =============================================================================
 * market.js — the market data engine.
 *
 * Two modes, switched by IV_CONFIG.features.liveData:
 *   false -> deterministic simulation. Prices seeded per symbol so every page
 *            load shows the same "session", then walked forward on a timer.
 *   true  -> api.js is expected to feed real quotes into Market.ingest().
 *
 * Public surface:
 *   Market.quote(sym)             -> live quote object
 *   Market.quotes(list|class)     -> array of quotes
 *   Market.history(sym, range)    -> OHLCV bars for a chart range
 *   Market.depth(sym)             -> simulated order book
 *   Market.fundamentals(sym)      -> ratios / financials block
 *   Market.subscribe(fn)          -> tick callback, returns unsubscribe
 *   Market.movers(scope, dir, n)  -> gainers / losers / most active
 *   Market.ingest(sym, price)     -> push an external price in
 * ========================================================================== */

(function () {
  'use strict';

  const CFG = window.IV_CONFIG;
  const DATA = window.IV_DATA;
  const { hash, seeded } = window.IV_RAND;

  const quotes = new Map();
  const histories = new Map();
  const subs = new Set();
  let timer = null;

  const RANGES = {
    '1D': { bars: 390, stepMs: 60e3,        label: '1 Day' },
    '5D': { bars: 5 * 78, stepMs: 5 * 60e3, label: '5 Days' },
    '1M': { bars: 22, stepMs: 864e5,        label: '1 Month' },
    '6M': { bars: 128, stepMs: 864e5,       label: '6 Months' },
    'YTD': { bars: 118, stepMs: 864e5,      label: 'Year to Date' },
    '1Y': { bars: 252, stepMs: 864e5,       label: '1 Year' },
    '5Y': { bars: 260, stepMs: 7 * 864e5,   label: '5 Years' }
  };

  /* --- session state: every symbol gets an open/high/low/last/prevClose --- */
  function initSymbol(u) {
    const r = seeded(hash(u.sym + '|session'));
    const dayVol = u.vol / Math.sqrt(252);
    const drift = (r() - 0.48) * dayVol * 2.4;
    const prevClose = round(u.base / (1 + drift), u);
    const open = round(prevClose * (1 + (r() - 0.5) * dayVol * 0.8), u);
    const last = u.base;
    const hi = round(Math.max(open, last) * (1 + r() * dayVol * 0.5), u);
    const lo = round(Math.min(open, last) * (1 - r() * dayVol * 0.5), u);
    const volume = Math.floor((0.4 + r()) * volumeScale(u));
    const q = {
      sym: u.sym, name: u.name, cls: u.cls, ccy: u.ccy, sector: u.sector || null,
      region: u.region || null, unit: u.unit || null, mcap: u.mcap || null,
      last, open, high: hi, low: lo, prevClose, volume,
      bid: round(last * 0.9997, u), ask: round(last * 1.0003, u),
      dayHigh52: round(u.base * (1 + 0.12 + r() * 0.35), u),
      dayLow52: round(u.base * (1 - 0.12 - r() * 0.3), u),
      dir: 0, ts: Date.now(), meta: u
    };
    derive(q);
    quotes.set(u.sym, q);
  }

  function volumeScale(u) {
    if (u.cls === 'index') return 2.4e9;
    if (u.cls === 'equity') return 4.2e7;
    if (u.cls === 'crypto') return 1.8e10;
    if (u.cls === 'fx') return 8.4e10;
    return 3.1e5;
  }

  function decimals(u) {
    if (u.cls === 'fx') return u.sym === 'USDJPY' || u.sym === 'DXY' ? 3 : 4;
    if (u.cls === 'rate') return 3;
    if (u.cls === 'crypto') return u.base < 5 ? 4 : 2;
    if (u.cls === 'commodity') return u.base < 10 ? 3 : 2;
    return 2;
  }
  function round(v, u) { const d = decimals(u); return +(+v).toFixed(d); }

  function derive(q) {
    q.chg = +(q.last - q.prevClose).toFixed(6);
    q.pct = q.prevClose ? (q.chg / q.prevClose) * 100 : 0;
    q.decimals = decimals(q.meta);
  }

  DATA.UNIVERSE.forEach(initSymbol);

  /* --- tick: correlated random walk. Index moves drag their constituents. --- */
  let tickSeq = 0;
  function tick() {
    tickSeq++;
    const market = (Math.random() - 0.5) * 0.0007;   // common factor
    const touched = [];
    quotes.forEach(q => {
      const u = q.meta;
      const idio = (Math.random() - 0.5) * (u.vol / Math.sqrt(252 * 390)) * 6;
      const beta = u.cls === 'equity' ? 0.6 + (hash(u.sym) % 90) / 100 : u.cls === 'index' ? 1 : 0.25;
      let move = market * beta + idio;
      if (u.sym === 'VIX') move *= -3.2;             // vol trades inverse to beta
      const next = round(Math.max(q.last * (1 + move), 0.0001), u);
      if (next === q.last) return;
      q.dir = next > q.last ? 1 : -1;
      q.last = next;
      q.high = Math.max(q.high, next);
      q.low = Math.min(q.low, next);
      q.bid = round(next * 0.9997, u);
      q.ask = round(next * 1.0003, u);
      q.volume += Math.floor(volumeScale(u) / 4000 * (0.2 + Math.random()));
      q.ts = Date.now();
      derive(q);
      touched.push(q);
      const h = histories.get(q.sym + '|1D');
      if (h && h.length) {                            // extend the live bar
        const bar = h[h.length - 1];
        bar.c = next; bar.h = Math.max(bar.h, next); bar.l = Math.min(bar.l, next);
      }
    });
    if (touched.length) subs.forEach(fn => { try { fn(touched, tickSeq); } catch (e) { console.error(e); } });
  }

  function start() {
    if (timer || CFG.features.liveData) return;
    timer = setInterval(tick, CFG.features.tickMs);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { clearInterval(timer); timer = null; }
      else if (!timer) { timer = setInterval(tick, CFG.features.tickMs); }
    });
  }

  /* --- historical bars, deterministic per symbol+range --- */
  function history(sym, range) {
    const key = sym + '|' + range;
    if (histories.has(key)) return histories.get(key);
    const q = quotes.get(sym);
    if (!q) return [];
    const spec = RANGES[range] || RANGES['1D'];
    const u = q.meta;
    const r = seeded(hash(sym + range));
    const stepVol = u.vol * Math.sqrt(spec.stepMs / (252 * 864e5));
    const bars = [];
    // Walk backwards from the current price so the series always terminates
    // at the live quote, then reverse.
    let price = q.last;
    const t1 = Date.now();
    for (let i = 0; i < spec.bars; i++) {
      const drift = (r() - 0.5) * stepVol * 2;
      const prev = price / (1 + drift);
      const hi = Math.max(price, prev) * (1 + r() * stepVol * 0.6);
      const lo = Math.min(price, prev) * (1 - r() * stepVol * 0.6);
      bars.push({
        t: t1 - i * spec.stepMs,
        o: round(prev, u), h: round(hi, u), l: round(lo, u), c: round(price, u),
        v: Math.floor((0.3 + r()) * volumeScale(u) / (spec.bars / 4))
      });
      price = prev;
    }
    bars.reverse();
    if (range === '1D' && bars.length > 1) {
      // Anchor the session to the official open: correct the first bar fully and
      // taper the adjustment to zero at the live price, so the intraday series
      // agrees with the day change shown everywhere else.
      const f = q.open / bars[0].o - 1;
      const n = bars.length - 1;
      bars.forEach((b, i) => {
        const w = 1 - i / n;
        const k = 1 + f * w;
        b.o = round(b.o * k, u); b.h = round(b.h * k, u);
        b.l = round(b.l * k, u); b.c = round(b.c * k, u);
      });
      bars[0].o = q.open;
      bars[bars.length - 1].c = q.last;
    }
    histories.set(key, bars);
    return bars;
  }

  /* --- order book: layered depth around the touch --- */
  function depth(sym, levels) {
    const q = quotes.get(sym);
    if (!q) return { bids: [], asks: [] };
    const n = levels || 10;
    const r = seeded(hash(sym + '|depth') + Math.floor(Date.now() / 4000));
    const step = Math.max(q.last * 0.0002, Math.pow(10, -q.decimals));
    const mk = (side) => Array.from({ length: n }, (_, i) => {
      const px = side === 'bid' ? q.bid - i * step : q.ask + i * step;
      const size = Math.floor((1 + r() * 9) * (1 + i * 0.35) * 100);
      return { px: +px.toFixed(q.decimals), size, mm: ['GSCO', 'MSCO', 'JPMS', 'CITI', 'BARC', 'UBSW', 'NITE'][Math.floor(r() * 7)] };
    });
    return { bids: mk('bid'), asks: mk('ask') };
  }

  /* --- fundamentals / financial analysis block --- */
  function fundamentals(sym) {
    const q = quotes.get(sym);
    if (!q) return null;
    const r = seeded(hash(sym + '|fa'));
    const eps = +(q.last / (12 + r() * 34)).toFixed(2);
    const rev = (q.mcap ? q.mcap / (2 + r() * 6) : 1e10);
    const margin = 0.08 + r() * 0.32;
    const years = [0, 1, 2, 3].map(i => ({
      y: new Date().getFullYear() - i,
      rev: rev * Math.pow(1 - (0.06 + r() * 0.12), i),
      ni: rev * margin * Math.pow(1 - (0.07 + r() * 0.14), i),
      eps: eps * Math.pow(1 - (0.08 + r() * 0.12), i),
      fcf: rev * (margin * 0.7) * Math.pow(1 - (0.05 + r() * 0.13), i)
    }));
    return {
      eps, pe: +(q.last / eps).toFixed(2),
      pb: +(0.9 + r() * 9).toFixed(2),
      ps: +(0.8 + r() * 11).toFixed(2),
      evEbitda: +(5 + r() * 22).toFixed(1),
      divYield: +(r() * 3.6).toFixed(2),
      payout: +(r() * 60).toFixed(1),
      beta: +(0.5 + r() * 1.4).toFixed(2),
      roe: +(4 + r() * 40).toFixed(1),
      roa: +(1 + r() * 18).toFixed(1),
      grossMargin: +((0.25 + r() * 0.5) * 100).toFixed(1),
      operMargin: +(margin * 100).toFixed(1),
      netDebtEbitda: +((r() * 4) - 0.8).toFixed(2),
      currentRatio: +(0.8 + r() * 2.4).toFixed(2),
      shares: q.mcap ? q.mcap / q.last : null,
      float: 0.72 + r() * 0.26,
      shortInterest: +(r() * 9).toFixed(2),
      years,
      /* Sell-side consensus */
      ratings: { buy: 8 + Math.floor(r() * 24), hold: 3 + Math.floor(r() * 16), sell: Math.floor(r() * 7) },
      target: +(q.last * (0.86 + r() * 0.42)).toFixed(2)
    };
  }

  /* --- movers --- */
  function movers(scope, dir, n) {
    let list = [...quotes.values()];
    if (scope && scope !== 'all') list = list.filter(q => q.cls === scope);
    list = list.filter(q => q.cls !== 'rate');
    if (dir === 'active') list.sort((a, b) => (b.volume * b.last) - (a.volume * a.last));
    else if (dir === 'losers') list.sort((a, b) => a.pct - b.pct);
    else list.sort((a, b) => b.pct - a.pct);
    return list.slice(0, n || 10);
  }

  /* ---------------------------------------------------------------------------
   * Live mode. live.js pushes real vendor quotes in through applyQuotes(); the
   * simulator is stopped so nothing invented ever mixes with real prices.
   * ------------------------------------------------------------------------ */
  let mode = 'sim';
  const unavailable = new Set();

  function setMode(m) {
    mode = m;
    if (m === 'live' && timer) { clearInterval(timer); timer = null; }
    histories.clear();                 // simulated history must not survive
  }

  function applyQuotes(rows) {
    const touched = [];
    (rows || []).forEach(r => {
      const q = quotes.get(r.sym);
      if (!q || r.last == null) return;
      unavailable.delete(r.sym);
      const prev = q.last;
      q.last = r.last;
      if (r.prevClose != null) q.prevClose = r.prevClose;
      if (r.open != null) q.open = r.open;
      if (r.high != null) q.high = r.high;
      if (r.low != null) q.low = r.low;
      if (r.volume != null) q.volume = r.volume;
      if (r.high52 != null) q.dayHigh52 = r.high52;
      if (r.low52 != null) q.dayLow52 = r.low52;
      if (r.ccy) q.ccy = r.ccy;
      if (r.exch) q.exch = r.exch;
      q.source = r.source || 'live';
      q.marketState = r.marketState || null;
      q.ts = r.ts || Date.now();
      q.dir = r.last > prev ? 1 : r.last < prev ? -1 : 0;
      // decimals come from the live price itself, not a guess
      q.liveDecimals = decimalsFor(r.last, q.meta);
      derive(q);
      q.decimals = q.liveDecimals;
      touched.push(q);
      const h = histories.get(q.sym + '|1D');
      if (h && h.length) {
        const bar = h[h.length - 1];
        bar.c = q.last; bar.h = Math.max(bar.h, q.last); bar.l = Math.min(bar.l, q.last);
      }
    });
    if (touched.length) {
      tickSeq++;
      subs.forEach(fn => { try { fn(touched, tickSeq); } catch (e) { console.error(e); } });
    }
    return touched.length;
  }

  function decimalsFor(v, u) {
    if (u.cls === 'fx') return Math.abs(v) > 50 ? 3 : 4;
    if (u.cls === 'rate') return 3;
    if (Math.abs(v) >= 1000) return 2;
    if (Math.abs(v) >= 10) return 2;
    if (Math.abs(v) >= 1) return 3;
    return 4;
  }

  /* Real feeds do not cover everything (Indian G-Sec yields, for one). Those
     are flagged so the UI can show a dash instead of a fabricated number. */
  function markUnavailable(sym) {
    const q = quotes.get(sym);
    if (!q) return;
    unavailable.add(sym);
    q.unavailable = true;
  }

  /* Replace a symbol's chart series with real bars from the backend. */
  function setHistory(sym, range, bars) {
    if (!bars || !bars.length) return;
    histories.set(sym + '|' + range, bars);
  }

  const Market = {
    RANGES,
    start,
    tickNow: tick,
    setMode, applyQuotes, markUnavailable, setHistory,
    get mode() { return mode; },
    isUnavailable: (s) => unavailable.has(s),
    quote: (sym) => quotes.get(String(sym).toUpperCase()) || null,
    quotes(sel) {
      if (!sel) return [...quotes.values()];
      if (Array.isArray(sel)) return sel.map(s => quotes.get(s)).filter(Boolean);
      return [...quotes.values()].filter(q => q.cls === sel);
    },
    history, depth, fundamentals, movers,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    ingest(sym, price, extra) {                 // entry point for real feeds
      const q = quotes.get(sym); if (!q) return;
      q.dir = price > q.last ? 1 : price < q.last ? -1 : 0;
      q.last = price;
      Object.assign(q, extra || {});
      q.high = Math.max(q.high, price); q.low = Math.min(q.low, price);
      q.ts = Date.now(); derive(q);
      subs.forEach(fn => fn([q], ++tickSeq));
    },
    /* Sector aggregation used by the heat map. */
    sectors() {
      const map = new Map();
      quotes.forEach(q => {
        if (q.cls !== 'equity') return;
        const s = q.sector || 'Other';
        if (!map.has(s)) map.set(s, { sector: s, members: [], mcap: 0, pct: 0 });
        const e = map.get(s);
        e.members.push(q); e.mcap += q.mcap || 1e10;
      });
      map.forEach(e => {
        const w = e.members.reduce((acc, q) => acc + (q.mcap || 1e10), 0);
        e.pct = e.members.reduce((acc, q) => acc + q.pct * ((q.mcap || 1e10) / w), 0);
      });
      return [...map.values()].sort((a, b) => b.mcap - a.mcap);
    },
    /* Search across the universe + newsroom, ranked. */
    search(term) {
      const t = String(term || '').trim().toLowerCase();
      if (!t) return { securities: [], articles: [] };
      const securities = [...quotes.values()].map(q => {
        const s = q.sym.toLowerCase(), n = q.name.toLowerCase();
        let score = 0;
        if (s === t) score = 100; else if (s.startsWith(t)) score = 80;
        else if (n.startsWith(t)) score = 60; else if (n.includes(t)) score = 40;
        else if (s.includes(t)) score = 30;
        return { q, score };
      }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map(x => x.q);
      const articles = DATA.ARTICLES.filter(a =>
        a.t.toLowerCase().includes(t) || a.d.toLowerCase().includes(t) ||
        (a.tags || []).some(g => g.toLowerCase().includes(t))
      ).slice(0, 8);
      return { securities, articles };
    }
  };

  window.Market = Market;
  if (!CFG.features.liveData) start();
})();
