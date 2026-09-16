#!/usr/bin/env python3
"""
Build the pre-aggregated cube behind the drag-and-drop pivot page.

Reads ftd-report/cache/YYYY-MM.json (query 1732, player x day rows) and rolls
them into one fact cube keyed by

    month x country x game_product x rail x aff_type x player_status
          x kyc_status x ftd_type x channel x whale

Emits pivot-data.json:  dimension dictionaries + base64 typed arrays.

WHY MONTH AND NOT DAY
    The same cube at day granularity is ~665,000 cells against ~114,000 at
    month granularity. Day-level would push the page past the point where a
    browser opens it comfortably. Year / Quarter / Month are derived from the
    month code for free; day is deliberately not offered.

WHY NO DISTINCT-PLAYER MEASURE
    Distinct counts do not sum (SKILL.md section 4). A player who deposits in
    March and April is one distinct depositor and two cells; no pre-aggregated
    cube can add those back up, so a "Depositors" measure would be silently
    wrong at every subtotal. Only counts that are genuinely additive are
    emitted: first deposits (a player has exactly one, ever) and sign-ups.

Rail classification is copied verbatim from ftd-report/month-aggregate.js.
"""

import base64
import glob
import json
import os
import struct
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(ROOT, "ftd-report", "cache")

# The players every report carves out by default, shared so a tenth report
# cannot quietly disagree about who is in the list. See ../carveout.py and
# SKILL.md section 5.
import sys
sys.path.insert(0, ROOT)
from carveout import CARVED, CARVE_NAMES, CARVE_FIRST, CARVE_FIRST_NAME
WHALE_ID = CARVE_FIRST
WHALE_NAME = CARVE_FIRST_NAME

# Same reasoning, for affiliate categorisation instead of the whale list: a
# cached row's aff_type/aff_source is frozen the day that month was pulled, so
# a re-categorisation at the source (GetBlue2024: SEO -> Retargeting) never
# reaches history without looking it up fresh. See ../affiliate_channel.py.
from affiliate_channel import current_of

# ---------------------------------------------------------------- rails
# Copied verbatim from ftd-report/month-aggregate.js. Two pages that classify
# rails differently is a worse bug than either being slightly wrong.
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

COUNTRY_RENAME = {
    "Bolivia (Plurinational State of)": "Bolivia",
    "Bosnia and Herzegovina": "Bosnia & Herz.",
    "Brunei Darussalam": "Brunei",
    "Czech Republic": "Czechia",
    "Dominican Republic": "Dominican Rep.",
    "Korea (Republic of)": "South Korea",
    "Lao People's Democratic Republic": "Laos",
    "Moldova (Republic of)": "Moldova",
    "New Zealand": "NZ",
    "Republic of Kosovo": "Kosovo",
    "Russian Federation": "Russia",
    "United Kingdom of Great Britain and Northern Ireland": "United Kingdom",
    "United States of America": "US",
    "Venezuela (Bolivarian Republic of)": "Venezuela",
    "Viet Nam": "Vietnam",
    "Trinidad and Tobago": "Trinidad & Tobago",
    "Congo (Democratic Republic of the)": "DR Congo",
    "Palestine, State of": "Palestine",
    "Virgin Islands (U.S.)": "US Virgin Is.",
    "Virgin Islands (British)": "British Virgin Is.",
    "Tanzania, United Republic of": "Tanzania",
    "Iran (Islamic Republic of)": "Iran",
    "Syrian Arab Republic": "Syria",
    "Macedonia (the former Yugoslav Republic of)": "North Macedonia",
    "Taiwan, Province of China": "Taiwan",
    "Micronesia (Federated States of)": "Micronesia",
    "Congo": "Congo",
}

VAGUE_SOURCES = {"", "Uncategorized"}
SOURCE_CH = {"": "d", "Metamedia": "d", "Community": "d",
             "Influence": "s", "KOl": "s"}
CH_LABEL = {"d": "Direct", "a": "Affiliate", "s": "Streamer",
            "com": "Community", "seo": "SEO"}

GAME_LABEL = {
    "casino": "Casino", "live-casino": "Live casino", "sports": "Sports",
    "crash": "Crash", "provably-fair": "Provably fair", "dice": "Dice",
}


def num(v):
    """Cache values arrive as strings; empty/None must become 0.0 or sums
    silently concatenate."""
    if v is None or v == "":
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


# A single player-day row above this is not a bet or deposit -- it is a data
# error. The true legitimate maximum across all 21 cached months is a $16.8M
# bet (2026-04-21, player 1828617); the whale's own peaks top out under $5.4M.
# The 2026-09-10 cache carries one row where a currency/exponent bug wrote a
# $101.5 BILLION bet -> ggr -> ngr -> adjusted_ggr chain (and a separate
# $100.9B deposit) for player 3364825 -- both roughly 2,000x this ceiling, and
# both quietly poison every sum downstream if not caught here. $50M leaves
# 3x headroom above the real max while sitting nowhere near a real one.
CORRUPT_ROW_CEILING = 50_000_000.0


def country_of(raw):
    c = (raw or "").strip()
    if not c:
        return "Unknown"
    return COUNTRY_RENAME.get(c, c)


def current_aff(row):
    """(aff_type, aff_source) for this row's affiliate, corrected via
    affiliate_channel.current_of rather than whatever this row itself froze
    in on the day its month was pulled."""
    return current_of(row.get("aff_username"), row.get("aff_type"), row.get("aff_source"))


def channel_of(row):
    typ, src = current_aff(row)
    src = (src or "").strip()
    if src not in VAGUE_SOURCES:
        ch = SOURCE_CH.get(src, "a")
    else:
        typ = (typ or "").strip()
        ch = "s" if typ == "Streamer" else ("a" if typ == "Affiliate" else "d")
    if src == "Community":
        return "com"
    if src == "SEO":
        return "seo"
    return ch


def cohort_of(first_deposit_date):
    """The year a player first deposited, bucketed the way the FTD Share page
    buckets it: each recent year on its own, everything older in one band. The
    older years are one band split three ways on that page, not three unrelated
    cohorts, and giving each of them its own row here would multiply the cube
    for figures nobody reads separately."""
    y = (first_deposit_date or "")[:4]
    if not y.isdigit():
        return ""
    return "FTD %s" % y if int(y) >= 2023 else "pre-2023"


def rail_type_of(rail, unknown=None):
    v = (rail or "").strip().lower()
    if not v:
        return ""          # real: a deposit whose method the query never attached
    if unknown is not None and v not in KNOWN_RAILS:
        unknown.add(rail)
    return "f" if v in FIAT_RAILS else "c"


# ------------------------------------------------------------- dimensions
# (key, label, source) -- source is a callable over the raw row.
DIMS = [
    ("month",   "Month",          lambda r: (r.get("transaction_date") or "")[:7]),
    ("country", "Country",        lambda r: country_of(r.get("player_country"))),
    ("game",    "Game category",  lambda r: (r.get("game_product") or "").strip()),
    ("rail",    "Payment rail",   lambda r: (r.get("blockchain") or "").strip()),
    ("afftype", "Affiliate type", lambda r: (current_aff(r)[0] or "").strip()),
    ("status",  "Player status",  lambda r: (r.get("player_status") or "").strip()),
    ("kyc",     "KYC status",     lambda r: (r.get("kyc_status") or "").strip()),
    ("ftdtype", "FTD type",       lambda r: (r.get("ftd_type") or "").strip()),
    ("ftdyear", "FTD cohort",     lambda r: cohort_of(r.get("first_deposit_date"))),
    ("channel", "Channel",        channel_of),
    ("affname", "Affiliate name", lambda r: (r.get("aff_username") or "").strip()),
    # One level per carved-out player rather than a yes/no flag: with more
    # than one of them a single "1" would merge people whose numbers are
    # the whole reason they are held out separately.
    ("whale",   "Top depositor",  lambda r: str(r.get("player_id"))
                                            if str(r.get("player_id")) in CARVED else "0"),
]

# (key, label, kind, extractor) -- kind drives formatting in the page.
MEASURES = [
    ("bet",        "Bet",              "money", lambda r: num(r.get("bet"))),
    ("ggr",        "GGR",              "money", lambda r: num(r.get("ggr"))),
    ("ngr",        "NGR",              "money", lambda r: num(r.get("ngr"))),
    ("adj_ggr",    "Adjusted GGR",     "money", lambda r: num(r.get("adjusted_ggr"))),
    ("bonus_cost", "Bonus cost",       "money", lambda r: num(r.get("bonus_cost"))),
    ("deposit",    "Deposits",         "money", lambda r: num(r.get("deposit"))),
    ("withdraw",   "Withdrawals",      "money", lambda r: num(r.get("withdraw"))),
    ("dep_count",  "Deposit count",    "count", lambda r: num(r.get("deposit_count"))),
    ("ftd_value",  "First deposit $",  "money", lambda r: num(r.get("ftd"))),
    ("ftd_players", "First depositors", "count", lambda r: 1.0 if num(r.get("ftd")) > 0 else 0.0),
    ("signups",    "Sign-ups",         "count", lambda r: num(r.get("sign_up"))),
    ("clicks",     "Clicks",           "count", lambda r: num(r.get("click_count"))),
    ("bet_days",   "Betting player-days", "count", lambda r: 1.0 if r.get("bet") not in (None, "") else 0.0),
    ("dep_days",   "Depositing player-days", "count", lambda r: 1.0 if r.get("deposit") not in (None, "") else 0.0),
]


def b64(fmt, values):
    return base64.b64encode(struct.pack("<%d%s" % (len(values), fmt), *values)).decode("ascii")


def main():
    files = sorted(glob.glob(os.path.join(CACHE, "*.json")))
    if not files:
        sys.exit("no cache months found in %s" % CACHE)

    # MTD means every month trimmed to the CURRENT month's day count, so a
    # partial month compares like-for-like against complete ones -- it does not
    # mean "this month so far". The cap is the last day the newest cache month
    # actually has data for, so both variants have to be accumulated here: the
    # day is gone by the time the cube is emitted.
    with open(files[-1], "r", encoding="utf-8") as fh:
        cap = max(int((r.get("transaction_date") or "0000-00-00")[8:10] or 0)
                  for r in json.load(fh))
    print("MTD cap: day %d of %s\n" % (cap, os.path.basename(files[-1])[:7]))

    dim_keys = [d[0] for d in DIMS]
    dicts = [dict() for _ in DIMS]        # label -> code
    order = [[] for _ in DIMS]            # code -> label
    NM = len(MEASURES)
    cube = defaultdict(lambda: [0.0] * (NM * 2))   # [full... , mtd...]
    unknown_rails = set()
    corrupt_rows = []      # (file, date, player_id, username, measure, value) excluded above the ceiling
    grand = [0.0] * NM
    row_total = 0

    # Active depositors: WHO deposited in each cell, not how many rows carried
    # a deposit -- a per-cell SET of player_id, so a subtotal or a "by rail"
    # total can be built later by set UNION (exact) rather than by summing
    # per-cell sizes (which double-counts a multi-rail, multi-day depositor --
    # exactly the trap this project's own conventions warn about for any
    # distinct headcount). Keyed by the same cell tuple as `cube`.
    active_dep_full = defaultdict(set)
    active_dep_mtd = defaultdict(set)
    t0 = time.time()

    for path in files:
        with open(path, "r", encoding="utf-8") as fh:
            rows = json.load(fh)
        row_total += len(rows)
        for r in rows:
            in_mtd = int((r.get("transaction_date") or "0000-00-00")[8:10] or 0) <= cap
            key = []
            for i, (_k, _l, get) in enumerate(DIMS):
                v = get(r) or ""
                code = dicts[i].get(v)
                if code is None:
                    code = len(order[i])
                    dicts[i][v] = code
                    order[i].append(v)
                key.append(code)
            rail_type_of(r.get("blockchain"), unknown_rails)
            tkey = tuple(key)

            dep_val = num(r.get("deposit"))
            if 0 < dep_val <= CORRUPT_ROW_CEILING:
                pid = r.get("player_id")
                active_dep_full[tkey].add(pid)
                if in_mtd:
                    active_dep_mtd[tkey].add(pid)

            slot = cube[tkey]
            for j, (mk, _l, _kind, get) in enumerate(MEASURES):
                val = get(r)
                if val:
                    if abs(val) > CORRUPT_ROW_CEILING:
                        corrupt_rows.append((os.path.basename(path), r.get("transaction_date"),
                                              r.get("player_id"), r.get("username"), mk, val))
                        continue
                    slot[j] += val
                    grand[j] += val
                    if in_mtd:
                        slot[NM + j] += val
        print("  %-14s %8d rows  cube=%d  %.0fs"
              % (os.path.basename(path), len(rows), len(cube), time.time() - t0),
              flush=True)

    # --- pack ------------------------------------------------------------
    keys = sorted(cube.keys())
    n = len(keys)
    cols = []
    for i, (k, label, _get) in enumerate(DIMS):
        codes = [key[i] for key in keys]
        width = "B" if len(order[i]) < 256 else "H"
        cols.append({"key": k, "b64": b64(width, codes), "width": width})

    # --- active depositors: a dense player code, then a sparse per-cell list
    key_to_idx = {k: i for i, k in enumerate(keys)}
    all_active_players = sorted(set().union(*active_dep_full.values())) \
        if active_dep_full else []
    if len(all_active_players) > 65535:
        sys.exit("more than 65,535 active depositors -- widen the player code to 32-bit")
    player_code = {pid: i for i, pid in enumerate(all_active_players)}

    def encode_active_dep(sets_by_key):
        pairs = sorted(
            (key_to_idx[k], sorted(player_code[p] for p in s))
            for k, s in sets_by_key.items() if s
        )
        idx = [p[0] for p in pairs]
        counts = [len(p[1]) for p in pairs]
        codes = [c for p in pairs for c in p[1]]
        if counts and max(counts) > 255:
            sys.exit("more than 255 active depositors in one cell -- widen the count encoding")
        return {
            "idx": b64("I", idx),
            "counts": base64.b64encode(bytes(counts)).decode("ascii"),
            "codes": b64("H", codes),
            "n": len(idx),
        }

    active_dep_out = {
        "player_count": len(all_active_players),
        "full": encode_active_dep(active_dep_full),
        "mtd": encode_active_dep(active_dep_mtd),
    }

    # Each measure is stored as a presence bitmap over the cell list plus the
    # values for the set bits. A bitmap costs 1 bit per cell (14 KB for the
    # whole cube) where an index array costs 32 bits per present cell -- and
    # most measures are present in a minority of cells, because a deposit row
    # and a bet row never share a cell.
    INT32_MAX = 2 ** 31 - 1

    def pack(j, k, label, kind):
        present = [(ci, cube[key][j]) for ci, key in enumerate(keys) if cube[key][j]]
        peak = max((abs(v) for _ci, v in present), default=0.0)
        # Largest scale that still fits int32, so precision is only given up on
        # the measures whose individual cells are genuinely huge (bet).
        scale = 1
        for cand in (100, 10, 1):
            if peak * cand <= INT32_MAX:
                scale = cand
                break
        else:
            sys.exit("measure %s peaks at %.0f -- widen the encoding" % (k, peak))
        bitmap = bytearray((n + 7) // 8)
        cents = []
        for ci, v in present:
            bitmap[ci >> 3] |= 1 << (ci & 7)
            cents.append(int(round(v * scale)))
        return {
            "key": k, "label": label, "kind": kind, "scale": scale,
            "bits": base64.b64encode(bytes(bitmap)).decode("ascii"),
            "val": b64("i", cents), "n": len(cents),
        }

    measures_out, measures_mtd = [], []
    for j, (k, label, kind, _get) in enumerate(MEASURES):
        full = pack(j, k, label, kind)
        mtd = pack(NM + j, k, label, kind)
        measures_out.append(full)
        measures_mtd.append(mtd)
        print("  measure %-12s full=%6d  mtd=%6d  scale=%d"
              % (k, full["n"], mtd["n"], full["scale"]))

    # dimension level labels, prettified where the raw code is not readable
    dims_out = []
    for i, (k, label, _get) in enumerate(DIMS):
        levels = []
        for v in order[i]:
            if k == "game":
                levels.append(GAME_LABEL.get(v, v or "(no category)"))
            elif k == "rail":
                levels.append(v or "(no rail)")
            elif k == "channel":
                levels.append(CH_LABEL.get(v, v))
            elif k == "ftdyear":
                levels.append(v or "(never deposited)")
            elif k == "affname":
                levels.append(v or "(no affiliate)")
            elif k == "whale":
                levels.append("Everyone else" if v == "0"
                              else "%s (carved out)" % (CARVE_NAMES.get(v) or v))
            else:
                levels.append(v or "(unknown)")

        dims_out.append({"key": k, "label": label, "levels": levels,
                         "raw": order[i]})

    # derived dimensions: computed from an existing dimension's code, so they
    # cost no extra cells.
    months = sorted(dicts[0].keys())
    derived = [
        {"key": "year", "label": "Year", "from": "month",
         "map": [m[:4] for m in order[0]]},
        {"key": "quarter", "label": "Quarter", "from": "month",
         "map": ["%s Q%d" % (m[:4], (int(m[5:7]) - 1) // 3 + 1) for m in order[0]]},
        {"key": "railtype", "label": "Rail type", "from": "rail",
         "map": [{"c": "Crypto", "f": "Fiat", "": "(no rail)"}[rail_type_of(v)]
                 for v in order[3]]},
    ]

    out = {
        "meta": {
            "built": time.strftime("%Y-%m-%d %H:%M"),
            "source": "query 1732 month caches",
            "months": months,
            "source_rows": row_total,
            "cells": n,
            "mtd_cap": cap,
            "whale": {"player_id": WHALE_ID, "username": WHALE_NAME},
            "carvedOut": [{"player_id": i, "username": CARVE_NAMES.get(i, "")}
                          for i in sorted(CARVED)],
            "grand": {MEASURES[j][0]: round(grand[j], 2) for j in range(len(MEASURES))},
            "active_depositors_total": len(all_active_players),
            "excluded_rows": [
                {"date": d, "player_id": pid, "username": u, "measure": mk, "value": round(v, 2)}
                for _f, d, pid, u, mk, v in corrupt_rows
            ],
        },
        "dims": dims_out,
        "derived": derived,
        "cols": cols,
        "measures": measures_out,
        "measures_mtd": measures_mtd,
        "active_dep": active_dep_out,
    }

    dest = os.path.join(HERE, "pivot-data.json")
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    size = os.path.getsize(dest) / 1e6

    print("\ncells        %d" % n)
    print("source rows  %d" % row_total)
    print("active dep.  %d distinct players, %d cells carry at least one"
          % (len(all_active_players), sum(1 for s in active_dep_full.values() if s)))
    if corrupt_rows:
        print("\n!! %d value(s) above the $%s sanity ceiling were EXCLUDED, not summed:"
              % (len(corrupt_rows), format(int(CORRUPT_ROW_CEILING), ",")))
        for f, d, pid, u, mk, v in corrupt_rows:
            print("   %s  %s  player %s (%s)  %-14s $%s"
                  % (f, d, pid, u, mk, format(v, ",.2f")))
        print("   These look like a data/query bug upstream, not real activity --")
        print("   worth a look at the source before the next refresh.")
    print("months       %s .. %s" % (months[0], months[-1]))
    print("wrote        %s  (%.1f MB)" % (dest, size))
    if unknown_rails:
        print("\nUNCLASSIFIED RAILS (defaulted to crypto -- classify on purpose):")
        for r in sorted(unknown_rails):
            print("   %s" % r)
    else:
        print("\nno unclassified rails")


if __name__ == "__main__":
    main()
