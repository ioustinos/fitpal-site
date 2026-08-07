-- WEC-606/607/608: a real "how much was actually paid / is refundable" answer.
--
-- Ioustinos' model (supersedes the description's order_payments-table idea): a
-- payment link is all-or-nothing, so payment_links IS the ledger for link
-- payments — it just needs an amount column and a status we actually maintain.
-- Manual (cash/transfer) mark-paid is always the FULL order total at that moment
-- (not editable) → one field on orders. Wallet debits are already recorded in
-- wallet_transactions with an order_id.
--
-- Derivation used everywhere from now on (606 balance, 607 link crediting, 608
-- refund ceiling):
--   paid      = Σ payment_links.amount WHERE status='success'
--             + Σ wallet_transactions.amount WHERE type='debit'
--             + orders.manual_paid_amount
--   refunded  = orders.refund_amount
--   remaining = total - paid + refunded         (still-to-collect)
--   refundable= paid - refunded                 (can't refund more than collected)

-- 1. The link's amount. A paid link = that much money collected.
alter table public.payment_links add column if not exists amount int;
-- Backfill PAID links from the ACTUAL collected amount recorded in the markPaid
-- audit log («Viva paid · … · €19.40») — NOT the current order total, which may
-- have drifted after post-payment edits (that drift is exactly the WEC-608 bug).
update public.payment_links pl
   set amount = sub.cents
  from (
    select acl.order_id,
           round((regexp_match(acl.label, '€([0-9]+\.[0-9]{2})'))[1]::numeric * 100)::int as cents
    from public.admin_change_log acl
    where acl.label ilike 'Viva paid%'
  ) sub
 where pl.order_id = sub.order_id and pl.status = 'success' and sub.cents is not null;
-- Any remaining link (unpaid, or paid with no recoverable audit line): current
-- order total is the best available proxy for what the link is for.
update public.payment_links pl
   set amount = o.total
  from public.orders o
 where o.id = pl.order_id and pl.amount is null;

-- 2. Manual (cash/transfer) mark-paid records the full total collected.
alter table public.orders add column if not exists manual_paid_amount int not null default 0;
-- Backfill ONLY truly-manual paid orders: cash/transfer with NO paid link and NO
-- wallet debit (a "cash" order CAN have been paid by a link — don't double-count).
update public.orders o
   set manual_paid_amount = total
 where payment_status = 'paid' and payment_method in ('cash','transfer')
   and not exists (select 1 from public.payment_links pl where pl.order_id = o.id and pl.status = 'success')
   and not exists (select 1 from public.wallet_transactions wt where wt.order_id = o.id and wt.type = 'debit');

-- 3. payment_links.status was never maintained (WEC-181 wrongly deprecated it;
--    it is now load-bearing — the ledger). Backfill from the Viva statusId that
--    verify.ts DID record: 'F' = finished/paid → success; 'E'/'X' = error/cancel.
update public.payment_links set status = 'success' where status_id = 'F'  and status <> 'success';
update public.payment_links set status = 'failure' where status_id in ('E','X') and status <> 'failure';

-- 4. The one shared calculation. SECURITY INVOKER: respects the caller's RLS, so
--    a customer can only summarise their own order; admins see any (WEC-594).
create or replace function public.order_payment_summary(p_order_id uuid)
returns table(total int, paid int, refunded int, remaining int, refundable int)
language sql
stable
as $$
  with o as (
    select coalesce(total,0) as total,
           coalesce(refund_amount,0) as refunded,
           coalesce(manual_paid_amount,0) as manual
    from public.orders where id = p_order_id
  ),
  links as (
    select coalesce(sum(amount),0) as s
    from public.payment_links where order_id = p_order_id and status = 'success'
  ),
  wallet as (
    select coalesce(sum(amount),0) as s
    from public.wallet_transactions where order_id = p_order_id and type = 'debit'
  )
  select o.total,
         (links.s + wallet.s + o.manual)                                   as paid,
         o.refunded,
         greatest(0, o.total - (links.s + wallet.s + o.manual) + o.refunded) as remaining,
         greatest(0, (links.s + wallet.s + o.manual) - o.refunded)          as refundable
  from o, links, wallet;
$$;

grant execute on function public.order_payment_summary(uuid) to authenticated, anon;
