-- WEC-599: new payment_status value «pending_link_sent».
--
-- Semantically STILL PENDING — set when an admin generates/sends a payment link
-- so ops can tell "waiting, nothing sent" from "waiting, link is in the inbox".
--
-- Postgres note: ALTER TYPE ... ADD VALUE must be its own migration and cannot
-- have the new value USED in the same transaction. Guard-widening (markPaid,
-- the reconcile RPC) lands in separate migrations/commits so the value is
-- committed before anything references it.

alter type public.payment_status add value if not exists 'pending_link_sent';
