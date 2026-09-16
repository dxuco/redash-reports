"""Third pass: where did the ex-whale handle (bet) go between May and June?"""
import json, os
from collections import defaultdict

CACHE = "/sessions/epic-vigilant-bohr/mnt/redash-page/ftd-report/cache"
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


res = {}
for m in ("2026-05", "2026-06"):
    with open(os.path.join(CACHE, m + ".json")) as f:
        rows = json.load(f)
    bet = defaultdict(float)
    ggr = defaultdict(float)
    lcbet = defaultdict(float)
    for r in rows:
        pid = r.get("player_id")
        if pid == WHALE:
            continue
        b = num(r.get("bet"))
        bet[pid] += b
        ggr[pid] += num(r.get("ggr"))
        if r.get("game_product") == "live-casino":
            lcbet[pid] += b
    res[m] = (bet, ggr, lcbet)

print("== Top ex-whale bettors by handle ==")
for m in ("2026-05", "2026-06"):
    bet, ggr, lc = res[m]
    tot = sum(bet.values())
    print(m, "total ex-whale handle", money(tot))
    for pid, b in sorted(bet.items(), key=lambda kv: -kv[1])[:8]:
        print("   %-9s handle %14s  ggr %12s  edge %6s  live-casino handle %14s"
              % (pid, money(b), money(ggr[pid]),
                 "%.2f%%" % (ggr[pid] / b * 100) if b else "-", money(lc[pid])))

mb, mg, mlc = res["2026-05"]
jb, jg, jlc = res["2026-06"]
d = {p: jb.get(p, 0) - mb.get(p, 0) for p in set(mb) | set(jb)}
print()
print("== Biggest handle drops May -> June (ex-whale) ==")
for pid, dv in sorted(d.items(), key=lambda kv: kv[1])[:8]:
    print("   %-9s %14s   May %14s -> Jun %14s | ggr May %12s -> Jun %12s"
          % (pid, money(dv), money(mb.get(pid, 0)), money(jb.get(pid, 0)),
             money(mg.get(pid, 0)), money(jg.get(pid, 0))))
print("   total ex-whale handle change:", money(sum(jb.values()) - sum(mb.values())))
top5 = sum(dv for _, dv in sorted(d.items(), key=lambda kv: kv[1])[:5])
print("   top-5 decliners account for:", money(top5))
