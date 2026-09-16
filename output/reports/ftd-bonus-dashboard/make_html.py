# Regenerates ftd-bonus-dashboard.html from ftd-bonus-template.html + dashboard-data.js.
# NEVER edit ftd-bonus-dashboard.html directly -- edit the template or the builder scripts
# and re-run this.
tmpl = open('ftd-bonus-template.html', encoding='utf-8').read()
data = open('dashboard-data.js', encoding='utf-8').read()
out = tmpl.replace('__DASHBOARD_DATA__', data)
open('ftd-bonus-dashboard.html', 'w', encoding='utf-8').write(out)
import os
print('wrote ftd-bonus-dashboard.html, size:', os.path.getsize('ftd-bonus-dashboard.html'))
