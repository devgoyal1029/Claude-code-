-- ============================================================================
-- InvestVerdict tool — Supabase schema
-- Run this ONCE in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- All tables are prefixed iv_ so they can never collide with the master site's
-- tables (profiles, companies, templates, ...). The only link to the master
-- site is iv_analyses.profile_id -> public.profiles(id).
-- ============================================================================

-- 1. Saved analyses: one row per (owner, company). Everything the tool knows
--    about a company lives here as JSON — confirmed statements, the forecast
--    model, valuation results and market inputs.
create table if not exists public.iv_analyses (
  owner_key    text not null default 'anon',   -- profiles.id as text, or 'anon' when opened outside the master site
  company_key  text not null,                  -- lower(trim(company_name)) — stable identity for upserts
  company_name text not null,
  profile_id   uuid references public.profiles(id) on delete set null,
  units        text,
  statements   jsonb,                          -- the confirmed extraction (iv_confirmed)
  forecast     jsonb,                          -- the built 3-statement model (iv_forecast)
  valuations   jsonb,                          -- { dcf, ddm, bank, comps: {low, high} }
  market       jsonb,                          -- { price, shares }
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (owner_key, company_key)
);

-- 2. Extraction dedupe cache: annual reports are public documents — the same
--    PDF should cost ONE Gemini call ever, across all users of the tool.
create table if not exists public.iv_extractions (
  pdf_hash   text primary key,                 -- sha256 over the uploaded bytes (all files, in order)
  filenames  text[],
  result     jsonb not null,                   -- the parsed extraction JSON
  hits       integer not null default 0,
  created_at timestamptz not null default now()
);

-- 3. Shared "What is this?" term cache (optional — server falls back to its
--    local SQLite if this table is missing).
create table if not exists public.iv_terms (
  term_key    text primary key,
  term_label  text,
  explanation text not null,
  created_at  timestamptz not null default now()
);

-- updated_at maintenance ------------------------------------------------------
create or replace function public.iv_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists iv_analyses_touch on public.iv_analyses;
create trigger iv_analyses_touch
  before update on public.iv_analyses
  for each row execute function public.iv_touch_updated_at();

-- Row Level Security ----------------------------------------------------------
-- The tool deliberately runs WITHOUT login, so the publishable key (anon role)
-- needs read/write — but ONLY on these three iv_ tables. Your master-site
-- tables keep their own policies untouched. Note the trade-off: anyone holding
-- the publishable key can read/write iv_ rows; that is the no-login design.
alter table public.iv_analyses    enable row level security;
alter table public.iv_extractions enable row level security;
alter table public.iv_terms       enable row level security;

drop policy if exists iv_analyses_open    on public.iv_analyses;
drop policy if exists iv_extractions_open on public.iv_extractions;
drop policy if exists iv_terms_open       on public.iv_terms;

create policy iv_analyses_open    on public.iv_analyses    for all to anon, authenticated using (true) with check (true);
create policy iv_extractions_open on public.iv_extractions for all to anon, authenticated using (true) with check (true);
create policy iv_terms_open       on public.iv_terms       for all to anon, authenticated using (true) with check (true);

-- Helpful index for the dashboard's library listing
create index if not exists iv_analyses_owner_updated
  on public.iv_analyses (owner_key, updated_at desc);
