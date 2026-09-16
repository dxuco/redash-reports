"""Second pass: who/what drives the June 2026 GGR swing, and is the cache clean?"""
import json, os
from collections import defaultdict

ROOT = "/sessions/epic-vigilant-bohr/mnt/redash-page"
CACHE = os.path.join(ROOT, "ftd-report", "cache")
WHALE = "1709996"


def num(v):
    if v in (None, ""):
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def money(x):
    return ("-" if x < 0 else "") + "$" + format(abs(x), ",.0f")


def load(m):
    with open(os.path.join(CACHE, m + ".json")) as f:
        return json.load(f)


for m in ("2026-05", "2026-06"):
    rows = load(m)
    # whale daily
    wd = defaultdict(float)
    wbet = defaultdict(float)
    wcat = defaultdict(lambda: [0.0, 0.0])
    # player monthly ex-whale
    pl = defaultdict(float)
    plbet = defaultdict(float)
    # duplicate rows that actually carry money
    keyed = defaultdict(list)
    for r in rows:
        pid = r.get("player_id")
        d = (r.get("transaction_date") or "")[:10]
        ggr = num(r.get("ggr")); bet = num(r.get("bet"))
        if bet or ggr:
            keyed[(pid, d, r.get("game_product"), r.get("bet"), r.get("ggr"))].append(1)
        if pid == WHALE:
            wd[d] += ggr; wbet[d] += bet
            c = r.get("game_product") or "(none)"
            wcat[c][0] += bet; wcat[c][1] += ggr
        else:
            pl[pid] += ggr; plbet[pid] += bet
    dupe_money = sum(len(v) - 1 for v in keyed.values() if len(v) > 1)
    print("==", m, "==")
    print("  money-bearing duplicate row keys:", dupe_money)
    print("  whale GGR total:", money(sum(wd.values())),
          " whale bet:", money(sum(wbet.values())))
    worst = sorted(wd.items(), key=lambda kv: kv[1])[:6]
    best = sorted(wd.items(), key=lambda kv: -kv[1])[:6]
    print("  whale worst days:", [(d, money(g)) for d, g in worst])
    print("  whale best  days:", [(d, money(g)) for d, g in best])
    print("  whale by category (bet, ggr):",
          {c: (money(v[0]), money(v[1])) for c, v in sorted(wcat.items())})
    print()

# Day-level player detail for the standout June days
rows = load("2026-06")
focus = ["2026-06-29", "2026-06-28", "2026-06-26", "2026-06-25", "2026-06-07",
         "2026-06-27", "2026-06-15"]
byday = defaultdict(lambda: defaultdict(float))
byday_bet = defaultdict(lambda: defaultdict(float))
for r in rows:
    d = (r.get("transaction_date") or "")[:10]
    if d in focus and r.get("player_id") != WHALE:
        byday[d][r.get("player_id")] += num(r.get("ggr"))
        byday_bet[d][r.get("player_id")] += num(r.get("bet"))
print("== June standout days: top |GGR| players (ex-whale) ==")
for d in focus:
    tot = sum(byday[d].values())
    print(d, "day GGR ex-whale", money(tot))
    for pid, g in sorted(byday[d].items(), key=lambda kv: -abs(kv[1]))[:5]:
        print("      ", pid, money(g), " bet", money(byday_bet[d][pid]))

# Same-player May vs June comparison for the biggest movers
mrows = load("2026-05")
mpl = defaultdict(float)
jpl = defaultdict(float)
for r in mrows:
    if r.get("player_id") != WHALE:
        mpl[r.get("player_id")] += num(r.get("ggr"))
for r in rows:
    if r.get("player_id") != WHALE:
        jpl[r.get("player_id")] += num(r.get("ggr"))
delta = {p: jpl.get(p, 0) - mpl.get(p, 0) for p in set(mpl) | set(jpl)}
print()
print("== Biggest ex-whale player-level May->June GGR moves ==")
for pid, dv in sorted(delta.items(), key=lambda kv: kv[1])[:10]:
    print("  down", pid, money(dv), " May", money(mpl.get(pid, 0)), "-> Jun", money(jpl.get(pid, 0)))
for pid, dv in sorted(delta.items(), key=lambda kv: -kv[1])[:6]:
    print("  up  ", pid, money(dv), " May", money(mpl.get(pid, 0)), "-> Jun", money(jpl.get(pid, 0)))
top10_down = sum(dv for _, dv in sorted(delta.items(), key=lambda kv: kv[1])[:10])
print("  sum of top-10 decliners:", money(top10_down),
      " vs total ex-whale MoM change:", money(sum(jpl.values()) - sum(mpl.values())))

# how much of ex-whale GGR sits in the top 10 players each month
for name, d in (("May", mpl), ("June", jpl)):
    tot = sum(d.values())
    t10 = sum(g for _, g in sorted(d.items(), key=lambda kv: -kv[1])[:10])
    print("  %s: top-10 winners for the house = %s of %s (%.0f%%)"
          % (name, money(t10), money(tot), t10 / tot * 100))
