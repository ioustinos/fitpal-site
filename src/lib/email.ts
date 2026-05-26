/**
 * Practical email validation (WEC-408).
 *
 * Tighter than the spec-correct RFC 5321 (which allows almost anything in the
 * local part if quoted), and tight enough to reject the obvious injection-
 * shaped payloads like `<img>@evil.com` that the loose `^[^\s@]+@[^\s@]+\.[^\s@]+$`
 * pattern previously accepted.
 *
 * Returns false for:
 *   - non-string / empty / whitespace-only
 *   - longer than 254 chars (RFC 5321 mailbox-len limit)
 *   - anything containing `<` or `>` (defence against HTML/script-shaped emails)
 *   - anything that doesn't match the practical local@domain.tld shape
 */
export const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/

export function isValidEmail(input: unknown): boolean {
  if (typeof input !== 'string') return false
  const s = input.trim()
  if (!s || s.length > 254) return false
  if (s.includes('<') || s.includes('>')) return false
  return EMAIL_RE.test(s)
}
