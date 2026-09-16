-- Per-player, per-day money for the drill-down history. All-time: the modal
-- shows both sides of the transfer date, and "before" reaches back to
-- registration.
select s.player_id,
       s.transaction_date d,
       round(sum(s.deposit)::numeric, 2)       dep,
       sum(s.deposit_count)                    dc,
       round(sum(s.withdraw)::numeric, 2)      wd,
       round(sum(s.bet)::numeric, 2)           bet,
       round(sum(s.ggr)::numeric, 2)           ggr,
       round(sum(s.ggr + s.adjustment)::numeric, 2) adj,
       round(sum(s.ngr)::numeric, 2)           ngr,
       round(sum(s.total_bc)::numeric, 2)      bc
from bi.sum_player_daily_v s
where s.player_id in (select distinct player_id from public.loyalty_transfer_request)
group by 1, 2
having sum(s.deposit) <> 0 or sum(s.withdraw) <> 0 or sum(s.bet) <> 0
    or sum(s.ggr) <> 0 or sum(s.total_bc) <> 0 or sum(s.adjustment) <> 0
