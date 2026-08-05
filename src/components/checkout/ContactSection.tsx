import { useMemo } from 'react'
import PhoneInput from 'react-phone-number-input'
import flags from 'react-phone-number-input/flags'
import 'react-phone-number-input/style.css'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { makeTr } from '../../lib/translations'
import { COUNTRIES, DEFAULT_COUNTRY, isValidPhone, phoneLabels } from '../../lib/phone'
import { isValidEmail } from '../../lib/email'

export interface ContactInfo {
  name: string
  email: string
  phone: string  // E.164 format, emitted by <PhoneInput>; '' when empty
}

interface ContactSectionProps {
  value: ContactInfo
  onChange: (patch: Partial<ContactInfo>) => void
  /** Shown below the inputs when true — also drives red border on invalid fields */
  showErrors?: boolean
}

/**
 * Contact info capture at the top of checkout (WEC-130).
 *
 * Three fields: Name, Email, Phone.
 * - Desktop: single row of 3 inputs.
 * - Mobile:  stacked via `.co-contact-grid` media query in `index.css`.
 *
 * Logged-in users see their details prefilled (always-editable — simpler than
 * a lock/edit toggle, worst case they end up with a second line in their
 * address book). Guest users get empty fields + localStorage prefill from
 * previous orders.
 *
 * Validation is owned by `CheckoutPage` (feeds into `validationIssues`);
 * this component only renders `aria-invalid` + red border when `showErrors`
 * is on and the field is empty/invalid.
 */
export function ContactSection({ value, onChange, showErrors = false }: ContactSectionProps) {
  const lang = useUIStore((s) => s.lang)
  const t = makeTr(lang)
  // WEC-597: guest-only "log in" CTA. Opens the existing AuthModal; the
  // no-login-gate rule stands — guests still check out without ever logging in.
  const user = useAuthStore((s) => s.user)
  const openAuthModal = useUIStore((s) => s.openAuthModal)

  // WEC-220: keep these in sync with the validator in CheckoutPage.
  // Name ≥ 2 chars (was just non-empty — accepted "X"). Email pattern
  // disallows whitespace and @ in either half. Phone uses the per-country
  // libphonenumber-js validator.
  const nameInvalid = showErrors && value.name.trim().length < 2
  // WEC-408: shared tighter email validator (rejects `<img>@…`, length > 254, etc.)
  const emailInvalid = showErrors && !isValidEmail(value.email)
  const phoneInvalid = showErrors && !isValidPhone(value.phone)

  // Memoise country list reference so PhoneInput doesn't re-render on every keystroke
  const countries = useMemo(() => COUNTRIES, [])
  const labels = useMemo(() => phoneLabels(lang), [lang])

  return (
    <>
      {!user && (
        <div className="co-login-cta">
          {lang === 'el' ? 'Έχεις ήδη λογαριασμό;' : 'Already have an account?'}{' '}
          <button type="button" className="co-login-cta-btn" onClick={openAuthModal}>
            {lang === 'el' ? 'Σύνδεση' : 'Log in'}
          </button>
        </div>
      )}
      <div className="co-contact-grid">
      <div className="co-contact-field">
        <label className="co-contact-label" htmlFor="co-contact-name">
          {t('coFullName')}
          <span className="co-required">*</span>
        </label>
        <input
          id="co-contact-name"
          type="text"
          className={`form-input${nameInvalid ? ' is-invalid' : ''}`}
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={t('coNamePh')}
          autoComplete="name"
          aria-invalid={nameInvalid || undefined}
        />
      </div>

      <div className="co-contact-field">
        <label className="co-contact-label" htmlFor="co-contact-email">
          {t('email')}
          <span className="co-required">*</span>
        </label>
        <input
          id="co-contact-email"
          type="email"
          className={`form-input${emailInvalid ? ' is-invalid' : ''}`}
          value={value.email}
          onChange={(e) => onChange({ email: e.target.value })}
          placeholder="name@example.com"
          autoComplete="email"
          aria-invalid={emailInvalid || undefined}
        />
      </div>

      <div className="co-contact-field">
        <label className="co-contact-label" htmlFor="co-contact-phone">
          {t('coPhone')}
          <span className="co-required">*</span>
        </label>
        <PhoneInput
          id="co-contact-phone"
          className={`co-phone-input${phoneInvalid ? ' is-invalid' : ''}`}
          international
          defaultCountry={DEFAULT_COUNTRY}
          countries={countries}
          labels={labels}
          flags={flags}
          countryCallingCodeEditable={false}
          value={value.phone || undefined}
          onChange={(v) => onChange({ phone: v ?? '' })}
          placeholder={t('coPhonePh')}
          autoComplete="tel"
        />
      </div>
      </div>
    </>
  )
}
