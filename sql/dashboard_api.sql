-- ============================================================================
-- Dashboard API -- every RPC the dashboard calls.
-- ----------------------------------------------------------------------------
-- All functions are SECURITY DEFINER with a pinned search_path. The dashboard
-- ships an anon key, and this way that key cannot table-scan anything: it can
-- only call these functions and receive exactly what they return.
--
-- NAV and returns are NOT here. The dashboard pulls NAV history straight from
-- api.mfapi.in in the browser and computes returns/risk in JavaScript --
-- storing daily NAV for 37,613 schemes would not fit the free tier, and this
-- way every AMFI scheme gets returns, not just the 4,060 with holdings.
--
-- Depends on: v_scheme_plans, v_fund_picker (sql/plan_level_holdings.sql,
--             sql/fund_picker.sql)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Search index. pg_trgm is already installed (Handoff Part 2, section 4.2).
-- ----------------------------------------------------------------------------
create index if not exists idx_sm_name_trgm
    on schemes_master using gin (scheme_name gin_trgm_ops);

create index if not exists idx_holdings_amc_scheme_date
    on mf_holdings (amc, scheme_name, portfolio_date);


-- ----------------------------------------------------------------------------
-- asset_class -- one place that decides Equity / Debt / Cash / ...
--
-- `section` is the real signal, but it is NULL for every HDFC and Nippon row:
-- those two were loaded with a parser that did not read heading labels out of
-- the ISIN column, and the re-load has never been run. So when section is
-- missing we fall back to two weaker signals -- a coupon means debt, and a
-- credit-rating-shaped industry_rating means debt, otherwise equity.
--
-- That fallback is a heuristic. Once HDFC/Nippon are re-parsed with v4 the
-- section branch takes over on its own and the heuristic stops firing.
-- ----------------------------------------------------------------------------
create or replace function asset_class(p_section text,
                                       p_is_security boolean,
                                       p_industry_rating text,
                                       p_coupon numeric)
returns text
language sql immutable
as $$
    select case
        when coalesce(p_is_security, false) = false      then 'Cash & Equivalents'
        when p_section ~* 'equity'                       then 'Equity'
        when p_section ~* 'debt|money market|government|bond' then 'Debt'
        when p_section ~* 'mutual fund unit|units? issued'    then 'Mutual Fund Units'
        when p_section ~* 'reit|invit'                   then 'REITs / InvITs'
        when p_section ~* 'gold'                         then 'Gold'
        when p_section ~* 'silver'                       then 'Silver'
        when p_section ~* 'derivativ'                    then 'Derivatives'
        when p_section ~* 'foreign'                      then 'Foreign Securities'
        -- section NULL from here on
        when p_coupon is not null                        then 'Debt'
        when p_industry_rating ~* '^(crisil|icra|care|ind-?ra|brickwork|fitch|acuite)|sov|unrated|a1\+|^aaa|^aa|^a\+'
                                                         then 'Debt'
        when p_industry_rating is not null               then 'Equity'
        else 'Unclassified'
    end
$$;


-- ----------------------------------------------------------------------------
-- search_schemes -- powers the search bar over the full AMFI universe.
--
-- has_holdings tells the UI whether to offer the portfolio tab. Only ~11% of
-- AMFI codes have holdings loaded, so the badge is the honest way to show it
-- rather than letting the user click into an empty tab.
-- ----------------------------------------------------------------------------
create or replace function search_schemes(q text, lim int default 25)
returns table (scheme_code   text,
               scheme_name   text,
               amc_name      text,
               category      text,
               has_holdings  boolean)
language sql stable security definer set search_path = public
as $$
    select s.scheme_code::text,
           s.scheme_name,
           s.amc_name,
           s.category,
           exists (select 1 from v_scheme_plans p
                    where p.scheme_code::text = s.scheme_code::text)
    from schemes_master s
    where q is not null and length(btrim(q)) >= 2
      and s.scheme_name ilike '%' || btrim(q) || '%'
    order by (s.scheme_name ilike btrim(q) || '%') desc,   -- prefix hits first
             length(s.scheme_name),
             s.scheme_name
    limit least(coalesce(lim, 25), 100)
$$;


-- ----------------------------------------------------------------------------
-- fund_overview -- header block for a scheme_code.
-- ----------------------------------------------------------------------------
create or replace function fund_overview(p_scheme_code text)
returns table (scheme_code        text,
               plan_name          text,
               master_scheme_name text,
               amc                text,
               master_amc         text,
               category           text,
               plan_type          text,
               holdings_scheme    text,
               portfolio_date     date,
               holdings_count     int,
               has_holdings       boolean)
language sql stable security definer set search_path = public
as $$
    with p as (
        select * from v_scheme_plans
        where scheme_code::text = p_scheme_code
        limit 1
    ),
    h as (
        select max(portfolio_date) as pd
        from mf_holdings m
        join p on p.amc = m.amc and p.scheme_name = m.scheme_name
    )
    select p.scheme_code::text,
           p.plan_name,
           p.master_scheme_name,
           p.amc,
           p.master_amc,
           p.category,
           p.plan_type,
           p.scheme_name,
           h.pd,
           (select count(*)::int from mf_holdings m
             where m.amc = p.amc and m.scheme_name = p.scheme_name
               and m.portfolio_date = h.pd),
           h.pd is not null
    from p cross join h
$$;


-- ----------------------------------------------------------------------------
-- holdings_list -- every holding, names repaired.
--
-- Some AMCs ship a blank instrument_name with a valid ISIN, so the name is
-- looked up from any other row carrying that ISIN before falling back to the
-- ISIN itself. Never join funds on instrument_name -- "Larsen and Toubro Ltd."
-- vs "Larsen & Toubro Ltd." vs "HDFC Bank Limited" are all the same issuer
-- spelled three ways. ISIN is the only stable key.
-- ----------------------------------------------------------------------------
create or replace function holdings_list(p_scheme_code text)
returns table (instrument      text,
               isin            text,
               sector          text,
               asset_type      text,
               pct_to_nav      numeric,
               value_cr        numeric,
               quantity        numeric,
               coupon_pct      numeric,
               yield_pct       numeric,
               is_security     boolean,
               section         text,
               sub_section     text)
language sql stable security definer set search_path = public
as $$
    with h as (select * from holdings_by_code(p_scheme_code))
    select coalesce(h.instrument_name,
                    (select i.instrument_name from mf_holdings i
                      where i.isin = h.isin and i.instrument_name is not null
                      limit 1),
                    h.isin,
                    '(unnamed)'),
           h.isin,
           coalesce(h.industry_rating, 'Unclassified'),
           asset_class(h.section, h.is_security, h.industry_rating, h.coupon_pct),
           round(h.pct_to_nav, 4),
           round(h.market_value_lacs / 100, 2),
           h.quantity,
           h.coupon_pct,
           h.yield_pct,
           h.is_security,
           h.section,
           h.sub_section
    from h
    order by h.pct_to_nav desc nulls last
$$;


-- ----------------------------------------------------------------------------
-- holdings_sectors -- sector allocation (equity sectors / debt ratings).
-- ----------------------------------------------------------------------------
create or replace function holdings_sectors(p_scheme_code text)
returns table (sector text, holdings int, pct numeric)
language sql stable security definer set search_path = public
as $$
    select coalesce(industry_rating,
                    case when is_security then 'Unclassified'
                         else 'Cash & Equivalents' end),
           count(*)::int,
           round(sum(pct_to_nav), 2)
    from holdings_by_code(p_scheme_code)
    group by 1
    order by 3 desc
$$;


-- ----------------------------------------------------------------------------
-- holdings_assets -- Equity / Debt / Cash / ... split.
-- ----------------------------------------------------------------------------
create or replace function holdings_assets(p_scheme_code text)
returns table (asset_type text, holdings int, pct numeric)
language sql stable security definer set search_path = public
as $$
    select asset_class(section, is_security, industry_rating, coupon_pct),
           count(*)::int,
           round(sum(pct_to_nav), 2)
    from holdings_by_code(p_scheme_code)
    group by 1
    order by 3 desc
$$;


-- ----------------------------------------------------------------------------
-- holdings_metrics -- the concentration / diversification numbers.
--
-- hhi is the Herfindahl-Hirschman index over security weights: sum of squared
-- percentages. ~10000 = a single holding, low hundreds = well spread.
-- effective_stocks is 10000/hhi -- how many equally-weighted positions the
-- portfolio behaves like, which is usually far below the raw holding count.
-- ----------------------------------------------------------------------------
create or replace function holdings_metrics(p_scheme_code text)
returns table (total_holdings     int,
               securities         int,
               top_5_pct          numeric,
               top_10_pct         numeric,
               top_20_pct         numeric,
               largest_pct        numeric,
               cash_pct           numeric,
               hhi                numeric,
               effective_stocks   numeric,
               sectors            int,
               top_sector         text,
               top_sector_pct     numeric,
               portfolio_date     date,
               pct_sum            numeric)
language sql stable security definer set search_path = public
as $$
    with h as (select * from holdings_by_code(p_scheme_code)),
    ranked as (
        select h.*, row_number() over (order by pct_to_nav desc nulls last) rn
        from h where is_security
    ),
    sect as (
        select coalesce(industry_rating, 'Unclassified') s, sum(pct_to_nav) p
        from h where is_security
        group by 1 order by 2 desc limit 1
    )
    select (select count(*)::int from h),
           (select count(*)::int from h where is_security),
           (select round(sum(pct_to_nav), 2) from ranked where rn <= 5),
           (select round(sum(pct_to_nav), 2) from ranked where rn <= 10),
           (select round(sum(pct_to_nav), 2) from ranked where rn <= 20),
           (select round(max(pct_to_nav), 2) from ranked),
           (select round(coalesce(sum(pct_to_nav), 0), 2) from h where not is_security),
           (select round(sum(pct_to_nav * pct_to_nav), 1) from ranked),
           (select round((10000 / nullif(sum(pct_to_nav * pct_to_nav), 0))::numeric, 1) from ranked),
           (select count(distinct coalesce(industry_rating, 'Unclassified'))::int
              from h where is_security),
           (select s from sect),
           (select round(p, 2) from sect),
           (select max(portfolio_date) from h),
           (select round(sum(pct_to_nav), 2) from h)
$$;


-- ----------------------------------------------------------------------------
-- fund_overlap -- how much two funds actually share.
--
-- Joined on ISIN and pinned to a common portfolio_date. Comparing across
-- dates is meaningless: the table mixes Mar 2026 (ICICI half-yearly),
-- May 2026 (Axis), Jun 2026 (most) and Jul 2026 (Nippon fortnightly).
--
-- overlap_pct is the standard measure -- sum of min(weight_a, weight_b) --
-- so two funds holding the same 20 stocks at different weights score below
-- 100 rather than at it.
-- ----------------------------------------------------------------------------
create or replace function fund_overlap(p_code_a text, p_code_b text)
returns table (overlap_pct     numeric,
               common_holdings int,
               only_a          int,
               only_b          int,
               date_a          date,
               date_b          date,
               comparable      boolean)
language sql stable security definer set search_path = public
as $$
    with a as (select isin, pct_to_nav, portfolio_date
                 from holdings_by_code(p_code_a) where is_security),
         b as (select isin, pct_to_nav, portfolio_date
                 from holdings_by_code(p_code_b) where is_security)
    select round(coalesce(sum(least(a.pct_to_nav, b.pct_to_nav)), 0), 2),
           count(a.isin)::int,
           (select count(*)::int from a where a.isin not in (select isin from b)),
           (select count(*)::int from b where b.isin not in (select isin from a)),
           (select max(portfolio_date) from a),
           (select max(portfolio_date) from b),
           (select max(portfolio_date) from a) = (select max(portfolio_date) from b)
    from a join b on b.isin = a.isin
$$;


-- ----------------------------------------------------------------------------
-- stock_holders -- every fund holding a given ISIN. Cross-AMC exposure.
-- ----------------------------------------------------------------------------
create or replace function stock_holders(p_isin text, lim int default 50)
returns table (amc            text,
               scheme_name    text,
               pct_to_nav     numeric,
               value_cr       numeric,
               portfolio_date date)
language sql stable security definer set search_path = public
as $$
    select h.amc,
           h.scheme_name,
           round(h.pct_to_nav, 2),
           round(h.market_value_lacs / 100, 2),
           h.portfolio_date
    from mf_holdings h
    where h.isin = upper(btrim(p_isin))
      and h.portfolio_date = (select max(portfolio_date) from mf_holdings m
                               where m.amc = h.amc and m.scheme_name = h.scheme_name)
    order by h.pct_to_nav desc nulls last
    limit least(coalesce(lim, 50), 200)
$$;


-- ----------------------------------------------------------------------------
-- Grants. anon gets EXECUTE on the RPCs and nothing else.
-- ----------------------------------------------------------------------------
grant execute on function search_schemes(text, int)      to anon, authenticated;
grant execute on function fund_overview(text)            to anon, authenticated;
grant execute on function holdings_by_code(text, date)   to anon, authenticated;
grant execute on function holdings_list(text)            to anon, authenticated;
grant execute on function holdings_sectors(text)         to anon, authenticated;
grant execute on function holdings_assets(text)          to anon, authenticated;
grant execute on function holdings_metrics(text)         to anon, authenticated;
grant execute on function fund_overlap(text, text)       to anon, authenticated;
grant execute on function stock_holders(text, int)       to anon, authenticated;
grant execute on function asset_class(text, boolean, text, numeric) to anon, authenticated;


-- ============================================================================
-- SMOKE TEST -- run with a code you know has holdings
-- ============================================================================
-- select * from search_schemes('flexi cap', 10);
-- select * from fund_overview('130501');
-- select * from holdings_metrics('130501');
-- select * from holdings_assets('130501');
-- select * from holdings_sectors('130501');
-- select * from holdings_list('130501') limit 20;
