"""Builds us360-data.json from the query-1732 month caches.

US bloc = player_country in {United States of America, VPN Player}. The VPN
bucket is ~90% US per the business, and it is the single largest country bucket
in the cache -- larger than the US bucket itself -- so a US read that ignores it
is wrong by more than half. Both are emitted separately as well so the
assumption can be inspected rather than taken on trust.

The carved-out players (see ../data-exclusions.json) are held out by default,
per house convention. Keyed on player_id, never username: these ids have changed
username mid-year.
"""
import json, os, collections

# The players every report carves out by default, shared so a tenth report
# cannot quietly disagree about who is in the list. See ../carveout.py.
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from carveout import CARVED as WHALE_SET

# Today's aff_type/aff_source for a row's affiliate, corrected for a source
# re-categorisation (e.g. GetBlue2024: SEO -> Retargeting in 2025) or a
# hand-verified correction the source has not made yet (e.g. Fluxrise) --
# every cached row otherwise freezes whatever aff_source said the day its
# month was pulled, and this page breaks players out BY that raw source. See
# ../affiliate_channel.py.
from affiliate_channel import current_of

US, VPN = 'United States of America', 'VPN Player'
BLOC = {US, VPN}
FIAT = {"apple pay","google pay","interac","mastercard","mbway","neteller","paysafecard",
"pix","revolut","sepa","skrill","visa","wise","astropay","bancontact","blik","boleto",
"bunq","eps","giropay","ideal","jeton","klarna","mifinity","muchbetter","n26",
"open banking","sofort","trustly","upi","multibanco"}

def num(v):
    if v is None or v == '': return 0.0
    try: return float(v)
    except (TypeError, ValueError): return 0.0

def S():
    return {'dep':set(),'ftd':set(),'sign':set(),'bet':set(),'depusd':0.0,'ggr':0.0,
            'ngr':0.0,'betusd':0.0,'bonus':0.0,'adj':0.0,'wd':0.0}

def add(a, r, pid):
    dv = num(r.get('deposit'))
    if dv > 0: a['dep'].add(pid); a['depusd'] += dv
    if num(r.get('ftd')) > 0: a['ftd'].add(pid)
    if num(r.get('sign_up')) > 0: a['sign'].add(pid)
    bv = num(r.get('bet'))
    if bv > 0: a['bet'].add(pid); a['betusd'] += bv
    a['ggr'] += num(r.get('ggr')); a['ngr'] += num(r.get('ngr'))
    a['bonus'] += num(r.get('bonus_cost')); a['adj'] += num(r.get('adjusted_ggr'))
    a['wd'] += num(r.get('withdraw'))

def fin(a):
    # distinct counts are set sizes -- they never sum across periods, so the
    # page reads these per-window figures and never adds monthly ones together.
    return {'dep':len(a['dep']),'ftd':len(a['ftd']),'sign':len(a['sign']),
            'bettors':len(a['bet']),'depusd':round(a['depusd'],2),
            'ggr':round(a['ggr'],2),'ngr':round(a['ngr'],2),
            'bet':round(a['betusd'],2),'bonus':round(a['bonus'],2),
            'adj':round(a['adj'],2),'wd':round(a['wd'],2)}

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '..', 'ftd-report', 'cache')

def main():
    months = [f'{y}-{m:02d}' for y in (2025, 2026) for m in range(1, 13)]
    months = [m for m in months if os.path.exists(os.path.join(CACHE, m + '.json'))]

    monthly = {}
    Y = lambda: collections.defaultdict(S)
    ysrc, ytype, yprod, yrail, yftd, ycoh = Y(), Y(), Y(), Y(), Y(), Y()
    # window distincts: a player active in five months is one player, so the
    # period totals must union player ids rather than sum the monthly counts.
    win = collections.defaultdict(S)
    unknown_rails = set()

    for m in months:
        per = ('p25' if m.startswith('2025') and m <= '2025-08'
               else 'p26' if m.startswith('2026') and m <= '2026-08' else None)
        with open(os.path.join(CACHE, m + '.json'), encoding='utf-8') as fh:
            rows = json.load(fh)
        mo = collections.defaultdict(S)
        for r in rows:
            pid = str(r.get('player_id') or '')
            if pid in WHALE_SET: continue
            c = r.get('player_country') or '(blank)'
            if c not in BLOC: continue
            add(mo['bloc'], r, pid); add(mo[c], r, pid)
            if not per: continue
            add(win[per], r, pid)
            _at, _as = current_of(r.get('aff_username'), r.get('aff_type'), r.get('aff_source'))
            add(ysrc[(per, _as or 'Unattributed')], r, pid)
            add(ytype[(per, _at or '(none)')], r, pid)
            gp = r.get('game_product')
            if gp: add(yprod[(per, gp)], r, pid)
            bc = r.get('blockchain')
            if bc:
                v = str(bc).strip().lower()
                add(yrail[(per, 'fiat' if v in FIAT else 'crypto')], r, pid)
            ft = r.get('ftd_type')
            if ft and num(r.get('ftd')) > 0: add(yftd[(per, ft)], r, pid)
            rd = str(r.get('reg_date') or '')[:4]
            add(ycoh[(per, rd or '(none)')], r, pid)
        monthly[m] = {k: fin(v) for k, v in mo.items()}
        del rows
        print('  aggregated', m, flush=True)

    out = {'months': months, 'monthly': monthly,
           'window': {p: fin(v) for p, v in win.items()},
           'ga4': json.load(open(os.path.join(HERE, 'ga4-us.json'), encoding='utf-8'))}
    for name, acc in (('src',ysrc),('type',ytype),('prod',yprod),
                      ('rail',yrail),('ftdtype',yftd),('cohort',ycoh)):
        out[name] = {f'{p}|{k}': fin(v) for (p, k), v in acc.items()}

    # Reconcile: the aff_type split must cover every bloc row, so its depositor
    # dollars have to equal the window total within the rounding budget.
    for per in ('p25', 'p26'):
        parts = sum(v['depusd'] for k, v in out['type'].items() if k.startswith(per + '|'))
        whole = out['window'][per]['depusd']
        budget = (len([k for k in out['type'] if k.startswith(per+'|')]) + 1) * 0.005
        assert abs(parts - whole) <= budget, (per, parts, whole, budget)
        print(f'  reconciled {per}: {parts:,.2f} vs {whole:,.2f} (budget {budget})')

    with open(os.path.join(HERE, 'us360-data.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, separators=(',', ':'))
    print('wrote us360-data.json')

if __name__ == '__main__':
    main()
