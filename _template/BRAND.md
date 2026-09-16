# Wayzen deck template and conventions

Source: `Desktop\Wayzen QBR Format.pptx` (copied 2026-08-30) → `_template\wayzen-template.pptx`

Open that file as the python-pptx base for every deck. Never start from a blank
`Presentation()` — the masters, theme and cover art come from the real deck.

---

## HOUSE RULES — apply to every new slide without being asked

These were set one at a time while building `ftd-deck.pptx`. Follow all of them
on anything new; do not re-litigate them.

### Header
- Background is `assets\content-bg-white-r.jpg`, set as a per-slide `<p:bg>`
  (the bar is **not** on the master or any layout — a BLANK slide loses it).
- The bar runs **light green on the left → dark green on the right**.
- **Title left-aligned, white, 17pt Manrope ExtraBold**, vertically centred in
  the bar at x≈0.62.
- **Logo sits at the right**, on the dark end.
- **No dots.** The original art has a scattered dot pattern; it is gone and
  stays gone.
- **No sub-line / kicker under the header.** The chart titles say what the slide
  is. Do not add explanatory text under the bar.

### Body
- **White background.** Not the pale green wash.
- Type and hairlines only — **no filled cards, no coloured bands**.
- Palette is green (`#114004`) for figures worth reading, red (`#A32C1E`) for
  negatives, grey (`#6E766A`) for labels. Nothing else.
- Headings are **functional**: "Scorecard", "Monthly Trend", "Channel Mix".
  Never editorial ("The programme, in one page").

### Charts
- **No gridlines.** Baseline only.
- **Numbers on every bar**, including both bars of a year-on-year pair, and both
  on the **same line** — never staggered.
- Two charts side by side must **share one baseline**: reserve the legend height
  whether or not a legend is drawn.
- Chart titles **centred** over their plot, small caps, green.
- Stacked bands run **chronologically from the base up** — oldest cohort at the
  bottom, newest on top (Earlier → FTD 2025 → FTD 2026). Same for quality tiers:
  Non Qualified at the base, Super Qualified on top.
- Money is short form everywhere — **`$100K`, `$1.4M`, never `$100.3K`** — on
  bars, on ticks and in the prose.
- Negative columns are drawn with shapes, not a native chart: LibreOffice
  renders negative native columns above the axis, so a real chart cannot be
  visually checked.

### Numbers
- **Every figure is computed from the data file. Never typed into a string.**
  The caches refresh daily; hardcoded figures silently go stale and contradict
  the tables beside them. This has already happened once.
- Any prior-year comparison is **like-for-like** — trim last year to the same
  months, never 8 months against 12.
- Player `1709996` is excluded, as on every other report on this site.
- Assert that parts add to published totals (tiers → cohort, channels → cohort,
  months → year). A dropped row should fail the build, not print quietly.

---

## Canvas
- 10.0 × 5.62 in (9144000 × 5143500 EMU), 16:9

## Colors
| role | hex |
|---|---|
| brand dark green | `#114004` |
| brand lime | `#9DE96E` |
| ink | `#1A1A1A` |
| muted | `#6E766A` |
| hairline | `#D3DCCE` |
| negative | `#A32C1E` |
| prior year (recessive) | `#C2CEB8` |

## Type
- Headings / titles / figures: **Manrope ExtraBold**
- Body, labels, ticks: **Manrope**

## Background assets
| file | use |
|---|---|
| `content-bg.jpg` | the template's original: green bar left, pale green body, dots |
| `content-bg-plain.jpg` | bar kept, body flattened to the pale wash, dots removed |
| `content-bg-white-r.jpg` | **current**: gradient reversed (light→dark), logo right, body white, no dots |

## Layouts available (master `simple-light-2`)
TITLE · SECTION_HEADER · TITLE_AND_BODY · TITLE_AND_TWO_COLUMNS · TITLE_ONLY ·
ONE_COLUMN_TEXT · MAIN_POINT · SECTION_TITLE_AND_DESCRIPTION · CAPTION_ONLY ·
BIG_NUMBER · BLANK

Content slides are built on **BLANK** with the background applied by hand.

## Build scripts
| script | output |
|---|---|
| `streamers\build_ftd_allchannel.py` | `ftd-allchannel.json` — all-channel FTD cohort, both years |
| `streamers\build_ftd_deck.py` | `..\ftd-deck.pptx` — all-channel FTD deck |
| `streamers\build_streamers_deck.py` | `..\streamers-deck.pptx` — streamer-programme deck |

Render check: `soffice --headless --convert-to pdf` then `pdftoppm -png`.
