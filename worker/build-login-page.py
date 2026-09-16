#!/usr/bin/env python3
"""
build-login-page.py — regenerates the login page inside worker.js.

    python build-login-page.py path/to/wayzen-logo.png

The Wayzen wordmark is inlined into worker.js as a base64 data URI. That is
deliberate: the login page has to render for someone who is NOT yet signed in,
and every static file on this Worker sits behind the session check. A <img
src="/logo.png"> would 302 to the login page and show a broken image. Inlining
sidesteps the ordering problem entirely and costs one round trip less.

This script exists so the logo can be swapped without hand-editing a 12 KB
string: point it at a new PNG and it rewrites the LOGO constant in place. The
source image may have any flat background; the colour of its corner pixel is
taken as the background and turned transparent, with antialiased edges kept as
partial alpha so the mark does not look cut out against the white card.
"""

import base64
import io
import pathlib
import re
import sys

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
WORKER = HERE / "worker.js"

FG = (33, 57, 22)          # Wayzen dark green, #213916
MAX_WIDTH = 640            # plenty for a mark displayed at ~190 px


def trace(path):
    im = Image.open(path).convert("RGB")
    px = im.load()
    w, h = im.size
    bg = px[0, 0]

    def is_mark(c):
        return sum(abs(a - b) for a, b in zip(c, bg)) > 90

    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            if is_mark(px[x, y]):
                xs.append(x)
                ys.append(y)
    if not xs:
        sys.exit("  Found no mark in that image — is it a flat colour?")

    crop = im.crop((min(xs), min(ys), max(xs) + 1, max(ys) + 1))
    out = Image.new("RGBA", crop.size)
    cp, op = crop.load(), out.load()
    span = sum(abs(a - b) for a, b in zip(FG, bg)) or 1

    for y in range(crop.size[1]):
        for x in range(crop.size[0]):
            c = cp[x, y]
            alpha = round(255 * sum(abs(a - b) for a, b in zip(c, bg)) / span)
            op[x, y] = (*FG, max(0, min(255, alpha)))

    out.thumbnail((MAX_WIDTH, MAX_WIDTH), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, "PNG", optimize=True)
    return out.size, buf.getvalue()


def main():
    if len(sys.argv) < 2:
        sys.exit(f"  usage: python {pathlib.Path(__file__).name} <logo.png>")

    size, png = trace(sys.argv[1])
    uri = "data:image/png;base64," + base64.b64encode(png).decode()

    src = WORKER.read_text(encoding="utf-8")
    new, n = re.subn(r'(?<=const LOGO = ")[^"]*(?=";)', uri, src, count=1)
    if n != 1:
        sys.exit('  Could not find `const LOGO = "..."` in worker.js.')

    WORKER.write_text(new, encoding="utf-8")
    print(f"  {size[0]}x{size[1]}, {len(png):,} bytes inlined into worker.js")
    print("  Run:  node test-login.mjs   then   6-publish.bat")


if __name__ == "__main__":
    main()
