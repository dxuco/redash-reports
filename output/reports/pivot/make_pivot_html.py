#!/usr/bin/env python3
"""
Bake pivot-template.html + pivot-data.json into the built pages.

    ../pivot.html                  standalone, opens by double-clicking
    ../_artifact/pivot-page.html   the same page as a body fragment, which is
                                   what the Artifact tool publishes (it supplies
                                   the doctype/head/body skeleton itself)

BOTH ARE GENERATED. Editing either one is silently destroyed on the next build
-- edit pivot-template.html and re-bake.
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SKELETON = """<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
%s
</head>
<body>
%s
</body>
</html>
"""


def main():
    with open(os.path.join(HERE, "pivot-template.html"), "r", encoding="utf-8") as fh:
        tpl = fh.read()
    with open(os.path.join(HERE, "pivot-data.json"), "r", encoding="utf-8") as fh:
        data = fh.read()

    if "__DATA__" not in tpl:
        raise SystemExit("template has lost its __DATA__ token")
    page = tpl.replace("__DATA__", data)

    # fragment: everything as written (title + style + markup + script)
    frag_dir = os.path.join(ROOT, "_artifact")
    os.makedirs(frag_dir, exist_ok=True)
    frag_path = os.path.join(frag_dir, "pivot-page.html")
    with open(frag_path, "w", encoding="utf-8") as fh:
        fh.write(page)

    # standalone: same fragment inside a minimal skeleton, with <title> and
    # <style> lifted into the head where a browser expects them.
    head_end = page.index("</style>") + len("</style>")
    head, body = page[:head_end], page[head_end:]
    with open(os.path.join(ROOT, "pivot.html"), "w", encoding="utf-8") as fh:
        fh.write(SKELETON % (head, body))

    meta = json.loads(data)["meta"]
    for p in (os.path.join(ROOT, "pivot.html"), frag_path):
        print("%-52s %6.1f MB" % (p, os.path.getsize(p) / 1e6))
    print("%d cells, %s .. %s" % (meta["cells"], meta["months"][0], meta["months"][-1]))


if __name__ == "__main__":
    main()
