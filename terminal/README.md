# VERDICT — India-first financial news, markets data and terminal

A complete Bloomberg-style product for Indian markets — news site, markets data
hub, security pages and a keyboard-driven terminal — running on **real, live
data**: NSE/BSE quotes, real OHLC charts and real headlines from the Indian
financial press.

**It goes live with zero API keys.** `node server/server.js` and the site is
running on real market data. Keys are optional upgrades, not requirements.

Still no build step and no npm dependencies — the backend is one zero-dependency
Node file.

> Branding note: this is built under the neutral name **VERDICT** rather than
> reproducing Bloomberg's name and marks. The feature set, layout and
> interaction model are the clone; the brand is a single object in
> `js/config.js` (`brand.name`, `brand.mark`, `brand.tagline`, `brand.legal`).

---

## Design system

**Colour.** The reference brand spine is Black `#000000`, White `#FFFFFF` and
Sunshade amber `#FFA028`; everything else derives from it. Tokens live at the
top of `css/site.css`:

| token | light | role |
|---|---|---|
| `--amber` / `--amber-deep` | `#ffa028` / `#ff7a00` | kickers, rail numerals, hovers, accents |
| `--ink` / `--bg` | `#000000` / `#ffffff` | text and ground |
| `--rule` / `--rule-strong` | `#e0e0e0` / `#000000` | hairlines and section rules |
| `--up` / `--down` | `#00a15a` / `#ee1b22` | market direction |
| `--brand-blue` | `#0068ff` | section kickers, chart series |

Section kickers are restricted to amber / blue / red / black rather than a
per-section rainbow — see `sections[].accent` in `js/config.js`.

Terminal palette (`css/terminal.css`): black ground, amber `#ffa028` as primary
ink, deep blue `#002d72` panel headers and function-key bar, `#2fe36c` /
`#ff3b30` tape, cyan links.

**Type.** Two roles, driven by `--display` and `--ui`:

- **Display** (headlines, wordmark, page titles): a heavy, tightly-tracked
  grotesque — nothing on this site is serif. Stack:
  `BW Haas Grotesk Display → Neue Haas Grotesk Display Pro → Archivo → Helvetica Neue`
- **UI / body** (decks, bylines, labels, tables): a geometric sans. Stack:
  `AvenirNext for BBG → Avenir Next → Avenir → Nunito Sans`
- **Numbers** (every price, every table cell): `Roboto Mono`, tabular figures.

The first two entries in each stack are the reference product's own licensed
faces. They are **not shipped** — they are proprietary and cannot be
redistributed. Two consequences:

1. If you have them installed locally, you already get them.
2. To self-host them, drop the `.woff2` files into `fonts/` using the names in
   the commented `@font-face` block at the top of `css/site.css` and uncomment
   it. Nothing else changes.

Until then the site uses bundled, self-hosted, SIL OFL substitutes chosen for
closeness — **Archivo** (display), **Nunito Sans** (UI), **Roboto Mono**
(numbers) — so the rendering is identical on every machine instead of falling
back to Arial on Windows. Licenses are in `fonts/`.

**Motion.** Real animation, no library:

| behaviour | where |
|---|---|
| Masthead condenses (height + wordmark scale) past 24px of scroll | `.topbar.pinned`, `pinHeader()` |
| Continuous marquee ticker, pauses on hover, ▲▼ glyphs | `@keyframes tape-scroll`, `.t-chg.up::before` |
| Price flash: solid green/red → wash → clear, per updated cell | `@keyframes fl-up` / `fl-dn`, `UI.flash()` |
| Big quote number slides in on each tick instead of flashing | `@keyframes px-in` / `.px-roll` |
| Headline underline fades in on card hover; image scales 1.035 | `.card:hover` |
| Nav underline wipes in from the left | `.topnav a::after` |
| Mega menu fades and drops on hover intent | `.mega.open` |
| Staggered section reveal on load (45ms apart) | `.reveal`, `revealOnLoad()` |
| Live dot emits an expanding ring | `@keyframes ring` |
| Wire lines slide in as they arrive; skeleton shimmer for pending data | `@keyframes wire-in` / `shimmer` |
| Terminal: blinking block cursor, panel fade-in, per-cell tick flash | `@keyframes t-blink`, `t-panel-in`, `tfu` / `tfd` |
| Toasts slide in from the right; sheets scale up behind a fade | `@keyframes toast-in` / `sheet-in` |

Everything above collapses under `@media (prefers-reduced-motion: reduce)`, and
`UI.reduced()` gates the JS-driven pieces.

## Run it live

```bash
cd terminal
node server/server.js
```

Open <http://localhost:8080>. The masthead badge will read **LIVE** and the
prices are real. No keys, no npm install, no build.

Check what it is actually talking to:

```bash
curl -s localhost:8080/api/health | head -40
```

### Why a server is required for live data

Two reasons, both hard constraints:

1. **CORS.** A browser cannot fetch Yahoo Finance, NSE or an RSS feed directly —
   the request is blocked. The server makes those calls and hands the browser
   same-origin JSON.
2. **Keys.** Any paid provider key stays server-side and is never shipped to the
   client.

### Static, no-server mode

Serving the folder statically still works — every page renders, but on the
deterministic simulation instead of real data, and the masthead badge says
**SIMULATED** so it can never be mistaken for the real thing.

```bash
python3 -m http.server 8899 --directory terminal
```

## Pages

| Page | What it does |
|---|---|
| `index.html` | Home: market strip with live sparklines, lead story block, section modules, movers table with tabs, opinion, video, and a rail (live wire, most read, watchlist, yield curve, newsletter, podcasts) |
| `markets.html` | Data hub: world indexes by region, sector heat map with drill-in, yield curve, sortable quote board per asset class with filter, gainers/losers/most-active, economic and earnings calendars |
| `quote.html?s=RELIANCE` | Security page: live price header, chart (7 ranges × area/line/candle/OHLC, volume, crosshair), key statistics, 52-week range bar, fundamentals, analyst consensus, order book, tagged news, peers |
| `article.html?id=…` | Reader: metered paywall, reading-progress bar, live symbol chips, inline chart, save/copy/print/text-size, related stories |
| `section.html?s=markets` | Section front with tag filter, sorting, pagination, section-specific movers |
| `terminal.html` | The workspace — see below |
| `watchlist.html` | Portfolio monitor: live table, summary stats, equal-weight performance chart, tagged news, alerts, CSV export |
| `video.html` | Video hub with a working player shell, schedule, live badge, pop-out dock |
| `podcasts.html` | Episode list with a sticky player bar, speed control, scrubbing |
| `newsletters.html` | Newsletter catalogue, signup form, live issue preview |
| `subscribe.html` | Plans with monthly/annual toggle, checkout sheet, FAQ |
| `search.html?q=nifty` | Full-page search across securities and stories |

## The terminal

`terminal.html` is a full-screen, keyboard-first panel workspace.

- **Command line** accepts Bloomberg-style input: `RELIANCE IN EQUITY DES`,
  `INFY GP 1Y`, `TOP`, `IND`, `HELP`. Noise tokens (`US`, `EQUITY`, `CURNCY`,
  `<GO>` …) are ignored, so real muscle memory works.
- **Autocomplete** over functions and the security universe (`Tab` to accept),
  plus `↑`/`↓` command history persisted to `localStorage`.
- **Panels**: 1 / 3 / 4 / 6 layouts. Output lands in the focused panel and the
  focus advances, so consecutive commands fill the screen. `MAX` expands a panel,
  `CLR` empties it, number keys `1`–`6` focus a panel, `Esc` returns to the
  command line, `F1`–`F8` are bound to common functions.
- **Functions**: `DES` `GP` `GIP` `TOP` `WEI` `IND` `MOST` `FX` `CMD` `RATE`
  `HM` `DEPTH` `PORT` `ALRT` `ECO` `EARN` `FA` `MSG` `HELP`.
- Status bar with IST/London/Tokyo clocks, live NIFTY and IN10Y, feed mode and
  tick count.

## Where the data comes from

### Working now, no key needed

| Data | Provider | Covers |
|---|---|---|
| Quotes + OHLC | **Yahoo Finance** chart API | NIFTY, SENSEX, BANKNIFTY, FINNIFTY, India VIX, all 50 NIFTY constituents, global indices, FX, commodities |
| Fundamentals | **Yahoo** quoteSummary | P/E, forward P/E, EPS, P/B, P/S, EV/EBITDA, yield, payout, beta, ROE, ROA, margins, debt/equity, revenue history, analyst consensus and targets, company profile |
| Crypto in INR | **CoinGecko** | BTC, ETH, SOL, XRP, DOGE |
| FX | **Frankfurter** (ECB) | USDINR, EURINR, GBPINR, JPYINR |
| News | **22 RSS feeds** | Economic Times, Mint, Moneycontrol, Business Standard, BusinessLine, Financial Express, Google News India |
| Photos | the same RSS feeds | Publishers ship the article image in `media:content`, `media:thumbnail`, `enclosure` or the description HTML. Insecure and tracking-pixel URLs are dropped; anything unreachable falls back to generated art. |

Headlines are de-duplicated across sources, auto-tagged to the securities they
mention, and grouped into sections. Live stories link out to the publisher —
we have their headline and summary, not their body text, and passing off
someone else's reporting as ours would be wrong.

### Optional upgrades (add a key, restart)

Copy `server/config.example.json` to `server/config.json`:

| Key | What it adds | Free tier |
|---|---|---|
| `twelvedata` | **India G-Sec yields** (IN10Y/5Y/2Y) — no free feed carries these | 800 calls/day |
| `finnhub` | Backup quote provider, failover when Yahoo rate-limits | 60 calls/min |
| `marketaux` | Per-story sentiment, entity tagging, and photos for its own stories | 100 req/day |
| `newsapi` | Additional headline coverage | 100 req/day |
| `kiteApiKey` + `kiteAccessToken` | **True tick-by-tick realtime** from Zerodha — Yahoo is delayed ~1–15 min | paid, ₹2000/mo |

Keys can also come from the environment: `IV_TWELVEDATA`, `IV_FINNHUB`,
`IV_MARKETAUX`, `IV_NEWSAPI`.

### What the free tier cannot do

- **Yahoo quotes are delayed**, typically 1–15 minutes for NSE. Genuinely
  tick-by-tick requires a broker feed (Kite/Upstox/Angel One/Fyers).
- **India G-Sec yields** resolve only with a keyed provider. Without one the API
  reports them `missing` and the UI shows a dash — it does not invent a number.
- **Fundamentals** need Yahoo's cookie + crumb handshake, which the server does
  automatically and re-uses for an hour. If Yahoo refuses it, the API returns
  `available: false` and the page renders dashes with the reason — it does not
  fall back to invented ratios.

### API surface

| Route | Returns |
|---|---|
| `GET /api/health` | provider status, IST session, sample quote |
| `GET /api/quotes?symbols=NIFTY,RELIANCE` | live quotes |
| `GET /api/history?symbol=NIFTY&range=1D` | OHLCV bars |
| `GET /api/fundamentals?symbol=RELIANCE` | ratios, margins, consensus, profile |
| `GET /api/news?section=&symbol=&q=&limit=` | headlines |
| `GET /api/wire` | newest headlines, wire format |
| `GET /api/search?q=` | securities + stories |
| `GET /api/stream` | Server-Sent Events, live ticks |

Polling adapts to the session: 5s while NSE is open (09:15–15:30 IST), 60s when
closed. Responses are cached, and a failed upstream serves the last good value
rather than blanking the page.

## Deploy it

Any host that runs Node. No build step, no dependencies.

```bash
# Render / Railway / Fly.io
#   build command:  (none)
#   start command:  node server/server.js
#   the platform's PORT env var is picked up automatically

# A VPS
git clone <your repo> && cd terminal
node server/server.js            # or: pm2 start server/server.js --name verdict
```

Behind nginx, disable buffering on `/api/stream` or SSE will stall:

```nginx
location /api/stream {
  proxy_pass http://127.0.0.1:8080;
  proxy_buffering off;
  proxy_read_timeout 3600s;
}
```

Note that a static-only host (GitHub Pages, Netlify without functions) can serve
the site but **not** the live data — there is no server to make the upstream
calls.

## Files

```
terminal/
├── index.html … search.html      12 pages, each with its own inline page script
├── css/site.css                  tokens, type, animations, light/dark, responsive
├── css/terminal.css              the amber-on-black workspace
├── fonts/                        self-hosted OFL webfonts + licenses
├── server/server.js              live backend: JSON API, SSE stream, static serving
├── server/lib/providers.js       Yahoo, CoinGecko, Frankfurter, RSS, keyed vendors
├── server/lib/symbols.js         India universe + per-vendor ticker mapping
├── server/lib/fetcher.js         timeouts, retry, TTL cache, stale-on-error, health
├── js/live.js                    boot probe, SSE client, polling, live/sim switching
├── js/config.js                  brand, feature flags, API base, sections
├── js/data.js                    India universe (84 symbols) + offline fallback corpus
├── js/market.js                  quote store, live ingestion, simulator fallback
├── js/api.js                     the seam every page calls
├── js/charts.js                  canvas engine: price charts, sparklines, bars, curves, treemap
├── js/components.js              header, tape, search, modals, paywall, watchlist, alerts, tables
├── tests/ui-smoke.js             headless page + interaction suite
├── tests/live-pipeline.test.js   backend: vendor payloads → API responses
├── tests/live-browser.test.js    browser consumes live data; degrades safely
└── tests/mock-upstream.js        stands in for the vendors, offline
```

## Tests — 169 checks

```bash
node tests/live-pipeline.test.js     # 51 — backend against a mock vendor
node tests/live-browser.test.js      # 30 — browser against the live backend
python3 -m http.server 8899 --directory . &
node tests/ui-smoke.js               # 88 — every page, 3 widths, 2 themes
```

`live-pipeline` boots `tests/mock-upstream.js`, which speaks the real wire
formats (Yahoo chart JSON and quoteSummary behind a crumb handshake, CoinGecko,
Frankfurter, RSS 2.0), points the real server at it, and asserts that vendor
payloads become correct quotes, bars, fundamentals and tagged headlines —
including that a dead upstream degrades instead of breaking.

`live-browser` drives Chromium against the running backend and asserts the page
shows server-supplied prices (not simulated ones), that SSE moves the tape
without a reload, that live stories link out — then kills the backend and
asserts the page falls back and relabels itself SIMULATED.

## Notable implementation details

- **No dependencies and no external requests.** Charts, layout, routing, state
  and fonts are all local; the pages work offline and over `file://`.
- **Images** are procedurally generated SVG data URIs seeded per article id, so
  there are no image requests and thumbnails stay stable between loads.
- **Theming** is CSS custom properties end to end — the canvas engine reads the
  same variables, so charts recolour with the light/dark toggle.
- **State** (watchlist, alerts, theme, paywall meter, saved articles, command
  history, subscriber flag) lives in `localStorage` under the `iv.` prefix.
- **Accessibility/robustness**: keyboard shortcuts (`/` and `⌘K` search, `t`
  terminal, `Esc` close), tabular numerals everywhere, print stylesheet, and a
  hard rule that wide content scrolls inside its own container.

## Honesty rules baked into the product

- The masthead badge always states the truth: **LIVE** (with the session state
  and, on hover, the provider list and last update) or **SIMULATED**.
- The simulator is switched off entirely in live mode, so a made-up number can
  never mix into a real table.
- A symbol with no real provider reports as unavailable and renders a dash, and
  fundamentals the upstream will not serve show the reason instead of a number.
- Live headlines carry their publication name and link to the original.

## Disclaimer

Market data is delayed and provided by third parties; it is not suitable for
trading decisions. Payments and auth are stubbed. Nothing here is investment
advice.
