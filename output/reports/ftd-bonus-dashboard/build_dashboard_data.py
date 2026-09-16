import json

MONTHS = ["2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08","2026-09"]
STATUSES = ["All","Active","Blocked"]

final_tables = json.load(open('final_tables.json'))
daily = json.load(open('daily_needed_v2.json'))
redash_bonus = json.load(open('redash_bonus_needed_v2.json'))
smartico = json.load(open('smartico_bonus_v2.json'))
needed = json.load(open('needed_players_all_v2.json'))
needed_set = set(needed)

# country_abbrev.json: full Redash country name -> ISO-3166-1 alpha-2 code
# (a handful of non-ISO buckets like "TOR Network"/"VPN Player"/"Unknown" get a
# short synthetic code instead). See build_country_abbrev.py to regenerate.
COUNTRY_CODE = json.load(open('country_abbrev.json'))

def cc_of(country):
    return COUNTRY_CODE.get(country) or (country or '?')[:3].upper()

# ---------- 1. RANKS: compact ranking rows ----------
def compact_row(r):
    return {
        "p": r['pid'], "u": r['username'], "c": r['country'], "cc": cc_of(r['country']),
        "a": r['aff'],
        "fd": r['ftd_date'], "ld": r['last_dep_date'], "ft": r['ftd_type'],
        "d": r['deposit'], "dn": r['dep_count'],
        "g": r['adj_ggr'], "bc": r['bonus_cost'], "r": r['rail'][0],  # 'F' or 'C'
        "bu": r['bonuses_used'], "ba": r['bonuses_available'],
    }

RANKS = {}
for m in MONTHS:
    RANKS[m] = {}
    for st in STATUSES:
        v = final_tables[m][st]
        RANKS[m][st] = {
            "td": [compact_row(x) for x in v['top_deposit']],
            "tg": [compact_row(x) for x in v['top_ggr']],
            "bg": [compact_row(x) for x in v['bottom_ggr']],
            "n": v['cohort_size'],
        }

# ---------- 1b. PMETA: pid -> static player meta (dedup across all views) ----------
PMETA = {}
for m in MONTHS:
    for st in STATUSES:
        v = RANKS[m][st]
        for grp in (v['td'], v['tg'], v['bg']):
            for row in grp:
                pid = row['p']
                if pid not in PMETA:
                    PMETA[pid] = {"u": row['u'], "c": row['c'], "a": row['a'],
                                   "fd": row['fd'], "ft": row['ft'], "r": row['r']}
print("PMETA players:", len(PMETA))

# ---------- 2. DAILY (deposits/ggr day-by-day), restricted to needed players ----------
daily_lines = []
for pid, days in daily.items():
    if pid not in needed_set:
        continue
    for dd, v in days.items():
        dep = v.get('dep', 0) or 0
        n = v.get('n', 0) or 0
        ggr = v.get('ggr', 0) or 0
        if dep == 0 and n == 0 and ggr == 0:
            continue
        daily_lines.append(f"{pid}:{dd}:{dep:g}:{n:g}:{ggr:g}")
DAILY_STR = "|".join(daily_lines)
print("DAILY lines:", len(daily_lines), "chars:", len(DAILY_STR))

# ---------- 3. CDICT/CDATA: Redash bonus cost events ----------
cdict = []
cdict_idx = {}
cdata_lines = []
for pid, events in redash_bonus.items():
    if pid not in needed_set:
        continue
    for e in events:
        nm = e['name']
        if nm not in cdict_idx:
            cdict_idx[nm] = len(cdict)
            cdict.append(nm)
        idx = cdict_idx[nm]
        eur = e['eur']
        cdata_lines.append(f"{pid}~{e['dd']}~{idx}~{eur:g}")
CDICT_STR = "|".join(cdict)
CDATA_STR = "|".join(cdata_lines)
print("CDICT names:", len(cdict), "CDATA lines:", len(cdata_lines))

# ---------- 4. GDICT/GDATA: Smartico grant/redemption events ----------
gdict = []
gdict_idx = {}
gdata_lines = []
for pid, events in smartico.items():
    if pid not in needed_set:
        continue
    for e in events:
        nm = e['name']
        if nm not in gdict_idx:
            gdict_idx[nm] = len(gdict)
            gdict.append(nm)
        idx = gdict_idx[nm]
        fail = 1 if e['status'] == 4 else 0
        cnt = e['grant_count']
        gdata_lines.append(f"{pid}~{e['dd']}~{idx}~{cnt}~{fail}")
GDICT_STR = "|".join(gdict)
GDATA_STR = "|".join(gdata_lines)
print("GDICT names:", len(gdict), "GDATA lines:", len(gdata_lines))

# ---------- write out as a JS file ----------
import json as J
with open('dashboard-data.js', 'w', encoding='utf-8') as f:
    f.write("var MONTHS = " + J.dumps(MONTHS) + ";\n")
    f.write("var RANKS = " + J.dumps(RANKS, separators=(',',':')) + ";\n")
    f.write("var PMETA = " + J.dumps(PMETA, separators=(',',':')) + ";\n")
    f.write("var DAILY_STR = " + J.dumps(DAILY_STR) + ";\n")
    f.write("var CDICT = " + J.dumps(cdict) + ";\n")
    f.write("var CDATA_STR = " + J.dumps(CDATA_STR) + ";\n")
    f.write("var GDICT = " + J.dumps(gdict) + ";\n")
    f.write("var GDATA_STR = " + J.dumps(GDATA_STR) + ";\n")

import os
print("dashboard-data.js size:", os.path.getsize('dashboard-data.js'))
