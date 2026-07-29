"""
Universal loader  --  drag files in, they land in mf_holdings

One cell, any number of AMCs, any number of months, in one go. Replaces the
per-AMC scripts: the AMC and the disclosure frequency are read off the filename,
the portfolio date is read out of the workbook itself, and nothing is pushed
until it has passed the same checks you would have run by hand.

    Cell 1 : colab/parser.py     (paste once per Colab session)
    Cell 2 : this file           (paste once, run every time)
    Then   : sql/after_load.sql  in Supabase

WHAT IT DOES NOT DO, deliberately: it will not invent an AMC code. A house is
identified by a short code ('HDFC', 'ICICI', 'Nippon') that must match what is
already in the database exactly -- 'HDFC' and 'HDFC MF' would become two
different fund houses, and every cross-fund number would quietly split in half.
Unrecognised files are listed and skipped, never guessed at.

LOADING AN OLDER MONTH IS SAFE. push() deletes per (amc, portfolio_date,
frequency), so June does not disturb July. That is how you light up the Changes
tab: load any house's previous month and every one of its schemes gains history.
"""

# !pip -q install requests pandas openpyxl xlrd supabase

import io, re, requests, pandas as pd
from supabase import create_client
from google.colab import files

SUPABASE_URL = "https://ulunrpbayvlazzxpqrpj.supabase.co"
SUPABASE_KEY = "PASTE_SERVICE_ROLE_KEY_HERE"      # service_role, not anon

sb   = create_client(SUPABASE_URL, SUPABASE_KEY)
push = make_push(sb)                               # from parser.py

# ============================================================================
# 1. Which house is this file from?
#
# Order matters -- the first match wins, so longer and more specific patterns
# come first. 'sbi' would otherwise match inside 'hsbc'.
#
# To add a house: put the short code you want stored on the left and a pattern
# that appears in its filenames on the right. Keep the code SHORT and reuse it
# forever; it is the join key for every cross-fund query.
# ============================================================================
AMC_PATTERNS = [
    ("HSBC",    r"hsbc"),
    ("SBI",     r"\bsbi\b|all[- ]schemes"),
    ("ICICI",   r"icici|ipru"),
    ("HDFC",    r"hdfc"),
    ("Nippon",  r"nippon|nimf|reliance"),
    ("ABSL",    r"aditya|birla|absl"),
    ("Kotak",   r"kotak"),
    ("Axis",    r"axis"),
    ("DSP",     r"\bdsp\b"),
    ("Mirae",   r"mirae"),
    ("Bandhan", r"bandhan|idfc"),
    ("Tata",    r"tata"),
    ("Motilal", r"motilal|\bmo\b|moamc"),
    ("Quantum", r"quantum"),
    ("Quant",   r"quant"),            # after Quantum, or it swallows it
    ("Invesco", r"invesco"),
    ("UTI",     r"\buti\b"),
    ("Franklin", r"franklin|templeton"),
    ("Edelweiss", r"edelweiss"),
    ("PPFAS",   r"ppfas|parag"),
    ("Canara",  r"canara|robeco"),
    ("Sundaram", r"sundaram"),
    ("LIC",     r"\blic\b"),
    ("Baroda",  r"baroda|bnp"),
    ("JM",      r"\bjm\b"),
    ("Navi",    r"navi"),
    ("WhiteOak", r"whiteoak|white oak"),
    ("Samco",   r"samco"),
    ("Trust",   r"trustmf|trust mutual"),
    ("360ONE",  r"360|iifl"),
    ("Abakkus", r"abakkus"),
    ("Groww",   r"groww"),
    ("Zerodha", r"zerodha"),
    ("Bajaj",   r"bajaj"),
    ("Helios",  r"helios"),
    ("Old Bridge", r"old ?bridge"),
    ("Unifi",   r"unifi"),
]

# Filename says nothing useful? Map it by hand here: {"weird_name.xlsx": "HDFC"}
AMC_OVERRIDE = {}


def detect_amc(fname):
    if fname in AMC_OVERRIDE: return AMC_OVERRIDE[fname]
    low = fname.lower()
    for code, pat in AMC_PATTERNS:
        if re.search(pat, low): return code
    return None


def detect_frequency(fname):
    low = fname.lower()
    if re.search(r"fortnight|15th|fn[- ]?portfolio", low): return "fortnightly"
    if re.search(r"half[- ]?year|halfyearly",        low): return "half-yearly"
    return "monthly"


# ============================================================================
# 2. Upload
#
# Drag every workbook in at once -- different houses, different months, mixed.
# ============================================================================
print("Upload the portfolio workbooks (any number, any AMC, any month):\n")
uploaded = files.upload()

# What the database already calls each house. A file that resolves to a code
# NOT in this list is a new house -- fine, but worth seeing before it is created.
known = {r["amc"] for r in
         sb.table("mf_holdings").select("amc").execute().data} if uploaded else set()

# ============================================================================
# 3. Parse and check -- nothing is pushed in this loop
# ============================================================================
parsed, skipped = [], []

for fname, blob in uploaded.items():
    amc  = detect_amc(fname)
    freq = detect_frequency(fname)
    print(f"\n{'=' * 70}\n{fname}")

    if not amc:
        print("  SKIPPED -- cannot tell which AMC this is.")
        print("  Fix: add a pattern to AMC_PATTERNS, or")
        print(f'        AMC_OVERRIDE = {{"{fname}": "SHORTCODE"}}')
        skipped.append((fname, "unknown AMC"))
        continue

    print(f"  AMC {amc}   frequency {freq}" +
          ("" if amc in known else "   <-- NEW HOUSE, not in the database yet"))

    try:
        df = parse_workbook(io.BytesIO(blob), amc, freq, fname)
    except Exception as e:
        print(f"  SKIPPED -- parse failed: {e}")
        skipped.append((fname, f"parse error: {e}"))
        continue

    if df.empty:
        print("  SKIPPED -- parsed to zero rows. Wrong file, or a layout the "
              "parser does not recognise.")
        skipped.append((fname, "zero rows"))
        continue

    ok, n_sch = verify(df, f"  {amc}")
    dates = sorted(d for d in df["portfolio_date"].dropna().unique())
    print(f"  dates           {', '.join(pd.Timestamp(d).strftime('%d-%b-%Y') for d in dates)}")

    # Two failures are worth stopping for, because pushing them corrupts the
    # database rather than merely adding nothing:
    #   NULL dates  -- push() asserts on these anyway
    #   <70% of schemes summing to 100 -- usually the 100x scale detection
    #                                     misfiring, which silently ruins AUM
    if df["portfolio_date"].isna().any():
        print("  SKIPPED -- some rows have no portfolio date.")
        skipped.append((fname, "null dates")); continue
    if n_sch and ok / n_sch < 0.70:
        print(f"  SKIPPED -- only {ok}/{n_sch} schemes sum to ~100%. Check the "
              "%NAV column before trusting this file.")
        skipped.append((fname, f"weights off ({ok}/{n_sch})")); continue

    parsed.append((fname, amc, df))

# ============================================================================
# 4. Summary, then push
#
# Everything that reaches here has passed. Nothing to confirm by hand -- the
# checks above are the confirmation, and anything doubtful was already skipped.
# ============================================================================
print(f"\n{'=' * 70}\nREADY TO PUSH\n")
for fname, amc, df in parsed:
    print(f"  {amc:10s} {df['scheme_name'].nunique():4d} schemes  "
          f"{len(df):7,} rows   {fname}")
if skipped:
    print("\nSKIPPED")
    for fname, why in skipped:
        print(f"  {why:24s} {fname}")

if not parsed:
    print("\nNothing to push.")
else:
    print()
    for fname, amc, df in parsed:
        push(df)

    print(f"\n{'=' * 70}")
    print("Pushed. Now run sql/after_load.sql in Supabase -- until you do, the")
    print("new funds are in mf_holdings but invisible to every market-wide")
    print("query, because the analytical layer is materialised.")
