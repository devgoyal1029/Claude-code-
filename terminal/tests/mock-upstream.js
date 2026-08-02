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
<rss version="2.0"><channel><title>${title}</title>
${Array.from({ length: n }, (_, i) => `
  <item>
    <title><![CDATA[${title} headline ${i + 1}: Reliance and TCS lead Nifty higher as RBI holds rates]]></title>
    <link>https://example.test/${encodeURIComponent(title)}/${i + 1}</link>
    <pubDate>${new Date(Date.now() - i * 600000).toUTCString()}</pubDate>
    <description><![CDATA[Summary body for item ${i + 1} mentioning Infosys &amp; HDFC Bank with an &#8217;entity&#8217; to decode.]]></description>
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
