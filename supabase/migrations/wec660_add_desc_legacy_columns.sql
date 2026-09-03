-- WEC-660 step 1 of 3 · 2026-09-02
--
-- The customer-facing description becomes the Υλικά (ingredients) string from
-- «Menu Fitpal New» column F, per the Fitpal team's request. The existing
-- descriptive prose is NOT deleted -- it moves here first so the change is a
-- one-statement revert.
--
-- Chosen over adding a separate `ingredients_*` column because every consumer
-- (menu card, dish modal, Airtable mirror, order emails) already renders
-- desc_el/desc_en -- overwriting them switches all surfaces with zero
-- component changes and nothing left behind to drift.
--
-- Applied to the live project as migration 20260902145743.

alter table dishes
  add column if not exists desc_legacy_el text,
  add column if not exists desc_legacy_en text;

comment on column dishes.desc_legacy_el is
  'Pre-2026-09-02 descriptive copy, archived when desc_el became the Υλικά list (WEC-660). Not shown to customers.';
comment on column dishes.desc_legacy_en is
  'Pre-2026-09-02 descriptive copy, archived when desc_en became the Υλικά list (WEC-660). Not shown to customers.';

-- Archive once. Guarded so a re-run can never overwrite the archive with
-- ingredient text after step 3 has run.
update dishes
   set desc_legacy_el = desc_el,
       desc_legacy_en = desc_en
 where desc_legacy_el is null
   and desc_legacy_en is null;
