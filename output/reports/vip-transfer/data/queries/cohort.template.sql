-- VIP Transfer cohort: every player in loyalty_transfer_request, measured over
-- MATCHED WINDOWS either side of two split dates -- the transfer request
-- (rb_/ra_) and the VA onboarding date from the tracker sheet (ob_/oa_).
--
-- "Before" is not all-time. If a player requested 2 days ago, "after" is those
-- 2 days and "before" is the 2 days immediately preceding the request, so the
-- two sides cover the same number of days and can be subtracted directly. The
-- old all-time version compared six years of history against three weeks and
-- needed a monthly average to mean anything.
--
-- TEMPLATE. fetch_vip.js substitutes the placeholder below with (player_id, onboard)
-- pairs read live from the tracker sheet, then runs this against data source 20
-- and writes data/cohort.json. Do not run this file directly.
with req as (
  select player_id, min(requested_at)::date first_req, max(requested_at)::date last_req,
         count(*) req_count, max(valid_through)::date valid_through
  from public.loyalty_transfer_request
  where requested_at < current_date
  group by 1)
-- The onboarding dates arrive as quoted literals in a VALUES list, and Postgres
-- types an all-literal column as text -- so `current_date - s.onboard` below dies
-- with "operator does not exist: date - text". Cast once, here, rather than at
-- each of the four use sites.
-- nullif because a tracker row can name a player who has no onboarding date yet
-- (Mariam Khoperia's first row is one), and ''::date raises rather than
-- returning null. Those players stay in the sheet CTE and so count as tracked;
-- they simply have no onboarding split.
, sheet(player_id, onboard) as (
    select v.player_id, nullif(btrim(v.onboard), '')::date
    from (values __SHEET_VALUES__) v(player_id, onboard))
, base as (
  select r.player_id, r.first_req, r.last_req, r.req_count, r.valid_through, s.onboard,
         (s.player_id is not null) tracked,
         -- window length in days, inclusive of the split day itself
         (current_date - r.first_req) + 1                       req_days,
         r.first_req - ((current_date - r.first_req) + 1)       req_from,
         case when s.onboard is not null
              then (current_date - s.onboard) + 1 end           onb_days,
         case when s.onboard is not null
              then s.onboard - ((current_date - s.onboard) + 1) end onb_from
  from req r left join sheet s on s.player_id = r.player_id)
, d as (
  select b.player_id,
    -- split at the request date
    sum(case when sp.transaction_date >= b.req_from and sp.transaction_date < b.first_req then sp.deposit end)             rb_dep,
    sum(case when sp.transaction_date >= b.req_from and sp.transaction_date < b.first_req then sp.deposit_count end)       rb_dc,
    sum(case when sp.transaction_date >= b.req_from and sp.transaction_date < b.first_req then sp.bet end)                 rb_bet,
    sum(case when sp.transaction_date >= b.req_from and sp.transaction_date < b.first_req then sp.ggr end)                 rb_ggr,
    sum(case when sp.transaction_date >= b.req_from and sp.transaction_date < b.first_req then sp.ggr + sp.adjustment end) rb_adj,
    sum(case when sp.transaction_date >= b.req_from and sp.transaction_date < b.first_req then sp.ngr end)                 rb_ngr,
    sum(case when sp.transaction_date >= b.req_from and sp.transaction_date < b.first_req then sp.bonus_claimed end)       rb_bc,
    sum(case when sp.transaction_date >= b.first_req then sp.deposit end)             ra_dep,
    sum(case when sp.transaction_date >= b.first_req then sp.deposit_count end)       ra_dc,
    sum(case when sp.transaction_date >= b.first_req then sp.bet end)                 ra_bet,
    sum(case when sp.transaction_date >= b.first_req then sp.ggr end)                 ra_ggr,
    sum(case when sp.transaction_date >= b.first_req then sp.ggr + sp.adjustment end) ra_adj,
    sum(case when sp.transaction_date >= b.first_req then sp.ngr end)                 ra_ngr,
    sum(case when sp.transaction_date >= b.first_req then sp.bonus_claimed end)       ra_bc,
    -- split at the onboarding date, null for anyone not on the tracker
    sum(case when sp.transaction_date >= b.onb_from and sp.transaction_date < b.onboard then sp.deposit end)             ob_dep,
    sum(case when sp.transaction_date >= b.onb_from and sp.transaction_date < b.onboard then sp.deposit_count end)       ob_dc,
    sum(case when sp.transaction_date >= b.onb_from and sp.transaction_date < b.onboard then sp.ggr end)                 ob_ggr,
    sum(case when sp.transaction_date >= b.onb_from and sp.transaction_date < b.onboard then sp.ggr + sp.adjustment end) ob_adj,
    sum(case when sp.transaction_date >= b.onb_from and sp.transaction_date < b.onboard then sp.ngr end)                 ob_ngr,
    sum(case when sp.transaction_date >= b.onb_from and sp.transaction_date < b.onboard then sp.bonus_claimed end)       ob_bc,
    sum(case when b.onboard is not null and sp.transaction_date >= b.onboard then sp.deposit end)             oa_dep,
    sum(case when b.onboard is not null and sp.transaction_date >= b.onboard then sp.deposit_count end)       oa_dc,
    sum(case when b.onboard is not null and sp.transaction_date >= b.onboard then sp.ggr end)                 oa_ggr,
    sum(case when b.onboard is not null and sp.transaction_date >= b.onboard then sp.ggr + sp.adjustment end) oa_adj,
    sum(case when b.onboard is not null and sp.transaction_date >= b.onboard then sp.ngr end)                 oa_ngr,
    sum(case when b.onboard is not null and sp.transaction_date >= b.onboard then sp.bonus_claimed end)       oa_bc,
    max(case when sp.deposit > 0 or sp.bet <> 0 then sp.transaction_date end) last_active,
    count(distinct case when sp.transaction_date >= b.first_req and sp.deposit > 0
                        then sp.transaction_date end) ra_dep_days
  from base b
  left join bi.sum_player_daily_v sp on sp.player_id = b.player_id
  group by 1)
select b.player_id,
       coalesce(pi.username, p.username) username,
       coalesce(pi.reg_date::date, p.created_at::date) reg_date,
       pi.player_country country, pi.current_segment, pi.player_status, pi.block_type,
       pt.favourite_product fav_product, pi.first_deposit_date::date ftd_date,
       nullif(trim(pi.aff_username),'') aff_username, nullif(trim(pi.aff_type),'') aff_type,
       (pi.player_id is null) mv_missing,
       b.first_req, b.last_req, b.req_count, b.valid_through, b.onboard, b.tracked,
       b.req_days, b.onb_days,
       d.last_active, d.ra_dep_days,
       round(coalesce(d.rb_dep,0),2) rb_dep, coalesce(d.rb_dc,0) rb_dc, round(coalesce(d.rb_bet,0),2) rb_bet,
       round(coalesce(d.rb_ggr,0),2) rb_ggr, round(coalesce(d.rb_adj,0),2) rb_adj,
       round(coalesce(d.rb_ngr,0),2) rb_ngr, round(coalesce(d.rb_bc,0),2) rb_bc,
       round(coalesce(d.ra_dep,0),2) ra_dep, coalesce(d.ra_dc,0) ra_dc, round(coalesce(d.ra_bet,0),2) ra_bet,
       round(coalesce(d.ra_ggr,0),2) ra_ggr, round(coalesce(d.ra_adj,0),2) ra_adj,
       round(coalesce(d.ra_ngr,0),2) ra_ngr, round(coalesce(d.ra_bc,0),2) ra_bc,
       round(coalesce(d.ob_dep,0),2) ob_dep, coalesce(d.ob_dc,0) ob_dc,
       round(coalesce(d.ob_ggr,0),2) ob_ggr, round(coalesce(d.ob_adj,0),2) ob_adj,
       round(coalesce(d.ob_ngr,0),2) ob_ngr, round(coalesce(d.ob_bc,0),2) ob_bc,
       round(coalesce(d.oa_dep,0),2) oa_dep, coalesce(d.oa_dc,0) oa_dc,
       round(coalesce(d.oa_ggr,0),2) oa_ggr, round(coalesce(d.oa_adj,0),2) oa_adj,
       round(coalesce(d.oa_ngr,0),2) oa_ngr, round(coalesce(d.oa_bc,0),2) oa_bc
from base b
join public.players p on p.id = b.player_id
-- LEFT, not inner: 20 requesters are missing from players_info_mv and an inner
-- join silently drops them from the cohort.
left join bi.players_info_mv pi on pi.player_id = b.player_id
left join bi.players_totals_v pt on pt.player_id = b.player_id
left join d on d.player_id = b.player_id
order by b.player_id
