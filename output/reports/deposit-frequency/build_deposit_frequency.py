# -*- coding: utf-8 -*-
"""
build_deposit_frequency.py — emits deposit-frequency-data.json

Reads the per-depositor export produced by the Redash query in
`query.sql` (one anonymous row per player: per-era deposit count and
value, plus the four attributes the page filters on) and packs it into a
compact columnar payload the page can aggregate live.

Why per-player rather than pre-computed buckets: the page offers era (3)
x whale (2) x email (3) x phone (3) x block (3) x product (11) filter
combinations. Pre-computing every variant is ~1,800 bucket sets, and
medians cannot be derived from aggregates anyway. One row per depositor
is 102k rows, which packs to a couple of MB and lets the page answer any
combination exactly.

player_id and username ARE emitted, because the page offers a top-50
drill-down from any bucket. That makes the built HTML a file containing
player records, not just a distribution — treat it accordingly when
sharing it.

Amounts are carried as INTEGER CENTS so the page reconciles exactly
rather than to a rounding tolerance.

    python build_deposit_frequency.py
"""

import json
import os
import sys
from collections import Counter
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "_mcp-exports", "players.json")
OUT = os.path.join(HERE, "deposit-frequency-data.json")

# Flag bits packed into one int per player.
F_EMAIL, F_PHONE, F_BLOCKED, F_WHALE = 1, 2, 4, 8

PROD_NONE = "(none)"

# ---------------------------------------------------------------------------
# POINT-IN-TIME CROSS-CHECK
#
# These are the figures the aggregate SQL returned when the export was last
# refreshed. They catch a dropped join or a changed filter, but they are NOT
# invariants: the deposit data moves every day, and a day's deposits only
# enter once its FX rate is published, so the totals step up a day late.
#
# When the build fails here and the export was just re-run, re-run the era
# aggregate in Redash and update these — do not widen the tolerance.
#
# Invariants that must ALWAYS hold, regardless of date, are asserted
# separately below: the partitions, and new + old == all.
# ---------------------------------------------------------------------------
SNAPSHOT = "2026-08-25"
EXPECT_NEW_PLAYERS, EXPECT_NEW_DEPOSITS, EXPECT_NEW_VALUE = 47142, 645996, 258173218.28
EXPECT_OLD_PLAYERS, EXPECT_OLD_DEPOSITS, EXPECT_OLD_VALUE = 58637, 897323, 168582173.46
EXPECT_ALL_PLAYERS = 102314
EXPECT_GGR_PLAYERS, EXPECT_GGR_TOTAL = 47142, 80881777.69
EXPECT_ADJ_TOTAL = 89016498.36

# block_reason is 20 values long and wildly lopsided — dormant_account and
# "unknown" are 88% of blocked depositors, while the reasons anyone actually
# wants to filter on are a small tail. Grouping makes the control usable and,
# more importantly, stops "Blocked" being read as one thing when it is not.
#
# A reason not listed here lands in "Other", and the build prints it so new
# reasons get classified on purpose rather than disappearing into a bucket.
REASON_GROUPS = [
    ("Responsible gambling", ["self_exclusion", "temporary_self_exclusion", "gambling_addiction"]),
    ("Fraud & abuse", ["multi_accounting", "bonus_abuse", "bug_abuse", "suspicious_user",
                       "risk_decision", "email_pattern_bot"]),
    ("Compliance / KYC", ["kyc", "failed_kyc"]),
    ("Provider & sportsbook limits", ["limited_in_sport", "provider_advice", "provider_check"]),
    ("Dormant", ["dormant_account"]),
    ("Unknown", ["unknown"]),
]
GROUP_OF = {r: g for g, rs in REASON_GROUPS for r in rs}

# The source stores ISO 3166 official names — "United Kingdom of Great Britain
# and Northern Ireland" is 52 characters and wrecks the drill-down layout.
# These are the everyday short forms. Anything not listed falls through to the
# rules in short_country(), and the build fails if two countries ever collapse
# to the same label, because a silently merged country would be worse than a
# long one.
COUNTRY_SHORT = {
    "United Kingdom of Great Britain and Northern Ireland": "United Kingdom",
    "United States of America": "United States",
    "Korea (Republic of)": "South Korea",
    "Korea (Democratic People's Republic of)": "North Korea",
    "Congo (Democratic Republic of the)": "DR Congo",
    "Macedonia (the former Yugoslav Republic of)": "North Macedonia",
    "Lao People's Democratic Republic": "Laos",
    "Syrian Arab Republic": "Syria",
    "Russian Federation": "Russia",
    "Brunei Darussalam": "Brunei",
    "Republic of Kosovo": "Kosovo",
    "Central African Republic": "Central African Rep.",
    "Dominican Republic": "Dominican Rep.",
    "United Arab Emirates": "UAE",
    "Bosnia and Herzegovina": "Bosnia & Herz.",
    "Antigua and Barbuda": "Antigua & Barbuda",
    "Trinidad and Tobago": "Trinidad & Tobago",
    "Northern Mariana Islands": "N. Mariana Is.",
    "Saint Pierre and Miquelon": "St. Pierre & Miq.",
    "Saint Martin (French part)": "St. Martin (FR)",
    "Sint Maarten (Dutch part)": "St. Maarten (NL)",
    "Saint Barthélemy": "St. Barthélemy",
    "Saint Lucia": "St. Lucia",
    "Virgin Islands (U.S.)": "US Virgin Is.",
    "Cocos (Keeling) Islands": "Cocos Is.",
    "Palestine, State of": "Palestine",
    "Wallis and Futuna": "Wallis & Futuna",
    "Equatorial Guinea": "Eq. Guinea",
}


def short_country(name):
    """Everyday short form. Overrides first, then two structural rules that
    cover the ISO naming patterns: a trailing qualifier in parentheses, and
    the 'Country, Qualifier of' inversion."""
    if not name:
        return name
    if name in COUNTRY_SHORT:
        return COUNTRY_SHORT[name]
    # "Iran (Islamic Republic of)" -> "Iran"
    if "(" in name:
        name = name.split("(")[0].strip()
    # "Tanzania, United Republic of" -> "Tanzania"
    if "," in name:
        name = name.split(",")[0].strip()
    return name


def num(v):
    """Empty / None -> 0.0. Values arrive as strings or numbers."""
    if v is None or v == "":
        return 0.0
    return float(v)


def cents(v):
    return int(round(num(v) * 100))


def main():
    if not os.path.exists(SRC):
        sys.exit("missing %s — re-run the Redash export first" % SRC)

    rows = json.load(open(SRC, encoding="utf-8"))
    print("snapshot %s" % SNAPSHOT)
    print("read %s rows from %s" % (format(len(rows), ","), os.path.basename(SRC)))

    # Product vocabulary, most common first so the index list is stable and
    # the page's dropdown reads sensibly.
    prod_counts = Counter((r.get("prod") or PROD_NONE) for r in rows)
    prods = [PROD_NONE] + [p for p, _ in prod_counts.most_common() if p != PROD_NONE]
    prod_ix = {p: i for i, p in enumerate(prods)}

    # DAYS SINCE the player's last deposit in each era, counted back from the
    # anchor (the most recent deposit day anywhere in the data). -1 means they
    # never deposited in that era.
    #
    # Days rather than years because the page offers both recency bands
    # (0-30, 31-90, ...) and cumulative churn thresholds ("no deposit in 90+
    # days"). The year is derived from the anchor and the day offset in the
    # page, so the payload does not carry the same fact twice.
    anchor = max(
        d for d in (
            (r.get("last_new") or None) for r in rows
        ) if d
    )
    anchor = max(anchor, max(d for d in ((r.get("last_old") or None) for r in rows) if d))
    anchor_d = date(*(int(x) for x in anchor.split("-")))
    print("anchor (most recent deposit day): %s" % anchor)

    def days_since(s):
        if not s:
            return -1
        return (anchor_d - date(*(int(x) for x in s.split("-")))).days

    # Reason vocabulary: index 0 is "not blocked" so an unfiltered page and a
    # not-blocked selection are distinguishable rather than both being empty.
    reason_counts = Counter((r.get("block_reason") or "") for r in rows)
    reasons = [""] + sorted(
        (x for x in reason_counts if x),
        key=lambda x: -reason_counts[x],
    )
    reason_ix = {x: i for i, x in enumerate(reasons)}
    unmapped = sorted(x for x in reasons if x and x not in GROUP_OF)
    if unmapped:
        print("NOTE: unmapped block_reason(s) -> 'Other': %s" % ", ".join(unmapped))

    nN, aN, nO, aO, fl, pr = [], [], [], [], [], []
    dN, dO = [], []
    rs = []
    # Lifetime GGR in cents, from bi.players_totals_v. That view covers the
    # POST-MIGRATION population only (47,108 depositors), so pre-migration-only
    # players have no GGR row at all — hg=0 marks them, and the page shows them
    # as their own "no GGR record" line rather than lumping them into zero.
    gg, hg = [], []
    # Adjusted GGR, same population as GGR. NOT ggr minus bonus cost and not
    # derivable from it — the two are computed upstream over different scopes,
    # and here adjusted runs 8.1m ABOVE raw because adjustments add to it.
    ag = []
    # Identity + FTD for the drill-down. FTD comes from reports.player_ftd and
    # can PREDATE the deposit data: that table goes back to 2016 while
    # deposit_transactions starts in May 2018, so a player's first deposit
    # here is not always their FTD. Stored as days before the anchor, which
    # allows negatives-as-older, so it is a plain int, -1 when absent.
    pid, un, ft = [], [], []
    # Country is interned to a vocabulary + index: 102k repeated strings would
    # otherwise be most of the payload. "VPN Player" is a real value here, not
    # a null — the source uses it for masked geo.
    co, dd = [], []
    block_types = Counter()
    churn = Counter()
    bands = Counter()

    for r in rows:
        nN.append(int(r.get("n_new") or 0))
        aN.append(cents(r.get("amt_new")))
        gn = days_since(r.get("last_new"))
        dN.append(gn)
        nO.append(int(r.get("n_old") or 0))
        aO.append(cents(r.get("amt_old")))
        go = days_since(r.get("last_old"))
        dO.append(go)

        # Overall recency = the more recent of the two eras.
        gap = gn if go < 0 else (go if gn < 0 else min(gn, go))
        churn[(anchor_d - timedelta(days=gap)).year] += 1
        bands["0-30" if gap <= 30 else "31-90" if gap <= 90 else
              "91-180" if gap <= 180 else "181-360" if gap <= 360 else "360+"] += 1

        f = 0
        if r.get("ev"):
            f |= F_EMAIL
        if r.get("pv"):
            f |= F_PHONE
        if r.get("blocked"):
            f |= F_BLOCKED
        if r.get("whale"):
            f |= F_WHALE
        fl.append(f)

        pr.append(prod_ix[r.get("prod") or PROD_NONE])
        rs.append(reason_ix[r.get("block_reason") or ""])
        h = 1 if r.get("has_ggr") else 0
        hg.append(h)
        gg.append(cents(r.get("ggr")) if h else 0)
        ag.append(cents(r.get("adj_ggr")) if h else 0)
        pid.append(int(r.get("player_id") or 0))
        un.append(r.get("username") or "")
        ft.append(days_since(r.get("ftd_date")))
        co.append(r.get("country") or "")
        dd.append(int(r.get("deposit_days") or 0))
        block_types[r.get("block_type") or "(none)"] += 1

    # ---- reconcile against the figures the SQL reported directly -----------
    tot_new_c = sum(a for a, n in zip(aN, nN) if n)
    tot_old_c = sum(a for a, n in zip(aO, nO) if n)
    dep_new = sum(nN)
    dep_old = sum(nO)
    pl_new = sum(1 for n in nN if n)
    pl_old = sum(1 for n in nO if n)

    # Counts must match exactly. Money must match within the ROUNDING BUDGET:
    # the export rounds each player's total to 2dp before we sum it, so the
    # sum can drift by up to half a cent per rounded value. Asserting a flat
    # 0.01 here produces a failure that looks like a data bug and is not;
    # asserting a percentage would hide a genuinely dropped row.
    exact = [
        ("post-migration players", pl_new, EXPECT_NEW_PLAYERS),
        ("post-migration deposits", dep_new, EXPECT_NEW_DEPOSITS),
        ("pre-migration players", pl_old, EXPECT_OLD_PLAYERS),
        ("pre-migration deposits", dep_old, EXPECT_OLD_DEPOSITS),
        ("all-history players", len(rows), EXPECT_ALL_PLAYERS),
    ]
    money = [
        ("post-migration value", round(tot_new_c / 100.0, 2), EXPECT_NEW_VALUE, pl_new),
        ("pre-migration value", round(tot_old_c / 100.0, 2), EXPECT_OLD_VALUE, pl_old),
    ]

    bad = 0
    for label, got, want in exact:
        okay = got == want
        print("  %-26s %-18s %s" % (label, format(got, ","), "ok" if okay else "MISMATCH, expected %s" % format(want, ",")))
        if not okay:
            bad += 1

    for label, got, want, n_rounded in money:
        budget = n_rounded * 0.005
        diff = abs(got - want)
        okay = diff <= budget
        print("  %-26s %-18s %s (diff %.2f, budget %.2f over %s rounded values)"
              % (label, format(got, ","), "ok" if okay else "MISMATCH", diff, budget, format(n_rounded, ",")))
        if not okay:
            bad += 1

    if bad:
        sys.exit("%d figure(s) do not reconcile — not writing the payload" % bad)

    whales = sum(1 for f in fl if f & F_WHALE)
    if whales != 1:
        sys.exit("expected exactly one whale row, found %d" % whales)

    countries = sorted(set(co))
    country_ix = {c: i for i, c in enumerate(countries)}
    co_idx = [country_ix[c] for c in co]
    shorts = [short_country(c) for c in countries]

    # A collision would silently merge two countries in the UI. Fail instead.
    seen = {}
    for full, sh in zip(countries, shorts):
        if sh in seen and seen[sh] != full:
            sys.exit("country shortening collision: %r and %r both become %r"
                     % (seen[sh], full, sh))
        seen[sh] = full

    longest = max(shorts, key=len)
    changed = sum(1 for f, sh in zip(countries, shorts) if f != sh)
    print("countries: %s distinct (%s players with none); %s shortened, longest label now %r (%d chars)"
          % (format(len(countries), ","), format(sum(1 for c in co if not c), ","),
             changed, longest, len(longest)))

    payload = {
        "meta": {
            "eras": {
                "new": {"label": "Post-migration", "range": "12 Jul 2022 – 23 Aug 2026",
                        "rates": "reports.daily_average_rates (live daily feed)"},
                "old": {"label": "Pre-migration", "range": "23 May 2018 – 12 Jul 2022",
                        "rates": "reports.mig_btc_rates (reconstructed)"},
                "all": {"label": "All history", "range": "23 May 2018 – 23 Aug 2026",
                        "rates": "both rate tables, joined at the migration seam"},
            },
            "prods": prods,
            "blockTypes": dict(block_types),
            "churnYears": {str(y): c for y, c in sorted(churn.items())},
            "latestYear": max(churn),
            "anchor": anchor,
            "bands": dict(bands),
            "reasons": reasons,
            "reasonGroups": [[g, [reason_ix[r] for r in rs_ if r in reason_ix]]
                             for g, rs_ in REASON_GROUPS
                             if any(r in reason_ix for r in rs_)]
                            + ([["Other", [reason_ix[r] for r in unmapped]]] if unmapped else []),
            "reasonCounts": {r: reason_counts[r] for r in reasons if r},
            "ggrPlayers": sum(hg),
            "ggrTotal": round(sum(g for g, h in zip(gg, hg) if h) / 100.0, 2),
            "adjTotal": round(sum(a for a, h in zip(ag, hg) if h) / 100.0, 2),
            "countries": shorts,
            "countriesFull": countries,
            "players": len(rows),
        },
        "nN": nN, "aN": aN, "dN": dN, "nO": nO, "aO": aO, "dO": dO,
        "f": fl, "pr": pr, "rs": rs, "gg": gg, "ag": ag, "hg": hg,
        "id": pid, "un": un, "ft": ft, "co": co_idx, "dd": dd,
    }

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))

    size = os.path.getsize(OUT) / 1048576.0
    print("\nwrote %s  (%.1f MB)" % (os.path.basename(OUT), size))
    print("products:", ", ".join("%s=%d" % (p, prod_counts[p]) for p in prods))
    print("block types:", dict(block_types))
    print("last deposit year:", ", ".join("%d=%s" % (y, format(c, ",")) for y, c in sorted(churn.items())))
    order = ["0-30", "31-90", "91-180", "181-360", "360+"]
    print("recency band:     ", ", ".join("%s=%s" % (b, format(bands.get(b, 0), ",")) for b in order))

    # Both classifications must partition the depositor base — every player has
    # exactly one last-deposit day, so if these do not add up a row was lost.
    if sum(churn.values()) != len(rows):
        sys.exit("churn years do not partition: %d vs %d rows" % (sum(churn.values()), len(rows)))
    if sum(bands.values()) != len(rows):
        sys.exit("recency bands do not partition: %d vs %d rows" % (sum(bands.values()), len(rows)))
    if any(g < -1 for g in dN + dO):
        sys.exit("negative day offset — a deposit dated after the anchor")

    print("block reasons:")
    for g, members in REASON_GROUPS:
        present = [(r, reason_counts[r]) for r in members if reason_counts.get(r)]
        if present:
            print("  %-30s %7s   %s" % (
                g, format(sum(n for _, n in present), ","),
                ", ".join("%s=%s" % (r, format(n, ",")) for r, n in present)))
    print("  %-30s %7s" % ("(not blocked)", format(reason_counts.get("", 0), ",")))

    # Reasons must partition the base: every depositor is either not blocked or
    # blocked for exactly one reason.
    if sum(reason_counts.values()) != len(rows):
        sys.exit("block reasons do not partition: %d vs %d rows"
                 % (sum(reason_counts.values()), len(rows)))

    ggr_players = sum(hg)
    ggr_total = sum(g for g, h in zip(gg, hg) if h) / 100.0
    neg = sum(1 for g, h in zip(gg, hg) if h and g < 0)
    print("ggr: %s players carry a GGR record, total %s, %s of them negative"
          % (format(ggr_players, ","), format(round(ggr_total, 2), ","), format(neg, ",")))
    print("     (%s players have none — pre-migration only, no row in players_totals_v)"
          % format(len(rows) - ggr_players, ","))

    # players_totals_v is post-migration scoped; if that stops being true the
    # cross-tab silently starts describing a different population.
    if ggr_players != EXPECT_GGR_PLAYERS:
        sys.exit("expected %s players with a GGR record, found %s — has "
                 "players_totals_v changed scope, or has the data moved on?"
                 % (format(EXPECT_GGR_PLAYERS, ","), format(ggr_players, ",")))
    adj_total = sum(a for a, h in zip(ag, hg) if h) / 100.0
    neg_adj = sum(1 for a, h in zip(ag, hg) if h and a < 0)
    print("adjusted ggr: total %s (%s above raw GGR), %s players negative"
          % (format(round(adj_total, 2), ","), format(round(adj_total - ggr_total, 2), ","),
             format(neg_adj, ",")))
    if abs(adj_total - EXPECT_ADJ_TOTAL) > ggr_players * 0.005:
        sys.exit("adjusted GGR total %s does not match the %s snapshot (%s)"
                 % (format(round(adj_total, 2), ","), SNAPSHOT, format(EXPECT_ADJ_TOTAL, ",")))
    if abs(ggr_total - EXPECT_GGR_TOTAL) > ggr_players * 0.005:
        sys.exit("GGR total %s does not match the %s snapshot (%s)"
                 % (format(round(ggr_total, 2), ","), SNAPSHOT, format(EXPECT_GGR_TOTAL, ",")))

    # Date-independent invariants — these must hold whenever the export runs.
    if pl_new + pl_old < len(rows):
        sys.exit("era player counts are below the merged total — impossible")
    if dep_new + dep_old != sum(nN) + sum(nO):
        sys.exit("era deposit counts do not add up")
    if len(set(pid)) != len(pid):
        sys.exit("duplicate player_id in the export — a join is fanning out")
    if any(p <= 0 for p in pid):
        sys.exit("missing player_id in the export")
    blank = sum(1 for u in un if not u)
    if blank:
        print("NOTE: %s players have no username" % format(blank, ","))
    no_ftd = sum(1 for x in ft if x < 0)
    older = sum(1 for x, a in zip(ft, [max(dn, do) for dn, do in zip(dN, dO)]) if x > a)
    print("identity: %s ids, %s usernames, %s without an FTD date"
          % (format(len(pid), ","), format(len(pid) - blank, ","), format(no_ftd, ",")))
    print("          %s players have an FTD older than their first deposit here "
          "(player_ftd predates deposit_transactions)" % format(older, ","))
    print("cross-check is pinned to the %s snapshot" % SNAPSHOT)


if __name__ == "__main__":
    main()
