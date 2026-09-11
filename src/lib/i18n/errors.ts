// ─────────────────────────────────────────────────────────────────────────
//  i18n · errors
//  User-facing error and validation messages. Empty for now — server errors are still English-only (WEC-733); they land here when they are translated.
//
//  WEC-728: extracted verbatim from the old single translations.ts. Values
//  were NOT edited — this split is mechanical on purpose, so that the
//  δεύτερο-ενικό sweep (WEC-675 part A) is the only thing that ever changes
//  wording, and a diff of this commit is provably value-identical.
//
//  Add new strings to the module they belong to, never to a global file:
//  one flat namespace is what pushed every other chat into inline ternaries.
// ─────────────────────────────────────────────────────────────────────────

export const errors = {
  el: {
  },
  en: {
  },
} as const
