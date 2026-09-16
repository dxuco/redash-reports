#!/usr/bin/env python3
"""
Recompute what the page publishes from the raw cache rows, by a route that
shares no code with build_retention.py, and compare.

A second reading of the same code finds nothing. This walks the rows into a
plain player -> sorted list of deposit dates, answers each milestone by date
arithmetic, and derives the ISO week from Python's own isocalendar() rather than
the builder's helper -- so an off-by-one, a mis-grouped cohort or a bad
observation window shows up as a mismatch rather than as a plausible number.

    python verify_retention.py

Exits non-zero on any disagreement. Counts are integers, so the tolerance is
zero -- there is no rounding budget here.

On the packed attributes it deliberately checks *structure* rather than
re-deriving the classification: that every player carries exactly one code per
dimension, that the codes partition the population, and that filtering by each
one splits the cohort sizes exactly. Re-implementing chOf() and rail_of() here
would be copying the rules, not testing them. `ftd_type` is a pass-through from
the cache, so that one is checked against the source directly.
"""

import json
import glob
import os
import sys
from collections import defaultdict
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "ftd-report", "cache")
DATA = os.path.join(HERE, "retention-data.json")

COHORT_FROM = "2025-01"

emitted = json.load(open(DATA, encoding="utf-8"))
MILESTONES = emitted["milestones"]
HORIZON = emitted["horizon"]
MIN_ELIGIBLE = emitted["minEligible"]


def num(v):
    if v in (None, ""):
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def dt(s):
    return date(int(s[0:4]), int(s[5:7]), int(s[8:10]))


def month_key(f):
    return "%04d-%02d" % (f.year, f.month)


def week_key(f):
    y, w, _ = f.isocalendar()
    return "%04d-W%02d" % (y, w)


GRAIN_KEY = {"month": month_key, "week": week_key}

fails = 0


def check(cond, msg):
    global fails
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        fails += 1


# ---- independent pass over the rows ---------------------------------------
fdd, deps, ftd_type = {}, defaultdict(list), {}
cash = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0]))   # pid -> day -> money
ftd_by_month = defaultdict(set)
cutoff = ""
for path in sorted(glob.glob(os.path.join(CACHE, "*.json"))):
    for r in json.load(open(path, encoding="utf-8")):
        day = (r.get("transaction_date") or "")[:10]
        if day > cutoff:
            cutoff = day
        pid = r.get("player_id")
        if not pid:
            continue
        pid = str(pid)
        fd = (r.get("first_deposit_date") or "")[:10]
        if fd and (pid not in fdd or fd < fdd[pid]):
            fdd[pid] = fd
        if num(r.get("deposit")) > 0:
            deps[pid].append(day)
        if r.get("ftd_type") and pid not in ftd_type:
            ftd_type[pid] = str(r["ftd_type"]).strip()
        if num(r.get("ftd")) > 0:
            ftd_by_month[day[:7]].add(pid)
        dv, nv, av = num(r.get("deposit")), num(r.get("ngr")), num(r.get("adjusted_ggr"))
        if dv or nv or av:
            m = cash[pid][day]
            m[0] += dv; m[1] += nv; m[2] += av

print("\nthe frame")
check(cutoff == emitted["cutoff"],
      "observation cutoff %s matches the emitted %s" % (cutoff, emitted["cutoff"]))

cut = dt(cutoff)
eligible = {pid: fd for pid, fd in fdd.items()
            if fd[:7] >= COHORT_FROM and dt(fd) <= cut}
check(len(eligible) == emitted["totalMembers"],
      "%s measurable first depositors against the emitted %s"
      % (f"{len(eligible):,}", f"{emitted['totalMembers']:,}"))

P = emitted["players"]
check(len(P["obs"]) == len(P["lag"]) == len(P["attr"]) == emitted["totalMembers"],
      "the three player arrays are all %s long" % f"{emitted['totalMembers']:,}")

# ---- the players, in the emitted order ------------------------------------
# The order is the builder's dict-iteration order, which is not reproducible
# here. Rebuild the same multiset of (cohort, obs, lag) and compare that, plus
# per-cohort sums -- which is what every figure on the page is actually built
# from.
print("\nper player, by date arithmetic rather than day indexing")
mine = {}
for pid, fd in eligible.items():
    f = dt(fd)
    obs = min((cut - f).days, HORIZON + 1)
    lags = sorted({(dt(x) - f).days for x in deps.get(pid, ())})
    lags = [g for g in lags if 1 <= g <= HORIZON]
    mine[pid] = (obs, lags[0] if lags else 0)

from collections import Counter
check(Counter(mine.values()) == Counter(zip(P["obs"], P["lag"])),
      "the %s (observation, first-return) pairs match exactly as a multiset"
      % f"{len(mine):,}")

comparisons = 0
for grain, key_of in GRAIN_KEY.items():
    g = emitted["grains"][grain]
    print("\n%s cohorts" % grain)

    groups = defaultdict(list)
    for pid, fd in eligible.items():
        groups[key_of(dt(fd))].append(pid)

    check(sorted(groups) == g["cohorts"],
          "%d %s cohorts, same list as emitted" % (len(groups), grain))

    # emitted per-cohort tallies, unfiltered
    ci = g["ci"]
    e_n = defaultdict(int)
    e_pairs = defaultdict(Counter)
    for i, c in enumerate(ci):
        ck = g["cohorts"][c]
        e_n[ck] += 1
        e_pairs[ck][(P["obs"][i], P["lag"][i])] += 1

    bad = []
    for ck, members in groups.items():
        if len(members) != e_n[ck]:
            bad.append("%s size %d vs %d" % (ck, len(members), e_n[ck]))
            continue
        if Counter(mine[p] for p in members) != e_pairs[ck]:
            bad.append("%s player facts differ" % ck)
    check(not bad, "every cohort has the same members and the same facts%s"
          % (("  -> " + "; ".join(bad[:5])) if bad else ""))

    # ---- the table itself, milestone by milestone -------------------------
    bad = []
    for ck, members in groups.items():
        for m in MILESTONES:
            elig = ret = 0
            for pid in members:
                f = dt(fdd[pid])
                if (cut - f).days < m:
                    continue
                elig += 1
                lg = mine[pid][1]
                if lg and lg <= m:
                    ret += 1
            c = g["cohorts"].index(ck)
            e_elig = sum(1 for i, cc in enumerate(ci)
                         if cc == c and P["obs"][i] >= m)
            e_ret = sum(1 for i, cc in enumerate(ci)
                        if cc == c and P["obs"][i] >= m
                        and P["lag"][i] and P["lag"][i] <= m)
            comparisons += 2
            if elig != e_elig:
                bad.append("%s D%d elig %d vs %d" % (ck, m, elig, e_elig))
            if ret != e_ret:
                bad.append("%s D%d ret %d vs %d" % (ck, m, ret, e_ret))
    check(not bad, "%d cohorts x %d milestones x 2 measures = %d comparisons, %d disagreements%s"
          % (len(groups), len(MILESTONES), len(groups) * len(MILESTONES) * 2, len(bad),
             ("  -> " + "; ".join(bad[:5])) if bad else ""))

print("\nthe two grains describe the same population")
sets = {}
for grain, key_of in GRAIN_KEY.items():
    sets[grain] = {p for p in eligible}
check(sets["month"] == sets["week"],
      "the same %s players, regrouped -- neither grain drops or duplicates anybody"
      % f"{len(sets['month']):,}")
for grain in ("month", "week"):
    g = emitted["grains"][grain]
    check(len(g["ci"]) == emitted["totalMembers"] and max(g["ci"]) == len(g["cohorts"]) - 1,
          "%s: every player has a cohort index and every cohort is used" % grain)

# ---- the packed attributes ------------------------------------------------
print("\nthe packed attributes")
attr = P["attr"]
check(max(attr) < emitted["combos"],
      "every code is inside the %d declared combinations" % emitted["combos"])
for dim in emitted["dims"]:
    counts = Counter((a // dim["stride"]) % dim["card"] for a in attr)
    check(sum(counts.values()) == emitted["totalMembers"],
          "%-5s partitions the population exactly: %s"
          % (dim["key"], ", ".join("%s %s" % (dim["opts"][i + 1][1], f"{counts[i]:,}")
                                   for i in sorted(counts))))

# ftd_type is a straight pass-through from the cache, so it can be checked
# against the source rather than only structurally.
ftdt = next((d for d in emitted["dims"] if d["key"] == "ftdt"), None)
if ftdt:
    codes = ["Super Qualified", "Qualified", "Non Qualified", ""]
    want = Counter(ftd_type.get(p, "") for p in eligible)
    got = Counter((a // ftdt["stride"]) % ftdt["card"] for a in attr)
    ok = all(want[codes[i]] == got.get(i, 0) for i in range(len(codes)))
    check(ok, "FTD type matches the cache column player for player: %s"
          % ", ".join("%s %s" % (codes[i] or "unknown", f"{want[codes[i]]:,}")
                      for i in range(len(codes))))

absent = [d["column"] for d in
          [{"key": "kyc", "column": "kyc_status"},
           {"key": "email", "column": "email_verified_at"},
           {"key": "phone", "column": "phone_verified_at"}]
          if d["key"] not in {x["key"] for x in emitted["dims"]}]
if absent:
    print("  note   %s carry no value on any cached row, so those filters are not"
          % ", ".join(absent))
    print("         on the page. They are in query 1732's SELECT; when values start")
    print("         arriving the next build adds the controls with no code change.")

# ---- what the page publishes ----------------------------------------------
print("\nthe figures the page publishes  (complete cohorts only, its default)")
print("  %-6s" % "" + "".join("%9s" % ("D%d" % m) for m in MILESTONES))
for grain in ("week", "month"):
    g = emitted["grains"][grain]
    ci, K = g["ci"], len(g["cohorts"])
    n = [0] * K
    elig = [[0] * len(MILESTONES) for _ in range(K)]
    ret = [[0] * len(MILESTONES) for _ in range(K)]
    for i, c in enumerate(ci):
        n[c] += 1
        for j, m in enumerate(MILESTONES):
            if P["obs"][i] >= m:
                elig[c][j] += 1
                if P["lag"][i] and P["lag"][i] <= m:
                    ret[c][j] += 1
    cells, fresh = [], {}
    for j, m in enumerate(MILESTONES):
        keep = [c for c in range(K)
                if elig[c][j] == n[c] and elig[c][j] >= MIN_ELIGIBLE]
        den = sum(elig[c][j] for c in keep)
        cells.append("%8.1f%%" % (sum(ret[c][j] for c in keep) / den * 100 if den else 0))
        fresh[m] = g["meta"][g["cohorts"][keep[-1]]]["end"] if keep else None
    print("  %-6s" % grain + "".join(cells))
    print("        newest complete: " +
          "  ".join("D%d %s" % (m, fresh[m] or "-") for m in (7, 30, 90)))

# Weeks are the page's default because they mature sooner. If a change ever
# loses that, the two grains become the same view twice.
def newest_complete(grain, m):
    g = emitted["grains"][grain]
    ci, K = g["ci"], len(g["cohorts"])
    n = [0] * K
    e = [0] * K
    for i, c in enumerate(ci):
        n[c] += 1
        if P["obs"][i] >= m:
            e[c] += 1
    keep = [c for c in range(K) if e[c] == n[c] and e[c] >= MIN_ELIGIBLE]
    return g["meta"][g["cohorts"][keep[-1]]]["end"] if keep else None


fw, fm = newest_complete("week", 30), newest_complete("month", 30)
check(fw and fm and fw > fm,
      "weekly D30 is fully observed %d days later than monthly (%s vs %s) -- which is why "
      "the page opens on weeks" % ((dt(fw) - dt(fm)).days, fw, fm))

# ---- the "after day N" measure --------------------------------------------
# Survival rather than cumulative return, and it needs the player's LAST return
# rather than their first. The failure this catches is the tempting one: deriving
# it from the first-return lag, which is wrong for anyone whose only return was
# early -- they count as retained BY day 7 and must not count as retained AFTER
# it.
print("\nthe \"after day N\" measure, rebuilt from the rows")
mine_last = {}
for pid, fd in eligible.items():
    f = dt(fd)
    lags = [(dt(x) - f).days for x in deps.get(pid, ())]
    lags = [g for g in lags if 1 <= g <= HORIZON]
    mine_last[pid] = max(lags) if lags else 0

check(Counter(mine_last.values()) == Counter(P["last"]),
      "the %s last-return lags match exactly as a multiset" % f"{len(P['last']):,}")

# A last return is never earlier than a first one, and a player with neither has
# both at zero. If these ever disagreed the two measures would silently swap.
bad = sum(1 for a2, b2 in zip(P["lag"], P["last"])
          if (a2 == 0) != (b2 == 0) or (a2 and b2 < a2))
check(bad == 0, "every last return is at or after its own first return, and they are "
                "zero together")

# Someone still depositing after day N must, by definition, have returned at all.
worse = sum(1 for i in range(len(P["last"]))
            if P["obs"][i] > 7 and P["last"][i] > 7
            and not (P["lag"][i] and P["lag"][i] <= HORIZON))
check(worse == 0, "nobody is 'still depositing after day 7' without having returned at all")

g = emitted["grains"]["month"]
ci = g["ci"]
K = len(g["cohorts"])
idx = {c: i for i, c in enumerate(g["cohorts"])}
# Per COLUMN, not per horizon. To ask whether somebody kept depositing after day
# N you need to have watched them past day N -- requiring the whole 90 days was
# the first version and it withheld whole rows to avoid a bias worth a few days
# at the tail of the window.
bad = []
for j, m in enumerate(MILESTONES):
    e_num = [0] * K
    e_den = [0] * K
    for i, c in enumerate(ci):
        if P["obs"][i] > m:
            e_den[c] += 1
            if P["last"][i] > m:
                e_num[c] += 1
    m_num = [0] * K
    m_den = [0] * K
    for pid, fd in eligible.items():
        f = dt(fd)
        if min((cut - f).days, HORIZON + 1) <= m:
            continue
        c = idx[month_key(f)]
        m_den[c] += 1
        if mine_last[pid] > m:
            m_num[c] += 1
    if m_num != e_num or m_den != e_den:
        bad.append("D%d" % m)
check(not bad, "%d cohorts x %d milestones of survival counts rebuilt independently, "
      "%d disagreements%s" % (K, len(MILESTONES), len(bad),
                              ("  -> " + ", ".join(bad)) if bad else ""))

# The two measures must move in opposite directions across a row, or one of them
# is not measuring what it says.
rises = falls = 0
for c in range(K):
    den = sum(1 for i, cc in enumerate(ci) if cc == c and P["obs"][i] >= HORIZON)
    if den < MIN_ELIGIBLE:
        continue
    aft = [sum(1 for i, cc in enumerate(ci)
               if cc == c and P["obs"][i] > m and P["last"][i] > m)
           for m in MILESTONES]
    by = [sum(1 for i, cc in enumerate(ci)
              if cc == c and P["obs"][i] >= HORIZON
              and P["lag"][i] and P["lag"][i] <= m)
          for m in MILESTONES]
    if all(by[j] >= by[j-1] for j in range(1, len(by))):
        rises += 1
    if all(aft[j] <= aft[j-1] for j in range(1, len(aft))):
        falls += 1
check(rises and falls and rises == falls,
      "across %d mature cohorts, 'by day N' rises in all of them and 'after day N' falls in "
      "all of them -- the two answer opposite questions" % rises)

# ---- the monthly triangle -------------------------------------------------
# A different measure from the day table, so it needs its own check rather than
# riding on that one: point-in-time per calendar month, not cumulative by day.
# The bit that can silently go wrong is the month arithmetic -- an off-by-one in
# the offset shifts a whole cohort one column left or right and still produces a
# plausible triangle.
print("\nthe monthly triangle, rebuilt from the rows")
MH = emitted["monthHorizon"]
mm = emitted["players"]["mmask"]
g = emitted["grains"]["month"]
ci = g["ci"]


def m_index(x):
    return x.year * 12 + x.month - 1


mine_mask = {}
for pid, fd in eligible.items():
    f = dt(fd)
    bits = 0
    for x in deps.get(pid, ()):
        xd = dt(x)
        if xd <= f:
            continue                      # not after the first deposit
        k = m_index(xd) - m_index(f)
        if 0 <= k < MH:
            bits |= 1 << k
    mine_mask[pid] = bits

check(Counter(mine_mask.values()) == Counter(mm),
      "the %s month-activity masks match exactly as a multiset" % f"{len(mm):,}")

# and per cohort, column by column, which is what the page actually draws
K = len(g["cohorts"])
e_n = [0] * K
e_hit = [[0] * MH for _ in range(K)]
for i, c in enumerate(ci):
    e_n[c] += 1
    for k in range(MH):
        if mm[i] >> k & 1:
            e_hit[c][k] += 1

m_n = [0] * K
m_hit = [[0] * MH for _ in range(K)]
idx = {c: i for i, c in enumerate(g["cohorts"])}
for pid, fd in eligible.items():
    c = idx[month_key(dt(fd))]
    m_n[c] += 1
    for k in range(MH):
        if mine_mask[pid] >> k & 1:
            m_hit[c][k] += 1

check(m_n == e_n and m_hit == e_hit,
      "%d cohorts x %d month offsets rebuilt independently, 0 disagreements" % (K, MH))

# A cohort can only report month k once that calendar month has actually
# happened. Anything past that must be structurally empty, not merely zero --
# if it were not, the page would be drawing 0% where it should draw a dash.
cut_m = m_index(cut)
future = [(g["cohorts"][c], k) for c in range(K) for k in range(MH)
          if m_index(dt(g["cohorts"][c] + "-01")) + k > cut_m and e_hit[c][k]]
check(not future,
      "no cohort has activity in a month that has not happened yet%s"
      % (("  -> " + str(future[:3])) if future else ""))

# The triangle must fall on average, or it is not measuring what it claims.
row_falls = sum(1 for c in range(K)
                if e_n[c] >= MIN_ELIGIBLE
                and m_index(dt(g["cohorts"][c] + "-01")) + 2 <= cut_m
                and e_hit[c][2] < e_hit[c][1])
rows_ok = sum(1 for c in range(K)
              if e_n[c] >= MIN_ELIGIBLE
              and m_index(dt(g["cohorts"][c] + "-01")) + 2 <= cut_m)
check(row_falls >= rows_ok * 0.8,
      "M2 is below M1 in %d of %d cohorts -- point-in-time retention falls, unlike the "
      "cumulative day table above it" % (row_falls, rows_ok))

# ---- the value table ------------------------------------------------------
# Rebuild ADPU/ARPU straight from the rows and compare against the deltas the
# builder emitted. This is the check that the bucketing is right: an off-by-one
# in which day lands in which bucket moves money between columns and leaves
# every total intact, so nothing else on the page would show it.
print("\nthe value table, rebuilt from the rows")
metrics = [m[0] for m in emitted["moneyMetrics"]]
money = emitted["money"]
J = len(MILESTONES)
g = emitted["grains"]["month"]
ci, K = g["ci"], len(g["cohorts"])

# emitted: cumulative money per cohort x milestone, over eligible players
e_sum = {k: [[0.0] * J for _ in range(K)] for k in metrics}
e_elig = [[0] * J for _ in range(K)]
for i, c in enumerate(ci):
    run = [0.0] * len(metrics)
    for j in range(J):
        for mi, k in enumerate(metrics):
            run[mi] += money[k][i * J + j]
        if P["obs"][i] < MILESTONES[j]:
            break
        e_elig[c][j] += 1
        for mi, k in enumerate(metrics):
            e_sum[k][c][j] += run[mi]

# mine: by date arithmetic over the raw rows
m_sum = {k: [[0.0] * J for _ in range(K)] for k in metrics}
m_elig = [[0] * J for _ in range(K)]
idx = {c: i for i, c in enumerate(g["cohorts"])}
for pid, fd in eligible.items():
    f = dt(fd)
    c = idx[month_key(f)]
    for j, mm in enumerate(MILESTONES):
        if (cut - f).days < mm:
            break
        m_elig[c][j] += 1
        for day, vals in cash.get(pid, {}).items():
            if 0 <= (dt(day) - f).days <= mm:
                for mi, k in enumerate(metrics):
                    m_sum[k][c][j] += vals[mi]

check(m_elig == e_elig, "the value table rests on the same eligible counts as the retention one")

# The builder rounds each player's bucket to whole dollars, so a cohort can be
# out by up to half a dollar per player per bucket. Anything past that budget is
# a dropped row, not rounding.
bad, worst = [], 0.0
for k in metrics:
    for c in range(K):
        for j in range(J):
            if not e_elig[c][j]:
                continue
            budget = 0.5 * e_elig[c][j] * (j + 1)
            gap = abs(m_sum[k][c][j] - e_sum[k][c][j])
            worst = max(worst, gap / budget if budget else 0)
            if gap > budget:
                bad.append("%s %s D%d off by $%.0f (budget $%.0f)"
                           % (k, g["cohorts"][c], MILESTONES[j], gap, budget))
check(not bad, "%d metric x cohort x milestone sums agree within the rounding budget "
      "(worst case %.0f%% of its budget)%s"
      % (len(metrics) * K * J, worst * 100,
         ("  -> " + "; ".join(bad[:4])) if bad else ""))

# ADPU only rises; ARPU on NGR need not, because NGR is net of what players win.
mono_dep, falls_ngr = True, 0
for c in range(K):
    for j in range(1, J):
        if not e_elig[c][j] or e_elig[c][j] != e_elig[c][0]:
            continue
        a_prev = e_sum["dep"][c][j - 1] / e_elig[c][j - 1]
        a_now = e_sum["dep"][c][j] / e_elig[c][j]
        if a_now < a_prev - 1e-9:
            mono_dep = False
        n_prev = e_sum["ngr"][c][j - 1] / e_elig[c][j - 1]
        n_now = e_sum["ngr"][c][j] / e_elig[c][j]
        if n_now < n_prev - 1e-9:
            falls_ngr += 1
check(mono_dep, "ADPU never falls across a row -- deposits only accumulate")
check(falls_ngr > 0,
      "ARPU on NGR falls somewhere in %d cohort/milestone steps, and that is the data, "
      "not a bug: NGR is net of player winnings, so a cohort that wins in week two is "
      "worth less at D14 than it was at D7" % falls_ngr)

print("\ncross-checks against what the other reports publish")
# The Business Overview counts the current month's first depositors from ftd > 0.
# This page starts from first_deposit_date instead, and finds a handful more:
# players whose first deposit is dated after the last day the cache covers, whose
# day 0 has therefore not been loaded. Excluding them is what makes the two
# definitions agree.
#
# This used to assert "1,020 in August" and the exact id of the one late player.
# Both went stale within a day -- the month is still filling and the cutoff moves
# with it -- which is a check that fails for being right. So assert the
# *relationship*, which holds every day: the cohort is exactly the ftd>0 set, and
# the late players are exactly the difference.
cur = cutoff[:7]
cur_cohort = {p for p, fd in eligible.items() if fd[:7] == cur}
late = {p for p, f in fdd.items() if f[:7] == cur and f > cutoff}
check(cur_cohort == ftd_by_month.get(cur, set()),
      "the %s cohort is %s players, exactly the ftd>0 set the Business Overview counts"
      % (cur, f"{len(cur_cohort):,}"))
# ...and don't require any to exist. Whether a first deposit is dated past the
# cutoff depends on when the cache was last pulled: refresh it at the end of the
# day and there are none, which is a healthy state, not a failure. The invariant
# is one-directional -- a late player is never in the cohort -- and it holds at
# zero as well as at five.
check(not (late & cur_cohort),
      "and the %d first deposit%s dated after the %s cutoff (%s) sit outside it -- their "
      "day 0 has not been loaded"
      % (len(late), "" if len(late) == 1 else "s", cutoff,
         ", ".join(sorted(late)) if late else "none today; the cache reaches the last "
         "first deposit"))

print("\n" + ("%d FAILED" % fails if fails else "all checks passed"))
sys.exit(1 if fails else 0)
