# VERDICT — Poora Project Guide (A se Z)

> Ek hi jagah, poori kahani: humne **kya** banaya, **kaise** banaya, **kyun**
> banaya, kaunse **features** hmain, kaunsi **galtiyaan** hui aur unse kya
> seekha, aur **aage kya** karna hai.
>
> Ye document jaan-boojh kar detail mein hai. Agar jaldi mein ho to har section
> ke pehle **"Ek line mein"** padh lo.

---

## 0. Ek line mein ye kya hai

**VERDICT** ek India-first Bloomberg-jaisi financial website hai — news site +
markets data hub + har stock ka apna page + ek keyboard-driven "terminal" —
jo **asli, live market data** par chalti hai (NSE/BSE quotes, asli charts, asli
Indian financial press ki khabrein). Bina kisi paid API key ke live ho jaati
hai; keys sirf optional upgrade hain.

- **Frontend:** plain HTML + CSS + JavaScript. Koi framework nahi, koi build
  step nahi.
- **Backend:** ek zero-dependency Node.js file. Koi `npm install` nahi.
- **Tests:** 185 automated checks (4 suites).
- **Code:** ~4,600 lines core + tests.
- **Universe:** 84 India-focused symbols (indices, stocks, FX, commodities, crypto).

---

## 1. Kyun banaya — origin story

Shuruaat ek simple maang se hui: *"Bloomberg jaisi hu-ba-hu site banao, har
feature same, taaki main teri capability check kar sakoon."* Placeholder data
se shuru, keys baad mein.

Uske baad maang badalti gayi (yahi natural hai, aur yahi is project ka asli
shape bana):

1. **"Bloomberg jaisa dikhna chahiye"** — asli colors, fonts, animations, koi
   farak nahi.
2. **"India ke hisaab se karo"** — tumne khud `index.html` badal ke NIFTY,
   SENSEX, BANKNIFTY, RELIANCE, TCS waghera daale.
3. **"Ab isse LIVE karo"** — placeholder nahi, sach ka data, sach ki news,
   real-time.
4. **"Server par chala ke dikhao / zip do / live host karo"** — dekhne aur
   deploy karne ki maang.

Har step par ek core principle chala: **jhooth nahi bolna.** Agar data live hai
to LIVE dikhao; agar nahi hai to saaf-saaf SIMULATED likho. Kabhi banaya hua
number asli table mein mat milao. (Iski wajah aage "Honesty rules" mein hai.)

---

## 2. Poori kahani — A se Z (commit dar commit)

Har commit ek chapter hai. Ye asli git history hai, isliye ye exactly wahi
order hai jisme cheezein bani.

### Chapter 0 — `85b8e20` (19 July) — Neenv
**"Fix 17 bugs in the financial-planning algorithm + add full test suite."**
Ye is repo ka purana kaam tha (financial-planning engine). VERDICT isi repo ke
`terminal/` folder ke andar aaya, uske upar.

### Chapter 1 — `3e7a9b8` (25 July) — Prototype khada hua
**"Add VERDICT: a Bloomberg-style news, markets and terminal prototype."**
- 12 pages, ek terminal, canvas charts, sab kuch **simulated data** par.
- Tab tak koi backend nahi tha — sirf ek deterministic simulator jo asli lagta
  hai par asli nahi hai (aur badge SIMULATED bolta tha).
- Maqsad: pehle poora product khada karo, phir usme asli data bharo.

### Chapter 2 — `e08dcc6` (25 July) — Look exactly Bloomberg jaisa
**"Rework the visual layer to match the reference design system."**
- Colors: Black `#000000`, White `#FFFFFF`, Sunshade amber `#FFA028`.
- Fonts: heavy grotesque (headlines) + geometric sans (body) + mono (numbers).
- Asli animations: masthead scroll par sikudta hai, ticker chalta hai, price
  cell flash karta hai, etc. Sab CSS/JS se, koi library nahi.
- **Yahaan ek imaandari:** Bloomberg ke asli fonts proprietary hain, ship nahi
  kar sakte. To humne SIL OFL (free, legal) substitutes use kiye — **Archivo**,
  **Nunito Sans**, **Roboto Mono** — jo dekhne mein bahut close hain. Agar
  tumhare paas asli fonts install hain to wahi dikhenge.

### Chapter 3 — `ee1a829` (2 Aug) — **LIVE ho gaya** (sabse bada step)
**"Go live: India universe, real market data and real news via a Node backend."**
Yahi project ka dil hai. Isme bana:
- **Node backend** (`server/server.js`) — static files bhi serve karta hai, JSON
  API bhi deta hai, aur live ticks ke liye SSE stream bhi.
- **Providers** (`server/lib/providers.js`) — Yahoo Finance (quotes + charts),
  CoinGecko (crypto INR), Frankfurter (FX), aur **22 Indian RSS feeds** (news).
- **Symbols** (`server/lib/symbols.js`) — 84-symbol India universe, har vendor ke
  liye alag ticker mapping.
- **Live/Sim switch** (`js/live.js`) — page boot hote hi backend se poochta hai
  "live data hai?" Haan → asli data; Nahi → simulator + SIMULATED badge.

**Yahaan sabse important technical baat samajhna:** *browser seedha Yahoo ya
RSS ko call nahi kar sakta* — CORS block kar deta hai. Isiliye ek server
chahiye jo un calls ko banaye aur browser ko same-origin JSON de. Ye maang nahi,
**majboori** hai. (Yahi wajah hai ki shared hosting akele kaafi nahi.)

### Chapter 4 — `4b08b17` (2 Aug) — Asli fundamentals
**"Serve real fundamentals, replacing the last block of simulated numbers."**
- Yahoo ke `quoteSummary` se asli P/E, EPS, ROE, margins, analyst targets,
  company profile.
- Ye endpoint ek **cookie + crumb handshake** ke peeche hai (Yahoo ki security).
  Server ye handshake khud kar leta hai aur ek ghante tak reuse karta hai.
- Agar Yahoo mana kar de → API `available: false` bhejta hai aur page **dash**
  dikhata hai reason ke saath. Banaya hua ratio kabhi nahi dikhata.

### Chapter 5 — `588f6b9` (2 Aug) — Single-file bundle + placeholder leak fix
**"Add a single-file bundle, and stop stubbed calls hitting placeholder URLs."**
- `dist/verdict-demo.html` — poori site ek hi file mein, double-click karke
  khul jaati hai (offline demo ke liye).
- **Ek bug pakda:** `features.liveData: 'auto'` ek truthy string hai, to kuch
  purana code use "on" samajh ke placeholder `api.example.com` par call maar
  raha tha. Theek kiya — ab `IV.mode` padha jaata hai jo asli live/sim state hai.

### Chapter 6 — `0048c03` (2 Aug) — Tooling housekeeping
Session ke tool permissions local settings mein record kiye. (Chhota, non-feature.)

### Chapter 7 — `58d4359` (2 Aug) — Asli photos + budget-aware Marketaux
**"Real photos on every story, and a budget-aware Marketaux integration."**
- **Photos:** RSS feeds khud article ki image bhejte hain (`media:content`,
  `media:thumbnail`, `enclosure`, ya description ke HTML mein). Wahi nikaal ke
  har khabar par asli photo lagayi. Insecure (`http://`) aur tracking-pixel URLs
  reject; jo image load na ho use generated art se replace.
- **Marketaux** (per-story sentiment + entity tagging) ko budget-aware banaya:
  ek din ki request limit hoti hai, to counter rakha jo IST midnight par reset
  hota hai — taaki quota kabhi na phate.

### Chapter 8 — `1c97b6c` (3 Aug) — Marketaux entity mapping + free-tier sizing
**"Map Marketaux entities correctly and size the integration to the free tier."**
- **Tumhare Colab test ne ek asli bug pakda.** Marketaux entities Yahoo-style
  tickers mein aate hain: Nifty `^NSEI` ban ke aata hai, aur bahut se BSE bond/
  ETF series (`AXISCBGPG.BO`) aate hain jinhe site price nahi kar sakti.
  - Purana code sirf `.NS/.BO` strip karta tha → `^NSEI` NIFTY se match hi nahi
    hota tha, aur `AXISCBGPG` raw dikh jaata tha.
  - `mapEntity()` ab carets ko symbol table se resolve karta hai (`^NSEI`→NIFTY)
    aur jo universe mein nahi hai use **drop** kar deta hai.
- **Free tier reality:** Marketaux free plan **per request** meter karta hai aur
  chahe `limit` kuch bhi bhejo, **3 articles per request** deta hai. Config
  isko honest banaya: hourly refresh × 3 requests = 72 req/din (100 ki limit ke
  andar), ~216 stories/din.

### Chapter 9 — `4b70915` (3 Aug) — Shared-hosting deploy path
**"Add a shared-hosting deploy path: static bundle + remote backend."**
- **Problem:** Hostinger Shared/Premium/Business par Node **chal nahi sakta**,
  par live data ke liye Node backend chahiye.
- **Solution:** site ko do hisson mein baanta —
  1. `tools/build-static.js` → `dist/static/` banata hai jisme API ka pata
     already remote backend par set hota hai, plus ek `.htaccess`. `server/`
     folder ship **nahi** hota (warna keys wali `config.json` public ho jaati).
  2. `render.yaml` → backend ko Render ke free tier par deploy karta hai; keys
     Render ke dashboard mein, repo mein nahi.
  3. `deploy/README.md` → poora step-by-step guide.
- Ek naya test suite (`split-deploy.test.js`, 13 checks) ne saabit kiya ki jab
  pages aur backend alag origins par hon tab bhi cross-origin fetch + live
  ticker (SSE) sahi chalte hain, koi CORS/mixed-content error nahi.

---

## 3. Kya-kya banaya — saare pages

| Page | Kya karta hai |
|---|---|
| `index.html` | Home: live sparklines wali market strip, lead story, section modules, movers table (tabs ke saath), opinion, video, aur ek rail (live wire, most read, watchlist, yield curve, newsletter, podcasts) |
| `markets.html` | Data hub: duniya ke indices region-wise, sector heat map (drill-in), yield curve, har asset class ka sortable quote board, gainers/losers/most-active, economic + earnings calendar |
| `quote.html?s=RELIANCE` | Stock page: live price header, chart (7 ranges × area/line/candle/OHLC, volume, crosshair), key stats, 52-week range bar, fundamentals, analyst consensus, order book, tagged news, peers |
| `article.html?id=…` | Reader: metered paywall, reading-progress bar, live symbol chips, inline chart, save/copy/print/text-size, related stories |
| `section.html?s=markets` | Section front: tag filter, sorting, pagination, section-specific movers |
| `terminal.html` | Keyboard workspace — neeche detail |
| `watchlist.html` | Portfolio monitor: live table, summary stats, performance chart, tagged news, alerts, CSV export |
| `video.html` | Video hub: player shell, schedule, live badge, pop-out dock |
| `podcasts.html` | Episode list, sticky player bar, speed control, scrubbing |
| `newsletters.html` | Newsletter catalogue, signup form, live issue preview |
| `subscribe.html` | Plans (monthly/annual toggle), checkout sheet, FAQ |
| `search.html?q=nifty` | Securities + stories ke across full-page search |

---

## 4. Terminal (`terminal.html`) — detail

Ye full-screen, keyboard-first panel workspace hai — Bloomberg terminal ki tarah.

- **Command line** Bloomberg-style input leti hai: `RELIANCE IN EQUITY DES`,
  `INFY GP 1Y`, `TOP`, `IND`, `HELP`. Noise tokens (`US`, `EQUITY`, `CURNCY`,
  `<GO>`) ignore ho jaate hain, to asli muscle memory kaam karti hai.
- **Autocomplete** functions aur security universe par (`Tab` accept), plus
  `↑`/`↓` command history (localStorage mein saved).
- **Panels:** 1 / 3 / 4 / 6 layout. Output focused panel mein aata hai aur focus
  aage badh jaata hai, to lagataar commands screen bhar dete hain. `MAX` panel
  bada karta hai, `CLR` khaali, `1`–`6` panel focus, `Esc` command line par
  wapas, `F1`–`F8` common functions par bound.
- **Functions:** `DES GP GIP TOP WEI IND MOST FX CMD RATE HM DEPTH PORT ALRT ECO
  EARN FA MSG HELP`.
- **Status bar:** IST/London/Tokyo clocks, live NIFTY aur IN10Y, feed mode, tick
  count.

---

## 5. Data kahan se aata hai

### Abhi chal raha hai — koi key nahi chahiye

| Data | Provider | Kya cover karta hai |
|---|---|---|
| Quotes + OHLC | **Yahoo Finance** chart API | NIFTY, SENSEX, BANKNIFTY, FINNIFTY, India VIX, saare 50 NIFTY stocks, global indices, FX, commodities |
| Fundamentals | **Yahoo** quoteSummary | P/E, forward P/E, EPS, P/B, P/S, EV/EBITDA, yield, payout, beta, ROE, ROA, margins, debt/equity, revenue history, analyst consensus + targets, company profile |
| Crypto (INR) | **CoinGecko** | BTC, ETH, SOL, XRP, DOGE |
| FX | **Frankfurter** (ECB) | USDINR, EURINR, GBPINR, JPYINR |
| News | **22 RSS feeds** | Economic Times, Mint, Moneycontrol, Business Standard, BusinessLine, Financial Express, Google News India |
| Photos | wahi RSS feeds | Publisher article image bhejte hain; insecure/tracking URLs drop, unreachable → generated art |

Headlines de-duplicate hoti hain, jis securities ka zikr karti hain unse
auto-tag hoti hain, aur sections mein group hoti hain. Live stories **publisher
ke link par** jaati hain — humare paas unki headline + summary hai, poora body
nahi, aur doosre ki reporting ko apna dikhana galat hoga.

### Optional upgrades (key daalo, restart karo)

`server/config.example.json` ko `server/config.json` mein copy karo:

| Key | Kya add karta hai | Free tier |
|---|---|---|
| `twelvedata` | **India G-Sec yields** (IN10Y/5Y/2Y) — koi free feed inhe nahi deta | 800 calls/day |
| `finnhub` | Backup quote provider, jab Yahoo rate-limit kare | 60 calls/min |
| `marketaux` | Per-story sentiment, entity tagging, apni stories ke photos | 100 req/day |
| `newsapi` | Extra headline coverage | 100 req/day |
| `kiteApiKey` + `kiteAccessToken` | **Sach ka tick-by-tick realtime** (Zerodha) — Yahoo ~1–15 min delayed hai | paid, ~₹2000/mo |

Keys environment se bhi aa sakti hain: `IV_TWELVEDATA`, `IV_FINNHUB`,
`IV_MARKETAUX`, `IV_NEWSAPI`.

### Free tier kya NAHI kar sakta (imaandari)

- **Yahoo quotes delayed hain** — NSE ke liye ~1–15 min. Sach ka tick-by-tick
  ke liye broker feed chahiye (Kite/Upstox/Angel One/Fyers).
- **India G-Sec yields** sirf keyed provider se aate hain. Bina uske API `missing`
  bhejta hai aur UI dash dikhata hai — number invent **nahi** karta.
- **Fundamentals** ko Yahoo ke cookie+crumb handshake ki zaroorat hai. Yahoo mana
  kare to `available: false`, page dash dikhata hai reason ke saath.

---

## 6. Architecture — andar kaise kaam karta hai

```
Browser (koi bhi page)
   │  boot par: GET /api/health  → "live data hai?"
   │  haan → asli data lo, simulator band karo, SSE stream kholo (live ticks)
   │  nahi → deterministic simulator chalu rakho, badge = SIMULATED
   ▼
Node backend  (server/server.js)  ── static files bhi yahi serve karta hai
   │  routes: /api/health, /quotes, /history, /fundamentals, /news, /wire,
   │          /search, /stream (SSE)
   ▼
Providers  (server/lib/providers.js)
   │  Yahoo (quotes/charts/fundamentals) · CoinGecko (crypto) · Frankfurter (FX)
   │  · 22 RSS feeds (news+photos) · keyed: Twelvedata/Finnhub/Marketaux/NewsAPI
   ▼
Fetcher  (server/lib/fetcher.js)
      timeout · retry · TTL cache · "stale-on-error" (upstream mar jaaye to
      aakhri accha value do, page blank mat karo)
```

**Do baatein baar-baar samajhna:**

1. **CORS ki wajah se backend zaroori hai.** Browser Yahoo/RSS ko seedha nahi
   bula sakta. Server bulaata hai, browser ko same-origin JSON deta hai.
2. **Live/Sim switch imaandari ke liye hai.** Live mode mein simulator poori
   tarah band ho jaata hai, to koi banaya hua number asli table mein mix nahi ho
   sakta.

**Polling session ke hisaab se:** NSE khula (09:15–15:30 IST) → har 5s; band →
har 60s. Responses cached; failed upstream aakhri accha value serve karta hai.

---

## 7. Design system (chhoti si yaad-dahani)

- **Colour:** Black / White / Sunshade amber `#FFA028`. Tokens `css/site.css` ke
  top par. Terminal alag: kaala background, amber ink, deep blue headers, green/
  red tape.
- **Type:** Display = heavy grotesque (Archivo), UI = geometric sans (Nunito
  Sans), Numbers = Roboto Mono (tabular). Asli Bloomberg fonts proprietary hain,
  ship nahi hote — installed hon to wahi dikhenge.
- **Motion:** masthead condense, marquee ticker, price flash, quote roll,
  hover underline, staggered reveal, terminal cursor blink — sab bina library.
  `prefers-reduced-motion` par sab band ho jaata hai.

---

## 8. Har file kya karti hai

```
terminal/
├── index.html … search.html      12 pages, har ek ka apna inline page script
├── css/site.css                  tokens, type, animations, light/dark, responsive
├── css/terminal.css              amber-on-black workspace
├── fonts/                        self-hosted OFL webfonts + licenses
├── server/server.js              live backend: JSON API, SSE stream, static serving
├── server/lib/providers.js       Yahoo, CoinGecko, Frankfurter, RSS, keyed vendors
├── server/lib/symbols.js         India universe (84) + per-vendor ticker mapping
├── server/lib/fetcher.js         timeout, retry, TTL cache, stale-on-error
├── js/live.js                    boot probe, SSE client, polling, live/sim switch
├── js/config.js                  brand, feature flags, API base, sections
├── js/data.js                    India universe + offline fallback corpus
├── js/market.js                  quote store, live ingestion, simulator fallback
├── js/api.js                     har page jo seam call karta hai
├── js/charts.js                  canvas engine: charts, sparklines, bars, curves, treemap
├── js/components.js              header, tape, search, modals, paywall, watchlist, tables
├── tools/build-static.js         shared-hosting bundle banata hai (Chapter 9)
├── tools/build-single-file.js    sab kuch ek HTML file mein (offline demo)
├── deploy/README.md              shared-hosting deploy guide
├── tests/live-pipeline.test.js   backend: vendor payloads → API responses (54)
├── tests/live-browser.test.js    browser live data consume karta hai; safely degrade (30)
├── tests/ui-smoke.js             har page, 3 widths, 2 themes (88)
├── tests/split-deploy.test.js    alag-origin deploy sahi chalta hai (13)
└── tests/mock-upstream.js        vendors ki jagah, offline testing ke liye

(repo root)
└── render.yaml                   backend ka free deploy (Render)
```

---

## 9. Tests — 185 checks

```bash
cd terminal
node tests/live-pipeline.test.js     # 54 — backend against a mock vendor
node tests/live-browser.test.js      # 30 — browser against the live backend
node tests/split-deploy.test.js      # 13 — pages + backend on different origins
python3 -m http.server 8899 --directory . &
node tests/ui-smoke.js               # 88 — every page, 3 widths, 2 themes
```

**Ye sab offline chalte hain.** `mock-upstream.js` asli vendor wire-formats
bolta hai (Yahoo chart JSON, quoteSummary crumb handshake, CoinGecko,
Frankfurter, RSS, Marketaux) — is sandbox ki network policy har market/news host
ko block karti hai, isiliye humne asli internet ke bajaye ek mock ke against
saabit kiya ki pipeline sahi hai. (Ye policy hai; usse bypass nahi karna.)

---

## 10. Deploy kaise karein

### Option A — koi bhi Node host (sabse simple, sab live)
Render / Railway / Fly / VPS. Build command: koi nahi. Start: `node server/server.js`.
Platform ka `PORT` env var khud utha leta hai.

### Option B — shared hosting (Hostinger Premium/Business) — SPLIT
Kyunki shared hosting Node nahi chalati:
1. **Backend** Render par: repo → "New → Blueprint" → `render.yaml` khud padhega.
   `IV_MARKETAUX` key Render dashboard mein daalo. URL milega (e.g.
   `https://verdict-api.onrender.com`).
2. **Pages** banao aur upload karo:
   ```bash
   cd terminal
   node tools/build-static.js https://verdict-api.onrender.com
   ```
   `dist/static/` ka **poora content** Hostinger `public_html/` mein upload karo
   (File Manager mein "show hidden files" on karo taaki `.htaccess` bhi jaaye).

> **Render free tier note:** 15 min traffic na ho to backend so jaata hai; agla
> visitor ~50 sec wait karta hai (tab tak page SIMULATED dikhata hai, phir khud
> live). Demo se 1 min pehle health URL khol lo. $7/mo plan se sleep hat jaata hai.

Nginx ke peeche ho to `/api/stream` par `proxy_buffering off;` zaroori hai
warna live ticker ruk jaata hai.

---

## 11. ⚠️ Jo GALTIYAAN hui — aur unse kya seekha

> Ye section sabse important hai. Har entry: **kya galat hua → kyun → ab kya
> rule hai.** Inhe dubara mat dohrana.

### 11.1 API key chat mein paste kar di (SECURITY — sabse bada)
- **Kya hua:** Marketaux key `pazReAz…` seedhe chat mein bhej di gayi.
- **Kyun galat:** chat mein jo aaya wo **permanently** reh jaata hai. Key ab
  "public" maani jaayegi.
- **Ab rule:**
  1. Us key ko Marketaux dashboard mein **regenerate** karo (purani turant band).
  2. Nayi key **sirf** `server/config.json` ya host ke env var (`IV_MARKETAUX`)
     mein rakho. Kabhi chat/email/commit mein nahi.
  3. Keys hamesha **server-side** rehti hain, client (browser) ko kabhi nahi
     bheji jaati.

### 11.2 "5 accounts banake rate limit todo" — ToS violation
- **Kya hua:** idea aaya ki 5 Marketaux accounts banake keys rotate karein taaki
  free limit se zyada calls ho.
- **Kyun galat:** ye Marketaux ki Terms of Service todta hai — pakde jaane par
  **saare accounts (asli wala bhi) ban** ho jaate hain.
- **Ab rule:** rate limit ke andar raho. Zyada chahiye to: alag-alag vendor (har
  ek ka ek account), ya paid plan. Rotation-to-evade nahi.

### 11.3 Jhooth ke saath API bech dena — India G-Sec yields
- **Kya hua:** pehle main over-confident tha ki Twelve Data India G-Sec yields
  deta hai.
- **Kyun galat:** main verify nahi kar paya. Tumhe ek galat waade par signup
  karwa deta.
- **Ab rule:** jab tak verify na ho, "shayad" bolo, "haan pakka" nahi. Isiliye
  IN10Y abhi bhi dash dikhata hai jab tak tum Twelve Data ka test output na do.

### 11.4 `features.liveData: 'auto'` truthy string bug
- **Kya hua:** kuch purana code `'auto'` ko "on" samajh ke placeholder
  `api.example.com` par call maar raha tha.
- **Kyun galat:** `'auto'` ek non-empty string hai → JS mein truthy → galat
  branch chala.
- **Ab rule:** live/sim ka faisla `IV.mode` (asli resolved state) se hota hai,
  config ke truthy flag se nahi.

### 11.5 Marketaux entity mapping — carets aur BSE series
- **Kya hua:** `^NSEI` (Nifty) match nahi hota tha; `AXISCBGPG.BO` jaise
  unpriceable series card par raw dikh jaate the.
- **Kyun galat:** code sirf `.NS/.BO` strip karta tha, Yahoo caret symbols ko
  handle nahi karta tha, aur universe-check nahi tha.
- **Ab rule:** `mapEntity()` carets ko symbol table se resolve karta hai aur jo
  universe mein nahi use drop karta. Test guarantee karta hai ki koi story aisa
  symbol na dikhaye jiska page site khol na sake.
- **Bonus seekh:** ye bug **tumhare asli Colab output** se pakda gaya — asli
  vendor data ke bina main ye maan hi nahi paata. Asli data se test karna zaroori.

### 11.6 Marketaux free tier ki galat samajh — `limit=50`
- **Kya hua:** config `marketauxPageSize: 50` maan ke chal raha tha.
- **Kyun galat:** free plan chahe kuch bhi `limit` bhejo, **3 articles per
  request** deta hai. Paging guard result set ke aage nikal jaata.
- **Ab rule:** jo actually aaya wo gino (3), config honest (72 req/din), aur har
  request apni securities ke baare mein (`symbols` + `filter_entities`).

### 11.7 Chart red, header green — bars quote se peeche
- **Kya hua:** quote green dikhata tha par chart red.
- **Kyun galat:** vendor ke OHLC bars live quote se thode peeche hote hain, aur
  chart pehle-vs-aakhri bar se color decide kar raha tha.
- **Ab rule:** 1D chart ka aakhri bar live quote se pin hota hai, aur color
  previous-close baseline se compare hota hai.

### 11.8 Terminal panels anant tak badhte the
- **Kya hua:** canvas parent ko naapta tha, parent canvas se badhta tha → loop.
- **Ab rule:** `100vh` + `minmax(0,1fr)` grid tracks + absolutely-positioned
  canvases. (Layout ki classic galti.)

### 11.9 Stale test servers ports pakde rehte the
- **Kya hua:** purane test servers band nahi hue, chupke se live data serve
  karte rahe, jisse fallback assertions galat pass ho jaate.
- **Ab rule:** har test start se pehle port free hai ya nahi check karta hai;
  busy ho to refuse. (Verify karte waqt "kya naap rahe ho" pe dhyaan do.)

### 11.10 Hostinger deploy ke baare mein confusion
- **Kya hua:** yaad aaya ki "humne Hostinger par push kiya tha" — hua nahi tha.
- **Sachai:** is sandbox se Hostinger reachable hi nahi (port 22 blocked, HTTPS
  403, koi ssh binary nahi). Push sirf **GitHub** par hua. Hostinger par deploy
  abhi karna baaki hai (Section 10, Option B).
- **Ab rule:** deploy ka record clear rakho — kahan gaya, kahan nahi. Sirf GitHub
  = origin.

---

## 12. Honesty rules jo product mein baked hain

- Masthead badge hamesha sach bolta hai: **LIVE** (session state + hover par
  provider list + last update) ya **SIMULATED**.
- Live mode mein simulator poori tarah band — banaya number asli table mein nahi
  ghus sakta.
- Jis symbol ka real provider nahi, wo "unavailable" bolta hai aur dash dikhata
  hai; jo fundamentals upstream nahi deta, wo reason dikhata hai, number nahi.
- Live headlines apni publication ka naam le kar chalti hain aur original par
  link karti hain.

---

## 13. Abhi kya BACHA hai (pending / aage ka kaam)

1. **Deploy live karna** — Section 10 ke steps. Backend Render par, pages
   Hostinger par. (Abhi sirf GitHub par code hai; kahin online live nahi.)
2. **Twelve Data ka test output** — tumne `symbol_search` + `quote` (IN10Y ke
   liye) dena tha ("baad mein dedunga"). Us se G-Sec yields wala dash bharega —
   ya confirm hoga ki Twelve Data India G-Sec deta bhi hai ya nahi.
3. **Nayi Marketaux key** — regenerate karke config/env mein daalni hai.
4. **(Optional) Zerodha Kite** — sach ka tick-by-tick chahiye to paid feed.

---

## 14. 30-second recap (agar sab bhool jao to bas itna)

- **Kya:** India-first Bloomberg-jaisi site — news + markets + stock pages +
  terminal — **asli live data** par.
- **Kaise:** plain HTML/CSS/JS frontend + ek zero-dependency Node backend. Backend
  isliye zaroori kyunki browser CORS ki wajah se Yahoo/RSS seedha nahi bula sakta.
- **Data:** Yahoo (quotes/charts/fundamentals) + CoinGecko + Frankfurter + 22 RSS
  feeds — sab free, no key. Optional keyed upgrades (Twelvedata/Finnhub/Marketaux/
  Kite).
- **Imaandari:** LIVE/SIMULATED badge kabhi jhooth nahi bolta; koi number invent
  nahi hota.
- **Safe:** sab GitHub par push (`4b70915`). 185 tests pass.
- **Bacha:** deploy live karna, nayi Marketaux key, Twelve Data test output.
- **Yaad rakho:** keys kabhi chat mein nahi; server-side only; rate limits ke
  andar; verify kiye bina "haan pakka" mat bolna.
```
