import { useEffect, useState } from 'react'

/**
 * WEC-609: shared numeric input for /admin, replacing raw <input type="number">.
 *
 * Why not type="number":
 *  - The scroll wheel silently changes the value when the field is focused —
 *    a real hazard on quantity / refund / price fields (no onWheel guard existed).
 *  - `,` is rejected as a decimal separator (Greek keyboards / habit type «1,50»).
 *  - Blank collapses to 0 in many handlers, so a nullable field can't be cleared.
 *
 * This is a text input with `inputMode` (numeric/decimal) so mobile still gets a
 * number pad. It accepts both `,` and `.`, keeps min/max as VISIBLE validation
 * (red border, not blocking), preserves blank ≠ 0 for nullable fields, and blurs
 * on wheel so scrolling never mutates the value.
 *
 * Units: pass `scale` when the stored value differs from what's shown — e.g. money
 * stored in cents shows euros with `scale={100}` (value 1990 → «19.90», emits 1990).
 */
export interface NumberFieldProps {
  /** Stored value in BASE units (e.g. cents when scale=100). null = empty. */
  value: number | null
  /** Emits the parsed value in BASE units. Blank emits null when allowBlank, else 0. */
  onChange: (v: number | null) => void
  min?: number
  max?: number
  /** Integers only (inputMode numeric). Default false → decimals (inputMode decimal). */
  integer?: boolean
  /** Blank input emits null instead of 0 (nullable fields). */
  allowBlank?: boolean
  /** Display scale: shown = value / scale, emitted = round(input * scale). Default 1. */
  scale?: number
  /** Decimal places to display. Default: integer→0, else scale>1→2, else 0. */
  decimals?: number
  className?: string
  placeholder?: string
  disabled?: boolean
  id?: string
  ariaInvalid?: boolean
  style?: React.CSSProperties
}

function display(value: number | null, scale: number, decimals: number): string {
  if (value == null) return ''
  const shown = value / scale
  return decimals > 0 ? shown.toFixed(decimals) : String(shown)
}

export function NumberField({
  value, onChange, min, max, integer = false, allowBlank = false,
  scale = 1, decimals, className = 'admin-input', placeholder, disabled, id, ariaInvalid, style,
}: NumberFieldProps) {
  const dec = decimals ?? (integer ? 0 : scale > 1 ? 2 : 0)

  function parse(raw: string): number | null {
    const cleaned = raw.replace(',', '.').trim()
    if (cleaned === '') return null
    const n = integer ? parseInt(cleaned, 10) : parseFloat(cleaned)
    if (!Number.isFinite(n)) return null
    // Only round when converting display→base units via scale (e.g. euros→cents)
    // or for integer fields. A decimal field at scale=1 must KEEP its decimals
    // (grams like 0.5, pricing coefficients like 0.0025) — Math.round would kill them.
    if (scale !== 1) return Math.round(n * scale)
    return integer ? Math.round(n) : n
  }

  const [text, setText] = useState<string>(() => display(value, scale, dec))

  // Re-sync from the outside when the value changes to something the current
  // text doesn't already represent (e.g. a form reset, or a computed default).
  useEffect(() => {
    if (parse(text) !== value) setText(display(value, scale, dec))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function handle(raw: string) {
    setText(raw)
    const parsed = parse(raw)
    onChange(parsed == null ? (allowBlank ? null : 0) : parsed)
  }

  const outOfRange =
    value != null && ((min != null && value < min) || (max != null && value > max))

  return (
    <input
      id={id}
      className={`${className}${outOfRange || ariaInvalid ? ' is-invalid' : ''}`}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={outOfRange || ariaInvalid || undefined}
      style={style}
      // WEC-609: never let the scroll wheel change the value.
      onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
      onChange={(e) => handle(e.target.value)}
    />
  )
}
