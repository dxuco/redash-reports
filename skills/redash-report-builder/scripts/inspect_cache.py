#!/usr/bin/env python3
"""Inventory a Redash 1732 month cache before designing anything against it.

    python inspect_cache.py ftd-report/cache/2026-08.json
    python inspect_cache.py ftd-report/cache/2026-08.json --exclude 1709996

Prints:
  * every column and how many rows carry it
  * the field-overlap matrix for the measure columns -- which fields actually
    share a row. This is the question that decides whether a metric can be split
    by a dimension at all, and it is not guessable from the column list: in this
    dataset adjusted_ggr and game_product have exactly zero rows in common.
  * game categories and payment rails with their volumes
  * the top depositors, because one player is usually most of the money and
    every report carves him out

Read-only. Safe to run against anything.
"""

import argparse
import collections
import json
import os
import sys

MEASURES = ["bet", "ggr", "ngr", "adjusted_ggr", "bonus_cost", "deposit",
            "withdraw", "ftd", "sign_up", "click_count"]
DIMENSIONS = ["game_product", "blockchain", "bonus_group", "current_segment",
              "player_status", "aff_source"]


def num(v):
    if v in (None, ""):
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def money(x):
    return "%s$%s" % ("-" if x < 0 else "", format(round(abs(x)), ","))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--exclude", nargs="*", default=[],
                    help="player_ids to leave out (e.g. the whale, 1709996)")
    ap.add_argument("--top", type=int, default=8)
    args = ap.parse_args()

    if not os.path.exists(args.path):
        sys.exit("no such file: %s" % args.path)

    rows = json.load(open(args.path, encoding="utf-8"))
    excl = set(str(x) for x in args.exclude)
    if excl:
        rows = [r for r in rows if str(r.get("player_id")) not in excl]

    print("%s  --  %s rows%s\n" % (args.path, format(len(rows), ","),
                                   ("  (excluding %s)" % ", ".join(sorted(excl))) if excl else ""))

    counts = collections.Counter()
    for r in rows:
        for k, v in r.items():
            if v not in (None, ""):
                counts[k] += 1

    print("COLUMNS")
    for k, n in counts.most_common():
        print("   %-20s %8s  (%5.1f%%)" % (k, format(n, ","), n / len(rows) * 100))

    present = [m for m in MEASURES if m in counts] + [d for d in DIMENSIONS if d in counts]
    print("\nFIELD OVERLAP  -- rows carrying both. A zero means the two can never")
    print("be crossed: no per-dimension figure for that measure exists in the data.")
    head = "".join("%12s" % f[:11] for f in present)
    print("   %-20s%s" % ("", head))
    for a in present:
        line = ""
        for b in present:
            n = sum(1 for r in rows
                    if r.get(a) not in (None, "") and r.get(b) not in (None, ""))
            line += "%12s" % (format(n, ",") if n else "-")
        print("   %-20s%s" % (a, line))

    dates = sorted({str(r.get("transaction_date", ""))[:10] for r in rows if r.get("transaction_date")})
    if dates:
        print("\nDATE RANGE   %s to %s   (%d days)" % (dates[0], dates[-1], len(dates)))

    for dim, measure in (("game_product", "bet"), ("blockchain", "deposit")):
        if dim not in counts:
            continue
        agg = collections.defaultdict(lambda: [0, 0.0])
        for r in rows:
            v = r.get(dim)
            if not v:
                continue
            agg[v][0] += 1
            agg[v][1] += num(r.get(measure))
        print("\n%s   (rows, %s)" % (dim.upper(), measure))
        for k, (n, amt) in sorted(agg.items(), key=lambda x: -x[1][1]):
            print("   %-22s %8s  %14s" % (k, format(n, ","), money(amt)))

    if "deposit" in counts:
        per = collections.Counter()
        for r in rows:
            d = num(r.get("deposit"))
            if d > 0:
                per[r.get("username") or r.get("player_id")] += d
        total = sum(per.values())
        print("\nTOP DEPOSITORS   (total %s)" % money(total))
        for u, v in per.most_common(args.top):
            print("   %-24s %14s   %5.1f%%" % (u, money(v), v / total * 100 if total else 0))
        if per:
            top_share = per.most_common(1)[0][1] / total * 100 if total else 0
            if top_share > 25:
                print("\n   One player is %.0f%% of deposits. Every report in this folder"
                      % top_share)
                print("   carves them out by default -- see SKILL.md section 5.")


if __name__ == "__main__":
    main()
