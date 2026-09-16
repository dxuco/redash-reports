# FTD (Country) — first deposits by country and channel, 2025 vs 2026

First deposits split two ways — by player country and by acquisition channel —
with 2025 set against 2026, on both count and dollars.

```
python build_ftd_channels.py        # caches  -> ftd-channels-data.json
python make_ftd_channels_html.py    # data    -> ../ftd-channels.html
node   test_ftd_channels.js         # renders the built page and recounts
```

`../ftd-channels.html` is **generated**. Edit `ftd-channels-template.html` and
re-bake; an edit made in the built file is destroyed on the next run.

## Where the numbers come from

The query-1732 month caches in `../ftd-report/cache`, Jan 2025 – Aug 2026, read
straight off disk. Nothing here calls Redash.

**`ftd` is a dollar amount, not a flag.** The count is distinct `player_id` with
`ftd > 0`; the amount is the sum of that field. Summing `ftd` and calling it a
count is the mistake this report is most likely to grow.

One row per player across the whole 20 months — the builder asserts it, and in
this window there are zero repeats, which is what a first deposit should look
like.

## The channel rule

Four bands, applied in this order, reproducing the attribution comment in
`../acquisition-report/gen_2025.py`:

| Test | Channel |
|---|---|
| `aff_type` Streamer, or `aff_source` Influence / KOl | **Streamer** |
| `aff_source` SEO | **SEO** |
| `aff_type` Direct | **Direct** |
| anything else | **Other** |

Source beats type, so the ~14 rows tagged `Direct` + `SEO` count as SEO.
**Other** carries Meta, Tipster, Community, Metamedia, PPC, DSP, Uncategorized
and untagged Affiliate — about 4% of FTDs. It is shown as its own band rather
than dropped or spread pro-rata, so the bands reconcile to the site total
exactly instead of to a tolerance that would also hide a dropped row.

The builder prints every `(aff_type, aff_source)` pair it saw and where it
landed. Read that list after any rebuild: a new payment of a new source lands in
Other silently otherwise.

## The monthly country charts

There are two, one pinned to FTD count and one to FTD amount, and neither
follows the Metric toggle. That is deliberate: the two rankings disagree
sharply, and reading them against each other is the point — a toggle would make
the comparison impossible. Each keeps its own drill position and its own hidden
set, so walking one does not move the other.

How far apart they are, over both years:

| | by count | by dollars | average FTD |
|---|---|---|---|
| United States | **1st**, 2,485 | 6th, $124k | $50 |
| Norway | 7th, 616 | **1st**, $347k | $563 |
| Japan | 12th, 465 | 4th, $161k | $346 |
| Germany | 2nd, 1,646 | 3rd, $189k | $115 |
| Kazakhstan | outside the top ten | 8th, $85k | $327 |

The caption under the dollar chart computes this contrast at render time from
whatever the filters select, rather than stating it as a fixed sentence that
would go stale the moment someone picks a channel.

Same form as "Active depositors by day, with bettors by game category" on
Business Overview: one stacked bar per month, top fifteen countries as bands, the
tail pooled into a grey **Other countries** rather than truncated.

Fifteen, not ten: the pooled band was 45% of FTDs and held a dozen real markets.
The palette is ordered so neighbouring ranks never sit on neighbouring hues —
adjacent bands are the ones that touch in a stack — and `inkOn()` picks navy
rather than white for the two pale fills, so a segment label can never come out
invisible.

**Other countries is a door, not a dead end.** Clicking it takes the next fifteen
by rank — 16–30, then 31–45 — with a breadcrumb and a Back chip. That matters here
because the pooled band is 45% of FTDs and holds a dozen genuine markets
(Hungary 438, Spain 422, India 407, Russia 327, Finland 310) that are each
bigger than Netherlands, which does get its own colour. Only 63 of the 143
pooled countries have fewer than 10 FTDs between them.

Below the top tier the countries ranked *above* the current block are left out
rather than pooled into a second grey lump, so the bar top is the total of what
is on screen and not the month total. The breadcrumb says so; the caption does
not claim otherwise. Alt-click still hides the band the ordinary way.

It carries **no overlay line**, and that is the difference from the game-category
chart it copies. Categories overlap — a player who bets casino and sport is in
two bands — so there the stack is taller than the truth and a separate distinct
line is the only honest total. Countries partition, so the stack height already
is the month's total and a line would just retrace it. A test asserts the bands
sum to the month total exactly; if that ever fails, the bands have stopped
partitioning and the chart needs the line back.

## The channel charts

The two channel charts are the country pair's shape applied to channels: one bar per month
split Direct / SEO / Streamer / Other, drawn twice — count and amount — and
neither follows the Metric toggle, for the same reason the country pair does
not.

They replaced a grouped 2025-vs-2026 chart. Four pairs of bars answered "which
channel changed" but hid *when* it changed, which is the whole story here:
Streamer is near zero through 2025 and overtakes SEO in the spring of 2026. The
year comparison it used to carry now lives in the **Channel Table** (09), which
is a better shape for it — shares, both years' dollars, the change and the
average first deposit, per channel.

Channels partition, so the figure on each bar is that month's total, and the
legend moves the header's Channel filter rather than keeping a second one.

**They follow a country picked in the charts above**, along with the Channel
Table and the headline strip — pick Brazil and 08, 09 and 10 become Brazil's
channel mix. That needed a third view of the window, `fCells`: country-focused
but *not* channel-filtered, because the channel split is the thing these cards
draw. `cells` ignores the country and `chCells` would delete the split, so
neither would do.

## What each selection reaches

| Selection | Reaches | Deliberately does not |
|---|---|---|
| Country (chart legend) | the country charts, the channel cards, adjusted GGR, affiliate movement, affiliate drill table | the country movement card, the concentration chart |
| Affiliate (movement row) | the country movement card | the affiliate card itself |
| Channel (header buttons) | everything except the channel cards, which draw the split | the three channel cards |
| Country exclude list | every country-grained card | the affiliate movement card |

## The quarter filter, and what "like-for-like" means

`All · Q1 · Q2 · Q3 · Q4` in the cover. It narrows **both years at once** — pick
Q1 and every card compares Q1 2025 against Q1 2026.

There used to be a quarterly *chart* as well; it was removed as redundant once
the filter existed. `quarterOf()` lived inside that chart and went with it,
breaking `win()`, `winMonths()` and the movement table — it now sits with the
filters, where its callers are.

**Period is the other half of that, and it matters more than it looks.**

- **Like-for-like** *(the default)* — the same month slots *and* the same days:
  months 2026 has not reached are dropped, and the part month's counterpart a
  year earlier is cut to day `mtdDays` as well. Trimming only the months is half
  a job; a whole August 2025 against 26 days of August 2026 is still not a
  comparison. With Quarter on **All** this is **YTD vs YTD-1** — Jan 1 to Aug 26
  in both years.
- **Full periods** — 2025 whole, 2026 as far as it goes. An opt-out, not the
  default: 12 months against 8 makes every headline wrong by a third.

Clearing the quarter back to **All** returns to like-for-like, so the page never
sits on a mismatched window by accident.

YTD vs YTD-1, all channels: **7,438 → 7,646 FTDs** but **$1,350,979 → $844,636**,
a 37% fall in money on slightly *more* first depositors. By channel:

| | 2025 YTD | 2026 YTD | |
|---|---|---|---|
| Direct | $973,358 | $416,093 | −57% |
| SEO | $330,956 | $102,082 | −69% |
| Streamer | $36,433 | $304,840 | +737% |
| Other | $10,231 | $21,621 | +111% |

**Picking a part quarter switches Period to like-for-like automatically**, and
the button visibly moves. Q3 is why:

| Q3 | 2025 | 2026 | reads as |
|---|---|---|---|
| Full periods | $393,762 (Jul+Aug+**Sep**) | $289,278 (Jul+Aug to 26th) | −27% |
| Like-for-like | $236,851 (Jul + Aug 1–26) | $289,278 | **+22%** |

Three months against two, with one of them short, is not a fall of 27% — it is a
rise of 22% wearing a calendar as a disguise. Auto-switching is a real
intervention rather than a warning nobody reads, and it is visible in the
control, so nothing is hidden.

Q1 and Q2 are complete in both years, so they leave Period alone. **Q4 forces
full periods** — like-for-like would select nothing — and raises a banner:
2026 has not reached Q4, so every year-on-year figure reads `n/a` rather than
−100%, which is not a fall but a quarter that has not happened.

Switching quarter **resets both drill positions**. A tier is a rank offset into
a window, and the new window can be shorter than the old offset.

## Country movement

The diverging table the August FTD report established, with countries in place
of sources and dollars in place of FTD counts: orange for ground lost, navy for
gained, zero pinned at the centre of the bar box, biggest loss at the top and
biggest gain at the foot.

**It compares year on year by default**, over exactly the window every other
card is showing — YTD vs YTD-1, or the selected quarter across the two years.
A card quietly comparing two months while the whole page compares years was the
one figure on the page answering a different question, and it read as a $6k gain
against the page's $506k fall.

A chip switches it to **month on month** — the newest month against the one
before, or, with a quarter selected, that quarter across the two years. In that
mode the cut differs by case, and that is deliberate:

- **Month mode trims both sides** to `mtdDays` (currently 26). The newest month
  is short, so the one before it has to be cut to the same day or the drop is
  just the calendar — August to the 26th against a whole July reads as −$16k of
  nothing.
- **Quarter mode trims only the part month and its counterpart a year earlier**;
  complete months are read whole. That keeps the figures equal to the quarter
  chart above ($715,135 → $239,473 for Q1) instead of quietly shaving the last
  days off every month.

Both rules come from `momScope()`, which returns `trimAll` so the difference is
one flag rather than two code paths. Year mode needs none of it: it reads
`win()` directly, so whatever the page is comparing, the table is comparing.

The figure is written on each bar — inside it when the bar is long enough to
hold it, just outside when it is not.

**Row count belongs to the dimension**, not to the card: `dim.rows` gives
affiliates **60** and countries **30**. There are 400-odd affiliates against
170-odd countries, and one number does not suit both. The rest are pooled into
one line, and the total row covers every row, not the ones on screen. Channel and rail apply;
the country selection deliberately does not, since this table *is* the country
breakdown.

## The movement table's columns

Ten of them, three pairs plus the bar:

```
Country | ◀ lost · gained ▶ | Change | FTD $ 2025 | FTD $ 2026 | % |
FTDs 2025 | FTDs 2026 | GGR 2025 | GGR 2026
```

The dollar columns say **FTD $** rather than just the year. Next to a `FTDs
2025` column, a bare `2025` header reads as a second count — the label is doing
real work.

The bar and the Change column are the FTD **dollars**, which is what the table
is sorted on.

## Two movement cards

The same card twice, differing only in what a row is: **Affiliate movement** and
**Country movement**. One `MOM_DIMS` entry per dimension carries the ids, the
label and which cell holds the key, so `momRender` never learns which one it is
drawing and the two cannot drift apart. A test asserts every column but the
first is identical between them, and that the three totals agree to the cent.

Both are built from `affCells` / `affMtdCells`, which carry country *and*
affiliate, so the two cards can never be assembled from different populations.
The one exception: in year mode the **country** card reads `win()` directly
instead — the same arrays the charts use, so its totals match them exactly
rather than picking up the extra 2dp rounding of the finer-grained affiliate
arrays. That asymmetry is deliberate and is why the code does not share the
path.

`(direct / untagged)` leads the affiliate table at −$563,001 and is kept rather
than dropped, for the same reason it is kept in the affiliate drill table: it is
half the FTDs, and without it nothing reconciles.

The **country exclude list cannot apply** to the affiliate card — a row there is
not a country — so it moves the country card only, and the affiliate caption
says so rather than the two silently disagreeing. The mode chip (year / month)
is shared: clicking it on either card moves both.

## The two cross-filters

They run both ways, and neither narrows the card that *is* that breakdown:

| Pick | What moves | What does not |
|---|---|---|
| A country, in any chart or legend | the **affiliate** movement card — who brought that country's players | the country movement card, which would collapse to one row |
| An affiliate row | the **country** movement card — where that affiliate's players came from | the affiliate card itself |

Both directions **drop the GGR columns** on the card being narrowed. `cohortGgr`
is keyed on country and `cohortGgrAff` on affiliate; neither carries both, so
there is no honest answer to "GGR of SBGC's players in Norway". Showing every
affiliate's revenue under one affiliate's name would be the dishonest one.
Adding a country × affiliate cohort key to the builder would fix it if the
number is ever wanted.

Each narrowed card gets its own `× Clear` chip, and a test asserts the narrowed
total equals the row that drove it — Brazil's row and the affiliate card's Total
read the same figures.

## Clicking an affiliate

Every affiliate row on the movement card is a control: click one and the
**country** card below narrows to that affiliate's players. SBGC's row and the
country table's Total then read the same figures, which is the point — a test
asserts they match exactly.

Two consequences worth knowing:

- With an affiliate picked, the country card **cannot use `win()`** — `win()`
  has no affiliate grain — so it drops to the affiliate arrays. Slightly more
  2dp rounding, scoped to that one view.
- The **GGR columns disappear** while an affiliate is picked. `cohortGgr` is
  keyed on country, not affiliate, so it cannot answer "GGR of SBGC's players in
  Norway". Dropping the columns is the honest move; showing every affiliate's
  revenue under one affiliate's name is not.

The pooled row and the Total row are not clickable, and clicking the same row
twice releases it. A `× Clear affiliate` chip appears on both cards.

## The month filter

A select beside Quarter: `All months` plus the twelve, named rather than
numbered. Like Quarter it narrows **both years** — "March" is March 2025 against
March 2026, not one month in isolation.

Month and Quarter are two grains of the **same axis**, so picking one clears the
other. Holding both would select an intersection that is usually empty and
always confusing.

The same part-period rules apply: August switches Period to like-for-like (both
sides cut at day 26, $119,655 → $139,772), and a month 2026 has not reached —
September through December — forces full periods and raises the `n/a` banner.

## Share of loss

`Share of loss` is each falling country's loss as a fraction of the **net**
change — the figure in the Total row. On Q3 / Direct / Crypto, Norway loses
$47,127 of a $106,284 fall and reads **44%**.

Net, not gross, because the net is the number on screen beside it: against the
gross decline ($118,246 there) Norway would read 40% and match nothing else on
the page.

The consequence is stated rather than hidden: **the fallers add to more than
100%** whenever some countries grew — 111% on that view — and the missing 11%
is exactly what the risers gave back. The footer prints the denominator
(`$106,284 net`) and its tooltip prints the gross alongside, so the gap is
visible instead of mysterious.

A country that grew shows an em-dash, not 0% of a loss it did not cause. And a
window that is net **positive** has no fall to take a share of, so the column
falls back to the gross decline and the footer says `lost` rather than `net`.

## Cohort GGR in the movement table

Two columns at the right: **GGR 2025** and **GGR 2026** (or the two months, in
month mode). Each is what *that* period's own first depositors booked *inside
that same period* — 2025's cohort measured in 2025, 2026's in 2026. It is not
the country's whole revenue, which is a much larger number, and the caption
says so on the page.

That definition needs both months, so `cohortGgr` is keyed on the FTD month
**and** the GGR month:

```
[ftdMonth, ggrMonth, country, channel, rail, ggr, ggrCutAtMtdDays]
```

11,309 keys, ~700 KB. A window sum takes rows where both months fall inside the
window, so a January cohort's August revenue counts only when August is in the
window too — the thing a single-month key could not express.

The builder makes a **second pass** over the caches to build it. A player can
have a GGR row in a month earlier than their own FTD (bonus play before the
first real deposit), and a single forward pass would silently drop it.

**GGR goes negative** — 15 countries do, on the YTD window — because players
win. Those cells are red with the sign before the symbol, and they are real,
not a bug to clamp. August 2026's new players are −$145,480 on the month.

## Adjusted GGR by country (13)

Monthly bars, top twelve countries plus a pooled Other, on `adjusted_ggr`.

Four things make this card unlike every other one:

- **The channel comes from the player, not the row.** Adjusted-GGR rows carry
  `player_country` and `aff_type` but never `aff_source`, and never
  `game_product`. `aff_type` alone cannot tell SEO from the rest of Affiliate,
  so the builder collects `aff_type`/`aff_source` per player across *every* row
  and looks them up here — which lets this card use the same four channels as
  the rest of the page instead of a coarser second taxonomy. **1.3%** of the
  dollars sit on Affiliate players whose source was never recorded anywhere and
  land in Other; the build prints that figure and the caption states it.
  The **Rail** filter genuinely cannot apply — it needs a deposit row, and these
  are not deposit rows. A test asserts the Channel filter moves this card and
  the Rail filter does not.
- **It is signed.** Adjusted GGR goes negative when players win — 31 countries
  do — so positives stack up and negatives down from a darkened zero rule, never
  clamped and never piled in with the positives. A test checks segments really
  are drawn below that rule.
- **Bands are ranked on absolute value**, so a country losing a fortune sorts
  above one making a little instead of being buried at the bottom.
- **It carries the whale toggle**, and it is the only card that does. The top
  depositor is **52%** of all adjusted GGR — the one figure on this page he
  moves — so the house convention (carve him out by default, offer him back)
  earns its place here and nowhere else.

Ex-whale, by channel:

| | 2025 | 2026 | |
|---|---|---|---|
| Direct | $4,064,062 | $7,005,189 | +72% |
| SEO | $1,921,240 | $1,662,573 | −13% |
| Streamer | −$48,585 | $4,894 | — |
| Other | $257,132 | $453,837 | +76% |

Streamer is the one to look at twice: it brings a third of 2026's first
depositors and has produced essentially no adjusted GGR in either year.

**Adjusted GGR is not raw GGR minus bonus cost.** It is computed upstream over a
different scope; never "fix" a discrepancy by subtracting.

### `winMonths()`

Adding this card exposed a coupling worth knowing: `win().months` is derived
from the FTD cells that survive filtering, so a Rail filter that empties a month
drops that month from the list. Correct for the FTD cards, wrong for a card the
rail cannot apply to — it would lose the month with it. `winMonths()` derives
the month list from the calendar and the period / quarter / month filters
instead, and the adjusted GGR card uses that. A test asserts the Rail filter
leaves this card untouched.

## Concentration by rank tier

A 100% stacked bar per month: top 5 countries, ranks 6–10, everyone else, on
FTD dollars. Over the full window that is **41% / 16% / 43%** — the top five
(Norway, Brazil, Germany, Japan, Canada) carry as much as the other 148 put
together, and the share has been climbing: 35% in H1 2025, 44% in H2, 45% in
2026 to date.

Two decisions this chart rests on:

- **The tiers are a fixed set of countries**, ranked over the whole selected
  window and then held still month to month. Re-ranking inside each month would
  make the top band mean "whoever led that month", which can only ever rise and
  answers a different question. A test asserts the top-five share moves between
  the first and last month, which it could not if the tiers were re-ranked.
- **Each bar carries its dollar total above it.** A share read without its size
  is half a fact — 70% of $28k and 70% of $198k are not the same month. The axis
  is pinned 0–100% for the same reason: rescaling would make identical mixes
  look different.

The country focus is deliberately ignored here — with one country picked every
bar would read 100%. Channel, rail and period do apply.

## The affiliate table, and the shared country focus

Clicking a country in **either** country chart sets one shared focus: both
charts and the affiliate table follow it. Three panels on one screen describing
three different populations is worse than any of them being slightly wrong, so
the selection lives in `state.focus`, not in a per-chart hidden set. Alt-click
still hides a single band the ordinary way, per chart.

The affiliate table under them is `aff_username` × month, each cell carrying the
FTD count with the amount underneath — an affiliate that brings volume and one
that brings money are different things and the table exists to tell them apart.
It follows the country focus, the channel filter, the rail filter and the
period. 9,561 FTDs (50%) carry no affiliate username, almost all Direct; they
are kept as their own `(direct / untagged)` row so the table reconciles to the
charts exactly rather than quietly falling short of them.

## Payment rail

An FTD row carries no `blockchain` of its own — that field lives on the deposit
rows. Every FTD in this window has a same-player, same-day deposit row (the
builder asserts it), so the rail is read across from there:

| | FTDs |
|---|---|
| Crypto | 17,261 |
| Fiat | 1,629 |
| Mixed | 68 |

A day with both a card and a coin deposit is **Mixed**, not silently assigned to
one of them. `FIAT_RAILS` / `KNOWN_RAILS` are copied verbatim from
`ftd-report/month-aggregate.js`; a new rail must be added in both places in the
same change, and the builder prints anything outside `KNOWN_RAILS` rather than
letting it default into crypto.

The split barely moves by channel — Direct 92% crypto, SEO 88%, Streamer 95% —
except in Other, which is 29% fiat, three times the site rate.

## The country exclude list

A chip in the page bar lifts eight countries out of every figure at once:
**Brazil, France, Italy, Japan, Kazakhstan, Norway, Russian Federation, United
Arab Emirates.**

It is **off by default**. These are eight of the biggest markets, not noise —
39% of FTD dollars in the YTD window — and a page that hid them without being
asked would understate the business by more than a third. The chip's tooltip
says what turning it on would remove *before* you press it, measured over the
current window rather than written down, and the subtitle carries "excluding 8
countries" while it is on so a screenshot cannot be misread.

Names are the raw `player_country` values. A typo would silently exclude
nothing, so the chip counts what it actually matched and a test asserts all
eight exist in the data.

YTD vs YTD-1 with them out: **$791,200 → $538,227** (−32%), against −37% with
them in.

`win()` applies it, and so do the two panels that read `DATA` directly rather
than going through `win()` — the affiliate table and the month-on-month
movement table. Those two are the ones that silently disagree with the charts
whenever a new filter is added; check them first.

## Collapsing

Every card collapses from its own heading (keyboard reachable; `Enter`/`Space`),
with `Collapse all` / `Expand all` at the top of the page. The state is a class
on `.card`, not on `.body`, so a re-render never reopens a card someone shut.

**Every card opens shut** — the page is an index of what it holds, not twelve
feet of scrolling, and `Expand all` sits in the page bar for the times you want
the lot. Marked with `data-shut`, marked with `data-shut` in the
markup so the default is visible at the card rather than buried in a list of ids
here. in the markup so the default is visible at the card rather than
buried in a list of ids here. A test asserts all twelve are shut on load, and
that the charts and tables are nonetheless **built** — shut is `display:none`,
not "not rendered", so expanding a card shows it immediately instead of an
empty box until the next render.

The channel table used to sit inside the "FTD by Channel" chart card; it has its
own card now so it can collapse independently.

## Section numbers, and the twelve sections

The numbers are written by the same loop that wires the collapse, from the
cards' order in the document, so a card moved in the markup renumbers itself.

Three headings are rewritten at render time (04, 05, 07). They own a
`.sec-title` span and `setHeading()` writes into that — setting the `h2`'s
`textContent` deletes the section number and the show/hide affordance with it,
which it silently did until a test caught 04, 05 and 07 missing their numbers.

```
01 FTD Count by Countries          07 Affiliates by Month
02 FTD Amount by Countries         08 FTD Count by Channels
03 FTD Amount by Quarters          09 Channel Table
04 Affiliate Movement              10 FTD Amount by Channels
05 Country Movement                11 FTD by Country, 2025 vs 2026
06 FTD Amount Concentration        12 Country × Channel Table
```

## Traps

- **The whale doesn't matter here.** Player 1709996 first deposited in an
  earlier year, so he is not in this window at all and the ex/inc variants are
  identical. The builder still emits both, and the page says so, rather than
  offering a toggle that does nothing.
- **2026 is a part year.** The default view is full 2025 (12 months) against
  2026 to date, which the user asked for — so 2025 is bigger partly because it
  is longer. The **Jan–Aug matched** toggle trims 2025 to the months 2026 has;
  that is the comparison the percentages actually mean something in. On matched
  months FTD *count* is flat year on year (7,542 → 7,646) while the *dollars*
  fall by 39%.
- **The page opens on Direct**, not on everything. That default is set in
  `state.offCh` *and* in the markup's `aria-pressed`; a default in only one
  place renders buttons that lie on load, so the test snapshots the pressed
  buttons at load time and asserts both agree.
- **Country is `player_country`, unedited.** `VPN Player` is a real value in the
  data and gets its own row; it is not a bug to clean up.

## Cross-check

`test_ftd_channels.js` recounts every year × channel cell from the raw cache
with a second implementation, and reproduces the published August 2026 cohort:
counting FTDs over Aug 1–21 gives **996**, the figure the FTD report shipped.
The cache now runs to Aug 26, which is why this page shows 1,163 for the month.

Amount assertions use a rounding budget (`cells × 0.005`) rather than a flat
`< 0.01` or a percentage — the builder rounds each emitted cell to 2dp, so a
difference inside the budget is rounding and anything past it is a dropped row.

## The nav bar, and a trap worth knowing

`publish-worker.js` injects the site switcher by regex-matching the raw file for
the opening `body` tag and taking the **first** occurrence. Any earlier literal
copy wins — including one inside a comment.

This page had exactly that: a comment above the tag explaining why the tag was
needed, containing the tag. The bar was injected *into the comment*. The page
rendered perfectly with no switcher on it, which read as the nav being lost when
you clicked something rather than never having been inserted.

So: never write that tag literally above the real one — not in a comment, not in
a selector, not quoted in prose. `test_ftd_channels.js` now injects the bar the
way the publisher does and asserts it lands as the first child of `body` and
survives the controls.

## Not published

The page is not registered in `publish-worker.js`, so it stays local. Adding an
entry to `REPORTS` and a key to `NAV_ORDER` there puts it on the site.
