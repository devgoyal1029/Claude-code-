-- ============================================================================
-- Engine API -- cross-fund analytics.
-- ----------------------------------------------------------------------------
-- Everything here reads mv_current / mv_fund_stats / mv_security, so it stays
-- fast even though each question spans every fund in the database.
--
-- All SECURITY DEFINER with a pinned search_path: the browser ships an anon
-- key, and this keeps that key to calling functions rather than reading tables.
--
-- Run after sql/engine_core.sql.
-- ============================================================================


-- ============================================================================
-- MARKET
-- ============================================================================

-- ----------------------------------------------------------------------------
-- market_overview -- the headline numbers for a landing page.
-- ----------------------------------------------------------------------------
create or replace function market_overview()
returns table (funds            int,
               amcs             int,
               securities       int,
               total_aum_cr     numeric,
               equity_aum_cr    numeric,
               debt_aum_cr      numeric,
               categories       int,
               sectors          int,
               oldest_snapshot  date,
               newest_snapshot  date)
language sql stable security definer set search_path = public
as $$
    select (select count(*)::int from mv_fund_stats),
           (select count(distinct amc)::int from mv_fund_stats),
           (select count(*)::int from mv_security),
           (select round(sum(aum_cr)) from mv_fund_stats),
           (select round(sum(c.market_value_lacs) / 100)
              from mv_current c where c.asset_type = 'Equity'),
           (select round(sum(c.market_value_lacs) / 100)
              from mv_current c where c.asset_type = 'Debt'),
           (select count(distinct category)::int from mv_fund_stats where category is not null),
           (select count(distinct sector)::int from mv_current where is_security),
           (select min(portfolio_date) from mv_fund_stats),
           (select max(portfolio_date) from mv_fund_stats)
$$;


-- ----------------------------------------------------------------------------
-- top_stocks -- what the market as a whole owns most.
--
-- Three different answers depending on p_order:
--   'funds' -- widest ownership (how many schemes hold it)
--   'value' -- most rupees behind it
--   'weight'-- highest average conviction where held
-- These disagree, and the disagreement is the interesting part: a stock held
-- by 400 funds at 1% each is a different animal from one held by 12 funds at
-- 8% each.
-- ----------------------------------------------------------------------------
create or replace function top_stocks(lim        int     default 50,
                                      p_order    text    default 'funds',
                                      min_funds  int     default 1,
                                      p_category text    default null,
                                      p_amc      text    default null,
                                      p_sector   text    default null)
returns table (isin            text,
               instrument      text,
               sector          text,
               funds_holding   int,
               amcs_holding    int,
               total_value_cr  numeric,
               avg_weight      numeric,
               max_weight      numeric,
               top_holder      text)
language sql stable security definer set search_path = public
as $$
    -- Aggregate and LIMIT first, then resolve top_holder for only the rows that
    -- survived. Doing it the other way -- a correlated subquery against the CTE --
    -- cannot use an index and re-scanned ~69k rows for every one of ~5k ISINs,
    -- which hit the statement timeout.
    with agg as (
        select c.isin,
               count(*)::int                            as funds_holding,
               count(distinct c.amc)::int               as amcs_holding,
               round(sum(c.market_value_lacs) / 100, 2) as total_value_cr,
               round(avg(c.pct_to_nav), 3)              as avg_weight,
               round(max(c.pct_to_nav), 2)              as max_weight
        from mv_current c
        where c.is_security and c.isin is not null
          and (p_category is null or c.category = p_category)
          and (p_amc      is null or c.amc      = p_amc)
          and (p_sector   is null or c.sector   = p_sector)
        group by c.isin
        having count(*) >= greatest(coalesce(min_funds, 1), 1)
    ),
    picked as (
        select * from agg
        order by case when p_order = 'value'  then total_value_cr
                      when p_order = 'weight' then avg_weight
                      else funds_holding::numeric end desc,
                 total_value_cr desc nulls last
        limit least(coalesce(lim, 50), 300)
    )
    select p.isin, s.instrument, s.sector,
           p.funds_holding, p.amcs_holding, p.total_value_cr, p.avg_weight, p.max_weight,
           (select c.scheme_name from mv_current c
             where c.isin = p.isin and c.is_security
             order by c.pct_to_nav desc nulls last limit 1)
    from picked p
    left join mv_security s on s.isin = p.isin
    order by case when p_order = 'value'  then p.total_value_cr
                  when p_order = 'weight' then p.avg_weight
                  else p.funds_holding::numeric end desc,
             p.total_value_cr desc nulls last
$$;


-- ----------------------------------------------------------------------------
-- top_sectors -- sector weight across the whole market.
--
-- avg_weight is the mean weight among funds that hold the sector at all, which
-- is the honest read: averaging across funds that cannot hold it (a gilt fund
-- has no IT exposure) would drag every sector toward zero.
-- ----------------------------------------------------------------------------
create or replace function top_sectors(lim        int  default 40,
                                       p_category text default null,
                                       p_amc      text default null)
returns table (sector          text,
               funds_holding   int,
               holdings        int,
               total_value_cr  numeric,
               avg_weight      numeric,
               max_weight      numeric,
               top_stock       text)
language sql stable security definer set search_path = public
as $$
    -- Same shape as top_stocks: aggregate, limit, then resolve top_stock for the
    -- surviving sectors only.
    with per_fund as (
        select c.sector, c.amc, c.scheme_name,
               sum(c.pct_to_nav) w, sum(c.market_value_lacs) v, count(*) n
        from mv_current c
        where c.is_security
          and (p_category is null or c.category = p_category)
          and (p_amc      is null or c.amc      = p_amc)
        group by 1, 2, 3
    ),
    agg as (
        select sector,
               count(*)::int          as funds_holding,
               sum(n)::int            as holdings,
               round(sum(v) / 100, 2) as total_value_cr,
               round(avg(w), 2)       as avg_weight,
               round(max(w), 2)       as max_weight
        from per_fund group by sector
    ),
    picked as (
        select * from agg order by total_value_cr desc nulls last
        limit least(coalesce(lim, 40), 200)
    )
    select p.sector, p.funds_holding, p.holdings, p.total_value_cr,
           p.avg_weight, p.max_weight,
           (select c.instrument from mv_current c
             where c.sector = p.sector and c.is_security
               and (p_category is null or c.category = p_category)
               and (p_amc      is null or c.amc      = p_amc)
             group by c.instrument
             order by sum(c.market_value_lacs) desc nulls last limit 1)
    from picked p
    order by p.total_value_cr desc nulls last
$$;


-- ============================================================================
-- STOCK
-- ============================================================================

-- ----------------------------------------------------------------------------
-- search_stocks -- by name or ISIN.
-- ----------------------------------------------------------------------------
create or replace function search_stocks(q text, lim int default 25)
returns table (isin           text,
               instrument     text,
               sector         text,
               funds_holding  int,
               total_value_cr numeric)
language sql stable security definer set search_path = public
as $$
    select s.isin, s.instrument, s.sector,
           count(c.id)::int,
           round(sum(c.market_value_lacs) / 100, 2)
    from mv_security s
    join mv_current c on c.isin = s.isin and c.is_security
    where q is not null and length(btrim(q)) >= 2
      and (s.instrument ilike '%' || btrim(q) || '%'
        or s.isin = upper(btrim(q)))
    group by s.isin, s.instrument, s.sector
    order by (s.instrument ilike btrim(q) || '%') desc,
             count(c.id) desc
    limit least(coalesce(lim, 25), 100)
$$;


-- ----------------------------------------------------------------------------
-- stock_detail -- everything known about one security.
-- ----------------------------------------------------------------------------
create or replace function stock_detail(p_isin text)
returns table (isin            text,
               instrument      text,
               sector          text,
               funds_holding   int,
               amcs_holding    int,
               total_value_cr  numeric,
               avg_weight      numeric,
               max_weight      numeric,
               min_weight      numeric,
               top_holder      text,
               top_holder_pct  numeric,
               name_variants   int)
language sql stable security definer set search_path = public
as $$
    with c as (
        select * from mv_current
        where isin = upper(btrim(p_isin)) and is_security
    ),
    t as (select scheme_name, pct_to_nav from c order by pct_to_nav desc nulls last limit 1)
    select upper(btrim(p_isin)),
           (select instrument from mv_security where isin = upper(btrim(p_isin))),
           (select sector     from mv_security where isin = upper(btrim(p_isin))),
           count(*)::int,
           count(distinct amc)::int,
           round(sum(market_value_lacs) / 100, 2),
           round(avg(pct_to_nav), 3),
           round(max(pct_to_nav), 2),
           round(min(pct_to_nav), 3),
           (select scheme_name from t),
           (select round(pct_to_nav, 2) from t),
           (select name_variants from mv_security where isin = upper(btrim(p_isin)))
    from c
$$;


-- ----------------------------------------------------------------------------
-- stock_funds -- every fund holding a security, richest-first.
-- ----------------------------------------------------------------------------
create or replace function stock_funds(p_isin text, lim int default 100)
returns table (amc            text,
               scheme_name    text,
               scheme_code    text,
               category       text,
               pct_to_nav     numeric,
               value_cr       numeric,
               fund_aum_cr    numeric,
               portfolio_date date)
language sql stable security definer set search_path = public
as $$
    select amc, scheme_name, scheme_code, category,
           round(pct_to_nav, 2), value_cr, fund_aum_cr, portfolio_date
    from mv_current
    where isin = upper(btrim(p_isin)) and is_security
    order by market_value_lacs desc nulls last
    limit least(coalesce(lim, 100), 500)
$$;


-- ============================================================================
-- SECTOR
-- ============================================================================

create or replace function list_sectors()
returns table (sector text, stocks int, funds_holding int, total_value_cr numeric)
language sql stable security definer set search_path = public
as $$
    select sector,
           count(distinct isin)::int,
           count(distinct (amc, scheme_name))::int,
           round(sum(market_value_lacs) / 100, 2)
    from mv_current
    where is_security
    group by 1
    order by 4 desc nulls last
$$;


create or replace function sector_stocks(p_sector text, lim int default 50)
returns table (isin           text,
               instrument     text,
               funds_holding  int,
               total_value_cr numeric,
               avg_weight     numeric)
language sql stable security definer set search_path = public
as $$
    select isin,
           min(instrument),
           count(*)::int,
           round(sum(market_value_lacs) / 100, 2),
           round(avg(pct_to_nav), 3)
    from mv_current
    where is_security and sector = p_sector and isin is not null
    group by isin
    order by 4 desc nulls last
    limit least(coalesce(lim, 50), 200)
$$;


-- Funds most exposed to a sector -- the screen for "who is betting on this".
create or replace function sector_funds(p_sector text, lim int default 50)
returns table (amc         text,
               scheme_name text,
               scheme_code text,
               category    text,
               sector_pct  numeric,
               stocks      int,
               value_cr    numeric,
               fund_aum_cr numeric)
language sql stable security definer set search_path = public
as $$
    select amc, scheme_name, min(scheme_code), min(category),
           round(sum(pct_to_nav), 2),
           count(*)::int,
           round(sum(market_value_lacs) / 100, 2),
           max(fund_aum_cr)
    from mv_current
    where is_security and sector = p_sector
    group by amc, scheme_name
    order by 5 desc nulls last
    limit least(coalesce(lim, 50), 200)
$$;


-- ============================================================================
-- CATEGORY
-- ============================================================================

create or replace function list_categories()
returns table (category text, funds int, total_aum_cr numeric, avg_holdings numeric)
language sql stable security definer set search_path = public
as $$
    select coalesce(category, 'Uncategorised'),
           count(*)::int,
           round(sum(aum_cr)),
           round(avg(securities), 1)
    from mv_fund_stats
    group by 1
    order by 2 desc
$$;


-- ----------------------------------------------------------------------------
-- category_stats -- the peer benchmark a single fund gets measured against.
-- Medians, not means: a couple of 300-holding index funds would drag the
-- average for an entire category of 40-stock active funds.
-- ----------------------------------------------------------------------------
create or replace function category_stats(p_category text)
returns table (category           text,
               funds              int,
               total_aum_cr       numeric,
               med_holdings       numeric,
               med_top_10         numeric,
               med_hhi            numeric,
               med_effective      numeric,
               med_cash           numeric,
               most_common_stock  text,
               most_common_pct    numeric)
language sql stable security definer set search_path = public
as $$
    with f as (select * from mv_fund_stats
                where coalesce(category, 'Uncategorised') = p_category),
    common as (
        select c.instrument, count(distinct (c.amc, c.scheme_name))::numeric n
        from mv_current c
        join f on f.amc = c.amc and f.scheme_name = c.scheme_name
        where c.is_security
        group by c.instrument
        order by n desc
        limit 1
    )
    select p_category,
           count(*)::int,
           round(sum(aum_cr)),
           round(percentile_cont(0.5) within group (order by securities)::numeric, 1),
           round(percentile_cont(0.5) within group (order by top_10_pct)::numeric, 2),
           round(percentile_cont(0.5) within group (order by hhi)::numeric, 0),
           round(percentile_cont(0.5) within group (order by effective_stocks)::numeric, 1),
           round(percentile_cont(0.5) within group (order by cash_pct)::numeric, 2),
           (select instrument from common),
           round((select n from common) / nullif(count(*), 0) * 100, 1)
    from f
$$;


-- ============================================================================
-- FUND-RELATIVE
-- ============================================================================

-- ----------------------------------------------------------------------------
-- peer_funds -- funds whose portfolios most resemble this one.
--
-- Ranked by the same min-weight overlap used elsewhere, so a fund holding the
-- same names at very different weights ranks below one that matches closely.
-- Not restricted to the same category on purpose: a "Large Cap" and a
-- "Focused" fund running the same book is exactly what you want surfaced.
-- ----------------------------------------------------------------------------
create or replace function peer_funds(p_scheme_code text, lim int default 15)
returns table (amc         text,
               scheme_name text,
               scheme_code text,
               category    text,
               overlap_pct numeric,
               common      int,
               fund_aum_cr numeric)
language sql stable security definer set search_path = public
as $$
    with me as (
        select distinct amc, scheme_name from mv_current
        where scheme_code = p_scheme_code
        limit 1
    ),
    a as (
        select c.isin, c.pct_to_nav
        from mv_current c join me on me.amc = c.amc and me.scheme_name = c.scheme_name
        where c.is_security and c.isin is not null
    )
    select b.amc, b.scheme_name, min(b.scheme_code), min(b.category),
           round(sum(least(a.pct_to_nav, b.pct_to_nav)), 2),
           count(*)::int,
           max(b.fund_aum_cr)
    from a
    join mv_current b on b.isin = a.isin and b.is_security
    where (b.amc, b.scheme_name) not in (select amc, scheme_name from me)
    group by b.amc, b.scheme_name
    order by 5 desc nulls last
    limit least(coalesce(lim, 15), 100)
$$;


-- ----------------------------------------------------------------------------
-- unique_holdings -- names no other loaded fund owns.
-- The contrarian view: either genuine off-benchmark conviction, or a position
-- nobody else wants.
-- ----------------------------------------------------------------------------
create or replace function unique_holdings(p_scheme_code text, lim int default 50)
returns table (instrument text, isin text, sector text,
               pct_to_nav numeric, value_cr numeric, held_by int)
language sql stable security definer set search_path = public
as $$
    with me as (
        select distinct amc, scheme_name from mv_current
        where scheme_code = p_scheme_code limit 1
    ),
    mine as (
        select c.* from mv_current c
        join me on me.amc = c.amc and me.scheme_name = c.scheme_name
        where c.is_security and c.isin is not null
    ),
    counted as (
        select m.*, (select count(distinct (o.amc, o.scheme_name))::int
                     from mv_current o where o.isin = m.isin and o.is_security) held_by
        from mine m
    )
    select instrument, isin, sector, round(pct_to_nav, 2), value_cr, held_by
    from counted
    where held_by <= 2
    order by pct_to_nav desc nulls last
    limit least(coalesce(lim, 50), 200)
$$;


-- ----------------------------------------------------------------------------
-- fund_rank -- where a fund sits among its category peers.
-- ----------------------------------------------------------------------------
create or replace function fund_rank(p_scheme_code text)
returns table (category            text,
               peers               int,
               aum_cr              numeric,      aum_pctile        numeric,
               securities          int,          holdings_pctile   numeric,
               top_10_pct          numeric,      top10_pctile      numeric,
               hhi                 numeric,      hhi_pctile        numeric,
               cash_pct            numeric,      cash_pctile       numeric)
language sql stable security definer set search_path = public
as $$
    with me as (select * from mv_fund_stats where scheme_code = p_scheme_code limit 1),
         peers as (select f.* from mv_fund_stats f, me
                    where coalesce(f.category,'~') = coalesce(me.category,'~'))
    select me.category,
           (select count(*)::int from peers),
           me.aum_cr,
           round((select count(*) filter (where p.aum_cr <= me.aum_cr) * 100.0
                    / nullif(count(*), 0) from peers p), 1),
           me.securities,
           round((select count(*) filter (where p.securities <= me.securities) * 100.0
                    / nullif(count(*), 0) from peers p), 1),
           me.top_10_pct,
           round((select count(*) filter (where p.top_10_pct <= me.top_10_pct) * 100.0
                    / nullif(count(*), 0) from peers p), 1),
           me.hhi,
           round((select count(*) filter (where p.hhi <= me.hhi) * 100.0
                    / nullif(count(*), 0) from peers p), 1),
           me.cash_pct,
           round((select count(*) filter (where p.cash_pct <= me.cash_pct) * 100.0
                    / nullif(count(*), 0) from peers p), 1)
    from me
$$;


-- ============================================================================
-- SCREENER + LEADERBOARDS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- fund_screener -- every filter nullable, so the UI can send only what is set.
-- ----------------------------------------------------------------------------
create or replace function fund_screener(p_category    text    default null,
                                         p_amc         text    default null,
                                         p_sector      text    default null,
                                         p_min_sector_pct numeric default null,
                                         p_min_aum     numeric default null,
                                         p_max_aum     numeric default null,
                                         p_min_holdings int    default null,
                                         p_max_holdings int    default null,
                                         p_min_top10   numeric default null,
                                         p_max_top10   numeric default null,
                                         p_holds_isin  text    default null,
                                         p_order       text    default 'aum',
                                         lim           int     default 100)
returns table (amc          text,
               scheme_name  text,
               scheme_code  text,
               category     text,
               aum_cr       numeric,
               securities   int,
               top_10_pct   numeric,
               hhi          numeric,
               effective_stocks numeric,
               cash_pct     numeric,
               top_sector   text,
               top_sector_pct numeric,
               match_pct    numeric,
               portfolio_date date)
language sql stable security definer set search_path = public
as $$
    select f.amc, f.scheme_name, f.scheme_code, f.category, f.aum_cr, f.securities,
           f.top_10_pct, f.hhi, f.effective_stocks, f.cash_pct,
           f.top_sector, f.top_sector_pct,
           case
             when p_holds_isin is not null then
               (select round(c.pct_to_nav, 2) from mv_current c
                 where c.amc = f.amc and c.scheme_name = f.scheme_name
                   and c.isin = upper(btrim(p_holds_isin)) limit 1)
             when p_sector is not null then
               (select round(sum(c.pct_to_nav), 2) from mv_current c
                 where c.amc = f.amc and c.scheme_name = f.scheme_name
                   and c.sector = p_sector and c.is_security)
             else null
           end as match_pct,
           f.portfolio_date
    from mv_fund_stats f
    where (p_category     is null or f.category = p_category)
      and (p_amc          is null or f.amc = p_amc)
      and (p_min_aum      is null or f.aum_cr >= p_min_aum)
      and (p_max_aum      is null or f.aum_cr <= p_max_aum)
      and (p_min_holdings is null or f.securities >= p_min_holdings)
      and (p_max_holdings is null or f.securities <= p_max_holdings)
      and (p_min_top10    is null or f.top_10_pct >= p_min_top10)
      and (p_max_top10    is null or f.top_10_pct <= p_max_top10)
      and (p_holds_isin   is null or exists (
              select 1 from mv_current c
               where c.amc = f.amc and c.scheme_name = f.scheme_name
                 and c.isin = upper(btrim(p_holds_isin)) and c.is_security))
      and (p_sector is null or coalesce(p_min_sector_pct, 0) <= coalesce((
              select sum(c.pct_to_nav) from mv_current c
               where c.amc = f.amc and c.scheme_name = f.scheme_name
                 and c.sector = p_sector and c.is_security), -1))
    order by case p_order
               when 'holdings'  then f.securities::numeric
               when 'top10'     then f.top_10_pct
               when 'hhi'       then f.hhi
               when 'cash'      then f.cash_pct
               when 'match'     then coalesce((
                    select sum(c.pct_to_nav) from mv_current c
                     where c.amc = f.amc and c.scheme_name = f.scheme_name
                       and (p_sector is null or c.sector = p_sector)
                       and (p_holds_isin is null or c.isin = upper(btrim(p_holds_isin)))
                       and c.is_security), 0)
               else f.aum_cr end desc nulls last
    limit least(coalesce(lim, 100), 500)
$$;


-- ----------------------------------------------------------------------------
-- amc_summary -- house-level rollup.
-- ----------------------------------------------------------------------------
create or replace function amc_summary()
returns table (amc            text,
               funds          int,
               total_aum_cr   numeric,
               avg_holdings   numeric,
               med_top_10     numeric,
               equity_aum_cr  numeric,
               debt_aum_cr    numeric,
               latest_date    date)
language sql stable security definer set search_path = public
as $$
    select f.amc,
           count(*)::int,
           round(sum(f.aum_cr)),
           round(avg(f.securities), 1),
           round(percentile_cont(0.5) within group (order by f.top_10_pct)::numeric, 2),
           (select round(sum(c.market_value_lacs) / 100) from mv_current c
             where c.amc = f.amc and c.asset_type = 'Equity'),
           (select round(sum(c.market_value_lacs) / 100) from mv_current c
             where c.amc = f.amc and c.asset_type = 'Debt'),
           max(f.portfolio_date)
    from mv_fund_stats f
    group by f.amc
    order by 3 desc nulls last
$$;


-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
grant execute on function market_overview()                          to anon, authenticated;
grant execute on function top_stocks(int, text, int, text, text, text) to anon, authenticated;
grant execute on function top_sectors(int, text, text)               to anon, authenticated;
grant execute on function search_stocks(text, int)                   to anon, authenticated;
grant execute on function stock_detail(text)                         to anon, authenticated;
grant execute on function stock_funds(text, int)                     to anon, authenticated;
grant execute on function list_sectors()                             to anon, authenticated;
grant execute on function sector_stocks(text, int)                   to anon, authenticated;
grant execute on function sector_funds(text, int)                    to anon, authenticated;
grant execute on function list_categories()                          to anon, authenticated;
grant execute on function category_stats(text)                       to anon, authenticated;
grant execute on function peer_funds(text, int)                      to anon, authenticated;
grant execute on function unique_holdings(text, int)                 to anon, authenticated;
grant execute on function fund_rank(text)                            to anon, authenticated;
grant execute on function amc_summary()                              to anon, authenticated;
grant execute on function fund_screener(text, text, text, numeric, numeric, numeric,
                                        int, int, numeric, numeric, text, text, int)
                                                                     to anon, authenticated;


-- ============================================================================
-- SMOKE TEST
-- ============================================================================
-- select * from market_overview();
-- select * from top_stocks(20, 'funds');
-- select * from top_stocks(20, 'value');
-- select * from top_sectors(15);
-- select * from list_sectors() limit 20;
-- select * from list_categories();
-- select * from amc_summary();
-- select * from search_stocks('reliance');
-- select * from stock_detail('INE002A01018');
-- select * from stock_funds('INE002A01018', 20);
-- select * from sector_funds('Banks', 20);
-- select * from category_stats('Large Cap Fund');
-- select * from fund_screener(p_sector => 'Banks', p_min_sector_pct => 25, p_order => 'match');


-- ============================================================================
-- STOCK x AMC  (added after first release)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- stock_by_amc -- one security, broken down by fund house.
--
-- Two different "percentages", because they answer different questions:
--   share_of_total_pct -- of all the money the loaded universe has in this
--     stock, how much sits with this AMC. Size-dominated, so the big houses
--     lead almost by definition.
--   pct_of_amc_book -- how much of this AMC's own equity book is in this one
--     name. This is the conviction read, and it routinely reorders the list:
--     a small house at 3% is making a far bigger bet than a giant at 0.4%.
-- ----------------------------------------------------------------------------
create or replace function stock_by_amc(p_isin text)
returns table (amc                text,
               schemes            int,
               total_value_cr     numeric,
               share_of_total_pct numeric,
               avg_weight         numeric,
               max_weight         numeric,
               top_scheme         text,
               top_scheme_pct     numeric,
               pct_of_amc_book    numeric)
language sql stable security definer set search_path = public
as $$
    with h as (
        select * from mv_current
        where isin = upper(btrim(p_isin)) and is_security
    ),
    tot as (select sum(market_value_lacs) v from h),
    book as (
        select amc, sum(market_value_lacs) v
        from mv_current
        where is_security and amc in (select distinct amc from h)
        group by amc
    ),
    agg as (
        select h.amc, count(*)::int as schemes,
               sum(h.market_value_lacs)    as v,
               round(avg(h.pct_to_nav), 3) as avg_weight,
               round(max(h.pct_to_nav), 2) as max_weight
        from h group by h.amc
    )
    select a.amc, a.schemes,
           round(a.v / 100, 2),
           round(a.v / nullif((select v from tot), 0) * 100, 2),
           a.avg_weight, a.max_weight,
           (select h2.scheme_name from h h2 where h2.amc = a.amc
             order by h2.market_value_lacs desc nulls last limit 1),
           (select round(h2.pct_to_nav, 2) from h h2 where h2.amc = a.amc
             order by h2.market_value_lacs desc nulls last limit 1),
           round(a.v / nullif((select v from book b where b.amc = a.amc), 0) * 100, 3)
    from agg a
    order by a.v desc nulls last
$$;


-- ----------------------------------------------------------------------------
-- stock_funds gains an AMC filter, for the drill-down under stock_by_amc.
-- The parameter list changes, so the old signature is dropped first --
-- CREATE OR REPLACE would leave a second overload behind and make calls
-- ambiguous.
-- ----------------------------------------------------------------------------
drop function if exists stock_funds(text, int);

create or replace function stock_funds(p_isin text,
                                       lim    int  default 100,
                                       p_amc  text default null)
returns table (amc            text,
               scheme_name    text,
               scheme_code    text,
               category       text,
               pct_to_nav     numeric,
               value_cr       numeric,
               fund_aum_cr    numeric,
               portfolio_date date)
language sql stable security definer set search_path = public
as $$
    select amc, scheme_name, scheme_code, category,
           round(pct_to_nav, 2), value_cr, fund_aum_cr, portfolio_date
    from mv_current
    where isin = upper(btrim(p_isin)) and is_security
      and (p_amc is null or amc = p_amc)
    order by market_value_lacs desc nulls last
    limit least(coalesce(lim, 100), 500)
$$;

grant execute on function stock_by_amc(text)           to anon, authenticated;
grant execute on function stock_funds(text, int, text) to anon, authenticated;

-- select * from stock_by_amc('INE002A01018');
-- select * from stock_funds('INE002A01018', 15, 'HDFC');
