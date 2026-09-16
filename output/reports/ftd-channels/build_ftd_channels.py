# Builds ftd-channels-data.json from the query-1732 month caches.
#
# FTD count / FTD amount by player country and acquisition channel, 2025 vs 2026.
#
#   python build_ftd_channels.py
#   python make_ftd_channels_html.py
#
# `ftd` in the cache is a DOLLAR AMOUNT, not a flag. Count distinct player_id
# with ftd > 0; summing the field gives the amount, never the count.

import json, os, glob
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(ROOT, "ftd-report", "cache")

# The players every report carves out by default, shared so a tenth report
# cannot quietly disagree about who is in the list. See ../carveout.py.
import sys
sys.path.insert(0, ROOT)
from carveout import CARVED as WHALE_SET, CARVE_LABEL, CARVE_FIRST

YEARS = ["2025", "2026"]

# --- channel rule -----------------------------------------------------------
# Reproduces the attribution comment in acquisition-report/gen_2025.py:
#   Streamer / aff_source Influence -> the influencer channel
#   aff_source SEO                  -> SEO
#   aff_type Direct                 -> Direct
# Everything else (Meta, Tipster, Community, Metamedia, PPC, DSP, Uncategorized,
# untagged Affiliate) lands in Other so the bands reconcile to the site total.
# Source beats type: the 6 rows/month tagged Direct + SEO are counted as SEO.
CHANNELS = ["Direct", "SEO", "Streamer", "Other"]

# --- current affiliate categorisation ---------------------------------------
# aff_source is a CURRENT property of the affiliate, but each cached row froze
# whatever it said the day that month was pulled. So a re-categorisation never
# reaches history: GetBlue2024 was re-tagged SEO -> Retargeting, and the cache
# read SEO for January to August and Retargeting for September -- the same
# affiliate on both sides of every year-on-year comparison.
#
# affiliate-map.json is today's mapping for all ~1,300 affiliates, and
# affiliate-overrides.json layers hand-verified corrections on top of it for
# affiliates the map is faithfully wrong about (Fluxrise: the map says SEO
# because bi.players_info_mv still says SEO, and the override says Retargeting
# because that's what the affiliate actually is). Both are applied to every
# row whatever the row itself says, so one categorisation covers all history.
#
# This used to be defined here and only here -- current_of() now lives in
# ../affiliate_channel.py so every other builder that buckets by aff_source
# reads the same corrected values instead of each keeping its own copy. See
# that module's header for the refresh query and the full reasoning.
#
# Missing either file is not fatal -- current_of() falls back to the row's own
# values, which is the old behaviour rather than a hard stop.
# (sys.path already carries ROOT, from the carveout import above.)
from affiliate_channel import current_of, AFF_MAP, AFF_OVR, MAP_LOADED

if MAP_LOADED:
    print("affiliate map: %s affiliates, applied to every month"
          % format(len(AFF_MAP), ","))
else:
    print("affiliate-map.json missing - falling back to each row's own aff_source,"
          " which freezes old categorisations into history")
if AFF_OVR:
    print("affiliate overrides: %d correction(s) applied on top of the map (%s)"
          % (len(AFF_OVR), ", ".join(sorted(AFF_OVR))))


def channel_of(aff_type, aff_source):
    at = aff_type or ""
    src = aff_source or ""
    if at == "Streamer" or src in ("Influence", "KOl"):
        return "Streamer"
    if src == "SEO":
        return "SEO"
    if at == "Direct":
        return "Direct"
    return "Other"

# --- payment rail -----------------------------------------------------------
# Copied verbatim from ftd-report/month-aggregate.js. Two pages that classify
# rails differently is a worse bug than either being slightly wrong, so a new
# rail must be added in BOTH places in the same change. Unknown values are
# printed at the end of a build rather than defaulting silently into crypto.
FIAT_RAILS = {
    "apple pay", "google pay", "interac", "mastercard", "mbway", "neteller",
    "paysafecard", "pix", "revolut", "sepa", "skrill", "visa", "wise",
    "astropay", "bancontact", "blik", "boleto", "bunq", "eps", "giropay",
    "ideal", "jeton", "klarna", "mifinity", "muchbetter", "n26", "open banking",
    "sofort", "trustly", "upi", "multibanco",
}
KNOWN_RAILS = FIAT_RAILS | {
    "bnb", "btc", "btc-2", "bitcoin", "doge", "dogecoin", "ethereum", "eth",
    "litecoin", "ltc", "mercado", "polygon", "matic", "solana", "sol", "tron",
    "trx", "usdt", "usdc", "ton", "xrp", "ripple", "cardano", "ada", "dash",
    "avalanche", "avax", "bch", "monero", "xmr", "stellar", "xlm", "arbitrum",
    "optimism", "base", "shib",
}
RAILS = ["Crypto", "Fiat", "Mixed"]
unknown_rails = set()

def rail_code(value):
    v = str(value or "").strip().lower()
    if not v:
        return ""
    if v not in KNOWN_RAILS:
        unknown_rails.add(value)
    return "f" if v in FIAT_RAILS else "c"

def num(v):
    if v in (None, "", "None"):
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0

# --- scan -------------------------------------------------------------------
# rec[(year, month, country, channel, rail)] = [count, amount] for ex / inc
rec = {"ex": defaultdict(lambda: [0, 0.0]), "inc": defaultdict(lambda: [0, 0.0])}
# Same grain again, but every month trimmed to the day count the newest month
# reaches, so a part month compares like for like against complete ones. The
# month-on-month movement table is meaningless without this: August to the 26th
# against a whole July would show a collapse that is only the calendar.
mtd_rows = []          # (day, year, month, country, channel, rail, aff, amount)
# Same grain plus the affiliate, for the drill table under the country charts.
# Only ~4,900 keys across 20 months, so it inlines without thought.
aff_rec = defaultdict(lambda: [0, 0.0])
NO_AFF = "(direct / untagged)"
# pid -> (ftd month, country, channel, rail, day) for the cohort GGR pass below
ftd_player = {}
# pid -> aff_type / aff_source, taken from ANY row that carries them.
#
# An adjusted_ggr row carries aff_type but never aff_source, so on its own it
# cannot tell SEO from the rest of Affiliate. The attribution is a property of
# the player, not of the row, so it is collected across every row and looked up
# — which is what lets the adjusted GGR card use the same four channels as the
# rest of the page instead of a coarser second taxonomy.
pl_type = {}
pl_src = {}
pl_aff = {}
seen_pids = set()          # an FTD is once per player; guard against a repeat
dupes = 0
raw_rows = 0
src_seen = defaultdict(int)
rail_seen = defaultdict(int)
no_rail = 0
months_by_year = defaultdict(set)
max_day = {}

for path in sorted(glob.glob(os.path.join(CACHE, "*.json"))):
    month = os.path.basename(path)[:-5]          # YYYY-MM
    year = month[:4]
    if year not in YEARS:
        continue
    rows = json.load(open(path, encoding="utf-8"))

    # An FTD row carries no `blockchain` — that lives on the deposit rows. Every
    # FTD in this window has a same-player, same-day deposit row (asserted
    # below), so the rail is read across from there. A day with both a card and
    # a coin deposit is Mixed, not silently assigned to one of them.
    day_rails = defaultdict(set)
    for r in rows:
        if r.get("deposit"):
            code = rail_code(r.get("blockchain"))
            if code:
                day_rails[(r.get("player_id"), (r.get("transaction_date") or "")[:10])].add(code)

    for r in rows:
        _pid = r.get("player_id")
        if _pid:
            if r.get("aff_type") and _pid not in pl_type:
                pl_type[_pid] = r["aff_type"]
            if r.get("aff_source") and _pid not in pl_src:
                pl_src[_pid] = r["aff_source"]
            # the username too, so the adjusted-GGR rows can be re-categorised
            # by the same current map as everything else
            if r.get("aff_username") and _pid not in pl_aff:
                pl_aff[_pid] = r["aff_username"]

    for r in rows:
        amt = num(r.get("ftd"))
        if amt <= 0:
            continue
        raw_rows += 1
        pid = r.get("player_id") or ""
        if pid in seen_pids:
            dupes += 1
            continue
        seen_pids.add(pid)

        day = (r.get("transaction_date") or "")[:10]
        if day:
            max_day[year] = max(max_day.get(year, ""), day)
        ctry = (r.get("player_country") or "").strip() or "Unknown"
        _at, _as = current_of(r.get("aff_username"), r.get("aff_type"), r.get("aff_source"))
        ch = channel_of(_at, _as)
        src_seen[(_at or "-", _as or "-", ch)] += 1
        months_by_year[year].add(month)

        codes = day_rails.get((pid, day), set())
        if not codes:
            rail = "Not recorded"
            no_rail += 1
        elif len(codes) > 1:
            rail = "Mixed"
        else:
            rail = "Fiat" if "f" in codes else "Crypto"
        rail_seen[rail] += 1

        key = (year, month, ctry, ch, rail)
        rec["inc"][key][0] += 1
        rec["inc"][key][1] += amt
        if pid not in WHALE_SET:
            rec["ex"][key][0] += 1
            rec["ex"][key][1] += amt
            aff = (r.get("aff_username") or "").strip() or NO_AFF
            ak = (year, month, ctry, ch, rail, aff)
            aff_rec[ak][0] += 1
            aff_rec[ak][1] += amt
            mtd_rows.append((int(day[8:10]) if day else 99,
                             year, month, ctry, ch, rail, aff, amt))
            ftd_player[pid] = (month, ctry, ch, rail,
                               int(day[8:10]) if day else 99, aff)

# --- cohort GGR -------------------------------------------------------------
# GGR booked by the players who first deposited in the window, during that same
# window. Keyed on BOTH months -- the month the player was acquired and the
# month the revenue landed -- because a window sum must include only revenue
# that falls inside it, and a player acquired in January keeps earning in
# August.
#
# A second pass over the caches, not a bigger first one: a player can have a GGR
# row in a month earlier than their own FTD (bonus play before the first real
# deposit), and a single forward pass would silently drop it.
# Adjusted GGR by country. Its rows carry player_country and aff_type but NEVER
# aff_source (nor game_product — the same shape the skill documents), so this
# can be split by country and by nothing else on this page: the Channel filter
# uses a taxonomy that needs aff_source, and the Rail filter needs a deposit
# row. Both variants are emitted because the top depositor is ~61% of adjusted
# GGR, which is the one place on this page where he is material.
adj_rec = {"ex": defaultdict(lambda: [0.0, 0.0]), "inc": defaultdict(lambda: [0.0, 0.0])}
# Deposits, same grain and same per-player channel lookup as adjusted GGR.
# Both variants matter here more than anywhere: the top depositor is ~68% of
# deposited dollars, so ex-whale is the figure the business runs at.
dep_rec = {"ex": defaultdict(lambda: [0.0, 0.0]), "inc": defaultdict(lambda: [0.0, 0.0])}
adj_unsourced = [0.0]   # Affiliate players whose aff_source was never seen

cohort = defaultdict(lambda: [0.0, 0.0])      # [full, both months cut at MTD_DAYS]
cohort_aff = defaultdict(lambda: [0.0, 0.0])  # the same, keyed on the affiliate
_newest = max(max_day.values()) if max_day else ""
MTD_DAYS = int(_newest[8:10]) if _newest else 31

for path in sorted(glob.glob(os.path.join(CACHE, "*.json"))):
    gmonth = os.path.basename(path)[:-5]
    if gmonth[:4] not in YEARS:
        continue
    for r in json.load(open(path, encoding="utf-8")):
        dv = r.get("deposit")
        if dv not in (None, "", "None"):
            dnum = num(dv)
            if dnum != 0.0:
                dpid = r.get("player_id")
                dctry = (r.get("player_country") or "").strip() or "Unknown"
                dch = channel_of(pl_type.get(dpid, r.get("aff_type")), pl_src.get(dpid))
                dd = (r.get("transaction_date") or "")[8:10]
                dwithin = (int(dd) if dd.isdigit() else 99) <= MTD_DAYS
                dk = (gmonth[:4], gmonth, dctry, dch)
                dep_rec["inc"][dk][0] += dnum
                if dwithin:
                    dep_rec["inc"][dk][1] += dnum
                if dpid not in WHALE_SET:
                    dep_rec["ex"][dk][0] += dnum
                    if dwithin:
                        dep_rec["ex"][dk][1] += dnum

        av = r.get("adjusted_ggr")
        if av not in (None, "", "None"):
            a = num(av)
            if a != 0.0:
                apid = r.get("player_id")
                actry = (r.get("player_country") or "").strip() or "Unknown"
                _aat, _aas = current_of(pl_aff.get(apid),
                                        pl_type.get(apid, r.get("aff_type")),
                                        pl_src.get(apid))
                ach = channel_of(_aat, _aas)
                if pl_type.get(apid) == "Affiliate" and apid not in pl_src:
                    adj_unsourced[0] += abs(a)
                gd0 = (r.get("transaction_date") or "")[8:10]
                within = (int(gd0) if gd0.isdigit() else 99) <= MTD_DAYS
                k = (gmonth[:4], gmonth, actry, ach)
                adj_rec["inc"][k][0] += a
                if within:
                    adj_rec["inc"][k][1] += a
                if r.get("player_id") not in WHALE_SET:
                    adj_rec["ex"][k][0] += a
                    if within:
                        adj_rec["ex"][k][1] += a

        g = r.get("ggr")
        if g in (None, "", "None"):
            continue
        f = ftd_player.get(r.get("player_id"))
        if not f:
            continue
        gv = num(g)
        if gv == 0.0:
            continue
        fmonth, fctry, fch, frail, fday, faff = f
        gd = (r.get("transaction_date") or "")[8:10]
        gday = int(gd) if gd.isdigit() else 99
        within = fday <= MTD_DAYS and gday <= MTD_DAYS
        k = (fmonth, gmonth, fctry, fch, frail)
        cohort[k][0] += gv
        ka = (fmonth, gmonth, faff, fch, frail)
        cohort_aff[ka][0] += gv
        if within:
            cohort[k][1] += gv
            cohort_aff[ka][1] += gv

# --- shape ------------------------------------------------------------------
# Emitted as flat cells so the page can slice by year / month / country /
# channel without the builder guessing which slices it will want.
def cells(variant):
    out = []
    for (year, month, ctry, ch, rail), (c, a) in sorted(rec[variant].items()):
        out.append([year, month, ctry, ch, rail, c, round(a, 2)])
    return out

months_all = sorted({m for ms in months_by_year.values() for m in ms})
# Jan-Aug matched window: every 2025 month trimmed to the months 2026 has.
m26 = sorted(months_by_year.get("2026", []))
matched_months = {m[5:] for m in m26}

data = {
    "generated": max(max_day.values()) if max_day else "",
    "years": YEARS,
    "channels": CHANNELS,
    "months": months_all,
    "matchedMonths": sorted(matched_months),
    "lastDay": max_day,
    "cells": {"ex": cells("ex"), "inc": cells("inc")},
    "affCells": [[y, m, c, h, rl, a, n, round(v, 2)]
                 for (y, m, c, h, rl, a), (n, v) in sorted(aff_rec.items())],
    "rails": RAILS,
    "mtdDays": 0,          # filled in below, once the newest day is known
    "mtdCells": [],
    # [ftd month, ggr month, country, channel, rail, ggr, ggr with both months
    #  cut at mtdDays]
    "cohortGgr": [[fm, gm, c, h, r, round(a, 2), round(b, 2)]
                  for (fm, gm, c, h, r), (a, b) in sorted(cohort.items())],
    # [year, month, country, adjusted ggr, adjusted ggr cut at mtdDays]
    "adjCells": {v: [[y, m, c, h, round(a, 2), round(b, 2)]
                     for (y, m, c, h), (a, b) in sorted(adj_rec[v].items())]
                 for v in ("ex", "inc")},
    # [year, month, country, channel, deposit, deposit cut at mtdDays]
    "depCells": {v: [[y, m, c, h, round(a, 2), round(b, 2)]
                     for (y, m, c, h), (a, b) in sorted(dep_rec[v].items())]
                 for v in ("ex", "inc")},
    "cohortGgrAff": [[fm, gm, a, h, r, round(x, 2), round(y, 2)]
                     for (fm, gm, a, h, r), (x, y) in sorted(cohort_aff.items())],
    "noAff": NO_AFF,
    "whale": CARVE_FIRST,
}

# --- the same-days variant --------------------------------------------------
mtd = defaultdict(lambda: [0, 0.0])
mtd_aff = defaultdict(lambda: [0, 0.0])
for day, year, month, ctry, ch, rail, aff, amt in mtd_rows:
    if day > MTD_DAYS:
        continue
    k = (year, month, ctry, ch, rail)
    mtd[k][0] += 1
    mtd[k][1] += amt
    ka = (year, month, ctry, ch, rail, aff)
    mtd_aff[ka][0] += 1
    mtd_aff[ka][1] += amt
data["mtdDays"] = MTD_DAYS
data["mtdCells"] = [[y, m, c, h, r, n, round(v, 2)]
                    for (y, m, c, h, r), (n, v) in sorted(mtd.items())]
# The affiliate table has to be trimmed the same way, or it contradicts the
# charts it sits under the moment the period is like-for-like.
data["affMtdCells"] = [[y, m, c, h, r, a, n, round(v, 2)]
                       for (y, m, c, h, r, a), (n, v) in sorted(mtd_aff.items())]

with open(os.path.join(HERE, "ftd-channels-data.json"), "w", encoding="utf-8") as f:
    json.dump(data, f, separators=(",", ":"))

# --- diagnostics ------------------------------------------------------------
print("raw ftd rows: %d   distinct players: %d   repeats skipped: %d"
      % (raw_rows, len(seen_pids), dupes))
for y in YEARS:
    ex = [v for k, v in rec["ex"].items() if k[0] == y]
    inc = [v for k, v in rec["inc"].items() if k[0] == y]
    print("%s  months %2d (to %s)  FTDs ex-whale %6d  $%14s   inc %6d"
          % (y, len(months_by_year[y]), max_day.get(y, "-"),
             sum(v[0] for v in ex), format(round(sum(v[1] for v in ex)), ","),
             sum(v[0] for v in inc)))
    for ch in CHANNELS:
        sel = [v for k, v in rec["ex"].items() if k[0] == y and k[3] == ch]
        print("      %-9s %6d  $%s" % (ch, sum(v[0] for v in sel),
                                       format(round(sum(v[1] for v in sel)), ",")))

print("\nrail, read across from the same player's deposit rows that day:")
for k, n in sorted(rail_seen.items(), key=lambda kv: -kv[1]):
    print("   %-12s %6d" % (k, n))
assert no_rail == 0, "%d FTDs had no deposit row to read a rail from" % no_rail
if unknown_rails:
    print("   UNCLASSIFIED RAILS (defaulted to crypto): %s" % sorted(unknown_rails))
else:
    print("   every rail value is in KNOWN_RAILS")

print("\nchannel rule — every (aff_type, aff_source) seen, and where it landed:")
for (at, src, ch), n in sorted(src_seen.items(), key=lambda kv: -kv[1]):
    print("   %-10s %-14s -> %-9s %6d" % (at, src, ch, n))

print("\nreconcile: cells sum == distinct players?")
for v in ("ex", "inc"):
    tot = sum(c for c, _ in rec[v].values())
    print("   %-3s cells %6d" % (v, tot))
print("   aff cells %6d in %d keys, %d distinct affiliates (%d FTDs untagged)"
      % (sum(n for n, _ in aff_rec.values()), len(aff_rec),
         len({k[5] for k in aff_rec}),
         sum(n for k, (n, _) in aff_rec.items() if k[5] == NO_AFF)))
_ae = sum(v[0] for v in adj_rec["ex"].values())
_ai = sum(v[0] for v in adj_rec["inc"].values())
print("   adj ggr    %6d keys, ex-whale $%s of $%s (the top depositor is %d%%)"
      % (len(adj_rec["ex"]), format(round(_ae), ","), format(round(_ai), ","),
         round((_ai - _ae) / _ai * 100) if _ai else 0))
print("              channel from the per-player map; $%s (%.1f%%) sits on "
      "Affiliate players whose aff_source was never seen, so it lands in Other"
      % (format(round(adj_unsourced[0]), ","),
         100.0 * adj_unsourced[0] / max(abs(_ai), 1)))
_de = sum(v[0] for v in dep_rec["ex"].values())
_di = sum(v[0] for v in dep_rec["inc"].values())
print("   deposits   %6d keys, ex-whale $%s of $%s (the top depositor is %d%%)"
      % (len(dep_rec["ex"]), format(round(_de), ","), format(round(_di), ","),
         round((_di - _de) / _di * 100) if _di else 0))
print("   cohort ggr aff %6d keys" % len(cohort_aff))
print("   cohort ggr %6d keys, $%s from the %d players acquired in this window"
      % (len(cohort), format(round(sum(v[0] for v in cohort.values())), ","),
         len(ftd_player)))
print("   mtd cells %6d, every month trimmed to its first %d days"
      % (sum(n for n, _ in mtd.values()), MTD_DAYS))
print("wrote ftd-channels-data.json (%.0f KB)"
      % (os.path.getsize(os.path.join(HERE, "ftd-channels-data.json")) / 1024.0))
