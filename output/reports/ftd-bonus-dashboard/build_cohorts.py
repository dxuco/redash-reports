#!/usr/bin/env python3
"""
Build per-player life-to-date cohort data from the Redash 1732 monthly caches.

For every player whose first-ever deposit (ftd) falls in a 2026 month, sum
their deposit / deposit_count / ggr / adjusted_ggr / bonus_cost / ngr / bet /
withdraw across the WHOLE 9-month window (Jan-Sep 2026). Since a player's ftd
is by definition their first deposit, there is no pre-FTD deposit activity in
this window, so "life-to-date since FTD" == "sum across everything we have".

Also tracks:
  - payment rail (Crypto/Fiat): first row carrying a non-empty `blockchain`
    value, in chronological order (matches ftd-report/ftd-aggregate.js).
  - latest known player_status (Active/Blocked/None), overwritten every time
    a month has a non-null value, processed in chronological order so the
    final value is the most recent.
  - per-day series (deposit, count, ggr) for the click-through modal.
  - per-day bonus_cost + bonus_name (Redash-side realized cost events) for
    the click-through modal's cost rows.

Output: cohorts.json  { "2026-01": [ {player...}, ... ], ... }
        daily.json    { player_id: { "MMDD": {dep,n,ggr} } }        (cohort players only)
        redash_bonus.json { player_id: [ {dd, name, eur} ] }        (cohort players only)
"""
import json, sys
from pathlib import Path

CACHE_DIR = Path("ftd-report/cache")
MONTHS = [f"2026-{m:02d}" for m in range(1, 10)]

CRYPTO_RAILS = {
    "solana","bnb","ethereum","tron","btc","btc-2","bitcoin","litecoin","polygon",
    "doge","dogecoin","dash","usdt","usdc","ton","xrp","ripple","cardano","ada",
    "avalanche","avax","bch","bitcoincash","monero","xmr","stellar","xlm",
    "arbitrum","optimism","base","matic","shib","trx","eth","ltc","sol",
}

def num(v):
    if v is None or v == "":
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0

def rail_of(method):
    m = (method or "").strip().lower()
    if not m:
        return None
    return "Crypto" if m in CRYPTO_RAILS else "Fiat"

players = {}      # player_id -> accumulator dict
daily = {}        # player_id -> { "MMDD": {dep,n,ggr} }
redash_bonus = {} # player_id -> [ {dd, name, eur} ]  (one entry per day bonus_cost>0)
unknown_rails = set()

for month in MONTHS:
    path = CACHE_DIR / f"{month}.json"
    print(f"  reading {path.name} ...", file=sys.stderr)
    with open(path, encoding="utf-8") as f:
        rows = json.load(f)
    print(f"    {len(rows)} rows", file=sys.stderr)
    for row in rows:
        pid = row.get("player_id")
        if not pid:
            continue
        pid = str(pid)
        td = row.get("transaction_date")  # "2026-02-01"
        if not td:
            continue
        mmdd = td[5:7] + td[8:10]

        acc = players.get(pid)
        if acc is None:
            acc = players[pid] = {
                "player_id": pid, "username": None, "country": None,
                "aff_type": None, "aff_source": None, "aff_username": None,
                "reg_date": None, "ftd_date": None, "ftd_amount": None,
                "ftd_type": None, "favourite_product": None,
                "player_status": None, "kyc_status": None,
                "rail_seen": None,
                "deposit": 0.0, "deposit_count": 0.0, "ggr": 0.0,
                "adjusted_ggr": 0.0, "bonus_cost": 0.0, "ngr": 0.0,
                "bet": 0.0, "withdraw": 0.0,
            }

        if row.get("username"):
            acc["username"] = row["username"]
        if row.get("player_status"):
            acc["player_status"] = row["player_status"]  # overwritten -> last wins
        if row.get("kyc_status"):
            acc["kyc_status"] = row["kyc_status"]
        if acc["rail_seen"] is None and row.get("blockchain"):
            acc["rail_seen"] = row["blockchain"]

        # sums
        acc["deposit"] += num(row.get("deposit"))
        acc["deposit_count"] += num(row.get("deposit_count"))
        acc["ggr"] += num(row.get("ggr"))
        acc["adjusted_ggr"] += num(row.get("adjusted_ggr"))
        acc["ngr"] += num(row.get("ngr"))
        acc["bet"] += num(row.get("bet"))
        acc["withdraw"] += num(row.get("withdraw"))
        bc = num(row.get("bonus_cost"))
        acc["bonus_cost"] += bc

        # per-day series for modal (only keep days with some signal, to save space)
        dep_d = num(row.get("deposit"))
        ggr_d = num(row.get("ggr"))
        dn_d = num(row.get("deposit_count"))
        if dep_d or ggr_d or dn_d:
            d = daily.setdefault(pid, {})
            e = d.setdefault(mmdd, {"dep": 0.0, "n": 0.0, "ggr": 0.0})
            e["dep"] += dep_d; e["n"] += dn_d; e["ggr"] += ggr_d

        if bc:
            name = (row.get("bonus_name") or row.get("bonus_group") or "Bonus").strip()
            redash_bonus.setdefault(pid, []).append({"dd": mmdd, "name": name, "eur": round(bc, 2)})

        # FTD row: capture acquisition-time attributes, exactly once
        if row.get("ftd") and acc["ftd_date"] is None:
            acc["ftd_date"] = td
            acc["ftd_amount"] = num(row.get("ftd"))
            acc["ftd_type"] = row.get("ftd_type")
            acc["favourite_product"] = row.get("favourite_product")
            acc["country"] = row.get("player_country")
            acc["aff_type"] = row.get("aff_type")
            acc["aff_source"] = row.get("aff_source")
            acc["aff_username"] = (row.get("aff_username") or "").strip()
            acc["reg_date"] = row.get("reg_date")

    del rows  # free memory before next month

print(f"  total distinct players touched: {len(players)}", file=sys.stderr)

cohorts = {m: [] for m in MONTHS}
for pid, acc in players.items():
    if not acc["ftd_date"]:
        continue
    month = acc["ftd_date"][:7]
    if month not in cohorts:
        continue  # ftd outside our 2026 window (shouldn't happen, cache is 2026-only)
    rail = rail_of(acc["rail_seen"])
    if rail is None:
        rail = "Fiat"
        if acc["rail_seen"]:
            unknown_rails.add(acc["rail_seen"])
    cohorts[month].append({
        "player_id": pid,
        "username": acc["username"] or pid,
        "country": acc["country"],
        "aff_username": acc["aff_username"] or "",
        "aff_type": acc["aff_type"],
        "ftd_date": acc["ftd_date"][:10],
        "ftd_type": acc["ftd_type"],
        "deposit": round(acc["deposit"], 2),
        "deposit_count": int(round(acc["deposit_count"])),
        "ggr": round(acc["ggr"], 2),
        "adjusted_ggr": round(acc["adjusted_ggr"], 2),
        "ngr": round(acc["ngr"], 2),
        "bonus_cost": round(acc["bonus_cost"], 2),
        "rail": rail,
        "player_status": acc["player_status"] or "Unknown",
    })

for m in MONTHS:
    cohorts[m].sort(key=lambda r: -r["deposit"])
    print(f"  {m}: {len(cohorts[m])} FTDs", file=sys.stderr)

cohort_pids = {r["player_id"] for m in MONTHS for r in cohorts[m]}
daily = {pid: v for pid, v in daily.items() if pid in cohort_pids}
redash_bonus = {pid: v for pid, v in redash_bonus.items() if pid in cohort_pids}
print(f"  cohort players (all months): {len(cohort_pids)}", file=sys.stderr)

OUT = Path(__file__).parent
with open(OUT / "cohorts.json", "w") as f:
    json.dump(cohorts, f)
with open(OUT / "daily.json", "w") as f:
    json.dump(daily, f)
with open(OUT / "redash_bonus.json", "w") as f:
    json.dump(redash_bonus, f)
with open(OUT / "cohort_pids.json", "w") as f:
    json.dump(sorted(cohort_pids), f)

print("unknown payment methods (defaulted to Fiat):", unknown_rails, file=sys.stderr)
print("done.", file=sys.stderr)

