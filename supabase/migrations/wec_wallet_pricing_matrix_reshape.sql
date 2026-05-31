-- Reshape wallet_pricing_matrix from per-meal-nested into macro × meal grid.
--
-- Old shape (legacy):
--   {
--     active: 'perKcal' | 'perGram',
--     perGram: { breakfast: {i,p,c,f}, lunch: {i,p,c,f}, dinner: {...}, snack: {...} },
--     perKcal: { ... same nesting ... }
--   }
--
-- New shape (canonical):
--   {
--     active: 'perKcal' | 'perGram',
--     perGram: { p: {breakfast,lunch,dinner,snack}, c: {...}, f: {...} },   -- 12 cells
--     perKcal: { p: {...}, c: {...}, f: {...} },                            -- 12 cells
--     intercepts: { breakfast, lunch, dinner, snack },                      -- 4 cells (lifted from perGram.<meal>.i)
--     kcalPerGram: { p: 4, c: 4, f: 9 }                                     -- biology
--   }
--
-- The motivation: admin needs a 3×4 macro×meal editable grid, not a JSON
-- textarea. The new shape mirrors that UI exactly. Also lifts the biology
-- constants (kcal/g per macro) into the same setting so they're tunable.
--
-- Idempotent: if the row is already in the new shape we skip rewriting it.

do $$
declare
  current_val jsonb;
  is_new_shape boolean;
  new_val jsonb;
  old_pg jsonb;
  old_pk jsonb;
begin
  select value into current_val from public.settings where key = 'wallet_pricing_matrix';

  if current_val is null then
    -- Nothing to migrate; the seed handled in another migration / WalletSettings
    -- default will cover the first read.
    raise notice 'wallet_pricing_matrix not present, skipping reshape';
    return;
  end if;

  -- Detect new shape: perGram.p is an object containing 'breakfast'.
  is_new_shape := (
    current_val -> 'perGram' -> 'p' ? 'breakfast'
  );

  if is_new_shape then
    raise notice 'wallet_pricing_matrix already in new shape, skipping';
    return;
  end if;

  old_pg := current_val -> 'perGram';
  old_pk := current_val -> 'perKcal';

  new_val := jsonb_build_object(
    'active', coalesce(current_val -> 'active', '"perKcal"'::jsonb),
    'perGram', jsonb_build_object(
      'p', jsonb_build_object(
        'breakfast', coalesce(old_pg -> 'breakfast' -> 'p', '0'::jsonb),
        'lunch',     coalesce(old_pg -> 'lunch'     -> 'p', '0'::jsonb),
        'dinner',    coalesce(old_pg -> 'dinner'    -> 'p', '0'::jsonb),
        'snack',     coalesce(old_pg -> 'snack'     -> 'p', '0'::jsonb)
      ),
      'c', jsonb_build_object(
        'breakfast', coalesce(old_pg -> 'breakfast' -> 'c', '0'::jsonb),
        'lunch',     coalesce(old_pg -> 'lunch'     -> 'c', '0'::jsonb),
        'dinner',    coalesce(old_pg -> 'dinner'    -> 'c', '0'::jsonb),
        'snack',     coalesce(old_pg -> 'snack'     -> 'c', '0'::jsonb)
      ),
      'f', jsonb_build_object(
        'breakfast', coalesce(old_pg -> 'breakfast' -> 'f', '0'::jsonb),
        'lunch',     coalesce(old_pg -> 'lunch'     -> 'f', '0'::jsonb),
        'dinner',    coalesce(old_pg -> 'dinner'    -> 'f', '0'::jsonb),
        'snack',     coalesce(old_pg -> 'snack'     -> 'f', '0'::jsonb)
      )
    ),
    'perKcal', jsonb_build_object(
      'p', jsonb_build_object(
        'breakfast', coalesce(old_pk -> 'breakfast' -> 'p', '0'::jsonb),
        'lunch',     coalesce(old_pk -> 'lunch'     -> 'p', '0'::jsonb),
        'dinner',    coalesce(old_pk -> 'dinner'    -> 'p', '0'::jsonb),
        'snack',     coalesce(old_pk -> 'snack'     -> 'p', '0'::jsonb)
      ),
      'c', jsonb_build_object(
        'breakfast', coalesce(old_pk -> 'breakfast' -> 'c', '0'::jsonb),
        'lunch',     coalesce(old_pk -> 'lunch'     -> 'c', '0'::jsonb),
        'dinner',    coalesce(old_pk -> 'dinner'    -> 'c', '0'::jsonb),
        'snack',     coalesce(old_pk -> 'snack'     -> 'c', '0'::jsonb)
      ),
      'f', jsonb_build_object(
        'breakfast', coalesce(old_pk -> 'breakfast' -> 'f', '0'::jsonb),
        'lunch',     coalesce(old_pk -> 'lunch'     -> 'f', '0'::jsonb),
        'dinner',    coalesce(old_pk -> 'dinner'    -> 'f', '0'::jsonb),
        'snack',     coalesce(old_pk -> 'snack'     -> 'f', '0'::jsonb)
      )
    ),
    'intercepts', jsonb_build_object(
      'breakfast', coalesce(old_pg -> 'breakfast' -> 'i', '0'::jsonb),
      'lunch',     coalesce(old_pg -> 'lunch'     -> 'i', '0'::jsonb),
      'dinner',    coalesce(old_pg -> 'dinner'    -> 'i', '0'::jsonb),
      'snack',     coalesce(old_pg -> 'snack'     -> 'i', '0'::jsonb)
    ),
    'kcalPerGram', jsonb_build_object('p', 4, 'c', 4, 'f', 9)
  );

  update public.settings set value = new_val where key = 'wallet_pricing_matrix';

  raise notice 'wallet_pricing_matrix reshaped to new macro×meal grid + intercepts + kcalPerGram';
end$$;
