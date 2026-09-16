-- Deposit sizes and VIP-transfer free spins, per player, dated from the
-- transfer request. Feeds the "Who deposited, and what they got" tree.
--
-- max_dep is the largest SINGLE deposit, not a daily total: taking it from
-- bi.sum_player_daily_v would promote anyone who topped up ten times in an
-- evening into the EUR 1,000 branch. deposit_transactions.amount_usd is in
-- dollars while the rest of the page is in euro, so each transaction is scaled
-- by its own player-day's implied rate (view euro / transaction dollars); the
-- 0.861 fallback only fires on days the view has no deposit row.
with c as (select player_id, min(requested_at)::date req from public.loyalty_transfer_request group by 1),
tx as (
  select d.player_id, (d.created_at at time zone 'UTC')::date dd, d.amount_usd::numeric usd
  from public.deposit_transactions d join c on c.player_id = d.player_id
  where d.action_id = 8 and coalesce(d.is_duplicate,false) = false
    and (d.created_at at time zone 'UTC')::date >= c.req and d.amount_usd > 0),
dayusd as (select player_id, dd, sum(usd) usd from tx group by 1,2),
dayeur as (
  select s.player_id, s.transaction_date dd, sum(s.deposit)::numeric eur
  from bi.sum_player_daily_v s join c on c.player_id = s.player_id
  where s.transaction_date >= c.req and s.deposit > 0 group by 1,2),
conv as (
  select t.player_id, t.dd, t.usd * coalesce(e.eur / nullif(u.usd,0), 0.861) eur
  from tx t join dayusd u on u.player_id = t.player_id and u.dd = t.dd
            left join dayeur e on e.player_id = t.player_id and e.dd = t.dd),
dep as (
  select player_id, max(eur) max_dep, sum(eur) sum_dep, count(*) n_dep,
         count(*) filter (where eur >= 1000) n_big, min(dd) first_dep
  from conv group by 1),
-- SCOPE. The tree counts only the four offers that make up the current transfer
-- programme, not all 25 families whose name happens to contain "transfer":
--   1925  VIP Transfer Cashback Offer
--   1941  VIP Transfer Bonus Deposit $1000 Wager 3x Get $150FS
--   2034  New VIP Transfer Deposit Bonus Max 600 Free Spins
--   the wheel tiers -- name carries both "wheel" and "vip transfer"
-- The older Vip Transfer_* one-offs are excluded here; they are still in the
-- Bonus distribution table below the tree.
--
-- Free spins that actually reached the player: available_at is the moment the
-- ticket opens. It matters which way round this is read -- 642 of the 643
-- tickets under family 1941 have never opened -- so `held_*` counts the ticket
-- existing at all and `n_fs*` counts it having opened.
scope as (
  select id, name,
         case when id = 1941 then 'o1941'
              when id = 2034 then 'o2034'
              when id = 1925 then 'cashback'
              else 'wheel' end bucket
  from public.reward_config_families
  where id in (1925, 1941, 2034)
     or (name ilike '%wheel%' and name ilike '%vip%transfer%')),
fs as (
  select t.player_id,
         min((t.available_at at time zone 'UTC')::date) first_fs,
         count(*) filter (where t.available_at is not null) n_fs,
         count(*) filter (where t.available_at is not null and s.bucket = 'o1941') n_fs_1941,
         count(*) filter (where t.available_at is not null and s.bucket = 'o2034') n_fs_2034,
         count(*) filter (where t.available_at is not null and s.bucket = 'wheel') n_fs_wheel,
         count(*) filter (where t.activated_at is not null) n_fs_act,
         count(*) filter (where s.bucket = 'o1941') held_1941,
         count(*) filter (where s.bucket = 'o2034') held_2034,
         count(*) filter (where s.bucket = 'wheel') held_wheel,
         sum(t.count) filter (where t.available_at is not null) spins
  from public.reward_tickets_freespin t
  join c on c.player_id = t.player_id
  join scope s on s.id = t.reward_config_family_id
  where coalesce((t.available_at at time zone 'UTC')::date,
                 (t.created_at   at time zone 'UTC')::date) >= c.req
  group by 1),
-- The VIP Transfer Cashback offer (family 1925) pays in real money, so its
-- tickets live in reward_tickets_real, not the bonus or free-spin tables. Same
-- open/unopened split as the free spins: 1,806 tickets exist, 4 have opened.
cb as (
  select t.player_id,
         count(*) held_cb,
         count(*) filter (where t.available_at is not null) n_cb,
         sum(t.amount) filter (where t.available_at is not null) cb_amount
  from public.reward_tickets_real t
  join c on c.player_id = t.player_id
  where t.reward_config_family_id = 1925
    and coalesce((t.available_at at time zone 'UTC')::date,
                 (t.created_at   at time zone 'UTC')::date) >= c.req
  group by 1),
-- HOW MUCH REACHED THE 1941 CONDITION IN TIME.
--
-- 1941 asks for a $1,000 deposit, and the ticket expires: 7.2 days on average,
-- never longer than a month. Deposits made after it lapsed cannot have met the
-- condition, however large, so the tree needs the amount inside the window
-- rather than the all-time largest deposit it showed before.
--
-- The window opens at created_at, not available_at. Every one of the 643
-- free-spin tickets under this family has a null available_at, so keying off it
-- would give every player an empty window; created_at is the day the offer
-- actually appeared against their account.
--
-- Both legs of the offer (the deposit condition and the free spins) carry the
-- same dates, so min/max over the family collapses them without double-counting.
b41 as (
  select t.player_id,
         min((t.created_at at time zone 'UTC')::date) b41_from,
         max((t.expires_at at time zone 'UTC')::date) b41_to,
         count(*) b41_tickets
  from (select player_id, created_at, expires_at from public.reward_tickets_deposit  where reward_config_family_id = 1941
        union all
        select player_id, created_at, expires_at from public.reward_tickets_freespin where reward_config_family_id = 1941
        union all
        select player_id, created_at, expires_at from public.reward_tickets_bonus    where reward_config_family_id = 1941) t
  join c on c.player_id = t.player_id
  group by 1),
b41dep as (
  select b.player_id,
         sum(s.deposit)                                    b41_dep,
         count(*) filter (where s.deposit > 0)             b41_days
  from b41 b
  join bi.sum_player_daily_v s on s.player_id = b.player_id
   and s.transaction_date >= b.b41_from
   and s.transaction_date <= b.b41_to
  group by 1),
-- The SINGLE largest deposit inside the window, from `conv` (one row per
-- transaction, already converted to euro). The daily sum above cannot answer
-- this: 1941 asks for one deposit of $1,000, and six EUR 200 top-ups in a day
-- are not that.
b41big as (
  select v.player_id,
         max(v.eur)                              b41_max,
         count(*) filter (where v.eur >= 1000)    b41_big
  from conv v join b41 b on b.player_id = v.player_id
  where v.dd >= b.b41_from and v.dd <= b.b41_to
  group by 1)
select c.player_id, c.req, d.max_dep, d.sum_dep, d.n_dep, d.n_big, d.first_dep,
       fs.first_fs, fs.n_fs, fs.n_fs_1941, fs.n_fs_2034, fs.n_fs_wheel, fs.n_fs_act,
       fs.held_1941, fs.held_2034, fs.held_wheel, fs.spins,
       cb.held_cb, cb.n_cb, cb.cb_amount,
       b41.b41_from, b41.b41_to, b41.b41_tickets, b41dep.b41_dep, b41dep.b41_days,
       b41big.b41_max, b41big.b41_big
from c left join dep d  on d.player_id  = c.player_id
       left join fs     on fs.player_id = c.player_id
       left join cb     on cb.player_id = c.player_id
       left join b41    on b41.player_id = c.player_id
       left join b41dep on b41dep.player_id = c.player_id
       left join b41big on b41big.player_id = c.player_id
