import json

cohorts = json.load(open('cohorts.json'))
smartico = json.load(open('smartico_bonus_v2.json'))
daily = json.load(open('daily.json'))  # full cohort universe, MMDD keys, all within 2026

MONTHS = sorted(cohorts.keys())

def active_bonus_count(pid):
    """Count of Smartico-redeemed (status=3) bonus grants for this player."""
    recs = smartico.get(pid, [])
    return sum(r['grant_count'] for r in recs if r['status'] == 3)

def available_bonus_count(pid):
    """Count of Smartico-pending (status=1) bonus grants for this player."""
    recs = smartico.get(pid, [])
    return sum(r['grant_count'] for r in recs if r['status'] == 1)

def active_missions(pid):
    """List of unique active mission/campaign names from Smartico for this player."""
    recs = smartico.get(pid, [])
    missions = set()
    for r in recs:
        if r['status'] == 1:  # active/pending
            missions.add(r.get('name', 'Unknown'))
    return list(sorted(missions))

def aff_name(p):
    a = (p.get('aff_username') or '').strip()
    if a:
        return a
    return 'Direct'

def last_dep_date(pid, ftd_date):
    """Most recent day with a deposit > 0, formatted as YYYY-MM-DD (all data is 2026)."""
    days = daily.get(pid) or {}
    dep_days = [dd for dd, v in days.items() if (v.get('dep') or 0) > 0]
    if not dep_days:
        return ftd_date  # fallback: FTD day itself is always a deposit day
    mmdd = max(dep_days)
    return f"2026-{mmdd[0:2]}-{mmdd[2:4]}"

def row_for(p):
    return {
        'pid': p['player_id'],
        'username': p['username'],
        'country': p['country'],
        'aff': aff_name(p),
        'ftd_date': p['ftd_date'],
        'ftd_type': p['ftd_type'],
        'last_dep_date': last_dep_date(p['player_id'], p['ftd_date']),
        'deposit': round(p['deposit'], 2),
        'dep_count': p['deposit_count'],
        'adj_ggr': round(p['adjusted_ggr'], 2),
        'bonus_cost': round(p['bonus_cost'], 2),
        'rail': p['rail'],
        'bonuses_used': active_bonus_count(p['player_id']),
        'bonuses_available': available_bonus_count(p['player_id']),
        'active_missions': active_missions(p['player_id']),
        'status': p['player_status'],
    }

def pools(players):
    return {
        'All': players,
        'Active': [p for p in players if p['player_status'] == 'Active'],
        'Blocked': [p for p in players if p['player_status'] == 'Blocked'],
    }

output = {}
needed_check = set()

for month in MONTHS:
    players = cohorts[month]
    output[month] = {}
    for status_key, pool in pools(players).items():
        top_dep = sorted(pool, key=lambda p: -p['deposit'])[:20]
        top_ggr = sorted(pool, key=lambda p: -p['adjusted_ggr'])[:20]
        bot_ggr = sorted(pool, key=lambda p: p['adjusted_ggr'])[:20]
        output[month][status_key] = {
            'top_deposit': [row_for(p) for p in top_dep],
            'top_ggr': [row_for(p) for p in top_ggr],
            'bottom_ggr': [row_for(p) for p in bot_ggr],
            'cohort_size': len(pool),
        }
        for grp in (top_dep, top_ggr, bot_ggr):
            for p in grp:
                needed_check.add(p['player_id'])

print("months:", MONTHS)
print("total unique players across all views:", len(needed_check))

needed_v2 = set(json.load(open('needed_players_all_v2.json')))
missing = needed_check - needed_v2
print("players in final tables but NOT in needed_v2 (should be empty):", len(missing))

json.dump(output, open('final_tables.json', 'w'))
print("wrote final_tables.json, size:", end=' ')
import os
print(os.path.getsize('final_tables.json'))
