# -*- coding: utf-8 -*-
"""
Bakes fiat-affiliate-data.json into the template and writes ../fiat-affiliate.html.

The built HTML at the folder root is GENERATED.  Never edit it -- edit
fiat-affiliate-template.html and re-run this, or the next build silently
destroys the change.

    python build_fiat_affiliate.py && python make_fiat_affiliate_html.py
"""
import json, os, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
TPL  = os.path.join(HERE, 'fiat-affiliate-template.html')
DATA = os.path.join(HERE, 'fiat-affiliate-data.json')
OUT  = os.path.join(HERE, '..', 'fiat-affiliate.html')

tpl = open(TPL, encoding='utf-8').read()
data = open(DATA, encoding='utf-8').read()
d = json.loads(data)

assert '__DATA__' in tpl, 'template lost its __DATA__ token'
html = tpl.replace('__DATA__', data).replace('__BUILT__', d['built'])
assert '__DATA__' not in html and '__BUILT__' not in html

open(OUT, 'w', encoding='utf-8').write(html)
print('wrote %s (%.1f KB)' % (os.path.normpath(OUT), os.path.getsize(OUT) / 1024.0))
