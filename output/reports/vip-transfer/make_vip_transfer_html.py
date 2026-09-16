"""Bakes vip-transfer-data.json into ../vip-transfer.html.

The built page at the parent folder is GENERATED. Never edit it -- edit
vip-transfer-template.html and re-run this, or the change is destroyed on the
next build.
"""
import os
here = os.path.dirname(os.path.abspath(__file__))
data = open(os.path.join(here, 'vip-transfer-data.json'), encoding='utf-8').read()
tpl  = open(os.path.join(here, 'vip-transfer-template.html'), encoding='utf-8').read()
out  = os.path.join(here, '..', 'vip-transfer.html')
open(out, 'w', encoding='utf-8').write(tpl.replace('__DATA__', data))
print('wrote', os.path.normpath(out), len(tpl) + len(data), 'bytes')
