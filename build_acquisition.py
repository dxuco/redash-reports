#!/usr/bin/env python3
"""
build_acquisition.py — builds acquisition-2026.html from the Redash cache.

Data sources
  * Transactions: the FTD report's Redash cache (ftd-report/cache/2026-*.json),
    refreshed by 9-refresh-ftd-cache.bat. Same query (1732) the FTD report uses.
  * Cost: the NEWEST .xlsx in the folder set by COST_DIR in config.env
    (default: Desktop\\CPA 2.0). Drop an updated cost file there — no rename needed.

Output
  * acquisition-2026.html in C:\\redash-page (set by OUT_HTML), picked up by
    6-publish.bat via the MONTHLY list in publish-worker.js.

Usage:  python build_acquisition.py            (from this folder)
Requires: pip install openpyxl   (10-build-acquisition.bat does this for you)
"""
import os, sys, json, glob, pickle, collections
from datetime import datetime, date, timedelta

BASE = os.path.dirname(os.path.abspath(__file__))

# Today's aff_type/aff_source for a row's affiliate, corrected for a source
# re-categorisation (e.g. GetBlue2024: SEO -> Retargeting in 2025) or a
# hand-verified correction the source has not made yet (e.g. Fluxrise) --
# every cached row otherwise freezes whatever aff_source said the day its
# month was pulled. See ../affiliate_channel.py.
sys.path.insert(0, os.path.dirname(BASE))
from affiliate_channel import current_of

# ---------- config ----------
def load_config():
    cfg = {}
    p = os.path.join(BASE, "config.env")
    if os.path.exists(p):
        for raw in open(p, encoding="utf-8"):
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line: continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip().strip('"').strip("'")
    return cfg

CFG = load_config()
def cfg(k, d): return os.environ.get(k) or CFG.get(k) or d

def rp(p):
    """Resolve a config path: absolute stays as-is, relative is from THIS folder
    (not from wherever the .bat was started)."""
    p = os.path.expanduser(p)
    return p if os.path.isabs(p) else os.path.normpath(os.path.join(BASE, p))

CACHE_DIR = rp(cfg("CACHE_DIR", os.path.join("..", "ftd-report", "cache")))
COST_DIR  = rp(cfg("COST_DIR", os.path.join(os.path.expanduser("~"), "Desktop", "CPA 2.0")))
OUT_HTML  = rp(cfg("OUT_HTML", os.path.join("..", "acquisition-2026.html")))
COST_DRIVE_ID = cfg("COST_DRIVE_ID", "")
YEAR      = int(cfg("YEAR", "2026"))
EXCLUDE   = cfg("EXCLUDE_USER", "karolik777").lower()
CUT_OVERRIDE = cfg("CUT_DATE", "")          # YYYY-MM-DD to pin; empty = newest day in cache

def die(msg):
    print("\n  ERROR: " + msg + "\n"); sys.exit(1)

# ---------- cost file: live from Google Drive, else newest xlsx in COST_DIR ----------
def fetch_drive_cost(file_id):
    """Download the cost sheet from Google Drive. Works when the file is
    link-shared (Anyone with the link - Viewer). Returns a local path or None."""
    import urllib.request
    urls = [
        f"https://docs.google.com/spreadsheets/d/{file_id}/export?format=xlsx",
        f"https://drive.google.com/uc?export=download&id={file_id}",
        f"https://drive.usercontent.google.com/download?id={file_id}&export=download",
    ]
    dest = os.path.join(BASE, "cost_from_drive.xlsx")
    for u in urls:
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            if data[:2] == b"PK":            # real xlsx, not a Google login page
                open(dest, "wb").write(data)
                return dest
        except Exception:
            continue
    return None

COST_XLSX = None
if COST_DRIVE_ID:
    COST_XLSX = fetch_drive_cost(COST_DRIVE_ID)
    if COST_XLSX:
        print("  Cost file: downloaded live from Google Drive")
    else:
        print("  WARNING: could not download the cost sheet from Google Drive.")
        print("           (Is the file link-shared? Drive: Share -> Anyone with the link - Viewer)")
        print("           Falling back to the newest local .xlsx ...")
if not COST_XLSX:
    xls = sorted(glob.glob(os.path.join(COST_DIR, "*.xlsx")),
                 key=os.path.getmtime, reverse=True)
    xls = [f for f in xls if not os.path.basename(f).startswith("~$")]
    if not xls: die(f"No cost file: Drive download failed and no .xlsx in {COST_DIR}")
    COST_XLSX = xls[0]
    print(f"  Cost file: {os.path.basename(COST_XLSX)} (local fallback)")

# ---------- load cache ----------
files = sorted(glob.glob(os.path.join(CACHE_DIR, f"{YEAR}-*.json")))
if not files: die(f"No {YEAR}-*.json cache files in {CACHE_DIR}. Run 9-refresh-ftd-cache.bat first.")
print("  Cache months: " + ", ".join(os.path.basename(f)[:-5] for f in files))

def pdate(s):
    if not s: return None
    try: return datetime.strptime(str(s)[:10], "%Y-%m-%d").date()
    except ValueError: return None

def num(x):
    if x in (None, ""): return 0.0
    try: return float(x)
    except (TypeError, ValueError): return 0.0

START = date(YEAR, 1, 1)
maxd = None
rowsets = []
for f in files:
    d = json.load(open(f, encoding="utf-8"))
    rowsets.append(d)
    for r in d:
        td = pdate(r.get("transaction_date"))
        if td and (maxd is None or td > maxd): maxd = td
if maxd is None: die("No transaction dates found in the cache.")
CUT = pdate(CUT_OVERRIDE) or maxd
print(f"  Data through: {CUT}")

# ---------- aggregate per player (same schema the report builder expects) ----------
P = {}
reg_by_aff = collections.Counter(); reg_seen = set()
for dset in rowsets:
    for row in dset:
        td = pdate(row.get("transaction_date"))
        if not td or td < START or td > CUT: continue
        pid = row.get("player_id")
        d = P.get(pid)
        if d is None:
            _at, _as = current_of(row.get("aff_username"), row.get("aff_type"), row.get("aff_source"))
            d = P[pid] = {"isaff": _at or "", "affu": row.get("aff_username") or "",
                "affs": _as or "", "ctry": row.get("player_country") or "",
                "dep": 0.0, "ggr": 0.0, "ngr": 0.0, "agr": 0.0, "bonus": 0.0,
                "ftd": False, "ftdate": None, "ftdtype": "", "ftdamt": 0.0,
                "depdates": [], "depm": [0.0]*13, "agrm": [0.0]*13, "ngrm": [0.0]*13, "bonm": [0.0]*13}
        dep = num(row.get("deposit"))
        d["dep"] += dep; d["ggr"] += num(row.get("ggr")); d["ngr"] += num(row.get("ngr"))
        d["agr"] += num(row.get("adjusted_ggr")); d["bonus"] += num(row.get("bonus_cost"))
        if dep > 0: d["depdates"].append(td)
        d["depm"][td.month] += dep
        d["agrm"][td.month] += num(row.get("adjusted_ggr"))
        d["ngrm"][td.month] += num(row.get("ngr"))
        d["bonm"][td.month] += num(row.get("bonus_cost"))
        if row.get("sign_up") not in (None, ""):
            au = (row.get("aff_username") or "").lower()
            key = (pid, au)
            if key not in reg_seen:
                reg_seen.add(key); reg_by_aff[au] += 1
        if row.get("ftd") not in (None, ""):
            d["ftd"] = True; d["ftdate"] = td
            d["ftdtype"] = row.get("ftd_type") or ""; d["ftdamt"] = num(row.get("ftd"))
            _at, _as = current_of(row.get("aff_username"), row.get("aff_type"), row.get("aff_source"))
            d["isaff"] = _at or ""; d["affu"] = row.get("aff_username") or ""
            d["affs"] = _as or ""; d["ctry"] = row.get("player_country") or ""

for pid, d in P.items():
    if d["ftd"] and d["ftdate"]:
        f0 = d["ftdate"]
        d["r7"]  = any(f0 + timedelta(days=1) <= dt <= f0 + timedelta(days=7)  for dt in d["depdates"])
        d["r30"] = any(f0 + timedelta(days=1) <= dt <= f0 + timedelta(days=30) for dt in d["depdates"])
    d.pop("depdates", None)

pickle.dump({"P": P, "reg_by_aff": dict(reg_by_aff)}, open(os.path.join(BASE, "full.pkl"), "wb"))
cohort_n = sum(1 for d in P.values() if d["ftd"] and (d["affu"] or "").lower() != EXCLUDE)
print(f"  Players in window: {len(P):,}   FTD cohort: {cohort_n:,}")

# ---------- params for the section builders ----------
REF = CUT + timedelta(days=1)
def mlabel(dt): return dt.strftime("%b").replace(".", "") + " " + str(dt.day)
params = {"cut": [CUT.year, CUT.month, CUT.day], "ref": [REF.year, REF.month, REF.day],
          "cut_label": mlabel(CUT), "ref_label": mlabel(REF),
          "cost_xlsx": COST_XLSX, "out_html": os.path.abspath(OUT_HTML),
          "cache_dir": CACHE_DIR, "cost_drive_id": COST_DRIVE_ID}
json.dump(params, open(os.path.join(BASE, "params.json"), "w"))

# ---------- run the section builders ----------
import runpy
for script in ("gen_html.py", "gen_html2.py", "gen_html3.py", "gen_2025.py"):
    print(f"  Running {script} ...")
    try:
        runpy.run_path(os.path.join(BASE, script), run_name="__main__")
    except SystemExit as e:
        # gen_2025.py exits cleanly when the Data2025 sheet is missing/empty —
        # that must not stop the 2026 build. A real error code still stops.
        if e.code not in (0, None): raise

print(f"\n  Done -> {os.path.abspath(OUT_HTML)}")
print("  Now run 6-publish.bat to put it on the web.")
