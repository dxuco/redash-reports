---
name: redash-report-builder
description: >
  Build or extend a standalone single-file HTML analytics report in the
  veisreports folder (C:\redash-page) from the Redash query-1731/1732 month
  caches — player, deposit, bet, GGR, NGR, adjusted-GGR, house-edge and bonus
  reporting for the gambling business. Use this skill whenever the user asks for
  a new report page, chart, metric, filter or breakdown in that folder, wants to
  change an existing one (business-overview, bonus-cost, FTD, acquisition), asks
  "can you add X by day/month/category", asks where a figure comes from, or
  questions a number that looks wrong. Use it even when they don't mention
  Redash, caches or HTML — anything touching depositors, bettors, GGR, NGR,
  house edge, bonus cost, crypto/fiat rails, game categories, MTD comparisons or
  the reports site belongs here. Also use it before running any Redash query:
  the data is already on disk.
---

# Building reports from the Redash caches

Reports in `C:\redash-page` are **standalone single-file HTML** — they open by
double-clicking, with no server and no network, because that is how people
actually read them. Every one is built the same way, and the whole job is
getting three things right: read the cache instead of the API, count distinct
things honestly, and bake the result into one file.

Read `README.md` in the folder first when touching an existing report. It is
long and it is accurate — it documents traps that cost someone an afternoon
each, and it is the source of truth for how the existing pages behave.

## 1. The data is already on disk

**Do not call the Redash API.** Every month is cached as player × day rows:

| Path | Query | Contents |
|---|---|---|
| `ftd-report/cache/YYYY-MM.json` | 1732 | the full column set — use this one |
| `cache-bonus/YYYY-MM.json` | 1732 | fewer columns, bonus-oriented |

~90,000 rows a month, 20+ months on file. A month is one JSON array of flat
objects. Values arrive as **strings** — coerce with a `num()` helper that maps
empty/None to 0.0, or sums silently concatenate.

Start by inventorying the columns, because which fields share a row is the whole
ballgame (see §3):

```
python scripts/inspect_cache.py ftd-report/cache/2026-08.json
```

It prints the column inventory, the field-overlap matrix and the game-category
and payment-rail breakdowns. Run it before designing any chart.

## 2. The three-file pattern

Every report is the same shape. Follow it — the daily job, the publisher and the
next person all expect it.

```
<report>/build_<name>.py         reads the caches, emits <name>-data.json
<report>/<name>-template.html    the page, with a literal __DATA__ token
<report>/make_<name>_html.py     template.replace("__DATA__", data) -> ../<name>.html
<report>/test_<name>.js          renders the built page in jsdom and reads it back
```

The built HTML at the folder root is **generated** — never edit it. Edit the
template and re-bake. Say this in a comment at the top of the maker script,
because an edit made in the built file is silently destroyed on the next build.

Keep the emitted JSON small by aggregating in Python: emit per-day arrays, not
rows. A year and a half of daily series across a dozen metrics is ~400 KB, which
inlines fine. Round money to 2dp on the way out (and see the rounding budget in
§7 before asserting anything reconciles "exactly").

## 3. What query 1732 can and cannot tell you

These are properties of the data, not opinions, and each one has burned a
report already. Verify with `inspect_cache.py` rather than trusting this table
if the schema may have moved.

| Fields | Share a row? | Consequence |
|---|---|---|
| `bet`, `ggr`, `ngr`, `game_product` | yes | bet, GGR, NGR **can** be split by game category |
| `adjusted_ggr`, `game_product` | **never** — zero overlap | adjusted GGR **cannot** be split by category, at all |
| `ngr`, `bonus_cost` without `game_product` | ~13,000 rows/month | ≈5% of NGR has no category — material, must be shown |
| `bet`/`ggr` without `game_product` | 2 rows/month, ~$25 | immaterial, but still track it |
| `deposit`, `blockchain` | yes | deposits split crypto/fiat |
| `ftd` | a **dollar amount**, not a flag | count distinct players with `ftd > 0`; summing gives nonsense |

**Adjusted GGR is not raw GGR minus bonus cost.** They are computed upstream
over different scopes — Aug 2026 ex-whale is $765,947 adjusted against $490,848
if you derive it. Never "fix" a builder by subtracting.

When a residue has no category, the choice is: show it as its own band, or drop
it. Allocating it pro-rata makes the columns add up and every individual figure
invented — don't. Show it when material, track it always, so the charts can be
reconciled exactly instead of to a tolerance that would also hide a real gap.

## 4. Counting: distinct never sums

This is the single most common way these reports go wrong, and it is invisible
when it does — the numbers look perfectly ordinary.

- **A player who deposits on five days is five day-actives and one monthly
  active.** Emit per-day counts *and* a running-distinct array (`cumDep[i]` =
  distinct players over days 0..i). Headline figures read the last element of
  the window; they never sum the daily bars.
- **A player who plays casino and sport is one bettor in two category rows.**
  Category rows will not sum to the bettors total. State that on the page rather
  than reconciling it away — and consider showing the gap itself as a figure
  ("multi-category players"), which is the interesting number.
- **Across months it gets worse.** Summing 20 monthly distincts gave 39,251
  depositors where the true distinct is 21,089. This cannot be derived on the
  page from monthly figures — the builder must union player ids across months
  and emit the range distinct, for each filter combination the page offers.

If a headline count can be produced two ways and they disagree, the page should
show the honest one and explain the other in a caption.

## 5. The whale

One player, `player_id` **1709996** (`karolik777`), is 60–72% of deposited
dollars in most months and the majority of adjusted GGR. With him in, daily
deposits read ~$415k; without, ~$118k, which is what the business actually runs
at.

Every report carves him out **by default**, with a toggle to put him back — the
Bonus Cost report set that precedent and pages that disagree with each other are
worse than pages that are all slightly conservative. Build both views in the
builder (`ex` and `inc`) so the toggle is instant and both come from identical
code.

**Key on `player_id`, not username.** Player ids here have changed username
mid-year; a name-based rule stops matching silently the day his does.

Whenever a figure looks 3–4× larger than the user expects, check the top
depositor before anything else. It is almost always this.

## 6. Reuse the existing classification rules, verbatim

`ftd-report/month-aggregate.js` holds `FIAT_RAILS` / `KNOWN_RAILS` and
`railCodeOf()`. Copy the lists across rather than inventing a split — two pages
that classify rails differently is a worse bug than either being slightly wrong,
because nobody can tell which is which.

That includes reproducing known quirks (`mercado` counts as crypto on the
monthly page). If a quirk should be fixed, fix it in both places in the same
change, and say so.

Print any value not in `KNOWN_RAILS` at the end of a build so new payment
methods get classified on purpose rather than defaulting into crypto.

## 7. Reconciling, and the rounding budget

Assert that the parts equal the whole — it is the cheapest way to catch a
dropped row. But the builder rounds each emitted value to 2dp, so:

```
budget = (number_of_rounded_values) * 0.005
```

A difference inside that budget is rounding. Anything beyond it is a dropped
row. Asserting `< 0.01` on 168 rounded values produces a failure that looks like
a data bug and is not; asserting `< 1%` hides a real one. Compute the budget.

## 8. House conventions

The palette lives in `theme.css` and `check-theme.js` enforces it. Copy the
`:root` block into the template — reports are standalone, so the CSS file is a
reference copy, not a link.

### The cover band is one fixed size

Every report opens with the same green band. Do **not** copy the cover CSS out
of whichever report you looked at last — that is exactly how it drifted into
three different sizes before it was pinned on 2026-08-25. Take it from
`theme.css`, where the numbers live as `--cover-*`:

```css
.cover       { background: linear-gradient(135deg, var(--dark-green) 0%,
                                           var(--green-dk) 100%);
               color: #fff; padding: 1.6rem 20px 1.4rem; }
.cover-inner { max-width: 1800px; margin: 0 auto; }
.cover h1    { font-size: 1.55rem; font-weight: 700; margin: 0 0 .25rem;
               letter-spacing: -0.01em; }
.cover p     { color: var(--light-green); font-size: .86rem; margin: 0; }
```

**The height is pinned, not left to emerge.** Padding and type sizes alone do
not equalise the bands — that was the first attempt and it left them visibly
different. Two more things move the height, so both are fixed:

```css
.cover       { line-height: 1.45; }   /* else it inherits body's, 1.45 or 1.5 */
.cover-inner { min-height: 60px; }    /* the benchmark content height */
```

`business-overview.html` is the benchmark. Its cover holds the Days/Months
buttons as well as the title, so its band is the tallest of the set; 60px is
its content height and therefore the floor everywhere. Every band renders at
60 + 1.6rem + 1.4rem = 108px.

Two things that are easy to get wrong:

- **`.cover-inner` must match the page container** (`.wrap` or `section`), both
  1800px. If they differ the title stops lining up with the tables under it,
  which reads as a rendering bug rather than a style choice.
- **Watch for a duplicate stylesheet.** Some reports were assembled by
  concatenating two CSS blocks, so `.cover` is defined twice and the *second*
  one silently wins. If a page looks off-standard, check whether the rule you
  are reading is the one the browser actually applies.

`node check-theme.js` verifies the padding and both widths on every report and
exits non-zero on drift, so 9-check-theme.bat gates it alongside the palette.
Scoped `.cover h1` / `.cover p` sizes are checked too; older pages that style a
bare `h1` and `.sub` are reported as unverifiable rather than failed, because
those selectors are reused elsewhere in those files.

Non-negotiables, each learned from a chart that lied:

- **Every axis labels its zero.** Anchor ticks to multiples of a step size
  rather than dividing min-to-max into four.
- **A second axis is pinned to the first one's zero.** Otherwise the right axis
  puts its zero on the floor while the bars' zero sits partway up the plot, and
  the line gets drawn underneath a bar several times its size.
- **Negative values stack downward from a darkened zero rule** — never clamped,
  never piled in with the positives. GGR and NGR both go negative.
- **The sign goes before the currency symbol**: `-$5,000`, never `$-5,000`.
- **Percentages are whole numbers** via one shared helper, with `<1%` rather
  than `0%` for a real small value — *except* where the precision is the point
  (house edge: dice 0.2% and casino 5.4% both round away). Deviate deliberately
  and say why in a comment.
- **Categories get nominal colours, not a green ramp.** Six stacked greens are
  indistinguishable once segments get thin. Overlay lines go navy with a white
  halo so they stay legible crossing a dark bar.

### Revenue row order — use this, don't invent one

Any revenue block, on any page here, runs in this order:

| # | Row | Why here |
|---|-----|----------|
| 1 | Deposits | money in |
| 2 | Total bet | what they staked with it |
| 3 | GGR | gross win |
| 4 | Adjusted GGR | after adjustments |
| 5 | House edge | = row 4 ÷ row 2, sits under its numerator |
| 6 | Bonus cost | the subtraction |
| 7 | NGR | rows 4 − 6 = 7, three consecutive lines |
| 8 | Bonus cost / Adj. GGR | summary ratio |
| 9 | NGR / deposits | summary ratio |

The point is adjacency: a reader checks `Adj. GGR − Bonus cost = NGR` by eye
because those rows touch. Do **not** regroup into "all money, then all
percentages" — that breaks the only proof the table offers.

Denominators: **house edge and the bonus ratio both divide by adjusted GGR.**
Raw GGR appears only where adjusted GGR is genuinely unavailable — the per-
product table and the house-edge chart — because `adjusted_ggr` never shares a
row with `game_product`. Wherever the two differ, say which one is on screen.

### A row group describes one population

If a block is headed "First depositors" and the first row counts 1,020 of them,
every row beneath it reports on those 1,020. The trap: per-year cohort views
(`cur`/`prev`/`pre`) are the obvious thing to reach for, but in a single-month
column they cover the whole year's intake — 1,851 people — under a headcount of
1,020, and the bonus cost reads four times too high. Build a per-month `new`
view (players whose `first_deposit_date` falls in that month) and let the span
decide: one month → that month's intake, several → the year's cohort across the
whole span. Same rule either way — *whoever first deposited inside the column's
own window*.

### Reading the cache is not free — plan the passes

895 MB across 20 files, 2.2 million rows: **one full read-and-parse is ~30
seconds.** That cost is invisible until it is paid seven times.

- **One pass, not one per question.** `build_overview.py` grew two extra
  prep passes — one ranking countries, one mapping each player's deposit rail —
  bolted on as separate functions because each was written separately. Both read
  only deposit rows and both had to finish before the main loop. Folded into a
  single `scan_players()` the build went from four passes to three, output
  byte-identical (every month hashed the same; only `builtAt` moved).
- **A prep pass is sometimes unavoidable** — bucketing and cohort assignment must
  be decided before any view is built — but two prep passes almost never are.
- **Ad-hoc analysis: slice once, then query the slice.** Answering ten questions
  about one country by re-reading the whole cache ten times costs five minutes of
  parsing for maybe two seconds of arithmetic. Filter to the rows you need, hold
  them, ask everything.

### Going to Redash: check the cache first, then keep queries cheap

The caches cover 20 months. Anything inside that window should never become a
query. Outside it, `reports.dwh_fct_transaction_detail` is large enough that
carelessness times out:

- **One year per query.** Two years in one statement timed out repeatedly; the
  same query per year returned in 40–55 seconds each.
- **`count(distinct player_id)` is what tips it over.** Dropping it let a
  four-year product breakdown run; adding it back forced one year at a time.
- **A burst of long queries got the API 403-ed** at the nginx layer — even
  `select 1` — for a while afterwards. Space them, and prefer one query that
  returns several rows over several that each return one.

## 9. Chart forms

Write the SVG by hand — no libraries; the page has no network. One drawer for
stacked bars, one for lines, both fed by a config object. See
`references/chart-drawing.md` for the drawer contract, signed stacking, label
placement and the isolate-on-click behaviour.

Choosing the form:

- **Stacked bars** for additive quantities split by a dimension (dollars by
  category, dollars by rail).
- **Lines** for ratios. House edge is GGR/bet — stacking ratios is meaningless
  and the total is a *weighted* ratio, never the mean of the category lines.
  Assert that the two differ so a mean can't creep in later.
- **A single series** when the data cannot be split (adjusted GGR). Keep the
  same bar form so the eye reads it the same way, and put the reason in the
  caption.
- **Break a line rather than dropping it to zero** where there is no data — a
  flat zero reads as "players broke even".

Every chart carries a headline strip of window figures above its legend, and
those figures must be computed over the window the filters select. A fixed
figure beside a filtered chart reads as a bug.

## 10. Filters

Build filters as **views over pre-computed data**, not as recomputation: the
builder emits each variant, the page switches between them. The established set
is granularity (days / months), period (full / MTD), and the whale toggle.

**MTD means every month trimmed to the current month's day count**, so a partial
month compares like-for-like against complete ones. This is the whole reason the
toggle exists — it is not "this month so far".

Defaults are a real decision: the page opens on whatever question it exists to
answer. Set the default in `state` *and* in the markup's `aria-pressed`
attributes — a default in only one place renders buttons that lie on load.

**Clicking a series isolates it**, showing only that one; clicking again
restores everything, and a "Show all" chip appears while anything is hidden.
Alt-click hides a single series. Hiding-on-click is the intuitive-seeming
default and it is the wrong one — people click a thing because they want to look
at it.

## 11. Test the page, not just the arithmetic

A chart that renders empty, or a script that dies halfway, is invisible to any
check on the aggregation. Render the built file in jsdom and read it back:

```
npm install jsdom
node test_<name>.js
```

`references/testing.md` has the harness and the assertion catalogue. The
assertions worth writing are the ones that encode a decision someone might
undo — that the total is weighted rather than averaged, that negative bars fall
below the zero rule, that the page opens with the whale excluded, that category
rows exceed the distinct total. Those double as documentation.

**`const` is script-scoped and never reaches `window`.** Nothing outside the
script block — the test, the console — can see it. Hand over an explicit
`window.OV = { ... }` with the state, the window builder, `render()` and the
chart configs. This is also how the existing pages get bitten across their nine
script blocks.

## 12. Before saying it's done

- Recompute the headline figures independently from the raw cache rows and check
  they match. A second implementation catches what a second reading does not.
- Cross-check one figure against a published report (August 2026 has 996 first
  depositors — the FTD report documents the same cohort).
- Sanity-check the magnitude against what the user expects. A 3–4× gap is
  usually the whale; a ~5% gap is usually an uncategorised residue.
