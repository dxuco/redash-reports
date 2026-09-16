#!/usr/bin/env python3
"""
Business Overview — daily aggregate builder.

Reads the query-1732 month caches in ../ftd-report/cache/*.json (player x day x
game_product rows) and emits overview-data.json:

  months[ym] = {
      days: ["2026-08-01", ...],
      depositors:   [n per day]     distinct player_id with deposit > 0
      depAmount:    [$ per day]
      bettors:      [n per day]     distinct player_id with any bet row
      cats: { casino: [n per day], ... }   distinct player_id per category per day
      catBet: { casino: [$ per day], ... }
      mtdDistinct / fullDistinct: month-level distinct counts (NOT day sums)
  }

Distinct counts are the point: a player who deposits on five days is five
day-actives but one monthly active, and a player who plays casino and sport is
one bettor in two category rows. Row sums therefore never match the totals, by
design -- same rule the FTD report's section 11 documents.
"""

import json
import glob
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "ftd-report", "cache")
OUT = os.path.join(HERE, "overview-data.json")

CATS = ["casino", "live-casino", "sports", "crash", "provably-fair", "dice"]

# Payment-rail classification, copied verbatim from ftd-report/month-aggregate.js
# so this page and the monthly FTD page split crypto/fiat the same way.
#
# `mercado` (Mercado Pago) is deliberately absent: it is a fiat rail, and the
# rolling FTD report treats it as one, but the monthly page counts it as crypto.
# Reproducing that keeps the two pages agreeing. Move it into FIAT_RAILS to
# correct it -- in both places, or they will disagree.
FIAT_RAILS = {
    "apple pay", "google pay", "interac", "mastercard", "mbway", "neteller",
    "paysafecard", "pix", "revolut", "sepa", "skrill", "visa", "wise",
    "astropay", "bancontact", "blik", "boleto", "bunq", "eps", "giropay",
    "ideal", "jeton", "klarna", "mifinity", "muchbetter", "n26", "open banking",
    "sofort", "trustly", "upi",
}

KNOWN_RAILS = FIAT_RAILS | {
    "bnb", "btc", "btc-2", "bitcoin", "doge", "dogecoin", "ethereum", "eth",
    "litecoin", "ltc", "mercado", "polygon", "matic", "solana", "sol", "tron",
    "trx", "usdt", "usdc", "ton", "xrp", "ripple", "cardano", "ada", "dash",
    "avalanche", "avax", "bch", "monero", "xmr", "stellar", "xlm", "arbitrum",
    "optimism", "base", "shib",
}

UNSEEN_RAILS = set()

# karolik777. One player, 72% of August's deposited dollars and the majority of
# adjusted GGR -- with him in, every daily total reads as his deposits plus
# noise, and the ~$118k/day the business actually runs at is invisible. The
# Bonus Cost report carves him out by default for the same reason, so this page
# does too, with a toggle rather than a silent exclusion.
#
# Keyed on player_id, not username: player_ids here have changed username
# mid-year, and a name-based rule would quietly stop matching the day his does.
WHALE_IDS = {"1709996"}          # karolik777
WHALE_LABEL = "karolik777"


def rail_of(value):
    """'crypto', 'fiat', or 'unknown'. The unknown case is real and must not be
    folded into fiat: a deposit can arrive without the query attaching a method,
    and showing it as neither beats inflating the fiat bar."""
    v = str(value or "").strip().lower()
    if not v:
        return "unknown"
    if v not in KNOWN_RAILS:
        UNSEEN_RAILS.add(value)
    return "fiat" if v in FIAT_RAILS else "crypto"


def num(v):
    if v in (None, ""):
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def build_view(rows, exclude=()):
    exclude = set(exclude)

    dep_players = defaultdict(set)      # date -> {player}
    dep_amount = defaultdict(float)
    rail_amount = defaultdict(lambda: defaultdict(float))   # date -> rail -> $
    rail_players = defaultdict(lambda: defaultdict(set))    # date -> rail -> {player}
    bet_players = defaultdict(set)      # date -> {player}
    cat_players = defaultdict(lambda: defaultdict(set))   # date -> cat -> {player}
    cat_bet = defaultdict(lambda: defaultdict(float))
    cat_ggr = defaultdict(lambda: defaultdict(float))
    cat_ngr = defaultdict(lambda: defaultdict(float))
    day_ngr = defaultdict(float)
    uncat_ngr = defaultdict(float)
    day_bet = defaultdict(float)
    day_ggr = defaultdict(float)
    uncat_bet = defaultdict(float)
    uncat_ggr = defaultdict(float)
    day_adj = defaultdict(float)
    day_bonus = defaultdict(float)
    ftd_players = defaultdict(set)

    month_dep = set()
    month_bet = set()
    month_cat = defaultdict(set)

    for r in rows:
        d = r.get("transaction_date")
        if not d:
            continue
        d = d[:10]
        pid = r.get("player_id")
        if pid is not None and str(pid) in exclude:
            continue

        dep = num(r.get("deposit"))
        if dep > 0 and pid:
            dep_players[d].add(pid)
            month_dep.add(pid)
        if dep > 0:
            rl = rail_of(r.get("blockchain"))
            rail_amount[d][rl] += dep
            if pid:
                rail_players[d][rl].add(pid)
        dep_amount[d] += dep

        if num(r.get("ftd")) > 0 and pid:
            ftd_players[d].add(pid)

        gp = r.get("game_product")
        bet = num(r.get("bet"))
        if gp and pid and bet > 0:
            bet_players[d].add(pid)
            month_bet.add(pid)
            cat_players[d][gp].add(pid)
            month_cat[gp].add(pid)
        # House edge is ggr/bet. Both live on the same row here -- unlike
        # adjusted_ggr, which never shares a row with game_product and so cannot
        # be split by category at all. Only 2 rows in a month carry bet or ggr
        # without a category ($44 in Aug 2026), so the category rows and the
        # day totals agree to within rounding.
        ggr = num(r.get("ggr"))
        ngr = num(r.get("ngr"))
        day_bet[d] += bet
        day_ggr[d] += ggr
        day_ngr[d] += ngr

        # Adjusted GGR arrives on its own rows -- in query 1732 not one row in a
        # month carries both adjusted_ggr and game_product (12,034 vs 43,477,
        # zero overlap). So it is a daily total only; there is no measured
        # per-category adjusted GGR to show, and allocating it pro-rata would
        # make every individual figure invented.
        day_adj[d] += num(r.get("adjusted_ggr"))
        day_bonus[d] += num(r.get("bonus_cost"))
        if gp:
            cat_bet[d][gp] += bet
            cat_ggr[d][gp] += ggr
            cat_ngr[d][gp] += ngr
        elif bet or ggr or ngr:
            # Bet or GGR with no category attached is two rows a month and tens
            # of dollars. NGR is a different story: ~13,000 rows a month carry
            # bonus_cost, bonus_group and ngr but no game_product, and they hold
            # about -5% of monthly NGR. That is far too much to drop, so the NGR
            # chart shows it as its own band rather than quietly under-reporting
            # every category. Tracked either way so the charts reconcile exactly.
            uncat_bet[d] += bet
            uncat_ggr[d] += ggr
            uncat_ngr[d] += ngr

    days = sorted(set(list(dep_players) + list(bet_players) + list(dep_amount)))
    cats_seen = sorted({c for d in cat_players for c in cat_players[d]} |
                       {c for d in cat_bet for c in cat_bet[d]})
    order = [c for c in CATS if c in cats_seen] + [c for c in cats_seen if c not in CATS]

    # Running distinct counts: cumDep[i] is the number of distinct players who
    # deposited at any point in days[0..i]. The tiles read these rather than
    # summing the daily bars, which would count a five-day depositor five times.
    cum_dep, cum_bet, seen_d, seen_b = [], [], set(), set()
    cum_cat = {c: [] for c in order}
    seen_c = {c: set() for c in order}
    for d in days:
        seen_d |= dep_players[d]
        seen_b |= bet_players[d]
        cum_dep.append(len(seen_d))
        cum_bet.append(len(seen_b))
        for c in order:
            seen_c[c] |= cat_players[d].get(c, set())
            cum_cat[c].append(len(seen_c[c]))

    rails = ["crypto", "fiat", "unknown"]
    rails = [r for r in rails if any(rail_amount[d].get(r) for d in days)]

    # Day-indexed player sets, handed back so main() can union them across months
    # into range-level distinct counts. A player active in March and in April is
    # one player over the range and two if you add the monthly figures, so the
    # months view cannot derive its headline counts from the monthly ones.
    sets = {
        "dep": [dep_players[d] for d in days],
        "bet": [bet_players[d] for d in days],
        "cat": {c: [cat_players[d].get(c, set()) for d in days] for c in order},
    }

    return sets, {
        "rails": rails,
        "railAmt": {rl: [round(rail_amount[d].get(rl, 0.0), 2) for d in days] for rl in rails},
        "railPlayers": {rl: [len(rail_players[d].get(rl, ())) for d in days] for rl in rails},
        "cumDep": cum_dep,
        "cumBet": cum_bet,
        "cumCat": cum_cat,
        "days": days,
        "depositors": [len(dep_players[d]) for d in days],
        "depAmount": [round(dep_amount[d], 2) for d in days],
        "bettors": [len(bet_players[d]) for d in days],
        "ftd": [len(ftd_players[d]) for d in days],
        "cats": {c: [len(cat_players[d].get(c, ())) for d in days] for c in order},
        "catBet": {c: [round(cat_bet[d].get(c, 0.0), 2) for d in days] for c in order},
        "catGgr": {c: [round(cat_ggr[d].get(c, 0.0), 2) for d in days] for c in order},
        "catNgr": {c: [round(cat_ngr[d].get(c, 0.0), 2) for d in days] for c in order},
        "dayBet": [round(day_bet[d], 2) for d in days],
        "dayGgr": [round(day_ggr[d], 2) for d in days],
        "dayNgr": [round(day_ngr[d], 2) for d in days],
        "uncatBet": [round(uncat_bet[d], 2) for d in days],
        "uncatGgr": [round(uncat_ggr[d], 2) for d in days],
        "uncatNgr": [round(uncat_ngr[d], 2) for d in days],
        "dayAdj": [round(day_adj[d], 2) for d in days],
        "dayBonus": [round(day_bonus[d], 2) for d in days],
        # month-level distincts, for the tiles
        "distinctDep": len(month_dep),
        "distinctBet": len(month_bet),
        "distinctCat": {c: len(month_cat[c]) for c in order},
        "catOrder": order,
    }


def main():
    files = sorted(glob.glob(os.path.join(CACHE, "*.json")))
    if not files:
        sys.exit("no cache files found at %s" % CACHE)

    months = {}
    sets = {"ex": {}, "inc": {}}
    for f in files:
        ym = os.path.basename(f)[:-5]
        rows = json.load(open(f, encoding="utf-8"))
        # Two views of the same rows. The page's whale toggle switches between
        # them rather than recomputing, so the toggle is instant and both views
        # are built by identical code.
        sets["ex"][ym], ex = build_view(rows, WHALE_IDS)
        sets["inc"][ym], inc = build_view(rows)
        months[ym] = {"ex": ex, "inc": inc}
        d_ex, d_inc = sum(ex["depAmount"]), sum(inc["depAmount"])
        n = len(ex["days"]) or 1
        print("%s  %2d days  deposits/day  ex-whale $%-9s  incl $%-10s  whale is %3d%%"
              % (ym, n, format(round(d_ex / n), ","), format(round(d_inc / n), ","),
                 round((d_inc - d_ex) / d_inc * 100) if d_inc else 0))

    # Range-level distinct counts, for the months view. Two windows: the whole of
    # every month, and every month trimmed to the current month's day count so
    # the comparison stays like-for-like under the MTD toggle.
    order = sorted(months)
    mtd_days = len(months[order[-1]]["ex"]["days"])

    def range_distincts(view):
        per = sets[view]
        out = {}
        for label, cap in (("full", None), ("mtd", mtd_days)):
            dep, bet, cat = set(), set(), defaultdict(set)
            for ym in order:
                s = per[ym]
                n = len(s["dep"]) if cap is None else cap
                for day_set in s["dep"][:n]:
                    dep |= day_set
                for day_set in s["bet"][:n]:
                    bet |= day_set
                for c, day_sets in s["cat"].items():
                    for day_set in day_sets[:n]:
                        cat[c] |= day_set
            out[label] = {"dep": len(dep), "bet": len(bet),
                          "cat": {c: len(v) for c, v in cat.items()}}
        return out

    print()
    rng = {v: range_distincts(v) for v in ("ex", "inc")}
    for v in ("ex", "inc"):
        print("range distinct (%s):  full  %s depositors / %s bettors    "
              "mtd  %s / %s"
              % (v, format(rng[v]["full"]["dep"], ","), format(rng[v]["full"]["bet"], ","),
                 format(rng[v]["mtd"]["dep"], ","), format(rng[v]["mtd"]["bet"], ",")))

    out = {
        "months": months,
        "order": order,
        "range": rng,
        "mtdDays": mtd_days,
        "cats": CATS,
        "whale": WHALE_LABEL,
        "builtAt": __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), separators=(",", ":"))
    print("\nwrote %s (%.0f KB)" % (OUT, os.path.getsize(OUT) / 1024))

    # New payment rails get classified on purpose rather than by default --
    # anything unlisted falls to crypto, which is silent and wrong for a new
    # fiat method. Same warning the JS builders print.
    if UNSEEN_RAILS:
        print("\npayment rails not in KNOWN_RAILS (currently counted as crypto):")
        for v in sorted(UNSEEN_RAILS):
            print("   ", v)


if __name__ == "__main__":
    main()
