/* =============================================================================
 * config.js — single place for branding, feature flags, API keys, endpoints.
 * Every key below is a PLACEHOLDER. Drop in real values later and flip
 * FEATURES.liveData to true; api.js will start hitting the real endpoints
 * without any other code change.
 * ========================================================================== */

window.IV_CONFIG = {
  brand: {
    name: 'VERDICT',
    mark: 'V',
    tagline: 'India, Markets, Money and Power',
    legal: 'Verdict Media India',
    year: new Date().getFullYear()
  },

  /* The live backend. Same origin when served by server/server.js. */
  api: {
    base: '/api',
    healthTimeoutMs: 3500
  },

  /* ---- API keys: replace the PLACEHOLDER_* strings ---- */
  keys: {
    marketData: 'PLACEHOLDER_MARKET_DATA_KEY',   // quotes, OHLC, fundamentals
    news: 'PLACEHOLDER_NEWS_API_KEY',            // wire + article corpus
    crypto: 'PLACEHOLDER_CRYPTO_API_KEY',
    fx: 'PLACEHOLDER_FX_API_KEY',
    streaming: 'PLACEHOLDER_WS_TOKEN',           // websocket auth token
    analytics: 'PLACEHOLDER_ANALYTICS_ID',
    paymentsPublic: 'PLACEHOLDER_PAYMENTS_PUBLIC_KEY',
    mapTiles: 'PLACEHOLDER_MAP_TILES_KEY'
  },

  endpoints: {
    quotes: 'https://api.example.com/v1/quotes',
    ohlc: 'https://api.example.com/v1/ohlc',
    fundamentals: 'https://api.example.com/v1/fundamentals',
    news: 'https://api.example.com/v1/news',
    search: 'https://api.example.com/v1/search',
    calendar: 'https://api.example.com/v1/calendar',
    stream: 'wss://stream.example.com/v1/marketdata',
    newsletter: 'https://api.example.com/v1/newsletter',
    subscribe: 'https://api.example.com/v1/subscribe'
  },

  features: {
    /* 'auto' asks the backend at boot: real data when it answers, deterministic
       simulation (clearly labelled) when it does not. */
    liveData: 'auto',
    tickMs: 1200,           // simulated tick cadence
    paywall: true,
    freeArticles: 3,        // metered articles before the wall
    breakingBanner: true,
    liveTv: true,
    terminal: true,
    theme: 'auto'           // 'auto' | 'light' | 'dark'
  },

  /* Sections drive the nav, the section pages and the article taxonomy. */
  /* Kicker colours stay inside the brand family — amber, blue, red, black —
     rather than a per-section rainbow. */
  sections: [
    { id: 'markets',    label: 'Markets',    accent: '#ff7a00' },
    { id: 'economics',  label: 'Economy',    accent: '#000000' },
    { id: 'companies',  label: 'Companies',  accent: '#0068ff' },
    { id: 'technology', label: 'Technology', accent: '#0068ff' },
    { id: 'politics',   label: 'Politics',   accent: '#ee1b22' },
    { id: 'wealth',     label: 'Wealth',     accent: '#000000' },
    { id: 'green',      label: 'Green',      accent: '#00a15a' },
    { id: 'crypto',     label: 'Crypto',     accent: '#ff7a00' },
    { id: 'opinion',    label: 'Opinion',    accent: '#000000' }
  ],

  /* Terminal function codes surfaced in HELP and the command autocomplete. */
  terminalFunctions: [
    ['DES', 'Security description'],
    ['GP',  'Price graph'],
    ['GIP', 'Intraday price graph'],
    ['TOP', 'Top news wire'],
    ['WEI', 'World equity indexes'],
    ['IND', 'India indices monitor'],
    ['MOST', 'Most active'],
    ['FX',  'Currency monitor'],
    ['CMD', 'Commodity monitor'],
    ['RATE', 'Rates and curves'],
    ['HM',  'Sector heat map'],
    ['DEPTH', 'Order book depth'],
    ['PORT', 'Portfolio / watchlist'],
    ['ALRT', 'Price alerts'],
    ['ECO', 'Economic calendar'],
    ['EARN', 'Earnings calendar'],
    ['FA',  'Financial analysis'],
    ['MSG', 'Message pane'],
    ['HELP', 'Function directory']
  ]
};
