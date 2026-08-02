/* =============================================================================
 * data.js — the India universe and the offline fallback corpus.
 *
 * When the backend is reachable, live.js overwrites prices via
 * Market.applyQuotes() and headlines via IV_DATA.setLiveArticles(). Everything
 * below is what the site falls back to with no server — a deterministic
 * simulation, clearly labelled SIMULATED in the header so it can never be
 * mistaken for real data.
 *
 * `sym` values MUST stay in sync with server/lib/symbols.js.
 * ========================================================================== */

(function () {
  'use strict';

  const eq = (sym, name, sector, base, mcap, emp, hq) =>
    ({ sym, name, cls: 'equity', sector, base, vol: 0.26, ccy: 'INR', mcap, exch: 'NSE', emp, hq });

  const UNIVERSE = [
    // ------------------------------------------------------------- indices
    { sym: 'NIFTY',      name: 'NIFTY 50',              cls: 'index', region: 'India',    base: 24812.05, vol: 0.13, ccy: 'INR' },
    { sym: 'SENSEX',     name: 'BSE SENSEX',            cls: 'index', region: 'India',    base: 81455.40, vol: 0.13, ccy: 'INR' },
    { sym: 'BANKNIFTY',  name: 'NIFTY Bank',            cls: 'index', region: 'India',    base: 52380.15, vol: 0.16, ccy: 'INR' },
    { sym: 'FINNIFTY',   name: 'NIFTY Financial Svcs',  cls: 'index', region: 'India',    base: 23904.60, vol: 0.15, ccy: 'INR' },
    { sym: 'MIDCPNIFTY', name: 'NIFTY Midcap 100',      cls: 'index', region: 'India',    base: 57120.80, vol: 0.19, ccy: 'INR' },
    { sym: 'NIFTYIT',    name: 'NIFTY IT',              cls: 'index', region: 'India',    base: 39240.25, vol: 0.21, ccy: 'INR' },
    { sym: 'INDIAVIX',   name: 'India VIX',             cls: 'index', region: 'India',    base: 13.42,    vol: 0.80, ccy: 'INR' },
    { sym: 'SPX',        name: 'S&P 500',               cls: 'index', region: 'Americas', base: 5312.44,  vol: 0.14, ccy: 'USD' },
    { sym: 'NASDAQ',     name: 'Nasdaq Composite',      cls: 'index', region: 'Americas', base: 16781.22, vol: 0.19, ccy: 'USD' },
    { sym: 'DOW',        name: 'Dow Jones Industrial',  cls: 'index', region: 'Americas', base: 39864.10, vol: 0.13, ccy: 'USD' },
    { sym: 'FTSE',       name: 'FTSE 100',              cls: 'index', region: 'EMEA',     base: 8214.05,  vol: 0.13, ccy: 'GBP' },
    { sym: 'DAX',        name: 'DAX',                   cls: 'index', region: 'EMEA',     base: 18492.77, vol: 0.17, ccy: 'EUR' },
    { sym: 'NIKKEI',     name: 'Nikkei 225',            cls: 'index', region: 'APAC',     base: 38104.60, vol: 0.20, ccy: 'JPY' },
    { sym: 'HANGSENG',   name: 'Hang Seng',             cls: 'index', region: 'APAC',     base: 18320.15, vol: 0.24, ccy: 'HKD' },

    // ------------------------------------------------------ NIFTY equities
    eq('RELIANCE',   'Reliance Industries',       'Energy',         2948.60, 19.9e12, 389000, 'Mumbai, Maharashtra'),
    eq('TCS',        'Tata Consultancy Services', 'Technology',     4162.30, 15.1e12, 601546, 'Mumbai, Maharashtra'),
    eq('HDFCBANK',   'HDFC Bank',                 'Financials',     1682.45, 12.8e12, 213000, 'Mumbai, Maharashtra'),
    eq('ICICIBANK',  'ICICI Bank',                'Financials',     1231.70, 8.65e12, 141000, 'Mumbai, Maharashtra'),
    eq('INFY',       'Infosys',                   'Technology',     1854.20, 7.70e12, 317240, 'Bengaluru, Karnataka'),
    eq('HINDUNILVR', 'Hindustan Unilever',        'Consumer',       2481.35, 5.83e12, 21000,  'Mumbai, Maharashtra'),
    eq('ITC',        'ITC',                       'Consumer',        495.80, 6.20e12, 24567,  'Kolkata, West Bengal'),
    eq('SBIN',       'State Bank of India',       'Financials',      831.25, 7.42e12, 232296, 'Mumbai, Maharashtra'),
    eq('BHARTIARTL', 'Bharti Airtel',             'Communications', 1562.90, 9.05e12, 26000,  'New Delhi'),
    eq('BAJFINANCE', 'Bajaj Finance',             'Financials',     6912.40, 4.28e12, 57000,  'Pune, Maharashtra'),
    eq('KOTAKBANK',  'Kotak Mahindra Bank',       'Financials',     1783.55, 3.55e12, 105000, 'Mumbai, Maharashtra'),
    eq('LT',         'Larsen & Toubro',           'Industrials',    3548.90, 4.88e12, 57000,  'Mumbai, Maharashtra'),
    eq('HCLTECH',    'HCL Technologies',          'Technology',     1618.75, 4.39e12, 219401, 'Noida, Uttar Pradesh'),
    eq('AXISBANK',   'Axis Bank',                 'Financials',     1208.30, 3.73e12, 104332, 'Mumbai, Maharashtra'),
    eq('MARUTI',     'Maruti Suzuki India',       'Consumer',      12418.00, 3.90e12, 17000,  'New Delhi'),
    eq('ASIANPAINT', 'Asian Paints',              'Materials',      2946.15, 2.83e12, 8500,   'Mumbai, Maharashtra'),
    eq('SUNPHARMA',  'Sun Pharmaceutical',        'Health Care',    1781.60, 4.27e12, 43000,  'Mumbai, Maharashtra'),
    eq('TITAN',      'Titan Company',             'Consumer',       3402.75, 3.02e12, 9000,   'Bengaluru, Karnataka'),
    eq('ULTRACEMCO', 'UltraTech Cement',          'Materials',     11185.20, 3.23e12, 23000,  'Mumbai, Maharashtra'),
    eq('WIPRO',      'Wipro',                     'Technology',      541.85, 2.83e12, 234054, 'Bengaluru, Karnataka'),
    eq('NESTLEIND',  'Nestle India',              'Consumer',       2502.40, 2.41e12, 8000,   'Gurugram, Haryana'),
    eq('ONGC',       'Oil & Natural Gas Corp',    'Energy',          264.70, 3.33e12, 26000,  'New Delhi'),
    eq('NTPC',       'NTPC',                      'Utilities',       401.55, 3.89e12, 18000,  'New Delhi'),
    eq('POWERGRID',  'Power Grid Corp',           'Utilities',       329.80, 3.07e12, 9000,   'Gurugram, Haryana'),
    eq('TATAMOTORS', 'Tata Motors',               'Consumer',        982.35, 3.62e12, 82000,  'Mumbai, Maharashtra'),
    eq('TATASTEEL',  'Tata Steel',                'Materials',       155.20, 1.94e12, 78000,  'Mumbai, Maharashtra'),
    eq('ADANIENT',   'Adani Enterprises',         'Industrials',    3104.85, 3.54e12, 25000,  'Ahmedabad, Gujarat'),
    eq('ADANIPORTS', 'Adani Ports & SEZ',         'Industrials',    1452.60, 3.14e12, 5000,   'Ahmedabad, Gujarat'),
    eq('JSWSTEEL',   'JSW Steel',                 'Materials',       921.40, 2.25e12, 15000,  'Mumbai, Maharashtra'),
    eq('COALINDIA',  'Coal India',                'Energy',          482.15, 2.97e12, 239000, 'Kolkata, West Bengal'),
    eq('BAJAJFINSV', 'Bajaj Finserv',             'Financials',     1648.90, 2.63e12, 13000,  'Pune, Maharashtra'),
    eq('GRASIM',     'Grasim Industries',         'Materials',      2651.30, 1.75e12, 25000,  'Mumbai, Maharashtra'),
    eq('DRREDDY',    "Dr. Reddy's Laboratories",  'Health Care',    1248.55, 1.04e12, 24000,  'Hyderabad, Telangana'),
    eq('CIPLA',      'Cipla',                     'Health Care',    1552.70, 1.25e12, 26000,  'Mumbai, Maharashtra'),
    eq('HINDALCO',   'Hindalco Industries',       'Materials',       661.90, 1.49e12, 36000,  'Mumbai, Maharashtra'),
    eq('BPCL',       'Bharat Petroleum',          'Energy',          321.45, 1.39e12, 9000,   'Mumbai, Maharashtra'),
    eq('EICHERMOT',  'Eicher Motors',             'Consumer',       4903.20, 1.34e12, 9000,   'New Delhi'),
    eq('BRITANNIA',  'Britannia Industries',      'Consumer',       5712.60, 1.38e12, 4000,   'Bengaluru, Karnataka'),
    eq('HEROMOTOCO', 'Hero MotoCorp',             'Consumer',       5392.85, 1.08e12, 8600,   'New Delhi'),
    eq('INDUSINDBK', 'IndusInd Bank',             'Financials',     1381.25, 1.08e12, 42000,  'Mumbai, Maharashtra'),
    eq('M&M',        'Mahindra & Mahindra',       'Consumer',       2846.40, 3.54e12, 26000,  'Mumbai, Maharashtra'),
    eq('SBILIFE',    'SBI Life Insurance',        'Financials',     1748.30, 1.75e12, 20000,  'Mumbai, Maharashtra'),
    eq('TECHM',      'Tech Mahindra',             'Technology',     1621.75, 1.59e12, 145000, 'Pune, Maharashtra'),
    eq('APOLLOHOSP', 'Apollo Hospitals',          'Health Care',    6985.40, 1.00e12, 70000,  'Chennai, Tamil Nadu'),
    eq('TATACONSUM', 'Tata Consumer Products',    'Consumer',       1148.65, 1.14e12, 4000,   'Mumbai, Maharashtra'),
    eq('LTIM',       'LTIMindtree',               'Technology',     5894.30, 1.75e12, 84000,  'Mumbai, Maharashtra'),
    eq('SHRIRAMFIN', 'Shriram Finance',           'Financials',     3186.70, 1.20e12, 68000,  'Chennai, Tamil Nadu'),
    eq('HDFCLIFE',   'HDFC Life Insurance',       'Financials',      688.45, 1.48e12, 25000,  'Mumbai, Maharashtra'),
    eq('DIVISLAB',   "Divi's Laboratories",       'Health Care',    5104.90, 1.36e12, 18000,  'Hyderabad, Telangana'),
    eq('TRENT',      'Trent',                     'Consumer',       6284.15, 2.23e12, 5000,   'Mumbai, Maharashtra'),

    // ------------------------------------------------------------------ FX
    { sym: 'USDINR', name: 'US Dollar / Rupee', cls: 'fx', base: 83.612, vol: 0.05, ccy: 'INR' },
    { sym: 'EURINR', name: 'Euro / Rupee',      cls: 'fx', base: 90.485, vol: 0.07, ccy: 'INR' },
    { sym: 'GBPINR', name: 'Sterling / Rupee',  cls: 'fx', base: 107.42, vol: 0.08, ccy: 'INR' },
    { sym: 'JPYINR', name: 'Yen / Rupee',       cls: 'fx', base: 0.5312, vol: 0.09, ccy: 'INR' },
    { sym: 'DXY',    name: 'Dollar Spot Index', cls: 'fx', base: 104.52, vol: 0.06, ccy: 'USD' },

    // --------------------------------------------------------- commodities
    { sym: 'GOLD',   name: 'Gold',        cls: 'commodity', unit: 'USD/t oz',  base: 2381.40, vol: 0.15, ccy: 'USD' },
    { sym: 'SILVER', name: 'Silver',      cls: 'commodity', unit: 'USD/t oz',  base: 30.28,   vol: 0.28, ccy: 'USD' },
    { sym: 'CRUDE',  name: 'WTI Crude',   cls: 'commodity', unit: 'USD/bbl',   base: 78.14,   vol: 0.34, ccy: 'USD' },
    { sym: 'BRENT',  name: 'Brent Crude', cls: 'commodity', unit: 'USD/bbl',   base: 82.36,   vol: 0.32, ccy: 'USD' },
    { sym: 'NATGAS', name: 'Natural Gas', cls: 'commodity', unit: 'USD/MMBtu', base: 2.714,   vol: 0.62, ccy: 'USD' },
    { sym: 'COPPER', name: 'Copper',      cls: 'commodity', unit: 'USD/lb',    base: 4.418,   vol: 0.24, ccy: 'USD' },

    // -------------------------------------------------------------- crypto
    { sym: 'BTC',  name: 'Bitcoin',  cls: 'crypto', base: 5412000, vol: 0.55, ccy: 'INR' },
    { sym: 'ETH',  name: 'Ether',    cls: 'crypto', base: 288400,  vol: 0.62, ccy: 'INR' },
    { sym: 'SOL',  name: 'Solana',   cls: 'crypto', base: 12042,   vol: 0.86, ccy: 'INR' },
    { sym: 'XRP',  name: 'XRP',      cls: 'crypto', base: 41.32,   vol: 0.78, ccy: 'INR' },
    { sym: 'DOGE', name: 'Dogecoin', cls: 'crypto', base: 10.78,   vol: 0.95, ccy: 'INR' },

    // --------------------------------------------------------------- rates
    { sym: 'IN10Y', name: 'India 10Y G-Sec', cls: 'rate', base: 6.982, vol: 0.11, ccy: 'INR' },
    { sym: 'IN5Y',  name: 'India 5Y G-Sec',  cls: 'rate', base: 6.914, vol: 0.12, ccy: 'INR' },
    { sym: 'IN2Y',  name: 'India 2Y G-Sec',  cls: 'rate', base: 6.856, vol: 0.13, ccy: 'INR' },
    { sym: 'US10Y', name: 'US 10Y Treasury', cls: 'rate', base: 4.286, vol: 0.14, ccy: 'USD' }
  ];

  /* India G-Sec curve (fallback shape; replaced when a rates provider is keyed) */
  const CURVE = [
    { t: '3M', y: 6.72 }, { t: '6M', y: 6.79 }, { t: '1Y', y: 6.84 },
    { t: '2Y', y: 6.86 }, { t: '3Y', y: 6.89 }, { t: '5Y', y: 6.91 },
    { t: '7Y', y: 6.95 }, { t: '10Y', y: 6.98 }, { t: '15Y', y: 7.06 },
    { t: '30Y', y: 7.12 }, { t: '40Y', y: 7.14 }
  ];

  const AUTHORS = [
    { id: 'rnair',    name: 'Rohan Nair',      role: 'Chief Markets Correspondent', bureau: 'Mumbai' },
    { id: 'ameena',   name: 'Ameena Qureshi',  role: 'Senior Editor, Technology',   bureau: 'Bengaluru' },
    { id: 'skulkarni', name: 'Sneha Kulkarni', role: 'Economics Correspondent',     bureau: 'New Delhi' },
    { id: 'vmehta',   name: 'Vikram Mehta',    role: 'Energy & Commodities',        bureau: 'Mumbai' },
    { id: 'dbanerjee', name: 'Dia Banerjee',   role: 'Banking & Credit',            bureau: 'Mumbai' },
    { id: 'kiyer',    name: 'Karthik Iyer',    role: 'Digital Assets',              bureau: 'Bengaluru' },
    { id: 'pshah',    name: 'Priya Shah',      role: 'Wealth',                      bureau: 'Ahmedabad' }
  ];

  const COLUMNISTS = [
    { id: 'agupta',  name: 'Aditya Gupta',   beat: 'The RBI and the cost of money' },
    { id: 'nrao',    name: 'Nandini Rao',    beat: 'Technology, platforms and regulation' },
    { id: 'jsingh',  name: 'Jaspreet Singh', beat: 'Deals, promoters and the boardroom' },
    { id: 'mthomas', name: 'Maya Thomas',    beat: 'Energy transition economics' }
  ];

  const H = 3600e3, M = 60e3;
  const now = Date.now();

  /* Offline fallback corpus. Used only when the backend is unreachable — the
     header shows SIMULATED whenever these are on screen. */
  const FALLBACK_ARTICLES = [
    { id: 'f01', s: 'markets', p: false, t: 'Nifty Holds Its Range as Financials Offset an IT Drag',
      d: 'Breadth stayed positive even as the index churned, with banks absorbing the selling in technology.',
      a: 'rnair', ts: now - 18 * M, mins: 4, sym: ['NIFTY', 'BANKNIFTY', 'NIFTYIT'], tags: ['Equities'] },
    { id: 'f02', s: 'economics', p: true, t: 'RBI Holds Repo Rate, Keeps Stance Unchanged',
      d: 'The committee flagged food inflation as the binding constraint on any easing this cycle.',
      a: 'skulkarni', ts: now - 52 * M, mins: 5, sym: ['IN10Y', 'BANKNIFTY'], tags: ['RBI', 'Rates'] },
    { id: 'f03', s: 'markets', p: false, t: 'Rupee Steadies Near Record Low as Importers Cover',
      d: 'Dollar demand from oil marketers met central bank supply around the highs.',
      a: 'rnair', ts: now - 2 * H, mins: 4, sym: ['USDINR'], tags: ['FX'] },
    { id: 'f04', s: 'technology', p: false, t: 'IT Majors Guide Cautiously as Deal Ramp-Ups Slip a Quarter',
      d: 'Discretionary spending has not returned; managements are protecting margins instead.',
      a: 'ameena', ts: now - 3 * H, mins: 6, sym: ['TCS', 'INFY', 'WIPRO', 'HCLTECH'], tags: ['IT Services'] },
    { id: 'f05', s: 'companies', p: true, t: 'Reliance Capex Cycle Turns as Retail Additions Slow',
      d: 'The mix is shifting from footprint to throughput, which changes the return profile.',
      a: 'vmehta', ts: now - 5 * H, mins: 6, sym: ['RELIANCE'], tags: ['Energy', 'Retail'] },
    { id: 'f06', s: 'markets', p: false, t: 'FPI Flows Turn Positive for a Third Session',
      d: 'Index inclusion money continues to arrive even as active allocators stay light.',
      a: 'dbanerjee', ts: now - 6 * H, mins: 4, sym: ['NIFTY', 'IN10Y'], tags: ['Flows'] },
    { id: 'f07', s: 'economics', p: false, t: 'GST Collections Hold Above the Run-Rate the Budget Assumed',
      d: 'Compliance gains, not volume, are doing most of the work.',
      a: 'skulkarni', ts: now - 9 * H, mins: 5, sym: [], tags: ['Fiscal'] },
    { id: 'f08', s: 'crypto', p: false, t: 'Indian Exchanges See Volumes Recover After the Tax Shock',
      d: 'Turnover is up but still a fraction of the pre-levy peak.',
      a: 'kiyer', ts: now - 12 * H, mins: 4, sym: ['BTC', 'ETH'], tags: ['Digital Assets'] },
    { id: 'f09', s: 'green', p: true, t: 'Solar Module Prices Fall Again, Squeezing Domestic Manufacturers',
      d: 'The ALMM shield is holding volumes, not margins.',
      a: 'mthomas', ts: now - 16 * H, mins: 5, sym: ['NTPC', 'POWERGRID'], tags: ['Energy Transition'] },
    { id: 'f10', s: 'wealth', p: false, t: 'SIP Book Sets Another Record as Equity Inflows Broaden',
      d: 'Monthly contributions have now grown for eleven straight months.',
      a: 'pshah', ts: now - 20 * H, mins: 4, sym: ['NIFTY'], tags: ['Mutual Funds'] },
    { id: 'f11', s: 'opinion', p: false, t: 'The Rupee Does Not Need a Level. It Needs a Rule.',
      d: 'Managing the band has costs that show up somewhere other than the exchange rate.',
      a: 'agupta', ts: now - 26 * H, mins: 5, sym: ['USDINR'], tags: ['Opinion'], col: 'agupta' },
    { id: 'f12', s: 'markets', p: true, t: 'Midcaps Trade at a Premium the Earnings Cycle Has Not Justified',
      d: 'The valuation gap to largecaps is the widest since 2017.',
      a: 'rnair', ts: now - 30 * H, mins: 5, sym: ['MIDCPNIFTY', 'NIFTY'], tags: ['Valuation'] }
  ];

  let ARTICLES = FALLBACK_ARTICLES.slice();
  let liveMode = false;

  const FALLBACK_WIRE = [
    { pr: 1, t: 'RBI KEEPS REPO RATE UNCHANGED; STANCE MAINTAINED', ts: now - 4 * M, src: 'VN' },
    { pr: 1, t: '*NIFTY REVERSES EARLY LOSS, BANKS LEAD', ts: now - 9 * M, src: 'VN' },
    { pr: 2, t: 'RUPEE OPENS 4 PAISE WEAKER AT 83.64/USD', ts: now - 16 * M, src: 'VN' },
    { pr: 2, t: 'FPIS NET BUYERS OF RS 1,842 CRORE IN CASH MARKET', ts: now - 24 * M, src: 'VN' },
    { pr: 3, t: 'IT INDEX UNDERPERFORMS FOR A THIRD SESSION', ts: now - 33 * M, src: 'VN' },
    { pr: 2, t: 'GST COLLECTIONS AT RS 1.74 LAKH CRORE FOR THE MONTH', ts: now - 48 * M, src: 'VN' },
    { pr: 3, t: 'GOLD HOLDS GAIN AS DOLLAR SLIPS FROM SESSION HIGH', ts: now - 61 * M, src: 'VN' },
    { pr: 1, t: '*INDIA 10-YEAR YIELD EASES 2BPS TO 6.98%', ts: now - 74 * M, src: 'VN' }
  ];
  let WIRE = FALLBACK_WIRE.slice();

  const VIDEOS = [
    { id: 'v1', t: 'The Open: What the RBI Left Unsaid', dur: '12:04', show: 'The Open', ts: now - 40 * M, sym: ['NIFTY'] },
    { id: 'v2', t: 'Street Signs: Breadth Beneath the Index', dur: '08:31', show: 'Street Signs', ts: now - 2 * H, sym: ['MIDCPNIFTY'] },
    { id: 'v3', t: 'Commodity Edge: Crude, Rupee and the Import Bill', dur: '06:12', show: 'Commodity Edge', ts: now - 5 * H, sym: ['CRUDE'] },
    { id: 'v4', t: 'Asia Trade: Flows Into India After Index Inclusion', dur: '10:47', show: 'Asia Trade', ts: now - 9 * H, sym: ['IN10Y'] },
    { id: 'v5', t: 'Tech Check: The IT Guidance Question', dur: '14:20', show: 'Tech Check', ts: now - 13 * H, sym: ['INFY'] },
    { id: 'v6', t: 'The Close: Where the Money Went Today', dur: '09:55', show: 'The Close', ts: now - 20 * H, sym: ['NIFTY'] }
  ];

  const PODCASTS = [
    { id: 'p1', t: 'The Tape: Midcap Valuations and Who Is Buying', show: 'The Tape', dur: '32 min', ts: now - 4 * H },
    { id: 'p2', t: 'Rupee Watch: Managing the Band', show: 'Rupee Watch', dur: '26 min', ts: now - 27 * H },
    { id: 'p3', t: 'Deal Room: Promoter Stake Sales Return', show: 'Deal Room', dur: '38 min', ts: now - 51 * H },
    { id: 'p4', t: 'Power Bill: Who Pays for the Grid', show: 'Power Bill', dur: '44 min', ts: now - 74 * H }
  ];

  const NEWSLETTERS = [
    { id: 'n1', t: 'India Edition', d: 'The stories moving Indian markets, before the open.', cad: 'Weekday mornings' },
    { id: 'n2', t: 'The Close', d: 'What happened, what it meant, what to watch tomorrow.', cad: 'Weekday evenings' },
    { id: 'n3', t: 'Money Stuff', d: 'Deals, plumbing and market structure.', cad: 'Tue / Thu' },
    { id: 'n4', t: 'Green Daily', d: 'The economics of the energy transition.', cad: 'Weekdays' },
    { id: 'n5', t: 'Crypto Brief', d: 'Digital assets, flows and Indian regulation.', cad: 'Mon / Wed / Fri' }
  ];

  const ECO_CALENDAR = [
    { d: 0, time: '17:30', ctry: 'IN', ev: 'CPI YoY',                per: 'Latest', est: '4.8%',  prev: '5.1%',  imp: 3 },
    { d: 0, time: '17:30', ctry: 'IN', ev: 'Industrial Production',  per: 'Latest', est: '4.9%',  prev: '5.2%',  imp: 2 },
    { d: 1, time: '12:00', ctry: 'IN', ev: 'WPI Inflation YoY',      per: 'Latest', est: '2.6%',  prev: '3.4%',  imp: 2 },
    { d: 1, time: '17:00', ctry: 'IN', ev: 'Trade Balance',          per: 'Latest', est: '-19.8B', prev: '-23.8B', imp: 2 },
    { d: 2, time: '10:00', ctry: 'IN', ev: 'RBI Policy Decision',    per: '',       est: '6.50%', prev: '6.50%', imp: 3 },
    { d: 2, time: '17:00', ctry: 'IN', ev: 'Forex Reserves',         per: 'Weekly', est: '—',     prev: '$652B', imp: 1 },
    { d: 3, time: '18:00', ctry: 'US', ev: 'CPI MoM',                per: 'Latest', est: '0.2%',  prev: '0.3%',  imp: 3 },
    { d: 3, time: '11:30', ctry: 'IN', ev: 'GST Collections',        per: 'Monthly', est: '₹1.72L cr', prev: '₹1.74L cr', imp: 2 },
    { d: 4, time: '17:30', ctry: 'IN', ev: 'GDP YoY',                per: 'Quarter', est: '6.9%', prev: '7.8%',  imp: 3 },
    { d: 4, time: '19:30', ctry: 'US', ev: 'FOMC Rate Decision',     per: '',       est: '5.50%', prev: '5.50%', imp: 3 }
  ];

  const EARNINGS = [
    { d: 0, sym: 'TCS',        name: 'Tata Consultancy Services', when: 'After close', est: '₹32.4', rev: '₹62,600 cr' },
    { d: 0, sym: 'HDFCBANK',   name: 'HDFC Bank',                 when: 'After close', est: '₹22.1', rev: '₹85,200 cr' },
    { d: 1, sym: 'RELIANCE',   name: 'Reliance Industries',       when: 'After close', est: '₹26.8', rev: '₹2.36L cr' },
    { d: 2, sym: 'INFY',       name: 'Infosys',                   when: 'After close', est: '₹16.9', rev: '₹39,300 cr' },
    { d: 3, sym: 'ICICIBANK',  name: 'ICICI Bank',                when: 'After close', est: '₹15.4', rev: '₹43,700 cr' },
    { d: 4, sym: 'MARUTI',     name: 'Maruti Suzuki India',       when: 'After close', est: '₹120.6', rev: '₹35,500 cr' }
  ];

  /* ------------------------------------------------------------------------ */
  window.IV_DATA = {
    UNIVERSE, CURVE, AUTHORS, COLUMNISTS, VIDEOS, PODCASTS, NEWSLETTERS,
    ECO_CALENDAR, EARNINGS,
    get ARTICLES() { return ARTICLES; },
    get WIRE() { return WIRE; },
    get isLive() { return liveMode; },

    /* live.js hands real headlines in here; every reader below picks them up. */
    setLiveArticles(items) {
      if (!items || !items.length) return false;
      ARTICLES = items.map(a => ({
        id: a.id,
        t: a.t,
        d: a.d || '',
        s: a.s || 'markets',
        a: null,
        src: a.src || 'Wire',
        url: a.url || null,
        image: a.image || null,        // real photo when the source supplied one
        sentiment: (typeof a.sentiment === 'number') ? a.sentiment : null,
        src2: a.enrichedBy || null,
        ts: a.ts || Date.now(),
        mins: Math.max(2, Math.round((a.d || '').split(/\s+/).length / 90) + 2),
        sym: a.sym || [],
        tags: [],
        p: false,
        live: true
      }));
      WIRE = ARTICLES.slice(0, 24).map(a => ({
        pr: /rbi|inflation|repo|gdp|fed|record|surge|plunge|crash/i.test(a.t) ? 1 : (a.sym.length ? 2 : 3),
        t: a.t.toUpperCase(), ts: a.ts, src: a.src, url: a.url
      }));
      liveMode = true;
      return true;
    },

    bySymbol(sym) { return UNIVERSE.find(u => u.sym === String(sym).toUpperCase()) || null; },
    byClass(cls) { return UNIVERSE.filter(u => u.cls === cls); },
    author(id) {
      return AUTHORS.find(a => a.id === id) || COLUMNISTS.find(c => c.id === id) ||
        { id: id || 'wire', name: 'Verdict Wire', role: 'Newsroom', bureau: 'Mumbai' };
    },
    article(id) { return ARTICLES.find(a => a.id === id) || null; },
    section(id) {
      return (window.IV_CONFIG.sections.find(s => s.id === id)) || { id, label: id, accent: '#ff7a00' };
    },
    articlesBySection(id) { return ARTICLES.filter(a => a.s === id).sort((x, y) => y.ts - x.ts); },
    articlesBySymbol(sym) { return ARTICLES.filter(a => (a.sym || []).includes(sym)).sort((x, y) => y.ts - x.ts); },
    latest(n) { return ARTICLES.slice().sort((x, y) => y.ts - x.ts).slice(0, n || 12); },
    mostRead(n) {
      return ARTICLES.slice()
        .map(a => ({ a, score: hash(a.id) % 1000 + (a.sym && a.sym.length ? 200 : 0) }))
        .sort((x, y) => y.score - x.score).slice(0, n || 6).map(x => x.a);
    },

    /* Live items carry only a headline and summary — the full text lives at the
       publisher, so article.html links out instead of inventing body copy. */
    body(a) {
      if (a.live) {
        return [a.d, `This story was published by ${a.src}. Open the original for the full report.`];
      }
      const au = this.author(a.a);
      const syms = (a.sym || []).map(s => (this.bySymbol(s) || {}).name).filter(Boolean);
      const subject = syms[0] || this.section(a.s).label.toLowerCase();
      const r = seeded(hash(a.id));
      return [
        a.d,
        `The move has been building for weeks, but it took this week's data for the market to treat it as a level rather than a drift. Desks that had been running the position as a hedge are now running it as a view.`,
        `"You can argue about the destination — nobody on this desk agrees about the destination," said one fund manager who asked not to be named discussing positioning. "What changed is the path."`,
        `For ${subject}, the second-order effect matters more than the headline. Hedging costs have risen roughly ${(8 + r() * 20).toFixed(0)}% since the start of the quarter.`,
        `Analysts at three of the largest domestic brokerages have revised targets in the past fortnight; the median revision was ${(2 + r() * 6).toFixed(1)}%.`,
        `${au.name} reported from ${au.bureau}. This is offline sample copy — the live newsroom feed replaces it when the data server is running.`
      ];
    },

    image(id, w, h) {
      const r = seeded(hash(String(id)));
      const hue = Math.floor(r() * 360);
      const hue2 = (hue + 40 + Math.floor(r() * 80)) % 360;
      const W = w || 1200, Hh = h || 800;
      let shapes = '';
      for (let i = 0; i < 7; i++) {
        const cx = r() * W, cy = r() * Hh, rr = (0.08 + r() * 0.3) * W;
        shapes += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rr.toFixed(0)}" fill="hsl(${(hue + i * 17) % 360} 62% ${28 + i * 5}%)" opacity="${(0.18 + r() * 0.4).toFixed(2)}"/>`;
      }
      for (let i = 0; i < 5; i++) {
        const x = r() * W, y = r() * Hh, ww = (0.1 + r() * 0.4) * W, hh = (0.02 + r() * 0.1) * Hh;
        shapes += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${ww.toFixed(0)}" height="${hh.toFixed(0)}" fill="hsl(${hue2} 70% ${40 + i * 6}%)" opacity="${(0.15 + r() * 0.35).toFixed(2)}"/>`;
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}">` +
        `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0" stop-color="hsl(${hue} 55% 22%)"/><stop offset="1" stop-color="hsl(${hue2} 60% 12%)"/>` +
        `</linearGradient></defs><rect width="${W}" height="${Hh}" fill="url(#g)"/>${shapes}</svg>`;
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }
  };

  function hash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < String(str).length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function seeded(seed) {
    let s = seed >>> 0 || 1;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  window.IV_RAND = { hash, seeded };
})();
