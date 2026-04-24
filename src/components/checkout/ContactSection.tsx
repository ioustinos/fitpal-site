import { useMemo } from 'react'
import PhoneInput from 'react-phone-number-input'
import flags from 'react-phone-number-input/flags'
import 'react-phone-number-input/style.css'
import { useUIStore } from '../../store/useUIStore'
import { COUNTRIES, DEFAULT_COUNTRY, isValidPhone, phoneLabels } from '../../lib/phone'

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

  const nameInvalid = showErrors && !value.name.trim()
  const emailInvalid = showErrors && (!value.email.trim() || !/^.+@.+\..+$/.test(value.email.trim()))
  // Phone is optional at the field level until submit. For `showErrors` we
  // require both non-empty AND a valid number (per country rules).
  const phoneInvalid = showErrors && !isValidPhone(value.phone)

  // Memoise country list reference so PhoneInput doesn't re-render on every keystroke
  const countries = useMemo(() => COUNTRIES, [])
  const labels = useMemo(() => phoneLabels(lang), [lang])

  return (
    <div className="co-contact-grid">
      <div className="co-contact-field">
        <label className="co-contact-label" htmlFor="co-contact-name">
          {lang === 'el' ? 'Ονοματεπώνυμο' : 'Full name'}
          <span className="co-required">*</span>
        </label>
        <input
          id="co-contact-name"
          type="text"
          className={`form-input${nameInvalid ? ' is-invalid' : ''}`}
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={lang === 'el' ? 'π.χ. Γιάννης Παπαδόπουλος' : 'e.g. John Smith'}
          autoComplete="name"
          aria-invalid={nameInvalid || undefined}
        />
      </div>

      <div className="co-contact-field">
        <label className="co-contact-label" htmlFor="co-contact-email">
          {lang === 'el' ? 'Email' : 'Email'}
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
          {lang === 'el' ? 'Τηλέφωνο' : 'Phone'}
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
          placeholder={lang === 'el' ? '69X XXX XXXX' : '69X XXX XXXX'}
          autoComplete="tel"
        />
      </div>
    </div>
  )
}
