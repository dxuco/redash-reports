# Bakes streamers-data.json into streamers-template.html -> ../streamers.html
#
# ../streamers.html is GENERATED. Never edit it — an edit made there is silently
# destroyed the next time this runs. Edit streamers-template.html.

import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

tpl = open(os.path.join(HERE, "streamers-template.html"), encoding="utf-8").read()
data = open(os.path.join(HERE, "streamers-data.json"), encoding="utf-8").read()

assert "__DATA__" in tpl, "template lost its __DATA__ token"
out = tpl.replace("__DATA__", data)

dest = os.path.join(ROOT, "streamers.html")
with open(dest, "w", encoding="utf-8") as f:
    f.write(out)
print("wrote %s (%.0f KB)" % (dest, len(out) / 1024.0))
