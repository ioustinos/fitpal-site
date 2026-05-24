// Text utilities shared across customer + admin.

/**
 * Fold a Greek/Latin string for accent- and case-insensitive matching.
 *
 * - decomposes (NFD) and strips combining diacritics, so τόνος + διαλυτικά
 *   are ignored ("κοτόπουλο" ≡ "κοτοπουλο", "προϊόν" ≡ "προιον")
 * - lowercases
 * - normalizes final sigma ς → σ so word-final forms still match
 *
 * Use on BOTH the haystack and the needle. WEC-365.
 */
export function foldGreek(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks (accents)
    .toLowerCase()
    .replace(/ς/g, 'σ') // final sigma ς → σ
}
