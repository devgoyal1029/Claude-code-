"""
Invesco -- find where the download links actually live

The disclosure page returns 1.59 MB of HTML and not one .xlsx href, and all five
category URLs return the same byte count: it is a single-page app whose file list
is built client-side. So the links exist somewhere the naive scrape cannot see --
inside a framework data blob, or behind a call the page makes after it loads.

This prints, it does not push. Nothing here touches the database. Read the output
and the shape of the site becomes obvious, at which point the loader can be
pointed at the real endpoint instead of at guessed URLs.

Run it as its own cell. parser.py is not needed.
"""

import subprocess, sys
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "requests"], check=False)

import re, json, collections, requests

URL = "https://www.invescomutualfund.com/literature-forms/monthly-holdings/equity"

S = requests.Session()
S.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
})

r = S.get(URL, timeout=120)
html = r.text
print(f"http {r.status_code}   {len(html):,} chars\n")


# ============================================================================
# 1. Which framework, and is the payload embedded?
#
# If the data is inside __NEXT_DATA__ or similar, no network call is needed at
# all -- the links are already in the HTML we just downloaded, as JSON.
# ============================================================================
print("=" * 74)
print("1. FRAMEWORK MARKERS")
print("=" * 74)
for m in ("__NEXT_DATA__", "__NUXT__", "__INITIAL_STATE__", "self.__next_f",
          "window.__data", "ng-version", "data-drupal", "wp-json", "_app/immutable"):
    if m in html:
        print(f"  FOUND  {m}")


# ============================================================================
# 2. Every file extension that appears anywhere in the page
#
# Tells us whether the workbooks are .xlsx at all. Some AMCs serve them as .ashx,
# some through an extensionless handler, some as .XLS uppercase.
# ============================================================================
print("\n" + "=" * 74)
print("2. FILE EXTENSIONS PRESENT")
print("=" * 74)
exts = collections.Counter(x.lower() for x in
                           re.findall(r'\.([A-Za-z0-9]{2,5})(?=["\'?\\])', html))
for ext, n in exts.most_common(30):
    print(f"  {n:6d}  .{ext}")


# ============================================================================
# 3. What the page says around a row we can see on screen
#
# The screenshot shows "Invesco India ELSS Tax Saver Fund - January-2026" with a
# Download button. Whatever field holds that button's target sits next to this
# text. This is the single most useful block of output here.
# ============================================================================
print("\n" + "=" * 74)
print("3. CONTEXT AROUND A KNOWN ROW")
print("=" * 74)
for kw in ("ELSS Tax Saver", "January-2026", "Monthly Holding"):
    i = html.find(kw)
    if i < 0:
        print(f"\n  '{kw}' -- not in the HTML at all (so the list is fetched "
              f"after load, not embedded)")
        continue
    print(f"\n  '{kw}' at offset {i:,}\n  " + "-" * 60)
    print(html[max(0, i - 500): i + 800].replace("\n", " ")[:1300])


# ============================================================================
# 4. URLs that look like a document or an API
# ============================================================================
print("\n" + "=" * 74)
print("4. CANDIDATE DOCUMENT / API URLS")
print("=" * 74)
pat = re.compile(
    r'["\'](/?[^"\'\s<>]{4,220}?'
    r'(?:download|document|asset|media|upload|/api/|graphql|sitecore|dam)'
    r'[^"\'\s<>]{0,220}?)["\']', re.I)
cands = sorted({m for m in pat.findall(html) if len(m) < 240})
print(f"  {len(cands)} candidates, showing up to 60:\n")
for c in cands[:60]:
    print(f"  {c}")


# ============================================================================
# 5. The old site
#
# The page header carries a "Switch to Old Site" link. Older AMC sites are plain
# server-rendered HTML with real hrefs, which is the easiest possible source.
# ============================================================================
print("\n" + "=" * 74)
print("5. OLD SITE LINK")
print("=" * 74)
old = re.findall(r'href=["\']([^"\']+)["\'][^>]*>[^<]{0,40}(?:old site|classic)',
                 html, re.I)
old += re.findall(r'["\'](https?://[^"\'\s]*(?:old|legacy|classic)[^"\'\s]*)["\']',
                  html, re.I)
for u in sorted(set(old))[:20]:
    print(f"  {u}")
if not old:
    print("  none in the HTML -- the header link is rendered client-side too")


print("\n" + "=" * 74)
print("FASTEST PATH, if the above is inconclusive")
print("=" * 74)
print("""
In Chrome on that page:
  1. F12 -> Network tab -> tick "Preserve log"
  2. Click one Download button
  3. Right-click the request that appears -> Copy -> Copy link address

One real URL is all that is needed. The pattern behind it -- a document id, a
date, a scheme code -- is then enough to build the rest, or to call the endpoint
the page itself calls and read every link from its response.
""")
