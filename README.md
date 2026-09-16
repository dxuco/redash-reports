# Bonus Cost report — how it works

Live at **https://reports.veisreports.workers.dev**
Rebuilt from Redash every morning at 08:00.

---

## Updating everything in one go

**`UPDATE-EVERYTHING.bat`** — double-click it. That is the whole thing. It rebuilds
all four scripted reports from source and publishes the site:

| # | Report | Built by | From | Lands at |
|---|---|---|---|---|
| 1 | Bonus Cost | `build.js` | Redash 1731 + 1732 | `/` |
| 2 | FTD Report | `build-ftd.js` → `make-ftd-html.js` | Redash 1732 | `/ftd` |
| 3 | FTD *this month* | `build-month.js` → `make-month-html.js` | the cache step 2 just refreshed | `/august-2026` |
| 4 | Acquisition & CPA | `build_acquisition.py` | Redash cache + Google Drive cost sheet | `/acquisition-2026` |
| 5 | Cost 2025 | `gen_2025.py` | `params.json` from step 4 | `/acquisition-2025` |
| 6 | Business Overview + FTD Share | `overview\build_overview.py` etc. | the caches step 2 refreshed | `/overview`, `/ftd-share` |
| 7 | Retention | `retention\build_retention.py` → `make_retention_html.py` | the caches step 2 refreshed | `/retention` |
| 8 | Reactivation | `reactivation\build_reactivation.py` | the caches step 2 refreshed | `/reactivation` |
| 9 | *(retired — retention-full is no longer built; step 7 is the retention page)* | — | — | — |
| 10 | — | `publish-worker.js` | all of the above | Cloudflare |
| 11 | — | `verify-public.js` | the live site | confirms the login still holds |

Takes roughly 10–20 minutes, most of it step 1. **A failing step does not stop the
rest** — whatever could not be rebuilt goes out as its previous copy and is listed at
the end, so a dropped VPN never takes the site down. Re-running it is always safe.

**`INSTALL-DAILY-UPDATE.bat`** — run once, *as administrator*, and Windows runs the
above every day at the time in `config.env` (`BUILD_HOUR`/`BUILD_MINUTE`), plus five
minutes after each logon so a sleeping machine catches up. It replaces the old
`Bonus cost report` task, which only rebuilt page 1 of 4. Output goes to
`update-all.log`. Unlike the `start.bat` timer, this does not need a window left open.

---

## Business Overview and FTD Share

`overview\` holds both, and they are the only reports here that make **no Redash
calls at all** — they read `ftd-report\cache\*.json`, which step 2 has already
refreshed. Four commands, in this order:

```
cd overview
python build_overview.py      reads the caches      -> overview-data.json  (~2m)
python make_overview_html.py  bakes a subset        -> ..\business-overview.html
python build_drilldown.py     reads the caches      -> drilldown-data.json (~25s)
python build_mix.py           reads both            -> mix-data.json
python make_mix_html.py                             -> ..\ftd-share.html
```

**FTD Share reads the Business Overview's dataset, not the caches.** Re-deriving
it would give two pages that can disagree about the same number; `test_mix.js`
asserts they report identical figures. That is also why it runs second.

### The two pages stack different numbers of bands

Business Overview stacks three FTD cohorts — this year, last year, everything
before. **FTD Share stacks five**: Pre-2025 was much the largest band, $10.6M of
$17.7M of adjusted GGR, and "everyone who joined before last year" stopped being
an answer at that size. It is now FTD 2024, FTD 2023 and Pre-2023.

`fine_cohort_of()` in `build_overview.py` is a *refinement* of `cohort_of()`, not
a replacement, and the two live side by side:

- The finer bands are emitted as `back2`, `back3`, `older` and added to `EMIT`,
  not to `COHORTS` — so they never appear in the Business Overview's cohort
  filter, where they would sit beside `pre` and overlap it. Same arrangement the
  `new` cohort has had.
- The keys are **offsets from `curYear`, not years**. A key called `y2024` would
  still be called that in 2027 while holding 2025's players, and the page's label
  would go on reading "FTD 2024" — the hardcoded-year failure the retention pages
  document, and just as silent. The page builds every label from `curYear`, and
  both suites assert it.
- `pre` is still built, still carried into `mix-data.json`, and no longer
  stacked. It is what the finer three are checked against: `build_overview.py`
  refuses to write a dataset where they do not reconstitute it, and `test_mix.js`
  checks it again on the built page, on money and on the range distinct count.
- The three finer cohorts get **no crypto/fiat variants**. The rail filter
  belongs to the Business Overview, which stacks the coarse three; building six
  more views a month that nothing reads would grow a 7.6 MB dataset for nothing.

Colours are the one deliberate exception to the nominal-colour rule in
`theme.css`: the older three are a purple ramp rather than unrelated hues,
because they are one band split three ways and the family is what reads against
the coarse page. FTD 2024 is light enough that white numerals smudge, so a band
may name its own `ink` and the drawer uses it.

**The no-cohort band starts hidden.** Players betting on bonus money with no
first deposit ever are 42% of bettors — large enough that leaving them on makes
the cohort bands the minority of a chart about cohorts. Hidden, never dropped:
the chip renders struck through with its figure, one click brings it back, a
"Show all" chip is up from the first paint, and the residual arithmetic is
untouched, so the bands still reconcile to the total exactly.

### The acquisition-channel filter

FTD Share has a fourth switch: **All channels / Direct / Affiliate / Streamer**,
from `aff_type`. Every chart, every headline and the drill-down read it, so
there is never a filtered bar above an unfiltered table.

It needs no "dominant" rule, unlike the rail filter: `aff_type` is on every row
that carries a `player_id`, holds one value per player, and **never changes** —
checked across all 20 months and 422,566 players, zero changes. So the segment is
read straight off the row. The rows it cannot classify are the ones with no
player at all (click and sign-up aggregates, ~10,000 a month); they carry $0 of
deposit, bet, adjusted GGR and NGR, so nothing this page plots is lost, and
`build_overview.py` refuses to write a dataset where the three segments fail to
reconstitute the unfiltered view on any of the four measures.

Channel and rail **share one suffix slot** in the view key and are never
combined — the rail filter belongs to the Business Overview and the channel
filter to FTD Share. `"cohort:whale"` still means exactly what it always did, so
the whale toggle and the cohort bands needed no changes.

The buttons are generated from `DATA.chanSegs` with `aria-pressed` read off
`state.chan`, so a fourth acquisition type appears the moment the builder emits
one, and the switch cannot open claiming a filter the page is not in.

**`build_overview.py` writes 78 views a month now, and `make_overview_html.py`
bakes 30 of them.** The dataset is shared, but the Business Overview has no
control that reaches the finer cohorts or the channels, and baking them would
double a 6 MB page for nothing. The maker drops views by KEY shape rather than by
a list of what to keep, so a segment added for the other page is excluded here by
default instead of silently inflating this one.

#### The MTD range bug this filter exposed

`build_overview.py` capped the range windows by **position** in `days[]` —
`n = cap` — and `days[]` holds only the days that had activity. Index 29 is the
29th *active* day, not the 29th of the month. A filtered view is sparse where the
unfiltered one is dense, so streamers' MTD window ran past the cut and picked up
people who only deposited later in the month: the three channels came to **21
depositors more than the total they partition**.

Every view on that path was exposed. The cohort and rail views happened to be
dense enough that none of their published figures moved when it was fixed, so the
only wrong numbers were the new ones — but the fault had been there since the
rail views were added. The page's own `buildWindow()` has always capped by date,
with a comment saying why; the two simply disagreed. Both now cap by date, and
`test_mix.js` asserts the channels partition the depositor and bettor bases
exactly, which is the check that catches this whole class.

### Clicking a bar: the players behind a segment

Clicking inside a bar on FTD Share opens the **top 20 players** in that month ×
cohort, with country, first-deposit date, channel, affiliate, deposits and
adjusted GGR. "VPN Player" is a country value there, not a gap — it is what the
field itself says, and the Business Overview stacks the same field.

**Channel and affiliate are two columns, and must stay two.** `aff_username` used
to fall back to `aff_type` when a player had no affiliate, so a single column
meant "name, or channel if there is no name" and no row told you which you were
reading. 1,719 players in August are `aff_type` Direct **and** carry an
`aff_username` (TornikeZ/Metamedia, community_gio/Community, justsomething777) —
collapsed, they read as affiliate-acquired. `test_mix.js` asserts the affiliate
column never contains a channel label, and that some ranked player is Direct with
an affiliate name, so the case that motivated the split cannot quietly vanish.

`aff_source` is in the cache too — SEO, Influence, Metamedia, Community, Meta,
Tipster, KOl, Uncategorized, ten values — and is not shown. It is one column away
if it is wanted. Isolating
a colour band stayed on the legend chips — a click in the plot that both
reshaped the chart and opened a table would do two things at once, and what
people point at a segment for is "who is that".

`build_drilldown.py` is the one thing here that reads the caches directly, and it
has to: an aggregate cannot name a player. It imports `fine_cohort_of` — the
five-band rule, not the coarse one — along with `num` and `WHALE_IDS` from
`build_overview.py` rather than copying them, so the two cannot put the same
player in different cohorts. Three properties of the file worth knowing before
changing it:

- **Months only.** A top 20 for every day of every month is thirty times the rows
  for a question nobody asks of a single day, and it would put tens of megabytes
  into a file that has to open by double-clicking. In the Days view the panel
  says so instead of rendering empty.
- **Each channel is ranked within itself**, so the key is
  `ym|band|channel|period` with `channel` empty for the unfiltered view. Four
  cuts of every segment rather than filtering the unfiltered pool on the page:
  the top twenty streamers are mostly not in the overall top twenty-five, and
  the cheap way round renders a short, wrong list under a correct-looking bar.
- **The whale is in the lists and flagged**, not built as a second `ex`/`inc`
  pair like every aggregate. He is one player, so the ex-whale top 20 is the
  baked list minus him — which is why it bakes 25 per measure, or the view the
  page opens in would render 19 rows. `test_mix.js` checks his drilldown adjusted
  GGR equals the gap the whale toggle opens in the aggregates: the one place the
  two builders' readings of the cache can be compared to the cent.
- **Ranked by signed value, not magnitude.** "Top players" means the biggest
  contributors to the bar; a $200k loss is not one. The builder emits both tails
  anyway, so the page's ranking is never truncated by the builder's choice. A
  consequence the panel states rather than hides: the twenty can exceed 100% of
  a segment that other players in it lost money out of.

#### Why the axis fills its plot: `TICKS = 7`

The drawer asked `niceStep` for 5 intervals, which over a 3,118 peak chose a step
of 1,000 and topped the axis at 4,000 — a fifth of the plot empty air, and four
gridlines to read 20 stacked months against. **7 chooses 500 and tops at 3,500**:
the plot fills and a segment is read off the axis instead of guessed at. Above
about 8 the labels start crowding at the left edge. A chart can override it with
`ticks`; none does.

This replaced a hardcoded `yMax: 3500`, **which was wrong twice for the same
reason and is worth not repeating**. A fixed top cannot track a window whose size
changes:

- the days view peaks around 340 against a whole month's 3,118;
- the months view itself falls to ~600 in the first days of a month, because MTD
  trims every month to the current one's day count — on 2 September that is two
  days.

Both times every bar was crushed into the bottom tenth of the plot, which is
worse than the axis being replaced. Keying the pin by granularity fixed the first
case and not the second, because the second is the calendar, not the view.

Asking for more gridlines gets the *same* 0, 500 … 3,500 axis in the window the
pin was sized for, and follows the data everywhere the pin was wrong. `test_mix`
walks Active depositors and Active bettors through all three windows and asserts
in each that the tallest bar fits **and** clears the top gridline but one — so
neither a clipped bar nor a sliver lands unnoticed. None of those assertions names
a number the calendar can change, which the pinned versions of them did.

#### Closing a table

Three ways, because the Close button sits at the far right of an 1800px card, a
long way from the segment that was clicked: the button, **Esc**, or a click
anywhere outside the card. Clicking the same segment again also closes it.

Esc closes the panel opened **most recently** and unwinds the rest newest-first —
that is what `seq` on the drill state is for; closing an arbitrary one would be
worse than not binding the key. The click-outside handler runs in the **capture**
phase and only mutates state, deferring the redraw to a `setTimeout`. Both halves
are load-bearing, and getting either wrong looks like the feature working:

- by the bubble phase `render()` has often replaced the clicked element, so it
  reads as outside every card and closes the panel the click just opened;
- redrawing inside the handler tears the clicked element out of the DOM before
  its own listener runs, so clicking a bar on another chart closes the first
  panel and never opens the second.

The cover is exempt — its buttons are the page's filters, and changing a filter
is not clicking away from the table.

#### Sorting the table

Every column is clickable and **the table opens on adjusted GGR, descending**, on
all six charts. Two different questions are kept apart, because conflating them
is how a sortable drill-down starts lying:

- **A money column re-picks the twenty.** Clicking Deposits gives the segment's
  top 20 depositors, not the top 20 by GGR rearranged. That is exact rather than
  convenient: the builder bakes the top 25 by each of the four money measures, so
  the top 20 by any of them is genuinely inside the pool.
- **A text column only reorders.** There is no "top 20 by country", so Player,
  Country, First deposit and Affiliate sort the twenty already chosen — and the
  caption keeps naming what they were chosen by, so a table sorted by Affiliate
  never reads as "the segment's affiliates". Blanks sort last in both directions;
  a missing affiliate is not "before A".
- **A share is only quoted for the chart's own measure.** Sort the adjusted-GGR
  panel by Deposits and the twenty hold $686k against a $433k bar — 159% of a
  number they are not part of. The caption states the sum and says what the bar
  plots instead. `rank` on each chart is what that check reads.

`dir` is +1 ascending, -1 descending for both kinds of column, written once. Text
and numbers each carrying their own sign convention is what made the arrow, the
caption and the rows disagree in three different directions the first time.

A headcount chart has no money measure of its own — every active depositor counts
one — so Active depositors names deposited dollars and Active bettors turnover,
and their captions quote the size of the pool instead of a share. The suite
asserts that so nobody "tidies it up" to equal `metric`.

The two built `.html` files at the folder root are generated — edit
`overview-template.html` / `mix-template.html` and re-bake. An edit made in a
built file is destroyed by the next run.

Both pages bake their data in at build time, so **a fresh cache changes nothing
until these run**. That is what step 6 is for; before it existed the pages sat
at whatever day they were last built on while everything around them updated.

Checking them, after `npm install jsdom`:

```
node overview\test_overview.js     100 checks
node overview\test_mix.js           57 checks
```

They render the built page in a headless DOM and read it back — the charts, the
filters, and the counting rules that are easy to get wrong (distinct never sums;
the house-edge total is a weighted ratio, not the mean of the category lines;
cohorts partition the depositor base exactly). Several real bugs on these pages
were caught by that and by nothing else.

## Deposit Retention

**One page: `retention\`, published at `/retention`.**

| Route | Folder | History | Source | Rebuilds without VPN |
|---|---|---|---|---|
| `/retention` | `retention\` | 2025 on, ~19k first depositors | the month caches | **yes** |

There was a second build — `retention-full\`, the whole base from 2019 via Redash
query 1758, ~89k first depositors — and it used to hold `/retention`. **It is no
longer built.** Step 9 is a no-op, `retention-full.html` is gone, and this page took
over the route rather than leaving a bookmark that no longer resolves.

The folder keeps its builder, template and suite, so reviving it is running the two
scripts in it; the suite exits with a note instead of a stack trace while the page is
absent. Two things to know before doing that: it needs Redash and the VPN, and its
"blocked" dimension never meant the same thing as this page's (see below). While it
existed the two validated against each other over the months both covered — Super
Qualified 62.8% vs 62.7%, Qualified 53.1% vs 53.1% — which is the record of agreement
between two implementations reading two different sources.

`retention\` makes **no Redash calls** — it reads
`ftd-report\cache\*.json`, which step 2 has already refreshed.

```
cd retention
python build_retention.py     reads the caches   -> retention-data.json  (~22s)
python make_retention_html.py                    -> ..\retention.html
```

The question it answers is narrow on purpose: **of the players who made a first
deposit in period P, what share funded the account again by day N.** Betting is not
retention here. A player who bets every day for a month on their first deposit and
never tops up is *not* retained on this page, and that is the intended reading — it
is the number the acquisition spend is judged on.

Day 0 is each player's own `first_deposit_date`, so every cohort starts at the same
origin. A deposit on day 0 is a top-up of the first deposit rather than a return, so
day 0 is always zero and is not a column.

**It opens on monthly cohorts and the latest cohort year** — twelve rows you can take
in at once rather than fifty-two you scroll. The year is read from the data rather
than hardcoded, so on 1 January it follows the calendar instead of opening on an
empty table; both test suites assert that specifically, because a hardcoded year
fails silently. Weeks and the whole history are each one click away, and the
freshness argument for weeks below is unchanged — it is just no longer what loads.

**The page is three tables and no prose.** It was built with milestone tiles, a
return-curve chart, a milestone-trend chart, a notes card, an explanatory note under
the table and a provenance footer. All were removed on request, in that order. Two
consequences:

- **The controls that survived are the ones the table obeys**: Weeks/Months, the
  maturity toggle, the cohort year, and one control per filter dimension. All are
  named in the card's header strip, so what a figure was filtered by is visible
  beside it, not only in the cover.
- **Status, channel, rail and KYC are segmented switches; the rest are dropdowns.**
  A switch shows every option at once and takes one click to change, which is worth
  the width for a short, frequently-used dimension and not worth it for all of them —
  seven switches would be three rows of chrome above the table. `PILL_DIMS` at the top
  of each template holds the set; adding a key moves that dimension and nothing else
  changes. Both test suites drive a dimension through whichever control it has, so one
  moving does not silently stop it being exercised.
- **A switch does not render an option no player is in.** "KYC unknown" is empty now
  that every cached month carries `kyc_status`, and a permanently-dead button invites
  a click that can only produce an empty table. The dropdowns keep their full option
  list, so nothing is hidden from the data model, and the option returns by itself if
  a future month ever lands without the column.

### "Blocked" means two different things on the two pages

This is the one trap in the retention pages, and it is on by default, so read it
before trusting either filter.

| | `retention\` (`/retention`) | `retention-full\` *(retired)* |
|---|---|---|
| Dimension | **Account status** | **Account restriction** |
| Source | `player_status` (query 1732) | `player_restriction_requests` (query 1758) |
| Means | the account's own state | somebody filed a restriction |
| Default | Active | No restriction |
| 2026 cohorts excluded | **1,170** of 7,544 | **9** of 7,503 |

An order of magnitude apart, for what sounds like the same filter. `block_reason` is
only populated when a restriction request was actually filed and processed, which is
rare for recent players; the dormant sweep that fills most of it hits old accounts (7
of the 2026 cohorts, 16,892 across the whole base).

**So "No restriction" on the whole-base page does not mean "not blocked."** The labels
were renamed from Blocked/Not blocked to say restriction instead, so the two are not
read as interchangeable — the filter still does exactly what it did, it just no longer
claims more than it delivers.

**Closing the gap is one column.** Query 1758 already joins `public.players p`, so
adding `p.status` and building the dimension from that would make the whole-base page
filter the same population as the other one. That is a change to a shared saved query
and has deliberately not been made without asking.

### Account status, and why it defaults to Active

`player_status` gives Active / Blocked. **The page opens on Active**, on both builds
(`blk` = Not blocked on the whole-base one). A blocked account cannot come back, so
counting it as churn measures the block rather than the retention.

Two things to know before reading anything into it:

**It moves the headline the other way from what you would guess.** Over the 2026
monthly cohorts, D30 goes from 36.8% with everyone to **34.0%** with blocked players
excluded — blocked accounts retain *better*, not worse. That is not a paradox: a
bonus abuser deposits repeatedly and is caught precisely because of it, so on a
deposit-return measure they look like the best players on the page.

**The status is today's, not the cohort's.** A player blocked last week drops out of
their 2025 cohort even though they were entirely active in it, which biases older
cohorts towards survivors. The header strip always names the filter for that reason —
a page that quietly excludes people is worse than one that excludes them out loud —
and `Any status` is one click away.

Defaults come from the builder, not the template: each entry in `DIMENSIONS` may
carry `"dflt"`, and the page does `state.sel[dim.key] = dim.dflt || 'all'`. Both test
suites assert the page honours whatever the builder emitted *and* that the strip
names any non-`all` default, so a filter can never be applied silently.
- **Every mark explains itself in a `title`, because nothing else can.** The dashes,
  the `·` on an immature row, the `partial` badge, the `n=` under a thinned cell, and
  each footer figure's cohort count and span are all on hover; the build date sits on
  the cover subtitle the same way. Those attributes are the only documentation left
  on the page — `test_retention.js` asserts each of them, so stripping them out fails
  the build rather than quietly leaving a table of unexplained symbols.

### "by day N" and "after day N" — the switch on the retention card

Two questions, opposite shapes, and the difference is the whole reason the builder
stores each player's **last** return as well as their first:

| | means | shape |
|---|---|---|
| **by D7** | deposited again at any point in days 1–7 | cumulative, rises across the row |
| **after D7** | still depositing *beyond* day 7 — at least one deposit between day 8 and day 90 | survival, falls across the row |

**A survival figure needs a week of watching past the milestone.** Watch a cohort
to day 63, ask "still depositing after day 60", and the only way a player can say yes
is a deposit inside those three days — the rate collapses towards zero and prints
`0.0%` beside a perfectly healthy `n=`, which reads as terrible retention rather than
as no measurement at all. That is exactly what a 116-player cell did at D60 in the
weekly view, dragging the All-cohorts figure down with it. So a cell is computed only
where the cohort has been observed to day N **plus seven** — the same span the D7
column already treats as long enough to see a return in. It costs nothing where it
matters: every one of May's 1,080 players clears day 1 plus a week many times over.

**The page opens on `after Dn`** — it falls across the row the way a retention curve
is expected to. The cost is coverage: `after Dn` needs the cohort watched a week past
the milestone before a cell is publishable, so the newest rows carry more dashes.
`by Dn` needs only N days and fills in sooner, at the price of rising rather than
falling; the headers say `by D7` in full, never a bare `D7`, so the two are never
mistaken for each other. One click apart.

**2,425 players returned only inside their first 7 days.** They are in `by D7` and out
of `after D7`, and no arithmetic on the first return alone can separate them — which is
why this needed new data rather than a new formula. The suite asserts that population
is non-empty, so the two measures can never be collapsed into one.

**Eligibility is per column, not per horizon** — the same rule the cumulative measure
uses. To ask whether somebody kept depositing after day 7 you need them watched *past
day 7*, not for the whole 90.

The first version of this required the full horizon, on the argument that a partly
observed player might yet come back. It withheld May 2026's entire row — 1,080 players
each already observed 84 days or more — to avoid a bias worth at most six days at the
tail of an 89-day window. That trade was backwards, and it took being asked three
times to see it. Per-column eligibility is the fix.

What survives of the concern is real but smaller: **a cohort watched 40 days has had
less time to keep depositing than one watched 90**, so its figures are a floor rather
than a finished rate. Rows shorter than the horizon carry a `43d window` badge saying
exactly how long they were watched, and every cell in them names the window in its
tooltip. A floor is never presented as a rate.

`after D90` is always a dash: nothing can be after day 90 inside a 90-day window.

**A row that can show nothing says why on the row.** The survival measure needs the
full 90-day window, so the newest three or four cohorts have no columns at all — seven
dashes beside a four-figure player count reads as a broken table. Each such row now
carries a muted badge:

| badge | means |
|---|---|
| `needs 90d` | nobody in this cohort has had 90 days yet. Nothing to show in either mode; it fills in as time passes. |
| `at risk only` | some have, not all. **Switch to At risk** and the row appears, marked with the `n=` it was computed on. |
| `too few yet` | fewer than 30 qualify, under the noise floor. |

The test asserts every badged row is genuinely empty *and* every empty row is genuinely
badged — a badge on a row with figures, or a blank row with no badge, are both worse
than no badge — and that the `at risk only` rows do fill in on the switch, by name
rather than by count, so the badge is a direction rather than an apology.

A **% / Players** switch sits beside it. Every cell also names its own count on hover —
"174 of 638 first depositors were still depositing after day 7" — because reading a
headcount off a percentage needs a calculator.

**The whole-base page has the switch removed, not broken.** Query 1758 returns the
first return only, so `players.last` is absent there; the page notices and drops the
control rather than crashing on it, the same self-enabling rule the filter dimensions
follow. It appears by itself once the query and builder emit it.

### The monthly triangle — a different measure, not a coarser one

Under the day table, the classic cohort triangle: rows are cohort months, columns are
**M1…M12**, and a cell is the share of the cohort that deposited during that calendar
month. Pooled over 2025–26 with blocked players excluded:

```
        M1     M2     M3     M4     M5     M6  ...  M12
      16.7%   8.5%   6.2%   5.4%   4.7%   4.6%      3.2%
```

**It falls, where the day table rises, and both are right.** The day columns are
cumulative — "had come back by day N", which can only go up. These are point-in-time —
"deposited in month N", which is what people usually picture when they say retention.
A player who returns in month 1, goes quiet in month 2 and comes back in month 3
counts in M1 and M3 and **not** in M2. **966 players on this data do exactly that**,
which is why the triangle cannot be derived from the first-return lag the day table
uses and the builder emits a separate 24-bit month mask per player.

**There is no M0 column, deliberately.** In a conventional triangle M0 is the
acquisition month and reads 100%. Here it would read about 30% — the share who came
back *again* inside their own first month — and a column that looks like the
convention and means something else is exactly the trap the bare `D1` header fell
into. The test asserts M0 stays absent.

**Rows are always calendar months**, whatever the Weeks/Months switch is on: "month 3
of a week-long cohort" has no meaning. It does obey the year and the dimension
filters, so it never disagrees with the tables around it.

**The newest column of every row is a part-month.** The cache stops mid-month, so a
cohort's most recent column understates until that month closes. Under **Complete
cohorts** those cells are withheld; under **At risk** they appear marked `part`, which
produces the diagonal of part-months down the triangle. Months that have not happened
at all are always a dash — `verify_retention.py` asserts no cohort shows activity in a
month that has not occurred, which is the check that catches month arithmetic being
off by one.

### The second table: ADPU and ARPU per cohort

Under the retention table, the same cohorts and the same columns, in money.
**ADPU** is deposits per cohort member and **ARPU** is revenue per member, both
cumulative from day 0 — the first deposit itself is part of what an acquired player
is worth, unlike retention, where a same-day top-up is not a return. A metric switch
picks between three:

| | 2026 cohorts, active players, by D30 |
|---|---|
| ADPU — deposits | $391 |
| ARPU — NGR | $79.13 |
| ARPU — adjusted GGR | $108 |

Both revenue definitions are offered rather than one being chosen for you: NGR and
adjusted GGR are computed upstream over different scopes and are **not** each other
plus or minus bonus cost. The header strip always names which is on.

It shares the retention table's denominator, so a filter moves both and a rate always
has the money that produced it directly underneath.

**Three things about it that look wrong and are not:**

- **ARPU on NGR can fall across a row.** NGR is net of what players win, so a cohort
  that runs hot in week two is worth less at D14 than it was at D7 — the pooled 2026
  figure drops from $14.42 at D1 to $8.05 at D3. ADPU cannot fall, and the test
  asserts both: that deposits only accumulate, and that NGR does not, so nobody
  "fixes" the value table into a running maximum.
- **It is an arithmetic mean over a very skewed set.** That is what ADPU and ARPU mean
  and it is the right number for unit economics, but the top 1% of these players carry
  **58% of deposits and over 100% of NGR** — over, because the players who win are
  netted against them. Every footer cell says so on hover.
- **The last column is "value by day 90", not "value to date".** $9.4M of deposits
  from these cohorts landed after day 90 and are out of scope, matching the horizon
  the rest of the page uses.

**Two bugs this table's verifier caught, neither visible on the page:**

`bucket_of()` returned bucket 0 for a *negative* lag, so revenue earned **before** the
first deposit — no-deposit bonus play — landed in day 0. It was −$29,337 of NGR across
these cohorts (negative because players won it) and $0 of deposits, since a deposit
cannot precede the first deposit. ADPU was therefore perfect while ARPU was wrong,
which is exactly the shape of bug that survives a spot-check.

Before that, money was gated on the *row's* `first_deposit_date`, which is absent on
most bet rows — and bet rows are where NGR lives. Same signature: deposits fine,
revenue short by thousands a cohort. Money is now collected for every player and
non-members are discarded once their first-deposit date is actually known.

`verify_retention.py` rebuilds all 420 metric × cohort × milestone sums from the raw
rows by date arithmetic and compares against the emitted deltas, within a rounding
budget of half a dollar per player per bucket. That is the check that catches money in
the wrong bucket — it still totals correctly, so nothing else would show it.

### The filters, and why the payload is one row per player

The builder used to emit a pre-aggregated set of arrays per `cohort|channel|rail` and
the page picked a key. That works for two dimensions and collapses at six: channel ×
rail × FTD type × KYC × email × phone is 216 combinations per cohort, times 86 weekly
cohorts, times a value per milestone — tens of thousands of keys, nearly all of them
never looked at.

So **the unit of the payload is now the player**: how many days they have been
observed, the day they first came back, and one mixed-radix integer packing every
attribute. The page tallies 18,857 of those on each change — well under a millisecond
— and any combination of dimensions works. Adding a dimension is one entry in
`DIMENSIONS` in the builder and **no change to the template at all**. Six dimensions
cost 972 combinations and a 277 KB payload; the old scheme was 615 KB for two.

The cost is that the page can only answer questions those three numbers support.
Cumulative return by day N is one (`lag <= N`); "deposited on day N exactly" is not,
and would need the day list back.

**FTD type is by far the strongest cut on this page.** At D30, over all complete
monthly cohorts:

| | Players | D30 | D90 |
|---|---|---|---|
| Super qualified | 3,365 | 62.7% | 64.8% |
| Qualified | 2,417 | 53.1% | 55.5% |
| Non qualified | 13,075 | 27.7% | 31.2% |

A 35-point spread, and monotonic. Of everything the page can cut by, only email
verification (30 points, below) is in the same class — channel, rail, cohort size and
calendar month are all far weaker.

### KYC, email and phone verification — and the allowlist that was eating them

Query 1732 has selected `kyc_status`, `email_verified_at` and `phone_verified_at`
from `bi.players_info_mv` for a while. None of them was in the cache, and the
obvious-looking conclusion — that the columns are NULL upstream — was **wrong**.

`KEEP` in `ftd-report/build-ftd.js` is an **allowlist**, and `trim()` drops every
column not on it before a month is written to disk. All three were being thrown away
on the way in. From the cache the two causes look identical, and only one of them is
fixable. The comment above `click_count` in that same list records the identical
mistake being made once before:

> Added to 1732 later than the rest. Kept so it survives caching — it was being
> silently dropped here, which made it look as though the query did not return it
> at all.

All three are on `KEEP` now, in `build-ftd.js` **and** `build-month.js` — the two
share cache files, so the lists have to stay identical. All twenty months have since
been re-pulled through the Redash MCP's `refresh_month_cache`, so every cohort has a
real verification state and the `unknown` buckets are empty.

**To re-pull by hand:** `node ftd-report\build-ftd.js --no-cache` — twenty months,
20–40 minutes, VPN required. A closed month is never otherwise refetched, so without
this the columns would have arrived one month at a time, starting with the current
one.

**What they say.** Over all complete monthly cohorts, at D30:

| | Players | D1 | D30 | D90 |
|---|---|---|---|---|
| **Email verified** | 16,239 | 17.5% | **41.5%** | 44.9% |
| Email not verified | 2,618 | 3.8% | **11.4%** | 12.8% |
| **KYC verified** | 4,332 | 23.0% | 55.8% | 59.4% |
| KYC not verified | 14,525 | 13.4% | 31.6% | 34.3% |
| **Phone verified** | 3,047 | 21.2% | 50.5% | 54.5% |
| Phone not verified | 15,810 | 14.5% | 34.8% | 37.6% |

Email verification is the sharpest of the three — a 30-point spread at D30 — and the
2,618 who never verified an email are *exactly* the same players as "none of the
three verified", so email is effectively the gate the other two sit behind. None of
this is causal: verifying is something engaged players do, not something that makes
them engaged.

**The partial-rollout trap, handled.** Coverage is tracked per cache month, not as a
single union. A player seen only in months written before the column existed comes
out **unknown**; an absent value *inside* a covered month is a real "not verified".
Folding the two together would have reported every 2025 cohort as 100% un-verified
and looked completely ordinary doing it. That path is dormant now that all twenty
months are backfilled, but it is the state the next new column will arrive in.

**Classification.** The four `kyc_status` values in this data are `Accepted` (48,934),
`Not Requested` (36,755), `Pending` (3,324) and `Declined` (827). Only `Accepted`
counts as verified, so **"KYC not verified" means "does not hold a passed KYC today",
not "tried and failed"** — the largest group by far was never asked. Splitting
`Not Requested` into its own bucket is a one-line change in `KYC_FAILED` if that
distinction matters. Unrecognised values are printed at the end of a build so a new
one gets classified on purpose. A `*_verified_at` timestamp is present or it is not,
and since verification is a current-state snapshot repeated on every row, a `y` is
never overwritten by a later `n`.

**`test_verification_dims.py` covers all of it without touching Redash.** It builds a
throwaway cache with the columns present in one month and absent in another, runs the
real builder against it, and reads the answers back — that the dimensions appear by
themselves, that `Pending` is a no rather than an unknown, and that players from the
uncovered month land in `unknown`. It was written before the backfill, when none of
that code could otherwise run.

### The cohort-year filter

A dropdown beside the others, but a different kind of filter: the attribute dropdowns
narrow the **players** counted inside every cohort, this narrows **which cohorts are
rows at all**. The table and the All-cohorts row both obey it, so picking 2026 gives
2026's pooled figure rather than the whole history's beside a filtered table.

Its options are built from the cohort keys rather than hardcoded, so a 2027 cohort
adds itself. The year comes from the key, which for a week is the **ISO** year — that
puts the week of 30 Dec 2024 under 2025, because it is `2025-W01`, the same reading
that sorts the list. `test_retention.js` asserts the years partition the cohorts
exactly (11,270 + 7,587 = 18,857), which is where an ISO-year disagreement would show.

### Maturity, which is the whole difficulty

A player who first deposited on 2026-08-20 cannot have a day-30 outcome. Counting
them in the denominator anyway is how a three-week-old cohort reads as catastrophic
churn when nothing has happened to it yet. So every day carries its own denominator,
`elig[N]` — cohort members with at least N days between their first deposit and the
observation cutoff — and the page has a toggle for what to do with it:

| | |
|---|---|
| **At risk** *(default)* | Divides by whoever has had the days. Every figure that can be computed is shown; each thinned cell prints the `n=` it rests on and the row is marked **·**. |
| **Complete cohorts** | Only milestones where `elig[N]` is the whole cohort. A row can then only rise across its columns and no figure rests on a population that changed underneath it — the strict like-for-like read. The newest rows stop earlier and show a dash. |

**The default was the other way round and it was wrong.** `Complete cohorts` withheld
the newest three or four cohorts from every table — precisely the rows people open the
page to look at — and the question it produced, repeatedly, was *"why is this empty?"*
rather than *"how comparable is this?"*. Withholding did not make anyone more careful;
it hid the recent data and taught people the page was broken.

So the disclosure moved from absence to annotation. The figure is there, the `n=` says
what it rests on, and the row badge says how long the cohort has been watched. Nothing
is asserted more confidently than before — it is just no longer invisible. The test
asserts **no row is empty on load**, so a future change cannot quietly bring the
withholding back.

**An at-risk row can fall across its columns, and that is not a bug.** July 2026
reads 27.3% at day 14 and 27.2% at day 30: past its maturity the denominator is
whoever lived that long, which is an earlier-in-month and differently-behaved crowd.
The `n=` is the disclosure. `test_retention.js` asserts that such falls exist under
At risk and that none of them sits between two fully-observed figures, which is what
stops someone "correcting" it into a running maximum.

For sixteen of the twenty monthly cohorts none of this matters — `elig[N]` is the
whole cohort for the entire 90 days.

**The All-cohorts row pools numerators and denominators, and its base moves from
column to column.** Day 1 pools 19 cohorts and Day 90 pools 16, because a cohort
three weeks old counts towards the first and cannot count towards the last. That
moving base is why the later columns read higher than the shape of the rows suggests:
they exclude the weaker recent cohorts, not just the later days. The note under the
table prints both counts rather than leaving it to be discovered. It is also a
*weighted* rate, not the average of the column above it — on this data those differ
by about a point, and `test_retention.js` asserts they differ so a mean cannot creep
in later.

### The whale is out of scope, so there is no toggle

Player `1709996` (karolik777) forces an exclude-by-default toggle onto every other
report here. He **first deposited on 2021-04-09**, before the earliest cohort, so he
is not in this page's data at all. This page also counts players rather than dollars,
and one player cannot move a rate built on 18,817 of them. A control that does
nothing is worse than no control, so the page explains the absence instead.

### Cohort membership, and the two ways to count it

Cohort = calendar month of `first_deposit_date`, taken at face value: every player
carries that column on every row and it never disagrees with itself across 2.04M
rows. It reconciles **exactly** with the `ftd > 0` count the Business Overview
publishes in 18 of the 20 months. The build prints the comparison every run, so a new
divergence gets noticed the day it appears. The two that differ:

- **2025-05 and 2026-07** each carry one player with a first deposit date and no row
  where `ftd` is positive. Kept — a first deposit date is a first deposit.
- **2026-08 looked like a third and is not.** Player `3951181` carries a
  `first_deposit_date` of 2026-08-23, one day *after* the last date any cache covers.
  Their day 0 has not been loaded. Dropping them is what brings August to the 1,020
  the other reports publish; counting them would put a player in the cohort whose
  first deposit has not happened yet.

Cohorts before 2025-01 are dropped for the mirror-image reason — the cache begins
there, so an earlier player's return history would be measured from a date whose
deposits were never loaded, which reads as total churn rather than as missing data.

Channel comes from `aff_source` and rail from the earliest deposit day on record,
both mirroring `ftd-report/month-aggregate.js` so this page and the FTD report split
the same players the same way. One cohort member in 18,817 has no payment rail on any
deposit row; that residue sits only in *All rails* rather than being folded into
either side, and the build prints it.

### Value per player, by and after

The value table carries **its own `by Dn` / `after Dn` switch**, separate from the
retention card's. `by Dn` is the cumulative curve ADPU and ARPU normally mean, and it
rises; `after Dn` — **the default**, matching the retention card above it — is what the
same players brought from day N+1 to the end of the window, and it falls, because each
column starts later with less time left to earn in. The pair answers *how much of this
cohort's value is still ahead of it at day N*: Jan 2026 has brought $252 by day 1 and
another $694 after it.

The two switches share a default but not a wire. They stay independent on purpose:
"still depositing after day 30" beside "brought by day 30" is an ordinary pairing, and
one global toggle would forbid it.

`after` divides by `eligA`, the same denominator the survival column uses — everyone
watched a week past the milestone. Dividing by whoever merely *reached* day 30 would
mix players with two months left to spend against players with a day, and the average
would sag for a reason that has nothing to do with the players. The suite asserts the
identity that makes the split trustworthy: for a fully-observed cohort, **`by Dn` +
`after Dn` reconstructs the whole-horizon total to the cent.**

### The weekly window

A year of weeks is fifty-two rows, and the ones that answer *how are we doing* are all
at the bottom. So the weekly grain **opens on the last 10 weeks**, with `Last 26`,
`Last 52` and `All weeks` in the control beside the year — which appears only in the
weekly grain, because twelve months never needed a window and a permanently dead
control reads as something broken.

The window is applied in `inView`, not in the row loop, so **the footer follows it**:
the All-cohorts row totals the players on screen, never a fifty-two-week pool sitting
under ten visible rows. The header strip names the window for the same reason — ten
rows must never read as all the data there is.

### Checking it

```
python retention\verify_retention.py        38 checks over 1,498 comparisons, independent of the builder
python retention\test_verification_dims.py  18 checks -- the KYC / email / phone filters, on a synthetic cache
node   retention\test_retention.js         175 checks  (needs: npm install jsdom)
node   retention-full\test_retention_full.js  130 checks -- the same page over the whole base
```

`verify_retention.py` walks the cache rows into a plain player → deposit-dates map
and answers each milestone by date arithmetic rather than by day-indexed arrays, so
an off-by-one in the builder's day loop shows up as a mismatch instead of as a
plausible number. It shares no code with the builder — it even derives the ISO week
from Python's own `isocalendar()` rather than the builder's helper. It checks both
grains and, most usefully, that they describe **the same set of players regrouped**:
if one of them dropped or duplicated somebody, every rate on that side would be
quietly wrong and nothing else on the page would show it. On the packed attributes it
checks structure rather than re-deriving the classification — that every dimension's
values partition the population exactly — because re-implementing `chOf()` here would
be copying the rules, not testing them. `ftd_type` is a pass-through, so that one is
checked against the cache column player for player. Counts are integers, so the
tolerance is zero — there is no rounding budget here.

`test_retention.js` renders the built page in a headless DOM and reads it back. A
table that renders empty is invisible to any check on the arithmetic. The assertions
worth knowing about are the ones that encode a decision someone might undo:
that the All-cohorts row is a weighted rate and measurably not the mean of the
column, that the page opens on At risk and on the `after` measure in both `state` and
the markup — a default is a product decision and the suite pins it so a flip is a
deliberate edit rather than a drift — that
day 0 is always zero, that a denominator under 30 is refused outright rather than
shown small, that the removed sections really are gone and their arrays are no longer
in the payload, and that switching grain keeps the population identical while
actually gaining the freshness the switch exists for.

## The monthly FTD Performance page

`ftd-report/build-month.js` → `ftd-report/make-month-html.js`. Step 3 above, and
runnable on its own:

```
cd ftd-report
node build-month.js --month=2026-08      writes 2026-08-data.json
node make-month-html.js --month=2026-08  writes ..\august-2026-ftd.html
```

**It follows the calendar by itself.** In September the daily run builds
`september-2026-ftd.html`, and `publish-worker.js` discovers it — nothing here needs
editing when the month turns over. The template is simply the most recently built
monthly page: each page carries its own month inside its data, so the builder reads
that and retargets every heading, comparison column and date range from it.

**Which is also how you change the page itself.** The builder replaces the data
literals and rewrites the month labels; everything else in the file — markup, styles,
the report's own JavaScript — is carried through untouched. So an edit to
`august-2026-ftd.html` becomes part of every month built after it. The partner table
in section 06 shows 30 rows rather than 20 because of a one-word edit there
(`slice(0,30)` and its caption); the country table in section 05 has its own
`slice(0,20)` and was left alone.

The catch is the same thing stated backwards: there is no separate template file to
edit, so a page that gets overwritten takes your edits with it. Change the newest
built page, then rebuild to confirm the change survives a round trip.

### Games by Category — and why adjusted GGR is not split across it

Section 11 puts three periods side by side, grouped like sections 05 and 06 — the
current month, the prior month and the same month a year earlier — each showing
**Players, Bet, GGR and NGR** for the same month-to-date window.

The Bet and Adjusted GGR totals reconcile against section 01 exactly, which is the
cheapest check that the whole thing is wired to the right months.

**The Players total is a distinct count, not the sum of the rows.** A player who
played casino and sport is one player; adding the category rows counts them twice.
On August that is 976 against a row-sum of 1,560. The category rows are already
distinct within themselves — only the totals row needed its own figure, which is why
`gamesCmpTot` exists alongside `gamesCmp`.

**All three periods obey the channel, rail and product chips.** The rollup is stored
once per filter key — the same `base|rail|product` key the KPI tiles use — rather than
once overall, which costs about 40 KB a period. Before that the comparison columns
held whole-month figures beside a filtered current month, which reads as a collapse
rather than a filter.

Country and affiliate still stand those columns down: they are unbounded and not part
of the key scheme, so there is nothing stored to look up.

`aggrTot` is keyed the same way, and every value in it matches the `adj` in the
corresponding `SCORE` set — the two are computed independently, so that agreement is
worth spot-checking after any change here.

One trap this section walked into twice, both times silently: **`const` is
script-scoped, and the page has nine `<script>` blocks.** `gk()` lives in block 2 and
the games code in block 7, so calling it from there found nothing, fell back to an
empty key, and rendered unfiltered totals with no error. Anything that has to cross a
block boundary goes on `window`.

**Adjusted GGR appears once, whole, under the categories — it cannot be split across
them.** In query 1732 the two arrive on different rows:

```
rows with game_product   43,477
rows with adjusted_ggr   12,034
rows with BOTH                0
```

There is no measured per-category adjusted GGR to show. It could be allocated
pro-rata by GGR share, and the columns would add up, but every individual figure
would be invented. The row footer matches the Adj GGR in section 01 exactly, which is
the useful property.

**A country or affiliate filter stands the comparison columns down.** The prior
periods are stored as category totals with no country or affiliate breakdown, so a
whole-month figure would sit beside a filtered one and read as a collapse.

One trap if you add a field to `DATA`: `make-month-html.js` bakes a fixed list of
`DATA` fields into the page, and `baked.js` lists the separate `DATA.x = ...`
statements. A new field in neither list never reaches the page — the table renders,
the numbers come out zero, and nothing errors. `gamesCmp` and `aggrTot` are in the
first list.

### Section 12 — Acquisition Funnel

Which game category each first depositor opened with, and where they went next.
Rows are the opening category, columns are categories they played on a **later** day,
and the bold diagonal is players who came back to what they started with.

```
Opened with    casino  crash  dice  live-casino  prov-fair  sports  Never again  Players
casino            172     32     3           34         22      28          325      514
live-casino        28     11     —           48          9      11          110      163
sports             13      5     —            9          4      63           48      115
provably-fair      14      7     1            2         16       3           43       66
crash               9     19     1            8          4       3           30       54
dice                1      —     1            —          —       2           19       21
Never bet           —      —     —            —          —       —           63       63
All                237     74     6          101         55     110          638      996
```

Three rules make it readable:

**Entry is the category they bet most on their first day.** A third of first
depositors play more than one that day, so some rule is unavoidable; biggest bet keeps
one entry per player, which is what makes the Players column add up to the cohort.

**A row does not sum to its player count.** Cells count players who played that
category later, and someone who went on to play two appears in both. The two figures
that do reconcile are Players and Never-played-again — 638 of 996 never came back
after day one.

**Non-players are shown, not dropped.** The 63 who never placed a bet get their own
row, and Never-played-again is a column rather than an exclusion. On this data that is
the story: casino is the widest door in at 514 and the leakiest at 63% never
returning, while sports keeps 58%.

It obeys the channel, rail and product chips like the rest of the page — 996 players
unfiltered, 789 on Crypto, 392 on Crypto + Casino, matching section 01's FTD counts
exactly.

### Filtering by rail or product keeps its comparison columns

Selecting a payment rail or a favourite product used to blank the prior-month and
prior-year columns. The comparison sets were pre-computed per channel and source
only, so the page had nothing to read at that grain and refused to guess.

Rails and products are small closed sets, so every combination that occurs is now
emitted — `base|rail|product`, about 200 keys against the previous 13. The page
composes the same key when either filter is on. Channel + rail + product together
works; the figures narrow at each step.

**Day, country and affiliate still blank the columns**, and always will. Those are
unbounded — there is no set to pre-compute and never will be one.

**Registrations show a dash under any rail or product filter.** A registration has
neither: nobody has a payment rail before they deposit. Showing the channel's
registration count next to a narrower FTD count would silently overstate Reg2Dep, so
both that row and the ratio stand down instead.

### Percentages are whole numbers

Every percentage and percentage-point figure on the page goes through two helpers,
`pctW` and `ppW`, near the top of its script. `16.15%` reads as `16%`, `-0.4pp` as
`0pp`.

They were twelve separate formatters before — `toFixed(1)`, `toFixed(2)`, a template
literal, one buried inside a longer string, two more inside chart-legend ternaries.
Routing them through one pair of helpers means the next change to how numbers read is
a single edit rather than a hunt.

**A small non-zero value shows `<1%`, not `0%`.** The C2R column carries real figures
around 0.39%; rounding those to zero would read as no clicks converting at all.
The same guard applies to `pp`.

One thing deliberately left alone: `toFixed(0)` inside `style="width:..%"`. That is a
bar width, not a number anyone reads.

`MONTHLY_KEEP` in `config.env` (default 3) caps how many months show in the top bar.
Older months stay on disk and stay reachable at their own URL; they just drop out of
the navigation.

### How it was checked

The page was originally built by hand, so the rebuild had to be proved rather than
assumed. `ftd-report/verify-month.js` rebuilds a month from the same extracts the
live page was made from and compares every one of the ~20 data blobs:

```
cd ftd-report
node verify-month.js --month=2026-08 --cap=18 ^
  --cur=_stage/aug26_r3.json --pm=_stage/jul26_r2.json ^
  --py=_stage/aug25_r2.json  --pypm=_stage/jul25_r2.json
```

Two results, and they mean different things:

| | |
|---|---|
| Rebuild vs the original hand-built page | **142,958 comparisons, 49 disagreements** (0.03%) |
| Rebuild → bake → read back | **143,046 comparisons, 0 disagreements** |

The second says the builder and the page format agree perfectly — nothing is lost in
writing the page out and reading it back. The first is the one that matters, and its
49 all trace to the same thing: the payment rail of two August players and about five
July ones (see below). Every other number on the page — every total, every channel
split, every country, every affiliate, every player row — matches to the cent.

Pass `--cap`. Without it the comparison runs against a cut-off the reference page
never used, and everything legitimately differs.

**That comparison was a one-time proof and can no longer be re-run.** The reference
was the hand-built `august-2026-ftd.html`, which the generator has since overwritten;
`august-2026-ftd.html.bak` is an earlier draft and does not parse cleanly. The
`_stage/` extracts remain, so the *inputs* are preserved, but the original output is
gone. `verify-month.js` still works — point it at any built page with `--against=` to
compare two builds — it just cannot reproduce the original proof.

### Blocked and One-Time in the comparison columns

`player_status` and `deposit_count` were added to the cached column list well after
the older months were pulled, so a month cached before that has neither.

**The build repairs this itself.** A cache file missing a column the page needs is
treated as unusable and pulled again, inside the normal run — no separate step, no
flag. It costs a few extra minutes the first time and nothing afterwards, because new
months are cached with the full list already.

Two details worth knowing:

- **Age checks cannot find this.** The file can be from this morning and still lack
  the columns, so the freshness rule that governs `cache-bonus\` is the wrong tool.
  The check is on content: does any row carry `player_status` and `deposit_count`.
- **A failed repair is not a failed build.** If Redash cannot be reached, it says so
  and builds from the incomplete copy — two rows show a dash instead of the whole page
  staying on yesterday's copy. Only a month with no cache at all stops the step.

Until a month is repaired those four rows show a dash rather than a number, and that
is the point: computing from an absent column gives **0% blocked and 100% one-time**,
figures that look perfectly ordinary and are pure artefact.

Four rules were not what they looked like, and all four are commented where they live:

- **Channel comes from `aff_source`, not `aff_type`.** Players arriving through an SEO
  partner are tagged `Direct` in `aff_type` and counted as Affiliate by the page.
- **`Uncategorized` is not a source.** It means the query does not know, so those rows
  fall back to `aff_type`.
- **`deposit_count` sums across rows**, it is not a running total. Taking the max gets
  671 of 892 players right — close enough to look correct, wrong enough to overstate
  the one-time-depositor headline.
- **`ratio` is computed from the rounded figures**, not the raw ones.

### Two things worth knowing

**The crypto/fiat split can move by a player or two between builds.** A player's rail
is the first one their rows show, and Redash does not promise a stable row order, so
someone who deposited on a chain and a card within the same minute can land either
side. Every alternative rule was tested and scored worse. Nothing else depends on it.

**Mercado Pago counts as crypto on this page.** It is a fiat rail, and the rolling FTD
report treats it as one, but the monthly page has always counted it the other way.
That is reproduced deliberately so the rebuild is a drop-in rather than a silent
restatement — move `mercado` into `FIAT_RAILS` in `month-aggregate.js` to correct it,
and expect the split to shift the day you do.

The build prints any payment rail or ISO-long-form country name it has not seen
before, so new ones get classified on purpose instead of by default.

---

## The daily cycle

At 08:00 (an hour after Redash refreshes at 07:00), this happens without anyone touching it:

```
  Redash                    your machine                  the web
  ------                    ------------                  -------
  query 1731  ──┐
  bonus cost    ├──►  build.js  ──►  data.json  ──►  bonus-cost-report.html
  query 1732  ──┘                    (4.9 MB)         (one self-contained file)
  revenue                                                      │
                                                               ▼
                                                     publish-worker.js
                                                               │
                                                               ▼
                                              reports.veisreports.workers.dev
```

1. `build.js` runs both Redash queries for the range in `config.env`
2. It aggregates ~760,000 rows into `data.json`
3. `make-standalone.js` bakes that into a single HTML file
4. `publish-worker.js` uploads it to Cloudflare

**Closed months are cached.** This used to run nine queries every morning — query
1731 once for the whole range, then query 1732 once per month, January through
August. Seven of those eight were months that had already finished.

1732 is dated to the day, so a closed month's figures do not move, and it is now read
from `cache-bonus\` instead. What *does* move is the labelling: player segment, status
and channel are restated upstream, which is how Regular quietly redistributed into
Churn. So closed months are still refreshed on a cycle —
`CLOSED_MONTH_REFRESH_DAYS` in `config.env`, seven days by default.

A warm run makes **two** live queries instead of nine: 1731 for the full range, and
1732 for the current month. `node build.js --no-cache` forces the old behaviour.

`cache-bonus\` holds player-level rows. Same rule as the rest of this folder — do not
copy it anywhere shared, and keep it out of git.

`node test-month-cache.js` checks the caching rules without touching Redash: that a
stale month is refetched, a fresh one is not, the current month is never trusted, and
the columns this build reads survive the round-trip.

`node test-build-smoke.js` runs **the whole of build.js** with Redash stubbed — a temp
folder, synthetic rows, the real pipeline start to finish, a couple of seconds, no VPN.
It asserts the build completes and emits every key the report reads.

That one exists because `node --check` only parses. When the month cache replaced the
inline query it also removed `const last = daysInMonth(ym)`, which was still used 120
lines further down; the file parsed cleanly and died with `last is not defined` after
nine seconds of Redash, leaving the Bonus Cost page a day stale while every other
report updated around it. Running the file is the only thing that catches that, and
the smoke test has been verified to fail on exactly that change.

If any step fails, the site keeps serving the previous day's copy rather than breaking.

**The 08:00 job only runs while `start.bat` is open.** Closing that window stops the
schedule. Consider adding it to Windows startup.

---

## Bonus group by user type

Three cards under **Bonus group by user type**, between the bonus-group tables and
the segment tables. Rows are bonus groups, columns are four user types, 2026 year to
date:

| Card | Shows |
|---|---|
| Bonus cost by bonus group and user type | dollars |
| Bonus cost as % of that user type's adjusted GGR | each column against its own GGR |
| Each user type's share of that group's bonus cost | each row reads across to 100% |

**Each player is counted once.** The four types overlap in the source — 639 of the
2026 first depositors are also Regular and 6 are Vip — so a player is assigned to the
first bucket they match, in this order:

```
  FTD 2026  ->  Vip  ->  Regular  ->  All other
```

A player who first deposited this year counts as a new depositor even if they have
already climbed to Vip. That is what makes the four columns add up to the row total,
which is the whole point of the table.

**The Vip column here is smaller than the Vip row in the segment tables below.** That
is the precedence rule, not an error: this column counts Vips who first deposited
before 2026, the segment table counts every Vip. The note under the first card says
so on the page, because two numbers that sit near each other and disagree will
otherwise cost someone an afternoon.

`USER_TYPES` and `userTypeOf()` in `build.js` define the buckets; `dataU` in
`data.json` carries the result, monthly, in the same shape as the per-segment
`dataS`, so a month-by-month version costs nothing later.

### Checking it

```
node test-user-type-table.js     the arithmetic
node test-user-type-render.js    the page itself   (needs: npm install jsdom)
node test-drilldown.js           clicking the cells (needs: npm install jsdom)
```

The first rebuilds the breakdown independently from `cells` — per-player cost per
group — and checks it against `dataU`, that every player lands in exactly one bucket,
and that the columns sum to the group total. The second renders the real
`report.html` + `app.js` in a headless DOM and reads the table back out: right
columns, every row adding across, the total matching the figure the rest of the
report publishes, and the share table reading across to 100%. A table that renders
empty is not something the arithmetic test can see.

---

## The daily charts

Six charts, each daily bars with a cumulative line drawn over them. Bars are a tint,
the line the strong version of the same hue; the day's value sits in a row along the
bottom rather than floating over the bars, where the line used to run through it.

**Two rules make the overlay honest, and both are asserted by
`test-daily-chart.js`:**

**Every axis labels its zero.** Ticks are anchored to multiples of a step size rather
than dividing min-to-max into four. The old way produced `-$200k -$125k -$50k $25k
$100k` on the GGR chart — a zero line drawn across the plot with no label near it and
every number on the wrong side of it. It now reads `-$180k -$120k -$60k $0 $60k $120k`.

**The amount charts pin their second axis to that zero.** Adjusted GGR, Bonus cost and
Deposits carry a right-hand axis for the running total, because a cumulative ends 6–13×
above the tallest daily bar. Left to itself that axis puts its zero on the floor while
the bars' zero sits partway up the plot — which drew a $571k cumulative *underneath* a
$97k bar. Not a rendering quirk: the chart said the opposite of the data. The right
axis is now scaled so its zero lands on the same pixel as the bars' zero, so both
series are measured from one line.

The three percentage charts need none of that — both series are percentages in the same
range, so they share one axis.

**The ratios are cumulative cost over cumulative GGR — not the average of the daily
ratios.** Those are different numbers and only the first is the month-to-date figure.
On August data the daily bars run from 11% to 428% while the cumulative line settles
at 28.1%, the figure the caption already quoted. Averaging the daily percentages
instead would let one loss-making day drag the rest of the month with it.

Days where the denominator is zero or negative show `n/m` as a bar and are skipped by
the line — the running totals carry straight through them.

`node test-daily-chart.js` checks each line ends on the figure its own data produces,
that the bars keep their height (which catches a cumulative line accidentally sharing
an amount axis), and that the ratio line is not the mean of the dailies. That last one
matters most: the wrong version looks entirely reasonable on screen.

**A front-end change needs no Redash run.** `node make-standalone.js` re-bakes
`bonus-cost-report.html` from the `data.json` already on disk — seconds, no VPN — then
`6-publish.bat` pushes it. Editing `app.js` alone changes nothing you can see: the
page carries its own inlined copy of the code.

---

## Player win / loss

The last card on the page, laid out like the monthly FTD page's version: four
headline tiles, a diverging chart with a count / dollars toggle, and the two top-12
lists.

**It covers the latest month only** — August, not the whole build range. "How is
August going" and "how has the year gone" are different questions and one
distribution cannot answer both. Everything in the card is on that month, and
`test-win-loss.js` checks the tiles, the chart and the table all agree on it; a tile
quietly summing eight months would look completely normal.

It also covers **every player who played that month**, not just that month's first
depositors, which is where it differs from the FTD page's chart.

**Each bar carries two figures**: its own measure — player count or adjusted GGR,
per the toggle — and above it, in grey, the bonus cost that band received. That
pairing is the reason the chart is on a bonus cost report at all: it says what each
slice of the win/loss curve was paid to get there.

Clicking a bar lists that band's players. Clicking a name in either top-12 list opens
that player's bonus breakdown.

One trap worth knowing if you edit this chart: `money()` wraps negatives in
`<span class="neg">`, which is right in a table cell and invalid inside an SVG
`<text>` — the browser drops it and the label disappears. SVG labels use a plain-text
formatter instead, and the test checks both toggle states for exactly that.

**Adjusted GGR is what the house kept, so a player who is ahead carries a negative
figure.** The table is readable either way round and looks entirely plausible
inverted, which is why the caption says it out loud and `test-win-loss.js` asserts it
rather than assuming it.

**Registered-but-never-played players are excluded**, and the caption says how many.
In August that is 4,076 against the 3,012 who actually played — more than the chart
shows. Their adjusted GGR is exactly zero, so counting them as break-even would put
most of the chart in one bar and make every percentage describe registration rather
than play. Break-even is then what it should be: players who did play and came out
level.

Both the player count and the bonus cost in each band are clickable.

`node test-win-loss.js` checks the sign convention, that the bands and the summary
rows add up to the total, that each band's drill-down lists exactly its players, that
the idle population stays out, and that the net agrees with the adjusted GGR the rest
of the report publishes.

---

## Clicking a cell

Nearly every cell opens a drill-down of the players behind it.

**Every player is listed, not only the ones who received a bonus.** Clicking CRM's
total lists all 88,641 players active in the period, 85,004 of whom have no CRM
bonus at all — they are there for their GGR and deposits. The bonus cost column
still adds up to the cell that was clicked; it is the population around it that got
bigger. Before this, a cell listed only the ~7,700 players who ever took a bonus,
which made the adjusted GGR in the footer read as though it were the whole picture.

**The denominator rows are clickable too** — the `Adjusted GGR` and `Bet amount` lines
under the rate tables, and `Segment adjusted GGR` under the segment one. They open
every player in scope for that month, which is what those figures count; a bonus-group
key would list only the bonused subset and disagree with the number printed in the row.

**Long lists are capped at 2,000 drawn rows**, sorted by whichever column is active,
with `top 2,000 listed` next to the full count. The footer totals and the CSV export
both cover everything — only the drawing is trimmed. `DD_ROW_CAP` in `app.js` if you
want it higher; the table is built as one HTML string, so 138,000 rows is a few
seconds of frozen tab.

`test-drilldown.js` covers the failure modes, none of them visible by looking at the
page:

- **a cell that is not clickable at all** — *Adjusted GGR by player segment* sat inert
  for a while with the four tables around it working
- **a cell that opens a list which does not reconcile with the number clicked**, which
  is worse, because it looks like it worked
- **a list that quietly reverts to bonused-only**, which looks identical unless you
  count the rows
- **a cap that trims the totals as well as the rows**, which would understate every
  figure in the footer

The second is why the GGR cells carry their own `SEGA:` key instead of reusing `SEG:`.
`SEG:` lists only players who received a bonus, which is right for a bonus cost cell
and wrong for a GGR one:

| Segment | Players | With a bonus | GGR shown | GGR if only bonused players listed |
|---|---|---|---|---|
| Mass | 1,888 | 1,277 | −$266,813 | −$74,578 |
| One Timer | 2,797 | 671 | $63,358 | $51,900 |
| Risk | 60 | 55 | −$353,058 | −$224,591 |

`SEGA:` reads from `pm`, which carries all 137,991 players, so the list adds up to the
cell. The drill-down says which of the two you are looking at, because "only players
who received a bonus" is true of most cells on the page and false of these.

---

## Where the numbers come from

**Query 1731 — Bonus Cost By Categories.** Bonus cost per player, per bonus, per month,
plus the slot / live casino / sport / other split. This query shifts reward-family costs
back one month, so its monthly totals move over time as that mapping changes.

**Query 1732 — Marketing General Report.** Adjusted GGR, raw GGR, bet, deposits, daily
detail, segments, countries, FTD dates. Dated to the day, so it doesn't drift.

Month-to-date figures come from 1732 (1731 filters by whole month and cannot answer
"first 16 days"). Full-month bonus cost comes from 1731.

**The bonus group taxonomy is not in either query.** CRM / Loyalty Program / General Promo
/ Acquisition came from a spreadsheet, and now live in `bonus-groups.json`, keyed by
bonus_id (766 bonuses). **New bonuses appear as `Unmapped › Not in bonus list` until you
add them there.** Watch the "% of cost maps to a group" figure in the report footnote — it
was 99.92%.

---

## The login

The page is a Cloudflare Worker. Every request runs `worker/worker.js` first, which checks
the session before any file is served — that ordering is enforced by `run_worker_first` in
the generated config, and it's what stops the HTML being served ahead of the check.

**It's a real form at `/login`, not the browser's dialog.** It used to be HTTP Basic, which
meant a grey box with no branding, no error text, no "keep me signed in", and no way to sign
out short of closing the browser. Now: a Wayzen-styled page, a wrong password comes back as
a message on that page with the username still filled in, and there's a **Sign out** link on
the right of the switcher bar.

Sessions are a cookie holding `user.expiry.hmac` — signed with `AUTH_SECRET`, `HttpOnly`,
`Secure`, `SameSite=Lax`. The password itself never goes into it. Twelve hours by default,
30 days with the checkbox. Deleting someone from `AUTH_USERS` locks them out on their next
request even if their cookie is still in date, because the name in the cookie is checked
against the list every time.

`AUTH_SECRET` is generated once by `publish-worker.js` and written into `config.env`. It is
deliberately *not* regenerated per deploy — that would sign everyone out every morning.
Changing it by hand signs everyone out immediately, which is the right move if a laptop goes
missing.

**Basic auth still works, but is never advertised.** `verify-public.js` proves the site is
protected by making real requests and can't fill in a form, so the Worker still accepts an
`Authorization: Basic` header. It never sends `WWW-Authenticate`, so no browser will pop the
native dialog. That header's absence is asserted in the tests, because it's the one line
that would bring the old experience back.

`node test-login.mjs` runs the Worker offline against a stubbed asset store — 48 checks
covering the redirect, the form, cookie forgery, expiry tampering, revocation, open-redirect
attempts via `next=`, and failing closed when either variable is missing. Node and Cloudflare
both implement `fetch`/`Request`/`Response`/`crypto.subtle`, so the module is imported
unmodified and called exactly the way Cloudflare calls it. Worth running before any publish
that touches `worker.js`: a mistake there is only visible on the live site once it's already
live.

Accounts live in `AUTH_USERS` in `config.env`:

```
AUTH_USERS=veis:password1, viewer:password2, spare:password3
```

**To add someone:** add `name:password` to that line, run `6-publish.bat`.
**To remove someone:** delete their entry, run `6-publish.bat`.

If `AUTH_USERS` is ever empty, the Worker serves nothing at all rather than serving the
report unprotected.

---

## Changing the address

A Worker address is always **three** parts, and the first two are changed in two
different places:

```
   reports    .   veisreports   .  workers.dev
      ↑                ↑
  CF_PROJECT      CF_SUBDOMAIN
  config.env      Cloudflare dashboard
```

There is no two-part form. `something.workers.dev` on its own is an account
namespace, not a route — nothing can be deployed to it, so a Worker always has a
name in front. The shortest a Cloudflare-hosted address gets is a short first word.

**The first half** is `CF_PROJECT` in `config.env`. Edit it, run `6-publish.bat`, and the
site is live at the new name a minute later. Nothing else needs touching — `verify-public.js`
and `UPDATE-EVERYTHING.bat` both read the address from `config.env`, so the window that
prints the link prints the one that works.

> **Delete the old Worker afterwards.** Renaming deploys a *new* Worker; it does not move
> the old one. `veis-bonus` stays up, still holding the last copy it was given, still
> listing every player's username, country and deposits. It is behind the same login, but
> it is an address nobody is watching any more and it never updates again. Remove it:
> Cloudflare dashboard → Workers & Pages → the old name → Settings → Delete.

**The second half** is account-wide and cannot be set from this folder. Cloudflare
dashboard → Workers & Pages → *Change* beside "Your subdomain". Two things to know before
doing it: it renames **every** Worker on the account at once, and the old `*.workers.dev`
addresses stop resolving immediately — so anyone with the link bookmarked gets nothing
until you send them the new one. Cloudflare also limits how often it can be changed; if it
refuses with *"account already has an associated subdomain"*, only support can move it.
Once it is changed, set `CF_SUBDOMAIN` in `config.env` to match, or the verify step will
keep probing an address that no longer exists and report the site as broken when it isn't.

**To leave `workers.dev` entirely** you need a domain already on Cloudflare; then the
Worker gets a route binding instead of `workers_dev: true` in `writeWranglerConfig()`.

### Moving to `reports.wayzen.workers.dev`

Order matters here, because two of the four steps are done in the dashboard and the
other two in this folder.

1. **Dashboard → Workers & Pages → *Change* beside "Your subdomain" → `wayzen`.**
   It has to be free across all of Cloudflare, so it may be taken. Everything on the
   account moves the moment this is saved, and the old addresses stop resolving —
   the site is briefly at `veis-bonus.wayzen.workers.dev` and the link anyone has
   bookmarked is dead until step 4.
2. **Set `CF_SUBDOMAIN=wayzen` in `config.env`.** Not before step 1 — done early it
   points the verify step at an address that does not exist yet.
3. **Run `6-publish.bat`.** `CF_PROJECT` is already `reports`, so this deploys the
   Worker under the new name and the site comes up at
   `reports.wayzen.workers.dev`.
4. **Dashboard → delete the old `veis-bonus` Worker**, and send everyone the new
   link.

If step 7 of the daily run ever reports that nothing answered, it is this that has
slipped: the two names in `config.env` no longer match what is deployed.
`verify-public.js` says so in those words rather than blaming the login, which was a
real trap — an unreachable address used to print *"the correct password did not work,
check AUTH_USERS"* and send you looking in the wrong file.

---

## The files

| File | What it does |
|---|---|
| `config.env` | Every setting and secret. The only file you should need to edit. |
| `build.js` | Runs the Redash queries and builds `data.json`. |
| `make-standalone.js` | Bakes `data.json` into one self-contained HTML file. |
| `publish-worker.js` | Uploads to Cloudflare. |
| `verify-public.js` | Proves the live site demands a password. |
| `worker/worker.js` | The password check that runs on Cloudflare. |
| `bonus-groups.json` | bonus_id → group / subgroup. |
| `server.js` | Local preview at localhost:8080, and the 08:00 timer. |
| `app.js`, `report.html` | The report itself, unchanged from your original apart from where it reads its data. |

`_offline/` holds your original report and test files. Nothing there is published.

`ftd-report/` also holds the monthly FTD Performance builder: `month-aggregate.js`
(the rules), `build-month.js` (fetch and aggregate), `make-month-html.js` (bake the
page), `baked.js` (read the data back out of a built page) and `verify-month.js`
(prove a rebuild matches). `_stage/` holds the extracts the original August page was
made from — they are the reference verify-month.js checks against, so keep them.

`ftd-report/` is a second report built from query 1732 — first deposits by range,
country, channel and payment rail. It has its own README. It publishes to `/ftd`
on this same Worker and behind this same `AUTH_USERS` list, so anyone who can
open this page can open that one. `publish-worker.js` stages it automatically if
it has been built, and skips it if it has not — a missing FTD report cannot stop
the bonus cost report going out.

---

## Doing things

| I want to… | Do this |
|---|---|
| See the report | Open the live URL |
| See the FTD report | The same URL with `/ftd` on the end |
| See deposit retention | The same URL with `/retention` on the end |
| Force a rebuild now | `3-build-everything.bat` |
| Republish without rebuilding | `6-publish.bat` |
| Check it's still protected | `7-verify-public.bat` |
| Add or remove a viewer | Edit `AUTH_USERS`, then `6-publish.bat` |
| Cover more months | Edit `BUILD_TO`, then `3-build-everything.bat` |
| Add newly launched bonuses | Edit `bonus-groups.json`, then rebuild |
| Check when it last ran | `http://localhost:8080/status` |

---

## Accuracy

Verified against your original `bonus_cost_by_group_2026_8.html`:

| | Result |
|---|---|
| Adjusted GGR, all 8 months | **0.00%** |
| Bet amount | **0.00%** |
| Month-to-date bonus cost | **0.00%** |
| Bonuses / cells / day-level players | exact match |
| Full-month bonus cost | within ~1% |

**The ~1% on full-month cost is expected**, not an error: query 1731 re-buckets
reward-family costs using a mapping that has changed since your spreadsheet was exported.
MTD comes from 1732 and matches exactly, which is what proves the difference is in the
source rather than in the build.

**Segment splits differ from the original.** Same grand total, allocated differently. Your
data now has a `Churn` segment that didn't exist when the original was exported, and
Regular has been redistributed into it and into Mass, Risk and One Timer. Vip matches to
−0.0%. The page shows current segment membership, not a months-old snapshot.

---

## When something breaks

| Symptom | Cause |
|---|---|
| Site shows yesterday's numbers | The 08:00 job didn't run — is `start.bat` still open? |
| `POST failed 404` during build | A Redash query API key was rotated |
| Lots of `Unmapped` in the report | New bonus IDs — update `bonus-groups.json` |
| Publish fails | Token expired or lacks `Workers Scripts · Edit` |
| `7-verify-public.bat` says NOT PROTECTED | Stop sharing the link and fix before anything else |

---

## Things worth knowing

**The API keys and passwords are in `config.env` in plain text.** That's fine on your
machine; don't copy the folder anywhere shared, and don't put it in git.

**The published page contains player-level data** — usernames, countries, deposits, GGR per
player. That's why the login exists and why `robots.txt` blocks search engines.

**The Redash keys are per-query**, so each only unlocks its own query rather than your whole
account.

---

## VIP Transfer Performance

Every player who asked to move to us from another casino, measured **before and
after** the transfer: total deposits and GGR either side, the monthly average of
each, the change between them, and bonus cost against adjusted GGR. Publishes to
`/vip-transfer`.

| I want to... | Do this |
|---|---|
| Refresh everything | `UPDATE-EVERYTHING.bat` -- this page is step 9b |
| Refresh just this page | `13-build-vip-transfer.bat` |
| Change the page | Edit `vip-transfer\vip-transfer-template.html`, never `vip-transfer.html` |

`fetch_vip.js` does the whole input side unattended: it reads the tracker
straight from the Google Sheet (link-readable, no browser needed), resolves any
row whose User ID cell is blank by looking the username up in `public.players`,
then runs the cohort query with `REDASH_USER_API_KEY` and writes
`data\roster.json` and `data\cohort.json`. `node vip-transfer\test_fetch_vip.js`
exercises all of that against a fixture, with no network.

**The cohort is the warehouse, not the sheet.** 1,680 players appear in
`public.loyalty_transfer_request`; the tracker covers 217 of them. The rest
requested a transfer and no VA ever picked them up, which is most of the value in
the page -- the three buttons at the top switch between all requests, onboarded,
and never onboarded.

**Two different clocks, and the page says which it is using.** Onboarded players
are split on their onboarding date; everyone else on their request date, because
no onboarding date exists for them. The day column relabels itself accordingly.
The two are ~50 days apart on average, so the groups are not measuring from the
same event and the comparison is not strictly like-for-like.

**Nothing is projected.** The `/mo` columns divide by months of exposure with the
divisor floored at one month, so a player 17 days in reports what they actually
deposited rather than a scaled-up month. Past a month it becomes a true average.

**It needs the internet as well as the VPN**, because of the sheet. If the sheet
is un-shared or moved, step 9b fails and the previous page republishes unchanged.

**A bad row in the sheet surfaces here, not upstream.** Blank User IDs are matched
on username and skipped when ambiguous (`roster.json` stamps `id_from` on those);
an onboarding year typed as 2016 is repaired to 2026. Both are worked around, not
fixed -- the durable fix is a `player_id -> transfer date, source casino, VA`
table in the warehouse.

Reading it: **n/m** means the base was negative, so a percentage would mean
nothing. **new** means there was no "before" to compare against. **>+999%** is a
display cap with the exact figure on hover. Filters combine -- a VA, a segment and
a month can all be active at once; clicking an active row or chip clears just
that one, and **Clear all filters** clears the lot.
