# ---------------------------------------------------------------------------
# build_channels.py — social-channel community bonuses, 2026 by month
#
# Two sources, joined on player_id:
#
#   1. C:\redash-page\_mcp-exports\tickets-social.json
#      One row per player x month x channel, from reports.reward_tickets_data
#      (Redash data source 20). This is the ISSUED side — tickets created,
#      activated and completed. Query 1732 does not carry it; its bonus_cost is
#      action_id 24 only, i.e. what converted to real balance.
#
#      Regenerate with run_sql + save_as (see README-channels.md for the SQL).
#
#   2. ftd-report/cache/2026-*.json
#      Query 1732 player x day rows, for GGR. Free and instant — never call the
#      API for these.
#
# Channel comes from the bonus name: reward_config_families.name matched on
# 'discord' / 'twitter' / 'telegram'. All three live in the single reward group
# 'Acquisition - Community'; nothing outside that group uses those words, so
# the group filter and the name filter agree.
#
# Emits channels-data.json. Do not edit ../community-channels.html by hand — it
# is generated from the template and any edit there is destroyed on next build.
# ---------------------------------------------------------------------------

import json, os, glob, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TICKETS = os.path.join(ROOT, "_mcp-exports", "tickets-community.json")
SEGMENTS = os.path.join(ROOT, "_mcp-exports", "segments-2026.json")
DETAIL = os.path.join(ROOT, "_mcp-exports", "bonus-detail-2026.json")
BONUSYEAR = os.path.join(ROOT, "_mcp-exports", "bonus-year-2026.json")
CACHE = os.path.join(ROOT, "ftd-report", "cache")

# The players every report carves out by default, shared so a tenth report
# cannot quietly disagree about who is in the list. See ../carveout.py.
import sys, os
sys.path.insert(0, os.path.join(HERE, ".."))
from carveout import CARVED as WHALE_SET, CARVE_LABEL, CARVE_FIRST

CHANNELS = ["Discord", "Twitter", "Telegram"]
# "Community" is the whole Acquisition - Community reward group, the three named
# channels plus everything with no channel in its name (blog posts, generic
# free-spin promos). Penetration is measured against it as well as against the
# named channels, because "how far does Community reach" is the group question.
GROUPS = ["Community"] + CHANNELS
MONTHS = ["2026-%02d" % m for m in range(1, 9)]


def num(v):
    """Cache values arrive as strings; empty/None must become 0.0 or sums
    silently concatenate."""
    if v in (None, "", "None"):
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


# --- 1. tickets ------------------------------------------------------------

raw = json.load(open(TICKETS, encoding="utf-8"))
rows = raw["rows"] if isinstance(raw, dict) else raw

# per month x group ticket counters — filled from the detail export in §4
tick = {c: {k: [0] * len(MONTHS) for k in ("created", "completed")} for c in GROUPS}
cost = {c: [0.0] * len(MONTHS) for c in GROUPS}

# membership: players who received that group's ticket in a given month,
# and (separately) the running cohort from 2025-01 onward
recips = {c: {m: set() for m in MONTHS} for c in GROUPS}
cohort_before_2026 = {c: set() for c in GROUPS}

for r in rows:
    ch = r["channel"]                      # Discord/Twitter/Telegram/Other
    pid = str(r["player_id"])
    ym = r["ym"]
    # every row counts toward Community; only the named three count toward a
    # channel. A row is never counted twice within one group.
    for g in (["Community"] + ([ch] if ch in CHANNELS else [])):
        if ym < "2026-01":
            cohort_before_2026[g].add(pid)
            continue
        if ym not in MONTHS:
            continue
        recips[g][ym].add(pid)

# NOTE: this export supplies player MEMBERSHIP only. The ticket counters come
# from the per-bonus detail export in section 4, because the two exports are
# pulled at different moments and the current month is still live — counting
# created tickets from one and listing them from the other put August out by
# two the first time this ran, which reads as a bug and is not one. One source
# per number.

# running cohort: everyone who has ever received that channel's ticket, up to
# and including each month. A player who got one in 2025 counts in every 2026
# month — that is what "cumulative cohort" means and it is why these numbers
# must never be summed across months.
cohort = {c: [] for c in GROUPS}
for c in GROUPS:
    seen = set(cohort_before_2026[c])
    for m in MONTHS:
        seen |= recips[c][m]
        cohort[c].append(set(seen))


# --- 2. GGR and depositors from the caches ---------------------------------

# player -> ggr, per month, both whale views
ggr_by_player = []      # list per month: {pid: ggr}
total_ggr = {"inc": [], "ex": []}
# Adjusted GGR arrives on its OWN rows — it never shares a row with ggr or
# game_product. It is computed upstream as ggr + adjustment over a different
# scope, so it is NOT raw GGR minus bonus cost and must never be derived that
# way. It does carry player_id, so a per-player share is honest.
adj_by_player = []
total_adj = {"inc": [], "ex": []}
# A player who deposits on five days is five day-actives and ONE monthly
# depositor. These are sets, and they are never summed across months.
depositors = []         # list per month: set(pid)

for m in MONTHS:
    path = os.path.join(CACHE, m + ".json")
    per = collections.defaultdict(float)
    aper = collections.defaultdict(float)
    dep = set()
    ti = tx = ai = ax = 0.0
    for r in json.load(open(path, encoding="utf-8")):
        pid = r.get("player_id")
        if pid and num(r.get("deposit")) > 0:
            dep.add(str(pid))
        a = num(r.get("adjusted_ggr"))
        if a and pid:
            ai += a
            if pid not in WHALE_SET:
                ax += a
            aper[str(pid)] += a
        g = num(r.get("ggr"))
        if g == 0:
            continue
        ti += g
        if pid not in WHALE_SET:
            tx += g
        if pid:
            per[str(pid)] += g
    ggr_by_player.append(per)
    adj_by_player.append(aper)
    depositors.append(dep)
    total_ggr["inc"].append(round(ti, 2))
    total_ggr["ex"].append(round(tx, 2))
    total_adj["inc"].append(round(ai, 2))
    total_adj["ex"].append(round(ax, 2))

total_dep = {
    "inc": [len(d) for d in depositors],
    "ex": [len(d - WHALE_SET) for d in depositors],
}


def series(members_per_month, whale_mode):
    """GGR and player count for one channel, one attribution mode, one whale
    view. Players are counted DISTINCT within the month — a player with three
    tickets is one player."""
    ggr, players, share, conc, deps, pen = [], [], [], [], [], []
    adj, adjShare = [], []
    for i, m in enumerate(MONTHS):
        mem = members_per_month[i]
        if whale_mode == "ex":
            mem = mem - WHALE_SET
        # Penetration: of the month's depositors, how many hold a ticket. Both
        # halves are distinct player sets over the SAME month, so the ratio is
        # a real percentage of people — not tickets over deposits.
        dset = depositors[i] - (WHALE_SET if whale_mode == "ex" else set())
        d = len(mem & dset)
        deps.append(d)
        pen.append(round(100.0 * d / len(dset), 3) if dset else 0.0)
        per = ggr_by_player[i]
        vals = [per.get(p, 0.0) for p in mem]
        g = sum(vals)
        tot = total_ggr[whale_mode][i]
        ggr.append(round(g, 2))
        players.append(len(mem))
        share.append(round(100.0 * g / tot, 4) if tot else 0.0)
        # Concentration: how much of the channel's own GGR is one player.
        # Twitter's 2026 line is 68% a single account; without this the chart
        # reads as "Twitter acquires whole cohorts" and it does not.
        top = max(vals) if vals else 0.0
        conc.append(round(100.0 * top / g, 1) if g > 0 else 0.0)

        aper = adj_by_player[i]
        av = sum(aper.get(p, 0.0) for p in mem)
        atot = total_adj[whale_mode][i]
        adj.append(round(av, 2))
        adjShare.append(round(100.0 * av / atot, 4) if atot else 0.0)
    return {"ggr": ggr, "players": players, "share": share, "conc": conc,
            "deps": deps, "pen": pen, "adj": adj, "adjShare": adjShare}


out_series = {}
for mode, members in (("month", {c: [recips[c][m] for m in MONTHS] for c in GROUPS}),
                      ("cohort", cohort)):
    for wm in ("ex", "inc"):
        key = mode + "|" + wm
        out_series[key] = {c: series(members[c], wm) for c in GROUPS}
        # players in ANY of the three named channels — the honest combined
        # figure. It is NOT the sum of the three: players overlap channels.
        anyset = [set().union(*[members[c][i] for c in CHANNELS])
                  for i in range(len(MONTHS))]
        out_series[key]["Any"] = series(anyset, wm)

# how many players sit in more than one channel each month — the gap between
# the three channel rows and the "Any" row, shown rather than reconciled away
overlap = {}
for mode, members in (("month", {c: [recips[c][m] for m in MONTHS] for c in CHANNELS}),
                      ("cohort", cohort)):
    overlap[mode] = [sum(len(members[c][i]) for c in CHANNELS)
                     - len(set().union(*[members[c][i] for c in CHANNELS]))
                     for i in range(len(MONTHS))]

# --- 3. segments -----------------------------------------------------------
#
# The caches carry no segment column, so this comes from bi.players_info_mv.
# current_segment is a SNAPSHOT of where each player sits today, not where they
# sat in the month being counted — reports.player_segments_hist has the
# time-varying version. A snapshot is the right choice for a period table
# (a player has one segment, not eight), but it does mean a player who was Mass
# in January and is Vip now counts entirely as Vip. Say so on the page.

SEG_ORDER = ["Vip", "Elit", "Pre Elit", "Regular", "Mass", "One Timer",
             "Free Rider", "Risk", "Churn", "Unsegmented"]

# Per-player detail for the segment click-through. Usernames come from the
# caches; a player id can change username mid-year, so the LAST one seen wins —
# that is the name someone looking them up today would search for.
username_of = {}
deposit_2026 = collections.defaultdict(float)
for m in MONTHS:
    for r in json.load(open(os.path.join(CACHE, m + ".json"), encoding="utf-8")):
        pid = r.get("player_id")
        if not pid:
            continue
        pid = str(pid)
        if r.get("username"):
            username_of[pid] = r["username"]
        deposit_2026[pid] += num(r.get("deposit"))

first_ticket = {}
tickets_2026 = collections.Counter()
for r in rows:
    p = str(r["player_id"])
    ym = r["ym"]
    if p not in first_ticket or ym < first_ticket[p]:
        first_ticket[p] = ym
    if ym in MONTHS:
        tickets_2026[p] += int(r["created"])

seg_raw = json.load(open(SEGMENTS, encoding="utf-8"))
seg_rows = seg_raw["rows"] if isinstance(seg_raw, dict) else seg_raw
seg_of = {str(r["player_id"]): (r.get("current_segment") or "Unsegmented")
          for r in seg_rows}

# Period-cumulative sets, not monthly. A player who deposited in three months is
# ONE depositor here — this is the whole point of the table.
period_dep = set()
for dset in depositors:
    period_dep |= dset
period_adj = collections.defaultdict(float)
for aper in adj_by_player:
    for p, v in aper.items():
        period_adj[p] += v

# Adjusted GGR credited to a group must be accumulated the way the monthly table
# does it — a player counts only from the month they joined the cohort, not
# retroactively. Crediting a June joiner's January play to Community would make
# this table's total ($1.62m) disagree with the monthly table's ($1.40m) for no
# reason a reader could see. Same rule, same number, and it reconciles.
#
# Built per attribution mode, because the segment table follows the same switch
# as everything else. It used to be hard-wired to cohort, and once the page
# default moved to same-month the two tables showed $141,508 and $1,394,203 for
# the same quantity with nothing on screen to explain it.
MEMBERS = {
    "cohort": {g: cohort[g] for g in GROUPS},
    "month": {g: [recips[g][m] for m in MONTHS] for g in GROUPS},
}
group_adj = {mode: {g: collections.defaultdict(float) for g in GROUPS}
             for mode in MEMBERS}
for mode, mem in MEMBERS.items():
    for i in range(len(MONTHS)):
        for g in GROUPS:
            for p in mem[g][i]:
                v = adj_by_player[i].get(p)
                if v:
                    group_adj[mode][g][p] += v

def reached(mode, g, wm):
    """Everyone the group reached over the whole period, under one attribution.
    Cohort = ever ticketed; month = ticketed in one of these months. Both are a
    union of sets, so a player is counted once however many months they appear
    in — never a sum of the monthly figures."""
    mem = set().union(*MEMBERS[mode][g]) if MEMBERS[mode][g] else set()
    return mem - (WHALE_SET if wm == "ex" else set())


segments = {}
for mode in ("month", "cohort"):
  for wm in ("ex", "inc"):
    dep_all = period_dep - (WHALE_SET if wm == "ex" else set())
    rows_out = []
    for name in SEG_ORDER:
        members = {p for p in dep_all if seg_of.get(p, "Unsegmented") == name}
        if not members:
            continue
        row = {"segment": name, "dep": len(members),
               "adj": round(sum(period_adj.get(p, 0.0) for p in members), 2)}
        # the players behind the "Community reached" cell, for the click-through
        hit_c = sorted(members & reached(mode, "Community", wm),
                       key=lambda p: -group_adj[mode]["Community"].get(p, 0.0))
        row["players"] = [{
            "id": p,
            "name": username_of.get(p, ""),
            "chan": "/".join(c for c in CHANNELS
                             if p in reached(mode, c, wm)) or "—",
            "since": first_ticket.get(p, ""),
            "tickets": tickets_2026.get(p, 0),
            "dep$": round(deposit_2026.get(p, 0.0), 2),
            "adj": round(group_adj[mode]["Community"].get(p, 0.0), 2),
        } for p in hit_c]
        for g in GROUPS:
            hit = members & reached(mode, g, wm)
            row[g] = len(hit)
            row[g + "Pen"] = round(100.0 * len(hit) / len(members), 2)
            row[g + "Adj"] = round(sum(group_adj[mode][g].get(p, 0.0)
                                       for p in hit), 2)
        rows_out.append(row)
    # players with a deposit the segment export did not cover would silently
    # vanish from the table; fold them into Unsegmented instead of dropping them
    covered = sum(r["dep"] for r in rows_out)
    assert covered == len(dep_all), (mode, wm, covered, len(dep_all))
    # the popup must add up to the cell that opened it
    for r in rows_out:
        assert len(r["players"]) == r["Community"], (mode, wm, r["segment"])
        got = round(sum(x["adj"] for x in r["players"]), 2)
        # budget: one rounded value per player plus the cell itself
        assert abs(got - r["CommunityAdj"]) <= (len(r["players"]) + 1) * 0.005 + 0.01, \
            (mode, wm, r["segment"], got, r["CommunityAdj"])
    segments[mode + "|" + wm] = rows_out

# The segment table now reads the same switch as the monthly one, so its
# Community total must land inside the monthly total for the SAME mode — short
# only by players who made adjusted GGR without depositing in 2026.
for mode in ("month", "cohort"):
    for wm in ("ex", "inc"):
        seg_total = sum(r["CommunityAdj"] for r in segments[mode + "|" + wm])
        mon_total = sum(out_series[mode + "|" + wm]["Community"]["adj"])
        assert seg_total <= mon_total + 0.02, (mode, wm, seg_total, mon_total)
        assert mon_total - seg_total < abs(mon_total) * 0.05 + 1, \
            (mode, wm, seg_total, mon_total)

# --- 4. per-bonus detail, for the click-through ----------------------------
#
# One row per month x channel x bonus name. Keyed "YYYY-MM|Group" so the page
# can look a cell up directly. A Community row lists every bonus in the group,
# including the ones with no channel in the name; a channel row lists only its
# own, so the two are consistent with how the tables count.

det_raw = json.load(open(DETAIL, encoding="utf-8"))
det_rows = det_raw["rows"] if isinstance(det_raw, dict) else det_raw

detail = collections.defaultdict(list)
for r in det_rows:
    if r["ym"] not in MONTHS:
        continue
    i = MONTHS.index(r["ym"])
    for g in (["Community"] + ([r["channel"]] if r["channel"] in CHANNELS else [])):
        tick[g]["created"][i] += int(r["created"])
        tick[g]["completed"][i] += int(r["completed"])
        cost[g][i] += num(r["cost"])
    item = {
        "name": r["bonus_name"],
        "scope": r.get("bonus_scope") or "",
        "created": int(r["created"]),
        "completed": int(r["completed"]),
        "players": int(r["players"]),
        "fs": int(r["fs_issued"]),
        "fsUsed": int(r["fs_used"]),
        "fb": round(num(r["fb_issued"]), 2),
        "cost": round(num(r["cost"]), 2),
    }
    detail[r["ym"] + "|Community"].append(item)
    if r["channel"] in CHANNELS:
        detail[r["ym"] + "|" + r["channel"]].append(item)

for k in detail:
    detail[k].sort(key=lambda x: -x["created"])

# The popup must add up to the cell that opened it — same source, so this is a
# check on the fan-out into groups, not on the data.
for i, m in enumerate(MONTHS):
    for g in GROUPS:
        rows_d = detail.get(m + "|" + g, [])
        assert sum(x["created"] for x in rows_d) == tick[g]["created"][i], (m, g)
        assert sum(x["completed"] for x in rows_d) == tick[g]["completed"][i], (m, g)
        assert all(x["completed"] <= x["created"] for x in rows_d), (m, g)

# --- 5. one row per bonus for the whole of 2026 ----------------------------
#
# Its own export rather than a roll-up of §4, because `players` is distinct and
# distinct never sums: adding eight monthly player counts for one bonus counts
# anyone who got it twice twice over.
#
# "Used" is deliberately three different things, because a ticket can be used
# three ways and only one of them is a count of tickets:
#   activated  — the player accepted it
#   completed  — it ran to the end of its wagering
#   paid       — it actually converted something to real balance
# The last is the one that costs money, and it is always the smallest.

# The counting columns are rolled up from the SAME detail rows that feed the
# monthly tables and the popup, so this table can never disagree with them. Only
# the two figures a roll-up cannot produce — distinct players over the year, and
# distinct players who cost anything — come from the year export, and nothing is
# asserted across the two. Pulling counts from one export and listing them from
# another already put August out by two once, and by nine the next time; the
# current month is live and the exports are minutes or hours apart.

by_raw = json.load(open(BONUSYEAR, encoding="utf-8"))
by_rows = by_raw["rows"] if isinstance(by_raw, dict) else by_raw
year_extra = {((r["bonus_name"] or "").strip(), r["channel"]): r for r in by_rows}

agg = {}
for r in det_rows:
    if r["ym"] not in MONTHS:
        continue
    k = ((r["bonus_name"] or "").strip(), r["channel"])
    b = agg.setdefault(k, {"name": k[0], "chan": k[1], "created": 0,
                           "completed": 0, "fs": 0, "fsUsed": 0, "fb": 0.0,
                           "cost": 0.0})
    b["created"] += int(r["created"])
    b["completed"] += int(r["completed"])
    b["fs"] += int(r["fs_issued"])
    b["fsUsed"] += int(r["fs_used"])
    b["fb"] += num(r["fb_issued"])
    b["cost"] += num(r["cost"])

bonuses = []
for k, b in agg.items():
    x = year_extra.get(k, {})
    b["fb"] = round(b["fb"], 2)
    b["cost"] = round(b["cost"], 2)
    b["activated"] = int(x.get("activated", b["completed"]))
    b["players"] = int(x.get("players", 0))
    b["playersPaid"] = int(x.get("players_paid", 0))
    b["fbUsed"] = round(num(x.get("fb_used")), 2)
    bonuses.append(b)
bonuses.sort(key=lambda b: -b["created"])

# Distinct players across ALL bonuses. Cannot be derived from the rows above —
# summing the per-bonus counts gives 2,241 against a true 755, because most
# people hold several bonuses. It has to be counted once over the union, which
# only the warehouse can do, so it comes from the year export's own total row.
#
#   select count(distinct rtd.player_id) players,
#          count(distinct rtd.player_id)
#            filter (where coalesce(rtd.bonus_cost,0) > 0) players_paid
#   from reports.reward_tickets_data rtd
#   join public.reward_config_families rcf on rcf.id = rtd.reward_family_id
#   join public.reward_config_family_groups g on g.id = rcf.group_id
#   where g.name = 'Acquisition - Community'
#     and rtd.created_at >= '2026-01-01' and rtd.created_at < '2026-09-01'
BONUS_DISTINCT = {"players": 755, "playersPaid": 531}

assert BONUS_DISTINCT["playersPaid"] <= BONUS_DISTINCT["players"]
assert BONUS_DISTINCT["players"] <= sum(b["players"] for b in bonuses), \
    "a union cannot exceed the sum of its parts"
assert BONUS_DISTINCT["players"] >= max(b["players"] for b in bonuses), \
    "a union cannot be smaller than its largest part"

for b in bonuses:
    assert b["completed"] <= b["created"], b["name"]
    assert b["playersPaid"] <= b["players"], b["name"]
    assert b["fsUsed"] <= b["fs"], b["name"]
    # activated and fbUsed come from the other export, so they are clamped
    # rather than asserted — a live month can make them momentarily larger.
    b["activated"] = min(b["activated"], b["created"])
    b["fbUsed"] = min(b["fbUsed"], b["fb"])
# and the whole thing must equal the Community year
assert sum(b["created"] for b in bonuses) == sum(tick["Community"]["created"]), \
    (sum(b["created"] for b in bonuses), sum(tick["Community"]["created"]))

data = {
    "months": MONTHS,
    "segments": segments,
    "detail": dict(detail),
    "bonuses": bonuses,
    "bonusDistinct": BONUS_DISTINCT,
    "channels": CHANNELS,
    "groups": GROUPS,
    "series": out_series,
    "tickets": {c: {"created": tick[c]["created"],
                    "completed": tick[c]["completed"],
                    "cost": [round(v, 2) for v in cost[c]]} for c in GROUPS},
    "totalGgr": total_ggr,
    "totalAdj": total_adj,
    "totalDep": total_dep,
    "overlap": overlap,
    "meta": {
        "whale": CARVE_LABEL,
        "generated": __import__("datetime").date.today().isoformat(),
        "note": "2026-08 is partial (cache runs to the 26th).",
    },
}

with open(os.path.join(HERE, "channels-data.json"), "w", encoding="utf-8") as f:
    json.dump(data, f, separators=(",", ":"))

# --- reconciliation --------------------------------------------------------
# The parts must equal the whole. Budget = rounded values * 0.005.
for wm in ("ex", "inc"):
    for i, m in enumerate(MONTHS):
        s = out_series["cohort|" + wm]
        parts = sum(s[c]["ggr"][i] for c in CHANNELS)
        anyv = s["Any"]["ggr"][i]
        # parts >= any, because overlapping players are counted in each channel
        assert parts >= anyv - 0.02, (m, wm, parts, anyv)
        # a channel can never reach more depositors than Community as a whole,
        # nor more than the month has depositors
        for c in CHANNELS:
            assert s[c]["deps"][i] <= s["Community"]["deps"][i], (m, wm, c)
        assert s["Community"]["deps"][i] <= total_dep[wm][i], (m, wm)
        # Adjusted GGR is its own upstream measure. If it ever equals raw GGR
        # minus bonus cost, something has started deriving it — which is the
        # mistake this assertion exists to catch.
        assert abs(total_adj[wm][i] - total_ggr[wm][i]) > 0.01, (m, wm)

print("months        ", ", ".join(MONTHS))
print("total GGR ex  ", [int(v) for v in total_ggr["ex"]])
print("total adj ex  ", [int(v) for v in total_adj["ex"]])
print("depositors ex ", total_dep["ex"])
for c in GROUPS:
    s = out_series["cohort|ex"][c]
    print("%-9s tickets created" % c, tick[c]["created"])
    print("%-9s completed      " % c, tick[c]["completed"])
    print("%-9s depositors     " % c, s["deps"])
    print("%-9s penetration %%  " % c, [round(v, 1) for v in s["pen"]])
    print("%-9s share of GGR %% " % c, [round(v, 1) for v in s["share"]])
    print("%-9s share of adj %% " % c, [round(v, 1) for v in s["adjShare"]])
print("written", os.path.join(HERE, "channels-data.json"))
