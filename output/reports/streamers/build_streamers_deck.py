"""
Streamer programme deck -> ../streamers-deck.pptx

Built on _template/wayzen-template.pptx so the brand cover art, the green header
bar and the logo come from the real Wayzen deck rather than being redrawn.
Figures come from streamers-data.json (All FTDs cohort) -- never typed by hand.

Design rule: the branded header carries the colour. Below it the slides are
type and hairlines only -- no filled cards, no coloured bands. Green marks a
figure worth reading, red marks a negative one, and that is the whole palette.
"""
import json, os, glob
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TPL = os.path.join(ROOT, "_template", "wayzen-template.pptx")
DATA = os.path.join(HERE, "streamers-data.json")
OUT = os.path.join(ROOT, "streamers-deck.pptx")

GREEN = RGBColor(0x11, 0x40, 0x04)
LIME = RGBColor(0x9D, 0xE9, 0x6E)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
INK = RGBColor(0x1A, 0x1A, 0x1A)
MUTED = RGBColor(0x6E, 0x76, 0x6A)
RED = RGBColor(0xA3, 0x2C, 0x1E)
HAIR = RGBColor(0xD3, 0xDC, 0xCE)
GRID = RGBColor(0xE6, 0xEB, 0xE2)   # gridlines: readable on white, not loud
HEAD = "Manrope ExtraBold"
BODY = "Manrope"

d = json.load(open(DATA, encoding="utf-8"))
v = d["variants"]["all"]
T = v["totals"]
S = v["streamers"]
CUTOFF = d["cutoff"]

net = T["adj"] - T["inv"]
cost_ftd = T["inv"] / T["invFtd"]
r7 = 100.0 * T["r7"] / T["r7n"]
r30 = 100.0 * T["r30"] / T["r30n"]
top = sorted(S, key=lambda s: -s["adj"])[:5]
bot = sorted(S, key=lambda s: s["adj"])[:5]


def country_count():
    """Distinct player countries in the cohort.

    Not in streamers-data.json -- it only emits each streamer's top country, so
    counting those would undercount badly. Rebuilt here from the same month
    caches with the same cohort rule, and asserted against the published cohort
    size so the definition cannot drift away from build_streamers.py.
    """
    paths = sorted(p for p in glob.glob(os.path.join(ROOT, "ftd-report", "cache", "*.json"))
                   if os.path.basename(p).startswith(str(d["year"])))
    if not paths:
        return None
    seen = {}
    for p in paths:
        for r in json.load(open(p, encoding="utf-8")):
            if r.get("aff_type") != "Streamer":
                continue
            try:
                if float(r.get("ftd") or 0) <= 0:
                    continue
            except (TypeError, ValueError):
                continue
            pid = r.get("player_id")
            if pid not in seen:
                seen[pid] = r.get("player_country") or "Unknown"
    assert len(seen) == d["cohortPlayers"], (
        "rebuilt cohort is %d players, streamers-data.json says %d"
        % (len(seen), d["cohortPlayers"]))
    return len({c for c in seen.values() if c != "Unknown"})


N_CTRY = country_count()


def money(x, dp=0):
    s = f"${abs(x):,.{dp}f}"
    return "-" + s if x < 0 else s


def k(x):
    return ("-" if x < 0 else "") + f"${abs(x)/1000:,.1f}K"


def m(x):
    return ("-" if x < 0 else "") + f"${abs(x)/1_000_000:,.2f}M"


def km(x):
    """K below a million, M above -- so $1,138.6K never appears."""
    return m(x) if abs(x) >= 1_000_000 else k(x)


def kaxis(x):
    """Chart-tick money: $0, $20K, $97.4K -- never $0.0K or $20.0K."""
    if abs(x) < 1000:
        return f"${x:,.0f}"
    s = f"{abs(x)/1000:,.1f}".removesuffix(".0")
    return ("-" if x < 0 else "") + f"${s}K"


# ---------------------------------------------------------------- primitives
def txt(slide, x, y, w, h, text, size, font=BODY, color=INK,
        align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spc=None, bold=None):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    p = tf.paragraphs[0]
    p.alignment = align
    r = p.add_run()
    r.text = text
    r.font.size = Pt(size)
    r.font.name = font
    r.font.color.rgb = color
    if bold is not None:
        r.font.bold = bold
    if spc:
        r.font._rPr.set("spc", str(int(spc * 100)))
    return tb


def label(slide, x, y, w, text, color=MUTED, size=7.5):
    """Small caps label -- the only 'decoration' the deck uses."""
    return txt(slide, x, y, w, 0.15, text.upper(), size, BODY, color, spc=0.9)


def line(slide, x, y, w, color=HAIR, thick=0.008):
    s = slide.shapes.add_shape(1, Inches(x), Inches(y), Inches(w), Inches(thick))
    s.fill.solid()
    s.fill.fore_color.rgb = color
    s.line.fill.background()
    s.shadow.inherit = False
    return s


def para(tf, text, size, font=BODY, color=INK, before=4, align=PP_ALIGN.LEFT):
    p = tf.add_paragraph()
    p.alignment = align
    p.space_before = Pt(before)
    r = p.add_run()
    r.text = text
    r.font.size = Pt(size)
    r.font.name = font
    r.font.color.rgb = color
    return r


def note_block(slide, x, y, w, title, lines, lead=None):
    """A titled note: hairline, small caps label, optional lead, then lines.

    Replaces the filled callout bands -- same information, no colour block.
    """
    line(slide, x, y, w, GREEN, 0.012)
    label(slide, x, y + 0.10, w, title, GREEN)
    cy = y + 0.30
    if lead:
        tb = txt(slide, x, cy, w, 0.34, lead, 11, HEAD, GREEN)
        tb.text_frame.word_wrap = True
        cy += 0.40
    for ln in lines:
        txt(slide, x, cy, w, 0.20, ln, 9, BODY, INK)
        cy += 0.21
    return cy


# ---------------------------------------------------------------- background
# The template's own content background carries a scattered dot pattern under
# the whole slide. It reads as noise behind tables and charts, so this is the
# same art with the branded bar kept and the body flattened to its own wash.
BG_IMG = os.path.join(ROOT, "_template", "assets", "content-bg-white.jpg")
BAR_H = 0.893  # where the branded green header ends in the background art


def set_content_bg(slide):
    """Apply the template's branded content-slide background.

    The green header bar and the wayzen logo are baked into this image and set
    as a per-slide <p:bg> in the source deck -- they are not on the master or
    any layout, so a slide built on BLANK loses them entirely.
    """
    from pptx.oxml.ns import qn
    from pptx.oxml import parse_xml
    _, rId = slide.part.get_or_add_image_part(BG_IMG)
    bg = parse_xml(
        '<p:bg xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<p:bgPr><a:blipFill rotWithShape="1"><a:blip r:embed="%s"/>'
        '<a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill>'
        '<a:effectLst/></p:bgPr></p:bg>' % rId)
    cSld = slide._element.find(qn("p:cSld"))
    cSld.insert(0, bg)


def heading(slide, title, kicker):
    set_content_bg(slide)
    # title sits inside the green bar, mirroring the template's own slides
    txt(slide, 3.30, 0.27, 6.32, 0.40, title, 17, HEAD, WHITE,
        PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.MIDDLE)
    txt(slide, 0.38, BAR_H + 0.13, 9.24, 0.22, kicker, 9, BODY, MUTED)


# ---------------------------------------------------------------- build
prs = Presentation(TPL)
layouts = {l.name: l for l in prs.slide_masters[0].slide_layouts}

# keep slide 1 (brand cover art), drop the rest of the sample deck
xml_slides = prs.slides._sldIdLst
for sld in list(xml_slides)[1:]:
    rid = sld.get(
        "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
    prs.part.drop_rel(rid)
    xml_slides.remove(sld)

# ---- Slide 1: cover, brand background kept, text replaced
cover = prs.slides[0]
for sh in list(cover.shapes):
    if sh.shape_type != 13:  # keep the background picture only
        sh._element.getparent().remove(sh._element)

txt(cover, 1.05, 1.58, 7.9, 0.9, "Streamer Programme", 40, HEAD, WHITE,
    PP_ALIGN.CENTER)
txt(cover, 1.05, 2.44, 7.9, 0.4, "2026 FTD Cohort  ·  January – August", 15,
    BODY, LIME, PP_ALIGN.CENTER)
line(cover, 4.72, 3.02, 0.56, LIME, 0.018)

stats = [(f"{T['streamers']}", "Streamers"),
         (f"{T['ftd']:,}", "First deposits")]
if N_CTRY:
    stats.append((f"{N_CTRY}", "Countries tested"))
SW = 2.30
sx = (10.0 - SW * len(stats)) / 2
for i, (val, lab) in enumerate(stats):
    cx = sx + i * SW
    txt(cover, cx, 3.30, SW, 0.48, val, 30, HEAD, LIME, PP_ALIGN.CENTER)
    txt(cover, cx, 3.82, SW, 0.24, lab.upper(), 9, BODY, WHITE, PP_ALIGN.CENTER,
        spc=0.6)
    if i:
        line(cover, cx - 0.006, 3.38, 0.012, LIME, 0.52)

txt(cover, 1.05, 4.34, 7.9, 0.3,
    f"{r7:.0f}% retained at D7  ·  {r30:.0f}% at D30  ·  data to {CUTOFF}", 10,
    BODY, WHITE, PP_ALIGN.CENTER)

# ---- Slide 2: scorecard
s2 = prs.slides.add_slide(layouts["BLANK"])
heading(s2, "Scorecard",
        f"All FTDs cohort · players whose first deposit landed in 2026 through a streamer · to {CUTOFF}")

metrics = [
    ("Streamers", f"{T['streamers']:,}", GREEN,
     f"{T['nPos']} in profit · {T['nNeg']} in loss"),
    ("First deposits", f"{T['ftd']:,}", GREEN, f"{T['sq']:,} super qualified"),
    ("Deposits", km(T["dep"]), GREEN, f"{T['depn']:,} deposits"),
    ("Adjusted GGR", km(T["adj"]), RED, "roughly break-even"),
    ("Invested", km(T["inv"]), INK,
     f"{T['nInv']} of {T['streamers']} have a deal"),
    ("Cost per FTD", money(cost_ftd), INK, f"over {T['invFtd']:,} FTDs"),
    ("Net of cost", km(net), RED, "adj GGR less invested"),
    ("Retained D7 / D30", f"{r7:.0f}% / {r30:.0f}%", INK,
     f"{T['r7']:,} of {T['r7n']:,} · {T['r30']:,} of {T['r30n']:,}"),
]
CW, GAP, X0 = 2.16, 0.20, 0.38
for i, (lab, val, col, note) in enumerate(metrics):
    cx = X0 + (i % 4) * (CW + GAP)
    cy = 1.44 + (i // 4) * 1.12
    line(s2, cx, cy, CW, HAIR)
    label(s2, cx, cy + 0.11, CW, lab)
    txt(s2, cx, cy + 0.32, CW, 0.42, val, 25, HEAD, col)
    txt(s2, cx, cy + 0.78, CW, 0.18, note, 7.5, BODY, MUTED)

Vq = d["variants"]["q"]["totals"]
Vsq = d["variants"]["sq"]["totals"]
r7q = 100.0 * Vq["r7"] / Vq["r7n"]
r7sq = 100.0 * Vsq["r7"] / Vsq["r7n"]
tier_r7 = (f"{min(r7q, r7sq):.0f}–{max(r7q, r7sq):.0f}%"
           if round(r7q) != round(r7sq) else f"{r7q:.0f}%")

note_block(
    s2, 0.38, 3.96, 9.24, "Summary",
    [f"Against {km(T['inv'])} invested the programme is {km(net)} net of cost.",
     f"Retention splits hard by tier: {r7:.0f}% at D7 across every FTD, {tier_r7} for "
     f"Qualified and Super Qualified. The {T['nq']:,} Non Qualified first deposits barely return."],
    lead=(f"Adjusted GGR of {km(T['adj'])} is {T['nPos']} streamers making {km(T['adjPos'])} "
          f"against {T['nNeg']} losing {km(T['adjNeg'])}."))

# ---- Slide 3: top and bottom streamers
s3 = prs.slides.add_slide(layouts["BLANK"])
heading(s3, "Top and Bottom Streamers",
        f"Adjusted GGR by streamer, All FTDs cohort · top and bottom five of {T['streamers']}")


def league(slide, x, y, w, title, sub, rows, accent):
    line(slide, x, y, w, GREEN, 0.012)
    label(slide, x, y + 0.10, w * 0.5, title, accent, 9)
    txt(slide, x, y + 0.28, w, 0.16, sub, 7.5, BODY, MUTED)
    ry = y + 0.50
    h = 0.385
    for i, (name, adj, ftd, dep) in enumerate(rows):
        if i:
            line(slide, x, ry, w, HAIR)
        txt(slide, x, ry + 0.07, w * 0.52, 0.17, name, 9.5, BODY, INK)
        txt(slide, x, ry + 0.235, w * 0.52, 0.14,
            f"{ftd:,} FTD{'' if ftd == 1 else 's'} · {money(dep)} deposited",
            7, BODY, MUTED)
        txt(slide, x + w * 0.58, ry + 0.10, w * 0.42, 0.24, money(adj), 12.5,
            HEAD, GREEN if adj > 0 else RED, PP_ALIGN.RIGHT)
        ry += h
    return ry


league(s3, 0.38, 1.40, 4.30, "In profit",
       f"{T['nPos']} streamers · +{money(T['adjPos'])} combined",
       [(s["a"], s["adj"], s["ftd"], s["dep"]) for s in top], GREEN)
league(s3, 5.32, 1.40, 4.30, "In loss",
       f"{T['nNeg']} streamers · {money(T['adjNeg'])} combined",
       [(s["a"], s["adj"], s["ftd"], s["dep"]) for s in bot], RED)

sq_share_ftd = 100.0 * T["sq"] / T["ftd"]
sq_share_dep = 100.0 * Vsq["dep"] / T["dep"]
note_block(
    s3, 0.38, 3.96, 9.24, "Key points",
    [f"{top[0]['a']} alone is {money(top[0]['adj'])} of the {money(T['adjPos'])} upside — "
     f"the top two names carry {100*(top[0]['adj']+top[1]['adj'])/T['adjPos']:.0f}% of the profit.",
     f"Three names carry most of the damage: {bot[0]['a']} {k(bot[0]['adj'])} on "
     f"{bot[0]['ftd']:,} FTD{'' if bot[0]['ftd'] == 1 else 's'}, "
     f"{bot[1]['a']} {k(bot[1]['adj'])}, {bot[2]['a']} {k(bot[2]['adj'])}.",
     f"Super Qualified is {sq_share_ftd:.0f}% of first deposits but {sq_share_dep:.0f}% of "
     "deposited money — raw FTD count gives a different league table."])

txt(s3, 0.38, 5.26, 9.24, 0.2,
    "Source: streamers-data.json · query 1732 month caches + acquisition-report cost sheet · "
    "adjusted GGR is computed upstream, not GGR minus bonus cost",
    6.5, BODY, MUTED)

# ---- Slide 4: monthly trend
NQ_C = RGBColor(0xDD, 0xE4, 0xD8)
Q_C = RGBColor(0x8F, 0xB0, 0x7E)
SQ_C = GREEN

s4 = prs.slides.add_slide(layouts["BLANK"])
heading(s4, "Monthly Trend",
        "Adjusted GGR by month, split by the streamer's full-year result · All FTDs cohort")

MON = {"01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr",
       "05": "May", "06": "Jun", "07": "Jul", "08": "Aug"}
cats = [MON[mm[5:]] for mm in d["months"]]

def nice_step(peak, target=5):
    """A round gridline step that lands ~`target` lines under `peak`."""
    import math
    raw = peak / float(target)
    mag = 10 ** math.floor(math.log10(raw))
    for mult in (1, 2, 2.5, 5, 10):
        if raw <= mag * mult:
            return mag * mult
    return mag * 10


def stacked_bars(slide, x, y, w, h, cats, series, names, colors,
                 gut=0.50, lab_h=0.20, leg_h=0.26, fmt=None, legend=True):
    """Stacked columns drawn with shapes, with the column total above each bar.

    Hand-drawn rather than a native chart because a native stacked chart can
    only label its segments -- the total, which is the number people actually
    read off this chart, has no data label of its own.
    """
    fmt = fmt or (lambda t: f"{t:,.0f}")
    totals = [sum(series[n][i] for n in names) for i in range(len(cats))]
    step = nice_step(max(totals))
    top = -(-max(totals) // step) * step
    px, pw = x + gut, w - gut
    ph = h - lab_h - (leg_h if legend else 0.0)
    base = y + ph

    g = 0
    while g <= top + 1e-9:
        gy = base - ph * (g / top)
        # baseline only -- every bar is labelled, so gridlines add nothing
        if g == 0:
            line(slide, px, gy, pw, HAIR, 0.012)
        txt(slide, x, gy - 0.075, gut - 0.08, 0.15, fmt(g), 7.5, BODY, MUTED,
            PP_ALIGN.RIGHT)
        g += step

    slot = pw / len(cats)
    bw = min(0.34, slot * 0.60)
    for i in range(len(cats)):
        cxm = px + slot * (i + 0.5)
        acc = 0
        for n, c in zip(names, colors):
            val = series[n][i]
            if val > 0:
                seg = slide.shapes.add_shape(
                    1, Inches(cxm - bw / 2), Inches(base - ph * ((acc + val) / top)),
                    Inches(bw), Inches(ph * (val / top)))
                seg.fill.solid()
                seg.fill.fore_color.rgb = c
                seg.line.fill.background()
                seg.shadow.inherit = False
            acc += val
        if totals[i]:
            txt(slide, cxm - slot / 2, base - ph * (totals[i] / top) - 0.20,
                slot, 0.17, fmt(totals[i]), 7.5, HEAD, GREEN, PP_ALIGN.CENTER)
        txt(slide, cxm - slot / 2, base + 0.05, slot, 0.16, cats[i], 7.5,
            BODY, MUTED, PP_ALIGN.CENTER)

    if not legend:
        return
    lx = px
    for n, c in zip(names, colors):
        sw = slide.shapes.add_shape(1, Inches(lx), Inches(base + lab_h + 0.09),
                                    Inches(0.10), Inches(0.10))
        sw.fill.solid()
        sw.fill.fore_color.rgb = c
        sw.line.fill.background()
        sw.shadow.inherit = False
        txt(slide, lx + 0.15, base + lab_h + 0.07, 1.3, 0.15, n, 7.5, BODY, MUTED)
        lx += 0.20 + len(n) * 0.048


# Split each month's adjusted GGR by the streamer's FULL-YEAR result: the part
# earned from streamers who finished 2026 up, and the part from those who
# finished down. Colour is set by the whole year, so the green bar can be
# negative in a month where the year's winners had a bad month (April is one).
# Not in series/ -- rolled up here from the per-streamer-month cells.
year_adj = {s["a"]: s["adj"] for s in v["streamers"]}
midx = {mm: i for i, mm in enumerate(d["months"])}
up = [0.0] * len(cats)
dn = [0.0] * len(cats)
for aff, mm, _f, _sq, _dep, cadj, _ngr in v["cells"]:
    (up if year_adj.get(aff, 0) > 0 else dn)[midx[mm]] += cadj

assert all(abs(up[i] + dn[i] - v["series"]["adj"][i]) < 0.5 for i in range(len(cats))), \
    "the up/down split does not add back to the monthly adjusted GGR"
assert abs(sum(up) - T["adjPos"]) < 1 and abs(sum(dn) - T["adjNeg"]) < 1, \
    "the up/down split does not add back to adjPos/adjNeg"


def split_bars(slide, x, y, w, h, cats, up, dn, gut=0.56, lab_h=0.36, leg_h=0.26):
    """Paired signed columns drawn with shapes.

    Paired rather than stacked because the 'up' side can itself be negative in a
    given month, which a stack cannot show honestly. Drawn with shapes because
    LibreOffice renders negative native columns above the axis, so a real chart
    here could not be visually checked.
    """
    vals = list(up) + list(dn) + [0.0]
    lo, hi = min(vals), max(vals)
    pad = (hi - lo) * 0.12
    lo, hi = lo - pad, hi + pad
    for step in (10000, 20000, 25000, 40000, 50000, 100000):
        if (hi - lo) / step <= 6:
            break
    px, pw = x + gut, w - gut
    ph = h - lab_h - leg_h
    zero = y + ph * (hi / (hi - lo))

    # first multiple at or above lo -- flooring instead would draw a gridline
    # below the plot area, spilling onto whatever sits under the chart
    g = -(-int(lo) // step) * step if lo < 0 else (int(lo) // step) * step
    while g < lo:
        g += step
    while g <= hi:
        gy = y + ph * ((hi - g) / (hi - lo))
        # zero line only; the ruled background competed with the bars
        if g == 0:
            line(slide, px, gy, pw, HAIR, 0.012)
        lab = "$0" if g == 0 else ("-" if g < 0 else "") + f"${abs(g)//1000}K"
        txt(slide, x, gy - 0.075, gut - 0.08, 0.15, lab, 7.5, BODY, MUTED,
            PP_ALIGN.RIGHT)
        g += step

    slot = pw / len(cats)
    bw = min(0.135, slot * 0.30)
    for i in range(len(cats)):
        cxm = px + slot * (i + 0.5)
        for j, (val, col) in enumerate(((up[i], GREEN), (dn[i], RED))):
            if not val:
                continue
            bx = cxm + (j - 0.5) * (bw + 0.035) - bw / 2
            vy = y + ph * ((hi - val) / (hi - lo))
            t, bh = (vy, zero - vy) if val >= 0 else (zero, vy - zero)
            b = slide.shapes.add_shape(1, Inches(bx), Inches(t), Inches(bw),
                                       Inches(max(bh, 0.012)))
            b.fill.solid()
            b.fill.fore_color.rgb = col
            b.line.fill.background()
            b.shadow.inherit = False
        txt(slide, cxm - slot / 2, y + ph + 0.05, slot, 0.16, cats[i], 7.5,
            BODY, MUTED, PP_ALIGN.CENTER)
        netv = up[i] + dn[i]
        txt(slide, cxm - slot / 2, y + ph + 0.20, slot, 0.15, k(netv), 7,
            HEAD, GREEN if netv >= 0 else RED, PP_ALIGN.CENTER)

    lx = px
    for nm, col in (("Streamers up on the year", GREEN),
                    ("Down on the year", RED)):
        sw = slide.shapes.add_shape(1, Inches(lx), Inches(y + ph + lab_h + 0.07),
                                    Inches(0.10), Inches(0.10))
        sw.fill.solid()
        sw.fill.fore_color.rgb = col
        sw.line.fill.background()
        sw.shadow.inherit = False
        txt(slide, lx + 0.15, y + ph + lab_h + 0.05, 2.0, 0.15, nm, 7.5, BODY, MUTED)
        lx += 0.30 + len(nm) * 0.049


split_bars(s4, 0.38, 1.44, 9.24, 2.52, cats, up, dn)
label(s4, 0.38, 1.26, 9.24, "Adjusted GGR by month · net below each month", GREEN)

adj_s = v["series"]["adj"]
ftd_m = [sum(v["series"]["ftd"][t][i] for t in v["series"]["ftd"]) for i in range(len(cats))]
h1, h2 = sum(adj_s[:6]), sum(adj_s[6:])
jul_i = d["months"].index("2026-07")
assert sorted(ftd_m, reverse=True)[0] == ftd_m[jul_i], \
    "July is no longer the largest FTD month — fix the copy"

note_block(
    s4, 0.38, 4.14, 9.24, "Summary",
    [f"July was the largest month for first deposits — {ftd_m[jul_i]:,}, "
     f"{100*ftd_m[jul_i]/T['ftd']:.0f}% of the {T['ftd']:,} total — and the second worst for money.",
     "The two charts are on different clocks: FTDs sit on the month the player was acquired, "
     "money on the month it moved."],
    lead=f"January–June made {km(h1)}; July and August gave back {km(h2)}.")

# ---- Slide 5: FTD by month and type (the numbers behind the left chart)
s45 = prs.slides.add_slide(layouts["BLANK"])
heading(s45, "First Deposits by Month",
        f"Count split by FTD type, and value deposited · month of acquisition · All FTDs cohort · to {CUTOFF}")

TIERS = ["Non Qualified", "Qualified", "Super Qualified"]
ser = v["series"]["ftd"]
col_tot = [sum(ser[t][i] for t in TIERS) for i in range(len(cats))]

assert sum(col_tot) == T["ftd"], "month totals do not add up to the cohort FTD count"
for t in TIERS:
    key = {"Non Qualified": "nq", "Qualified": "q", "Super Qualified": "sq"}[t]
    assert sum(ser[t]) == T[key], f"{t} row does not add up to the published total"


def ftd_value_by_month():
    """First-deposit VALUE per acquisition month.

    streamers-data.json carries ftdv only as a cohort total and the monthly
    series are counts, so the money side of the FTD is rebuilt here from the
    caches -- same cohort rule, value taken from the `ftd` column, which is a
    dollar amount and not a flag. Asserted against the published ftdv.
    """
    paths = sorted(p for p in glob.glob(os.path.join(ROOT, "ftd-report", "cache", "*.json"))
                   if os.path.basename(p).startswith(str(d["year"])))
    if not paths:
        return None
    seen = {}
    for p in paths:
        mm = os.path.basename(p)[:-5]
        for r in json.load(open(p, encoding="utf-8")):
            if r.get("aff_type") != "Streamer":
                continue
            try:
                val = float(r.get("ftd") or 0)
            except (TypeError, ValueError):
                continue
            if val <= 0:
                continue
            pid = r.get("player_id")
            if pid not in seen:
                seen[pid] = (mm, val)
    out = [0.0] * len(cats)
    idx = {mm: i for i, mm in enumerate(d["months"])}
    for mm, val in seen.values():
        out[idx[mm]] += val
    assert len(seen) == T["ftd"], "rebuilt FTD count does not match the cohort"
    assert abs(sum(out) - T["ftdv"]) < 1, (
        "rebuilt FTD value %.2f does not match published ftdv %.2f"
        % (sum(out), T["ftdv"]))
    return out


ftd_amt = ftd_value_by_month()

stacked_bars(s45, 0.38, 1.44, 4.44, 2.44, cats, ser, TIERS, [NQ_C, Q_C, SQ_C])
label(s45, 0.38, 1.26, 4.44, "FTD count by type", GREEN)

stacked_bars(s45, 5.18, 1.44, 4.44, 2.44, cats, {"FTD value": ftd_amt},
             ["FTD value"], [GREEN], fmt=kaxis, legend=False)
label(s45, 5.18, 1.26, 4.44, "FTD value deposited", GREEN)

peak = col_tot.index(max(col_tot))
peak_amt = ftd_amt.index(max(ftd_amt))
avg_early = sum(ftd_amt[:4]) / max(sum(col_tot[:4]), 1)
avg_late = sum(ftd_amt[4:]) / max(sum(col_tot[4:]), 1)

note_block(
    s45, 0.38, 4.14, 9.24, "Summary",
    [f"Non Qualified is {100*T['nq']/T['ftd']:.0f}% of every first deposit "
     f"({T['nq']:,} of {T['ftd']:,}); only {T['sq']:,} cleared Super Qualified.",
     f"Average first deposit rose from {money(avg_early)} in Jan–Apr to "
     f"{money(avg_late)} in May–Aug — the count and the money are not moving together."],
    lead=(f"{cats[peak]} brought the most first deposits ({col_tot[peak]:,}); "
          f"{cats[peak_amt]} brought the most money ({k(ftd_amt[peak_amt])} of "
          f"{k(T['ftdv'])})."))

# ---- Slide 6: cohort comparison
s5 = prs.slides.add_slide(layouts["BLANK"])
heading(s5, "Cohort Comparison",
        "The same programme read three ways · separate cohorts, each recomputed — not filters over one")

V = {kk: d["variants"][kk]["totals"] for kk in ("all", "q", "sq")}
cols = [("All FTDs", "all"), ("Qualified +", "q"), ("Super Qualified", "sq")]
rows = [
    ("Streamers", lambda t: f"{t['streamers']:,}"),
    ("First deposits", lambda t: f"{t['ftd']:,}"),
    ("Deposits", lambda t: km(t["dep"])),
    ("Adjusted GGR", lambda t: km(t["adj"])),
    ("Invested", lambda t: km(t["inv"])),
    ("Cost per FTD", lambda t: money(t["inv"] / t["invFtd"])),
    ("Retained D7", lambda t: f"{100*t['r7']/t['r7n']:.0f}%"),
    ("Retained D30", lambda t: f"{100*t['r30']/t['r30n']:.0f}%"),
]

LX, LW, CW5, GAP5 = 0.38, 1.90, 2.42, 0.10
TOPY, HDRH, ROWH = 1.34, 0.32, 0.295
TABW = LW + 3 * CW5 + 2 * GAP5

for j, (title, key) in enumerate(cols):
    cx = LX + LW + j * (CW5 + GAP5)
    label(s5, cx, TOPY + 0.08, CW5, title, GREEN if key == "sq" else MUTED, 8.5)
    # centre the caps label over its column
    s5.shapes[-1].text_frame.paragraphs[0].alignment = PP_ALIGN.CENTER
line(s5, LX, TOPY + HDRH, TABW, GREEN, 0.012)

for i, (lab, fn) in enumerate(rows):
    ry = TOPY + HDRH + i * ROWH
    if i:
        line(s5, LX, ry, TABW, HAIR)
    txt(s5, LX, ry + 0.075, LW, 0.2, lab, 9, BODY, MUTED)
    for j, (_, key) in enumerate(cols):
        cx = LX + LW + j * (CW5 + GAP5)
        val = fn(V[key])
        col = RED if val.startswith("-") else (GREEN if key == "sq" else INK)
        txt(s5, cx, ry + 0.06, CW5, 0.22, val, 10.5, HEAD, col, PP_ALIGN.CENTER)

endy = TOPY + HDRH + len(rows) * ROWH
line(s5, LX, endy, TABW, GREEN, 0.012)

note_block(
    s5, LX, endy + 0.26, 9.24, "Summary",
    [f"{V['sq']['ftd']:,} Super Qualified players — {sq_share_ftd:.0f}% of the "
     f"{V['all']['ftd']:,} first deposits — carry {km(V['sq']['dep'])} of the "
     f"{km(V['all']['dep'])} deposited, {sq_share_dep:.0f}% of the money.",
     f"Cost per FTD rises from {money(cost_ftd)} to "
     f"{money(V['sq']['inv']/V['sq']['invFtd'])} as you climb the tiers. "
     f"The {V['all']['nq']:,} Non Qualified first deposits barely come back at all."],
    lead=(f"Retention: {r7:.0f}% at D7 across every first deposit, {tier_r7} for "
          "Qualified and above."))

prs.save(OUT)
print("wrote", OUT, "slides:", len(prs.slides._sldIdLst))
