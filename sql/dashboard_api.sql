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
-- asset_class -- one place that decides Equity / Debt / Cash / REIT / ...
--
-- Reads section, sub_section, ISIN and the instrument name, because AMCs split
-- the signal across all four and no single field is reliable. Embassy Office
-- Parks REIT alone is filed six different ways: section "Others" with
-- sub_section "ReIT" (ABSL), section "EQUITY & EQUITY RELATED" with
-- "(b) Units issued by ReIT" (HDFC), "Units of Real Estate Investment Trust"
-- (ICICI), plain "Real Estate Investment Trust" (SBI), and 360ONE/Kotak/Axis
-- file it under listed equity with no REIT marker except the name.
--
-- Rule ORDER is load-bearing:
--   * REITs are tested before mutual-fund-units, or ICICI's "Units of Real
--     Estate Investment Trust" gets swallowed by the "units of" rule.
--   * REITs are tested before the equity-section rule, or every AMC that files
--     them under equity reports them as ordinary shares.
--   * gold/silver require fund/ETF/unit context alongside the word, otherwise
--     Senco Gold, Sky Gold and Sparkle Gold Rock -- jewellery companies -- get
--     classified as bullion.
--
-- TREPS and repo rows carry ISIN-shaped codes (GSECREPO0992), so the parser
-- marks them is_security; they are cash equivalents and are caught here.
--
-- `section` is NULL for every HDFC and Nippon row -- those were loaded with an
-- older parser and the re-load has never been run -- so the last three rules
-- fall back to coupon and rating shape.
--
-- CHANGING THIS FUNCTION: refresh alone did not propagate to mv_current in
-- practice. Drop and recreate mv_current and mv_fund_stats instead.
-- ----------------------------------------------------------------------------
create or replace function asset_class(p_section     text,
                                       p_sub_section text,
                                       p_is_security boolean,
                                       p_rating      text,
                                       p_coupon      numeric,
                                       p_isin        text,
                                       p_name        text)
returns text
language sql immutable
as $$
    with t as (select coalesce(p_section,'') || ' | ' || coalesce(p_sub_section,'')
                      || ' | ' || coalesce(p_name,'') as s)
    select case
        when coalesce(p_is_security, false) = false          then 'Cash & Equivalents'
        when (select s from t) ~* 'treps|tri-?party|reverse repo|corporate debt repo'
                                                             then 'Cash & Equivalents'
        when p_isin is not null and p_isin !~ '^IN'          then 'Foreign Securities'
        when (select s from t) ~* 'reit|invit|real estate invest|infrastructure invest|realty trust'
                                                             then 'REITs / InvITs'
        when p_section ~* 'equity'                           then 'Equity'
        when (select s from t) ~* 'gold'
         and (select s from t) ~* 'etf|fund|unit'            then 'Gold'
        when (select s from t) ~* 'silver'
         and (select s from t) ~* 'etf|fund|unit'            then 'Silver'
        when (select s from t) ~* 'alternative investment'   then 'AIF Units'
        when (select s from t) ~* 'exchange traded fund|\yetf\y' then 'ETF Units'
        when (select s from t) ~* 'mutual fund unit|units? of'   then 'Mutual Fund Units'
        when p_section ~* 'debt|money market|government|bond' then 'Debt'
        when p_section ~* 'derivativ'                        then 'Derivatives'
        when p_section ~* 'foreign'                          then 'Foreign Securities'
        when p_coupon is not null                            then 'Debt'
        when p_rating ~* '^(crisil|icra|care|ind-?ra|brickwork|fitch|acuite)|sov|unrated|a1\+|^aaa|^aa|^a\+'
                                                             then 'Debt'
        when p_rating is not null                            then 'Equity'
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
           asset_class(h.section, h.sub_section, h.is_security,
                       h.industry_rating, h.coupon_pct, h.isin, h.instrument_name),
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
    select asset_class(section, sub_section, is_security,
                       industry_rating, coupon_pct, isin, instrument_name),
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
grant execute on function asset_class(text, text, boolean, text, numeric, text, text)
                                                                     to anon, authenticated;


-- ============================================================================
-- SMOKE TEST -- run with a code you know has holdings
-- ============================================================================
-- select * from search_schemes('flexi cap', 10);
-- select * from fund_overview('130501');
-- select * from holdings_metrics('130501');
-- select * from holdings_assets('130501');
-- select * from holdings_sectors('130501');
-- select * from holdings_list('130501') limit 20;
