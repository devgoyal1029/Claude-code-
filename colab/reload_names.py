"""
Re-parse the four AMCs whose scheme names came out wrong  ->  mf_holdings

Quant (7), Tata (6), Motilal (4) and SBI (2) carry an objective sentence or a
sheet code where the scheme name should be -- "Multi Cap Fund - An open ended
equity scheme investing across large cap, mid cap, small cap stocks" instead of
"Quant Multi Cap Fund". They were patched through scheme_alias, which fixed the
mapping but left the ugly string showing wherever the AMC's own name is
displayed, including the return leaderboard.

parser.py v5 fixes it at the source. Only these four AMCs need reloading; every
other AMC parses identically to before.

Holdings themselves do not change -- this only corrects scheme_name.

ORDER:
  1. paste colab/parser.py as a cell and run it
  2. run this
  3. run sql/after_load.sql in Supabase
"""

import io, requests, pandas as pd
from supabase import create_client
from google.colab import files

SUPABASE_URL = "https://ulunrpbayvlazzxpqrpj.supabase.co"
SUPABASE_KEY = "PASTE_SERVICE_ROLE_KEY_HERE"      # service_role

sb = create_client(SUPABASE_URL, SUPABASE_KEY)
push = make_push(sb)                               # from parser.py
UA = {"User-Agent": "Mozilla/5.0"}

# ============================================================================
# 1. Tata and Quant -- direct URLs
#
# These change every month. If a download 404s, find the current one on the
# AMC's disclosure page, or on
# advisorkhoj.com/form-download-centre/Mutual/<AMC-Slug>/Monthly-Portfolio-Disclosures
# -- but check the scheme count before trusting an advisorkhoj link: its
# "Axis June 2026" once pointed at a 5-scheme adhoc file, not the 88-scheme
# monthly.
# ============================================================================
SOURCES = {
    "Tata":  "https://betacms.tatamutualfund.com/system/files/2026-07/Monthly%20Portfolio%20as%20on%2030th%20June%202026.xlsx",
    "Quant": "https://www.quantmutual.com/Admin/disclouser/monthly_portfolio_june_30062026.xlsx",
}

parsed = {}
for amc, url in SOURCES.items():
    print(f"\n--- {amc} ---")
    r = requests.get(url, headers=UA, timeout=300)
    print(f"  http {r.status_code}  {len(r.content):,} bytes")
    df = parse_workbook(io.BytesIO(r.content), amc, "monthly", url.rsplit("/", 1)[-1])
    verify(df, amc)
    parsed[amc] = df

# ============================================================================
# 2. SBI and Motilal -- no public URL, upload by hand
#    Handoff names them as:
#      All-Schemes-Monthly-Portfolio---as-on-30th-June-2026.xlsx   (SBI,  124 sheets)
#      Scheme Portfolio Details June 20261.xlsx                     (Motilal, 87 sheets)
# ============================================================================
print("\nUpload the SBI and Motilal workbooks (both at once is fine):")
up = files.upload()

for fname, blob in up.items():
    amc = "SBI" if re.search(r"sbi|all[- ]schemes", fname, re.I) else "Motilal"
    print(f"\n--- {amc}  ({fname}) ---")
    df = parse_workbook(io.BytesIO(blob), amc, "monthly", fname)
    verify(df, amc)
    parsed[amc] = df

# ============================================================================
# 3. Compare against what is already loaded, THEN push
#
# Scheme counts must match what is in the database. A drop means the parser
# lost schemes and pushing would delete them -- stop and investigate instead.
# ============================================================================
live = pd.DataFrame(sb.table("mf_holdings").select("amc,scheme_name")
                      .in_("amc", list(parsed)).execute().data)
print("\nscheme counts: parsed vs live")
for amc, df in parsed.items():
    now = df["scheme_name"].nunique()
    was = live[live.amc == amc]["scheme_name"].nunique() if len(live) else 0
    flag = "  <-- CHECK" if now < was else ""
    print(f"  {amc:8s} parsed {now:4d}   live {was:4d}{flag}")

# Only push once the counts above look right.
for amc, df in parsed.items():
    print(f"\npushing {amc}")
    push(df)

# ============================================================================
# 4. In Supabase, run sql/after_load.sql
#
# The new names are new rows in mf_holdings, so scheme_alias needs the auto
# insert re-run and the materialised views need rebuilding. The old alias rows
# pointing at the ugly names stay behind harmlessly -- they simply stop
# matching anything.
#
# Then confirm the names are clean:
#   select distinct scheme_name from mf_holdings
#   where amc in ('Quant','Tata','Motilal','SBI')
#     and (length(scheme_name) > 90 or scheme_name ~ '^[A-Z]{2,}[0-9]');
# -- should return no rows
# ============================================================================
