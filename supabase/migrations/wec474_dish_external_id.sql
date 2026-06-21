-- WEC-474: dedicated external_id on dishes + variants (Airtable Μenu Reference matching key)
-- Decoupled from the PK: `id` stays auto-generated and untouched; `external_id`
-- is matching-only (links Order Items -> Μenu Reference `Κωδικός`), editable in
-- /admin/dishes for controlled new-dish codes. Backfilled = id for all existing
-- rows (migrated menu ids already ARE the GonnaOrder codes, e.g. 302 / 302-1).

alter table public.dishes        add column if not exists external_id text;
alter table public.dish_variants add column if not exists external_id text;

-- Backfill: existing ids already are the codes.
update public.dishes        set external_id = id where external_id is null;
update public.dish_variants  set external_id = id where external_id is null;

create index if not exists idx_dishes_external_id        on public.dishes(external_id);
create index if not exists idx_dish_variants_external_id on public.dish_variants(external_id);
