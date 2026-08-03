/* =============================================================================
 * mock-upstream.js — stands in for Yahoo / CoinGecko / Frankfurter / RSS.
 *
 * Speaks the real wire formats (Yahoo chart JSON, CoinGecko simple/price,
 * Frankfurter latest, RSS 2.0 XML) so the server's parsing, symbol mapping,
 * failover and caching are exercised exactly as they will be against the real
 * internet. Used by live-pipeline.test.js and for offline development:
 *
 *   node tests/mock-upstream.js &            # listens on 8899
 *   IV_YAHOO_BASE=http://localhost:8899/yahoo \
 *   IV_COINGECKO_BASE=http://localhost:8899/cg \
 *   IV_FX_BASE=http://localhost:8899/fx \
 *   node server/server.js
 * ========================================================================== */

'use strict';

const http = require('http');

const PORT = +(process.env.MOCK_PORT || 8899);

/* Deterministic-but-moving prices so a poll actually shows change. */
const SEED = {
  '^NSEI': 24812.05, '^BSESN': 81455.40, '^NSEBANK': 52380.15,
  'NIFTY_FIN_SERVICE.NS': 23904.60, '^CNXMIDCAP': 57120.80, '^CNXIT': 39240.25,
  '^INDIAVIX': 13.42, '^GSPC': 5312.44, '^IXIC': 16781.22, '^DJI': 39864.10,
  '^FTSE': 8214.05, '^GDAXI': 18492.77, '^N225': 38104.60, '^HSI': 18320.15,
  'RELIANCE.NS': 2948.60, 'TCS.NS': 4162.30, 'HDFCBANK.NS': 1682.45,
  'ICICIBANK.NS': 1231.70, 'INFY.NS': 1854.20, 'USDINR=X': 83.612,
  'GC=F': 2381.40, 'CL=F': 78.14, '^TNX': 4.286
};
let drift = 0;
let mxRequests = 0;   // how many Marketaux calls the server actually spent
const FREE_TIER_LIMIT = 3;   // articles per request on Marketaux's free plan

function priceFor(ticker) {
  const base = SEED[ticker] || 1000 + (hash(ticker) % 4000);
  const wobble = Math.sin((Date.now() / 9000) + hash(ticker) % 7) * 0.004;
  return +(base * (1 + wobble + drift)).toFixed(4);
}
function hash(s) {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function yahooChart(ticker, range, interval) {
  const last = priceFor(ticker);
  const prev = +(last / 1.0042).toFixed(4);
  const n = range === '1d' ? 78 : 60;
  const step = range === '1d' ? 300 : 86400;
  const now = Math.floor(Date.now() / 1000);
  const ts = [], open = [], high = [], low = [], close = [], volume = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = now - i * step;
    const c = +(prev + (last - prev) * ((n - i) / n) + Math.sin(i / 3) * last * 0.001).toFixed(4);
    ts.push(t);
    open.push(+(c * 0.999).toFixed(4));
    high.push(+(c * 1.002).toFixed(4));
    low.push(+(c * 0.998).toFixed(4));
    close.push(c);
    volume.push(100000 + (i * 977) % 90000);
  }
  close[close.length - 1] = last;
  return {
    chart: {
      result: [{
        meta: {
          currency: ticker.endsWith('.NS') || ticker.startsWith('^NSE') || ticker.startsWith('^BSE') ? 'INR' : 'USD',
          symbol: ticker,
          exchangeName: ticker.endsWith('.NS') ? 'NSI' : 'IND',
          fullExchangeName: ticker.endsWith('.NS') ? 'NSE' : 'Index',
          regularMarketPrice: last,
          chartPreviousClose: prev,
          previousClose: prev,
          regularMarketDayHigh: +(last * 1.006).toFixed(4),
          regularMarketDayLow: +(last * 0.994).toFixed(4),
          regularMarketVolume: 2841233,
          fiftyTwoWeekHigh: +(last * 1.22).toFixed(4),
          fiftyTwoWeekLow: +(last * 0.71).toFixed(4),
          regularMarketTime: now,
          marketState: 'REGULAR'
        },
        timestamp: ts,
        indicators: { quote: [{ open, high, low, close, volume }] }
      }],
      error: null
    }
  };
}

const RSS_SAMPLE = (title, n) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>${title}</title>
${Array.from({ length: n }, (_, i) => `
  <item>
    <title><![CDATA[${title} headline ${i + 1}: Reliance and TCS lead Nifty higher as RBI holds rates]]></title>
    <link>https://example.test/${encodeURIComponent(title)}/${i + 1}</link>
    <pubDate>${new Date(Date.now() - i * 600000).toUTCString()}</pubDate>
    <description><![CDATA[Summary body for item ${i + 1} mentioning Infosys &amp; HDFC Bank with an &#8217;entity&#8217; to decode.]]></description>
    <media:content url="https://images.example.test/${encodeURIComponent(title)}-${i + 1}.jpg" medium="image" />
  </item>`).join('')}
</channel></rss>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const json = (o) => {
    const b = JSON.stringify(o);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) });
    res.end(b);
  };

  // --- Yahoo chart ---
  let m = p.match(/^\/yahoo\/v8\/finance\/chart\/(.+)$/);
  if (m) {
    const ticker = decodeURIComponent(m[1]);
    if (u.searchParams.get('fail') === '1') { res.writeHead(500); return res.end('upstream down'); }
    return json(yahooChart(ticker, u.searchParams.get('range'), u.searchParams.get('interval')));
  }

  // --- Yahoo crumb handshake ---
  if (p === '/yahoo/v1/test/getcrumb') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('mockCrumb123');
  }
  if (p === '/cookie') {
    res.writeHead(200, { 'Set-Cookie': 'A1=mock-cookie; Path=/', 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  // --- Yahoo quoteSummary (fundamentals) ---
  m = p.match(/^\/yahoo\/v10\/finance\/quoteSummary\/(.+)$/);
  if (m) {
    const ticker = decodeURIComponent(m[1]);
    if (u.searchParams.get('crumb') !== 'mockCrumb123') {
      res.writeHead(401); return res.end('Invalid Crumb');
    }
    const px = priceFor(ticker);
    const year = new Date().getFullYear();
    return json({
      quoteSummary: {
        result: [{
          defaultKeyStatistics: {
            trailingEps: { raw: +(px / 28).toFixed(2) }, priceToBook: { raw: 4.31 },
            enterpriseToEbitda: { raw: 14.2 }, beta: { raw: 1.06 },
            sharesOutstanding: { raw: 6765000000 }, floatShares: { raw: 3100000000 },
            shortPercentOfFloat: { raw: 0.0081 },
            priceToSalesTrailing12Months: { raw: 2.14 }
          },
          financialData: {
            returnOnEquity: { raw: 0.0914 }, returnOnAssets: { raw: 0.0432 },
            grossMargins: { raw: 0.3421 }, operatingMargins: { raw: 0.1187 },
            profitMargins: { raw: 0.0782 }, totalRevenue: { raw: 9740000000000 },
            revenueGrowth: { raw: 0.117 }, debtToEquity: { raw: 43.7 },
            currentRatio: { raw: 1.18 }, freeCashflow: { raw: 412000000000 },
            targetMeanPrice: { raw: +(px * 1.11).toFixed(2) },
            targetHighPrice: { raw: +(px * 1.28).toFixed(2) },
            targetLowPrice: { raw: +(px * 0.87).toFixed(2) },
            numberOfAnalystOpinions: { raw: 34 }, recommendationKey: 'buy'
          },
          summaryDetail: {
            trailingPE: { raw: 28.4 }, forwardPE: { raw: 24.1 },
            dividendYield: { raw: 0.0037 }, payoutRatio: { raw: 0.0912 }
          },
          recommendationTrend: { trend: [{ strongBuy: 12, buy: 14, hold: 6, sell: 1, strongSell: 1 }] },
          incomeStatementHistory: {
            incomeStatementHistory: [0, 1, 2, 3].map(i => ({
              endDate: { fmt: `${year - i}-03-31` },
              totalRevenue: { raw: 9740000000000 * Math.pow(0.9, i) },
              operatingIncome: { raw: 1150000000000 * Math.pow(0.9, i) },
              netIncome: { raw: 760000000000 * Math.pow(0.88, i) }
            }))
          },
          assetProfile: {
            sector: 'Energy', industry: 'Oil & Gas Refining',
            fullTimeEmployees: 389000, website: 'https://example.test',
            longBusinessSummary: 'Mock business summary used to verify the fundamentals pipeline.'
          }
        }],
        error: null
      }
    });
  }

  // --- CoinGecko ---
  if (p === '/cg/simple/price') {
    const ids = (u.searchParams.get('ids') || '').split(',');
    const out = {};
    ids.forEach(id => {
      out[id] = { inr: priceFor(id) * 100, inr_24h_change: 1.8, inr_24h_vol: 4.2e10 };
    });
    return json(out);
  }

  // --- Frankfurter ---
  if (p === '/fx/latest') {
    const to = (u.searchParams.get('to') || 'INR').split(',');
    const rates = {};
    to.forEach(t => { rates[t] = priceFor('USDINR=X'); });
    return json({ amount: 1, base: u.searchParams.get('from') || 'USD', date: '2026-08-02', rates });
  }
  if (/^\/fx\/\d{4}-\d{2}-\d{2}\.\.$/.test(p)) {
    const to = (u.searchParams.get('to') || 'INR').split(',');
    const rates = {};
    for (let i = 4; i >= 1; i--) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      rates[d] = {}; to.forEach(t => { rates[d][t] = priceFor('USDINR=X') * 0.999; });
    }
    return json({ base: 'USD', rates });
  }

  // --- Marketaux /news/all (documented response shape) ---
  if (p === '/marketaux/news/all') {
    if (!u.searchParams.get('api_token')) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: { code: 'auth_error', message: 'no token' } }));
    }
    const page = +(u.searchParams.get('page') || 1);
    // Free tier hard-caps at 3 articles per request no matter what `limit` asks for.
    const limit = Math.min(+(u.searchParams.get('limit') || 3) || 3, FREE_TIER_LIMIT);
    mxRequests++;
    const data = Array.from({ length: limit }, (_, i) => {
      const n = (page - 1) * limit + i + 1;
      return {
        uuid: `mock-uuid-${page}-${i}`,
        title: `Marketaux story ${n}: Infosys posts margin beat as deal pipeline holds`,
        description: `Marketaux summary ${n} covering Infosys and the wider IT pack.`,
        snippet: 'Snippet text.',
        url: `https://example.test/marketaux/${n}`,
        image_url: `https://images.example.test/story-${n}.jpg`,
        language: 'en',
        published_at: new Date(Date.now() - n * 900000).toISOString(),
        source: 'moneycontrol.com',
        relevance_score: null,
        // Shapes taken from a real free-tier response: indices come back as Yahoo
        // carets, and plenty of tagged tickers are BSE series we don't carry.
        entities: [
          { symbol: '^NSEI', name: 'NIFTY 50', exchange: 'NSE', country: 'in',
            type: 'index', industry: 'N/A', match_score: 31.4,
            sentiment_score: n % 3 === 0 ? -0.4021 : 0.6218, highlights: [] },
          { symbol: 'INFY.NS', name: 'Infosys Limited', exchange: 'NSE', country: 'in',
            type: 'equity', industry: 'Technology', match_score: 22.6,
            sentiment_score: n % 3 === 0 ? -0.2517 : 0.3106, highlights: [] },
          { symbol: 'AXISCBGPG.BO', name: 'Axis AAA Bond Plus SDL ETF', exchange: 'BSE',
            country: 'in', type: 'etf', industry: 'N/A', match_score: 9.1,
            sentiment_score: 0.3956, highlights: [] }
        ],
        similar: []
      };
    });
    return json({ meta: { found: 328417, returned: limit, limit, page }, data });
  }
  if (p === '/__mxcount') return json({ requests: mxRequests });

  // --- RSS feeds (any path under /rss) ---
  if (p.startsWith('/rss')) {
    const body = RSS_SAMPLE(u.searchParams.get('name') || 'Mock Feed', 6);
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    return res.end(body);
  }

  if (p === '/__drift') {                       // nudge prices, for tick tests
    drift += 0.01;
    return json({ ok: true, drift });
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'no mock route', path: p }));
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`mock upstream on http://localhost:${PORT}`));
}
module.exports = { server, PORT, yahooChart, RSS_SAMPLE };
