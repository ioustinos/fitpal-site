// WEC-762 — prove the PII scrubber redacts, rather than asserting it does.
//
// The regexes are READ OUT OF src/lib/monitoring/sentry.ts rather than copied,
// so this test cannot silently drift from the code it is guarding.
//
// Run: node scripts/check-sentry-scrub.mjs
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/lib/monitoring/sentry.ts', import.meta.url), 'utf8')
const pick = (name) => {
  const m = new RegExp(`const ${name} = (/.*/[gimsuy]*)$`, 'm').exec(src)
  if (!m) { console.error(`✗ could not find ${name} in sentry.ts`); process.exit(1) }
  const body = m[1].slice(1, m[1].lastIndexOf('/'))
  const flags = m[1].slice(m[1].lastIndexOf('/') + 1)
  return new RegExp(body, flags)
}
const EMAIL_RE = pick('EMAIL_RE')
const PHONE_RE = pick('PHONE_RE')
const scrub = (s) => s.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]')

const cases = [
  // must be redacted
  ['Failed for maria.plagaki@gmail.com',            'Failed for [email]'],
  ['order for +30 6937 109396 failed',              'order for [phone] failed'],
  ['tel 6944123456 / 2104253929',                   'tel [phone] / [phone]'],
  ['call 694-412-3456 now',                         'call [phone] now'],
  ['/api/x?email=a.b%2Bc@fitpal.gr&z=1',            '/api/x?email=[email]&z=1'],
  ['both nena@fitpal.gr and 6912345678',            'both [email] and [phone]'],
  // must survive untouched — these are what make an error traceable
  ['order FP-260913-00001 total 15.20 EUR',         'order FP-260913-00001 total 15.20 EUR'],
  ['plan WP-8285A293 on 2026-09-13',                'plan WP-8285A293 on 2026-09-13'],
  ['uuid 7001422f-16ee-4879-98aa-7dff8c0be96c',     'uuid 7001422f-16ee-4879-98aa-7dff8c0be96c'],
]

let fail = 0
for (const [input, expected] of cases) {
  const got = scrub(input)
  if (got !== expected) {
    console.error(`✗ "${input}"\n   got:      ${got}\n   expected: ${expected}`)
    fail++
  }
}
// Belt and braces: nothing email-shaped may survive any case.
for (const [input] of cases) {
  const got = scrub(input)
  const re = new RegExp(EMAIL_RE.source, 'i')
  if (re.test(got)) { console.error(`✗ EMAIL SURVIVED: ${got}`); fail++ }
}
if (fail) { console.error(`\n${fail} failure(s) — PII would reach Sentry.`); process.exit(1) }
console.log(`✓ PII scrubber ok — ${cases.length} cases; emails and phones redacted, order/plan/uuid identifiers preserved`)
