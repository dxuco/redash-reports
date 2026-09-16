import json, csv, io

def load_page(path, is_json_wrapped):
    if is_json_wrapped:
        d = json.load(open(path))
        csv_text = d['data']['rows_csv']
    else:
        csv_text = open(path).read()
    rows = list(csv.reader(io.StringIO(csv_text)))
    header = rows[0]
    return [dict(zip(header, r)) for r in rows[1:]]

def mmdd(iso_date):
    # "2026-09-10T00:00:00.000Z" -> "0910"
    d = iso_date[5:10]  # "09-10"
    return d[0:2] + d[3:5]

def build(pages):
    smartico = {}
    total_rows = 0
    for rows in pages:
        for r in rows:
            total_rows += 1
            pid = r['user_ext_id']
            dd = mmdd(r['issue_date'])
            name = r['public_name'] or 'Unknown'
            status = int(r['final_status'])
            gc = int(r['grant_count'])
            cost = float(r['cost_sum'] or 0)
            smartico.setdefault(pid, []).append({
                'dd': dd, 'name': name, 'status': status, 'grant_count': gc, 'cost': cost
            })
    return smartico, total_rows

# Existing v1 set (401 needed players) - already parsed into smartico_bonus.json
existing = json.load(open('smartico_bonus.json'))
print("existing players:", len(existing))

# Delta set (398 additional players)
delta_pages = [
    load_page('bonus_raw/delta_p0.json', True),
    load_page('bonus_raw/delta_p1.json', True),
    load_page('bonus_raw/delta_p2.json', True),
]
delta_smartico, delta_rows = build(delta_pages)
print("delta rows:", delta_rows, "delta players:", len(delta_smartico))

# Merge (delta players should be disjoint from existing, but merge safely just in case)
merged = dict(existing)
overlap = 0
for pid, recs in delta_smartico.items():
    if pid in merged:
        overlap += 1
        merged[pid] = merged[pid] + recs
    else:
        merged[pid] = recs

print("overlap:", overlap)
print("merged total players:", len(merged))

needed_v2 = set(json.load(open('needed_players_all_v2.json')))
print("needed v2 total:", len(needed_v2))
missing = needed_v2 - set(merged.keys())
print("needed v2 players with ZERO smartico bonus rows:", len(missing))

json.dump(merged, open('smartico_bonus_v2.json', 'w'))
print("wrote smartico_bonus_v2.json")
