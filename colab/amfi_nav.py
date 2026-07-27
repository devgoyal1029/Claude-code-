"""
AMFI NAV fetch -- scheme name + NAV for every scheme_code.

Source: https://portal.amfiindia.com/spages/NAVAll.txt
        (www.amfiindia.com 302-redirects here)

This is the same file schemes_master was built from, so its scheme_code
joins straight onto v_fund_picker / v_scheme_plans.

NOTE: NAVAll.txt is a DAILY SNAPSHOT -- one NAV per scheme, today's only.
There is no history in it. For a NAV time series see the note at the bottom.

Run as Colab cells, split at the ==== markers.
"""

# ============================================================================
# CELL 1 -- fetch and eyeball the raw format before parsing
# ============================================================================
import requests, pandas as pd

URL = "https://portal.amfiindia.com/spages/NAVAll.txt"

raw = requests.get(URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=180).text
print(f"{len(raw):,} chars, {len(raw.splitlines()):,} lines\n")
print("\n".join(raw.splitlines()[:30]))

# Expected shape:
#   Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
#   <blank>
#   Open Ended Schemes(Debt Scheme - Banking and PSU Fund)      <- category banner
#   Aditya Birla Sun Life Mutual Fund                           <- AMC banner
#   119551;INF209KB1PA1;INF209KB1PB9;...- DIRECT - IDCW;107.6579;25-Jul-2026
#
# If the head does NOT look like this, stop and fix the parser below rather
# than trusting its output.


# ============================================================================
# CELL 2 -- parse
# ============================================================================
rows, amc, category = [], None, None

for line in raw.splitlines():
    s = line.strip()
    if not s:
        continue

    # Banner lines carry no semicolons. Category banners start with the
    # scheme-structure word; anything else at that level is the AMC name.
    if ";" not in s:
        if s.lower().startswith(("open ended", "close ended", "closed ended", "interval")):
            category = s
        else:
            amc = s
        continue

    p = s.split(";")
    if len(p) < 6 or p[0].strip().lower() == "scheme code":
        continue

    rows.append({
        "scheme_code":   p[0].strip(),
        "isin_growth":   p[1].strip() or None,
        "isin_reinvest": p[2].strip() or None,
        "scheme_name":   p[3].strip(),
        # "N.A." appears for schemes that did not publish -- coerce to NaN
        "nav":           pd.to_numeric(p[4].strip(), errors="coerce"),
        "nav_date":      pd.to_datetime(p[5].strip(), format="%d-%b-%Y", errors="coerce"),
        "amc_name":      amc,
        "category":      category,
    })

nav = pd.DataFrame(rows)

print(f"rows            {len(nav):,}")
print(f"unique codes    {nav.scheme_code.nunique():,}")
print(f"null nav        {nav.nav.isna().sum():,}")
print(f"null date       {nav.nav_date.isna().sum():,}")
print(f"nav_date range  {nav.nav_date.min()}  ->  {nav.nav_date.max()}")
print(f"amcs            {nav.amc_name.nunique()}")
print(f"categories      {nav.category.nunique()}")
nav.head(10)

# Sanity: rows should land near 37,600 (schemes_master was 37,613).
# A much smaller number means the banner/­data split above misfired.


# ============================================================================
# CELL 3 -- the actual test: look up the codes we have been using
# ============================================================================
TEST_CODES = ["130501", "145109"]

cols = ["scheme_code", "scheme_name", "nav", "nav_date", "amc_name", "category"]
print(nav[nav.scheme_code.isin(TEST_CODES)][cols].to_string(index=False))


# ============================================================================
# CELL 4 -- cross-check against Supabase: do our 4,060 codes resolve in AMFI?
# ============================================================================
from supabase import create_client
from google.colab import userdata

sb = create_client("https://ulunrpbayvlazzxpqrpj.supabase.co",
                   userdata.get("SUPABASE_SERVICE_KEY"))

# v_fund_picker keeps plan codes in an array -- flatten it
picker = pd.DataFrame(sb.table("v_fund_picker")
                        .select("amc,display_name,scheme_codes")
                        .execute().data)
codes = picker.explode("scheme_codes").rename(columns={"scheme_codes": "scheme_code"})
codes["scheme_code"] = codes["scheme_code"].astype(str)

merged = codes.merge(nav[["scheme_code", "scheme_name", "nav", "nav_date"]],
                     on="scheme_code", how="left")

print(f"codes in picker      {len(merged):,}")
print(f"found in AMFI        {merged.nav.notna().sum():,}")
print(f"missing from AMFI    {merged.nav.isna().sum():,}")

# Anything listed here is a code we offer but AMFI no longer publishes --
# usually a scheme that has since merged or wound up.
print(merged[merged.nav.isna()][["amc", "display_name", "scheme_code"]].head(20)
      .to_string(index=False))


# ============================================================================
# CELL 5 -- optional: store it, so the dashboard can show NAV next to holdings
# ============================================================================
# Supabase SQL first:
#
#   create table if not exists scheme_nav (
#     scheme_code text primary key,
#     scheme_name text,
#     isin_growth text,
#     isin_reinvest text,
#     nav numeric,
#     nav_date date,
#     amc_name text,
#     category text,
#     loaded_at timestamptz not null default now()
#   );
#   create index on scheme_nav (nav_date);
#   alter table scheme_nav enable row level security;
#   create policy "public read" on scheme_nav for select using (true);
#
# Then:
import json

up = nav.copy()
up["nav_date"] = up["nav_date"].dt.strftime("%Y-%m-%d")
recs = json.loads(up.to_json(orient="records"))      # NaN -> null

sb.table("scheme_nav").delete().neq("scheme_code", "").execute()
for i in range(0, len(recs), 500):
    sb.table("scheme_nav").insert(recs[i:i + 500]).execute()
print(f"pushed {len(recs):,}")


# ============================================================================
# NAV HISTORY -- not in this file
# ============================================================================
# NAVAll.txt is today only. For a series, either:
#
#   AMFI date range (all schemes, one call per window, heavy):
#     https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx
#         ?frmdt=01-Jun-2026&todt=30-Jun-2026
#
#   or per-scheme JSON, keyed by the same AMFI scheme_code:
#     https://api.mfapi.in/mf/{scheme_code}
#
# Neither was reachable from the dev sandbox, so both are unverified here --
# check the response shape before building on either.
