"""Builds vip-transfer-data.json for the VIP Transfer Performance page.

Cohort is every player in public.loyalty_transfer_request -- 1,639 of them --
not just the ones on the Google Sheet tracker. Two ways to split a player's
history:

  request   the date they first asked to transfer (in the warehouse, authoritative)
  onboard   the date a VA onboarded them (Google Sheet only, exists for 149)

"Before" is everything from registration up to the split date, "after" is
everything since, so both sides are all-time by construction. Monthly averages
divide each side by its own months of exposure.

Inputs:
  data/cohort.json   Redash export, see data/SOURCES.md for the query
  data/roster.json   VA and source casino, from the Google Sheet (tracked only)
"""
import json, os, datetime as dt

HERE  = os.path.dirname(os.path.abspath(__file__))
D     = os.path.join(HERE, 'data') + os.sep
# Was hardcoded, which silently froze every "days since" and every monthly
# average at the day the snapshot was taken. Read the clock instead.
TODAY = dt.date.today()
MONTH = 30.4375

def d(s):
    return dt.date(*map(int, str(s)[:10].split('-'))) if s else None

cohort = json.load(open(D + 'cohort.json', encoding='utf-8'))

def _load(name):
    p = D + name
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else []

# Per-player history for the drill-down. Packed as arrays rather than objects:
# 65k daily rows as {"player_id":...,"dep":...} would roughly triple the page.
# The VIP transfer offer, from the 25 reward_config_families named "%transfer%".
# One offer spawns tickets across several types (deposit condition, wager
# condition, free spins, the payout leg), so a player is counted once.
TB = {int(x['player_id']): x for x in _load('tbonus.json')}
# Which of the 25 VIP-transfer offers each player was given, so the page can
# break the funnel down per offer instead of only in total.
TBFAM = {}
# TB_CODES runs parallel to TB_NAMES: the reward_config_family_id is the number
# the promo team quotes, and two offers can carry near-identical names.
TB_NAMES, TB_CODES, _fidx = [], [], {}
for x in _load('tbfam.json'):
    nm = (x.get('fam_name') or '').strip() or ('family ' + str(x.get('fam_id')))
    if nm not in _fidx:
        _fidx[nm] = len(TB_NAMES); TB_NAMES.append(nm)
        TB_CODES.append(int(x.get('fam_id') or 0))
    TBFAM.setdefault(int(x['player_id']), []).append(
        [_fidx[nm], x.get('given_on') or '', int(x.get('activated') or 0), int(x.get('completed') or 0)])

# Deposit sizes and VIP-transfer free spins, both dated from the transfer
# request. `max_dep` is the largest SINGLE deposit, not a daily total: it comes
# from public.deposit_transactions, with each transaction converted to euro on
# that player-day's own implied rate so it lines up with the rest of the page.
DEPSIZE = {int(x['player_id']): x for x in _load('depsize.json')}

# Current loyalty tier (Bronze I .. Legend) from sm_player_loyalty_level. A
# player with no row has never earned a loyalty point, which is not the same as
# Bronze I with zero -- so they get '' and the page shows a dash.
TIER = {int(x['player_id']): x for x in _load('tier.json')}

# The onboarding survey, one row per player per question. The file may not exist
# yet -- the tab is added later -- and _load returns [] for a missing file, so a
# player simply has no survey until it does.
SURVEY = {}
for x in _load('survey.json'):
    SURVEY.setdefault(int(x['player_id']), []).append(
        [str(x.get('q') or ''), x.get('have') or '', x.get('expect') or ''])

# What the VAs wrote about a player in their own tabs of the tracker sheet. Free
# text, English and Georgian, and the only place on this page where a number has
# an explanation attached to it. Keyed by player; a player can have notes from
# more than one VA, and a few have two rows on the same tab.
NOTES = {}
for x in _load('notes.json'):
    NOTES.setdefault(int(x['player_id']), []).append(
        [x.get('va') or '', x.get('text') or '', x.get('status') or ''])

contact_raw = _load('contact.json')
CONTACT = {int(x['player_id']): x for x in contact_raw}
daily_raw = _load('daily.json')
# Deposits in dollars, per player per day. The manager bonus bands are dollar
# amounts; everything else on the page is euro. Kept as its own series rather
# than converted, because a tenth of the deposit-days have no euro row to
# convert -- see data/queries/usd.sql.
usd_raw = _load('usd.json')
bonus_raw = _load('bonus.json')

DAY0 = dt.date(2022, 1, 1)          # epoch for the packed day numbers
def _dnum(s):
    y, m, dd = map(int, str(s)[:10].split('-'))
    return (dt.date(y, m, dd) - DAY0).days
def _n(v):
    try: return round(float(v or 0), 2)
    except (TypeError, ValueError): return 0.0

daily = {}
for x in daily_raw:
    daily.setdefault(int(x['player_id']), []).append(
        [_dnum(x['d']), _n(x.get('dep')), int(x.get('dc') or 0), _n(x.get('wd')),
         _n(x.get('bet')), _n(x.get('ggr')), _n(x.get('ngr')), _n(x.get('bc')),
         _n(x.get('adj'))])   # index 8; the modal reads the first eight and ignores this
for v in daily.values(): v.sort(key=lambda r: r[0])

USD = {}
for x in usd_raw:
    USD.setdefault(int(x['player_id']), {})[_dnum(x['d'])] = _n(x.get('usd'))

# One row per player x day x offer x kind, across bonus money, free spins, cash
# and free bets. Names are interned; the kind is a small integer for the same
# reason -- 67k rows of repeated strings would cost more than the history does.
BONUS_NAMES, _bidx = [], {}
KINDS, _kidx = [], {}
bonus = {}
for x in bonus_raw:
    nm = x.get('bonus') or '—'
    if nm not in _bidx:
        _bidx[nm] = len(BONUS_NAMES); BONUS_NAMES.append(nm)
    kd = x.get('kind') or '—'
    if kd not in _kidx:
        _kidx[kd] = len(KINDS); KINDS.append(kd)
    bonus.setdefault(int(x['player_id']), []).append(
        [_dnum(x['d']), _bidx[nm], _n(x.get('amount_eur')), x.get('status') or '',
         x.get('source') or '', _kidx[kd], int(x.get('spins') or 0), int(x.get('tickets') or 1),
         int(x['code']) if x.get('code') is not None else 0,
         1 if x.get('vip') else 0])
for v in bonus.values(): v.sort(key=lambda r: r[0])
# The sheet is the roster of record, but fetch_vip.js overwrites roster.json on
# every refresh, so players a manager attaches to their own book from the report
# page are kept separately and merged on top here. When the sheet catches up the
# two agree and the addition stops mattering.
roster = {r['player_id']: r for r in json.load(open(D + 'roster.json', encoding='utf-8'))}
_added = _load('roster-additions.json')
for r in _added:
    # A pending row is a player the warehouse has no transfer request for. It is
    # kept in the file so the page can list them, but it must not reach the
    # roster: cohort.json has no row for them, so they would land in the tables
    # with a blank request date and every figure measured from nothing.
    if r.get('pending'):
        continue
    roster[int(r['player_id'])] = dict(r, player_id=int(r['player_id']))
if _added:
    _live = [r for r in _added if not r.get('pending')]
    print('roster: %d from the sheet, %d added from the page, %d waiting for the warehouse'
          % (len(roster) - len(_live), len(_live), len(_added) - len(_live)))

rows = []
for c in cohort:
    pid = c['player_id']
    sheet = roster.get(pid, {})
    # cohort.json carries the onboarding date the SHEET had when the query ran, so
    # a player attached from the page has none there. Fall back to the roster
    # entry, which is where that date now lives.
    reg, req = d(c['reg_date']), d(c['first_req'])
    onb = d(c['onboard']) or d(sheet.get('onboard'))
    r = dict(
        player_id=pid, username=c['username'] or ('#%d' % pid),
        country=c['country'] or '', segment=c['current_segment'] or '',
        status=c['player_status'] or '', fav_product=c['fav_product'] or '',
        reg_date=str(reg) if reg else '', ftd_date=c['ftd_date'] or '',
        last_active=c['last_active'] or '',
        first_req=str(req), last_req=c['last_req'], req_count=c['req_count'],
        valid_through=c['valid_through'] or '',
        onboard=str(onb) if onb else '',
        # Being on the roster IS being tracked. cohort.json's own flag only
        # knows the sheet, so a player a manager attached from the page kept a
        # VA name while counting as untracked -- their own page listed them,
        # and By VA filed them under "Not. Onb".
        tracked=bool(c['tracked']) or pid in roster,
        req_month=str(req)[:7],
        va=sheet.get('va', ''), casino=sheet.get('casino', ''),
        # from the tracker sheet, not the warehouse: '', 'Yes' or 'No'
        replied=(sheet.get('replied') or '').strip(),
        aff=c.get('aff_username') or '', aff_type=c.get('aff_type') or '',
    )
    # Untracked players have no VA and no known source casino. Give them their own
    # bucket rather than leaving them out, or the rows will not sum to the total.
    r['va_group']     = (r['va'] or '— no VA —') if r['tracked'] else 'Not. Onb'
    r['casino_group'] = (r['casino'] or '— unknown —') if r['tracked'] else 'Not. Onb'
    r['aff_group']    = r['aff'] or '— direct —'
    # MATCHED WINDOWS. "After" runs from the split date to today; "before" is the
    # same number of days immediately preceding it. A player who requested two
    # days ago is measured on two days against two days, so the two sides can be
    # subtracted directly instead of pitting six years of history against three
    # weeks and needing a monthly average to mean anything.
    #
    # Summed here from the daily series rather than in SQL, so the window rule
    # lives in one place. cohort.json still carries its own rb_/ra_ columns; they
    # are deliberately not read.
    hist = daily.get(pid, [])
    for tag, split in (('r', req), ('o', onb)):
        if split is None:
            r[tag + '_days_bef'] = r[tag + '_days_aft'] = 0
            r[tag + '_mo_bef']   = r[tag + '_mo_aft']   = 0.0
            for side in ('_bef', '_aft'):
                for m in ('dep', 'wd', 'ggr', 'ngr', 'bc', 'adj'):
                    r[tag + side + '_' + m] = 0.0
                r[tag + side + '_dc'] = 0
                r[tag + side + '_dd'] = 0
            continue
        n = max((TODAY - split).days + 1, 1)
        r[tag + '_days_bef'] = r[tag + '_days_aft'] = n
        r[tag + '_mo_bef']   = r[tag + '_mo_aft']   = round(n / MONTH, 4)
        s0, s1 = _dnum(split), _dnum(split) + n            # after  [s0, s1)
        b0     = s0 - n                                     # before [b0, s0)
        for side, lo, hi in (('_bef', b0, s0), ('_aft', s0, s1)):
            # wd (withdrawals, row[3]) is carried so the page can show net
            # deposit. It is summed here rather than differenced in the browser
            # so it obeys the same window rule as everything else.
            # dc counts deposit TRANSACTIONS, dd counts DAYS on which at least one
            # was made. They differ whenever someone tops up twice in a day, which
            # is why the player table and the drill-down appeared to disagree:
            # 5 deposits over 4 days is one number read two ways. The page shows
            # dd; dc is kept because the drill-down's per-day "#" column is a
            # transaction count and the two should be derivable from one place.
            acc = dict(dep=0.0, wd=0.0, ggr=0.0, ngr=0.0, bc=0.0, adj=0.0, dc=0, dd=0)
            for row in hist:
                if lo <= row[0] < hi:
                    acc['dep'] += row[1]; acc['dc']  += row[2]
                    if row[1] > 0: acc['dd'] += 1
                    acc['wd']  += row[3]
                    acc['ggr'] += row[5]; acc['ngr'] += row[6]
                    acc['bc']  += row[7]; acc['adj'] += row[8]
            for m in ('dep', 'wd', 'ggr', 'ngr', 'bc', 'adj'):
                r[tag + side + '_' + m] = round(acc[m], 2)
            r[tag + side + '_dc'] = acc['dc']
            r[tag + side + '_dd'] = acc['dd']
    r['tbf'] = TBFAM.get(pid, [])
    # --- second wave -------------------------------------------------------
    # Did a player who took a transfer offer and then deposited get ANOTHER
    # offer afterwards, and did they take that one too? Everything here is
    # derived from dates already on the record: no extra query.
    offers = sorted(r['tbf'], key=lambda f: f[1] or '9999')
    first_off = offers[0][1] if offers else ''
    dep_days = [row[0] for row in daily.get(pid, []) if row[1] > 0]      # days with a deposit
    req_dnum = _dnum(c['first_req'])
    after = [dnum for dnum in dep_days if dnum >= req_dnum]
    r['dep1'] = str(DAY0 + dt.timedelta(days=min(after))) if after else ''
    wave2 = [f for f in offers if r['dep1'] and f[1] and f[1] > r['dep1']]
    r['w2_got']  = bool(wave2)
    r['w2_act']  = any(f[2] for f in wave2)
    r['w2_done'] = any(f[3] for f in wave2)
    r['w2_n']    = len(wave2)
    r['w2_first'] = wave2[0][1] if wave2 else ''
    tb = TB.get(pid)
    r['tb_got']  = bool(tb)
    r['tb_act']  = bool(tb and int(tb.get('activated') or 0))
    r['tb_done'] = bool(tb and int(tb.get('completed') or 0))
    r['tb_date'] = (tb or {}).get('first_given') or ''
    ds = DEPSIZE.get(pid, {})
    r['max_dep'] = float(ds.get('max_dep') or 0)
    # Deposits made while the 1941 ticket was still alive. The offer asks for a
    # $1,000 deposit and the ticket expires after about a week, so an all-time
    # largest deposit says nothing about whether the condition was met -- money
    # that arrived after it lapsed could not have counted, however large.
    r['b41_dep']  = float(ds.get('b41_dep') or 0)
    r['b41_days'] = int(ds.get('b41_days') or 0)
    r['b41_from'] = ds.get('b41_from') or ''
    r['b41_to']   = ds.get('b41_to') or ''
    r['b41_max']  = float(ds.get('b41_max') or 0)
    r['b41_n']    = int(ds.get('b41_big') or 0)
    r['b41_ok']   = r['b41_n'] > 0
    r['n_big']   = int(ds.get('n_big') or 0)
    # `big` drives the deposit-size fork in the funnel. It used to mean "a single
    # deposit of EUR 1,000+ at any point since the request", which answered a
    # question nobody was asking: 1941 wants that deposit while its ticket is
    # alive, and the ticket lives about a week. A deposit made a month later
    # counted towards the box and could never have met the condition.
    # n_big is kept as the all-time count for anything that wants it.
    r['big']     = int(ds.get('b41_big') or 0) > 0
    r['tfs_n']   = int(ds.get('n_fs') or 0)
    r['tfs']     = r['tfs_n'] > 0
    r['spins']   = int(ds.get('spins') or 0)
    # Where the spins came from, and -- separately -- whether a ticket merely
    # exists. 642 of the 643 tickets under family 1941 have a null available_at,
    # i.e. they were minted and never opened, so "held" and "received" are
    # genuinely different questions for that offer.
    r['fs1941']  = int(ds.get('n_fs_1941') or 0) > 0
    r['fs2034']  = int(ds.get('n_fs_2034') or 0) > 0
    r['fswheel'] = int(ds.get('n_fs_wheel') or 0) > 0
    r['hd1941']  = int(ds.get('held_1941') or 0) > 0
    r['hd2034']  = int(ds.get('held_2034') or 0) > 0
    r['hdwheel'] = int(ds.get('held_wheel') or 0) > 0
    r['cb']      = int(ds.get('n_cb') or 0) > 0
    r['hdcb']    = int(ds.get('held_cb') or 0) > 0
    r['cb_eur']  = float(ds.get('cb_amount') or 0)
    tr_ = TIER.get(pid, {})
    r['notes']   = NOTES.get(pid, [])
    r['survey']  = SURVEY.get(pid, [])
    r['tier']    = tr_.get('tier') or ''
    # the ladder position, so the column sorts Bronze I -> Legend rather than
    # alphabetically (which would put Silver above Platinium)
    r['tier_no'] = int(tr_.get('tier_no') or 0)
    r['points']  = int(tr_.get('points') or 0)
    ct = CONTACT.get(pid, {})
    r['tg']    = bool(int(ct.get('telegram') or 0))
    r['phone'] = bool(int(ct.get('phone') or 0))
    r['phone_ok'] = bool(int(ct.get('phone_verified') or 0))
    # --- the 30-day trial ---------------------------------------------------
    # A transfer requester gets a 30-day test period with the transfer offers on
    # it. Judging them on the matched window would be judging different players
    # over different lengths of time; the trial is the same 30 days for
    # everyone, so the verdict gets its own window.
    #
    # `t30_done` says the 30 days have actually elapsed. Without it a player who
    # requested yesterday and has not deposited yet would be filed under "no
    # sign of VIP" when the truth is that nobody can know yet.
    t0 = _dnum(str(req))
    t30 = dict(dep=0.0, wd=0.0, ggr=0.0, adj=0.0, bc=0.0, days=set(), dc=0, dd=0)
    # Which of the four weeks saw a deposit. The manager bonus scheme scores on
    # this, so it is computed here rather than in the browser -- one definition,
    # in the same place the 30-day totals come from.
    #
    # 30 days is four weeks and two days. Rather than drop days 28 and 29 or
    # invent a fifth week, they fall into week 4, which therefore runs 9 days.
    # Any other choice either loses deposits or creates a week nobody agreed to.
    wk = [False, False, False, False]
    for row in hist:
        if t0 <= row[0] < t0 + 30:
            t30['dep'] += row[1]; t30['ggr'] += row[5]
            t30['bc']  += row[7]; t30['adj'] += row[8]
            t30['wd']  += row[3]; t30['dc']  += row[2]
            if row[1] > 0:
                t30['dd'] += 1
                wk[min((row[0] - t0) // 7, 3)] = True
            if row[1] > 0 or row[4] != 0: t30['days'].add(row[0])
    r['t30_wk']   = wk
    r['t30_wn']   = sum(1 for x in wk if x)
    r['t30_wd']   = round(t30['wd'], 2)
    r['t30_dc']   = t30['dc']
    r['t30_dd']   = t30['dd']
    r['t30_dep']  = round(t30['dep'], 2)
    r['t30_adj']  = round(t30['adj'], 2)
    r['t30_bc']   = round(t30['bc'], 2)
    # what the house actually kept: adjusted GGR less what the bonuses cost
    r['t30_net']  = round(t30['adj'] - t30['bc'], 2)
    r['t30_days'] = len(t30['days'])
    r['t30_done'] = ((TODAY - DAY0).days - t0) >= 30
    r['t30_left'] = max(30 - ((TODAY - DAY0).days - t0), 0)

    # --- the same 30 days, but from ONBOARDING -------------------------------
    # The manager bonus is scored on this one. Anchoring it on the request date
    # measured a quarter of the book on a period the VA had no part in: 90 of
    # 357 onboarded players were taken on more than 30 days after they asked, so
    # their cycle had already closed. Purneken is the clean example -- requested
    # 2 Jul, onboarded 13 Aug, EUR 2,800 in the request cycle and EUR 9,217 since
    # the VA actually took him.
    #
    # `o30_before_req` marks the reverse fault: a cycle that finished before the
    # player ever requested a transfer. That cannot be the manager's transfer
    # work, and it is what a wrong onboarding date looks like -- one VA's whole
    # book is dated 7 Jan 2026 against requests in July. Flagged, not scored.
    if onb is not None:
        o0 = _dnum(str(onb))
        o30 = dict(dep=0.0, wd=0.0, adj=0.0, bc=0.0, dc=0, dd=0)
        owk = [False, False, False, False]
        for row in hist:
            if o0 <= row[0] < o0 + 30:
                o30['dep'] += row[1]; o30['wd'] += row[3]; o30['dc'] += row[2]
                o30['bc']  += row[7]; o30['adj'] += row[8]
                if row[1] > 0:
                    o30['dd'] += 1
                    owk[min((row[0] - o0) // 7, 3)] = True
        r['o30_wk']   = owk
        r['o30_wn']   = sum(1 for x in owk if x)
        r['o30_dep']  = round(o30['dep'], 2)
        r['o30_wd']   = round(o30['wd'], 2)
        r['o30_dc']   = o30['dc']
        r['o30_dd']   = o30['dd']
        r['o30_adj']  = round(o30['adj'], 2)
        r['o30_bc']   = round(o30['bc'], 2)
        r['o30_net']  = round(o30['adj'] - o30['bc'], 2)
        # the same 30 days, counted in dollars: this is what the bonus bands read
        _u = USD.get(pid, {})
        r['o30_usd'] = round(sum(v for k, v in _u.items() if o0 <= k < o0 + 30), 2)
        r['o30_done'] = ((TODAY - DAY0).days - o0) >= 30
        r['o30_left'] = max(30 - ((TODAY - DAY0).days - o0), 0)
        r['o30_lag']  = o0 - t0                      # days from request to onboarding
        r['o30_before_req'] = (o0 + 30) <= t0
    else:
        r['o30_wk'] = [False]*4
        for k in ('wn','dep','wd','dc','dd','adj','bc','net','left','lag','usd'): r['o30_' + k] = 0
        r['o30_done'] = False
        r['o30_before_req'] = False

    # last_active in cohort.json is the last day with a deposit OR a bet. The
    # player table asks a narrower question, so derive the deposit-only date
    # from the daily series rather than relabelling a column that means
    # something else.
    dep_days = [row[0] for row in hist if row[1] > 0]
    r['last_dep'] = str(DAY0 + dt.timedelta(days=max(dep_days))) if dep_days else ''
    r['hist'] = daily.get(pid, [])
    r['bon']  = bonus.get(pid, [])
    rows.append(r)

def rate(v, months):
    """Monthly average, but never a projection: the divisor is floored at one
    month, so a player who has been in the cohort for 17 days reports what they
    actually deposited rather than what a full month would have looked like."""
    return v / max(months, 1.0) if months > 0 else 0.0

def agg(rs, tag):
    """Group figures for one split basis.

    Rates are PER PLAYER, not per month. Now that before and after cover the
    same number of days for every player, dividing by months only rescaled both
    sides by the same factor and told you nothing the totals did not. Dividing
    by head count answers the question the totals cannot: is this VA's book big
    because the players are good, or because there are a lot of them."""
    n  = len(rs) or 1
    mb = sum(max(x[tag + '_mo_bef'], 1.0) for x in rs)
    ma = sum(max(x[tag + '_mo_aft'], 1.0) for x in rs)
    o = dict(players=len(rs), mo_bef=round(mb, 2), mo_aft=round(ma, 2))
    for m in ('dep', 'ggr', 'ngr', 'bc', 'adj'):
        b = sum(x[tag + '_bef_' + m] for x in rs)
        a = sum(x[tag + '_aft_' + m] for x in rs)
        o['t_bef_' + m] = round(b, 2)
        o['t_aft_' + m] = round(a, 2)
        o['bef_' + m]   = round(b / n, 2)
        o['aft_' + m]   = round(a / n, 2)
    o['depositors'] = sum(1 for x in rs if x[tag + '_aft_dep'] > 0)
    o['silent']     = sum(1 for x in rs if x[tag + '_aft_dep'] == 0 and x[tag + '_aft_ggr'] == 0)
    return o

def group(rs, key, tag, label=None):
    buckets = {}
    for x in rs:
        buckets.setdefault(x[key] or '—', []).append(x)
    out = [dict(name=k, **agg(v, tag)) for k, v in buckets.items()]
    out.sort(key=lambda g: -g['t_aft_dep'])
    return out

tracked   = [r for r in rows if r['tracked']]
untracked = [r for r in rows if not r['tracked']]

def cohort(label, rs, tag, note):
    """One selectable population on one split basis."""
    return dict(label=label, tag=tag, n=len(rs), note=note,
                total=agg(rs, tag),
                by_month=group(rs, 'req_month', tag),
                by_segment=group(rs, 'segment', tag),
                by_aff=group(rs, 'aff_group', tag)[:40],
                by_va=group(rs, 'va_group', tag),
                by_casino=group(rs, 'casino_group', tag))

REQ_NOTE = ('split on the transfer request date, matched windows: after runs to today, '
            'before covers the same number of days ending the day before the request')
ONB_NOTE = ('split on the VA onboarding date from the tracker sheet, same matched-window rule')

# Requests run from Aug 2025, but the programme only got going in July 2026, so
# the page offers that window as well as the whole history. June is offered too:
# it catches the run-up month without dragging in the long 2025 tail, and it is
# the widest window in which every player still has a full 30-day trial behind
# them. Each period is a separate precomputed pack, so adding one costs build
# time, not page logic.
SINCE      = dt.date(2026, 7, 1)
SINCE_JUN  = dt.date(2026, 6, 1)
PERIODS = {'all': lambda r: True,
           'jun': lambda r: d(r['first_req']) >= SINCE_JUN,
           'jul': lambda r: d(r['first_req']) >= SINCE}

def median(xs):
    xs = sorted(xs)
    return xs[len(xs)//2] if xs else 0

def funnel(rs, tr, ntr):
    """The request -> onboarding funnel. "Pending" is a requester no VA has
    onboarded; it is not a queue anyone is working, just the gap."""
    lag  = [(d(x['onboard']) - d(x['first_req'])).days for x in tr
            if x['onboard'] and x['first_req']]
    wait = [(TODAY - d(x['first_req'])).days for x in ntr if x['first_req']]
    return dict(
        requested=len(rs), onboarded=len(tr), pending=len(ntr),
        onboarded_pct=round(100*len(tr)/len(rs), 1) if rs else 0,
        lag_median=median([l for l in lag if l >= 0]),
        wait_median=median(wait),
        pending_over_30=sum(1 for w in wait if w > 30),
        deposited_after=sum(1 for x in rs if x['r_aft_dep'] > 0),
        tb_got=sum(1 for x in rs if x['tb_got']),
        tb_act=sum(1 for x in rs if x['tb_act']),
        tb_done=sum(1 for x in rs if x['tb_done']),
    )

def contact_by_segment(rs):
    """Reachability by segment, split onboarded vs pending.

    The warehouse has a Telegram link and a phone number; it has no WhatsApp
    flag, so "phone" is the closest proxy for a WhatsApp-reachable player. The
    tracker sheet does record a preferred channel, but only for onboarded
    players, so it cannot answer this for the pending ones."""
    seg = {}
    for x in rs:
        s = seg.setdefault(x['segment'] or '—',
                           dict(name=x['segment'] or '—', onb=0, pend=0,
                                onb_tg=0, onb_ph=0, onb_any=0, onb_none=0,
                                pend_tg=0, pend_ph=0, pend_any=0, pend_none=0))
        k = 'onb' if x['tracked'] else 'pend'
        s[k] += 1
        if x['tg']:    s[k + '_tg'] += 1
        if x['phone']: s[k + '_ph'] += 1
        if x['tg'] or x['phone']: s[k + '_any'] += 1
        else:                     s[k + '_none'] += 1
    out = sorted(seg.values(), key=lambda v: -(v['onb'] + v['pend']))
    tot = dict(name='Total')
    for k in ('onb','pend','onb_tg','onb_ph','onb_any','onb_none',
              'pend_tg','pend_ph','pend_any','pend_none'):
        tot[k] = sum(v[k] for v in out)
    return dict(rows=out, total=tot)

def journey(rs):
    """The whole thing as one chain: request -> first offer -> activation ->
    deposit -> follow-up offer -> activation -> completion. Each step is a
    subset of the one before, so the graph reads left to right without the two
    halves needing separate scales."""
    given = [x for x in rs    if x['tb_got']]
    act1  = [x for x in given if x['tb_act']]
    dep   = [x for x in act1  if x['dep1']]
    got2  = [x for x in dep   if x['w2_got']]
    act2  = [x for x in got2  if x['w2_act']]
    done2 = [x for x in act2  if x['w2_done']]
    lag = []
    for x in got2:
        try: lag.append((d(x['w2_first']) - d(x['dep1'])).days)
        except Exception: pass
    steps = [
        ('Transfer requests',   len(rs),    None,          ''),
        ('Given an offer',      len(given), len(rs),       'Never given one'),
        ('Activated it',        len(act1),  len(given),    'Never activated'),
        ('Then deposited',      len(dep),   len(act1),     'Never deposited'),
        ('Given a 2nd offer',   len(got2),  len(dep),      'No second offer'),
        ('Activated the 2nd',   len(act2),  len(got2),     'Left it untouched'),
        ('Completed the 2nd',   len(done2), len(act2),     'Left unfinished'),
    ]
    return dict(
        steps=[dict(label=l, n=n, of=of, drop=dl, dropN=(of - n) if of is not None else 0)
               for l, n, of, dl in steps],
        lag_median=median([l for l in lag if l >= 0]))

def second_wave(rs):
    """The follow-up funnel: of the players given a transfer offer, who went on
    to deposit, who was then given another offer, and who took it.

    "Second wave" means an offer dated after that player's first deposit
    following their request -- so it is a genuine follow-up, not part of the
    same batch they were handed on day one."""
    given   = [x for x in rs if x['tb_got']]
    dep     = [x for x in given if x['dep1']]
    got2    = [x for x in dep if x['w2_got']]
    act2    = [x for x in got2 if x['w2_act']]
    done2   = [x for x in act2 if x['w2_done']]
    lag = []
    for x in got2:
        try: lag.append((d(x['w2_first']) - d(x['dep1'])).days)
        except Exception: pass
    return dict(given=len(given), deposited=len(dep), no_deposit=len(given) - len(dep),
                got2=len(got2), no_second=len(dep) - len(got2),
                act2=len(act2), not_act2=len(got2) - len(act2),
                done2=len(done2), lag_median=median([l for l in lag if l >= 0]))

BIG = 1000.0

def deptree(rs):
    """Depositors, then what happened to them, as one nested tree.

    Each node carries `q`, the accumulated filter that produced it, so clicking
    a box on the page can show exactly those players. Every split is a genuine
    partition -- the children always sum to the parent -- which is why the
    free-spin source buckets are priority-ordered rather than overlapping: a
    handful of players hold tickets from both the wheel and the $1,000 offer.

    Two of the offers mint tickets that never open. Family 1941's $150 free
    spins and family 1925's cashback both sit in the ticket tables with a null
    available_at, so "holds a ticket" and "was actually paid" are different
    questions and the tree keeps them apart."""

    def node(label, g, of, q, sub='', dead=False, kids=None, bad=False):
        # Empty branches are dropped rather than drawn as slivers: an offer that
        # delivered to nobody has no box. The codes on the surviving boxes are
        # what shows which offers are in scope.
        #
        # "No ..." children are dropped too. They restated an absence and then
        # dragged the same head count through two or three more boxes at 100%
        # each -- "No free spins" -> "No free spins from these offers" -> "No
        # 1925 cashback", all 135, all 100%. The tree now shows what happened;
        # what did not is the gap between a box and its parent's count.
        return dict(label=label, n=len(g), of=of, q=q, sub=sub, dead=dead, bad=bad,
                    kids=[k for k in (kids or []) if k['n'] and not k['label'].startswith('No ')])

    def q(base, **kw):
        out = dict(base); out.update(kw); return out

    def cash(g, base, dead):
        # The "never opened" box was removed on request. Those players had a 1925
        # ticket minted and never made available, so from their side no cashback
        # arrived -- the same outcome as never being ticketed at all. They join
        # the "No cashback" box rather than being dropped, or the boxes would
        # stop summing to the branch above them.
        got  = [x for x in g if x['cb']]
        none = [x for x in g if not x['cb']]
        amt = sum(x['cb_eur'] for x in got)
        return [node('1925 Cashback paid', got, len(g), q(base, cb='got'),
                     eur(amt) if amt else '', False),
                node('No 1925 cashback', none, len(g), q(base, cb='none'), '', dead)]

    def source(g, base):
        """Which of the three free-spin offers in scope opened the spins.
        Priority-ordered so the buckets partition: the wheel first, because it
        is the one that reliably delivers, then 1941, then 2034."""
        wh  = [x for x in g if x['fswheel']]
        o41 = [x for x in g if not x['fswheel'] and x['fs1941']]
        o34 = [x for x in g if not x['fswheel'] and not x['fs1941']]
        return [node('1926-34 Wheel tiers',   wh,  len(g), q(base, src='wheel'), '', False,
                     cash(wh,  q(base, src='wheel'), False) if wh else None),
                node('1941 $1,000 offer',     o41, len(g), q(base, src='o1941'), '', not o41,
                     cash(o41, q(base, src='o1941'), False) if o41 else None),
                node('2034 New offer',        o34, len(g), q(base, src='o2034'), '', not o34,
                     cash(o34, q(base, src='o2034'), False) if o34 else None)]

    def missing(g, base):
        # Same removal: holding an unopened 1941/2034 ticket and holding none at
        # all both mean the player got no free spins, so they are one box now.
        return [node('No free spins from these offers', g, len(g), q(base, nof='any'),
                     '', True, cash(g, q(base, nof='any'), True))]

    def branch(g, label, base):
        fs = [x for x in g if x['tfs']]
        no = [x for x in g if not x['tfs']]
        qf, qn = q(base, tfs=1), q(base, tfs=0)
        spins = sum(x['spins'] for x in fs)
        # What reached the 1941 condition in time, not the all-time biggest
        # deposit: the ticket lives about a week and then the chance is gone.
        held = [x for x in g if x['b41_from']]
        ok   = [x for x in held if x['b41_ok']]
        sub  = ('%s deposited while the 1941 ticket was live \u00b7 %d of %d held one'
                % (eur(sum(x['b41_dep'] for x in held)), len(ok), len(held))) if held else ''
        return node(label, g, len(dep_of(base)), base, sub, False,
                    [node('Free spins arrived', fs, len(g), qf,
                          ('%s spins' % f2(spins)) if spins else '', False, source(fs, qf)),
                     node('No free spins', no, len(g), qn, '', True, missing(no, qn))])

    # `dep` is the denominator the deposit-size boxes are shown against, so it
    # stays the whole cohort's depositors even though the tree now forks on
    # onboarding first -- otherwise the two halves would quote percentages of
    # different bases and could not be compared.
    dep = [x for x in rs if x['dep1']]

    def dep_of(base):
        g = rs if 'onb' not in base else [x for x in rs if bool(x['tracked']) == bool(base['onb'])]
        return [x for x in g if x['dep1']]

    def side(g, label, base):
        d = [x for x in g if x['dep1']]
        n = [x for x in g if not x['dep1']]
        big = [x for x in d if x['big']]
        sml = [x for x in d if not x['big']]
        qd = q(base, dep=1)
        return node(label, g, len(rs), base, '', False, [
            node('Deposited after requesting', d, len(g), qd, '', False,
                 [branch(big, '\u20ac1,000+ in one go, in time', q(qd, big=1)),
                  branch(sml, 'Never \u20ac1,000 in time',        q(qd, big=0))]),
            node('Never deposited', n, len(g), q(base, dep=0), '', True)])

    root = node('Transfer requests', rs, None, {}, '', False, [
        side([x for x in rs if x['tracked']],     'Onboarded by a VA', dict(onb=1)),
        side([x for x in rs if not x['tracked']], 'Never onboarded',   dict(onb=0))])
    return root


def eur(n):
    return '\u20ac' + f2(round(n))


def f2(n):
    return '{:,}'.format(int(n))


def offers_for(rs, keys=None):
    """Partition players by the FIRST transfer offer they activated. When `keys`
    is given the buckets are forced into that order (and zero-count offers are
    kept), so two bands can be compared segment by segment."""
    TOP = 6
    buckets = {}
    for x in rs:
        acts = sorted([f for f in x['tbf'] if f[2]], key=lambda f: f[1] or '9999')
        if not acts: continue
        nm = TB_NAMES[acts[0][0]]
        o = buckets.setdefault(nm, dict(name=nm, players=0, completed=0))
        o['players'] += 1
        o['completed'] += 1 if x['tb_done'] else 0
    if keys is not None:
        named = [k for k in keys if k != 'OTHER']
        out = [buckets.get(k, dict(name=k, players=0, completed=0)) for k in named]
        rest = [v for k, v in buckets.items() if k not in named]
        out.append(dict(name='%d other offers' % max(len(rest), 0) if rest else 'other offers',
                        players=sum(r['players'] for r in rest),
                        completed=sum(r['completed'] for r in rest)))
        return out
    rows = sorted(buckets.values(), key=lambda v: -v['players'])
    if len(rows) > TOP:
        rest = rows[TOP:]
        rows = rows[:TOP] + [dict(name='%d other offers' % len(rest),
                                  players=sum(r['players'] for r in rest),
                                  completed=sum(r['completed'] for r in rest))]
    return rows

def activated_offers(rs):
    """Split the players who activated something by WHICH offer they activated.

    43% activated more than one, so this partitions on the first one they
    activated (earliest given date). That keeps the tree summing to the
    activated count; the per-offer table below is the unpartitioned view where a
    player counts under every offer they took."""
    TOP = 6
    buckets = {}
    for x in rs:
        if not x['tb_act']:
            continue
        acts = sorted([f for f in x['tbf'] if f[2]], key=lambda f: f[1] or '9999')
        nm = TB_NAMES[acts[0][0]] if acts else '—'
        o = buckets.setdefault(nm, dict(name=nm, players=0, completed=0))
        o['players'] += 1
        o['completed'] += 1 if x['tb_done'] else 0
    rows = sorted(buckets.values(), key=lambda v: -v['players'])
    if len(rows) > TOP:
        rest = rows[TOP:]
        rows = rows[:TOP] + [dict(name='%d other offers' % len(rest),
                                  players=sum(r['players'] for r in rest),
                                  completed=sum(r['completed'] for r in rest))]
    return rows

def bonus_distribution(rs):
    """One row per VIP-transfer offer: how many of these requesters were given
    it, activated it and completed it. A player can appear under several offers
    -- the wheel tiers especially -- so the rows do not sum to the cohort."""
    out = {}
    for x in rs:
        for fi, given, act, done in x['tbf']:
            o = out.setdefault(fi, dict(name=TB_NAMES[fi], code=TB_CODES[fi],
                                        given=0, activated=0, completed=0,
                                        first='', last=''))
            o['given'] += 1
            o['activated'] += 1 if act else 0
            o['completed'] += 1 if done else 0
            if given:
                o['first'] = min(o['first'], given) if o['first'] else given
                o['last']  = max(o['last'],  given)
    rows = sorted(out.values(), key=lambda v: -v['given'])
    tot = dict(name='Any transfer offer', code=0,
               given=sum(1 for x in rs if x['tb_got']),
               activated=sum(1 for x in rs if x['tb_act']),
               completed=sum(1 for x in rs if x['tb_done']),
               first=min([r['first'] for r in rows if r['first']], default=''),
               last=max([r['last'] for r in rows if r['last']], default=''))
    return dict(rows=rows, total=tot)

def pack(rs):
    tr  = [r for r in rs if r['tracked']]
    ntr = [r for r in rs if not r['tracked']]
    return dict(
        all   = cohort('All transfer requests', rs,  'r', REQ_NOTE),
        onb   = cohort('Onboarded',             tr,  'r', REQ_NOTE),
        non   = cohort('Not onboarded',         ntr, 'r', REQ_NOTE),
        onb_o = cohort('Onboarded',             tr,  'o', ONB_NOTE),
        coverage=[dict(name='Onboarded', **agg(tr, 'r')),
                  dict(name='Not onboarded', **agg(ntr, 'r'))],
        counts=dict(all=len(rs), onb=len(tr), non=len(ntr)),
        funnel=funnel(rs, tr, ntr),
        # Given vs actually received, per in-scope offer. Two numbers because
        # for two of the three they are wildly different, and quoting either
        # alone would mislead.
        scope=dict(
            g1941=sum(1 for x in rs if x['hd1941']),  r1941=sum(1 for x in rs if x['fs1941']),
            g2034=sum(1 for x in rs if x['hd2034']),  r2034=sum(1 for x in rs if x['fs2034']),
            gwheel=sum(1 for x in rs if x['hdwheel']), rwheel=sum(1 for x in rs if x['fswheel']),
            gcb=sum(1 for x in rs if x['hdcb']),      rcb=sum(1 for x in rs if x['cb']),
            cb_eur=round(sum(x['cb_eur'] for x in rs if x['cb']), 2),
            spins=sum(x['spins'] for x in rs),
        ),
        contact=contact_by_segment(rs),
        bonus_dist=bonus_distribution(rs),
        act_offers=activated_offers(rs),
        dep_offers=offers_for([x for x in rs if x['tb_act'] and x['dep1']],
                              keys=[o['name'] for o in activated_offers(rs)[:-1]] + ['OTHER']
                                   if len(activated_offers(rs)) > 6 else
                                   [o['name'] for o in activated_offers(rs)]),
        wave2=second_wave(rs),
        journey=journey(rs),
        deptree=deptree(rs),
    )

data = dict(
    generated=dt.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC'),
    today=str(TODAY), since=str(SINCE), since_jun=str(SINCE_JUN),
    # What the page can honestly claim to cover. Read off the extracts rather
    # than assumed from the clock: the money view closes a day in arrears, and
    # any one of these files can be older than the others if a refresh half ran.
    covers=dict(
        money=max((str(DAY0 + dt.timedelta(days=r[0]))
                   for v in daily.values() for r in v), default=''),
        bonus=max((str(DAY0 + dt.timedelta(days=r[0]))
                   for v in bonus.values() for r in v), default=''),
        # `cohort` is a function by this point in the file; use the built rows
        request=max((r.get('first_req') or '')[:10] for r in rows) if rows else '',
    ),
    day0=str(DAY0), bonus_names=BONUS_NAMES, bonus_kinds=KINDS,
    tb_names=TB_NAMES, tb_codes=TB_CODES,
    rows=rows,
    periods={k: pack([r for r in rows if f(r)]) for k, f in PERIODS.items()},
)
json.dump(data, open(os.path.join(HERE, 'vip-transfer-data.json'), 'w', encoding='utf-8'),
          separators=(',', ':'), default=str)

print('daily rows %d across %d players | bonus tickets %d across %d players | %d distinct bonuses'
      % (sum(len(v) for v in daily.values()), len(daily),
         sum(len(v) for v in bonus.values()), len(bonus), len(BONUS_NAMES)))
for p in PERIODS:
    f = data['periods'][p]['funnel']
    print('  %-4s transfer bonus: given to %d, activated by %d, completed by %d (of %d requesters)'
          % (p, f['tb_got'], f['tb_act'], f['tb_done'], f['requested']))
def _walk(n, d=0):
    print('  ' + '    ' * d + ('%-34s %5d  %s' % (n['label'], n['n'], n['sub'])).rstrip())
    for k in n['kids']: _walk(k, d + 1)
print('\n  deposit tree since 1 Jul:')
_walk(data['periods']['jul']['deptree'])

j = data['periods']['jul']['journey']
print('  journey since 1 Jul: ' + ' -> '.join('%s %d' % (s['label'], s['n']) for s in j['steps']))
w = data['periods']['jul']['wave2']
print('  second wave since 1 Jul: given %d -> deposited %d -> got another offer %d -> activated it %d -> completed %d (median %dd after the deposit)'
      % (w['given'], w['deposited'], w['got2'], w['act2'], w['done2'], w['lag_median']))
do = data['periods']['jul']['dep_offers']
print('  of the depositors, first offer activated (sums to %d):' % sum(o['players'] for o in do))
for o in do: print('     %-58s %3d deposited' % (o['name'][:58], o['players']))
ao = data['periods']['jul']['act_offers']
print('  first offer activated, since 1 Jul (sums to %d):' % sum(o['players'] for o in ao))
for o in ao: print('     %-58s %3d activated, %3d completed' % (o['name'][:58], o['players'], o['completed']))
bd = data['periods']['jul']['bonus_dist']
print('  transfer offers used since 1 Jul: %d distinct' % len(bd['rows']))
for r in bd['rows'][:6]:
    print('     %-52s given %3d  activated %3d  completed %3d' % (r['name'][:52], r['given'], r['activated'], r['completed']))
c = data['periods']['jul']['contact']['total']
print('  contact reach since 1 Jul: onboarded %d -> telegram %d, phone %d, either %d, none %d'
      % (c['onb'], c['onb_tg'], c['onb_ph'], c['onb_any'], c['onb_none']))
print('                             pending  %d -> telegram %d, phone %d, either %d, none %d'
      % (c['pend'], c['pend_tg'], c['pend_ph'], c['pend_any'], c['pend_none']))
for p in PERIODS:
    f = data['periods'][p]['funnel']
    print('  %-4s funnel: requested %d -> onboarded %d (%.0f%%), pending %d | onboarding lag median %dd | pending waiting median %dd, %d over 30d'
          % (p, f['requested'], f['onboarded'], f['onboarded_pct'], f['pending'],
             f['lag_median'], f['wait_median'], f['pending_over_30']))
for p in PERIODS:
    _floor = {'jul': SINCE, 'jun': SINCE_JUN}.get(p)
    print(('=== %s ===' % ('all history' if not _floor else 'requested since ' + str(_floor))))
    for k in ('all','onb','non','onb_o'):
        c = data['periods'][p][k]; t = c['total']
        print('  %-6s %-22s %5d players   dep/mo %8.0f -> %8.0f   ggr/mo %7.0f -> %7.0f' %
              (k, c['label'], t['players'], t['bef_dep'], t['aft_dep'], t['bef_ggr'], t['aft_ggr']))
