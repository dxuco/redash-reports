# Community channels — Discord / Twitter / Telegram, 2026

Built page: `../community-channels.html` (standalone, opens by double-clicking).
**Generated — never edit it.** Edit `channels-template.html` and re-bake.

```
python build_channels.py        # caches + ticket export -> channels-data.json
python make_channels_html.py    # template + data        -> ../community-channels.html
node   ../check-theme.js        # palette + cover band
node   test_channels.js         # renders the built page in jsdom
```

## Publishing

Registered in `publish-worker.js` as `/community`, labelled **Community**, last
in `NAV_ORDER`. Run `6-publish.bat` from the project root — it stages every
report into `publish\` and deploys the Worker.

The page must keep an explicit opening body tag. `publish-worker.js` injects the
site nav bar straight after it and calls `die()` if it cannot find one, which
takes down the whole publish, not just this page. The template was originally a
bare fragment and failed exactly that way.

**Worse, it must not contain that tag name in angle brackets anywhere earlier —
comments included.** The publisher regex-matches the first occurrence in the
file. The comment written above the real tag to explain this rule contained the
tag name, so the nav bar was injected *into the comment*: invisible, no error,
and a published page with no header. The first fix reintroduced the bug by
quoting the regex. `test_channels.js` now performs the injection the way the
publisher does and asserts the bar lands as the body's first child.

## Where the two halves come from

**GGR** comes from `../ftd-report/cache/2026-*.json` (query 1732, player × day).
Free and on disk — do not call the Redash API for it.

**Tickets** come from `reports.reward_tickets_data`, which query 1732 does not
carry. This is the distinction that prompted the report: 1732's `bonus_cost` is
`action_id = 24` only — the bonus→real conversion, i.e. **what the player won out
of the ticket**. `reward_tickets_data` has the issued side: one row per ticket
(`process_id`), with `is_activated`, `is_completed`, `freespin_count`,
`freebet_amount` and the realised `*_cost` columns beside them.

Regenerate the export with `run_sql` (data source 20) and `save_as`. Pass
`max_rows: 1` — `save_as` writes the full set regardless, and the full result is
too large to return inline. It lands in `../_mcp-exports/`, whatever path you
give it:

```sql
select rtd.player_id,
 to_char(date_trunc('month', rtd.created_at),'YYYY-MM') ym,
 case when rcf.name ilike '%discord%'  then 'Discord'
      when rcf.name ilike '%twitter%'  then 'Twitter'
      else 'Telegram' end channel,
 count(*) created,
 sum(case when rtd.is_completed='Yes' then 1 else 0 end) completed,
 sum(case when rtd.is_activated='Yes' then 1 else 0 end) activated,
 round(sum(coalesce(rtd.bonus_cost,0))::numeric,4) bonus_cost
from reports.reward_tickets_data rtd
join public.reward_config_families rcf on rcf.id = rtd.reward_family_id
join public.reward_config_family_groups g on g.id = rcf.group_id
where g.name = 'Acquisition - Community'
 and (rcf.name ilike '%discord%' or rcf.name ilike '%twitter%'
      or rcf.name ilike '%telegram%')
 and rtd.created_at >= '2025-01-01' and rtd.created_at < '2026-09-01'
group by 1,2,3 order by 2,3,1
```

2025 is in the range on purpose — it seeds the cumulative cohort. The page shows
2026 months only.

**This export supplies player membership only.** The ticket counts come from the
per-bonus detail export below. Counting created tickets from one export and
listing them from the other put August out by two the first time it ran, because
the two were pulled hours apart and the current month is still live. One source
per number. Regenerate the detail export the same way (`max_rows: 1` +
`save_as`), and re-pull both together if a month looks off:

```sql
select to_char(date_trunc('month', rtd.created_at),'YYYY-MM') ym,
 case when rcf.name ilike '%discord%'  then 'Discord'
      when rcf.name ilike '%twitter%'  then 'Twitter'
      when rcf.name ilike '%telegram%' then 'Telegram'
      else 'Other' end channel,
 rcf.name bonus_name, rcf."scope" bonus_scope,
 count(*) created,
 sum(case when rtd.is_completed='Yes' then 1 else 0 end) completed,
 count(distinct rtd.player_id) players,
 sum(coalesce(rtd.freespin_count,0)) fs_issued,
 sum(coalesce(rtd.used_freespin_count,0)) fs_used,
 round(sum(coalesce(rtd.freebet_amount,0))::numeric,2) fb_issued,
 round(sum(coalesce(rtd.bonus_cost,0))::numeric,2) cost
from reports.reward_tickets_data rtd
join public.reward_config_families rcf on rcf.id=rtd.reward_family_id
join public.reward_config_family_groups g on g.id=rcf.group_id
where g.name='Acquisition - Community'
 and rtd.created_at >= '2026-01-01' and rtd.created_at < '2026-09-01'
group by 1,2,3,4 order by 1,2,5 desc
```

**The by-bonus table is rolled up from the detail export**, not from its own
counts. `_mcp-exports/bonus-year-2026.json` supplies only the two figures a
roll-up cannot produce — distinct players over the year, and distinct players
who cost anything — and nothing is asserted across the two exports. Counting
tickets from one export while listing them from another put August out by two
the first time and by nine the second: the current month is live and the pulls
are hours apart. `activated` and freebet-used are clamped rather than asserted
for the same reason.

Its total row shows **distinct** players — 755, against 1,480 if you add the
column — with the sum printed beside it so the overlap reads as overlap rather
than as an arithmetic error. The distinct figure cannot be derived from the rows
and is hard-coded in `build_channels.py` from a `count(distinct …)` over the
union; the SQL is in a comment beside it, and three assertions bound it (a union
is no larger than the sum of its parts, no smaller than its largest part, and
users are a subset of players). **Re-run that query when the window moves.**

"Used" is three different things on that table, deliberately: **activated** (the
player accepted it), **completed** (it ran to the end of its wagering), and
**players who used it** (it actually converted something to real balance). The
last is the only one that costs money and is always the smallest — *Discord No
deposit freebet Community* completed 858 of 858 tickets while only 46 of its 155
players ever converted anything.

**Two click-throughs.** A channel or subtotal row in the by-month table opens the
individual bonuses behind it. A segment row opens the players behind its
"Community reached" cell — all 397 are inlined, which is what takes the built
page from 33 KB to 156 KB. Both popups' totals are asserted equal to the cell
that opened them, in the builder and again on the rendered page.

Clicking a channel row in the by-month table opens the individual bonuses behind
it. The builder asserts each popup's totals equal the row that opened it, and a
test asserts it again on the rendered page. The players column is deliberately
not totalled — one person can hold several bonuses in a month.

## Decisions baked in

**Channel comes from the bonus name**, matched on the three words. Every
social-channel bonus lives in the single group `Acquisition - Community`, and
nothing outside that group uses those words, so the group filter and the name
filter agree — checked, not assumed. Everything else in that group (blog posts,
generic free-spin promos) has no channel and is out of scope for this page.

**Two attribution modes, both built into the data.** *Recipients that month* =
players who got that channel's ticket in that same month. *Cumulative cohort* =
anyone who has ever got one, counted in every later month. The page opens on
cohort. Neither is derivable from the other on the page, so `build_channels.py`
emits both.

**Distinct never sums.** Player counts are distinct within a month; a player
with three tickets is one player, and the same player recurs in every month of
the cohort view. The three channel rows exceed the "Any channel" row because
players hold tickets in more than one channel — that gap is emitted as
`overlap` and stated on the page rather than reconciled away.

**Top depositor excluded by default**, toggle to include, per the Bonus Cost
precedent. Keyed on `player_id` 1709996, never on username. He is not in any of
the three channels, so the toggle moves only the denominator — which is the
whole point: his GGR is most of the company total and leaving him in makes every
channel look three times smaller than it runs at.

**Concentration is a first-class figure.** Twitter's 2026 GGR is 68% one account
(1480720). A share line alone would read as a channel result. `conc` is the
largest single player's percentage of that channel's own GGR, shown in the table
and called out in the caption whenever it passes 50% in the latest month, with a
test asserting both.

**Shares go negative.** Discord's January 2026 share is −1.7%: those players
collectively won. The line drops below a darkened zero rule rather than being
clamped, and the sign goes before the currency symbol.

**Penetration is people over people.** Of the month's distinct depositors, how
many hold at least one ticket. Both halves are distinct player sets over the
same month, intersected — not tickets divided by deposits, which would compare
two different units and drift above 100% the moment a channel hands one player
several tickets. A depositor who deposits on five days is one depositor.

**Community is the whole reward group**, the three named channels plus every
bonus with no channel in its name. The three channel rows sit *inside* the
Community row; they are a subset of it, not siblings, and the test asserts that
relation so a future edit cannot quietly turn them into peers.

**One chart, two tables.** The page ended up here after three charts were
removed on sight, and the reasons are worth keeping:

- *Tickets created/completed* — grouped bars put 37 Telegram tickets next to
  4,190 Discord ones, so two of four series were invisible.
- *Share of total GGR* — four lines saying what three table columns say more
  precisely, and the reader wants to compare months, not trace crossings.
- *The first penetration chart* — a depositor backdrop plus four solid bars plus
  four dashed lines on a second axis. At 3% penetration the channel bars were
  4px.

All the underlying figures survive in `channels-data.json` and in the tables;
tests assert each removed chart stays removed, so nobody re-adds one by reflex.
The concentration caption moved onto the by-month table when its chart went.

**Adjusted GGR is its own measure.** It arrives on its own rows in query 1732 —
never sharing a row with `ggr` or `game_product`, which is also why the page
does not split it by game category. It is computed upstream as GGR plus
adjustments over a different scope, so it is **not** raw GGR minus bonus cost
and is never derived that way here. The adjusted table prints the Community
share on both measures side by side (15.6% adjusted against 16.2% raw, 2026 to
date) rather than reconciling them, and the builder asserts the two totals
differ so nobody can start deriving one from the other.

The period row is recomputed from summed dollars, not averaged across the eight
monthly percentages — the months are different sizes, so a mean is a different
and wrong number. A test asserts the two disagree.

**Segments come from a separate export.** The caches carry no segment column, so
`_mcp-exports/segments-2026.json` maps player to `current_segment` from
`bi.players_info_mv` for everyone who deposited in 2026:

```sql
select distinct pim.player_id,
       coalesce(pim.current_segment,'Unsegmented') current_segment
from bi.players_info_mv pim
where exists (
  select 1 from public.deposit_transactions dt
  where dt.player_id = pim.player_id and dt.id >= 900000000
    and dt.created_at >= '2026-01-01' and dt.created_at < '2026-09-01')
```

`current_segment` is where a player sits **today**, not in the month counted —
someone who was Mass in January and is Vip now appears wholly as Vip. That is
the right trade for a period table (one segment per player, not eight), and
`reports.player_segments_hist` has the time-varying version if a monthly split
is ever wanted. The builder asserts every depositor lands in a segment, so a
gap in the export fails the build rather than quietly shrinking the table.

The segment table follows **both** switches, like everything else. It was
hard-wired to cumulative cohort, and when the page default moved to same-month
reach the adjusted table read $141,508 for Community while the segment table
read $1,394,203 — the same quantity under two different attributions, with
nothing on screen to tell them apart. Both modes are now built and both are
asserted against the monthly series.

Money is credited to a group **only from the month a player joined it**, the
same rule the monthly table uses. Crediting a June joiner's January play
retroactively would have made the two tables disagree ($1.62m against $1.40m)
for no visible reason.

The two views, Community, 2026 to date:

| | Reached | Penetration | Community adj. GGR |
|---|---|---|---|
| Same-month | 266 | 2.7% | $139,941 |
| Cumulative cohort | 397 | 4.0% | $1,394,203 |

**A share over a negative denominator is not printed.** Mass and Risk both run
negative adjusted GGR — their players are collectively ahead. Community's
+$22,081 inside Mass's −$126,216 would print as −17.5%, which reads as the
opposite of what happened, so those cells say n/a and the dollars are shown.

## Cross-checks

- 2026 tickets recomputed straight from `reward_tickets_data` in Redash:
  Discord 4,190 created / 4,127 completed, Twitter 284 / 269, Telegram 37 / 37 —
  matches the built page exactly.
- August 2026 cohort figures recomputed from the raw cache rows by a second
  implementation: Discord 345 players / $17,000 / 1.97%, Twitter 427 /
  $169,355 / 19.64%, Telegram 61 / $5,887 / 0.68%. Matches.
- 2025 community bonus cost from `reward_tickets_data` is €96,807 against
  €96,742 from the caches; the gap is the query's staff/streamer exclusions and
  timezone edges.
- **Depositor counting matches business-overview exactly.** That page's January
  2025 running-distinct ends at 1,680; the same month counted here ex-whale is
  1,680, and its first day is 165 against 166 inclusive of the whale, who
  deposited that day. Two independently written counters landing on the same
  number is the check worth having — the definition of "depositor" is where
  these reports most easily drift apart.
- Segment penetration recomputed by a second implementation: Churn 3,216/16,
  One Timer 2,745/66, Mass 1,833/137, Regular 1,002/58, Free Rider 642/43,
  Pre Elit 140/25, Elit 129/15, Vip 76/19, Risk 70/18 — 9,853 depositors and
  397 reached, 4.0% overall. Matches.
- Adjusted GGR recomputed month by month by a second implementation: totals
  1,007,573 / 1,043,551 / 1,135,277 / 1,151,066 / 1,456,251 / 952,593 /
  1,214,672 / 967,038 and Community shares 6.0, 17.2, 14.9, 9.0, 16.7, 21.8,
  17.2, 23.2 percent. Matches to the dollar.
- Penetration recomputed month by month by a second implementation (cohort
  membership derived from each player's first ticket date rather than from a
  running union): 9.0, 9.7, 8.2, 7.0, 6.0, 7.8, 7.3, 8.7 percent. Matches.

2026-08 is partial — the cache runs to the 26th.
