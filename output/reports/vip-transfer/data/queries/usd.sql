-- Deposits in DOLLARS, per player per day.
--
-- The manager bonus scheme is written in dollars ($10,000 / $30,000 / $100,000)
-- while every other figure on this page is in euro, because bi.sum_player_daily_v
-- reports euro. Converting the euro total back at a rate would be wrong twice
-- over: the rate moves, and 10,904 player-days carry a deposit in
-- deposit_transactions with no deposit row at all in the view, so those players
-- would come out short however good the rate was.
--
-- public.deposit_transactions.amount_usd is the amount the player actually sent,
-- in dollars, so it is taken directly. Same filters depsize.sql uses: action_id 8
-- is a successful deposit, and is_duplicate rows are retries already counted.
select d.player_id,
       (d.created_at at time zone 'UTC')::date       d,
       round(sum(d.amount_usd)::numeric, 2)          usd,
       count(*)                                      n
from public.deposit_transactions d
where d.action_id = 8
  and coalesce(d.is_duplicate, false) = false
  and d.amount_usd > 0
  and d.player_id in (select distinct player_id from public.loyalty_transfer_request)
group by 1, 2
