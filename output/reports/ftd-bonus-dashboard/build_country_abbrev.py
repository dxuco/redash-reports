# Regenerates country_abbrev.json: full Redash country name -> ISO-3166-1
# alpha-2 code. Run this once whenever a brand-new country name shows up in
# cohorts.json that isn't already a key in country_abbrev.json (the build
# will still work without re-running -- cc_of() in build_dashboard_data.py
# falls back to the first 3 letters of the name uppercased for anything
# missing -- but a real code looks better).
import json
import pycountry

cohorts = json.load(open('cohorts.json'))
countries = set()
for month, players in cohorts.items():
    for p in players:
        countries.add(p['country'])

# Names Redash returns that pycountry.lookup() doesn't resolve on its own,
# plus a few synthetic buckets that aren't real countries at all.
MANUAL = {
    'Bolivia (Plurinational State of)': 'BO',
    'Korea (Republic of)': 'KR',
    'Macedonia (the former Yugoslav Republic of)': 'MK',
    'Moldova (Republic of)': 'MD',
    'Republic of Kosovo': 'XK',
    'Turkey': 'TR',
    'Venezuela (Bolivarian Republic of)': 'VE',
    'TOR Network': 'TOR',
    'VPN Player': 'VPN',
    'Unknown': '??',
}

mapping = {}
for c in sorted(countries):
    if c in MANUAL:
        mapping[c] = MANUAL[c]
        continue
    try:
        mapping[c] = pycountry.countries.lookup(c).alpha_2
    except LookupError:
        mapping[c] = c[:3].upper()
        print("no ISO match, using fallback:", c, "->", mapping[c])

json.dump(mapping, open('country_abbrev.json', 'w'), indent=1, ensure_ascii=False)
print("wrote country_abbrev.json,", len(mapping), "countries")
