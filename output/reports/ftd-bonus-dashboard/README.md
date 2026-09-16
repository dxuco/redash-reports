# FTD bonus treatment dashboard

`ftd-bonus-dashboard.html` (single self-contained file, no server) answers: **are our
highest-value first-time depositors getting proper bonus treatment?**

For each month 2026-01 .. 2026-09 and each status filter (All / Active / Blocked) it
shows three ranked lists of 20 players from that month's FTD cohort:

- **Top 20 by deposits** (life-to-date since FTD)
- **Top 20 by adjusted GGR**
- **Bottom 20 by adjusted GGR** ("who's beating us")

Columns (as requested): username, country, aff name, FTD date, FTD type, deposit,
deposit count, adj GGR, bonus cost, Fiat/Crypto rail, active bonus count.

Clicking any row opens a day-by-day matrix (deposits / casino GGR / one row per bonus
template) showing exactly when each bonus was sent and whether it was used —
`€` = real cost booked that day, `✓` = issued with no cost recorded, `✗` = grant
failed, `·` = nothing that day. Names in red are known manual/VIP bonus patterns that
bypass Smartico entirely.

## Data sources & key decisions

- **Redash query 1732** (cached at `ftd-report/cache/YYYY-MM.json`) supplies deposit,
  deposit count, GGR, adjusted GGR, bonus cost (realized), rail, aff_username, ftd_type,
  player_status — everything in the main table except "active bonus".
- **Smartico BigQuery `dwh_ext_28047.j_bonuses`** (label 28047, FortuneJack) supplies
  the bonus grant/redemption timeline used in the "active bonus" count and the modal's
  day-by-day grant rows. `bonus_status_id` observed: 3 = REDEEMED, 4 = REDEEM_FAILED.
  "Active bonus" = count of grants that reached REDEEMED.
- **Smartico's own `bonus_cost_value` is always 0** in this warehouse — real dollar
  bonus cost always comes from Redash's `bonus_cost` field. Smartico is used purely for
  the grant/redemption event timeline, exactly as the existing house reports do.
- **Life-to-date since FTD**: because a player's FTD is their first-ever deposit,
  summing their entire activity across the full cached data window (through the last
  refreshed month) equals "since FTD." No separate windowing was needed.
- **Data minimization**: full Smartico detail is only pulled for the ~799 players who
  actually appear in some Top/Bottom-20 view across all 9 months × 3 status filters —
  not the full ~8,150-player cohort. This keeps the page small and query volume sane.
  If a player is added to a table by a future rebuild and isn't in that set, their
  modal will show blank bonus rows — rebuild `needed_players_all_v2.json` first.
- **Aff name** = `aff_username` captured on the player's FTD-day row specifically
  (later-row affiliate changes don't count); blank shows as "Direct."
- **Rail (Fiat/Crypto)** = classified from the first deposit row carrying a non-empty
  payment method, using the same `CRYPTO_RAILS` list as `ftd-report/ftd-aggregate.js`.

## Caveat (read before drawing conclusions)

Smartico misses bonuses issued manually by account managers outside the platform —
e.g. bespoke VIP reload/cashback packages ("Iva's 150% deposit" style offers). A whale
showing zero or few bonuses here may still have been treated well off-system. Always
cross-check a surprising zero with the VIP/account management team before concluding a
player was neglected. The dashboard flags known manual-bonus name patterns in red in
the player detail, but that list is not guaranteed complete.

## Rebuilding

Three-file pattern, same as the rest of `C:\redash-page`:

```
build_cohorts.py          reads ftd-report/cache/*.json -> cohorts.json, daily.json,
                           redash_bonus.json, cohort_pids.json
(BigQuery pulls)           via mcp CRM_2_0 exec_sql against dwh_ext_28047.j_bonuses,
                           restricted to the "needed" player set -> bonus_raw/*.json
merge_smartico.py          bonus_raw/*.json -> smartico_bonus_v2.json
build_final.py             cohorts.json + smartico_bonus_v2.json -> final_tables.json
                           (the actual top/bottom-20 rankings per month/status)
build_dashboard_data.py    final_tables.json + daily/costs/grants -> dashboard-data.js
                           (compact pipe/tilde-encoded strings, same encoding style as
                           the September reference report)
ftd-bonus-template.html    page shell with a literal __DASHBOARD_DATA__ token
make_html.py               template.replace(...) -> ftd-bonus-dashboard.html
test_dashboard.js          renders the built page in jsdom, exercises month/status
                           switching, sorting, and the click-to-open-modal flow
```

`ftd-bonus-dashboard.html` at the folder root is **generated** — never edit it
directly; edit the template or a builder script and re-run `make_html.py`.

Refreshing to a new month once its Redash cache and BigQuery data are on file means:
re-run `build_cohorts.py`, recompute which players are newly "needed" for the new
month's Top/Bottom-20 views (across all 3 status filters), pull their Smartico bonus
history, re-run `merge_smartico.py` -> `build_final.py` -> `build_dashboard_data.py` ->
`make_html.py`.
