# -*- coding: utf-8 -*-
"""
Builds fiat-affiliate-data.json from the query-1787 export.

1787 = fiat transactions (1785) joined to player details (1786), so every row
carries aff_username.  It is NOT in the C:\\redash-page month caches -- those
come from 1732 and have no affiliate name -- so this one report does read an
export.  Refresh it through the bridge:

    {"action":"run_query","query_id":1787,
     "parameters":{"date_range":{"start":"2020-01-01","end":"2026-12-31"}},
     "max_rows":300000,"save_as":"fiat-1787-all.csv","timeout_seconds":900}

Takes ~140s.  Note 1787's end bound is broken in Redash -- it reads
'{date_range_end}' as a literal, not a parameter -- so the run always returns
everything from .start forward.  Harmless here (we want all of it) but do not
trust that query for a bounded window until it is fixed.

Grain emitted: affiliate x day x deposit|withdraw x payment_country x
payment_method.  Player ids are carried as GLOBAL indices (not per-affiliate
ones) so the page can union them over any slice -- a country or a payment
method cuts across affiliates, and per-affiliate indices could not be counted
across that cut.  Distinct players must never be summed from per-cell or
per-month counts: a player active on five days is one player.
"""
import csv, json, collections, datetime, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(HERE, '..', '_mcp-exports', 'fiat-1787-all.csv')
AFFMAP = os.path.join(HERE, '..', '_mcp-exports', 'affiliate-source-map.json')
OUT  = os.path.join(HERE, 'fiat-affiliate-data.json')

# "Created" = the money actually moved.  Deposits succeed as SUCCESS,
# withdrawals as PROCESSED; everything else in 1785's WHERE clause is a
# failed attempt (deposit: FAILED/DECLINED, withdraw: FAILED/REJECTED).
OK = {'deposit': 'SUCCESS', 'withdraw': 'PROCESSED'}
KIND = {'deposit': 0, 'withdraw': 1}
TOP_REASONS = 20
NO_AFF = '(direct \u2014 no affiliate)'
NO_METHOD = '(not recorded)'
NO_COUNTRY = '(unknown)'

rows = list(csv.DictReader(open(SRC, encoding='utf-8-sig')))
print('rows read: %s' % f'{len(rows):,}')

# --- one affiliate per player, which is what lets the totals row add up -----
pa = collections.defaultdict(set)
for r in rows:
    pa[r['player_id']].add(r['aff_username'] or '')
bad = [p for p, s in pa.items() if len(s) > 1]
assert not bad, 'players mapped to >1 affiliate: %r' % bad[:5]
print('distinct players: %s (each on exactly one affiliate)' % f'{len(pa):,}')

# --- affiliate source (SEO / PPC / ...) from the acquisition export ---------
src_of = {}
try:
    for a in json.load(open(AFFMAP, encoding='utf-8')):
        src_of[a['affiliate']] = a.get('aff_source') or 'Uncategorized'
except Exception as e:                                    # optional enrichment
    print('affiliate-source-map unavailable (%s); sources left blank' % e)

# This export has its own refresh cycle, independent of ftd-channels/
# affiliate-map.json, so it can be faithful to the SAME source mistakes (or
# stale in ways that file no longer is). The hand-verified corrections apply
# regardless of which snapshot produced the raw value -- see ../affiliate_channel.py
# and ../affiliate-overrides.json.
import sys
sys.path.insert(0, os.path.join(HERE, '..'))
from affiliate_channel import AFF_OVR as _AFF_OVR
for _aff in list(src_of):
    _o = _AFF_OVR.get(_aff.strip().lower())
    if _o and _o.get('aff_source'):
        src_of[_aff] = _o['aff_source']

# --- vocabularies ----------------------------------------------------------
rc = collections.Counter()
for r in rows:
    if r['payment_status'] != OK[r['payment_type']]:
        rc[(r['reason'] or '').strip() or '(no reason given)'] += 1
reasons = [r for r, _ in rc.most_common(TOP_REASONS)] + ['Other reasons']
ri_of = {r: i for i, r in enumerate(reasons)}
OTHER = len(reasons) - 1
REASON_BY = ['Bank', 'Omno', 'Fraud', 'Auto Rejected', 'Unattributed']
rb_of = {b: i for i, b in enumerate(REASON_BY)}


def norm_country(r):
    return (r['payment_country'] or '').strip().upper() or NO_COUNTRY


def norm_method(r):
    return (r['payment_method'] or '').strip() or NO_METHOD


# Dimensions are ordered by volume so the dropdowns open on the ones that
# matter; the page keeps them in this order rather than re-sorting.
countries = [c for c, _ in collections.Counter(norm_country(r) for r in rows).most_common()]
methods   = [m for m, _ in collections.Counter(norm_method(r)  for r in rows).most_common()]
ci_of = {c: i for i, c in enumerate(countries)}
mi_of = {m: i for i, m in enumerate(methods)}

days = sorted({r['created_at'][:10] for r in rows})
di_of = {d: i for i, d in enumerate(days)}

# Global player index: a country or a payment method cuts across affiliates,
# so the page needs ids that are comparable outside one affiliate's rows.
players = {}
for r in rows:
    if r['player_id'] not in players:
        players[r['player_id']] = len(players)

# --- accumulate ------------------------------------------------------------
aff_type, aff_players = {}, collections.defaultdict(set)
cells = collections.defaultdict(lambda: collections.defaultdict(lambda: {
    'a': 0, 's': 0, 'aa': 0.0, 'sa': 0.0,
    'pa': set(), 'ps': set(), 'r': collections.Counter(), 'b': collections.Counter()}))
nonEurTx = 0

for r in rows:
    aff = (r['aff_username'] or '').strip() or NO_AFF
    aff_type.setdefault(aff, r['player_type'] or '')
    p = players[r['player_id']]
    aff_players[aff].add(p)

    key = (di_of[r['created_at'][:10]], KIND[r['payment_type']],
           ci_of[norm_country(r)], mi_of[norm_method(r)])
    c = cells[aff][key]
    ok = r['payment_status'] == OK[r['payment_type']]

    c['a'] += 1
    c['pa'].add(p)
    # Amounts are in the transaction's own currency and 98% of rows are EUR.
    # Summing EUR with BRL/CAD/ARS would invent money, so only EUR is totalled
    # and the excluded count is surfaced on the page.
    amt = float(r['amount'] or 0)
    if r['currency'] == 'EUR':
        c['aa'] += amt
    else:
        nonEurTx += 1
    if ok:
        c['s'] += 1
        c['ps'].add(p)
        if r['currency'] == 'EUR':
            c['sa'] += amt
    else:
        c['r'][ri_of.get((r['reason'] or '').strip() or '(no reason given)', OTHER)] += 1
        c['b'][rb_of.get((r['reason_by'] or '').strip(), 4)] += 1

# --- emit ------------------------------------------------------------------
affs, cellsOut = [], []
for aff in sorted(cells, key=lambda a: -sum(c['a'] for c in cells[a].values())):
    affs.append({'n': aff,
                 't': aff_type[aff] or 'Unknown',
                 'src': src_of.get(aff, ''),
                 'np': len(aff_players[aff])})
    out = []
    for (d, k, ci, mi), c in sorted(cells[aff].items()):
        out.append([d, k, ci, mi, c['a'], c['s'], round(c['aa'], 2), round(c['sa'], 2),
                    sorted(c['pa']), sorted(c['ps']),
                    sorted(c['r'].items()), sorted(c['b'].items())])
    cellsOut.append(out)

data = {
    'built': datetime.datetime.now().strftime('%d %b %Y %H:%M'),
    'source': 'Redash query 1787 (Fiat Report) \u2014 1785 fiat transactions joined to 1786 player details',
    'span': [days[0], days[-1]],
    'days': days,
    'countries': countries,
    'methods': methods,
    'reasons': reasons,
    'reasonBy': REASON_BY,
    'affs': affs,
    'cells': cellsOut,
    'nPlayers': len(players),
    'nonEurTx': nonEurTx,
    'totalTx': len(rows),
}
json.dump(data, open(OUT, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)

# --- reconcile: the emitted cells must account for every row ---------------
flat = [c for a in cellsOut for c in a]
ta = sum(c[4] for c in flat)
ts = sum(c[5] for c in flat)
raw_ok = sum(1 for r in rows if r['payment_status'] == OK[r['payment_type']])
assert ta == len(rows), 'attempts %d != rows %d' % (ta, len(rows))
assert ts == raw_ok, 'successes %d != raw %d' % (ts, raw_ok)
eur = round(sum(float(r['amount']) for r in rows if r['currency'] == 'EUR'), 2)
emitted = round(sum(c[6] for c in flat), 2)
budget = len(flat) * 0.005                       # every emitted value is 2dp
assert abs(eur - emitted) <= budget, 'EUR %s vs %s (budget %s)' % (eur, emitted, budget)
nfail = sum(cnt for c in flat for _, cnt in c[10])
assert nfail == ta - ts, 'reason counts %d != failures %d' % (nfail, ta - ts)

print('affiliates: %d | days: %d | countries: %d | methods: %d | cells: %s'
      % (len(affs), len(days), len(countries), len(methods), f'{len(flat):,}'))
print('attempts: %s | created: %s (%.1f%%)' % (f'{ta:,}', f'{ts:,}', 100.0 * ts / ta))
print('non-EUR transactions excluded from amounts: %s' % f'{nonEurTx:,}')
print('wrote %s (%.1f KB)' % (OUT, os.path.getsize(OUT) / 1024.0))
