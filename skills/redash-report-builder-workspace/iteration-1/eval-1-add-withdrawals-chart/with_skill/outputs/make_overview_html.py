#!/usr/bin/env python3
"""Bake overview-data.json into overview-template.html -> ..\\business-overview.html

Same pattern as the other reports here: the page is standalone single-file HTML
with the data inlined, so it opens by double-clicking with no server and no
network. Edit overview-template.html, re-run this, never edit the built file.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(HERE, "overview-template.html"), encoding="utf-8").read()
data = open(os.path.join(HERE, "overview-data.json"), encoding="utf-8").read()

if "__DATA__" not in tpl:
    raise SystemExit("template has no __DATA__ placeholder")

out = os.path.join(HERE, "..", "business-overview.html")
open(out, "w", encoding="utf-8").write(tpl.replace("__DATA__", data))
print("wrote %s (%.0f KB)" % (os.path.abspath(out), os.path.getsize(out) / 1024))
