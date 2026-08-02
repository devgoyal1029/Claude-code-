/* =============================================================================
 * providers.js — every upstream the server can talk to.
 *
 * Free / no key:  Yahoo Finance (quotes + OHLC), CoinGecko (crypto),
 *                 Frankfurter (FX), Indian financial press RSS.
 * Keyed (optional, used automatically when the key is present in config):
 *                 Twelve Data, Finnhub, Alpha Vantage, Marketaux, NewsAPI.
 *
 * Every base URL is overridable via env so the whole pipeline can be pointed
 * at a local mock upstream for testing (see tests/mock-upstream.js).
 * ========================================================================== */

'use strict';

const F = require('./fetcher');
const SYM = require('./symbols');

const BASE = {
  yahoo: process.env.IV_YAHOO_BASE || 'https://query1.finance.yahoo.com',
  yahoo2: process.env.IV_YAHOO_BASE || 'https://query2.finance.yahoo.com',
  coingecko: process.env.IV_COINGECKO_BASE || 'https://api.coingecko.com/api/v3',
  frankfurter: process.env.IV_FX_BASE || 'https://api.frankfurter.app',
  twelvedata: process.env.IV_TWELVEDATA_BASE || 'https://api.twelvedata.com',
  finnhub: process.env.IV_FINNHUB_BASE || 'https://finnhub.io/api/v1',
  marketaux: process.env.IV_MARKETAUX_BASE || 'https://api.marketaux.com/v1',
  newsapi: process.env.IV_NEWSAPI_BASE || 'https://newsapi.org/v2'
};

/* --------------------------------------------------------------- helpers -- */
const num = (v) => (v == null || Number.isNaN(+v) ? null : +v);

/* Yahoo wraps numbers as { raw, fmt, longFmt } — or sometimes ships them bare. */
const raw = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return num(v.raw);
  return num(v);
};
/* Ratios arrive as fractions; the UI wants percent. */
const pctOf = (v) => {
  const n = raw(v);
  return n == null ? null : +(n * 100).toFixed(2);
};

async function pool(items, size, worker) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(x =>
      worker(x).catch(err => ({ __error: String(err.message || err), input: x })))));
  }
  return out;
}

/* ============================================================== YAHOO ===== */
const yahoo = {
  /* The chart endpoint returns quote AND history in one call and needs no
     auth, which makes it the most reliable free source for NSE/BSE. */
  async chart(ySym, range = '1d', interval = '5m') {
    const url = `${BASE.yahoo}/v8/finance/chart/${encodeURIComponent(ySym)}` +
                `?range=${range}&interval=${interval}&includePrePost=false`;
    const j = await F.json(url);
    const r = j && j.chart && j.chart.result && j.chart.result[0];
    if (!r) throw new Error('yahoo: empty result for ' + ySym);
    return r;
  },

  quoteFromChart(sym, r) {
    const m = r.meta || {};
    const last = num(m.regularMarketPrice);
    const prev = num(m.chartPreviousClose) ?? num(m.previousClose);
    const q = ((r.indicators || {}).quote || [])[0] || {};
    const opens = (q.open || []).filter(v => v != null);
    return {
      sym,
      last,
      prevClose: prev,
      open: opens.length ? num(opens[0]) : null,
      high: num(m.regularMarketDayHigh),
      low: num(m.regularMarketDayLow),
      volume: num(m.regularMarketVolume),
      ccy: m.currency || null,
      exch: m.fullExchangeName || m.exchangeName || null,
      high52: num(m.fiftyTwoWeekHigh),
      low52: num(m.fiftyTwoWeekLow),
      marketState: m.marketState || null,
      ts: (m.regularMarketTime ? m.regularMarketTime * 1000 : Date.now()),
      source: 'yahoo'
    };
  },

  barsFromChart(r) {
    const ts = r.timestamp || [];
    const q = ((r.indicators || {}).quote || [])[0] || {};
    const out = [];
    for (let i = 0; i < ts.length; i++) {
      const o = num(q.open?.[i]), h = num(q.high?.[i]),
            l = num(q.low?.[i]), c = num(q.close?.[i]);
      if (c == null) continue;                      // Yahoo pads gaps with nulls
      out.push({ t: ts[i] * 1000, o: o ?? c, h: h ?? c, l: l ?? c, c, v: num(q.volume?.[i]) || 0 });
    }
    return out;
  },

  async quotes(syms) {
    const results = await pool(syms, 8, async (sym) => {
      const y = SYM.yahooTicker(sym);
      if (!y) throw new Error('no yahoo ticker for ' + sym);
      const r = await yahoo.chart(y, '1d', '5m');
      return yahoo.quoteFromChart(sym, r);
    });
    return results.filter(r => r && !r.__error && r.last != null);
  },

  /* quoteSummary (fundamentals) is gated behind a cookie + crumb pair. Do the
     handshake once an hour and reuse it; if it fails we report fundamentals as
     unavailable rather than substituting invented ratios. */
  _crumb: { value: null, cookie: null, at: 0 },
  async crumb() {
    const c = yahoo._crumb;
    if (c.value && Date.now() - c.at < 3600e3) return c;
    const consent = await fetch(process.env.IV_YAHOO_COOKIE_URL || 'https://fc.yahoo.com/', {
      headers: { 'User-Agent': F.UA }, redirect: 'manual'
    }).catch(() => null);
    const setCookie = consent && (consent.headers.getSetCookie
      ? consent.headers.getSetCookie().join('; ')
      : consent.headers.get('set-cookie'));
    const cookie = (setCookie || '').split(',').map(s => s.split(';')[0].trim())
      .filter(Boolean).join('; ');
    const res = await fetch(`${BASE.yahoo2}/v1/test/getcrumb`, {
      headers: { 'User-Agent': F.UA, 'Cookie': cookie, 'Accept': 'text/plain' }
    });
    if (!res.ok) throw new Error('crumb handshake failed: HTTP ' + res.status);
    const value = (await res.text()).trim();
    if (!value || value.length > 32) throw new Error('crumb handshake returned junk');
    yahoo._crumb = { value, cookie, at: Date.now() };
    return yahoo._crumb;
  },

  async fundamentals(sym) {
    const y = SYM.yahooTicker(sym);
    if (!y) throw new Error('no yahoo ticker for ' + sym);
    const { value, cookie } = await yahoo.crumb();
    const modules = ['defaultKeyStatistics', 'financialData', 'summaryDetail',
                     'recommendationTrend', 'incomeStatementHistory', 'assetProfile'].join(',');
    const url = `${BASE.yahoo2}/v10/finance/quoteSummary/${encodeURIComponent(y)}` +
                `?modules=${modules}&crumb=${encodeURIComponent(value)}`;
    const j = await F.json(url, { headers: { Cookie: cookie } });
    const r = j && j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
    if (!r) throw new Error('yahoo: no fundamentals for ' + sym);

    const ks = r.defaultKeyStatistics || {};
    const fd = r.financialData || {};
    const sd = r.summaryDetail || {};
    const ap = r.assetProfile || {};
    const rt = (r.recommendationTrend && r.recommendationTrend.trend || [])[0] || {};
    const inc = ((r.incomeStatementHistory || {}).incomeStatementHistory) || [];

    return {
      available: true,
      source: 'yahoo',
      pe: raw(sd.trailingPE) ?? raw(ks.trailingPE),
      forwardPe: raw(sd.forwardPE) ?? raw(ks.forwardPE),
      eps: raw(ks.trailingEps),
      pb: raw(ks.priceToBook),
      ps: raw(ks.priceToSalesTrailing12Months) ?? raw(sd.priceToSalesTrailing12Months),
      evEbitda: raw(ks.enterpriseToEbitda),
      divYield: pctOf(sd.dividendYield),
      payout: pctOf(sd.payoutRatio),
      beta: raw(ks.beta) ?? raw(sd.beta),
      roe: pctOf(fd.returnOnEquity),
      roa: pctOf(fd.returnOnAssets),
      grossMargin: pctOf(fd.grossMargins),
      operMargin: pctOf(fd.operatingMargins),
      profitMargin: pctOf(fd.profitMargins),
      revenue: raw(fd.totalRevenue),
      revenueGrowth: pctOf(fd.revenueGrowth),
      debtToEquity: raw(fd.debtToEquity),
      currentRatio: raw(fd.currentRatio),
      freeCashflow: raw(fd.freeCashflow),
      shares: raw(ks.sharesOutstanding),
      float: raw(ks.floatShares),
      shortInterest: pctOf(ks.shortPercentOfFloat),
      target: raw(fd.targetMeanPrice),
      targetHigh: raw(fd.targetHighPrice),
      targetLow: raw(fd.targetLowPrice),
      analysts: raw(fd.numberOfAnalystOpinions),
      recommendation: fd.recommendationKey || null,
      ratings: {
        buy: (rt.strongBuy || 0) + (rt.buy || 0),
        hold: rt.hold || 0,
        sell: (rt.sell || 0) + (rt.strongSell || 0)
      },
      employees: raw(ap.fullTimeEmployees),
      sector: ap.sector || null,
      industry: ap.industry || null,
      website: ap.website || null,
      summary: ap.longBusinessSummary || null,
      years: inc.slice(0, 4).map(y2 => ({
        y: y2.endDate && y2.endDate.fmt ? +String(y2.endDate.fmt).slice(0, 4) : null,
        rev: raw(y2.totalRevenue),
        ni: raw(y2.netIncome),
        op: raw(y2.operatingIncome)
      })).filter(x => x.y && x.rev != null)
    };
  },

  async history(sym, range) {
    const y = SYM.yahooTicker(sym);
    if (!y) throw new Error('no yahoo ticker for ' + sym);
    const spec = {
      '1D': ['1d', '5m'], '5D': ['5d', '15m'], '1M': ['1mo', '1d'],
      '6M': ['6mo', '1d'], 'YTD': ['ytd', '1d'], '1Y': ['1y', '1d'], '5Y': ['5y', '1wk']
    }[range] || ['1d', '5m'];
    const r = await yahoo.chart(y, spec[0], spec[1]);
    return { bars: yahoo.barsFromChart(r), meta: yahoo.quoteFromChart(sym, r), source: 'yahoo' };
  }
};

/* =========================================================== COINGECKO ==== */
const coingecko = {
  async quotes(syms) {
    const defs = syms.map(s => SYM.get(s)).filter(u => u && u.cg);
    if (!defs.length) return [];
    const ids = defs.map(d => d.cg).join(',');
    const url = `${BASE.coingecko}/simple/price?ids=${ids}&vs_currencies=inr` +
                `&include_24hr_change=true&include_24hr_vol=true`;
    const j = await F.json(url);
    return defs.map(d => {
      const row = j[d.cg];
      if (!row) return null;
      const last = num(row.inr);
      const pct = num(row.inr_24h_change) || 0;
      const prev = last / (1 + pct / 100);
      return {
        sym: d.sym, last, prevClose: prev, open: prev,
        high: null, low: null, volume: num(row.inr_24h_vol),
        ccy: 'INR', ts: Date.now(), source: 'coingecko'
      };
    }).filter(Boolean);
  }
};

/* ========================================================== FRANKFURTER === */
const frankfurter = {
  async quotes(syms) {
    const defs = syms.map(s => SYM.get(s)).filter(u => u && u.fx);
    if (!defs.length) return [];
    const bases = [...new Set(defs.map(d => d.fx[0]))];
    const out = [];
    for (const base of bases) {
      const quotes = [...new Set(defs.filter(d => d.fx[0] === base).map(d => d.fx[1]))];
      const [today, yday] = await Promise.all([
        F.json(`${BASE.frankfurter}/latest?from=${base}&to=${quotes.join(',')}`),
        F.json(`${BASE.frankfurter}/${isoDaysAgo(4)}..?from=${base}&to=${quotes.join(',')}`).catch(() => null)
      ]);
      defs.filter(d => d.fx[0] === base).forEach(d => {
        const last = num(today?.rates?.[d.fx[1]]);
        if (last == null) return;
        let prev = last;
        if (yday && yday.rates) {
          const days = Object.keys(yday.rates).sort();
          const prior = days[days.length - 2] || days[days.length - 1];
          prev = num(yday.rates[prior]?.[d.fx[1]]) ?? last;
        }
        out.push({
          sym: d.sym, last, prevClose: prev, open: prev, high: null, low: null,
          volume: null, ccy: d.fx[1], ts: Date.now(), source: 'frankfurter'
        });
      });
    }
    return out;
  }
};
function isoDaysAgo(n) {
  return new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
}

/* ============================================== KEYED PROVIDERS (optional) = */
function keyed(cfg) {
  return {
    /* Twelve Data covers Indian G-Sec yields, which no free feed carries. */
    async quotes(syms) {
      if (!cfg.keys.twelvedata) return [];
      const defs = syms.map(s => SYM.get(s)).filter(u => u && u.td);
      if (!defs.length) return [];
      const url = `${BASE.twelvedata}/quote?symbol=${defs.map(d => d.td).join(',')}` +
                  `&apikey=${encodeURIComponent(cfg.keys.twelvedata)}`;
      const j = await F.json(url);
      const rows = defs.length === 1 ? { [defs[0].td]: j } : j;
      return defs.map(d => {
        const r = rows[d.td];
        if (!r || r.status === 'error') return null;
        return {
          sym: d.sym, last: num(r.close), prevClose: num(r.previous_close),
          open: num(r.open), high: num(r.high), low: num(r.low),
          volume: num(r.volume), ccy: r.currency || d.ccy,
          ts: Date.now(), source: 'twelvedata'
        };
      }).filter(Boolean);
    },

    async finnhubQuotes(syms) {
      if (!cfg.keys.finnhub) return [];
      const out = await pool(syms, 5, async (sym) => {
        const u = SYM.get(sym); if (!u || !u.y) throw new Error('no ticker');
        const j = await F.json(`${BASE.finnhub}/quote?symbol=${encodeURIComponent(u.y)}&token=${cfg.keys.finnhub}`);
        if (j.c == null) throw new Error('no data');
        return {
          sym, last: num(j.c), prevClose: num(j.pc), open: num(j.o),
          high: num(j.h), low: num(j.l), volume: null, ccy: u.ccy,
          ts: (j.t ? j.t * 1000 : Date.now()), source: 'finnhub'
        };
      });
      return out.filter(r => r && !r.__error);
    },

    /* ---------------------------------------------------------------------
     * Marketaux. The free plan is metered per request, not per article, so
     * the budget below is spent deliberately: a handful of pages once an hour
     * rather than a call per page view. Marketaux is an ENRICHMENT layer — RSS
     * remains the backbone because it is unlimited — and it contributes the
     * two things RSS cannot: a real photo per story and per-entity sentiment.
     * ------------------------------------------------------------------- */
    async news(query) {
      if (cfg.keys.marketaux) return marketaux.fetch(cfg, query);
      if (cfg.keys.newsapi) {
        const j = await F.json(`${BASE.newsapi}/top-headlines?country=in&category=business&pageSize=50` +
          `&apiKey=${cfg.keys.newsapi}` + (query ? `&q=${encodeURIComponent(query)}` : ''));
        return (j.articles || []).map((a, i) => ({
          id: 'na-' + i + '-' + (Date.parse(a.publishedAt) || 0), t: a.title,
          d: a.description || '', url: a.url, src: a.source?.name || 'NewsAPI',
          image: a.urlToImage || null,
          ts: Date.parse(a.publishedAt) || Date.now(), sym: [], source: 'newsapi'
        }));
      }
      return [];
    }
  };
}

/* ============================================================ MARKETAUX === */
/* A day's requests are a fixed, small budget. The counter resets at IST
   midnight and every call is drawn against it, so a runaway loop or a busy day
   can never blow through the quota and leave the site without news. */
const marketaux = {
  budget: { day: null, used: 0 },

  _istDay() {
    const now = new Date();
    return new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000)
      .toISOString().slice(0, 10);
  },
  spend(n) {
    const day = marketaux._istDay();
    if (marketaux.budget.day !== day) marketaux.budget = { day, used: 0 };
    marketaux.budget.used += n;
    return marketaux.budget.used;
  },
  remaining(cfg) {
    const day = marketaux._istDay();
    if (marketaux.budget.day !== day) return cfg.marketauxDailyBudget;
    return Math.max(0, cfg.marketauxDailyBudget - marketaux.budget.used);
  },

  normalise(a) {
    const entities = (a.entities || []).filter(e => e.symbol);
    /* Marketaux scores sentiment per entity; the story-level figure is the
       mean of the entities it actually mentions. */
    const scored = entities.filter(e => typeof e.sentiment_score === 'number');
    const sentiment = scored.length
      ? +(scored.reduce((s, e) => s + e.sentiment_score, 0) / scored.length).toFixed(3)
      : null;
    return {
      id: 'mx-' + a.uuid,
      t: a.title,
      d: a.description || a.snippet || '',
      url: a.url,
      image: a.image_url || null,
      src: a.source || 'Marketaux',
      ts: Date.parse(a.published_at) || Date.now(),
      sym: entities.map(e => String(e.symbol).replace(/\.(NS|BO)$/i, '')).slice(0, 6),
      sentiment,
      entities: entities.slice(0, 6).map(e => ({
        symbol: String(e.symbol).replace(/\.(NS|BO)$/i, ''),
        name: e.name,
        score: typeof e.sentiment_score === 'number' ? e.sentiment_score : null
      })),
      source: 'marketaux'
    };
  },

  async page(cfg, params) {
    const q = new URLSearchParams({
      api_token: cfg.keys.marketaux,
      language: 'en',
      countries: 'in',
      limit: String(cfg.marketauxPageSize),
      ...params
    });
    const j = await F.json(`${BASE.marketaux}/news/all?${q}`);
    if (j && j.error) throw new Error('marketaux: ' + (j.error.message || j.error.code));
    return {
      items: (j.data || []).map(marketaux.normalise),
      meta: j.meta || {}
    };
  },

  async fetch(cfg, query) {
    const budgetLeft = marketaux.remaining(cfg);
    if (budgetLeft <= 0) {
      console.warn('[marketaux] daily budget spent; serving RSS only until IST midnight');
      return [];
    }
    const pages = Math.max(1, Math.min(cfg.marketauxPagesPerRefresh, budgetLeft));
    const out = [];
    let meta = {};
    for (let p = 1; p <= pages; p++) {
      try {
        const res = await marketaux.page(cfg, Object.assign(
          { page: String(p) },
          query ? { search: query } : { filter_entities: 'true' }
        ));
        marketaux.spend(1);
        meta = res.meta;
        out.push(...res.items);
        /* Stop early rather than burning budget on empty pages. */
        if (!res.items.length) break;
        if (meta.found && p * cfg.marketauxPageSize >= meta.found) break;
      } catch (err) {
        marketaux.spend(1);
        console.warn('[marketaux] page', p, 'failed:', err.message);
        break;
      }
    }
    console.log(`[marketaux] ${out.length} articles from ${pages} request(s); ` +
                `${marketaux.remaining(cfg)}/${cfg.marketauxDailyBudget} left today` +
                (meta.returned ? ` (api returns ${meta.returned}/request)` : ''));
    return out;
  }
};

/* ================================================================ RSS ===== */
/* Indian financial press. Each feed is tagged with the section it maps to. */
const FEEDS = [
  { url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', src: 'Economic Times', section: 'markets' },
  { url: 'https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms', src: 'Economic Times', section: 'economics' },
  { url: 'https://economictimes.indiatimes.com/tech/rssfeeds/13357270.cms', src: 'ET Tech', section: 'technology' },
  { url: 'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms', src: 'Economic Times', section: 'companies' },
  { url: 'https://www.moneycontrol.com/rss/marketreports.xml', src: 'Moneycontrol', section: 'markets' },
  { url: 'https://www.moneycontrol.com/rss/business.xml', src: 'Moneycontrol', section: 'companies' },
  { url: 'https://www.moneycontrol.com/rss/economy.xml', src: 'Moneycontrol', section: 'economics' },
  { url: 'https://www.livemint.com/rss/markets', src: 'Mint', section: 'markets' },
  { url: 'https://www.livemint.com/rss/companies', src: 'Mint', section: 'companies' },
  { url: 'https://www.livemint.com/rss/economy', src: 'Mint', section: 'economics' },
  { url: 'https://www.livemint.com/rss/money', src: 'Mint', section: 'wealth' },
  { url: 'https://www.business-standard.com/rss/markets-106.rss', src: 'Business Standard', section: 'markets' },
  { url: 'https://www.business-standard.com/rss/economy-102.rss', src: 'Business Standard', section: 'economics' },
  { url: 'https://www.thehindubusinessline.com/markets/feeder/default.rss', src: 'BusinessLine', section: 'markets' },
  { url: 'https://www.financialexpress.com/market/feed/', src: 'Financial Express', section: 'markets' },
  { url: 'https://www.financialexpress.com/business/feed/', src: 'Financial Express', section: 'companies' },
  { url: 'https://news.google.com/rss/search?q=india+markets+when:2d&hl=en-IN&gl=IN&ceid=IN:en', src: 'Google News', section: 'markets' },
  { url: 'https://news.google.com/rss/search?q=india+startups+OR+technology+when:2d&hl=en-IN&gl=IN&ceid=IN:en', src: 'Google News', section: 'technology' },
  { url: 'https://news.google.com/rss/search?q=RBI+OR+"india+inflation"+when:2d&hl=en-IN&gl=IN&ceid=IN:en', src: 'Google News', section: 'economics' },
  { url: 'https://news.google.com/rss/search?q=india+crypto+regulation+when:7d&hl=en-IN&gl=IN&ceid=IN:en', src: 'Google News', section: 'crypto' },
  { url: 'https://news.google.com/rss/search?q=india+renewable+energy+OR+climate+when:7d&hl=en-IN&gl=IN&ceid=IN:en', src: 'Google News', section: 'green' },
  { url: 'https://news.google.com/rss/search?q=india+policy+parliament+when:2d&hl=en-IN&gl=IN&ceid=IN:en', src: 'Google News', section: 'politics' }
];

/* Small, dependency-free RSS/Atom reader. Handles CDATA, entities and both
   <item> (RSS) and <entry> (Atom). */
function parseFeed(xml, meta) {
  const items = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  const atom = blocks.length ? [] : xml.split(/<entry[\s>]/i).slice(1);
  const src = blocks.length ? blocks : atom;
  const isAtom = !blocks.length;

  for (const b of src) {
    const body = b.split(isAtom ? /<\/entry>/i : /<\/item>/i)[0];
    const title = clean(tag(body, 'title'));
    if (!title) continue;
    let link = clean(tag(body, 'link'));
    if (isAtom && !link) {
      const m = body.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = m ? m[1] : '';
    }
    const date = clean(tag(body, 'pubDate')) || clean(tag(body, 'published')) ||
                 clean(tag(body, 'updated')) || clean(tag(body, 'dc:date'));
    const rawDesc = clean(tag(body, 'description') || tag(body, 'summary') || tag(body, 'content'));
    const desc = stripTags(rawDesc);
    const ts = date ? (Date.parse(date) || Date.now()) : Date.now();
    items.push({
      id: 'rss-' + hash(link || title),
      t: decode(title),
      d: decode(desc).slice(0, 320),
      url: link,
      image: feedImage(body, rawDesc),
      src: meta.src,
      s: meta.section,
      ts,
      source: 'rss'
    });
  }
  return items;
}

/* Indian publishers ship the article photo in the feed itself, in one of four
   places depending on the CMS. Try them in order of reliability. */
function feedImage(body, rawDesc) {
  const attr = (re) => { const m = body.match(re); return m ? decode(m[1]) : null; };
  const candidate =
    attr(/<media:content[^>]+url=["']([^"']+)["']/i) ||
    attr(/<media:thumbnail[^>]+url=["']([^"']+)["']/i) ||
    attr(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image/i) ||
    attr(/<enclosure[^>]+type=["']image[^>]*url=["']([^"']+)["']/i) ||
    (rawDesc && (rawDesc.match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1]) ||
    attr(/<image[^>]*>\s*<url>([^<]+)<\/url>/i);
  if (!candidate) return null;
  const url = String(candidate).trim();
  /* Only https — a mixed-content image would be blocked on a secure page. */
  if (!/^https:\/\//i.test(url)) return null;
  /* Skip tracking pixels and spacer gifs that some feeds embed. */
  if (/\b1x1\b|spacer|pixel\.gif|blank\.(gif|png)/i.test(url)) return null;
  return url;
}

function tag(s, name) {
  const m = s.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? m[1] : '';
}
function clean(s) {
  return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}
function stripTags(s) { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function decode(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8216;|&lsquo;/g, '‘')
    .replace(/&#8220;|&ldquo;/g, '“').replace(/&#8221;|&rdquo;/g, '”')
    .replace(/&#8211;|&ndash;/g, '–').replace(/&#8212;|&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .trim();
}
function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < String(str).length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0).toString(36);
}

/* Tag a headline with any universe symbols it mentions, so story ↔ security
   linking works on real news the same way it did on the fixture corpus. */
/* A first word is only usable as a hint when it identifies exactly one
   security. "Nifty" heads five index names and "Tata"/"Bajaj"/"Adani" head
   several companies, so those are dropped rather than matching all of them. */
const FIRST_WORD_COUNT = new Map();
SYM.UNIVERSE.forEach(u => {
  const w = u.name.toLowerCase().split(/[\s&]+/)[0];
  FIRST_WORD_COUNT.set(w, (FIRST_WORD_COUNT.get(w) || 0) + 1);
});

const NAME_HINTS = SYM.UNIVERSE
  .filter(u => u.cls === 'equity' || u.cls === 'index')
  .map(u => {
    const name = u.name.toLowerCase();
    const first = name.split(/[\s&]+/)[0];
    const pats = [
      { re: wordRe(name), score: 3 },                       // full name
      { re: wordRe(u.sym.toLowerCase()), score: 2 }         // ticker
    ];
    if (first.length > 4 && FIRST_WORD_COUNT.get(first) === 1) {
      pats.push({ re: wordRe(first), score: 1 });           // distinctive first word
    }
    return { sym: u.sym, pats };
  });

function wordRe(s) {
  return new RegExp('(^|[^a-z0-9])' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i');
}

function tagSymbols(text) {
  const t = String(text || '');
  const scored = [];
  for (const h of NAME_HINTS) {
    let best = 0;
    for (const p of h.pats) if (p.re.test(t)) best = Math.max(best, p.score);
    if (best) scored.push({ sym: h.sym, score: best });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 6).map(x => x.sym);
}

/* Point the whole feed list at a mock host for offline testing. */
const ACTIVE_FEEDS = process.env.IV_RSS_MOCK
  ? ['markets', 'economics', 'technology', 'companies', 'crypto'].map(section => ({
      url: `${process.env.IV_RSS_MOCK}?name=${section}`,
      src: 'Mock ' + section, section
    }))
  : FEEDS;

const rss = {
  FEEDS: ACTIVE_FEEDS,
  parseFeed,
  tagSymbols,
  async fetchAll(feeds = ACTIVE_FEEDS) {
    const results = await pool(feeds, 6, async (f) => {
      const xml = await F.text(f.url, { retries: 1, timeout: 8000 });
      return parseFeed(xml, f);
    });
    const items = [];
    const seen = new Set();
    for (const r of results) {
      if (!Array.isArray(r)) continue;
      for (const it of r) {
        const key = it.t.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
        if (seen.has(key)) continue;
        seen.add(key);
        it.sym = tagSymbols(it.t + ' ' + it.d);
        items.push(it);
      }
    }
    items.sort((a, b) => b.ts - a.ts);
    return items;
  }
};

/* ==================================================== market session ====== */
/* NSE/BSE: 09:15–15:30 IST, Mon–Fri. Used to pick a polling cadence and to
   label the session in the UI. */
function indiaSession(now = new Date()) {
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
  const day = ist.getDay();
  const mins = ist.getHours() * 60 + ist.getMinutes();
  const open = 9 * 60 + 15, close = 15 * 60 + 30, pre = 9 * 60;
  if (day === 0 || day === 6) return { state: 'CLOSED', label: 'Weekend', ist };
  if (mins >= pre && mins < open) return { state: 'PRE', label: 'Pre-open', ist };
  if (mins >= open && mins <= close) return { state: 'OPEN', label: 'Market open', ist };
  if (mins > close && mins < close + 30) return { state: 'POST', label: 'Post-close', ist };
  return { state: 'CLOSED', label: 'Market closed', ist };
}

module.exports = { yahoo, coingecko, frankfurter, keyed, marketaux, rss, indiaSession, BASE, pool };
