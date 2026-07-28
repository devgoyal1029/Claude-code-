-- ============================================================================
-- Return leaderboards + market-cap tagging
-- ----------------------------------------------------------------------------
-- Two additions that both need data this database does not have yet. Tables and
-- RPCs go in now; the Colab scripts that fill them are:
--     colab/nav_monthly_ingest.py    -> scheme_nav_monthly
--     colab/marketcap_tags.py        -> security_meta
--
-- Until they are populated every function here returns empty rather than
-- failing, and the dashboard hides the sections.
-- ============================================================================


-- ============================================================================
-- 1. scheme_nav_monthly -- month-end NAV, one representative code per fund
-- ----------------------------------------------------------------------------
-- Month-end rather than daily, and one code per fund rather than all 4,060:
-- daily NAV for every plan would be millions of rows and does not fit the free
-- tier. Monthly is enough for CAGR and for ranking; the per-fund page still
-- pulls daily history live from api.mfapi.in for its chart and risk metrics.
--
-- Direct-Growth is the right code to store -- it is the standard comparison
-- basis, free of distributor commission, so leaderboards are not distorted by
-- plan choice.
-- ============================================================================
create table if not exists scheme_nav_monthly (
    scheme_code text    not null,
    month_end   date    not null,
    nav         numeric not null,
    primary key (scheme_code, month_end)
);

create index if not exists idx_navm_code on scheme_nav_monthly (scheme_code, month_end desc);

alter table scheme_nav_monthly enable row level security;
drop policy if exists "public read" on scheme_nav_monthly;
create policy "public read" on scheme_nav_monthly for select using (true);


-- ----------------------------------------------------------------------------
-- fund_returns_stored -- CAGR from stored monthly NAV.
--
-- Sub-year periods are absolute, longer ones annualised. The tolerance on the
-- lookback (45 days) exists because month-end NAV rarely lands exactly on the
-- anniversary date.
-- ----------------------------------------------------------------------------
create or replace function fund_returns_stored(p_scheme_code text)
returns table (period text, months int, from_date date, to_date date,
               from_nav numeric, to_nav numeric, return_pct numeric, annualised boolean)
language sql stable security definer set search_path = public
as $$
    with s as (select * from scheme_nav_monthly where scheme_code = p_scheme_code),
    last as (select * from s order by month_end desc limit 1),
    spec(period, m) as (values ('1M',1),('3M',3),('6M',6),('1Y',12),
                               ('2Y',24),('3Y',36),('5Y',60),('10Y',120))
    select sp.period, sp.m, b.month_end, l.month_end, b.nav, l.nav,
           case when sp.m > 12
                then round(((power(l.nav / b.nav, 12.0 / sp.m) - 1) * 100)::numeric, 2)
                else round(((l.nav / b.nav - 1) * 100)::numeric, 2) end,
           sp.m > 12
    from spec sp
    cross join last l
    join lateral (
        select * from s
        where s.month_end <= l.month_end - (sp.m || ' months')::interval
          and s.month_end >= l.month_end - (sp.m || ' months')::interval - interval '45 days'
        order by s.month_end desc limit 1
    ) b on true
    where b.nav > 0
    order by sp.m
$$;


-- ----------------------------------------------------------------------------
-- return_leaderboard -- rank a category by trailing return.
--
-- Volatility is annualised from MONTHLY returns (x sqrt(12)), so it will read
-- lower than the daily-based figure on a fund page. Monthly sampling smooths
-- intra-month drawdowns. Compare ranks within this table, not across the two.
-- ----------------------------------------------------------------------------
create or replace function return_leaderboard(p_months   int  default 36,
                                              p_category text default null,
                                              p_amc      text default null,
                                              lim        int  default 50)
returns table (scheme_code text,
               scheme_name text,
               amc         text,
               category    text,
               aum_cr      numeric,
               return_pct  numeric,
               annualised  boolean,
               volatility  numeric,
               sharpe      numeric,
               from_date   date,
               to_date     date)
language sql stable security definer set search_path = public
as $$
    with f as (
        select * from mv_fund_stats
        where scheme_code is not null
          and (p_category is null or category = p_category)
          and (p_amc      is null or amc      = p_amc)
    ),
    calc as (
        select f.scheme_code, f.scheme_name, f.amc, f.category, f.aum_cr, r.*
        from f
        join lateral (
            with s as (select * from scheme_nav_monthly n where n.scheme_code = f.scheme_code),
            l as (select s.month_end, s.nav from s order by s.month_end desc limit 1),
            -- explicit columns: `from s, l` puts two nav and two month_end in
            -- scope, and an unqualified reference to either is ambiguous
            b as (select s.month_end, s.nav
                    from s, l
                   where s.month_end <= l.month_end - (p_months || ' months')::interval
                     and s.month_end >= l.month_end - (p_months || ' months')::interval
                                        - interval '45 days'
                   order by s.month_end desc limit 1),
            m as (   -- monthly returns over the window, for volatility
                select s.month_end,
                       s.nav / lag(s.nav) over (order by s.month_end) - 1 as ret
                from s, l
                where s.month_end >= l.month_end - (p_months || ' months')::interval
            )
            select (select b.nav       from b) as from_nav,
                   (select l.nav       from l) as to_nav,
                   (select b.month_end from b) as from_date,
                   (select l.month_end from l) as to_date,
                   (select stddev_samp(m.ret) * sqrt(12) * 100
                      from m where m.ret is not null) as vol
        ) r on true
        where r.from_nav > 0 and r.to_nav > 0
    ),
    scored as (
        select *, case when p_months > 12
                       then (power(to_nav / from_nav, 12.0 / p_months) - 1) * 100
                       else (to_nav / from_nav - 1) * 100 end as ret
        from calc
    )
    select scheme_code, scheme_name, amc, category, aum_cr,
           round(ret::numeric, 2),
           p_months > 12,
           round(vol::numeric, 2),
           round(((ret - 6.5) / nullif(vol, 0))::numeric, 2),
           from_date, to_date
    from scored
    order by ret desc nulls last
    limit least(coalesce(lim, 50), 200)
$$;


-- ============================================================================
-- 2. security_meta -- market-cap classification per ISIN
-- ----------------------------------------------------------------------------
-- AMFI publishes a half-yearly list ranking every listed company by average
-- market cap: ranks 1-100 Large Cap, 101-250 Mid Cap, 251+ Small Cap. SEBI
-- category mandates are written against exactly this list, which is what makes
-- style-drift detection possible.
-- ============================================================================
create table if not exists security_meta (
    isin             text primary key,
    symbol           text,
    company          text,
    market_cap_class text,      -- Large Cap | Mid Cap | Small Cap
    cap_rank         int,
    avg_mcap_cr      numeric,
    as_of            date
);

create index if not exists idx_secmeta_class on security_meta (market_cap_class);

alter table security_meta enable row level security;
drop policy if exists "public read" on security_meta;
create policy "public read" on security_meta for select using (true);


-- ----------------------------------------------------------------------------
-- fund_marketcap -- a fund's Large/Mid/Small split.
--
-- unclassified_pct matters as much as the rest: it covers debt, cash, foreign
-- securities, unlisted holdings and anything the AMFI list does not carry.
-- A high number means the split below it is describing only part of the book.
-- ----------------------------------------------------------------------------
create or replace function fund_marketcap(p_scheme_code text)
returns table (market_cap_class text, holdings int, pct numeric, value_cr numeric)
language sql stable security definer set search_path = public
as $$
    select coalesce(m.market_cap_class, 'Unclassified'),
           count(*)::int,
           round(sum(c.pct_to_nav), 2),
           round(sum(c.market_value_lacs) / 100, 2)
    from mv_current c
    left join security_meta m on m.isin = c.isin
    where c.scheme_code = p_scheme_code and c.is_security
    group by 1
    order by 3 desc nulls last
$$;


-- ----------------------------------------------------------------------------
-- style_drift -- funds whose cap mix does not match what their name implies.
--
-- SEBI minimums: Large Cap >= 80% large, Mid Cap >= 65% mid, Small Cap >= 65%
-- small, Large & Mid >= 35% each. Measured against the classified portion of
-- the book, not the whole fund, so cash and debt do not manufacture a false
-- breach.
--
-- Read a flagged row as "worth checking", not "in violation": the mandate is
-- tested on a different date and on the AMFI list current at that date.
-- ----------------------------------------------------------------------------
create or replace function style_drift(p_category text default null, lim int default 100)
returns table (scheme_code   text,
               scheme_name   text,
               amc           text,
               category      text,
               aum_cr        numeric,
               large_pct     numeric,
               mid_pct       numeric,
               small_pct     numeric,
               classified_pct numeric,
               expected      text,
               shortfall_pp  numeric)
language sql stable security definer set search_path = public
as $$
    with mix as (
        select f.scheme_code, f.scheme_name, f.amc, f.category, f.aum_cr,
               sum(c.pct_to_nav) filter (where m.market_cap_class = 'Large Cap') lg,
               sum(c.pct_to_nav) filter (where m.market_cap_class = 'Mid Cap')   md,
               sum(c.pct_to_nav) filter (where m.market_cap_class = 'Small Cap') sm,
               sum(c.pct_to_nav) filter (where m.market_cap_class is not null)   cl
        from mv_fund_stats f
        join mv_current c on c.amc = f.amc and c.scheme_name = f.scheme_name and c.is_security
        left join security_meta m on m.isin = c.isin
        where f.scheme_code is not null
          and (p_category is null or f.category = p_category)
        group by 1, 2, 3, 4, 5
        having sum(c.pct_to_nav) filter (where m.market_cap_class is not null) > 20
    ),
    rel as (   -- share of the CLASSIFIED book, which is what the mandate tests
        select *, round(lg / cl * 100, 2) lgp, round(md / cl * 100, 2) mdp,
                  round(sm / cl * 100, 2) smp
        from mix
    )
    select scheme_code, scheme_name, amc, category, aum_cr, lgp, mdp, smp,
           round(cl, 2),
           case
             when category ilike '%large & mid%' or category ilike '%large and mid%'
                  then 'large >= 35% and mid >= 35%'
             when category ilike '%large cap%' then 'large >= 80%'
             when category ilike '%mid cap%'   then 'mid >= 65%'
             when category ilike '%small cap%' then 'small >= 65%'
             else null end,
           case
             when category ilike '%large & mid%' or category ilike '%large and mid%'
                  then greatest(35 - lgp, 35 - mdp, 0)
             when category ilike '%large cap%' then greatest(80 - lgp, 0)
             when category ilike '%mid cap%'   then greatest(65 - mdp, 0)
             when category ilike '%small cap%' then greatest(65 - smp, 0)
             else null end
    from rel
    where case
            when category ilike '%large & mid%' or category ilike '%large and mid%'
                 then lgp < 35 or mdp < 35
            when category ilike '%large cap%' then lgp < 80
            when category ilike '%mid cap%'   then mdp < 65
            when category ilike '%small cap%' then smp < 65
            else false end
    order by 11 desc nulls last
    limit least(coalesce(lim, 100), 300)
$$;


-- ----------------------------------------------------------------------------
-- marketcap_overview -- how much of the loaded universe is even classified.
-- ----------------------------------------------------------------------------
create or replace function marketcap_overview()
returns table (market_cap_class text, securities int, funds_holding int,
               total_value_cr numeric, share_pct numeric)
language sql stable security definer set search_path = public
as $$
    with t as (select sum(market_value_lacs) v from mv_current where is_security)
    select coalesce(m.market_cap_class, 'Unclassified'),
           count(distinct c.isin)::int,
           count(distinct (c.amc, c.scheme_name))::int,
           round(sum(c.market_value_lacs) / 100, 2),
           round(sum(c.market_value_lacs) / nullif((select v from t), 0) * 100, 2)
    from mv_current c
    left join security_meta m on m.isin = c.isin
    where c.is_security
    group by 1
    order by 4 desc nulls last
$$;


grant execute on function fund_returns_stored(text)                to anon, authenticated;
grant execute on function return_leaderboard(int, text, text, int) to anon, authenticated;
grant execute on function fund_marketcap(text)                     to anon, authenticated;
grant execute on function style_drift(text, int)                   to anon, authenticated;
grant execute on function marketcap_overview()                     to anon, authenticated;


-- ============================================================================
-- CHECK -- both return empty until the Colab scripts have run
-- ============================================================================
select (select count(*) from scheme_nav_monthly)                as nav_rows,
       (select count(distinct scheme_code) from scheme_nav_monthly) as nav_funds,
       (select count(*) from security_meta)                     as tagged_securities;

-- select * from marketcap_overview();
-- select * from return_leaderboard(36, 'Large Cap Fund');
-- select * from style_drift('Large Cap Fund');
