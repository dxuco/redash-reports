-- Reachability per player: a linked Telegram account, and a phone number on
-- file. The warehouse has no WhatsApp flag, so the phone number is the proxy.
select p.id player_id,
       (exists (select 1 from reports.telegram_users t where t.player_id = p.id))::int telegram,
       (nullif(trim(coalesce(p.phone_number, '')), '') is not null)::int phone,
       (p.phone_verified_at is not null)::int phone_verified
from public.players p
where p.id in (select distinct player_id from public.loyalty_transfer_request)
