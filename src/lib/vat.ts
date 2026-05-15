/**
 * Greek ΑΦΜ (Tax Identification Number) validation. WEC-354.
 *
 * ΑΦΜ format:
 *   - Always 9 digits.
 *   - The 9th digit is a checksum over the first 8.
 *
 * Algorithm (similar family to Luhn but with weights = powers of 2):
 *   - For digits d₁..d₈ (left to right), compute:
 *       S = d₁·2⁸ + d₂·2⁷ + d₃·2⁶ + d₄·2⁵ + d₅·2⁴ + d₆·2³ + d₇·2² + d₈·2¹
 *   - check = S mod 11
 *   - If check === 10, treat as 0
 *   - The ΑΦΜ is valid iff check equals d₉.
 *
 * Imported by both:
 *   - the frontend (CheckoutPage live validation + ExtrasSection input)
 *   - the backend (netlify/functions/submit-order.ts — copies the function
 *     because cross-folder src/ ⇄ netlify/ imports aren't set up;
 *     keep the two in sync).
 *
 * Notes:
 *   - All-zero ΑΦΜ (000000000) fails by policy — passes the checksum but
 *     is obviously not a real number.
 *   - We strip non-digit characters before validating so users can paste
 *     "EL 123 456 782" and we'll still evaluate the digits.
 */

export function isValidGreekVat(input: string): boolean {
  const digits = String(input ?? '').replace(/\D/g, '')
  if (digits.length !== 9) return false
  if (/^0+$/.test(digits)) return false  // 000000000 — not a real ΑΦΜ

  let sum = 0
  for (let i = 0; i < 8; i++) {
    sum += parseInt(digits[i], 10) * Math.pow(2, 8 - i)
  }
  let check = sum % 11
  if (check === 10) check = 0
  return check === parseInt(digits[8], 10)
}

/** Returns the digits-only form (≤ 9 chars) for input field display + state. */
export function vatDigits(input: string): string {
  return String(input ?? '').replace(/\D/g, '').slice(0, 9)
}
