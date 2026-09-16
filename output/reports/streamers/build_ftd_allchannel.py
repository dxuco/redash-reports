"""
All-channel FTD cohort, 2026 YTD vs the same months of 2025.

`build_streamers.py` answers a streamer question and so keeps only rows whose
aff_type is Streamer. This builds the same shape of cohort with that filter
removed, for every acquisition channel, and emits both years so the deck can
show a like-for-like prior-year column.

  ftd-report/cache/2025-*.json + 2026-*.json  ->  ftd-allchannel.json

Cohort rule, copied from build_streamers.py so the two agree where they overlap:
  a player is in year Y's cohort if a row in Y has ftd > 0; the FTD is once per
  player, so a second one is a data fault and the first is kept. `ftd` is a
  dollar amount, not a flag -- count distinct players, sum for money.

Money (deposits, bets, GGR, NGR, adjusted GGR, bonus cost) is summed over every
row in that year belonging to those players.
"""
import json, os, glob
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(ROOT, "ftd-report", "cache")
OUT = os.path.join(HERE, "ftd-allchannel.json")

# The players every report carves out by default, shared so a tenth report
# cannot quietly disagree about who is in the list. See ../carveout.py.
import sys
sys.path.insert(0, ROOT)
from carveout import CARVED as WHALE_SET


UNTAGGED = "(untagged streamer)"
YEARS = ["2025", "2026"]

# Per-streamer 2026 spend, from the streamer report's own build. Absent or
# stale, the country cost simply comes out empty rather than wrong.
try:
    _sd = json.load(open(os.path.join(HERE, "streamers-data.json"), encoding="utf-8"))
    STREAMER_INV = {s["a"]: s["inv"] for s in _sd["variants"]["all"]["streamers"]}
except (OSError, ValueError, KeyError):
    STREAMER_INV = {}
TIERS = ["Non Qualified", "Qualified", "Super Qualified"]
CHANNELS = ["Direct", "Affiliate", "Streamer"]

# Markets flagged for fraudulent signups in H1. Kept as a named list rather
# than typed into a slide so the figures move when the data does.
FRAUD_MARKETS = ["Kazakhstan", "Japan", "Brazil", "Russian Federation"]
H1_LAST = "06"


def num(v):
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def build_year(year):
    paths = sorted(glob.glob(os.path.join(CACHE, "%s-*.json" % year)))
    assert paths, "no %s caches in %s" % (year, CACHE)
    rows_by_month = {os.path.basename(p)[:-5]: json.load(open(p, encoding="utf-8"))
                     for p in paths}
    # Only whole months. The daily job writes the new month's cache before any
    # data lands in it, and then fills it a day at a time -- charting either an
    # empty file or a part-month would add a stub column and pit a full
    # prior-year month against a handful of days.
    import calendar as _cal
    whole = {}
    for mth, rows in rows_by_month.items():
        if not rows:
            continue
        last_seen = max((r.get("transaction_date") or "")[:10] for r in rows)
        yy, mm = int(mth[:4]), int(mth[5:])
        if last_seen[8:] == "%02d" % _cal.monthrange(yy, mm)[1]:
            whole[mth] = rows
    rows_by_month = whole
    months = sorted(rows_by_month)
    assert months, "no complete %s month in the caches" % year

    cutoff = ""
    for rows in rows_by_month.values():
        for r in rows:
            dt = (r.get("transaction_date") or "")[:10]
            if dt > cutoff:
                cutoff = dt

    # --- the cohort: first deposit landed in this year
    cohort = {}          # pid -> [month, ftd value, tier, channel, country]
    aff_of = {}          # pid -> acquiring affiliate username
    dupes = 0
    for m in months:
        for r in rows_by_month[m]:
            val = num(r.get("ftd"))
            if val <= 0:
                continue
            pid = r.get("player_id")
            if pid in WHALE_SET:
                continue
            if pid in cohort:
                dupes += 1
                continue
            cohort[pid] = [m, val,
                           r.get("ftd_type") or "Non Qualified",
                           r.get("aff_type") or "Direct",
                           r.get("player_country") or "Unknown"]
            aff_of[pid] = r.get("aff_username") or UNTAGGED

    idx = {m: i for i, m in enumerate(months)}
    n = len(months)

    count_by_tier = {t: [0] * n for t in TIERS}
    value_by_month = [0.0] * n
    count_by_channel = {c: [0] * n for c in CHANNELS}
    vbt_month = {t: [0.0] * n for t in TIERS}      # FTD value split by tier
    vbc_month = {c: [0.0] * n for c in CHANNELS}
    value_by_channel = defaultdict(float)
    n_by_channel = defaultdict(int)
    for pid, (m, val, tier, chan, _c) in cohort.items():
        i = idx[m]
        count_by_tier.setdefault(tier, [0] * n)[i] += 1
        vbt_month.setdefault(tier, [0.0] * n)[i] += val
        value_by_month[i] += val
        count_by_channel.setdefault(chan, [0] * n)[i] += 1
        vbc_month.setdefault(chan, [0.0] * n)[i] += val
        value_by_channel[chan] += val
        n_by_channel[chan] += 1

    # --- money for those players, over every row of the year
    # Kept per month, not just as a year total: 2026 stops mid-year, so a
    # prior-year money column has to be sliced to the same months or the
    # comparison silently pits eight months against twelve.
    FIELDS = [("dep", "deposit"), ("bet", "bet"), ("ggr", "ggr"),
              ("ngr", "ngr"), ("adj", "adjusted_ggr"), ("bonus", "bonus_cost"),
              ("wdr", "withdraw")]
    by_month = {kk: [0.0] * n for kk, _ in FIELDS}
    by_month["depn"] = [0.0] * n
    # Streamer-acquired players, rolled up by country: the FTD count comes from
    # the cohort row, the money from every row those players have in the year.
    st_ctry = defaultdict(lambda: {"ftd": 0, "ftdv": 0.0, "adj": 0.0, "dep": 0.0,
                                   "cost": 0.0, "paidFtd": 0})
    st_by_aff = defaultdict(lambda: defaultdict(int))   # streamer -> country -> FTDs
    for pid, (_m, val, _t, chan, ctry) in cohort.items():
        if chan == "Streamer":
            st_ctry[ctry]["ftd"] += 1
            st_ctry[ctry]["ftdv"] += val
            st_by_aff[aff_of[pid]][ctry] += 1
    for m in months:
        i = idx[m]
        for r in rows_by_month[m]:
            pid = r.get("player_id")
            if pid not in cohort:
                continue
            for kk, col in FIELDS:
                by_month[kk][i] += num(r.get(col))
            by_month["depn"][i] += num(r.get("deposit_count"))
            if cohort[pid][3] == "Streamer":
                cc = st_ctry[cohort[pid][4]]
                cc["adj"] += num(r.get("adjusted_ggr"))
                cc["dep"] += num(r.get("deposit"))
    money = {kk: sum(vals) for kk, vals in by_month.items()}
    money["depn"] = int(money["depn"])
    dep_by_month = by_month["dep"]

    tot_count = sum(sum(v) for v in count_by_tier.values())
    assert tot_count == len(cohort), "tier counts do not add up to the cohort"
    assert sum(sum(v) for v in count_by_channel.values()) == len(cohort), \
        "channel counts do not add up to the cohort"
    assert abs(sum(value_by_month) - sum(c[1] for c in cohort.values())) < 1, \
        "monthly FTD value does not add up"

    # Cost is held per streamer, never per country, so a country's cost is that
    # streamer's spend split across the countries their own FTDs came from.
    # An allocation, not a measurement -- and streamers with no deal on file
    # contribute FTDs but no cost, so CPA divides by paidFtd, not by ftd.
    for aff, by_ctry in st_by_aff.items():
        spend = STREAMER_INV.get(aff)
        if spend is None:
            continue
        n_aff = sum(by_ctry.values())
        for cc, n in by_ctry.items():
            st_ctry[cc]["cost"] += spend * n / n_aff
            st_ctry[cc]["paidFtd"] += n

    countries = {c[4] for c in cohort.values() if c[4] != "Unknown"}

    h1 = [c for c in cohort.values() if c[0][5:] <= H1_LAST]
    h1_flag = [c for c in h1 if c[4] in FRAUD_MARKETS]

    return {
        "year": year,
        "months": months,
        "cutoff": cutoff,
        "dupes": dupes,
        "ftd": len(cohort),
        "ftdv": round(sum(c[1] for c in cohort.values()), 2),
        "countries": len(countries),
        "countByTier": {t: count_by_tier.get(t, [0] * n) for t in TIERS},
        "valueByMonth": [round(x, 2) for x in value_by_month],
        "depByMonth": [round(x, 2) for x in dep_by_month],
        "moneyByMonth": {kk: [round(x, 2) for x in vals]
                         for kk, vals in by_month.items()},
        "countByChannel": {c: count_by_channel.get(c, [0] * n) for c in CHANNELS},
        "valueByChannel": {c: round(value_by_channel.get(c, 0.0), 2) for c in CHANNELS},
        "valueByChannelMonth": {c: [round(x, 2) for x in vbc_month.get(c, [0.0] * n)]
                                for c in CHANNELS},
        "valueByTierMonth": {t: [round(x, 2) for x in vbt_month.get(t, [0.0] * n)]
                             for t in TIERS},
        "nByChannel": {c: n_by_channel.get(c, 0) for c in CHANNELS},
        "streamerByCountry": {c: {kk: round(v, 2) if isinstance(v, float) else v
                                  for kk, v in vals.items()}
                              for c, vals in st_ctry.items()},
        "h1": {"ftd": len(h1), "ftdv": round(sum(c[1] for c in h1), 2)},
        "h1Flagged": {"markets": FRAUD_MARKETS,
                      "ftd": len(h1_flag),
                      "ftdv": round(sum(c[1] for c in h1_flag), 2)},
        "totals": {kk: (round(x, 2) if isinstance(x, float) else x)
                   for kk, x in money.items()},
    }


data = {y: build_year(y) for y in YEARS}

# Like-for-like: 2026 stops mid-year, so the prior-year column is trimmed to
# the same months rather than comparing eight months against twelve.
last = data[YEARS[-1]]["months"][-1][5:]
for y in YEARS:
    dy = data[y]
    keep = [i for i, m in enumerate(dy["months"]) if m[5:] <= last]
    dy["ytdMonths"] = [dy["months"][i] for i in keep]
    dy["ytd"] = {
        "ftd": sum(sum(dy["countByTier"][t][i] for i in keep) for t in TIERS),
        "ftdv": round(sum(dy["valueByMonth"][i] for i in keep), 2),
        "countByTier": {t: [dy["countByTier"][t][i] for i in keep] for t in TIERS},
        "valueByMonth": [dy["valueByMonth"][i] for i in keep],
        "countByChannel": {c: [dy["countByChannel"][c][i] for i in keep]
                           for c in CHANNELS},
        "money": {kk: round(sum(vals[i] for i in keep), 2)
                  for kk, vals in dy["moneyByMonth"].items()},
        "valueByChannel": {c: round(sum(dy["valueByChannelMonth"][c][i] for i in keep), 2)
                           for c in CHANNELS},
        "valueByChannelMonth": {c: [dy["valueByChannelMonth"][c][i] for i in keep]
                                for c in CHANNELS},
        "valueByTierMonth": {t: [dy["valueByTierMonth"][t][i] for i in keep]
                             for t in TIERS},
        "nByChannel": {c: sum(dy["countByChannel"][c][i] for i in keep)
                       for c in CHANNELS},
    }
    dy["ytd"]["money"]["depn"] = int(dy["ytd"]["money"]["depn"])

data["comparison"] = {"throughMonth": last, "years": YEARS}
json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)

for y in YEARS:
    dy = data[y]
    print(f"{y}: full-year {dy['ftd']:,} FTDs / ${dy['ftdv']:,.0f} · "
          f"YTD to {last} {dy['ytd']['ftd']:,} / ${dy['ytd']['ftdv']:,.0f} · "
          f"{dy['countries']} countries · dupes {dy['dupes']}")
    print("     channels", {c: dy["nByChannel"][c] for c in CHANNELS})
    print("     deposits ${:,.0f}  adj GGR ${:,.0f}  NGR ${:,.0f}"
          .format(dy["totals"]["dep"], dy["totals"]["adj"], dy["totals"]["ngr"]))
print("wrote", OUT)
