-- Every bonus a transfer player received, across all four reward-ticket tables.
--
-- The first version of this read reward_tickets_bonus alone, which is bonus
-- MONEY only. Free spins, cash credits and free bets live in three sibling
-- tables, so a player like GoatedM (3917519) -- six VIP-transfer offers, all of
-- them free spins -- showed a single unrelated reload bonus in the drill-down.
--
-- Grouped per player x day x offer x kind: the promos mint one ticket per game
-- or per level, and 260k raw tickets is not a readable list. Kept to tickets
-- that actually opened (available_at is not null) plus every VIP-transfer
-- ticket whether or not it opened, because those never opening is the finding.
-- Amounts are converted the same way the old query did: amount * eur_rate on
-- the ticket's own day.
with c as (select distinct player_id from public.loyalty_transfer_request),
fams as (select id from public.reward_config_families where name ilike '%transfer%'),
t as (
  select b.player_id, 'Bonus money' kind, b.reward_config_family_id fam,
         coalesce(cfg.title::jsonb->>'en', '') title, b.currency_id,
         b.created_at, b.available_at, b.activated_at, b.completed_at, b.canceled_at,
         b.created_by, b.amount::numeric amount, 0 spins
  from public.reward_tickets_bonus b
  join c on c.player_id = b.player_id
  left join public.reward_configs_bonus cfg on cfg.id = b.reward_config_id
  union all
  select b.player_id, 'Free spins', b.reward_config_family_id,
         coalesce(cfg.title::jsonb->>'en', ''), b.currency_id,
         b.created_at, b.available_at, b.activated_at, b.completed_at, b.canceled_at,
         b.created_by, 0, coalesce(b.count, 0)
  from public.reward_tickets_freespin b
  join c on c.player_id = b.player_id
  left join public.reward_configs_freespin cfg on cfg.id = b.reward_config_id
  union all
  select b.player_id, 'Cash', b.reward_config_family_id,
         coalesce(cfg.title::jsonb->>'en', ''), b.currency_id,
         b.created_at, b.available_at, b.activated_at, b.completed_at, b.canceled_at,
         b.created_by, b.amount::numeric, 0
  from public.reward_tickets_real b
  join c on c.player_id = b.player_id
  left join public.reward_configs_real cfg on cfg.id = b.reward_config_id
  union all
  select b.player_id, 'Free bet', b.reward_config_family_id,
         coalesce(cfg.title::jsonb->>'en', ''), b.currency_id,
         b.created_at, b.available_at, b.activated_at, b.completed_at, b.canceled_at,
         b.created_by, b.amount::numeric, 0
  from public.reward_tickets_freebet b
  join c on c.player_id = b.player_id
  left join public.reward_configs_freebet cfg on cfg.id = b.reward_config_id),
k as (
  select t.player_id,
         coalesce(t.available_at, t.created_at)::date d,
         t.kind,
         nullif(t.title, '') nm,
         t.fam,
         f.name fam_name,
         -- the 25 VIP-transfer families, flagged here rather than matched on the
         -- config title later: the title is often just "$50 Free Spins", which
         -- says nothing about which programme it belongs to
         (coalesce(f.name, '') ilike '%transfer%') vip,
         count(*) tickets,
         sum(round(t.amount * coalesce(r.eur_rate, 0), 2)) amount_eur,
         sum(t.spins) spins,
         bool_or(t.available_at  is not null) opened,
         bool_or(t.activated_at  is not null) activated,
         bool_or(t.completed_at  is not null) completed,
         bool_or(t.canceled_at   is not null) canceled,
         min(t.created_by) source
  from t
  left join public.reward_config_families f on f.id = t.fam
  left join reports.daily_average_rates r
         on r.currency_id = t.currency_id and r.rate_date = t.created_at::date
  where t.available_at is not null or t.fam in (select id from fams)
  group by 1,2,3,4,5,6,7),
r as (select *, row_number() over (partition by player_id order by d desc) rn from k)
select player_id, d,
       coalesce(nm, fam_name, kind) bonus,
       fam code,                    -- reward_config_family_id, the number staff quote
       vip,
       kind, tickets, amount_eur, spins,
       case when completed             then 'completed'
            when canceled and activated then 'voided after use'
            when canceled              then 'not taken'
            when not opened            then 'never opened'
            when activated             then 'active'
            else 'offered' end status,
       source
from r
where rn <= 150
