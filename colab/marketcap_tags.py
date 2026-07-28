"""
Market-cap classification per ISIN  ->  security_meta

Feeds fund_marketcap(), style_drift() and marketcap_overview()
(sql/returns_and_caps.sql).

WHY THIS MATTERS
  SEBI writes category mandates against exactly one list: AMFI's half-yearly
  ranking of every listed company by average market capitalisation. Ranks
  1-100 are Large Cap, 101-250 Mid Cap, 251+ Small Cap. Tag holdings with it
  and you can ask whether a "Large Cap Fund" actually holds large caps -- which
  no AMC publishes about itself.

THE FILE CARRIES ISIN
  An earlier version of this script bridged AMFI company names to ISIN through
  NSE's equity list, because AMFI was assumed to publish names only. It does
  not: the sheet has an ISIN column. That removes the name matching entirely,
  and with it every chance of a wrong match -- which matters, since fuzzy
  matching was 35% wrong earlier in this project.

VERIFIED against AverageMarketCapitalization30Jun2026.xlsx:
  one sheet "FINAL", title in row 0, header in row 1, 5,427 companies,
  all ISINs unique and well-formed, Large 100 / Mid 150 / Small 5,177,
  boundaries exactly on rank 100/101 and 250/251.

AMFI publishes twice a year (periods ending 31 Mar and 30 Sep, released a few
months later), so this is a twice-yearly job, not a monthly one.

Run sql/returns_and_caps.sql first -- it creates security_meta.
Paste the whole file as ONE Colab cell.
"""

get_ipython().system('pip -q install openpyxl supabase')   # noqa: F821  (Colab magic)

import io, re, json, pandas as pd
from google.colab import files, userdata
from supabase import create_client

# ---------------------------------------------------------------------------
# 1. Upload
#    amfiindia.com -> Research & Information -> Other Data ->
#    Categorization of Stocks -> latest "Average Market Capitalization" xlsx
#
#    The page is JS-rendered, so requests.get finds no link in the HTML --
#    downloading by hand is the reliable path and takes seconds.
# ---------------------------------------------------------------------------
print("Upload the AMFI xlsx:")
blob = next(iter(files.upload().values()))

# ---------------------------------------------------------------------------
# 2. Parse. Row 0 is the title, row 1 the header.
#    as_of comes from the title, so re-running with a newer file dates itself.
# ---------------------------------------------------------------------------
title = str(pd.read_excel(io.BytesIO(blob), header=None, nrows=1).iloc[0, 0])
m = re.search(r"(\d{1,2}\s+\w+\s+\d{4})", title)
as_of = (pd.to_datetime(m.group(1), dayfirst=True).strftime("%Y-%m-%d")
         if m else pd.Timestamp.today().strftime("%Y-%m-%d"))
print(f"{title}\nas_of = {as_of}")

d = pd.read_excel(io.BytesIO(blob), header=1)
d.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in d.columns]

def col(pat):
    for c in d.columns:
        if re.search(pat, c, re.I):
            return c

c_isin = col(r"^isin$")
c_name = col(r"company")
c_cls  = col(r"categoriz|classification")     # "Categorization" -- note the z
c_cap  = col(r"average of all exchange")
c_rank = col(r"^sr")
c_sym  = col(r"nse symbol")
assert c_isin and c_name and c_cls, f"columns changed: {list(d.columns)}"

out = pd.DataFrame({
    "isin":             d[c_isin].astype(str).str.strip().str.upper(),
    "symbol":           d[c_sym].astype(str).str.strip() if c_sym else None,
    "company":          d[c_name].astype(str).str.replace(r"\s+", " ", regex=True).str.strip(),
    "market_cap_class": d[c_cls].astype(str).str.strip(),
    "cap_rank":         pd.to_numeric(d[c_rank], errors="coerce") if c_rank else None,
    "avg_mcap_cr":      pd.to_numeric(d[c_cap],  errors="coerce") if c_cap else None,
})
out["as_of"] = as_of

# df.isin is a DataFrame method, not the column -- always subscript it.
out = out[out["isin"].str.match(r"^IN[A-Z0-9]{9}\d$", na=False)]
out.loc[out["symbol"].isin(["-", "nan", "NaN"]), "symbol"] = None
out = out.drop_duplicates("isin")

print(f"\n{len(out):,} securities")
print(out["market_cap_class"].value_counts().to_string())
# Expect 100 / 150 / rest. Anything else means the sheet layout moved.

# ---------------------------------------------------------------------------
# 3. Push
# ---------------------------------------------------------------------------
sb = create_client("https://ulunrpbayvlazzxpqrpj.supabase.co",
                   userdata.get("SUPABASE_SERVICE_KEY"))

recs = json.loads(out.to_json(orient="records"))
sb.table("security_meta").delete().neq("isin", "").execute()
for i in range(0, len(recs), 500):
    sb.table("security_meta").insert(recs[i:i + 500]).execute()
print(f"pushed {len(recs):,}")

# ---------------------------------------------------------------------------
# 4. Verify in Supabase
# ---------------------------------------------------------------------------
#   select * from marketcap_overview();
#   select * from style_drift('Large Cap Fund');
#
# marketcap_overview() reports how much of the money actually held by the funds
# is now classified. With 5,427 companies covered, near all of the equity book
# should be -- what remains unclassified ought to be debt, cash, foreign and
# unlisted holdings, which is correct. If a large slice of equity is still
# unclassified, the funds hold ISINs this list does not carry, and style_drift
# is describing less of the book than it appears to.
