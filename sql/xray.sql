-- ============================================================================
-- Portfolio X-ray -- look through a basket of funds to the securities beneath.
-- ----------------------------------------------------------------------------
-- The question an investor actually has: "I own these five funds. What do I
-- own?" Fund-level diversification is mostly an illusion -- four large-cap
-- funds routinely share 80% of their book, so the investor holds far fewer
-- distinct bets than fund count suggests.
--
-- p_codes   : scheme_codes, in any plan (Direct/Regular/IDCW all resolve to the
--             same portfolio)
-- p_amounts : rupees in each, positionally matched to p_codes. NULL or empty
--             means equal-weight.
--
-- Run after sql/engine_core.sql.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Shared resolver: scheme_code -> (amc, scheme_name) + basket weight.
--
-- Joining on mv_current.scheme_code directly would silently drop plans, since
-- that column holds one representative code per fund. Resolving through
-- scheme_base -> scheme_alias means any plan of a fund finds its portfolio.
-- ----------------------------------------------------------------------------
create or replace function xray_resolve(p_codes text[], p_amounts numeric[] default null)
returns table (code text, amc text, scheme_name text, wt numeric, amount numeric)
language sql stable security definer set search_path = public
as $$
    with inp as (
        select c.code::text as code,
               c.ord,
               coalesce(nullif(p_amounts[c.ord], 0), 1)::numeric as amt
        from unnest(p_codes) with ordinality as c(code, ord)
    ),
    tot as (select nullif(sum(amt), 0) t from inp)
    select distinct on (i.code)
           i.code,
           a.amc,
           a.source_name,
           i.amt / (select t from tot),
           i.amt
    from inp i
    join scheme_base  b on b.scheme_code::text = i.code
    join scheme_alias a on a.k = b.k
    order by i.code, a.amc, a.source_name
$$;


-- ----------------------------------------------------------------------------
-- xray_holdings -- the combined look-through portfolio.
--
-- weight_pct is the security's share of the whole basket: each fund's weight
-- in the security, scaled by that fund's share of the basket, summed.
-- ----------------------------------------------------------------------------
create or replace function xray_holdings(p_codes   text[],
                                         p_amounts numeric[] default null,
                                         lim       int       default 300)
returns table (isin        text,
               instrument  text,
               sector      text,
               asset_type  text,
               weight_pct  numeric,
               amount      numeric,
               funds       int,
               via         text)
language sql stable security definer set search_path = public
as $$
    with r as (select * from xray_resolve(p_codes, p_amounts)),
    grand as (select sum(amount) a from r)
    select c.isin,
           min(c.instrument),
           min(c.sector),
           min(c.asset_type),
           round(sum(c.pct_to_nav * r.wt), 4),
           round(sum(c.pct_to_nav * r.wt) / 100 * (select a from grand), 2),
           count(distinct (c.amc, c.scheme_name))::int,
           string_agg(distinct c.scheme_name, ' · ')
    from r
    join mv_current c on c.amc = r.amc and c.scheme_name = r.scheme_name
    where c.is_security and c.isin is not null
    group by c.isin
    order by 5 desc nulls last
    limit least(coalesce(lim, 300), 1000)
$$;


-- ----------------------------------------------------------------------------
-- xray_summary -- how diversified the basket really is.
--
-- effective_stocks (10000/HHI on the combined book) against raw holding count
-- is the headline: a basket of six funds holding 400 distinct names can still
-- behave like 25 equally-weighted positions.
--
-- shared_pct is the share of the basket sitting in securities that more than
-- one of the chosen funds holds -- the part where the funds duplicate rather
-- than diversify.
-- ----------------------------------------------------------------------------
create or replace function xray_summary(p_codes   text[],
                                        p_amounts numeric[] default null)
returns table (funds             int,
               total_amount      numeric,
               securities        int,
               hhi               numeric,
               effective_stocks  numeric,
               top_10_pct        numeric,
               largest_pct       numeric,
               largest_name      text,
               shared_securities int,
               shared_pct        numeric,
               sectors           int,
               top_sector        text,
               top_sector_pct    numeric,
               equity_pct        numeric,
               debt_pct          numeric,
               cash_pct          numeric)
language sql stable security definer set search_path = public
as $$
    with r as (select * from xray_resolve(p_codes, p_amounts)),
    h as (
        select c.isin,
               min(c.instrument) instrument,
               min(c.sector)     sector,
               min(c.asset_type) asset_type,
               sum(c.pct_to_nav * r.wt) w,
               count(distinct (c.amc, c.scheme_name)) nf
        from r join mv_current c on c.amc = r.amc and c.scheme_name = r.scheme_name
        where c.is_security and c.isin is not null
        group by c.isin
    ),
    ranked as (select *, row_number() over (order by w desc) rn from h),
    sect as (select sector, sum(w) p from h group by 1 order by 2 desc limit 1),
    other as (   -- non-security rows: TREPS, net current assets
        select sum(c.pct_to_nav * r.wt) w
        from r join mv_current c on c.amc = r.amc and c.scheme_name = r.scheme_name
        where not c.is_security
    )
    select (select count(*)::int from r),
           (select round(sum(amount), 2) from r),
           (select count(*)::int from h),
           round((select sum(w * w) from h), 1),
           round((10000 / nullif((select sum(w * w) from h), 0))::numeric, 1),
           round((select sum(w) from ranked where rn <= 10), 2),
           round((select max(w) from h), 2),
           (select instrument from ranked where rn = 1),
           (select count(*)::int from h where nf > 1),
           round((select sum(w) from h where nf > 1), 2),
           (select count(distinct sector)::int from h),
           (select sector from sect),
           round((select p from sect), 2),
           round((select sum(w) from h where asset_type = 'Equity'), 2),
           round((select sum(w) from h where asset_type = 'Debt'), 2),
           round((select coalesce(w, 0) from other), 2)
$$;


-- ----------------------------------------------------------------------------
-- xray_pairs -- pairwise overlap between the chosen funds.
--
-- This is where duplication becomes visible: two funds at 85% overlap are one
-- position wearing two expense ratios.
-- ----------------------------------------------------------------------------
create or replace function xray_pairs(p_codes text[])
returns table (code_a text, fund_a text, code_b text, fund_b text,
               overlap_pct numeric, common int)
language sql stable security definer set search_path = public
as $$
    with r as (select * from xray_resolve(p_codes, null)),
    h as (
        select r.code, r.amc, r.scheme_name, c.isin, c.pct_to_nav
        from r join mv_current c on c.amc = r.amc and c.scheme_name = r.scheme_name
        where c.is_security and c.isin is not null
    )
    select a.code, min(a.scheme_name), b.code, min(b.scheme_name),
           round(sum(least(a.pct_to_nav, b.pct_to_nav)), 2),
           count(*)::int
    from h a
    join h b on b.isin = a.isin and b.code > a.code
    group by a.code, b.code
    order by 5 desc nulls last
$$;


-- ----------------------------------------------------------------------------
-- xray_sectors -- combined sector allocation of the basket.
-- ----------------------------------------------------------------------------
create or replace function xray_sectors(p_codes   text[],
                                        p_amounts numeric[] default null)
returns table (sector text, weight_pct numeric, securities int)
language sql stable security definer set search_path = public
as $$
    with r as (select * from xray_resolve(p_codes, p_amounts))
    select c.sector,
           round(sum(c.pct_to_nav * r.wt), 2),
           count(distinct c.isin)::int
    from r join mv_current c on c.amc = r.amc and c.scheme_name = r.scheme_name
    where c.is_security
    group by c.sector
    order by 2 desc nulls last
$$;


grant execute on function xray_resolve(text[], numeric[])       to anon, authenticated;
grant execute on function xray_holdings(text[], numeric[], int) to anon, authenticated;
grant execute on function xray_summary(text[], numeric[])       to anon, authenticated;
grant execute on function xray_pairs(text[])                    to anon, authenticated;
grant execute on function xray_sectors(text[], numeric[])       to anon, authenticated;


-- ============================================================================
-- SMOKE TEST -- swap in codes that exist in v_scheme_plans
-- ============================================================================
-- select * from xray_resolve(array['130501','119551']);
-- select * from xray_summary(array['130501','119551'], array[100000, 50000]);
-- select * from xray_holdings(array['130501','119551'], array[100000, 50000], 25);
-- select * from xray_pairs(array['130501','119551']);
