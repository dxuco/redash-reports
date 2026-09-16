-- One row per player per VIP-transfer offer family: when it was first handed
-- out, and whether it was ever activated or completed. Tickets for one offer
-- are spread across the five ticket tables (the deposit condition, the wager
-- condition, the free spins, the payout leg), so all five are unioned and then
-- collapsed to the family.
with fams as (select id, name from public.reward_config_families where name ilike '%transfer%'),
t as (
  select player_id, reward_config_family_id fam, created_at, activated_at, completed_at
  from public.reward_tickets_bonus    where reward_config_family_id in (select id from fams)
  union all select player_id, reward_config_family_id, created_at, activated_at, completed_at
  from public.reward_tickets_freespin where reward_config_family_id in (select id from fams)
  union all select player_id, reward_config_family_id, created_at, activated_at, completed_at
  from public.reward_tickets_real     where reward_config_family_id in (select id from fams)
  union all select player_id, reward_config_family_id, created_at, activated_at, completed_at
  from public.reward_tickets_freebet  where reward_config_family_id in (select id from fams)
  union all select player_id, reward_config_family_id, created_at, activated_at, completed_at
  from public.reward_tickets_deposit  where reward_config_family_id in (select id from fams))
select t.player_id,
       t.fam fam_id,
       f.name fam_name,
       count(*) tickets,
       min(t.created_at)::date given_on,
       max((t.activated_at is not null)::int) activated,
       max((t.completed_at is not null)::int) completed
from t join fams f on f.id = t.fam
where t.player_id in (select distinct player_id from public.loyalty_transfer_request)
group by 1, 2, 3
