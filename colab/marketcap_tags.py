"""
Market-cap classification per ISIN  ->  security_meta

Feeds fund_marketcap(), style_drift() and marketcap_overview()
(sql/returns_and_caps.sql).

WHY THIS MATTERS
  SEBI writes category mandates against exactly one list: AMFI's half-yearly
  ranking of every listed company by average market cap. Ranks 1-100 are Large
  Cap, 101-250 Mid Cap, 251+ Small Cap. Tag holdings with it and you can ask
  whether a "Large Cap Fund" is actually holding large caps -- which is the
  single most saleable thing in this whole engine, because no AMC publishes it
  about itself.

THE JOIN PROBLEM
  AMFI's list carries company NAME and classification, not ISIN. mf_holdings is
  keyed on ISIN. So a bridge is needed, and NSE's equity list has both:
      SYMBOL, NAME OF COMPANY, ISIN NUMBER
  Chain: AMFI name -> NSE name -> ISIN -> mv_security.

  Name matching is the weak link, and this project has been burned by fuzzy
  matching before (35% wrong at similarity 0.8). So: exact match on a
  normalised name only, and everything that does not match is PRINTED for
  review rather than guessed at. Partial coverage that is correct beats full
  coverage that is wrong -- unmatched securities simply show as
  "Unclassified", which the dashboard states plainly.

NEITHER URL BELOW IS VERIFIED -- both were unreachable from the dev sandbox.
Cell 1 prints what it actually got. Check that before trusting cell 3.
"""

# ============================================================================
# CELL 1 -- AMFI market cap list
# ============================================================================
import io, re, json, requests, pandas as pd

AMFI_PAGE = "https://www.amfiindia.com/research-information/other-data/categorization-of-stocks"

s = requests.get(AMFI_PAGE, headers={"User-Agent": "Mozilla/5.0"}, timeout=120).text
links = re.findall(r'href="([^"]+\.(?:xlsx|xls))"', s, re.I)
print("candidate files on the page:")
for l in links[:20]:
    print("  ", l)

# Pick the newest-looking one, or paste the URL directly if the list above is
# not obvious.
AMFI_XLSX = links[0] if links else "PASTE_THE_XLSX_URL"
if AMFI_XLSX.startswith("/"):
    AMFI_XLSX = "https://www.amfiindia.com" + AMFI_XLSX

blob = requests.get(AMFI_XLSX, headers={"User-Agent": "Mozilla/5.0"}, timeout=180).content
raw = pd.read_excel(io.BytesIO(blob), header=None)
print(f"\n{raw.shape[0]} rows x {raw.shape[1]} cols")
print(raw.head(15).to_string())

# ---- If the automatic fetch fails, upload the file by hand instead: ----
# from google.colab import files
# up = files.upload()
# raw = pd.read_excel(io.BytesIO(next(iter(up.values()))), header=None)


# ============================================================================
# CELL 2 -- parse it
# ============================================================================
# Find the header row by looking for the classification column, rather than
# assuming a fixed offset -- AMFI moves it between releases.
hdr = None
for i in range(min(20, len(raw))):
    row = " ".join(str(v).lower() for v in raw.iloc[i].values if pd.notna(v))
    if "classification" in row or ("company" in row and "market cap" in row):
        hdr = i
        break
assert hdr is not None, "header row not found -- inspect raw.head(20) and set hdr manually"

amfi = pd.read_excel(io.BytesIO(blob), header=hdr)
amfi.columns = [re.sub(r"\s+", " ", str(c)).strip().lower() for c in amfi.columns]
print(list(amfi.columns))

def col(*pats):
    for p in pats:
        for c in amfi.columns:
            if re.search(p, c):
                return c
    return None

c_name = col(r"company|name of")
c_cls  = col(r"classification|category")
c_cap  = col(r"average market cap|avg.*cap|market cap")
c_rank = col(r"^sr|^s\.? ?no|rank")

amfi = amfi.rename(columns={c_name: "company", c_cls: "market_cap_class"})
if c_cap:  amfi = amfi.rename(columns={c_cap: "avg_mcap_cr"})
if c_rank: amfi = amfi.rename(columns={c_rank: "cap_rank"})

amfi = amfi[amfi["company"].notna() & amfi["market_cap_class"].notna()].copy()
amfi["market_cap_class"] = (amfi["market_cap_class"].astype(str).str.strip()
                            .str.replace(r"\s+", " ", regex=True).str.title()
                            .str.replace("Largecap", "Large Cap")
                            .str.replace("Midcap", "Mid Cap")
                            .str.replace("Smallcap", "Small Cap"))

print(f"\n{len(amfi):,} companies")
print(amfi["market_cap_class"].value_counts())
# Expect roughly 100 / 150 / everything else. Far off means the parse is wrong.


# ============================================================================
# CELL 3 -- NSE equity list, to get ISINs
# ============================================================================
NSE_CSV = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
sess = requests.Session()
sess.headers.update({"User-Agent": "Mozilla/5.0",
                     "Referer": "https://www.nseindia.com/"})
sess.get("https://www.nseindia.com", timeout=60)          # cookie handshake
nse = pd.read_csv(io.StringIO(sess.get(NSE_CSV, timeout=120).text))
nse.columns = [c.strip().upper() for c in nse.columns]
print(nse.shape, list(nse.columns)[:8])

nse = nse.rename(columns={"NAME OF COMPANY": "company",
                          "ISIN NUMBER": "isin", "SYMBOL": "symbol"})
nse = nse[["company", "isin", "symbol"]].dropna()

# Normalise for an EXACT join: strip the legal suffix and all punctuation.
def norm(x):
    x = str(x).lower()
    x = re.sub(r"\b(limited|ltd|private|pvt|india|the)\b", " ", x)
    return re.sub(r"[^a-z0-9]", "", x)

amfi["k"] = amfi["company"].map(norm)
nse["k"]  = nse["company"].map(norm)

merged = amfi.merge(nse[["k", "isin", "symbol"]].drop_duplicates("k"), on="k", how="left")
hit = merged["isin"].notna()
print(f"\nAMFI companies       {len(merged):,}")
print(f"matched to an ISIN   {hit.sum():,}  ({hit.mean()*100:.1f}%)")
print("\nUNMATCHED -- review these, do not guess:")
print(merged.loc[~hit, ["company", "market_cap_class"]].head(40).to_string(index=False))


# ============================================================================
# CELL 4 -- push, and report coverage against what the funds actually hold
# ============================================================================
from supabase import create_client
from google.colab import userdata

sb = create_client("https://ulunrpbayvlazzxpqrpj.supabase.co",
                   userdata.get("SUPABASE_SERVICE_KEY"))

out = merged.loc[hit, ["isin", "symbol", "company", "market_cap_class"]].copy()
for c in ("cap_rank", "avg_mcap_cr"):
    out[c] = pd.to_numeric(merged.loc[hit, c], errors="coerce") if c in merged else None
out["as_of"] = pd.Timestamp.today().strftime("%Y-%m-%d")
out = out.drop_duplicates("isin")

recs = json.loads(out.to_json(orient="records"))
sb.table("security_meta").delete().neq("isin", "").execute()
for i in range(0, len(recs), 500):
    sb.table("security_meta").insert(recs[i:i + 500]).execute()
print(f"pushed {len(recs):,} tagged securities")

# The number that decides whether style_drift is usable: how much of the money
# actually sitting in the funds is now classified. Below ~70% and the drift
# report is describing too little of the book to trust.
#
#   select * from marketcap_overview();
#   select * from style_drift('Large Cap Fund');
