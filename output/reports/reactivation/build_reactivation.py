#!/usr/bin/env python3
"""Build reactivation-data.json for the Reactivation report.

Reads the 20 month caches (query 1732, player x day rows) and emits ONE compact
record per player who ever deposited. The page filters that array by lapse
window; it never re-aggregates cache rows, because the aggregation is the slow
part and it is done here, once.

Why per-player rows rather than pre-baked matrices: the page offers six lapse
windows x whale x blocked x profitable-only, and every panel (matrix, tiers,
breakdowns, top list) has to agree with every other. One array that every panel
reads from cannot disagree with itself; twenty-four pre-baked variants can.
21k rows is nothing to filter in JS.

Values in the cache arrive as STRINGS -- num() maps empty/None to 0.0, or sums
silently concatenate.
"""
import json, os, glob
from collections import defaultdict
from datetime import date, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "ftd-report", "cache")
OUT = os.path.join(HERE, "reactivation-data.json")
# The players every report carves out by default, shared so a tenth report
# cannot quietly disagree about who is in the list. See ../carveout.py.
import sys
sys.path.insert(0, os.path.join(HERE, ".."))
from carveout import CARVED as WHALE_SET, CARVE_NAMES, CARVE_LABEL

# deposit_count only exists in these four cached months -- the column was added
# to query 1732 after the others were pulled. Deposit DAYS is therefore the only
# frequency measure available across the whole history; these months let us
# measure the day -> transaction ratio instead of guessing it.
CAL_MONTHS = ("2025-07", "2025-08", "2026-07", "2026-08")


def num(v):
    if v is None or v == "":
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


# The cache carries full ISO names -- "United Kingdom of Great Britain and
# Northern Ireland" is 52 characters and pushes every column after it off the
# screen. Shorten for display only; the shortening must never merge two real
# countries into one label, which is checked below.
COUNTRY_SHORT = {
    "United Kingdom of Great Britain and Northern Ireland": "United Kingdom",
    "United States of America": "United States",
    "Macedonia (the former Yugoslav Republic of)": "Macedonia",
    "Congo (Democratic Republic of the)": "DR Congo",
    "Venezuela (Bolivarian Republic of)": "Venezuela",
    "Bolivia (Plurinational State of)": "Bolivia",
    "Lao People's Democratic Republic": "Laos",
    "Tanzania, United Republic of": "Tanzania",
    "Iran (Islamic Republic of)": "Iran",
    "Saint Martin (French part)": "Saint Martin",
    "Bosnia and Herzegovina": "Bosnia & Herz.",
    "Moldova (Republic of)": "Moldova",
    "United Arab Emirates": "UAE",
    "Korea (Republic of)": "South Korea",
    "Korea (Democratic People's Republic of)": "North Korea",
    "Palestine, State of": "Palestine",
    "Trinidad and Tobago": "Trinidad & Tob.",
    "Republic of Kosovo": "Kosovo",
    "Russian Federation": "Russia",
    "Brunei Darussalam": "Brunei",
    "Czech Republic": "Czechia",
    "Dominican Republic": "Dominican Rep.",
    "Syrian Arab Republic": "Syria",
    "Taiwan, Province of China": "Taiwan",
    "Viet Nam": "Vietnam",
    "Central African Republic": "Central African Rep.",
    "Northern Mariana Islands": "N. Mariana Is.",
    "British Indian Ocean Territory": "Brit. Indian Ocean Terr.",
    "Saint Vincent and the Grenadines": "St Vincent",
    "South Georgia and the South Sandwich Islands": "South Georgia",
    "Heard Island and McDonald Islands": "Heard & McDonald Is.",
}


def short_country(v):
    """Display name for a country. Falls back to stripping the ISO tail."""
    if not v:
        return v
    if v in COUNTRY_SHORT:
        return COUNTRY_SHORT[v]
    s = v
    if "(" in s:                       # "Foo (Republic of)" -> "Foo"
        s = s.split("(")[0].strip()
    if "," in s:                       # "Foo, Republic of"  -> "Foo"
        s = s.split(",")[0].strip()
    return s or v


def blank():
    return {"dep": 0.0, "ngr": 0.0, "bc": 0.0, "wd": 0.0, "bet": 0.0, "adj": 0.0,
            "days": set(), "months": set(), "amonths": set(),
            "ld": None, "fd": None, "lb": None, "meta": {}, "dep_days_list": []}


players = defaultdict(blank)
raw_countries = set()          # pre-shortening, for the collision check
cal_days = cal_tx = 0.0
adj_rows = ngr_rows = 0
first_day = "9999"; last_day = ""

files = sorted(glob.glob(os.path.join(CACHE, "*.json")))
print(f"{len(files)} months: {os.path.basename(files[0])[:7]} .. {os.path.basename(files[-1])[:7]}")

for path in files:
    month = os.path.basename(path)[:7]
    with open(path, "r", encoding="utf-8") as fh:
        rows = json.load(fh)
    mday = 0.0; mtx = 0.0
    seen_day = set()
    for r in rows:
        pid = r.get("player_id")
        if not pid:
            continue
        day = r.get("transaction_date") or ""
        if day:
            if day < first_day: first_day = day
            if day > last_day: last_day = day
        dep = num(r.get("deposit"))
        bet = num(r.get("bet"))
        p = players[pid]
        p["ngr"] += num(r.get("ngr"))
        # Adjusted GGR is computed upstream over a different scope -- it is NOT
        # raw GGR minus bonus cost, so it is summed as reported, never derived.
        p["adj"] += num(r.get("adjusted_ggr"))
        if r.get("adjusted_ggr") not in (None, ""): adj_rows += 1
        if r.get("ngr") not in (None, ""): ngr_rows += 1
        p["bc"] += num(r.get("bonus_cost"))
        p["wd"] += num(r.get("withdraw"))
        p["bet"] += bet
        # shorten on the way in, so the lookup table itself is short
        if r.get("player_country"):
            raw_countries.add(r["player_country"])
            p["meta"]["c"] = short_country(r["player_country"])
        for src, dst in (("username","u"),("aff_type","a"),
                         ("favourite_product","p"),("player_status","s"),
                         ("reg_date","r"),("first_deposit_date","f")):
            v = r.get(src)
            if v:
                p["meta"][dst] = v
        if dep > 0:
            p["dep"] += dep
            p["days"].add(day)
            p["months"].add(month)
            p["dep_days_list"].append((day, dep))
            if p["ld"] is None or day > p["ld"]: p["ld"] = day
            if p["fd"] is None or day < p["fd"]: p["fd"] = day
            if month in CAL_MONTHS:
                k = (pid, day)
                if k not in seen_day:
                    seen_day.add(k); mday += 1
                mtx += num(r.get("deposit_count"))
        # last BET day is its own thing -- a player can keep betting from a
        # balance long after their last deposit, which is exactly the gap this
        # report is looking for
        if bet > 0 and (p["lb"] is None or day > p["lb"]):
            p["lb"] = day
        if dep > 0 or bet > 0:
            p["amonths"].add(month)
    if month in CAL_MONTHS:
        cal_days += mday; cal_tx += mtx
    print(f"  {month}: {len(rows):>7,} rows   players {len(players):,}")

CAL = cal_tx / cal_days if cal_days else 0.0
print(f"\ncalibration: {cal_tx:,.0f} tx over {cal_days:,.0f} deposit-days = {CAL:.2f} tx/day")

LAST = date(int(last_day[:4]), int(last_day[5:7]), int(last_day[8:10]))

# ---------------------------------------------------------------- lookups
def lut(vals):
    u = sorted({v for v in vals if v})
    return u, {v: i for i, v in enumerate(u)}

depositors = {pid: p for pid, p in players.items() if p["dep"] > 0 and p["days"]}
print(f"depositors {len(depositors):,} of {len(players):,} players seen")

countries, ci = lut(p["meta"].get("c") for p in depositors.values())

# Shortening must not collapse two real countries onto one label -- that would
# silently merge their players in every breakdown on the page. Checked against
# the RAW values collected above, not the already-shortened ones.
short_of = {}
collisions = []
for c in sorted(raw_countries):
    sc = short_country(c)
    if sc in short_of and short_of[sc] != c:
        collisions.append((short_of[sc], c, sc))
    short_of.setdefault(sc, c)
if collisions:
    for a_, b_, sc in collisions:
        print(f"  COLLISION: {a_!r} and {b_!r} both shorten to {sc!r}")
    raise SystemExit("country shortening merged two countries -- fix COUNTRY_SHORT")
print(f"countries: {len(raw_countries)} raw -> {len(short_of)} shortened, no collisions")
print(f"countries: {len(countries)} distinct, longest label {max(len(c) for c in countries)} chars")
products,  pi = lut(p["meta"].get("p") for p in depositors.values())
affs,      ai = lut(p["meta"].get("a") for p in depositors.values())
statuses,  si = lut(p["meta"].get("s") for p in depositors.values())

from datetime import timedelta
# "Deposited a lot recently and has now gone quiet" is a different player from
# "was big two years ago". Lifetime value cannot separate them, so carry the
# last 90 days of deposits as its own figure.
CUT90 = (LAST - timedelta(days=90)).isoformat()

recs = []
for pid, p in depositors.items():
    nd = len(p["days"])
    adpu = p["dep"] / nd
    dsd = (LAST - date(int(p["ld"][:4]), int(p["ld"][5:7]), int(p["ld"][8:10]))).days
    dep90 = sum(v for dy, v in p["dep_days_list"] if dy >= CUT90)
    m = p["meta"]
    recs.append([
        pid,                                   # 0  player id
        m.get("u") or "",                      # 1  username
        ci.get(m.get("c"), -1),                # 2  country
        pi.get(m.get("p"), -1),                # 3  favourite product
        ai.get(m.get("a"), -1),                # 4  channel
        si.get(m.get("s"), -1),                # 5  status
        round(adpu, 2),                        # 6  ADPU per deposit-day
        nd,                                    # 7  deposit days
        round(p["dep"], 2),                    # 8  deposits
        round(p["ngr"] - p["bc"], 2),          # 9  net value
        dsd,                                   # 10 days since last deposit
        len(p["months"]),                      # 11 months with a deposit
        round(p["ngr"], 2),                    # 12 NGR
        round(p["bc"], 2),                     # 13 bonus cost
        round(p["wd"], 2),                     # 14 withdrawn
        p["ld"],                               # 15 last deposit day
        1 if pid in WHALE_SET else 0,          # 16 carved-out flag
        round(dep90, 2),                       # 17 deposits in the last 90 days
        round(p["adj"], 2),                    # 18 adjusted GGR (as reported)
        (m.get("f") or "")[:10],               # 19 first deposit (FTD) date
        p["lb"] or "",                         # 20 last bet day
        ((LAST - date(int(p["lb"][:4]), int(p["lb"][5:7]), int(p["lb"][8:10]))).days
         if p["lb"] else None),                # 21 days since last bet
    ])
recs.sort(key=lambda r: -r[9])

# ------------------------------------------------- observed return rates
# Every gap between consecutive deposit MONTHS is a lapse that ended in a
# return; the trailing gap to the end of the data is one that has not returned.
# At each gap length N only lapses with N months of runway left are counted, or
# a recent lapse would be scored as a failure it never had time to avoid.
months_sorted = sorted({os.path.basename(f)[:7] for f in files})
midx = {m: i for i, m in enumerate(months_sorted)}
NM = len(months_sorted)
returned = defaultdict(int); exposed = defaultdict(int)
for p in depositors.values():
    seq = sorted(midx[m] for m in p["months"])
    for a, b in zip(seq, seq[1:]):
        g = b - a
        if g >= 1:
            returned[g] += 1
            for n in range(1, g + 1): exposed[n] += 1
    for n in range(1, (NM - 1 - seq[-1]) + 1):
        exposed[n] += 1

rates = {}
for n in range(1, NM):
    if exposed[n] >= 50:
        rates[n] = round(sum(v for k, v in returned.items() if k >= n) / exposed[n], 5)

data = {
    "meta": {
        "first_day": first_day, "last_day": last_day,
        "months": NM, "cal_tx_per_day": round(CAL, 3),
        "cal_months": list(CAL_MONTHS),
        "generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "whale": CARVE_LABEL,
        "carvedOut": [{"player_id": i, "username": CARVE_NAMES.get(i, "")}
                      for i in sorted(WHALE_SET)],
        "depositors": len(recs),
        "cut90": CUT90,
        # adjusted GGR sits on far fewer rows than NGR -- the page says so
        # rather than letting the panel read as equally covered
        "adj_coverage": round(adj_rows / ngr_rows * 100) if ngr_rows else 0,
    },
    "adpuBands": [[0,25,"Under $25"],[25,50,"$25 - $50"],[50,100,"$50 - $100"],
                  [100,250,"$100 - $250"],[250,500,"$250 - $500"],[500,1000,"$500 - $1k"],
                  [1000,2500,"$1k - $2.5k"],[2500,5000,"$2.5k - $5k"],
                  [5000,10000,"$5k - $10k"],[10000,1e15,"$10k+"]],
    "freqBands": [[1,2,"1"],[2,3,"2"],[3,4,"3"],[4,6,"4-5"],[6,11,"6-10"],
                  [11,21,"11-20"],[21,51,"21-50"],[51,101,"51-100"],[101,1e9,"100+"]],
    "windows": [0, 7, 14, 21, 28, 60, 90, 180, 365],
    "lookups": {"country": countries, "product": products, "aff": affs, "status": statuses},
    "rates": rates,
    "players": recs,
}

with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(data, fh, separators=(",", ":"))
print(f"wrote {OUT} ({os.path.getsize(OUT)/1e6:.1f} MB, {len(recs):,} players)")
