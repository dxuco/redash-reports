-- Current loyalty tier per player: Bronze I .. Legend.
--
-- Two sources agree, and this is the one to use:
--
--   public.sm_player_loyalty_level     level_title, refreshed daily, keyed on
--                                      user_ext_id (which IS player_id here)
--   loyalty_program_player_points +    the same tier derivable by bucketing
--   loyalty_program_levels             points into the level ranges
--
-- The second was used only to check the first; deriving it on the page would
-- mean re-implementing the ladder and drifting from it the day a band moves.
--
-- reports.players_loyalty_levels_v looks like the obvious source and is not: it
-- holds only the 56 players at the "VIP" level, so joining to it silently drops
-- everyone else.
--
-- Coverage is partial by nature. A player who has never earned a loyalty point
-- has no row at all, and that is not the same as Bronze I with zero points --
-- the page shows a dash rather than inventing a tier for them.
select s.user_ext_id  player_id,
       s.level_title  tier,
       s.loyalty_level tier_no,
       round(s.loyalty_points) points
from public.sm_player_loyalty_level s
where s.user_ext_id in (select distinct player_id from public.loyalty_transfer_request)
