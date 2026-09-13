-- WEC-734 (epic WEC-727) — admin-editable copy, as an OVERRIDE layer.
-- Applied 2026-09-11. Additive only: a new table, nothing existing altered.
--
-- The i18n modules in src/lib/i18n/*.ts stay the default and the fallback and
-- are never written to at runtime. This table holds ONLY strings someone has
-- actually changed. No row = the file value, byte for byte. "Reset to default"
-- deletes the row — no undo state, no second source of truth.
create table if not exists public.ui_strings (
  key        text primary key,
  value_el   text,
  value_en   text,
  updated_at timestamptz not null default now(),
  updated_by text
);

comment on table public.ui_strings is
  'WEC-734: overrides for UI strings. Defaults live in src/lib/i18n/*.ts; a row here wins. Empty table = stock copy.';
comment on column public.ui_strings.value_el is 'NULL = fall back to the Greek in the i18n module.';
comment on column public.ui_strings.value_en is 'NULL = fall back to the English in the i18n module.';

alter table public.ui_strings enable row level security;

-- Read is public: these strings are already visible on the page to anyone.
drop policy if exists ui_strings_public_read on public.ui_strings;
create policy ui_strings_public_read on public.ui_strings
  for select using (true);

-- Write is admin-only, through the existing SECURITY DEFINER helper.
drop policy if exists ui_strings_admin_write on public.ui_strings;
create policy ui_strings_admin_write on public.ui_strings
  for all using (public.is_admin()) with check (public.is_admin());

drop trigger if exists set_ui_strings_updated_at on public.ui_strings;
create trigger set_ui_strings_updated_at
  before update on public.ui_strings
  for each row execute function public.handle_updated_at();
