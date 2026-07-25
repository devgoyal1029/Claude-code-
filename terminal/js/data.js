/* =============================================================================
 * data.js — PLACEHOLDER content corpus.
 * Securities universe, newsroom output, people, media, calendars.
 * Nothing here is real. Swap for API responses via api.js.
 * ========================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------------------
   * Securities universe. `base` is the seed price the tick engine walks from,
   * `vol` is annualised volatility used by the simulator.
   * ------------------------------------------------------------------------ */
  const UNIVERSE = [
    // --- Indexes ---
    { sym: 'SPX',  name: 'S&P 500',                cls: 'index', region: 'Americas', base: 5312.44, vol: 0.14, ccy: 'USD' },
    { sym: 'INDU', name: 'Dow Jones Industrial',   cls: 'index', region: 'Americas', base: 39864.10, vol: 0.13, ccy: 'USD' },
    { sym: 'CCMP', name: 'Nasdaq Composite',       cls: 'index', region: 'Americas', base: 16781.22, vol: 0.19, ccy: 'USD' },
    { sym: 'RTY',  name: 'Russell 2000',           cls: 'index', region: 'Americas', base: 2094.66, vol: 0.21, ccy: 'USD' },
    { sym: 'SX5E', name: 'Euro Stoxx 50',          cls: 'index', region: 'EMEA',     base: 4988.31, vol: 0.16, ccy: 'EUR' },
    { sym: 'UKX',  name: 'FTSE 100',               cls: 'index', region: 'EMEA',     base: 8214.05, vol: 0.13, ccy: 'GBP' },
    { sym: 'DAX',  name: 'DAX',                    cls: 'index', region: 'EMEA',     base: 18492.77, vol: 0.17, ccy: 'EUR' },
    { sym: 'NKY',  name: 'Nikkei 225',             cls: 'index', region: 'APAC',     base: 38104.60, vol: 0.20, ccy: 'JPY' },
    { sym: 'HSI',  name: 'Hang Seng',              cls: 'index', region: 'APAC',     base: 18320.15, vol: 0.24, ccy: 'HKD' },
    { sym: 'SHCOMP', name: 'Shanghai Composite',   cls: 'index', region: 'APAC',     base: 3104.82, vol: 0.18, ccy: 'CNY' },
    { sym: 'VIX',  name: 'CBOE Volatility Index',  cls: 'index', region: 'Americas', base: 14.62, vol: 0.85, ccy: 'USD' },

    // --- Equities ---
    { sym: 'AAPL', name: 'Apple Inc',              cls: 'equity', sector: 'Technology',  base: 214.29, vol: 0.24, ccy: 'USD', mcap: 3.29e12, exch: 'NASDAQ GS', emp: 161000, hq: 'Cupertino, California' },
    { sym: 'MSFT', name: 'Microsoft Corp',         cls: 'equity', sector: 'Technology',  base: 441.58, vol: 0.22, ccy: 'USD', mcap: 3.28e12, exch: 'NASDAQ GS', emp: 221000, hq: 'Redmond, Washington' },
    { sym: 'NVDA', name: 'NVIDIA Corp',            cls: 'equity', sector: 'Technology',  base: 126.40, vol: 0.48, ccy: 'USD', mcap: 3.11e12, exch: 'NASDAQ GS', emp: 29600, hq: 'Santa Clara, California' },
    { sym: 'AMZN', name: 'Amazon.com Inc',         cls: 'equity', sector: 'Consumer',    base: 186.33, vol: 0.28, ccy: 'USD', mcap: 1.94e12, exch: 'NASDAQ GS', emp: 1525000, hq: 'Seattle, Washington' },
    { sym: 'GOOGL', name: 'Alphabet Inc',          cls: 'equity', sector: 'Technology',  base: 178.72, vol: 0.26, ccy: 'USD', mcap: 2.21e12, exch: 'NASDAQ GS', emp: 181269, hq: 'Mountain View, California' },
    { sym: 'META', name: 'Meta Platforms Inc',     cls: 'equity', sector: 'Technology',  base: 504.11, vol: 0.33, ccy: 'USD', mcap: 1.28e12, exch: 'NASDAQ GS', emp: 70799, hq: 'Menlo Park, California' },
    { sym: 'TSLA', name: 'Tesla Inc',              cls: 'equity', sector: 'Consumer',    base: 183.02, vol: 0.52, ccy: 'USD', mcap: 5.83e11, exch: 'NASDAQ GS', emp: 140473, hq: 'Austin, Texas' },
    { sym: 'BRK/B', name: 'Berkshire Hathaway',    cls: 'equity', sector: 'Financials',  base: 411.90, vol: 0.15, ccy: 'USD', mcap: 8.88e11, exch: 'NYSE', emp: 396500, hq: 'Omaha, Nebraska' },
    { sym: 'JPM',  name: 'JPMorgan Chase & Co',    cls: 'equity', sector: 'Financials',  base: 203.14, vol: 0.21, ccy: 'USD', mcap: 5.84e11, exch: 'NYSE', emp: 313206, hq: 'New York, New York' },
    { sym: 'GS',   name: 'Goldman Sachs Group',    cls: 'equity', sector: 'Financials',  base: 456.83, vol: 0.24, ccy: 'USD', mcap: 1.49e11, exch: 'NYSE', emp: 45300, hq: 'New York, New York' },
    { sym: 'XOM',  name: 'Exxon Mobil Corp',       cls: 'equity', sector: 'Energy',      base: 114.06, vol: 0.25, ccy: 'USD', mcap: 4.51e11, exch: 'NYSE', emp: 61500, hq: 'Spring, Texas' },
    { sym: 'CVX',  name: 'Chevron Corp',           cls: 'equity', sector: 'Energy',      base: 156.22, vol: 0.24, ccy: 'USD', mcap: 2.90e11, exch: 'NYSE', emp: 45600, hq: 'San Ramon, California' },
    { sym: 'UNH',  name: 'UnitedHealth Group',     cls: 'equity', sector: 'Health Care', base: 489.55, vol: 0.23, ccy: 'USD', mcap: 4.51e11, exch: 'NYSE', emp: 440000, hq: 'Minnetonka, Minnesota' },
    { sym: 'LLY',  name: 'Eli Lilly & Co',         cls: 'equity', sector: 'Health Care', base: 878.44, vol: 0.30, ccy: 'USD', mcap: 8.35e11, exch: 'NYSE', emp: 43000, hq: 'Indianapolis, Indiana' },
    { sym: 'WMT',  name: 'Walmart Inc',            cls: 'equity', sector: 'Consumer',    base: 67.28, vol: 0.18, ccy: 'USD', mcap: 5.41e11, exch: 'NYSE', emp: 2100000, hq: 'Bentonville, Arkansas' },
    { sym: 'COST', name: 'Costco Wholesale',       cls: 'equity', sector: 'Consumer',    base: 842.10, vol: 0.20, ccy: 'USD', mcap: 3.73e11, exch: 'NASDAQ GS', emp: 316000, hq: 'Issaquah, Washington' },
    { sym: 'BA',   name: 'Boeing Co',              cls: 'equity', sector: 'Industrials', base: 178.44, vol: 0.38, ccy: 'USD', mcap: 1.09e11, exch: 'NYSE', emp: 171000, hq: 'Arlington, Virginia' },
    { sym: 'CAT',  name: 'Caterpillar Inc',        cls: 'equity', sector: 'Industrials', base: 334.19, vol: 0.26, ccy: 'USD', mcap: 1.62e11, exch: 'NYSE', emp: 113200, hq: 'Irving, Texas' },
    { sym: 'AMD',  name: 'Advanced Micro Devices', cls: 'equity', sector: 'Technology',  base: 158.36, vol: 0.45, ccy: 'USD', mcap: 2.56e11, exch: 'NASDAQ GS', emp: 26000, hq: 'Santa Clara, California' },
    { sym: 'INTC', name: 'Intel Corp',             cls: 'equity', sector: 'Technology',  base: 30.84, vol: 0.40, ccy: 'USD', mcap: 1.31e11, exch: 'NASDAQ GS', emp: 124800, hq: 'Santa Clara, California' },
    { sym: 'NFLX', name: 'Netflix Inc',            cls: 'equity', sector: 'Communications', base: 676.32, vol: 0.34, ccy: 'USD', mcap: 2.91e11, exch: 'NASDAQ GS', emp: 13000, hq: 'Los Gatos, California' },
    { sym: 'DIS',  name: 'Walt Disney Co',         cls: 'equity', sector: 'Communications', base: 98.71, vol: 0.29, ccy: 'USD', mcap: 1.80e11, exch: 'NYSE', emp: 225000, hq: 'Burbank, California' },
    { sym: 'PFE',  name: 'Pfizer Inc',             cls: 'equity', sector: 'Health Care', base: 28.19, vol: 0.27, ccy: 'USD', mcap: 1.60e11, exch: 'NYSE', emp: 88000, hq: 'New York, New York' },
    { sym: 'KO',   name: 'Coca-Cola Co',           cls: 'equity', sector: 'Consumer',    base: 63.44, vol: 0.15, ccy: 'USD', mcap: 2.73e11, exch: 'NYSE', emp: 79100, hq: 'Atlanta, Georgia' },
    { sym: 'SHEL', name: 'Shell Plc',              cls: 'equity', sector: 'Energy',      base: 2841.50, vol: 0.23, ccy: 'GBp', mcap: 1.82e11, exch: 'London', emp: 103000, hq: 'London, United Kingdom' },
    { sym: 'SAP',  name: 'SAP SE',                 cls: 'equity', sector: 'Technology',  base: 182.36, vol: 0.24, ccy: 'EUR', mcap: 2.24e11, exch: 'Xetra', emp: 107602, hq: 'Walldorf, Germany' },
    { sym: '7203', name: 'Toyota Motor Corp',      cls: 'equity', sector: 'Consumer',    base: 3184.00, vol: 0.25, ccy: 'JPY', mcap: 3.10e11, exch: 'Tokyo', emp: 380793, hq: 'Toyota City, Japan' },
    { sym: '005930', name: 'Samsung Electronics',  cls: 'equity', sector: 'Technology',  base: 81400.00, vol: 0.28, ccy: 'KRW', mcap: 3.60e11, exch: 'Korea', emp: 267937, hq: 'Suwon, South Korea' },

    // --- FX ---
    { sym: 'EURUSD', name: 'Euro / US Dollar',       cls: 'fx', base: 1.0864, vol: 0.07, ccy: 'USD' },
    { sym: 'USDJPY', name: 'US Dollar / Yen',        cls: 'fx', base: 157.32, vol: 0.09, ccy: 'JPY' },
    { sym: 'GBPUSD', name: 'Sterling / US Dollar',   cls: 'fx', base: 1.2712, vol: 0.08, ccy: 'USD' },
    { sym: 'USDCHF', name: 'US Dollar / Franc',      cls: 'fx', base: 0.8934, vol: 0.07, ccy: 'CHF' },
    { sym: 'AUDUSD', name: 'Aussie / US Dollar',     cls: 'fx', base: 0.6648, vol: 0.10, ccy: 'USD' },
    { sym: 'USDCNY', name: 'US Dollar / Yuan',       cls: 'fx', base: 7.2514, vol: 0.04, ccy: 'CNY' },
    { sym: 'USDINR', name: 'US Dollar / Rupee',      cls: 'fx', base: 83.482, vol: 0.05, ccy: 'INR' },
    { sym: 'DXY',    name: 'Dollar Spot Index',      cls: 'fx', base: 105.24, vol: 0.06, ccy: 'USD' },

    // --- Commodities ---
    { sym: 'CL1',  name: 'WTI Crude Oil',      cls: 'commodity', unit: 'USD/bbl',  base: 78.41, vol: 0.34, ccy: 'USD' },
    { sym: 'CO1',  name: 'Brent Crude',        cls: 'commodity', unit: 'USD/bbl',  base: 82.66, vol: 0.32, ccy: 'USD' },
    { sym: 'NG1',  name: 'Natural Gas',        cls: 'commodity', unit: 'USD/MMBtu', base: 2.734, vol: 0.62, ccy: 'USD' },
    { sym: 'GC1',  name: 'Gold',               cls: 'commodity', unit: 'USD/t oz', base: 2331.10, vol: 0.15, ccy: 'USD' },
    { sym: 'SI1',  name: 'Silver',             cls: 'commodity', unit: 'USD/t oz', base: 29.84, vol: 0.28, ccy: 'USD' },
    { sym: 'HG1',  name: 'Copper',             cls: 'commodity', unit: 'USD/lb',   base: 4.512, vol: 0.24, ccy: 'USD' },
    { sym: 'W1',   name: 'Wheat',              cls: 'commodity', unit: 'USd/bu',   base: 612.25, vol: 0.30, ccy: 'USD' },

    // --- Rates ---
    { sym: 'US2Y', name: 'US 2 Year Yield',   cls: 'rate', base: 4.742, vol: 0.16, ccy: 'USD' },
    { sym: 'US5Y', name: 'US 5 Year Yield',   cls: 'rate', base: 4.401, vol: 0.15, ccy: 'USD' },
    { sym: 'US10Y', name: 'US 10 Year Yield', cls: 'rate', base: 4.286, vol: 0.14, ccy: 'USD' },
    { sym: 'US30Y', name: 'US 30 Year Yield', cls: 'rate', base: 4.427, vol: 0.13, ccy: 'USD' },
    { sym: 'DE10Y', name: 'German Bund 10Y',  cls: 'rate', base: 2.518, vol: 0.15, ccy: 'EUR' },
    { sym: 'GB10Y', name: 'UK Gilt 10Y',      cls: 'rate', base: 4.128, vol: 0.15, ccy: 'GBP' },
    { sym: 'JP10Y', name: 'Japan JGB 10Y',    cls: 'rate', base: 1.024, vol: 0.22, ccy: 'JPY' },

    // --- Crypto ---
    { sym: 'BTC',  name: 'Bitcoin',      cls: 'crypto', base: 64312.00, vol: 0.55, ccy: 'USD' },
    { sym: 'ETH',  name: 'Ether',        cls: 'crypto', base: 3428.60, vol: 0.62, ccy: 'USD' },
    { sym: 'SOL',  name: 'Solana',       cls: 'crypto', base: 143.28, vol: 0.86, ccy: 'USD' },
    { sym: 'XRP',  name: 'XRP',          cls: 'crypto', base: 0.4914, vol: 0.78, ccy: 'USD' },
    { sym: 'DOGE', name: 'Dogecoin',     cls: 'crypto', base: 0.1284, vol: 0.95, ccy: 'USD' }
  ];

  /* Yield-curve tenors for the RATE monitor. */
  const CURVE = [
    { t: '1M', y: 5.382 }, { t: '3M', y: 5.351 }, { t: '6M', y: 5.204 },
    { t: '1Y', y: 4.988 }, { t: '2Y', y: 4.742 }, { t: '3Y', y: 4.552 },
    { t: '5Y', y: 4.401 }, { t: '7Y', y: 4.348 }, { t: '10Y', y: 4.286 },
    { t: '20Y', y: 4.581 }, { t: '30Y', y: 4.427 }
  ];

  const AUTHORS = [
    { id: 'jrivera',  name: 'Jordan Rivera',   role: 'Chief Markets Correspondent', bureau: 'New York' },
    { id: 'aokafor',  name: 'Amara Okafor',    role: 'Senior Editor, Technology',   bureau: 'San Francisco' },
    { id: 'lhaddad',  name: 'Leila Haddad',    role: 'Economics Correspondent',     bureau: 'Washington' },
    { id: 'tmoreau',  name: 'Theo Moreau',     role: 'Energy & Commodities',        bureau: 'London' },
    { id: 'skapoor',  name: 'Sana Kapoor',     role: 'Asia Markets',                bureau: 'Singapore' },
    { id: 'dvolkov',  name: 'Dmitri Volkov',   role: 'Rates & Credit',              bureau: 'London' },
    { id: 'mchen',    name: 'Mira Chen',       role: 'Digital Assets',              bureau: 'Hong Kong' },
    { id: 'rbianchi', name: 'Renata Bianchi',  role: 'Wealth',                      bureau: 'Zurich' }
  ];

  const COLUMNISTS = [
    { id: 'cwoods',  name: 'Cassian Woods',  beat: 'Central banks and the cost of money' },
    { id: 'nasante', name: 'Nia Asante',     beat: 'Technology, antitrust and platform power' },
    { id: 'pberger', name: 'Paul Berger',    beat: 'Deals, boards and the corner office' },
    { id: 'iyusuf',  name: 'Imran Yusuf',    beat: 'Energy transition economics' },
    { id: 'hlindqv', name: 'Hanna Lindqvist', beat: 'Labour markets and inequality' }
  ];

  const H = 3600e3, M = 60e3;
  const now = Date.now();

  /* ---------------------------------------------------------------------------
   * Newsroom output. `p` = premium (paywalled). `sym` = tagged securities.
   * ------------------------------------------------------------------------ */
  const ARTICLES = [
    { id: 'a01', s: 'markets', p: true, t: 'Traders Unwind Rate-Cut Bets as Services Inflation Refuses to Cool',
      d: 'Swaps now price fewer than two reductions this year, a reversal from the four priced in January, with the front end bearing the brunt of the repricing.',
      a: 'jrivera', ts: now - 22 * M, mins: 5, sym: ['US2Y', 'US10Y', 'SPX', 'DXY'], tags: ['Rates', 'Inflation', 'Federal Reserve'] },
    { id: 'a02', s: 'technology', p: true, t: 'The AI Capex Supercycle Is Now a Balance-Sheet Story',
      d: 'Four hyperscalers will spend more on data centres this year than the entire US shale industry spent at the peak of the boom. Investors are starting to ask who funds the next leg.',
      a: 'aokafor', ts: now - 51 * M, mins: 8, sym: ['NVDA', 'MSFT', 'GOOGL', 'AMD'], tags: ['AI', 'Semiconductors', 'Capex'] },
    { id: 'a03', s: 'markets', p: false, t: 'Stocks Grind Higher as Megacap Breadth Narrows to a Handful of Names',
      d: 'The equal-weight benchmark has lagged the cap-weighted index by the widest margin since 1999.',
      a: 'jrivera', ts: now - 8 * M, mins: 4, sym: ['SPX', 'CCMP', 'RTY'], tags: ['Equities', 'Breadth'] },
    { id: 'a04', s: 'economics', p: true, t: 'Payrolls Beat Masks a Quiet Deterioration in Hours Worked',
      d: 'Headline job growth held up, but the average work week slipped to the lowest since 2010 outside the pandemic — historically an early warning.',
      a: 'lhaddad', ts: now - 2 * H, mins: 6, sym: ['US2Y', 'SPX'], tags: ['Jobs', 'Recession Watch'] },
    { id: 'a05', s: 'crypto', p: false, t: 'Bitcoin ETFs Absorb Record Weekly Inflow as Basis Trade Widens',
      d: 'Annualised carry on the CME basis is back above 14%, pulling in hedge funds that had stepped away in the spring.',
      a: 'mchen', ts: now - 36 * M, mins: 5, sym: ['BTC', 'ETH'], tags: ['ETFs', 'Digital Assets'] },
    { id: 'a06', s: 'markets', p: true, t: 'Oil Bulls Are Betting Against the Biggest Spare Capacity Buffer in Years',
      d: 'OPEC+ is sitting on roughly 5.6 million barrels a day of idle supply. Positioning says traders have decided that no longer caps the market.',
      a: 'tmoreau', ts: now - 3 * H, mins: 7, sym: ['CL1', 'CO1', 'XOM', 'CVX'], tags: ['Oil', 'OPEC'] },
    { id: 'a07', s: 'technology', p: false, t: 'Chip Equipment Orders Signal a 2027 Capacity Wall',
      d: 'Lead times on advanced packaging tools have stretched past 14 months, throttling the ramp everyone has modelled as linear.',
      a: 'aokafor', ts: now - 4 * H, mins: 6, sym: ['NVDA', 'AMD', 'INTC'], tags: ['Semiconductors', 'Supply Chain'] },
    { id: 'a08', s: 'politics', p: true, t: 'Tariff Rewrite Lands on Boards Already Rebuilding Their Supply Maps',
      d: 'Executives describe a second wave of near-shoring decisions, this time driven by rules of origin rather than headline duty rates.',
      a: 'lhaddad', ts: now - 5 * H, mins: 7, sym: ['CAT', 'BA', 'WMT'], tags: ['Trade', 'Tariffs'] },
    { id: 'a09', s: 'wealth', p: true, t: 'Family Offices Are Quietly Rotating Out of Private Credit',
      d: 'After three years of record allocations, the biggest single-family pools are trimming, citing covenant erosion and marks that have not moved.',
      a: 'rbianchi', ts: now - 6 * H, mins: 6, sym: ['JPM', 'GS'], tags: ['Private Credit', 'Allocation'] },
    { id: 'a10', s: 'green', p: false, t: 'Grid Interconnection Queues Are Now the Binding Constraint on Renewables',
      d: 'More than 2,300 gigawatts of capacity sits in study limbo — roughly double the installed base of the entire US power system.',
      a: 'tmoreau', ts: now - 7 * H, mins: 8, sym: ['NG1'], tags: ['Energy Transition', 'Utilities'] },
    { id: 'a11', s: 'markets', p: false, t: 'Yen Slides Through 158 as Policy Divergence Reasserts Itself',
      d: 'Intervention chatter returned, but carry economics still favour the short side while the front-end spread stays above 400 basis points.',
      a: 'skapoor', ts: now - 1.4 * H, mins: 4, sym: ['USDJPY', 'JP10Y', 'NKY'], tags: ['FX', 'Bank of Japan'] },
    { id: 'a12', s: 'technology', p: true, t: 'Enterprise Software Is Repricing Seats Into Consumption',
      d: 'The shift breaks the comparability of net revenue retention, the metric the whole sector is valued on.',
      a: 'aokafor', ts: now - 9 * H, mins: 6, sym: ['MSFT', 'SAP'], tags: ['Software', 'SaaS'] },
    { id: 'a13', s: 'opinion', p: false, t: 'The Fed Does Not Have an Inflation Problem. It Has a Credibility Problem.',
      d: 'Every forecast miss since 2021 has been in the same direction, and markets have started to price the bias rather than the projection.',
      a: 'cwoods', ts: now - 3.5 * H, mins: 5, sym: ['US10Y'], tags: ['Opinion', 'Federal Reserve'], col: 'cwoods' },
    { id: 'a14', s: 'opinion', p: false, t: 'Break Up the Cloud? Start by Unbundling the Egress Fee.',
      d: 'The cheapest pro-competition remedy available to regulators is also the one nobody is arguing about.',
      a: 'nasante', ts: now - 11 * H, mins: 5, sym: ['AMZN', 'MSFT', 'GOOGL'], tags: ['Opinion', 'Antitrust'], col: 'nasante' },
    { id: 'a15', s: 'markets', p: true, t: 'Credit Spreads Are Pricing a Soft Landing That Equity Vol Does Not Believe',
      d: 'High-yield sits 40 basis points inside its post-2008 median while the VIX term structure keeps steepening.',
      a: 'dvolkov', ts: now - 1.1 * H, mins: 6, sym: ['VIX', 'SPX'], tags: ['Credit', 'Volatility'] },
    { id: 'a16', s: 'pursuits', p: false, t: 'The Quiet Return of the Three-Hour Lunch, Priced at $480 a Head',
      d: 'Restaurant groups are rebuilding around fewer, longer, far more expensive covers.',
      a: 'rbianchi', ts: now - 13 * H, mins: 4, sym: [], tags: ['Dining', 'Luxury'] },
    { id: 'a17', s: 'cities', p: false, t: 'Office Conversions Pencil Out in Exactly Four Metros',
      d: 'Floor plates, plumbing risers and land values conspire against the policy everyone wants to work.',
      a: 'lhaddad', ts: now - 15 * H, mins: 7, sym: [], tags: ['Real Estate', 'Urban Policy'] },
    { id: 'a18', s: 'markets', p: false, t: 'Copper Backwardation Deepens as Smelter Fees Collapse',
      d: 'Treatment charges have gone negative, a signal the concentrate market has not sent since 2013.',
      a: 'tmoreau', ts: now - 2.6 * H, mins: 5, sym: ['HG1'], tags: ['Metals', 'Supply'] },
    { id: 'a19', s: 'technology', p: false, t: 'Apple Suppliers Flag a Longer-Than-Usual Summer Build Window',
      d: 'Component orders point to a staggered ramp rather than the compressed one the street has modelled.',
      a: 'skapoor', ts: now - 46 * M, mins: 4, sym: ['AAPL', '005930'], tags: ['Hardware', 'Supply Chain'] },
    { id: 'a20', s: 'wealth', p: true, t: 'The 60/40 Is Fine. The Rebalancing Rule Is What Broke.',
      d: 'Calendar rebalancing into a trending bond drawdown did most of the damage investors blamed on correlation.',
      a: 'rbianchi', ts: now - 19 * H, mins: 6, sym: ['SPX', 'US10Y'], tags: ['Portfolio', 'Asset Allocation'] },
    { id: 'a21', s: 'politics', p: false, t: 'Antitrust Case Enters Remedy Phase With Structural Options on the Table',
      d: 'Court filings suggest divestiture is being modelled seriously for the first time in two decades.',
      a: 'lhaddad', ts: now - 21 * H, mins: 6, sym: ['GOOGL', 'META'], tags: ['Antitrust', 'Regulation'] },
    { id: 'a22', s: 'economics', p: true, t: 'China Credit Impulse Turns Positive, but the Money Is Not Reaching Households',
      d: 'Aggregate financing beat expectations on local-government issuance while household borrowing shrank for a fourth month.',
      a: 'skapoor', ts: now - 26 * H, mins: 7, sym: ['SHCOMP', 'USDCNY', 'HG1'], tags: ['China', 'Credit'] },
    { id: 'a23', s: 'crypto', p: true, t: 'Stablecoin Float Tops a Record, Making Issuers a Top-20 Treasury Holder',
      d: 'The bill portfolio behind the two largest tokens now rivals mid-sized sovereign reserve managers.',
      a: 'mchen', ts: now - 29 * H, mins: 5, sym: ['BTC', 'US2Y'], tags: ['Stablecoins', 'Treasuries'] },
    { id: 'a24', s: 'markets', p: false, t: 'European Banks Trade at Book for the First Time Since 2018',
      d: 'Buybacks, not net interest margin, have done the heavy lifting in the rerating.',
      a: 'dvolkov', ts: now - 31 * H, mins: 5, sym: ['SX5E', 'DAX'], tags: ['Banks', 'Europe'] },
    { id: 'a25', s: 'green', p: true, t: 'Carbon Border Levy Starts Repricing Steel Contracts a Year Early',
      d: 'Buyers are writing pass-through clauses now rather than waiting for the definitive regime.',
      a: 'tmoreau', ts: now - 34 * H, mins: 6, sym: ['CAT'], tags: ['Carbon', 'Industry'] },
    { id: 'a26', s: 'opinion', p: false, t: 'Boards Keep Confusing a Buyback With a Strategy',
      d: 'Return of capital is an outcome. It has quietly become the plan.',
      a: 'pberger', ts: now - 38 * H, mins: 4, sym: ['AAPL', 'XOM'], tags: ['Opinion', 'Governance'], col: 'pberger' },
    { id: 'a27', s: 'technology', p: false, t: 'Inference Costs Fall 40% Again, and the Business Model Shifts With Them',
      d: 'When the marginal token gets cheap enough, the moat moves from the model to the distribution.',
      a: 'aokafor', ts: now - 1.8 * H, mins: 5, sym: ['NVDA', 'MSFT'], tags: ['AI', 'Cloud'] },
    { id: 'a28', s: 'wealth', p: false, t: 'Private Jet Charter Prices Fall for a Third Quarter',
      d: 'Fractional operators are discounting into the softest demand since 2020.',
      a: 'rbianchi', ts: now - 42 * H, mins: 3, sym: [], tags: ['Luxury'] },
    { id: 'a29', s: 'economics', p: false, t: 'Euro-Area Wage Tracker Cools Faster Than the ECB Forecast',
      d: 'Negotiated pay growth slowed to 3.4%, opening the door to a second cut without a projection revision.',
      a: 'dvolkov', ts: now - 55 * M, mins: 4, sym: ['DE10Y', 'EURUSD', 'SX5E'], tags: ['ECB', 'Wages'] },
    { id: 'a30', s: 'markets', p: false, t: 'Buyback Blackout Lifts Into the Strongest Seasonal Bid of the Quarter',
      d: 'Corporates have authorised a record programme; execution windows reopen this week.',
      a: 'jrivera', ts: now - 3.1 * H, mins: 4, sym: ['SPX', 'AAPL'], tags: ['Flows', 'Buybacks'] },
    { id: 'a31', s: 'politics', p: false, t: 'Election Hedges Are the Most Crowded Trade in Options Markets',
      d: 'Skew on November expiries has decoupled from realised volatility by the widest margin on record.',
      a: 'jrivera', ts: now - 47 * H, mins: 5, sym: ['VIX', 'SPX'], tags: ['Elections', 'Options'] },
    { id: 'a32', s: 'pursuits', p: false, t: 'The Watch Market Found Its Floor. Then It Kept Sitting There.',
      d: 'Secondary prices have been flat for eleven months, which is its own kind of verdict.',
      a: 'rbianchi', ts: now - 50 * H, mins: 4, sym: [], tags: ['Collectibles'] },
    { id: 'a33', s: 'cities', p: true, t: 'Transit Agencies Are Budgeting for a Ridership Level That Is Not Coming Back',
      d: 'Fare-box recovery assumptions still sit near 2019 in a third of major systems.',
      a: 'lhaddad', ts: now - 58 * H, mins: 6, sym: [], tags: ['Transit', 'Budgets'] },
    { id: 'a34', s: 'crypto', p: false, t: 'Solana Fee Revenue Overtakes Ether for a Second Straight Month',
      d: 'Activity is real. Whether it is durable is the argument the market has not settled.',
      a: 'mchen', ts: now - 62 * H, mins: 4, sym: ['SOL', 'ETH'], tags: ['Blockchains'] },
    { id: 'a35', s: 'green', p: false, t: 'Battery Cell Prices Break Below $60/kWh at the Pack Level',
      d: 'The threshold most transition models put in 2030 arrived roughly five years early.',
      a: 'tmoreau', ts: now - 66 * H, mins: 5, sym: ['TSLA', 'HG1'], tags: ['Batteries', 'EVs'] },
    { id: 'a36', s: 'opinion', p: false, t: 'Full Employment Is Not a Number. It Is a Distribution.',
      d: 'The aggregate rate has been stable for two years while its composition has churned completely.',
      a: 'hlindqv', ts: now - 70 * H, mins: 5, sym: [], tags: ['Opinion', 'Labour'], col: 'hlindqv' }
  ];

  /* Fast-moving headline wire (terminal TOP function + site rail). */
  const WIRE = [
    { pr: 1, t: 'FED\'S CHAIR: POLICY IS "SUFFICIENTLY RESTRICTIVE" FOR NOW', ts: now - 3 * M, src: 'VN' },
    { pr: 1, t: '*US 10-YEAR YIELD RISES 4BPS TO 4.29%', ts: now - 6 * M, src: 'VN' },
    { pr: 2, t: 'NVIDIA SAID TO ALLOCATE ADDITIONAL HBM SUPPLY FOR Q4 RAMP', ts: now - 11 * M, src: 'VN' },
    { pr: 2, t: 'EURO-AREA NEGOTIATED WAGES RISE 3.4% Y/Y; EST. 3.9%', ts: now - 14 * M, src: 'VN' },
    { pr: 3, t: 'OPEC+ PANEL SEES NO NEED TO CHANGE OUTPUT PLAN', ts: now - 19 * M, src: 'VN' },
    { pr: 1, t: '*BOJ OFFICIAL SAYS FX MOVES BEING WATCHED "WITH HIGH URGENCY"', ts: now - 24 * M, src: 'VN' },
    { pr: 3, t: 'APPLE SUPPLIER FLAGS EXTENDED SUMMER BUILD WINDOW', ts: now - 31 * M, src: 'VN' },
    { pr: 2, t: 'US HIGH-GRADE ISSUANCE TOPS $38B FOR THE WEEK', ts: now - 38 * M, src: 'VN' },
    { pr: 3, t: 'GOLD HOLDS GAIN AS REAL YIELDS SLIP FROM SESSION HIGH', ts: now - 44 * M, src: 'VN' },
    { pr: 2, t: 'CHINA AGGREGATE FINANCING BEATS ON LOCAL BOND ISSUANCE', ts: now - 52 * M, src: 'VN' },
    { pr: 1, t: '*ECB\'S GOVERNING COUNCIL MEMBER: JUNE CUT NOT A COMMITMENT', ts: now - 61 * M, src: 'VN' },
    { pr: 3, t: 'BITCOIN ETFS POST RECORD WEEKLY NET INFLOW', ts: now - 68 * M, src: 'VN' },
    { pr: 2, t: 'BOEING DELIVERIES TRAIL PLAN FOR A FOURTH MONTH', ts: now - 74 * M, src: 'VN' },
    { pr: 3, t: 'COPPER TREATMENT CHARGES TURN NEGATIVE AT SPOT', ts: now - 81 * M, src: 'VN' },
    { pr: 2, t: 'US 30-YEAR AUCTION TAILS 1.2BPS; BID-TO-COVER 2.34', ts: now - 92 * M, src: 'VN' }
  ];

  const VIDEOS = [
    { id: 'v1', t: 'The Open: Rate Cuts Repriced Again', dur: '12:04', show: 'The Open', ts: now - 40 * M, sym: ['SPX'] },
    { id: 'v2', t: 'Surveillance: What Breadth Is Telling Us', dur: '08:31', show: 'Surveillance', ts: now - 2 * H, sym: ['CCMP'] },
    { id: 'v3', t: 'Commodity Edge: Inside the Copper Squeeze', dur: '06:12', show: 'Commodity Edge', ts: now - 5 * H, sym: ['HG1'] },
    { id: 'v4', t: 'Asia Trade: Yen at 158 and What Comes Next', dur: '10:47', show: 'Asia Trade', ts: now - 9 * H, sym: ['USDJPY'] },
    { id: 'v5', t: 'Tech Check: The Capex Question Nobody Answers', dur: '14:20', show: 'Tech Check', ts: now - 13 * H, sym: ['NVDA'] },
    { id: 'v6', t: 'The Close: Buyback Window Reopens', dur: '09:55', show: 'The Close', ts: now - 20 * H, sym: ['SPX'] }
  ];

  const PODCASTS = [
    { id: 'p1', t: 'Odd Numbers: The Private Credit Mark Problem', show: 'Odd Numbers', dur: '38 min', ts: now - 4 * H },
    { id: 'p2', t: 'The Tape: Narrow Markets, Wide Consequences', show: 'The Tape', dur: '26 min', ts: now - 27 * H },
    { id: 'p3', t: 'Foreign Exchange: Intervention Season', show: 'Foreign Exchange', dur: '31 min', ts: now - 51 * H },
    { id: 'p4', t: 'Power Bill: Who Pays for the Grid', show: 'Power Bill', dur: '44 min', ts: now - 74 * H }
  ];

  const NEWSLETTERS = [
    { id: 'n1', t: 'Five Things', d: 'The stories moving markets, in your inbox before the open.', cad: 'Weekday mornings' },
    { id: 'n2', t: 'The Close', d: 'What happened, what it meant, what to watch tomorrow.', cad: 'Weekday evenings' },
    { id: 'n3', t: 'Money Stuff', d: 'A discursive tour of finance, deals and market plumbing.', cad: 'Tue / Thu' },
    { id: 'n4', t: 'Green Daily', d: 'The economics of the energy transition.', cad: 'Weekdays' },
    { id: 'n5', t: 'Crypto Brief', d: 'Flows, plumbing and regulation in digital assets.', cad: 'Mon / Wed / Fri' }
  ];

  const ECO_CALENDAR = [
    { d: 0, time: '08:30', ctry: 'US', ev: 'CPI MoM', per: 'May', est: '0.2%', prev: '0.3%', imp: 3 },
    { d: 0, time: '10:00', ctry: 'US', ev: 'Wholesale Inventories', per: 'Apr', est: '0.1%', prev: '-0.2%', imp: 1 },
    { d: 0, time: '14:00', ctry: 'US', ev: 'FOMC Rate Decision', per: '', est: '5.50%', prev: '5.50%', imp: 3 },
    { d: 1, time: '02:00', ctry: 'UK', ev: 'GDP MoM', per: 'Apr', est: '0.1%', prev: '0.4%', imp: 2 },
    { d: 1, time: '08:30', ctry: 'US', ev: 'Initial Jobless Claims', per: 'Weekly', est: '221k', prev: '229k', imp: 2 },
    { d: 1, time: '08:15', ctry: 'EU', ev: 'ECB Deposit Rate', per: '', est: '3.75%', prev: '4.00%', imp: 3 },
    { d: 2, time: '08:30', ctry: 'US', ev: 'PPI Final Demand', per: 'May', est: '0.1%', prev: '0.5%', imp: 2 },
    { d: 2, time: '10:00', ctry: 'US', ev: 'U. of Mich. Sentiment', per: 'Jun P', est: '72.0', prev: '69.1', imp: 2 },
    { d: 3, time: '19:50', ctry: 'JP', ev: 'BOJ Policy Balance Rate', per: '', est: '0.10%', prev: '0.10%', imp: 3 },
    { d: 4, time: '04:00', ctry: 'CN', ev: 'Industrial Production YoY', per: 'May', est: '6.2%', prev: '6.7%', imp: 2 }
  ];

  const EARNINGS = [
    { d: 0, sym: 'ORCL', name: 'Oracle Corp', when: 'After close', est: '1.65', rev: '14.6B' },
    { d: 0, sym: 'ADBE', name: 'Adobe Inc', when: 'After close', est: '4.39', rev: '5.29B' },
    { d: 1, sym: 'COST', name: 'Costco Wholesale', when: 'After close', est: '3.70', rev: '58.1B' },
    { d: 2, sym: 'FDX', name: 'FedEx Corp', when: 'After close', est: '5.34', rev: '22.1B' },
    { d: 3, sym: 'MU', name: 'Micron Technology', when: 'After close', est: '1.24', rev: '6.66B' },
    { d: 4, sym: 'NKE', name: 'Nike Inc', when: 'After close', est: '0.84', rev: '12.9B' }
  ];

  const MOVERS_NOTE = 'Movers are computed live from the simulated tape.';

  window.IV_DATA = {
    UNIVERSE, CURVE, AUTHORS, COLUMNISTS, ARTICLES, WIRE,
    VIDEOS, PODCASTS, NEWSLETTERS, ECO_CALENDAR, EARNINGS, MOVERS_NOTE,

    bySymbol(sym) {
      return UNIVERSE.find(u => u.sym === String(sym).toUpperCase()) || null;
    },
    byClass(cls) {
      return UNIVERSE.filter(u => u.cls === cls);
    },
    author(id) {
      return AUTHORS.find(a => a.id === id) || COLUMNISTS.find(c => c.id === id) ||
        { id, name: 'Verdict News', role: 'Staff', bureau: '' };
    },
    article(id) {
      return ARTICLES.find(a => a.id === id) || null;
    },
    section(id) {
      return (window.IV_CONFIG.sections.find(s => s.id === id)) || { id, label: id, accent: '#888' };
    },
    articlesBySection(id) {
      return ARTICLES.filter(a => a.s === id).sort((x, y) => y.ts - x.ts);
    },
    articlesBySymbol(sym) {
      return ARTICLES.filter(a => (a.sym || []).includes(sym)).sort((x, y) => y.ts - x.ts);
    },
    latest(n) {
      return ARTICLES.slice().sort((x, y) => y.ts - x.ts).slice(0, n || 12);
    },
    /* Deterministic "most read" ranking so the list is stable between pages. */
    mostRead(n) {
      return ARTICLES.slice()
        .map(a => ({ a, score: hash(a.id) % 1000 + (a.p ? 120 : 0) }))
        .sort((x, y) => y.score - x.score)
        .slice(0, n || 6)
        .map(x => x.a);
    },

    /* Body text: two authored lead paragraphs plus generated continuation, so
       every article renders as a full read without shipping a megabyte of prose. */
    body(a) {
      const au = this.author(a.a);
      const syms = (a.sym || []).map(s => (this.bySymbol(s) || {}).name).filter(Boolean);
      const subject = syms[0] || this.section(a.s).label.toLowerCase();
      const r = seeded(hash(a.id));
      const paras = [
        a.d,
        `The move has been building for weeks, but it took this week's data for the market to treat it as a level rather than a drift. Desks that had been running the position as a hedge are now running it as a view, and the difference shows up in how quickly the flow arrives when the tape moves against them.`,
        `"You can argue about the destination — nobody on this desk agrees about the destination," said one portfolio manager who asked not to be named discussing positioning. "What changed is the path. The path got a lot less forgiving."`,
        `For ${subject}, the second-order effect matters more than the headline. Hedging costs have risen roughly ${(8 + r() * 20).toFixed(0)}% since the start of the quarter, and the cost is concentrated in exactly the tenors that corporate treasurers use.`,
        `Analysts at three of the largest dealers have cut their year-end targets in the past fortnight, though none has moved to an outright bearish stance. The median revision was ${(2 + r() * 6).toFixed(1)}%, and each cited the same two inputs: the pace of disinflation in services, and the elasticity of demand once the rate pass-through completes.`,
        `The risk to that view is a familiar one. Consensus has been wrong in the same direction for six consecutive quarters, and the correction has arrived late every time. Positioning surveys suggest the market is now leaning far enough one way that a modest surprise would force an outsized adjustment.`,
        `${au.name} reported from ${au.bureau || 'the newsroom'}. Additional reporting by the ${this.section(a.s).label} desk.`
      ];
      return paras;
    },

    /* Procedural SVG "photography" — no external image requests, stable per id. */
    image(id, w, h) {
      const r = seeded(hash(id));
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

  /* -- small deterministic helpers, shared with market.js -- */
  function hash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function seeded(seed) {
    let s = seed >>> 0 || 1;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  window.IV_RAND = { hash, seeded };
})();
