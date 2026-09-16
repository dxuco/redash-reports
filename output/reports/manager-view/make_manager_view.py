"""Bakes the VIP-transfer data into ../manager-view.html.

No builder of its own: the numbers come from vip-transfer/vip-transfer-data.json,
so this page can never drift from the transfer report. Refresh the data with
13-build-vip-transfer.bat, then run this.

The built page at the parent folder is GENERATED. Never edit it -- edit
manager-view-template.html and re-run this.
"""
import os
here = os.path.dirname(os.path.abspath(__file__))
src  = os.path.join(here, '..', 'vip-transfer', 'vip-transfer-data.json')
data = open(src, encoding='utf-8').read()
tpl  = open(os.path.join(here, 'manager-view-template.html'), encoding='utf-8').read()
out  = os.path.join(here, '..', 'manager-view.html')
open(out, 'w', encoding='utf-8').write(tpl.replace('__DATA__', data))
print('wrote', os.path.normpath(out), len(tpl) + len(data), 'bytes')
