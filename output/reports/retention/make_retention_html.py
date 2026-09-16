#!/usr/bin/env python3
"""Bake retention-data.json into retention-template.html -> ..\\retention.html

Same pattern as the other reports here: the page is standalone single-file HTML
with the data inlined, so it opens by double-clicking with no server and no
network.

The built ..\\retention.html is GENERATED. Edit retention-template.html and
re-run this. An edit made in the built file is destroyed by the next build,
silently and with no error.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(HERE, "retention-template.html"), encoding="utf-8").read()
data = open(os.path.join(HERE, "retention-data.json"), encoding="utf-8").read()

if tpl.count("__DATA__") != 1:
    raise SystemExit("template must contain exactly one __DATA__ placeholder, found %d"
                     % tpl.count("__DATA__"))

out = os.path.join(HERE, "..", "retention.html")
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
