# Where the VIP transfer data comes from

## The cohort is the warehouse, not the sheet

`public.loyalty_transfer_request` is the record of who asked to transfer:
**1,639 players**, 18 Aug 2025 to 24 Aug 2026. The Google Sheet tracker covers
**152**, of which **149** are in that table — so about **91% of transfer
requesters were never onboarded by a VA**. That gap is the point of the
*Did the VA onboarding matter?* table on the page.

Redash query **1759 "VIP Transfer"** covers the same ground and is where this
table was found.

## Two split dates, and they are not the same thing

| | What it is | Where it lives |
|---|---|---|
| **Request date** | `min(loyalty_transfer_request.requested_at)` — when the player asked | Warehouse. Authoritative. |
| **Onboarding date** | when a VA actually onboarded them | Google Sheet only |

They differ a lot: of the 149 players in both, only 41 match to the day, 75 fall
within a week, and the sheet date averages **52 days after** the request (max
344). Some sheet dates precede the request by up to 31 days, which is impossible
— the sheet has date-entry errors. Default the page to the request basis; the
onboarding basis is there to judge the VA programme, not to measure the player.


## Blank User IDs in the sheet — read this before refreshing

13 tracker rows carry a username and a VA but **no User ID**. Column C is typed
as a number, so a blank or text cell reads back as null and a naive extract drops
the player silently — they land in "Not onboarded" and their VA loses them.
Shakesphere101 (3539058) was found this way.

So the roster build is: take the User ID where there is one, and where there is
not, resolve the username against `public.players`:

```sql
select p.id, p.username from public.players p
where lower(p.username) in ( ...the blank-ID usernames... );
```

All 13 resolved to exactly one account each. Check the match count is 1 — a
username collision would silently attach the wrong player.

`roster.json` records `id_from: "username:<name>"` on any row resolved this way,
so it is always visible which players did not come from a real ID.

**The real fix is upstream**: fill in the User ID column. Usernames change;
player ids do not.

## Files

| File | What it is | How to refresh |
|---|---|---|
| `cohort.json` | One row per requester: dims (including `aff_username` from `bi.players_info_mv`), both split dates, and all-time money either side of each. | Run `queries/cohort.sql` on data source 20, save the result here. |
| `roster.json` | VA and source casino for the tracked players. | Google Sheet *VIP TRANSFER ONBOARDING DASHBOARD* → *VIP Transfer Tracker*. Not in the warehouse. |
| `bonus.json` | Every bonus received, across all four ticket tables, grouped per player x day x offer x kind, newest 150 per player. Feeds the drill-down. | Run `queries/bonus.sql` on data source 20. `fetch_vip.js` does it automatically. |
| `depsize.json` | Largest **single** deposit, deposit count, and VIP-transfer free spins per player, all dated from the transfer request. Feeds the deposit-size tree. | Run `queries/depsize.sql` on data source 20. `fetch_vip.js` does it automatically. |

Everything except the VA name, the source casino and the onboarding date now
rebuilds from Redash. Wire `queries/cohort.sql` into the nightly job and the
page keeps itself current; only the three sheet-only fields go stale.

## Things that will bite you

**The $1,000 offer's free spins mostly do not exist yet.** Family 1941
("VIP Transfer Bonus Deposit $1000 Wager 3x Get $150FS") has 643 free-spin
tickets and **642 of them have a null `available_at`** — minted when the offer
was handed out, never opened. One player has ever spun them. The wheel families
(1926-1934) open normally. So on the tree, "received free spins" means
`available_at is not null`; a ticket merely existing is counted separately as
"$1,000 ticket never opened". Reading `reward_tickets_freespin` without that
distinction will tell you 555 players got their $150, and they did not.

**There are four reward-ticket tables, not one.** `reward_tickets_bonus` is
bonus *money* only. Free spins are in `reward_tickets_freespin`, cash credits and
most promo payouts in `reward_tickets_real`, sportsbook free bets in
`reward_tickets_freebet`. Reading only the first one made the drill-down show
GoatedM (3917519) a single unrelated reload bonus when he had six VIP-transfer
offers, all of them free spins. `queries/bonus.sql` unions all four.

Two consequences worth knowing. The raw union is 260k tickets for this cohort,
because promos mint one ticket per game or per level, so the query groups per
player x day x offer x kind and keeps the newest 150 per player. And a free-spin
offer often appears twice -- once as the spins, once as a "Cash" row with the
same offer name, which is the payout leg landing as real money.

**Cashback pays in real money, so its tickets are somewhere else.** Family 1925
("VIP Transfer Cashback Offer") has nothing in `reward_tickets_bonus` or
`reward_tickets_freespin` — searching those two will tell you the offer does not
exist. It lives in `reward_tickets_real`: 1,806 tickets, 648 players, and **4
opened**. Same failure mode as 1941.

**Deposit size is per transaction, and `deposit_transactions` is in dollars.**
`bi.sum_player_daily_v.deposit` is a daily total, so ten €150 top-ups in one
evening would read as a €1,500 deposit and land in the wrong branch of the tree.
`queries/depsize.sql` goes to `public.deposit_transactions` instead
(`action_id = 8`, `is_duplicate = false`) and scales each transaction by its own
player-day implied rate — the view's euro over the day's dollars — so the tree
and the money tables agree. Dividing by a flat rate instead drifts by a few
percent across a year.

**Free spins on the tree are transfer offers only.** `reward_tickets_freespin`
covers every free spin the casino gives; 1,221 of the 1,689 requesters have one,
which splits nothing. Joining to the 25 `%transfer%` families cuts it to the
delivery the offers actually promise.

**`bi.sum_player_daily_v` replaced a hand-built pipeline.** Earlier versions of
this report aggregated `deposit_transactions`, `dwh_fct_transaction_detail` and
the Betby sportsbook sessions directly, and had to work around a bug in query
1732 where the sportsbook bet leg is not currency-converted. `sum_player_daily_v`
already has deposit, bet, GGR by product, adjusted GGR, NGR and bonus cost per
player per day, correctly converted. Use it.

**Use a LEFT join to `players_info_mv`.** 20 of the 1,639 requesters are missing
from it, and an inner join drops them without complaint.

**Before is all-time.** Both sides span the player's whole history, so a
long-standing account can show six years of "before" against three weeks of
"after". That is why every headline figure is a monthly average.
