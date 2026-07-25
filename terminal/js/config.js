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
    tagline: 'Markets, Money and Power',
    legal: 'Verdict Media LP',
    year: new Date().getFullYear()
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
    liveData: false,        // false => deterministic simulated feed (see market.js)
    tickMs: 1200,           // simulated tick cadence
    paywall: true,
    freeArticles: 3,        // metered articles before the wall
    breakingBanner: true,
    liveTv: true,
    terminal: true,
    theme: 'auto'           // 'auto' | 'light' | 'dark'
  },

  /* Sections drive the nav, the section pages and the article taxonomy. */
  sections: [
    { id: 'markets',    label: 'Markets',    accent: '#0b7' },
    { id: 'technology', label: 'Technology', accent: '#5b8cff' },
    { id: 'politics',   label: 'Politics',   accent: '#d9534f' },
    { id: 'wealth',     label: 'Wealth',     accent: '#c9a227' },
    { id: 'pursuits',   label: 'Pursuits',   accent: '#b06ab3' },
    { id: 'opinion',    label: 'Opinion',    accent: '#e2703a' },
    { id: 'green',      label: 'Green',      accent: '#3aa76d' },
    { id: 'crypto',     label: 'Crypto',     accent: '#f0932b' },
    { id: 'cities',     label: 'Cities',     accent: '#4aa3c7' },
    { id: 'economics',  label: 'Economics',  accent: '#8e8e93' }
  ],

  /* Terminal function codes surfaced in HELP and the command autocomplete. */
  terminalFunctions: [
    ['DES', 'Security description'],
    ['GP',  'Price graph'],
    ['GIP', 'Intraday price graph'],
    ['TOP', 'Top news wire'],
    ['WEI', 'World equity indexes'],
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
