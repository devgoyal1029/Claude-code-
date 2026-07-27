-- ============================================================================
-- Fund detail -- holdings + sector breakup for one scheme_code, in one query.
-- ----------------------------------------------------------------------------
-- This is what the dashboard's fund page runs. Replace '130501' with the
-- scheme_code the user picked from v_fund_picker.
--
-- Three fallbacks keep the output from looking empty:
--   instrument_name NULL -> look the name up by ISIN from another AMC's rows
--                           (some AMCs ship blank names with a valid ISIN),
--                           then the ISIN itself, then '(unnamed)'
--   industry_rating NULL -> 'Cash & Equivalents' (TREPS, net current assets)
--
-- Sector total is repeated on every row of that sector, so the UI can group
-- without a second round trip. Ordered biggest sector first, biggest holding
-- within each sector.
--
-- Depends on: holdings_by_code() (sql/plan_level_holdings.sql section 3)
-- ============================================================================

with h as (
    select * from holdings_by_code('130501')
),
named as (
    select h.amc,
           h.scheme_name,
           h.portfolio_date,
           coalesce(h.industry_rating, 'Cash & Equivalents') as sector,
           coalesce(h.instrument_name,
                    (select i.instrument_name from mf_holdings i
                      where i.isin = h.isin and i.instrument_name is not null
                      limit 1),
                    h.isin,
                    '(unnamed)')                             as instrument,
           h.isin,
           h.pct_to_nav,
           h.market_value_lacs
    from h
),
sect as (
    select sector, sum(pct_to_nav) as sector_pct
    from named
    group by 1
)
select n.scheme_name,
       n.portfolio_date,
       n.sector,
       round(s.sector_pct, 2)              as sector_pct,
       n.instrument,
       n.isin,
       round(n.pct_to_nav, 2)              as pct,
       round(n.market_value_lacs / 100, 2) as value_cr
from named n
join sect s on s.sector = n.sector
order by s.sector_pct desc, n.pct_to_nav desc;

-- In the Supabase SQL editor, switch "Limit 100 rows" to "No limit" -- funds
-- with more than 100 holdings otherwise return a truncated list that reads
-- as missing data.
