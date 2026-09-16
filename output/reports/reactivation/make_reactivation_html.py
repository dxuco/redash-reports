#!/usr/bin/env python3
"""Bake reactivation-data.json into reactivation-template.html -> ..\\reactivation.html

Same pattern as the other reports here: the page is standalone single-file HTML
with the data inlined, so it opens by double-clicking with no server and no
network. Edit reactivation-template.html, re-run this, never edit the built file.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(HERE, "reactivation-template.html"), encoding="utf-8").read()
data = open(os.path.join(HERE, "reactivation-data.json"), encoding="utf-8").read()

if "__DATA__" not in tpl:
    raise SystemExit("template has no __DATA__ placeholder")

out = os.path.join(HERE, "..", "reactivation.html")
# Written to a temporary file and renamed into place, never straight to the
# destination. Writing directly means an interrupted run -- a killed process, a
# full disk, a closed console -- leaves a HALF-WRITTEN page live: the script
# ends mid-JSON, the browser reports "Unexpected end of input", and nothing on
# the page renders. That happened to business-overview.html on 2026-09-07.
# rename() is atomic, so the destination is either the old page or the new one.
def _write_atomic(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)

_write_atomic(out, tpl.replace("__DATA__", data))
print("wrote %s (%.0f KB)" % (os.path.abspath(out), os.path.getsize(out) / 1024))
