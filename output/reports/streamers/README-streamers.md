# Streamers — the 2026 FTD cohort

`/streamers` on the reports site. Answers one question: **how many streamers did
we test in 2026, what did they bring in, and which of them made money.**

```
  ftd-report/cache/2026-*.json ──┐
      query 1732, already on disk │
                                  ├─► build_streamers.py ─► streamers-data.json ─► make_streamers_html.py ─► ../streamers.html
  acquisition-report/            │        the cohort              114 KB                 __DATA__ swap            152 KB, standalone
    cost_from_drive.xlsx ────────┘
      what we paid each streamer
```

No Redash calls, no VPN, no network in the built page. Step 2 of
`UPDATE-EVERYTHING.bat` refreshes the caches, step 4 downloads the cost sheet;
this report is step 9 and reads whatever both left on disk.

## Investment

The money side of the ledger is not in query 1732 and never will be — it lives
in the CPA deal sheet. This report reads **the copy step 4 already downloaded**
(`acquisition-report/cost_from_drive.xlsx`), falling back to the newest `.xlsx`
in `COST_DIR` from `acquisition-report/config.env`. Reading that copy rather than
downloading again means this page cannot disagree with `/acquisition-2026` about
what a streamer cost.

The join is `Affiliate Name` against `aff_username`, **case-insensitive** —
copied from `acquisition-report/gen_html.py`, the only other place these two
datasets are joined.

Two things the column is not:

- **It is not scoped to this cohort.** It is the whole 2026 deal cost for that
  streamer, including any spend that brought players in before 2026. Cost per FTD
  is therefore slightly flattering wherever a streamer has older players.
- **A blank is not zero.** 17 of the 120 streamers have no row in the deal sheet.
  They carry `null` and render an em-dash. Cost per FTD divides by the 2,679 FTDs
  from the 103 streamers we *do* have a deal for — $104, not the $101 you get by
  dividing across all 2,753. The test asserts those two differ so the wrong
  denominator cannot creep back in.

A missing or unreadable cost file does not fail the build. It sets `costNote`,
leaves every `inv` null, and the page shows em-dashes — a broken Drive share
should not take the report down.

**The number that matters: $277,520 invested against -$18,921 adjusted GGR is
-$296,441 net of cost.**

```
python build_streamers.py      # -> streamers-data.json, with its own reconciliation
python make_streamers_html.py  # -> ../streamers.html
node test_streamers.js         # needs `npm install jsdom` in C:\redash-page
```

`../streamers.html` is **generated**. Editing it is silently undone by the next
build — edit `streamers-template.html`.

---

## The cohort, and why it is defined this way

A player is in the cohort if their **first deposit landed in 2026 through a
streamer**: a cache row with `ftd` > 0 and `aff_type` == `Streamer`. The
streamer credited is the `aff_username` on that first-deposit row, so
attribution is fixed at acquisition and a player never drifts between streamers
later in the year.

The obvious alternative — everyone who *played* in 2026 under a streamer tag —
was rejected. It sweeps in players acquired in 2023 whose deposits have nothing
to do with the streamer programme's 2026 performance, and it inflates deposits
by roughly an order of magnitude without any figure on the page looking wrong.
`test_streamers.js` asserts that no cohort row carries a pre-2026
`first_deposit_date`, so the definition cannot quietly slip back.

Money — deposits, bets, GGR, NGR, adjusted GGR, bonus cost — is then summed over
**every 2026 row belonging to those players**. So a streamer who delivered in
January carries eight months of their players' activity and one who started in
August carries one. That asymmetry is real and is not corrected for; the
**Months live** column in the table is how you read past it.

## `ftd` is a dollar amount

It is the first-deposit value, not a flag. Count distinct `player_id` with
`ftd` > 0. Summing the column gives money, and the build prints both so the
mistake is visible rather than plausible.

## The whale is not here

Player **1709996** (karolik777) is carved out of every other report on this site
by default. He is not in this cohort at all — he first deposited years before
2026 and not through a streamer — so this page has **no whale toggle**, and
needs none. `build_streamers.py` asserts his absence and fails the build if that
ever changes, rather than letting deposits quietly triple.

## Adjusted GGR is not derived

`adjusted_ggr` and `ngr` are computed upstream over different scopes.
Adjusted GGR is **not** raw GGR minus bonus cost, and any attempt to "fix" the
builder by subtracting will produce a different number. For this cohort:

| | |
|---|---|
| Adjusted GGR | -$18,921 |
| NGR | -$73,828 |
| NGR − bonus cost | -$128,735 |

Three different figures. The test asserts all three differ so nobody collapses
them into one.

## What the page shows

| | |
|---|---|
| Cohort quality toggle | **All FTDs** / **Qualified +** / **Super Qualified**. These are three separate cohorts, not filters over one — the streamer count, deposits and adjusted GGR are each recomputed. The builder emits all three. |
| Money toggle | **Adjusted GGR** / **NGR**. Every chart, ranking, headline and sort follows it; there is one `mny` field so the toggle cannot leave half the page on the other metric. |
| FTD chart | First deposits by acquisition month, stacked by qualification tier, with the cohort's deposits that month as an overlay line. The two months differ on purpose — FTDs sit on the acquisition month, money sits on the month it moved. |
| Money chart | Each month's total split into the part earned from streamers who finished the year **up** and the part from those who finished **down**. Colour is set by the whole-year result, so a green band can contain a bad month; the assertion in the test is only that no single bar straddles zero. |
| Rankings | Top 12 either side, with the remainder totalled in the card heading rather than dropped. |
| Table | Every streamer, 17 columns, with a sticky totals row. `Deposit / FTD` is the cleanest read on player quality — it does not move with how many players a streamer sent. |

### Retention, positive GGR and negative NGR

**Retained D7 / D30** is lifted **verbatim** from `retention/build_retention.py`,
because two pages on this site quoting different retention numbers is worse than
either being slightly off:

- day 0 is the player's `first_deposit_date`
- retained by day N = a **deposit** on some day 1..N after it. Day-0 top-ups are
  not a return; betting is not retention. The question the acquisition spend is
  judged on is whether they fund the account again.
- only players **observed at least N days** are in the denominator. A streamer
  who delivered last week is not marked down for players who have not had the
  chance to come back yet.

The one deliberate divergence: `retention/` blanks a rate below **30** eligible
players. Per streamer the cohorts are an order of magnitude smaller and 30 would
blank most of the table, so the floor here is **10** — set in `MIN_ELIGIBLE`. 53
of the 120 streamers still show an em-dash. Every cell carries its
retained-of-eligible counts as a tooltip so a thin rate can be recognised as one.

The builder emits the two **counts**, not the rate, and the page divides. A rate
cannot be averaged across streamers — one with 4 eligible players would weigh the
same as one with 400. The weighted D7 (18.6%) and the mean of the streamers'
rates (16.8%) differ, and the test asserts they do so a mean cannot creep in.

Note that the raw D7 count (499) is **higher** than the D30 count (487). That is
correct, not a bug: D30 drops everyone observed 7–29 days, some of whom did
return by day 7. Monotonicity only holds on a fixed population, and the test
checks it there — on the D30-eligible players, 408 returned by day 7 and 487 by
day 30.

**Positive GGR** is what the streamer earned from players who finished 2026
GGR-positive. **Negative NGR** is what the players who finished NGR-negative took
back. Split at the **player**, not the row — a profitable player still has losing
days, and summing signed rows would inflate both sides while saying nothing about
who the streamer actually sent.

The two groups **overlap**: bonus cost puts some GGR-positive players into
negative NGR, so 2,107 winners plus 655 losers is 2,762 against 2,753 FTDs.
They are not a partition, neither is a share of the other, and the page says so
in the table caption. The test asserts the overlap exists so a future edit cannot
quietly present them as complementary.

## Headline figures, Jan–Aug 2026 (data to 2026-08-29)

| Cohort | Streamers | FTDs | Super Qualified | FTD value | Deposits | Adjusted GGR | In profit | In loss |
|---|---|---|---|---|---|---|---|---|
| All FTDs | 120 | 2,753 | 257 | $305,453 | $1,138,567 | -$18,921 | 84 | 36 |
| Qualified + | 89 | 555 | 257 | $161,368 | $765,073 | -$15,997 | 59 | 30 |
| Super Qualified | 67 | 257 | 257 | $155,042 | $732,782 | -$14,226 | 42 | 25 |

| Cohort | Invested | Cost / FTD | Retained D7 | Retained D30 | Positive GGR | Negative NGR |
|---|---|---|---|---|---|---|
| All FTDs | $277,520 (103/120) | $104 | 19% (499/2,677) | 22% (487/2,169) | $282,478 from 2,107 | -$320,516 from 655 |
| Qualified + | $250,805 (81/89) | $462 | 49% (266/547) | 55% (246/449) | $181,020 from 373 | -$204,472 from 205 |
| Super Qualified | $225,011 (62/67) | $896 | 50% (127/253) | 55% (113/205) | $170,581 from 167 | -$191,171 from 104 |

Retention is the sharpest split in the whole report: **19% at D7 across every
FTD, 49–50% once you look only at Qualified and Super Qualified players.** The
Non Qualified bulk — 2,198 of 2,753 first deposits — barely comes back at all.

The reading that matters: the programme is roughly break-even in aggregate, and
that flat number is 84 streamers making **+$180,961** against 36 losing
**-$199,882**. Nearly all of the value and nearly all of the damage sits in a
handful of names at either end — the two ranking cards are where to look first.

Note that Super Qualified is only 257 of 2,753 first deposits (9%), but those
257 players account for $732,782 of the $1,138,567 deposited — **64% of the
money from 9% of the players**. Judging a streamer on raw FTD count and on
Super Qualified count gives two different league tables, which is why the
cohort toggle exists.

## Reconciliation

`build_streamers.py` rolls the cohort up twice — once per streamer, once per
month — and asserts the two agree inside a rounding budget of
`(streamers + months) × 0.005`, because each emitted value is rounded to 2dp. A
difference inside that budget is rounding; anything beyond it is a dropped row.
It also asserts FTD counts match exactly (they are integers, so no budget) and
that every streamer lands in exactly one of profit / loss / flat.

`test_streamers.js` then recomputes the headline figures **from the cache rows
with a second implementation** and compares. A second reading of the same code
finds nothing; a second implementation finds the bug.

## Comparing against the July deck

`streamer_country_ngr_categorization.pptx` reported 87 streamers, 58 active,
$378.4K deposit and +$46.1K NGR for Jan–Jun 2026, excluding DappCentre. It does
not reconcile with this page and is not meant to: it counted streamers active in
the window regardless of when their players were acquired, cut at June, excluded
one streamer by hand, and reported NGR rather than adjusted GGR. Use one or the
other, not both in the same sentence.
