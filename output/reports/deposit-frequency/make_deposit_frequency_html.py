# -*- coding: utf-8 -*-
"""
make_deposit_frequency_html.py — bakes the standalone report

    python build_deposit_frequency.py      # first: emits the data payload
    python make_deposit_frequency_html.py  # then: writes ../deposit-frequency.html

The built file at ../deposit-frequency.html is GENERATED. Never edit it —
edit deposit-frequency-template.html and re-bake, or your change is
silently destroyed on the next build.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEMPLATE = os.path.join(HERE, "deposit-frequency-template.html")
DATA = os.path.join(HERE, "deposit-frequency-data.json")
OUT = os.path.join(ROOT, "deposit-frequency.html")

TOKEN = "__DATA__"


def main():
    for path in (TEMPLATE, DATA):
        if not os.path.exists(path):
            sys.exit("missing %s" % path)

    template = open(TEMPLATE, encoding="utf-8").read()
    if TOKEN not in template:
        sys.exit("template has no %s token" % TOKEN)

    data = open(DATA, encoding="utf-8").read()
    json.loads(data)  # fail loudly here rather than in the browser

    html = template.replace(TOKEN, data)
    if TOKEN in html:
        sys.exit("token survived the replace — more than one occurrence?")

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(html)

    print("wrote %s  (%.1f MB)" % (OUT, os.path.getsize(OUT) / 1048576.0))


if __name__ == "__main__":
    main()
