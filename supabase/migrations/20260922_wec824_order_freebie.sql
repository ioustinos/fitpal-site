-- WEC-824: flag orders that netted to €0 ("freebies" — 100% discount/voucher or
-- an admin discount) so they can be told apart from genuinely-paid orders.
--
-- Generated + stored so it is correct on BOTH write paths — the legacy
-- orders.insert() AND the promote_draft_atomic RPC (which whitelists columns) —
-- WITHOUT touching the RPC, and it auto-updates if an admin later discounts an
-- order down to €0. `total` is a plain (non-generated) int column, so it is a
-- legal reference for a generated column.
alter table public.orders
  add column if not exists freebie boolean
  generated always as (total = 0) stored;

comment on column public.orders.freebie is
  'WEC-824: true when total = 0 (freebie: 100% discount/voucher or admin discount). Distinguishes freebies from genuinely-paid orders. Auto-paid at checkout by submit-order.';
