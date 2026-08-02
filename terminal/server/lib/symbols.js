/* =============================================================================
 * symbols.js — the India-first universe and its vendor mappings.
 *
 * `sym` is the internal id used everywhere in the UI. Each provider block maps
 * it to that vendor's own ticker. Add a provider by adding a key here.
 * ========================================================================== */

'use strict';

/* cls: index | equity | fx | commodity | crypto | rate
   y:   Yahoo Finance ticker (no key needed)
   cg:  CoinGecko id
   fx:  [base, quote] for the FX provider                                    */
const UNIVERSE = [
  // ---------------------------------------------------------------- indices
  { sym: 'NIFTY',     name: 'NIFTY 50',              cls: 'index', region: 'India',    y: '^NSEI',                 ccy: 'INR' },
  { sym: 'SENSEX',    name: 'BSE SENSEX',            cls: 'index', region: 'India',    y: '^BSESN',                ccy: 'INR' },
  { sym: 'BANKNIFTY', name: 'NIFTY Bank',            cls: 'index', region: 'India',    y: '^NSEBANK',              ccy: 'INR' },
  { sym: 'FINNIFTY',  name: 'NIFTY Financial Svcs',  cls: 'index', region: 'India',    y: 'NIFTY_FIN_SERVICE.NS',  ccy: 'INR' },
  { sym: 'MIDCPNIFTY', name: 'NIFTY Midcap 100',     cls: 'index', region: 'India',    y: '^CNXMIDCAP',            ccy: 'INR' },
  { sym: 'NIFTYIT',   name: 'NIFTY IT',              cls: 'index', region: 'India',    y: '^CNXIT',                ccy: 'INR' },
  { sym: 'INDIAVIX',  name: 'India VIX',             cls: 'index', region: 'India',    y: '^INDIAVIX',             ccy: 'INR' },
  { sym: 'SPX',       name: 'S&P 500',               cls: 'index', region: 'Americas', y: '^GSPC',                 ccy: 'USD' },
  { sym: 'NASDAQ',    name: 'Nasdaq Composite',      cls: 'index', region: 'Americas', y: '^IXIC',                 ccy: 'USD' },
  { sym: 'DOW',       name: 'Dow Jones Industrial',  cls: 'index', region: 'Americas', y: '^DJI',                  ccy: 'USD' },
  { sym: 'FTSE',      name: 'FTSE 100',              cls: 'index', region: 'EMEA',     y: '^FTSE',                 ccy: 'GBP' },
  { sym: 'DAX',       name: 'DAX',                   cls: 'index', region: 'EMEA',     y: '^GDAXI',                ccy: 'EUR' },
  { sym: 'NIKKEI',    name: 'Nikkei 225',            cls: 'index', region: 'APAC',     y: '^N225',                 ccy: 'JPY' },
  { sym: 'HANGSENG',  name: 'Hang Seng',             cls: 'index', region: 'APAC',     y: '^HSI',                  ccy: 'HKD' },

  // ------------------------------------------------------- NIFTY 50 equities
  eq('RELIANCE',   'Reliance Industries',        'Energy'),
  eq('TCS',        'Tata Consultancy Services',  'Technology'),
  eq('HDFCBANK',   'HDFC Bank',                  'Financials'),
  eq('ICICIBANK',  'ICICI Bank',                 'Financials'),
  eq('INFY',       'Infosys',                    'Technology'),
  eq('HINDUNILVR', 'Hindustan Unilever',         'Consumer'),
  eq('ITC',        'ITC',                        'Consumer'),
  eq('SBIN',       'State Bank of India',        'Financials'),
  eq('BHARTIARTL', 'Bharti Airtel',              'Communications'),
  eq('BAJFINANCE', 'Bajaj Finance',              'Financials'),
  eq('KOTAKBANK',  'Kotak Mahindra Bank',        'Financials'),
  eq('LT',         'Larsen & Toubro',            'Industrials'),
  eq('HCLTECH',    'HCL Technologies',           'Technology'),
  eq('AXISBANK',   'Axis Bank',                  'Financials'),
  eq('MARUTI',     'Maruti Suzuki India',        'Consumer'),
  eq('ASIANPAINT', 'Asian Paints',               'Materials'),
  eq('SUNPHARMA',  'Sun Pharmaceutical',         'Health Care'),
  eq('TITAN',      'Titan Company',              'Consumer'),
  eq('ULTRACEMCO', 'UltraTech Cement',           'Materials'),
  eq('WIPRO',      'Wipro',                      'Technology'),
  eq('NESTLEIND',  'Nestle India',               'Consumer'),
  eq('ONGC',       'Oil & Natural Gas Corp',     'Energy'),
  eq('NTPC',       'NTPC',                       'Utilities'),
  eq('POWERGRID',  'Power Grid Corp',            'Utilities'),
  eq('TATAMOTORS', 'Tata Motors',                'Consumer'),
  eq('TATASTEEL',  'Tata Steel',                 'Materials'),
  eq('ADANIENT',   'Adani Enterprises',          'Industrials'),
  eq('ADANIPORTS', 'Adani Ports & SEZ',          'Industrials'),
  eq('JSWSTEEL',   'JSW Steel',                  'Materials'),
  eq('COALINDIA',  'Coal India',                 'Energy'),
  eq('BAJAJFINSV', 'Bajaj Finserv',              'Financials'),
  eq('GRASIM',     'Grasim Industries',          'Materials'),
  eq('DRREDDY',    "Dr. Reddy's Laboratories",   'Health Care'),
  eq('CIPLA',      'Cipla',                      'Health Care'),
  eq('HINDALCO',   'Hindalco Industries',        'Materials'),
  eq('BPCL',       'Bharat Petroleum',           'Energy'),
  eq('EICHERMOT',  'Eicher Motors',              'Consumer'),
  eq('BRITANNIA',  'Britannia Industries',       'Consumer'),
  eq('HEROMOTOCO', 'Hero MotoCorp',              'Consumer'),
  eq('INDUSINDBK', 'IndusInd Bank',              'Financials'),
  eq('M&M',        'Mahindra & Mahindra',        'Consumer'),
  eq('SBILIFE',    'SBI Life Insurance',         'Financials'),
  eq('TECHM',      'Tech Mahindra',              'Technology'),
  eq('APOLLOHOSP', 'Apollo Hospitals',           'Health Care'),
  eq('TATACONSUM', 'Tata Consumer Products',     'Consumer'),
  eq('LTIM',       'LTIMindtree',                'Technology'),
  eq('SHRIRAMFIN', 'Shriram Finance',            'Financials'),
  eq('HDFCLIFE',   'HDFC Life Insurance',        'Financials'),
  eq('DIVISLAB',   "Divi's Laboratories",        'Health Care'),
  eq('TRENT',      'Trent',                      'Consumer'),

  // ------------------------------------------------------------------- FX
  { sym: 'USDINR', name: 'US Dollar / Rupee',   cls: 'fx', y: 'USDINR=X', fx: ['USD', 'INR'], ccy: 'INR' },
  { sym: 'EURINR', name: 'Euro / Rupee',        cls: 'fx', y: 'EURINR=X', fx: ['EUR', 'INR'], ccy: 'INR' },
  { sym: 'GBPINR', name: 'Sterling / Rupee',    cls: 'fx', y: 'GBPINR=X', fx: ['GBP', 'INR'], ccy: 'INR' },
  { sym: 'JPYINR', name: 'Yen / Rupee',         cls: 'fx', y: 'JPYINR=X', fx: ['JPY', 'INR'], ccy: 'INR' },
  { sym: 'DXY',    name: 'Dollar Spot Index',   cls: 'fx', y: 'DX-Y.NYB',                     ccy: 'USD' },

  // ----------------------------------------------------------- commodities
  { sym: 'GOLD',   name: 'Gold',        cls: 'commodity', unit: 'USD/t oz',   y: 'GC=F', ccy: 'USD' },
  { sym: 'SILVER', name: 'Silver',      cls: 'commodity', unit: 'USD/t oz',   y: 'SI=F', ccy: 'USD' },
  { sym: 'CRUDE',  name: 'WTI Crude',   cls: 'commodity', unit: 'USD/bbl',    y: 'CL=F', ccy: 'USD' },
  { sym: 'BRENT',  name: 'Brent Crude', cls: 'commodity', unit: 'USD/bbl',    y: 'BZ=F', ccy: 'USD' },
  { sym: 'NATGAS', name: 'Natural Gas', cls: 'commodity', unit: 'USD/MMBtu',  y: 'NG=F', ccy: 'USD' },
  { sym: 'COPPER', name: 'Copper',      cls: 'commodity', unit: 'USD/lb',     y: 'HG=F', ccy: 'USD' },

  // --------------------------------------------------------------- crypto
  { sym: 'BTC',  name: 'Bitcoin',  cls: 'crypto', y: 'BTC-INR',  cg: 'bitcoin',  ccy: 'INR' },
  { sym: 'ETH',  name: 'Ether',    cls: 'crypto', y: 'ETH-INR',  cg: 'ethereum', ccy: 'INR' },
  { sym: 'SOL',  name: 'Solana',   cls: 'crypto', y: 'SOL-INR',  cg: 'solana',   ccy: 'INR' },
  { sym: 'XRP',  name: 'XRP',      cls: 'crypto', y: 'XRP-INR',  cg: 'ripple',   ccy: 'INR' },
  { sym: 'DOGE', name: 'Dogecoin', cls: 'crypto', y: 'DOGE-INR', cg: 'dogecoin', ccy: 'INR' },

  // ---------------------------------------------------------------- rates
  /* India G-Secs are not on any free feed. They resolve only when a keyed
     provider is configured; otherwise the API reports them unavailable and the
     UI shows a dash rather than inventing a number. */
  { sym: 'IN10Y', name: 'India 10Y G-Sec', cls: 'rate', ccy: 'INR', needsKey: true, td: 'IN10Y' },
  { sym: 'IN5Y',  name: 'India 5Y G-Sec',  cls: 'rate', ccy: 'INR', needsKey: true, td: 'IN5Y' },
  { sym: 'IN2Y',  name: 'India 2Y G-Sec',  cls: 'rate', ccy: 'INR', needsKey: true, td: 'IN2Y' },
  { sym: 'US10Y', name: 'US 10Y Treasury', cls: 'rate', ccy: 'USD', y: '^TNX' }
];

function eq(sym, name, sector) {
  return {
    sym, name, cls: 'equity', sector, ccy: 'INR', exch: 'NSE',
    y: sym.replace('&', '%26') + '.NS'      // Yahoo wants M%26M.NS for M&M
  };
}

const BY_SYM = new Map(UNIVERSE.map(u => [u.sym, u]));

/* Which provider should serve a symbol, in order of preference. */
function providersFor(sym) {
  const u = BY_SYM.get(sym);
  if (!u) return [];
  const chain = [];
  if (u.cls === 'crypto') chain.push('coingecko');
  if (u.cls === 'fx' && u.fx) chain.push('frankfurter');
  if (u.y) chain.push('yahoo');
  if (u.td) chain.push('twelvedata');
  chain.push('finnhub');
  return chain;
}

module.exports = {
  UNIVERSE,
  BY_SYM,
  providersFor,
  get: (sym) => BY_SYM.get(String(sym || '').toUpperCase()) || null,
  all: () => UNIVERSE.map(u => u.sym),
  byClass: (cls) => UNIVERSE.filter(u => u.cls === cls).map(u => u.sym),
  yahooTicker: (sym) => (BY_SYM.get(sym) || {}).y || null,
  fromYahoo: (t) => (UNIVERSE.find(u => u.y === t) || {}).sym || null
};
