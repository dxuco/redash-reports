-- The same tickets as tbfam.sql, collapsed to one row per player: did this
-- requester ever get a VIP-transfer offer, take it, and finish it.
with fams as (select id from public.reward_config_families where name ilike '%transfer%'),
t as (
  select player_id, created_at, activated_at, completed_at
  from public.reward_tickets_bonus    where reward_config_family_id in (select id from fams)
  union all select player_id, created_at, activated_at, completed_at
  from public.reward_tickets_freespin where reward_config_family_id in (select id from fams)
  union all select player_id, created_at, activated_at, completed_at
  from public.reward_tickets_real     where reward_config_family_id in (select id from fams)
  union all select player_id, created_at, activated_at, completed_at
  from public.reward_tickets_freebet  where reward_config_family_id in (select id from fams)
  union all select player_id, created_at, activated_at, completed_at
  from public.reward_tickets_deposit  where reward_config_family_id in (select id from fams))
select player_id,
       count(*) tickets,
       min(created_at)::date first_given,
       max((activated_at is not null)::int) activated,
       max((completed_at is not null)::int) completed
from t
where player_id in (select distinct player_id from public.loyalty_transfer_request)
group by 1
