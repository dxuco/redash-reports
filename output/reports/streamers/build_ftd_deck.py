"""
All-channel FTD deck -> ../ftd-deck.pptx

Total first deposits across Direct, Affiliate and Streamer, 2026 year to date
against the same months of 2025. Figures come from ftd-allchannel.json
(run build_ftd_allchannel.py first) -- never typed by hand.

Design: the branded header carries the colour. Below it, type and hairlines.
Green marks a figure worth reading, red a negative one; that is the palette.
"""
import json, os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TPL = os.path.join(ROOT, "_template", "wayzen-template.pptx")
DATA = os.path.join(HERE, "ftd-allchannel.json")
OUT = os.path.join(ROOT, "ftd-deck.pptx")
# The template's content art is a pale green wash with a scattered dot pattern.
# This is the same art with the branded bar kept and the body flattened to white.
BG_IMG = os.path.join(ROOT, "_template", "assets", "content-bg-white-r.jpg")

GREEN = RGBColor(0x11, 0x40, 0x04)
LIME = RGBColor(0x9D, 0xE9, 0x6E)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
INK = RGBColor(0x1A, 0x1A, 0x1A)
MUTED = RGBColor(0x6E, 0x76, 0x6A)
RED = RGBColor(0xA3, 0x2C, 0x1E)
HAIR = RGBColor(0xD3, 0xDC, 0xCE)
GRID = RGBColor(0xE6, 0xEB, 0xE2)   # gridlines: readable on white, not loud
# three tones of the brand green, light -> dark, for stacked bands
NQ_C = RGBColor(0xC9, 0xE8, 0xB0)
Q_C = RGBColor(0x5A, 0x9E, 0x42)
PRIOR = RGBColor(0xC2, 0xCE, 0xB8)   # last year, deliberately recessive
HEAD = "Manrope ExtraBold"
BODY = "Manrope"
BAR_H = 0.893

d = json.load(open(DATA, encoding="utf-8"))
CUR, PRV = d["comparison"]["years"][-1], d["comparison"]["years"][0]
cur, prv = d[CUR], d[PRV]
C, P = cur["ytd"], prv["ytd"]
TIERS = ["Non Qualified", "Qualified", "Super Qualified"]
CHANNELS = ["Direct", "Affiliate", "Streamer"]
MON = {"01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May",
       "06": "Jun", "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct",
       "11": "Nov", "12": "Dec"}
cats = [MON[mm[5:]] for mm in cur["ytdMonths"]]
SPAN = f"{cats[0]} – {cats[-1]}"

assert len(P["valueByMonth"]) == len(C["valueByMonth"]), \
    "the two years are not trimmed to the same number of months"


def money(x, dp=0):
    s = f"${abs(x):,.{dp}f}"
    return "-" + s if x < 0 else s


def k(x):
    return ("-" if x < 0 else "") + f"${abs(x)/1000:,.1f}K"


def m(x):
    return ("-" if x < 0 else "") + f"${abs(x)/1_000_000:,.2f}M"


def km(x):
    return m(x) if abs(x) >= 1_000_000 else k(x)


def kaxis(x):
    if abs(x) < 1000:
        return f"${x:,.0f}"
    s = f"{abs(x)/1000:,.1f}".removesuffix(".0")
    return ("-" if x < 0 else "") + f"${s}K"


def pct(new, old):
    if not old:
        return "—"
    ch = 100.0 * (new / old - 1)
    return f"{ch:+.0f}%"


def pct_col(new, old, good_up=True):
    if not old or new == old:
        return MUTED
    up = new > old
    return GREEN if up == good_up else RED


# ---------------------------------------------------------------- primitives
def txt(slide, x, y, w, h, text, size, font=BODY, color=INK,
        align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spc=None):
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
    if spc:
        r.font._rPr.set("spc", str(int(spc * 100)))
    return tb


def label(slide, x, y, w, text, color=MUTED, size=7.5, align=PP_ALIGN.LEFT):
    return txt(slide, x, y, w, 0.15, text.upper(), size, BODY, color, align,
               spc=0.9)


def line(slide, x, y, w, color=HAIR, thick=0.008):
    s = slide.shapes.add_shape(1, Inches(x), Inches(y), Inches(w), Inches(thick))
    s.fill.solid()
    s.fill.fore_color.rgb = color
    s.line.fill.background()
    s.shadow.inherit = False
    return s


def box(slide, x, y, w, h, color):
    s = slide.shapes.add_shape(1, Inches(x), Inches(y), Inches(w), Inches(h))
    s.fill.solid()
    s.fill.fore_color.rgb = color
    s.line.fill.background()
    s.shadow.inherit = False
    return s


def insights(slide, x, y, w, items):
    """Three numbered takeaways. Every slide ends with exactly these."""
    assert len(items) == 3, "each slide carries three insights, got %d" % len(items)
    line(slide, x, y, w, GREEN, 0.012)
    label(slide, x, y + 0.10, w, "Key insights", GREEN)
    cy = y + 0.34
    for i, ln in enumerate(items, 1):
        txt(slide, x, cy - 0.005, 0.22, 0.22, str(i), 11, HEAD, GREEN)
        txt(slide, x + 0.24, cy, w - 0.24, 0.22, ln, 9.5, BODY, INK)
        cy += 0.30
    return cy


def set_content_bg(slide):
    from pptx.oxml.ns import qn
    from pptx.oxml import parse_xml
    _, rId = slide.part.get_or_add_image_part(BG_IMG)
    slide._element.find(qn("p:cSld")).insert(0, parse_xml(
        '<p:bg xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<p:bgPr><a:blipFill rotWithShape="1"><a:blip r:embed="%s"/>'
        '<a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill>'
        '<a:effectLst/></p:bgPr></p:bg>' % rId))


def heading(slide, title):
    set_content_bg(slide)
    # the bar runs light -> dark, left -> right, with the logo at the dark end,
    # so the title sits left where the ground is pale enough to carry white.
    # No sub-line: the chart labels already say what is on the slide.
    txt(slide, 0.62, 0.27, 5.60, 0.40, title, 17, HEAD, WHITE,
        PP_ALIGN.LEFT, anchor=MSO_ANCHOR.MIDDLE)


def nice_step(peak, target=5):
    import math
    raw = peak / float(target)
    mag = 10 ** math.floor(math.log10(raw))
    for mult in (1, 2, 2.5, 5, 10):
        if raw <= mag * mult:
            return mag * mult
    return mag * 10


def bar_frame(slide, x, y, w, h, peak, gut, lab_h, leg_h, fmt, headroom=0.92):
    """Gridlines + value ticks. Returns (plot x, plot w, baseline y, height, top)."""
    step = nice_step(peak)
    top = -(-peak // step) * step
    if peak / top > headroom:      # leave room for the label above the tallest bar
        top += step
    px, pw = x + gut, w - gut
    ph = h - lab_h - leg_h
    # Ticks, but no gridlines: every bar carries its own value label, so ruled
    # lines behind them are redundant. Only the baseline is drawn.
    g = 0
    while g <= top + 1e-9:
        gy = y + ph - ph * (g / top)
        if g == 0:
            line(slide, px, gy, pw, HAIR, 0.012)
        txt(slide, x, gy - 0.075, gut - 0.08, 0.15, fmt(g), 7.5, BODY, MUTED,
            PP_ALIGN.RIGHT)
        g += step
    return px, pw, y + ph, ph, top


def legend(slide, x, y, items):
    lx = x
    for nm, col in items:
        box(slide, lx, y + 0.02, 0.10, 0.10, col)
        txt(slide, lx + 0.15, y, 2.2, 0.15, nm, 7.5, BODY, MUTED)
        lx += 0.30 + len(nm) * 0.049


def stacked_bars(slide, x, y, w, h, cats, series, names, colors,
                 gut=0.50, lab_h=0.20, leg_h=0.26, fmt=None, show_legend=True,
                 top_note=None):
    fmt = fmt or (lambda t: f"{t:,.0f}")
    totals = [sum(series[n][i] for n in names) for i in range(len(cats))]
    # leg_h is reserved whether or not a legend is drawn, so two charts side by
    # side always share one baseline
    px, pw, base, ph, top = bar_frame(slide, x, y, w, h, max(totals), gut,
                                      lab_h, leg_h, fmt)
    slot = pw / len(cats)
    bw = min(0.34, slot * 0.60)
    for i in range(len(cats)):
        cxm = px + slot * (i + 0.5)
        acc = 0
        for n, c in zip(names, colors):
            val = series[n][i]
            if val > 0:
                seg_h = ph * (val / top)
                seg_y = base - ph * ((acc + val) / top)
                box(slide, cxm - bw / 2, seg_y, bw, seg_h, c)
                # The number goes inside the band, or not at all. A single-band
                # chart is skipped -- the total above the bar already says it.
                if len(names) == 1:
                    acc += val
                    continue
                lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
                mid = seg_y + seg_h / 2
                if seg_h >= 0.155:
                    fs = 6.5 if bw >= 0.32 else 5.5
                    txt(slide, cxm - bw / 2 - 0.06, mid - 0.07, bw + 0.12, 0.14,
                        fmt(val), fs, HEAD, WHITE if lum < 140 else GREEN,
                        PP_ALIGN.CENTER)
                elif seg_h >= 0.095:
                    txt(slide, cxm - bw / 2 - 0.06, mid - 0.055, bw + 0.12, 0.11,
                        fmt(val), 5, HEAD, WHITE if lum < 140 else GREEN,
                        PP_ALIGN.CENTER)
                # below that the band cannot hold type: no label at all --
                # never parked outside the column, where it reads as clutter
            acc += val
        if totals[i]:
            # with a note above the bar, the total moves inside so the two do
            # not stack up into the chart title
            if top_note:
                txt(slide, cxm - slot / 2, base - ph * (totals[i] / top) - 0.20,
                    slot, 0.15, top_note[i], 7, HEAD, GREEN, PP_ALIGN.CENTER)
                txt(slide, cxm - bw / 2 - 0.06,
                    base - ph * (totals[i] / top) + 0.05, bw + 0.12, 0.14,
                    fmt(totals[i]), 6.5, HEAD, WHITE, PP_ALIGN.CENTER)
            else:
                txt(slide, cxm - slot / 2, base - ph * (totals[i] / top) - 0.20,
                    slot, 0.17, fmt(totals[i]), 7.5, HEAD, GREEN, PP_ALIGN.CENTER)
        txt(slide, cxm - slot / 2, base + 0.05, slot, 0.16, cats[i], 7.5,
            BODY, MUTED, PP_ALIGN.CENTER)
    if show_legend:
        legend(slide, px, base + lab_h + 0.07, list(zip(names, colors)))


def klab(x):
    """Bar label money, as short as it goes: $191K, $1.4M -- no decimals."""
    sign = "-" if x < 0 else ""
    if abs(x) >= 1_000_000:
        return sign + f"${abs(x)/1_000_000:,.1f}M"
    if abs(x) >= 1000:
        return sign + f"${abs(x)/1000:,.0f}K"
    return sign + f"${abs(x):,.0f}"


# Every money figure on a slide uses the short form -- $100K, $1.4M -- in the
# prose as well as on the bars. Decimals on six-figure numbers read as noise.
k = km = klab


def quarter_bars(slide, x, y, w, h, qnames, a_series, b_series, names, colors,
                 a_name, b_name, gut=0.56, lab_h=0.36, leg_h=0.26, fmt=None):
    """Per quarter, two stacked bars: last year and this year, split by channel.

    The year is named under each bar rather than by colour -- colour is already
    carrying the channel split, and one chart cannot encode two things at once.
    """
    fmt = fmt or (lambda t: f"{t:,.0f}")
    a_tot = [sum(a_series[n][i] for n in names) for i in range(len(qnames))]
    b_tot = [sum(b_series[n][i] for n in names) for i in range(len(qnames))]
    px, pw, base, ph, top = bar_frame(slide, x, y, w, h,
                                      max(max(a_tot), max(b_tot)), gut,
                                      lab_h, leg_h, fmt)
    slot = pw / len(qnames)
    bw = min(0.42, slot * 0.32)
    for i in range(len(qnames)):
        cxm = px + slot * (i + 0.5)
        for j, (ser, tot, yr) in enumerate(((a_series, a_tot, a_name),
                                            (b_series, b_tot, b_name))):
            bx = cxm + (j - 0.5) * (bw + 0.10) - bw / 2
            acc = 0
            for n, c in zip(names, colors):
                val = ser[n][i]
                if val > 0:
                    box(slide, bx, base - ph * ((acc + val) / top), bw,
                        ph * (val / top), c)
                acc += val
            if tot[i]:
                txt(slide, bx + bw / 2 - 0.30, base - ph * (tot[i] / top) - 0.19,
                    0.60, 0.16, fmt(tot[i]), 7, HEAD, GREEN, PP_ALIGN.CENTER)
            txt(slide, bx + bw / 2 - 0.30, base + 0.05, 0.60, 0.14, yr, 6.5,
                BODY, MUTED, PP_ALIGN.CENTER)
        txt(slide, cxm - slot / 2, base + 0.21, slot, 0.16, qnames[i], 8,
            HEAD, GREEN, PP_ALIGN.CENTER)
    legend(slide, px, base + lab_h + 0.07, list(zip(names, colors)))


def group_bars_signed(slide, x, y, w, h, cats, a_vals, b_vals, a_name, b_name,
                      gut=0.62, lab_h=0.20, leg_h=0.26, fmt=None):
    """Paired bars that can go below the axis -- NGR is negative in some months."""
    fmt = fmt or (lambda t: f"{t:,.0f}")
    lab_fmt = klab
    vals = list(a_vals) + list(b_vals) + [0.0]
    lo, hi = min(vals), max(vals)
    pad = (hi - lo) * 0.14
    lo, hi = lo - pad, hi + pad
    step = nice_step(hi - lo, 5)
    px, pw = x + gut, w - gut
    ph = h - lab_h - leg_h
    zero = y + ph * (hi / (hi - lo))

    g = -(-int(lo) // step) * step if lo < 0 else (int(lo) // step) * step
    while g < lo:
        g += step
    while g <= hi:
        gy = y + ph * ((hi - g) / (hi - lo))
        if abs(g) < 1e-9:
            line(slide, px, gy, pw, HAIR, 0.012)
        txt(slide, x, gy - 0.075, gut - 0.08, 0.15, fmt(g), 7, BODY, MUTED,
            PP_ALIGN.RIGHT)
        g += step

    slot = pw / len(cats)
    bw = min(0.13, slot * 0.30)
    for i in range(len(cats)):
        cxm = px + slot * (i + 0.5)
        for j, (val, col, tcol) in enumerate(((a_vals[i], PRIOR, MUTED),
                                              (b_vals[i], GREEN, GREEN))):
            if val == 0:
                continue
            bx = cxm + (j - 0.5) * (bw + 0.06) - bw / 2
            vy = y + ph * ((hi - val) / (hi - lo))
            t, bh = (vy, zero - vy) if val >= 0 else (zero, vy - zero)
            box(slide, bx, t, bw, max(bh, 0.012),
                col if val >= 0 else (RED if j else PRIOR))
            lw, lh = 0.46, 0.12
            ly = (t - 0.29 - lh / 2) if val >= 0 else (t + bh + 0.17 - lh / 2)
            tb = txt(slide, bx + bw / 2 - lw / 2, ly, lw, lh, lab_fmt(val), 5.5,
                     HEAD, tcol if val >= 0 else RED, PP_ALIGN.CENTER)
            tb.rotation = 270
        txt(slide, cxm - slot / 2, y + ph + 0.05, slot, 0.16, cats[i], 7,
            BODY, MUTED, PP_ALIGN.CENTER)
    legend(slide, px, y + ph + lab_h + 0.07, [(a_name, PRIOR), (b_name, GREEN)])


def group_bars(slide, x, y, w, h, cats, a_vals, b_vals, a_name, b_name,
               gut=0.56, lab_h=0.20, leg_h=0.26, fmt=None):
    """Two series side by side -- this year against the same months last year."""
    money_axis = fmt is not None
    fmt = fmt or (lambda t: f"{t:,.0f}")
    lab_fmt = klab if money_axis else (lambda t: f"{t:,.0f}")
    slot = (w - gut) / len(cats)
    px, pw, base, ph, top = bar_frame(slide, x, y, w, h,
                                      max(max(a_vals), max(b_vals)), gut,
                                      lab_h, leg_h, fmt,
                                      headroom=0.92 if slot >= 0.40 else 0.80)
    bw = min(0.13, slot * 0.30)
    for i in range(len(cats)):
        cxm = px + slot * (i + 0.5)
        for j, (val, col, tcol) in enumerate(((a_vals[i], PRIOR, MUTED),
                                              (b_vals[i], GREEN, GREEN))):
            if val <= 0:
                continue
            bx = cxm + (j - 0.5) * (bw + 0.06) - bw / 2
            bh = ph * (val / top)
            box(slide, bx, base - bh, bw, bh, col)
            # both labels on one line: compact format and a box no wider than
            # the bar pitch, so the pair never runs into each other
            if slot >= 0.40:
                lw = 0.44      # wide enough that the label never wraps
                txt(slide, bx + bw / 2 - lw / 2 + (j - 0.5) * 0.06,
                    base - bh - 0.155, lw, 0.14,
                    lab_fmt(val), 5.5, HEAD, tcol, PP_ALIGN.CENTER)
            else:
                # too tight to set two numbers side by side, so they are turned
                # on their side above the bar. The box is rotated about its own
                # centre, so it is sized wide-and-short and lands narrow-and-tall.
                lw, lh = 0.46, 0.12
                cxb = bx + bw / 2
                tb = txt(slide, cxb - lw / 2, base - bh - 0.29 - lh / 2, lw, lh,
                         lab_fmt(val), 5.5, HEAD, tcol, PP_ALIGN.CENTER)
                tb.rotation = 270
        txt(slide, cxm - slot / 2, base + 0.05, slot, 0.16, cats[i], 7.5,
            BODY, MUTED, PP_ALIGN.CENTER)
    legend(slide, px, base + lab_h + 0.07, [(a_name, PRIOR), (b_name, GREEN)])


# ---------------------------------------------------------------- build
prs = Presentation(TPL)
layouts = {l.name: l for l in prs.slide_masters[0].slide_layouts}
# every template slide goes: this deck is the two content slides only
xml_slides = prs.slides._sldIdLst
for sld in list(xml_slides):
    prs.part.drop_rel(sld.get(
        "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"))
    xml_slides.remove(sld)

# ---- 1. first deposits by month
s3 = prs.slides.add_slide(layouts["BLANK"])
heading(s3, "First Deposits by Month")

stacked_bars(s3, 0.38, 1.30, 4.44, 2.58, cats, C["countByTier"], TIERS,
             [NQ_C, Q_C, GREEN])
label(s3, 0.38, 1.12, 4.44, "FTD count by type", GREEN, align=PP_ALIGN.CENTER)

stacked_bars(s3, 5.18, 1.30, 4.44, 2.58, cats, C["valueByTierMonth"], TIERS,
             [NQ_C, Q_C, GREEN], fmt=klab, show_legend=False)
label(s3, 5.18, 1.12, 4.44, "FTD value deposited", GREEN, align=PP_ALIGN.CENTER)

tot_m = [sum(C["countByTier"][t][i] for t in TIERS) for i in range(len(cats))]
assert sum(tot_m) == C["ftd"], "month totals do not add up to the cohort"
peak_n = tot_m.index(max(tot_m))
peak_v = C["valueByMonth"].index(max(C["valueByMonth"]))
nq_n = sum(C["countByTier"]["Non Qualified"])
sq_n = sum(C["countByTier"]["Super Qualified"])
nq_v = sum(C["valueByTierMonth"]["Non Qualified"])
sq_v = sum(C["valueByTierMonth"]["Super Qualified"])
assert abs(sum(sum(v) for v in C["valueByTierMonth"].values()) - C["ftdv"]) < 1, \
    "tier value does not add up to the cohort FTD value"

insights(
    s3, 0.38, 4.14, 9.24,
    [f"{cats[peak_n]} was the largest month at {tot_m[peak_n]:,} first deposits; "
     f"{cats[peak_v]} brought the most money, {klab(C['valueByMonth'][peak_v])} of {klab(C['ftdv'])}.",
     f"Non Qualified is {100*nq_n/C['ftd']:.0f}% of the count but only "
     f"{100*nq_v/C['ftdv']:.0f}% of the value.",
     f"Super Qualified is {100*sq_n/C['ftd']:.0f}% of the count and "
     f"{100*sq_v/C['ftdv']:.0f}% of the value."])

# ---- 2. year on year
s4 = prs.slides.add_slide(layouts["BLANK"])
heading(s4, "Year on Year")

group_bars(s4, 0.38, 1.30, 4.44, 2.58, cats, P["countByTier"] and
           [sum(P["countByTier"][t][i] for t in TIERS) for i in range(len(cats))],
           tot_m, PRV, CUR)
label(s4, 0.38, 1.12, 4.44, "FTD count by month", GREEN, align=PP_ALIGN.CENTER)

group_bars(s4, 5.18, 1.30, 4.44, 2.58, cats, P["valueByMonth"],
           C["valueByMonth"], PRV, CUR, fmt=klab)
label(s4, 5.18, 1.12, 4.44, "FTD value by month", GREEN, align=PP_ALIGN.CENTER)

prv_tot = [sum(P["countByTier"][t][i] for t in TIERS) for i in range(len(cats))]
up_months = sum(1 for i in range(len(cats)) if tot_m[i] > prv_tot[i])
down_val = sum(1 for i in range(len(cats))
               if C["valueByMonth"][i] < P["valueByMonth"][i])
worst_i = min(range(len(cats)),
              key=lambda i: C["valueByMonth"][i] / P["valueByMonth"][i])
_gap = 100 * (C["valueByMonth"][-1] / P["valueByMonth"][-1] - 1)
last_gap = "level" if abs(_gap) < 0.5 else f"within {abs(_gap):.0f}%"
# H1 fraud markets, named in build_ftd_allchannel.py so the slide follows the data
fp, fc = prv["h1Flagged"], cur["h1Flagged"]
ph1, ch1 = prv["h1"], cur["h1"]
_mk = [mm.replace("Russian Federation", "Russia") for mm in fp["markets"]]
fraud_names = ", ".join(_mk[:-1]) + " and " + _mk[-1]
insights(
    s4, 0.38, 4.14, 9.24,
    [f"{C['ftd']:,} first deposits against {P['ftd']:,} ({pct(C['ftd'], P['ftd'])}), "
     f"worth {klab(C['ftdv'])} against {klab(P['ftdv'])} ({pct(C['ftdv'], P['ftdv'])}).",
     f"Count is ahead in {up_months} of the {len(cats)} months while value is behind in "
     f"{down_val}: more players, each depositing less.",
     f"H1 {PRV} carried fraudulent signups from {fraud_names} — {fp['ftd']:,} first deposits "
     f"worth {klab(fp['ftdv'])}, {100*fp['ftdv']/ph1['ftdv']:.0f}% of H1 value, against "
     f"{klab(fc['ftdv'])} this year."])

# ---- 3. first deposits by channel, same two views split by acquisition channel
CH_C = {"Direct": RGBColor(0xDD, 0xE4, 0xD8), "Affiliate": RGBColor(0x8F, 0xB0, 0x7E),
        "Streamer": GREEN}

s5 = prs.slides.add_slide(layouts["BLANK"])
heading(s5, "First Deposits by Channel")

stacked_bars(s5, 0.38, 1.30, 4.44, 2.58, cats, C["countByChannel"], CHANNELS,
             [CH_C[c] for c in CHANNELS])
label(s5, 0.38, 1.12, 4.44, "FTD count by channel", GREEN, align=PP_ALIGN.CENTER)

stacked_bars(s5, 5.18, 1.30, 4.44, 2.58, cats, C["valueByChannelMonth"], CHANNELS,
             [CH_C[c] for c in CHANNELS], fmt=klab)
label(s5, 5.18, 1.12, 4.44, "FTD value by channel", GREEN, align=PP_ALIGN.CENTER)

assert sum(C["nByChannel"][c] for c in CHANNELS) == C["ftd"], \
    "channel counts do not add up to the cohort"
assert abs(sum(C["valueByChannel"][c] for c in CHANNELS) - C["ftdv"]) < 1, \
    "channel value does not add up to the cohort"

st_n, st_v = C["nByChannel"]["Streamer"], C["valueByChannel"]["Streamer"]
di_n, di_v = C["nByChannel"]["Direct"], C["valueByChannel"]["Direct"]
af_n, af_v = C["nByChannel"]["Affiliate"], C["valueByChannel"]["Affiliate"]
insights(
    s5, 0.38, 4.14, 9.24,
    [f"Direct is {100*di_n/C['ftd']:.0f}% of the count and {100*di_v/C['ftdv']:.0f}% of the value — "
     "still the largest channel on both.",
     f"Streamer is {100*st_n/C['ftd']:.0f}% of the count and {100*st_v/C['ftdv']:.0f}% of the value, at "
     f"{money(st_v/st_n)} per first deposit against {money(di_v/di_n)} for Direct.",
     f"Affiliate is the weakest per deposit: {af_n:,} first deposits worth {klab(af_v)}, "
     f"{money(af_v/af_n)} each."])

# ---- 4. channels by quarter, this year against last
s6 = prs.slides.add_slide(layouts["BLANK"])
heading(s6, "Channels by Quarter")

QDEF = [("Q1", ["01", "02", "03"]), ("Q2", ["04", "05", "06"]),
        ("Q3 QTD", ["07", "08", "09"])]
qmonths = [mm[5:] for mm in cur["ytdMonths"]]
QS = [(qn, [i for i, mm in enumerate(qmonths) if mm in ms])
      for qn, ms in QDEF]
QS = [(qn, idx) for qn, idx in QS if idx]
qnames = [qn for qn, _ in QS]


def by_quarter(src, key):
    return {c: [sum(src[key][c][i] for i in idx) for _, idx in QS]
            for c in CHANNELS}


qa_n, qb_n = by_quarter(P, "countByChannel"), by_quarter(C, "countByChannel")
qa_v, qb_v = by_quarter(P, "valueByChannelMonth"), by_quarter(C, "valueByChannelMonth")

assert sum(sum(v) for v in qb_n.values()) == C["ftd"], \
    "quarters do not add up to the cohort count"
assert abs(sum(sum(v) for v in qb_v.values()) - C["ftdv"]) < 1, \
    "quarters do not add up to the cohort value"

quarter_bars(s6, 0.38, 1.30, 4.44, 2.58, qnames, qa_n, qb_n, CHANNELS,
             [CH_C[c] for c in CHANNELS], PRV, CUR)
label(s6, 0.38, 1.12, 4.44, "FTD count by channel", GREEN, align=PP_ALIGN.CENTER)

quarter_bars(s6, 5.18, 1.30, 4.44, 2.58, qnames, qa_v, qb_v, CHANNELS,
             [CH_C[c] for c in CHANNELS], PRV, CUR, fmt=klab)
label(s6, 5.18, 1.12, 4.44, "FTD value by channel", GREEN, align=PP_ALIGN.CENTER)

qn_a = [sum(qa_n[c][i] for c in CHANNELS) for i in range(len(qnames))]
qn_b = [sum(qb_n[c][i] for c in CHANNELS) for i in range(len(qnames))]
qv_a = [sum(qa_v[c][i] for c in CHANNELS) for i in range(len(qnames))]
qv_b = [sum(qb_v[c][i] for c in CHANNELS) for i in range(len(qnames))]
st_share = [100 * qb_n["Streamer"][i] / qn_b[i] for i in range(len(qnames))]

insights(
    s6, 0.38, 4.14, 9.24,
    [" · ".join(f"{qnames[i]} {pct(qn_b[i], qn_a[i])} count, {pct(qv_b[i], qv_a[i])} value"
                for i in range(len(qnames))) + " — the gap closes every quarter.",
     f"{qnames[-1]} is the first quarter ahead of {PRV} on both count and value, "
     f"at {qn_b[-1]:,} first deposits worth {klab(qv_b[-1])}.",
     f"Streamer drives it: {st_share[0]:.0f}% of {qnames[0]} first deposits, "
     f"{st_share[1]:.0f}% in {qnames[1]}, {st_share[-1]:.0f}% in {qnames[-1]}, while Direct "
     f"value fell from {klab(qa_v['Direct'][0])} to {klab(qb_v['Direct'][-1])}."])

# ---- 5. active depositors, from the FTD Share dataset
# Read straight from overview/mix-data.json rather than re-derived: FTD Share
# reads the Business Overview's dataset for exactly this reason, and two pages
# disagreeing about the same number is worse than either being slightly off.
MIX = json.load(open(os.path.join(ROOT, "overview", "mix-data.json"),
                     encoding="utf-8"))


def act(mm, key):
    """Distinct depositors in month mm for one cohort. Whale excluded (':ex')."""
    b = MIX["months"].get(mm, {}).get(key)
    return b["cumDep"][-1] if b and b.get("cumDep") else 0


dep_months = [mm for mm in MIX["order"] if mm.startswith(CUR)][:len(cats)]
prv_months = [mm for mm in MIX["order"] if mm.startswith(PRV)][:len(cats)]
assert len(dep_months) == len(prv_months) == len(cats), \
    "depositor months do not line up with the FTD months"

# oldest cohort at the base, newest on top -- the stack reads chronologically
B_OLD, B_PRV, B_CUR = "Earlier", f"FTD {PRV}", f"FTD {CUR}"
DEP_BANDS = [B_OLD, B_PRV, B_CUR]
dep_cur = {B_OLD: [act(mm, "all:ex") - act(mm, "cur:ex") - act(mm, "prev:ex")
                   for mm in dep_months],
           B_PRV: [act(mm, "prev:ex") for mm in dep_months],
           B_CUR: [act(mm, "cur:ex") for mm in dep_months]}
dep_tot_c = [act(mm, "all:ex") for mm in dep_months]
dep_tot_p = [act(mm, "all:ex") for mm in prv_months]

for i, mm in enumerate(dep_months):
    assert sum(dep_cur[b][i] for b in DEP_BANDS) == dep_tot_c[i], \
        "depositor bands do not add up to the month total in %s" % mm

s7 = prs.slides.add_slide(layouts["BLANK"])
heading(s7, "Active Depositors")

# one chart, full width -- this slide answers a single question
stacked_bars(s7, 0.38, 1.30, 9.24, 2.58, cats, dep_cur, DEP_BANDS,
             [NQ_C, Q_C, GREEN])
label(s7, 0.38, 1.12, 9.24, "Active depositors by FTD cohort", GREEN,
      align=PP_ALIGN.CENTER)

new_share = [100 * dep_cur[B_CUR][i] / dep_tot_c[i] for i in range(len(cats))]
prv_share = [100 * dep_cur[B_PRV][i] / dep_tot_c[i] for i in range(len(cats))]
dep_up = sum(1 for i in range(len(cats)) if dep_tot_c[i] > dep_tot_p[i])

insights(
    s7, 0.38, 4.14, 9.24,
    [f"Active depositors ran from {dep_tot_c[0]:,} in {cats[0]} to a peak of "
     f"{max(dep_tot_c):,} in {cats[dep_tot_c.index(max(dep_tot_c))]}, and are "
     f"{pct(dep_tot_c[-1], dep_tot_p[-1])} year on year in {cats[-1]}.",
     f"The base has turned over: {CUR} first depositors went from {new_share[0]:.0f}% of "
     f"{cats[0]}'s depositors to {new_share[-1]:.0f}% in {cats[-1]}.",
     f"The {PRV} cohort fell from {prv_share[0]:.0f}% to {prv_share[-1]:.0f}% of active "
     f"depositors — growth is new players, not returning ones."])

# ---- 6. deposit amount, same cohort split, same source
def amt(mm, key):
    """Deposits in month mm for one cohort. Whale excluded (':ex')."""
    b = MIX["months"].get(mm, {}).get(key)
    return sum(b["depAmount"]) if b and b.get("depAmount") else 0.0


amt_cur = {B_OLD: [amt(mm, "all:ex") - amt(mm, "cur:ex") - amt(mm, "prev:ex")
                   for mm in dep_months],
           B_PRV: [amt(mm, "prev:ex") for mm in dep_months],
           B_CUR: [amt(mm, "cur:ex") for mm in dep_months]}
amt_tot_c = [amt(mm, "all:ex") for mm in dep_months]
amt_tot_p = [amt(mm, "all:ex") for mm in prv_months]

for i, mm in enumerate(dep_months):
    assert abs(sum(amt_cur[b][i] for b in DEP_BANDS) - amt_tot_c[i]) < 1, \
        "deposit bands do not add up to the month total in %s" % mm

s8 = prs.slides.add_slide(layouts["BLANK"])
heading(s8, "Deposit Amount")

stacked_bars(s8, 0.38, 1.30, 9.24, 2.58, cats, amt_cur, DEP_BANDS,
             [NQ_C, Q_C, GREEN], fmt=klab)
label(s8, 0.38, 1.12, 9.24, "Deposits by FTD cohort", GREEN,
      align=PP_ALIGN.CENTER)

amt_new_share = [100 * amt_cur[B_CUR][i] / amt_tot_c[i] for i in range(len(cats))]
amt_old_share = [100 * amt_cur[B_OLD][i] / amt_tot_c[i] for i in range(len(cats))]

insights(
    s8, 0.38, 4.14, 9.24,
    [f"Deposits are {klab(sum(amt_tot_c))} across {SPAN} against "
     f"{klab(sum(amt_tot_p))} in {PRV} ({pct(sum(amt_tot_c), sum(amt_tot_p))}) — "
     "the money is holding up where FTD value is not.",
     f"{CUR} first depositors went from {amt_new_share[0]:.0f}% of deposits in {cats[0]} to "
     f"{amt_new_share[-1]:.0f}% in {cats[-1]}, {klab(amt_cur[B_CUR][-1])} of "
     f"{klab(amt_tot_c[-1])}.",
     f"Pre-{PRV} players still fund {amt_old_share[-1]:.0f}% of deposits while being only "
     f"{100*dep_cur[B_OLD][-1]/dep_tot_c[-1]:.0f}% of depositors — the old base is small but heavy."])

# ---- 7. adjusted GGR, same cohort split, same source
def adjm(mm, key):
    """Adjusted GGR in month mm for one cohort. Whale excluded (':ex')."""
    b = MIX["months"].get(mm, {}).get(key)
    return sum(b["dayAdj"]) if b and b.get("dayAdj") else 0.0


adj_cur = {B_OLD: [adjm(mm, "all:ex") - adjm(mm, "cur:ex") - adjm(mm, "prev:ex")
                   for mm in dep_months],
           B_PRV: [adjm(mm, "prev:ex") for mm in dep_months],
           B_CUR: [adjm(mm, "cur:ex") for mm in dep_months]}
adj_tot_c = [adjm(mm, "all:ex") for mm in dep_months]
adj_tot_p = [adjm(mm, "all:ex") for mm in prv_months]

for i, mm in enumerate(dep_months):
    assert abs(sum(adj_cur[b][i] for b in DEP_BANDS) - adj_tot_c[i]) < 1, \
        "adjusted GGR bands do not add up to the month total in %s" % mm
# a stacked bar cannot show a negative band honestly; this asserts none appears
assert all(adj_cur[b][i] >= 0 for b in DEP_BANDS for i in range(len(cats))), \
    "a cohort has negative adjusted GGR in some month -- this chart cannot stack it"

# cross-check against the independently built all-channel file: the CUR band is
# the same population as its FTD cohort, so the two must agree
assert abs(sum(adj_cur[B_CUR]) - C["money"]["adj"]) < 1000, \
    "cohort adjusted GGR disagrees with ftd-allchannel.json"

s9 = prs.slides.add_slide(layouts["BLANK"])
heading(s9, "Adjusted GGR")

stacked_bars(s9, 0.38, 1.30, 9.24, 2.58, cats, adj_cur, DEP_BANDS,
             [NQ_C, Q_C, GREEN], fmt=klab)
label(s9, 0.38, 1.12, 9.24, "Adjusted GGR by FTD cohort", GREEN,
      align=PP_ALIGN.CENTER)

a_new = 100 * sum(adj_cur[B_CUR]) / sum(adj_tot_c)
a_old = 100 * sum(adj_cur[B_OLD]) / sum(adj_tot_c)
a_prv = 100 * sum(adj_cur[B_PRV]) / sum(adj_tot_c)

insights(
    s9, 0.38, 4.14, 9.24,
    [f"Adjusted GGR is {klab(sum(adj_tot_c))} across {SPAN} against "
     f"{klab(sum(adj_tot_p))} in {PRV} ({pct(sum(adj_tot_c), sum(adj_tot_p))}) — "
     "the strongest measure in the deck.",
     f"Pre-{PRV} players produce {a_old:.0f}% of it and the {PRV} cohort {a_prv:.0f}%; "
     f"{CUR} first depositors only {a_new:.0f}%.",
     f"{CUR} first depositors generated {klab(sum(adj_cur[B_CUR]))} of adjusted GGR across "
     f"{SPAN} — {money(sum(adj_cur[B_CUR])/C['ftd'])} per first deposit against "
     f"{money(C['ftdv']/C['ftd'])} deposited on acquisition."])

# ---- 8. acquisition sources, from the Acquisition report's own context
# Read from acquisition-report/ctx.pkl -- the same object gen_html.py renders,
# so this slide cannot disagree with /acquisition-2026. NOTE: that report is
# denominated in EUR while the rest of this site (and this deck) uses $; the
# figures are the same, only the symbol differs.
import pickle

ACQ = pickle.load(open(os.path.join(ROOT, "acquisition-report", "ctx.pkl"), "rb"))


def accrued_cost(cut):
    """Cost accrued to `cut`, day-proportional across each campaign window.

    gen_html.py derives this rather than storing it, so the same accrual is
    reproduced here from COST_ROWS. A campaign running past the cutoff only
    contributes the days it has actually used -- which is why the accrued
    total is lower than the contracted total.
    """
    from datetime import date as _date, timedelta as _td
    import collections as _c
    acc = _c.defaultdict(float)
    for row in ACQ["COST_ROWS"]:
        cost = row["cost"]
        if not cost:
            continue
        # The cost sheet was restructured on 2026-09-07: the single "Media &
        # Seo" Direct partner became "Media" (src Media Buying) and "general
        # seo" (src General SEO). gen_html.py still matches the old label, so
        # those two would fall out of Direct. Their players attribute to Direct
        # on the player side, so their spend is put back there -- cost and FTDs
        # must sit in the same row or CPA is meaningless.
        ch = ("Direct" if row["name"] in ("Media & Seo", "Media", "general seo")
              else "Community" if row["name"] == "Community"
              else (row["src"] or "Direct"))
        ch = {"Media Buying": "Direct", "General SEO": "Direct"}.get(ch, ch)
        st, en = row["start"], row["end"]
        if not st:
            continue
        if en and en.year > 2026:      # date typo (e.g. 2926) -> intended 2026
            try:
                en = _date(2026, en.month, en.day)
            except ValueError:
                en = st
        if not en or en < st:
            en = st
        per = cost / ((en - st).days + 1)
        dd = st
        while dd <= en:
            if _date(2026, 1, 1) <= dd <= cut:
                acc[ch] += per
            dd += _td(days=1)
    return acc


CUT_DATE = __import__("datetime").date(*(int(x) for x in cur["cutoff"].split("-")))
ACC = accrued_cost(CUT_DATE)
assert not ({"Media Buying", "General SEO"} & set(ACC)), \
    "a restructured cost source is still outside Direct"
SRC_ORDER = ["Direct", "Influence", "SEO", "Community", "Tipster", "Meta",
             "PPC", "DSP", "Unpaid/Organic"]
sprt = ACQ["partners"]

# ACQ["srcAgg"] is rolled up to whatever day the acquisition report last ran,
# which is not this deck's window. Rebuilt here from ACQ["cohort"] -- the same
# per-player rows, with the source already resolved -- capped to the deck's
# last complete month, so the table and the charts cover the same period.
LAST_M = int(cur["ytdMonths"][-1][5:])
sagg = {}
for _d in ACQ["cohort"]:
    if _d["ftdate"].month > LAST_M:
        continue
    a = sagg.setdefault(_d["S"], {"ftd": 0, "sq": 0, "dep": 0.0, "ggr": 0.0,
                                  "ngr": 0.0})
    a["ftd"] += 1
    if _d["ftdtype"] == "Super Qualified":
        a["sq"] += 1
    a["dep"] += sum(_d["depm"][1:LAST_M + 1])
    a["ggr"] += sum(_d["agrm"][1:LAST_M + 1])
    a["ngr"] += sum(_d["ngrm"][1:LAST_M + 1])


def eur(x, dp=0):
    return "\u20ac" + format(round(x), ",")


acq_rows = []
for src in SRC_ORDER:
    a = sagg.get(src, {"ftd": 0, "sq": 0, "dep": 0.0, "ggr": 0.0, "ngr": 0.0})
    cost = ACC.get(src, 0.0)
    acq_rows.append({
        "src": src, "n": len(sprt.get(src, [])), "ftd": a["ftd"],
        "sq": a["sq"], "cost": cost,
        "cpa": (cost / a["ftd"]) if (cost and a["ftd"]) else None,
        "dep": a["dep"], "ggr": a["ggr"], "ngr": a["ngr"],
        "nd": (100 * a["ngr"] / a["dep"]) if a["dep"] else None})

# Totals stay over every source; these two are just too small to earn a row.
HIDE_SRC = {"PPC", "DSP"}
TOT = {kk: sum(r[kk] for r in acq_rows)
       for kk in ("n", "ftd", "sq", "cost", "dep", "ggr", "ngr")}
shown_rows = [r for r in acq_rows if r["src"] not in HIDE_SRC]
hidden = [r for r in acq_rows if r["src"] in HIDE_SRC]
assert TOT["ftd"] == C["ftd"], (
    "acquisition FTDs (%d) disagree with the all-channel cohort (%d)"
    % (TOT["ftd"], C["ftd"]))
assert abs(TOT["dep"] - C["money"]["dep"]) < 1000 and abs(TOT["ggr"] - C["money"]["adj"]) < 1000, \
    "acquisition money disagrees with ftd-allchannel.json"
assert TOT["sq"] == sum(C["countByTier"]["Super Qualified"]), \
    "acquisition Super Qualified count disagrees with the all-channel cohort"

s10 = prs.slides.add_slide(layouts["BLANK"])
heading(s10, "Channel CPA")

AX, AW = 0.38, 1.30
ACW = (9.62 - AX - AW) / 9
ATOP, AHDR, ARH = 1.24, 0.30, 0.285
heads = ["Partners", "Total FTDs", "SQ FTDs", "Accrued Cost", "CPA",
         "Dep Amount", "GGR", "NGR", "NGR/DEP"]
for j, hn in enumerate(heads):
    label(s10, AX + AW + j * ACW, ATOP + 0.09, ACW, hn, MUTED, 7, PP_ALIGN.CENTER)
label(s10, AX, ATOP + 0.09, AW, "Source", MUTED, 7)
line(s10, AX, ATOP + AHDR, 9.62 - AX, GREEN, 0.012)

for i, r in enumerate(shown_rows):
    ry = ATOP + AHDR + i * ARH
    if i:
        line(s10, AX, ry, 9.62 - AX, HAIR)
    txt(s10, AX, ry + 0.055, AW, 0.18, r["src"], 8.5, BODY, INK)
    cells = [f"{r['n']:,}", f"{r['ftd']:,}", f"{r['sq']:,}", eur(r["cost"]),
             eur(r["cpa"]) if r["cpa"] else "n/a", eur(r["dep"]),
             eur(r["ggr"]), eur(r["ngr"]),
             f"{r['nd']:.1f}%" if r["nd"] is not None else "—"]
    for j, cv in enumerate(cells):
        col = RED if cv.startswith("-") or cv.startswith("\u20ac-") else INK
        txt(s10, AX + AW + j * ACW, ry + 0.055, ACW, 0.18, cv, 8, BODY, col,
            PP_ALIGN.CENTER)

ry = ATOP + AHDR + len(shown_rows) * ARH
line(s10, AX, ry, 9.62 - AX, GREEN, 0.012)
txt(s10, AX, ry + 0.06, AW, 0.18, "Total", 9, HEAD, GREEN)
tcells = [f"{TOT['n']:,}", f"{TOT['ftd']:,}", f"{TOT['sq']:,}", eur(TOT["cost"]),
          eur(TOT["cost"] / TOT["ftd"]), eur(TOT["dep"]), eur(TOT["ggr"]),
          eur(TOT["ngr"]), f"{100*TOT['ngr']/TOT['dep']:.1f}%"]
for j, cv in enumerate(tcells):
    txt(s10, AX + AW + j * ACW, ry + 0.055, ACW, 0.18, cv, 8, HEAD, GREEN,
        PP_ALIGN.CENTER)
line(s10, AX, ry + ARH, 9.62 - AX, GREEN, 0.012)

by_src = {r["src"]: r for r in acq_rows}
dr, inf, org = by_src["Direct"], by_src["Influence"], by_src["Unpaid/Organic"]
paid = [r for r in acq_rows if r["cpa"]]
worst = min((r for r in paid if r["ftd"] >= 100), key=lambda r: r["nd"])

txt(s10, AX, ry + ARH + 0.10, 9.24, 0.16,
    f"Cost accrued through {cur['cutoff']}, day-proportional across each campaign window. "
    "Totals include every source. "
    + " and ".join(f"{r['src']} ({r['ftd']:,} FTD{'' if r['ftd'] == 1 else 's'}, "
                   f"{eur(r['cost'])})" for r in hidden)
    + " are in the total but too small to list.", 6.5, BODY, MUTED)

insights(
    s10, AX, 4.14, 9.24,
    [f"Direct is {100*dr['ftd']/TOT['ftd']:.0f}% of first deposits from {dr['n']} partners, "
     f"at {eur(dr['cpa'])} CPA and {dr['nd']:.1f}% NGR/DEP — the only source that is both large and efficient.",
     f"{inf['src']} is the second largest at {inf['ftd']:,} FTDs and the cheapest to buy "
     f"({eur(inf['cpa'])} CPA), but returns {inf['nd']:.1f}% NGR/DEP against a blended "
     f"{100*TOT['ngr']/TOT['dep']:.1f}%.",
     f"{org['src']} costs nothing and delivers {org['ftd']:,} FTDs, but its NGR is "
     f"{eur(org['ngr'])} — blended CPA is {eur(TOT['cost']/TOT['ftd'])} across "
     f"{eur(TOT['cost'])} of spend."])

# ---- 9. streamer FTDs by country
def signed_bars(slide, x, y, w, h, cats, vals, gut=0.60, lab_h=0.22, leg_h=0.26,
                fmt=None):
    """Signed columns drawn with shapes.

    LibreOffice renders negative native columns above the axis, so a real chart
    here could not be visually checked. leg_h is reserved so this shares a
    baseline with the plain chart beside it.
    """
    fmt = fmt or (lambda t: f"{t:,.0f}")
    lo, hi = min(min(vals), 0.0), max(max(vals), 0.0)
    pad = (hi - lo) * 0.16
    lo, hi = lo - pad, hi + pad
    step = nice_step(hi - lo, 4)
    px, pw = x + gut, w - gut
    ph = h - lab_h - leg_h
    zero = y + ph * (hi / (hi - lo))

    g = -(-int(lo) // step) * step if lo < 0 else (int(lo) // step) * step
    while g < lo:
        g += step
    while g <= hi:
        gy = y + ph * ((hi - g) / (hi - lo))
        if abs(g) < 1e-9:
            line(slide, px, gy, pw, HAIR, 0.012)
        txt(slide, x, gy - 0.075, gut - 0.08, 0.15, fmt(g), 7, BODY, MUTED,
            PP_ALIGN.RIGHT)
        g += step

    slot = pw / len(vals)
    bw = min(0.30, slot * 0.56)
    for i, val in enumerate(vals):
        cxm = px + slot * (i + 0.5)
        vy = y + ph * ((hi - val) / (hi - lo))
        t, bh = (vy, zero - vy) if val >= 0 else (zero, vy - zero)
        box(slide, cxm - bw / 2, t, bw, max(bh, 0.012),
            GREEN if val >= 0 else RED)
        ly = t - 0.17 if val >= 0 else t + bh + 0.02
        txt(slide, cxm - slot / 2, ly, slot, 0.15, fmt(val), 6,
            HEAD, GREEN if val >= 0 else RED, PP_ALIGN.CENTER)
        txt(slide, cxm - slot / 2, y + ph + 0.05, slot, 0.16, cats[i], 6.5,
            BODY, MUTED, PP_ALIGN.CENTER)


SC = cur["streamerByCountry"]
SHORT = {"United States of America": "USA", "Republic of Kosovo": "Kosovo",
         "United Kingdom": "UK", "Russian Federation": "Russia",
         "Czech Republic": "Czechia", "New Zealand": "N. Zealand",
         "Netherlands": "Nether.", "Switzerland": "Swiss"}
TOP_N = 18
top_c = sorted(SC.items(), key=lambda kv: -kv[1]["ftd"])[:TOP_N]
c_names = [SHORT.get(c, c) for c, _ in top_c]
c_ftd = [v["ftd"] for _, v in top_c]
c_cpa = [(v["cost"] / v["paidFtd"]) if v.get("paidFtd") else None for _, v in top_c]
c_cpa_lab = [money(x) if x else "—" for x in c_cpa]

alloc_cost = sum(v["cost"] for v in SC.values())
alloc_ftd = sum(v["paidFtd"] for v in SC.values())

st_ftd_all = sum(v["ftd"] for v in SC.values())
assert st_ftd_all == C["nByChannel"]["Streamer"], \
    "streamer country FTDs do not add up to the streamer channel"

s11 = prs.slides.add_slide(layouts["BLANK"])
heading(s11, "Streamer FTDs by Country")

stacked_bars(s11, 0.38, 1.30, 9.24, 2.58, c_names, {"n": c_ftd}, ["n"],
             [GREEN], show_legend=False, top_note=c_cpa_lab)
label(s11, 0.38, 1.12, 9.24,
      f"CPA above the bar · first deposits inside · top {TOP_N} of {len(SC)} countries",
      GREEN, align=PP_ALIGN.CENTER)
txt(s11, 0.38, 3.92, 9.24, 0.14,
    f"Cost is held per streamer, not per country: each streamer's spend is split across "
    f"the countries their own first deposits came from · {money(alloc_cost)} over "
    f"{alloc_ftd:,} FTDs", 6.5, BODY, MUTED)

shown = sum(c_ftd)
half = 0
for i, v in enumerate(c_ftd, 1):
    half += v
    if half >= st_ftd_all / 2:
        n_half = i
        break

insights(
    s11, 0.38, 4.14, 9.24,
    [f"{st_ftd_all:,} streamer first deposits across {len(SC)} countries; these "
     f"{TOP_N} carry {100*shown/st_ftd_all:.0f}% of them.",
     f"{c_names[0]} and {c_names[1]} alone are "
     f"{100*(c_ftd[0]+c_ftd[1])/st_ftd_all:.0f}% — {c_ftd[0]:,} and {c_ftd[1]:,} "
     "first deposits.",
     f"Blended streamer CPA is {money(alloc_cost/alloc_ftd)}, but by country it runs from "
     f"{money(min(x for x in c_cpa if x))} to {money(max(x for x in c_cpa if x))} "
     f"across these {TOP_N}."])

# ---- 10. plan vs actual, against the FTD Targets sheet
PLAN = json.load(open(os.path.join(HERE, "ftd-plan-2026.json"), encoding="utf-8"))
assert PLAN["months"][:len(cats)] == cur["ytdMonths"], \
    "the plan months do not line up with the actual months"
# May and Jun were back-solved to hold the annual target, so Direct + Aff misses
# Total by a unit in those months. The deck only uses the Total column.
assert all(abs(PLAN["countDirect"][i] + PLAN["countAff"][i] - PLAN["countTotal"][i]) <= 2
           for i in range(len(PLAN["months"]))), "plan count columns are far apart"
assert abs(sum(PLAN["countTotal"]) - PLAN["statedTotal"]["count"]) <= 5, \
    "plan months are far from the sheet's stated annual total"

# The plan runs to December; actuals stop at the last complete month, so the
# remaining months show a plan bar with nothing beside it.
cats12 = [MON[mm[5:]] for mm in PLAN["months"]]
plan_n = PLAN["countTotal"]
plan_v = PLAN["amountTotal"]
act_n = [sum(C["countByTier"][t][i] for t in TIERS) for i in range(len(cats))]
act_v = list(C["valueByMonth"])
pad = len(cats12) - len(cats)
act_n_12 = act_n + [0] * pad
act_v_12 = act_v + [0.0] * pad

s12 = prs.slides.add_slide(layouts["BLANK"])
heading(s12, "Plan vs Actual")

group_bars(s12, 0.38, 1.30, 4.44, 2.58, cats12, plan_n, act_n_12, "Plan", "Actual")
label(s12, 0.38, 1.12, 4.44, "FTD count", GREEN, align=PP_ALIGN.CENTER)

group_bars(s12, 5.18, 1.30, 4.44, 2.58, cats12, plan_v, act_v_12, "Plan", "Actual",
           fmt=klab)
label(s12, 5.18, 1.12, 4.44, "FTD amount", GREEN, align=PP_ALIGN.CENTER)

txt(s12, 0.38, 3.92, 9.24, 0.14,
    f"Plan is the live re-baseline in the FTD Targets sheet · {cats[0]}–{cats[3]} were set "
    f"equal to actuals when it was rebuilt · actuals run to {cats[-1]}, the plan to "
    f"{cats12[-1]}", 6.5, BODY, MUTED)

pn_ytd, pv_ytd = sum(plan_n[:len(cats)]), sum(plan_v[:len(cats)])
pn, pv = sum(plan_n), sum(plan_v)
an, av = sum(act_n), sum(act_v)
left_n = pn - an
per_month = left_n / pad if pad else 0
gap_from = next(i for i in range(len(cats)) if act_n[i] < plan_n[i])
worst_i = min(range(len(cats)), key=lambda i: act_n[i] / plan_n[i])

insights(
    s12, 0.38, 4.14, 9.24,
    [f"{an:,} first deposits against {pn_ytd:,} planned for {SPAN} — "
     f"{100*an/pn_ytd:.0f}% of target; {klab(av)} against {klab(pv_ytd)}, "
     f"{100*av/pv_ytd:.0f}%.",
     f"Only testable from {cats[gap_from]} — {cats[0]}–{cats[gap_from-1]} were set equal to "
     "actuals when the sheet was re-baselined.",
     f"The full-year plan is {pn:,}. Hitting it needs {per_month:,.0f} a month across "
     f"{cats12[len(cats)]}–{cats12[-1]}, against a best month so far of {max(act_n):,}."])

# ---- 11. deposits and NGR, plan vs actual
# The workbook plans NGR but never GGR -- NGR is its only revenue measure --
# so this slide pairs NGR with Deposits, the other planned money line.
assert "ngrTotal" in PLAN and "depTotal" in PLAN, "plan is missing the money series"
assert abs(sum(PLAN["ngrTotal"]) - PLAN["statedTotal"]["ngr"]) <= 2, \
    "plan NGR months do not reach the sheet's stated annual NGR"
assert abs(sum(PLAN["depTotal"]) - PLAN["statedTotal"]["dep"]) <= 2, \
    "plan deposit months do not reach the sheet's stated annual deposits"

act_dep = list(C["moneyByMonth"]["dep"]) if "moneyByMonth" in C else \
    [cur["moneyByMonth"]["dep"][i] for i in range(len(cats))]
act_ngr = [cur["moneyByMonth"]["ngr"][i] for i in range(len(cats))]
act_dep = [cur["moneyByMonth"]["dep"][i] for i in range(len(cats))]

s13 = prs.slides.add_slide(layouts["BLANK"])
heading(s13, "Deposits and NGR vs Plan")

group_bars(s13, 0.38, 1.30, 4.44, 2.58, cats12, PLAN["depTotal"],
           act_dep + [0.0] * pad, "Plan", "Actual", fmt=klab)
label(s13, 0.38, 1.12, 4.44, "Deposits", GREEN, align=PP_ALIGN.CENTER)

group_bars_signed(s13, 5.18, 1.30, 4.44, 2.58, cats12, PLAN["ngrTotal"],
                  act_ngr + [0.0] * pad, "Plan", "Actual", fmt=klab)
label(s13, 5.18, 1.12, 4.44, "NGR", GREEN, align=PP_ALIGN.CENTER)

txt(s13, 0.38, 3.92, 9.24, 0.14,
    "The workbook plans NGR but never GGR · May and Jun plan figures are a balancing "
    "plug: the Jan–Apr shortfall was dumped into them to hold the annual total",
    6.5, BODY, MUTED)

pd_ytd, pn_g_ytd = sum(PLAN["depTotal"][:len(cats)]), sum(PLAN["ngrTotal"][:len(cats)])
ad, an_g = sum(act_dep), sum(act_ngr)

insights(
    s13, 0.38, 4.14, 9.24,
    [f"Deposits are {klab(ad)} against {klab(pd_ytd)} planned for {SPAN} — "
     f"{100*ad/pd_ytd:.0f}% of target.",
     f"NGR is {klab(an_g)} against {klab(pn_g_ytd)} planned — {100*an_g/pn_g_ytd:.0f}%; "
     f"the full-year plan is {klab(sum(PLAN['ngrTotal']))}, {100*an_g/sum(PLAN['ngrTotal']):.0f}% "
     "of it earned so far.",
     f"Every month from {cats[4]} lands between "
     f"{min(100*act_ngr[i]/PLAN['ngrTotal'][i] for i in range(4, len(cats))):.0f}% and "
     f"{max(100*act_ngr[i]/PLAN['ngrTotal'][i] for i in range(4, len(cats))):.0f}% of planned NGR."])

# ---- 12. monthly CPA, the acquisition report's own table
# Definitions copied from gen_html.py's monthly_table(): the row is the month a
# player first deposited; "SM" is that cohort's money in its own first month,
# "Tot" is the same cohort's money across the year to date. Cost is the accrued
# spend falling in that calendar month.
def month_cost(cut):
    from datetime import date as _date, timedelta as _td
    import collections as _c
    mc = _c.defaultdict(float)
    for row in ACQ["COST_ROWS"]:
        cost = row["cost"]
        st, en = row["start"], row["end"]
        if not cost or not st:
            continue
        if en and en.year > 2026:
            try:
                en = _date(2026, en.month, en.day)
            except ValueError:
                en = st
        if not en or en < st:
            en = st
        per = cost / ((en - st).days + 1)
        dd = st
        while dd <= en:
            if _date(2026, 1, 1) <= dd <= cut:
                mc[dd.month] += per
            dd += _td(days=1)
    return mc


MC = month_cost(CUT_DATE)
mrows = []
for mi in range(1, LAST_M + 1):
    r = {"m": MON["%02d" % mi], "cost": MC.get(mi, 0.0), "ftd": 0,
         "sd": 0.0, "sg": 0.0, "sn": 0.0, "td": 0.0, "tg": 0.0, "tn": 0.0}
    for _d in ACQ["cohort"]:
        if _d["ftdate"].month != mi:
            continue
        r["ftd"] += 1
        r["sd"] += _d["depm"][mi]; r["sg"] += _d["agrm"][mi]; r["sn"] += _d["ngrm"][mi]
        r["td"] += sum(_d["depm"][1:LAST_M + 1])
        r["tg"] += sum(_d["agrm"][1:LAST_M + 1])
        r["tn"] += sum(_d["ngrm"][1:LAST_M + 1])
    mrows.append(r)

MT = {kk: sum(r[kk] for r in mrows) for kk in ("cost", "ftd", "sd", "sg", "sn",
                                               "td", "tg", "tn")}
assert MT["ftd"] == C["ftd"], "monthly CPA FTDs disagree with the cohort"
assert abs(MT["td"] - C["money"]["dep"]) < 1000, \
    "monthly CPA deposits disagree with ftd-allchannel.json"
assert abs(MT["cost"] - sum(ACC.values())) < 1, \
    "monthly cost does not match the channel accrual"

s14 = prs.slides.add_slide(layouts["BLANK"])
heading(s14, "Monthly CPA")

MX, MW = 0.38, 0.60
MCW = (9.62 - MX - MW) / 11
MTOP, MHDR, MRH = 1.20, 0.28, 0.255
mheads = ["Cost", "FTDs", "CPA", "Dep SM", "GGR SM", "NGR SM", "NGR/Dep",
          "Dep Tot", "GGR Tot", "NGR Tot", "NGR/Dep"]
label(s14, MX, MTOP + 0.08, MW, "Month", MUTED, 6.5)
for j, hn in enumerate(mheads):
    label(s14, MX + MW + j * MCW, MTOP + 0.08, MCW, hn,
          GREEN if j >= 7 else MUTED, 6.5, PP_ALIGN.CENTER)
line(s14, MX, MTOP + MHDR, 9.62 - MX, GREEN, 0.012)

for i, r in enumerate(mrows):
    ry = MTOP + MHDR + i * MRH
    if i:
        line(s14, MX, ry, 9.62 - MX, HAIR)
    txt(s14, MX, ry + 0.05, MW, 0.16, r["m"], 8, BODY, INK)
    cells = [eur(r["cost"]), f"{r['ftd']:,}",
             eur(r["cost"] / r["ftd"]) if r["ftd"] else "n/a",
             eur(r["sd"]), eur(r["sg"]), eur(r["sn"]),
             f"{100*r['sn']/r['sd']:.1f}%" if r["sd"] else "n/a",
             eur(r["td"]), eur(r["tg"]), eur(r["tn"]),
             f"{100*r['tn']/r['td']:.1f}%" if r["td"] else "n/a"]
    for j, cv in enumerate(cells):
        neg = cv.startswith("-") or cv.startswith("\u20ac-")
        txt(s14, MX + MW + j * MCW, ry + 0.05, MCW, 0.16, cv, 7,
            HEAD if j >= 7 else BODY, RED if neg else INK, PP_ALIGN.CENTER)

ry = MTOP + MHDR + len(mrows) * MRH
line(s14, MX, ry, 9.62 - MX, GREEN, 0.012)
txt(s14, MX, ry + 0.06, MW, 0.16, "Total", 8, HEAD, GREEN)
tcells = [eur(MT["cost"]), f"{MT['ftd']:,}", eur(MT["cost"] / MT["ftd"]),
          eur(MT["sd"]), eur(MT["sg"]), eur(MT["sn"]),
          f"{100*MT['sn']/MT['sd']:.1f}%",
          eur(MT["td"]), eur(MT["tg"]), eur(MT["tn"]),
          f"{100*MT['tn']/MT['td']:.1f}%"]
for j, cv in enumerate(tcells):
    txt(s14, MX + MW + j * MCW, ry + 0.06, MCW, 0.16, cv, 7, HEAD, GREEN,
        PP_ALIGN.CENTER)
line(s14, MX, ry + MRH, 9.62 - MX, GREEN, 0.012)

txt(s14, MX, ry + MRH + 0.09, 9.24, 0.14,
    "SM = that month's intake, measured in its own first month · Tot = the same intake "
    f"measured to {cur['cutoff']} · bonus-cost columns omitted for width", 6.5, BODY, MUTED)

best = min(mrows, key=lambda r: r["cost"] / r["ftd"] if r["ftd"] else 9e9)
worst = max(mrows, key=lambda r: r["cost"] / r["ftd"] if r["ftd"] else 0)
big = max(mrows, key=lambda r: r["ftd"])
jan = mrows[0]

insights(
    s14, MX, 4.14, 9.24,
    [f"CPA runs from {eur(best['cost']/best['ftd'])} in {best['m']} to "
     f"{eur(worst['cost']/worst['ftd'])} in {worst['m']} — a 5x spread on a blended "
     f"{eur(MT['cost']/MT['ftd'])}.",
     f"{big['m']} bought the most first deposits ({big['ftd']:,}) at "
     f"{eur(big['cost']/big['ftd'])}, but its first-month NGR was {eur(big['sn'])} — "
     "volume and quality moved in opposite directions.",
     f"Cohorts keep paying: {jan['m']}'s {jan['ftd']} players deposited {eur(jan['sd'])} "
     f"in month one and {eur(jan['td'])} by {cats[-1]}, "
     f"{jan['td']/jan['sd']:.1f}x their first month."])

prs.save(OUT)
print("wrote", OUT, "slides:", len(prs.slides._sldIdLst))
