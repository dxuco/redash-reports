"""Bakes country-funnel-template.html + country-funnel-data.json -> ../country-funnel.html

The built file at the folder root is GENERATED. Never edit it -- edit the
template and re-run this, or the change is destroyed on the next build.
"""
import os
import datetime
HERE = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(HERE, 'country-funnel-template.html'), encoding='utf-8').read()
data = open(os.path.join(HERE, 'country-funnel-data.json'), encoding='utf-8').read()
assert '__DATA__' in tpl, 'template lost its __DATA__ token'
dest = os.path.join(HERE, '..', 'country-funnel.html')
# A build stamp in the header, so a stale page in a browser tab is visible at a
# glance instead of something you have to catch by arithmetic. Someone reading
# figures that disagree between sections needs to know which copy they have.
stamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
html = tpl.replace('__DATA__', data).replace('__BUILT__', stamp)
open(dest, 'w', encoding='utf-8').write(html)
print(f'wrote {os.path.abspath(dest)}  ({len(tpl)+len(data):,} bytes)')
