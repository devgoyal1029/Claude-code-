# VERDICT — a Bloomberg-style financial news & terminal prototype

A complete, working clone of the Bloomberg product surface: the news site, the
markets data hub, the security pages, and the keyboard-driven terminal
workspace — built as static files with **no build step, no dependencies and no
network calls**.

Every price, headline, byline and image is placeholder content generated
locally. Every API key is a `PLACEHOLDER_*` string in one config file. Drop in
real keys and flip one flag to point the whole thing at a live feed.

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

## Run it

Any static server works — there is no compile step.

```bash
python3 -m http.server 8899 --directory terminal
# or
npx http-server terminal -p 8899
```

Then open <http://localhost:8899/index.html>. Opening the files directly over
`file://` also works in most browsers.

## Pages

| Page | What it does |
|---|---|
| `index.html` | Home: market strip with live sparklines, lead story block, section modules, movers table with tabs, opinion, video, and a rail (live wire, most read, watchlist, yield curve, newsletter, podcasts) |
| `markets.html` | Data hub: world indexes by region, sector heat map with drill-in, yield curve, sortable quote board per asset class with filter, gainers/losers/most-active, economic and earnings calendars |
| `quote.html?s=NVDA` | Security page: live price header, chart (7 ranges × area/line/candle/OHLC, volume, crosshair), key statistics, 52-week range bar, fundamentals, analyst consensus, order book, tagged news, peers |
| `article.html?id=a02` | Reader: metered paywall, reading-progress bar, live symbol chips, inline chart, save/copy/print/text-size, related stories |
| `section.html?s=markets` | Section front with tag filter, sorting, pagination, section-specific movers |
| `terminal.html` | The workspace — see below |
| `watchlist.html` | Portfolio monitor: live table, summary stats, equal-weight performance chart, tagged news, alerts, CSV export |
| `video.html` | Video hub with a working player shell, schedule, live badge, pop-out dock |
| `podcasts.html` | Episode list with a sticky player bar, speed control, scrubbing |
| `newsletters.html` | Newsletter catalogue, signup form, live issue preview |
| `subscribe.html` | Plans with monthly/annual toggle, checkout sheet, FAQ |
| `search.html?q=oil` | Full-page search across securities and stories |

## The terminal

`terminal.html` is a full-screen, keyboard-first panel workspace.

- **Command line** accepts Bloomberg-style input: `NVDA US EQUITY DES`,
  `AAPL GP 1Y`, `TOP`, `WEI`, `HELP`. Noise tokens (`US`, `EQUITY`, `CURNCY`,
  `<GO>` …) are ignored, so real muscle memory works.
- **Autocomplete** over functions and the security universe (`Tab` to accept),
  plus `↑`/`↓` command history persisted to `localStorage`.
- **Panels**: 1 / 3 / 4 / 6 layouts. Output lands in the focused panel and the
  focus advances, so consecutive commands fill the screen. `MAX` expands a panel,
  `CLR` empties it, number keys `1`–`6` focus a panel, `Esc` returns to the
  command line, `F1`–`F8` are bound to common functions.
- **Functions**: `DES` `GP` `GIP` `TOP` `WEI` `MOST` `FX` `CMD` `RATE` `HM`
  `DEPTH` `PORT` `ALRT` `ECO` `EARN` `FA` `MSG` `HELP`.
- Status bar with NY/London/Tokyo clocks, live SPX and 10-year, feed mode and
  tick count.

## Wiring up real data

Everything is behind two files.

**1. `js/config.js`** — replace the placeholders:

```js
keys: { marketData: 'PLACEHOLDER_MARKET_DATA_KEY', news: '…', streaming: '…' },
endpoints: { quotes: 'https://…', ohlc: 'https://…', stream: 'wss://…' },
features: { liveData: true }        // ← the switch
```

**2. `js/api.js`** — adapt the three `normalise.*` functions to your vendor's
payload shape. Nothing else in the codebase calls `fetch`; every page talks to
`API.quotes / history / fundamentals / news / search / calendar /
connectStream`, and each of those already has both a simulated and a live path.

With `liveData: false` (the default), `js/market.js` runs a deterministic
simulation: seeded open/high/low/prev-close per symbol, a correlated random walk
on a timer, intraday series anchored to the session open, synthetic depth,
fundamentals and consensus. Seeded means every reload shows the same session, so
screenshots and demos are reproducible.

## Files

```
terminal/
├── index.html … search.html      12 pages, each with its own inline page script
├── css/site.css                  tokens, type, animations, light/dark, responsive
├── css/terminal.css              the amber-on-black workspace
├── fonts/                        self-hosted OFL webfonts + licenses
├── js/config.js                  brand, feature flags, API keys, endpoints, functions
├── js/data.js                    universe (60 securities), 36 stories, wire, media, calendars
├── js/market.js                  tick engine, history, depth, fundamentals, movers, search
├── js/api.js                     simulated ⇄ live seam; vendor payload normalisation
├── js/charts.js                  canvas engine: price charts, sparklines, bars, curves, treemap
├── js/components.js              header, tape, search, modals, paywall, watchlist, alerts, tables
└── tests/ui-smoke.js             headless page + interaction suite
```

## Tests

```bash
python3 -m http.server 8899 --directory terminal &
node terminal/tests/ui-smoke.js
```

Loads all 12 pages at desktop and mobile widths in both colour schemes,
asserting no console/page errors, no horizontal overflow and non-empty render;
then drives the terminal command line, watchlist persistence, the paywall meter,
search, chart controls, theme persistence and the heat map drill-in.

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

## Disclaimer

Simulated data, fictional companies-in-name-only coverage, and stubbed
payments/auth. Nothing here is real market data, and nothing here is investment
advice.
