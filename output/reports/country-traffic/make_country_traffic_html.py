"""Bakes the template + every data file -> ../country-traffic.html

The built file at the folder root is GENERATED. Never edit it -- edit the
template and re-run this, or the change is destroyed on the next build.

The data arrives as several files because it came from differently shaped GA4
pulls (monthly totals, monthly by channel, per-source, daily organic) and from
different batches of countries. Keeping the provenance separate makes it obvious
which pull to re-run when a number looks wrong.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
J = lambda name: json.load(open(os.path.join(HERE, name), encoding='utf-8'))

data = J('country-traffic-data.json')
MONTHS = data['months']

# --- monthly totals -------------------------------------------------------
extra = J('extra-countries.json')
assert extra['months'] == MONTHS, 'month axis drifted between pulls'
data['countries'].update(extra['countries'])

# --- monthly by channel ---------------------------------------------------
for f in ('extra-channels-1.json', 'extra-channels-2.json'):
    data['monthlyChannels'].update(J(f))

# --- per-source ------------------------------------------------------------
for f in ('extra-sources-1.json', 'extra-sources-2.json', 'extra-sources-3.json'):
    for country, blob in J(f).items():
        data['sourceDetail'][country] = blob['detail']
        data['sourceMonthly'][country] = blob['monthly']
        data['sourceChannel'][country] = {
            src[0]: ch for ch, rows in blob['detail'].items() for src in rows}

# --- daily, split by channel ------------------------------------------------
# Every section follows the channel chip, so the daily view needs a series per
# channel rather than organic alone. The date axis is derived from the data, not
# fixed: GA4 lags about two days, so the last day moves with each refresh and a
# hard-coded length would fail the moment the window grows.
daily = {'dates': None, 'countries': {}}
for f in ('daily-channel-1.json', 'daily-channel-2.json', 'daily-channel-3.json',
          'daily-channel-4.json', 'daily-channel-5.json'):
    blob = J(f)
    if daily['dates'] is None:
        daily['dates'] = blob['dates']
    else:
        assert blob['dates'] == daily['dates'], f'{f}: date axis disagrees with the others'
    daily['countries'].update(blob['countries'])
DAYS = len(daily['dates'])
data['dailyChannel'] = daily

# --- landing pages, split by channel ---------------------------------------
data['pagesChannel'] = {}
for f in ('pages-channel-1.json', 'pages-channel-2.json', 'pages-channel-3.json',
          'pages-channel-4.json', 'pages-channel-5.json'):
    data['pagesChannel'].update(J(f))

# --- bounce rate ------------------------------------------------------------
data['bounce'] = {}
for f in ('bounce-1.json', 'bounce-2.json', 'bounce-3.json', 'bounce-4.json'):
    data['bounce'].update(J(f))

# --- landing pages by month -------------------------------------------------
data['pagesMonthly'] = {}
for f in ('pages-monthly-1.json', 'pages-monthly-2.json', 'pages-monthly-3.json'):
    data['pagesMonthly'].update(J(f))

# --- the country roster is the single source of truth ----------------------
ORDER = ['Brazil', 'United States', 'Germany', 'Canada', 'Spain',
         'United Kingdom', 'South Africa', 'Israel', 'Argentina', 'Vietnam',
         'India', 'Russia', 'Norway', 'Switzerland', 'Australia']
data['order'] = ORDER

# Every country must be complete in every dataset, or a chart silently renders
# a flat zero line for it and nobody notices.
for c in ORDER:
    assert c in data['countries'], f'{c}: no monthly totals'
    assert len(data['countries'][c]['sessions']) == len(MONTHS), c
    assert len(data['countries'][c]['users']) == len(MONTHS), c
    assert c in data['monthlyChannels'], f'{c}: no channel split'
    for ch in data['channelOrder']:
        assert len(data['monthlyChannels'][c].get(ch, [])) == len(MONTHS), f'{c}/{ch}'
    assert c in data['sourceDetail'] and c in data['sourceMonthly'], f'{c}: no sources'
    for src, arr in data['sourceMonthly'][c].items():
        assert len(arr) == len(MONTHS), f'{c}/{src}'
    assert c in data['pagesMonthly'], f'{c}: no monthly landing pages'
    for pg, arr in data['pagesMonthly'][c].items():
        assert len(arr) == len(MONTHS), f'{c}/{pg}: {len(arr)} months'
        # These came from a query that GA4 will silently truncate. A page whose
        # whole series is zero means the rows were capped away, not that nobody
        # landed on it -- it would never have made the top-14 cut otherwise.
        assert sum(arr) > 0, f'{c}/{pg}: all-zero series, pull was truncated'
        assert pg.startswith('/'), f'{c}/{pg}: not a URL'
    assert c in data['bounce'], f'{c}: no bounce data'
    b = data['bounce'][c]
    for key in ['all'] + data['channelOrder']:
        assert len(b['bounce'].get(key, [])) == len(MONTHS), f'{c}/bounce/{key}'
    # a rate outside 0..1 means the wrong column was read somewhere
    for key, arr in b['bounce'].items():
        for sess, rate in arr:
            assert 0 <= rate <= 1, f'{c}/{key}: bounce {rate} out of range'
            assert sess >= 0, f'{c}/{key}: negative sessions'
    assert b['pages'] and all(len(r) == 7 for r in b['pages']), f'{c}: page rows malformed'
    assert c in daily['countries'], f'{c}: no daily series'
    for key in ['all'] + data['channelOrder']:
        arr = daily['countries'][c].get(key)
        assert arr is not None and len(arr) == DAYS, f'{c}/daily/{key}'
    assert c in data['pagesChannel'], f'{c}: no per-channel landing pages'
    pc = data['pagesChannel'][c]
    for key in ['all'] + data['channelOrder']:
        assert key in pc['monthly'] and key in pc['bounce'], f'{c}/pages/{key}'
        for pg, arr in pc['monthly'][key].items():
            assert len(arr) == len(MONTHS), f'{c}/{key}/{pg}'
        for row in pc['bounce'][key]:
            assert len(row) == 7, f'{c}/{key}: bounce row is not 7 wide'
            assert 0 <= row[2] <= 1 and 0 <= row[5] <= 1, f'{c}/{key}/{row[0]}: bounce out of range'

for k in ('countries', 'monthlyChannels', 'sourceDetail', 'sourceMonthly', 'bounce',
          'pagesMonthly', 'pagesChannel'):
    stray = set(data[k]) - set(ORDER)
    assert not stray, f'{k} carries countries not in the roster: {stray}'

tpl = open(os.path.join(HERE, 'country-traffic-template.html'), encoding='utf-8').read()
assert '__DATA__' in tpl, 'template lost its __DATA__ token'
blob = json.dumps(data, separators=(',', ':'), ensure_ascii=False)
dest = os.path.join(HERE, '..', 'country-traffic.html')
open(dest, 'w', encoding='utf-8').write(tpl.replace('__DATA__', blob))
print(f'wrote {os.path.abspath(dest)}  ({(len(tpl)+len(blob))/1024:.0f} KB)')
print(f'  {len(ORDER)} countries, {len(MONTHS)} months, {DAYS} days, '
      f'{sum(len(v) for v in data["sourceMonthly"].values())} source series, '
      f'{sum(len(v) for v in data["pagesMonthly"].values())} page series, '
      f'{DAYS} days ending {daily["dates"][-1]}')
