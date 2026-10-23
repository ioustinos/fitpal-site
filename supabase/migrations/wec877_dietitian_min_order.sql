-- ============================================================================
-- WEC-877 — Dietitian clients' own minimum order (Slack 23/10, epic WEC-838)
--
-- 🟢 «Minimum Παραγγελία από 15 σε 9» / «Για τους dietitians θα ορίσουμε άλλο».
-- A customer with an ACTIVE link to an active dietitian uses the dietitian's
-- minimum per day instead of the retail one (settings.min_order). Set per
-- dietitian in admin (Details & add-ons), default 9 €.
-- submit-order.ts enforces it; my_partner_link() hands it to the cart.
-- ============================================================================

alter table public.partners add column if not exists min_order_cents int not null default 900;
do $$ begin
  alter table public.partners add constraint partners_min_order_cents_chk check (min_order_cents between 0 and 100000);
exception when duplicate_object then null; end $$;

create or replace function public.my_partner_link()
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
           'id', pc.id, 'partnerName', p.name, 'status', pc.status,
           'discountBps', case when pc.status = 'active' and p.active then pc.discount_bps else 0 end,
           'minOrderCents', case when pc.status = 'active' and p.active then p.min_order_cents end,
           'needsConfirm', pc.status = 'pending' and pc.client_confirmed_at is null,
           'needsConsent', pc.consent_at is null,
           'awaitingFitpal', pc.status = 'pending' and pc.client_confirmed_at is not null and pc.approved_at is null)
    from partner_clients pc join partners p on p.id = pc.partner_id
   where pc.client_user_id = auth.uid() and pc.status <> 'inactive'
   limit 1
$function$;
