"""Bakes us360-template.html + us360-data.json -> ../us-360.html

The built file at the folder root is GENERATED. Never edit it -- edit the
template and re-run this script, or the change is destroyed on the next build.
"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(HERE, 'us360-template.html'), encoding='utf-8').read()
data = open(os.path.join(HERE, 'us360-data.json'), encoding='utf-8').read()
assert '__DATA__' in tpl, 'template lost its __DATA__ token'
out = tpl.replace('__DATA__', data)
dest = os.path.join(HERE, '..', 'us-360.html')
open(dest, 'w', encoding='utf-8').write(out)
print(f'wrote {os.path.abspath(dest)}  ({len(out)/1024:.0f} KB)')
