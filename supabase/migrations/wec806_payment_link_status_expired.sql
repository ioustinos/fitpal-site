-- WEC-806: a Viva checkout order is short-lived; once it expires the payment
-- link is dead (opening it redirects to our failure page), but payment_links.status
-- stayed 'pending' forever. Add an explicit 'expired' status so the admin drawer
-- can show a dead link as expired and offer a fresh one.
ALTER TYPE payment_link_status ADD VALUE IF NOT EXISTS 'expired';
