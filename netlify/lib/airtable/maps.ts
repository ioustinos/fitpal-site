// WEC-475: enum mappers — platform values → exact Airtable single-select options.
// Option values verified from the live base schema (getSchema). We pass exact
// strings (no typecast) so we never create junk options.

// Orders.Paid choices: NO_PAYMENT | SUCCESSFULLY_COMPLETED | IN_PROGRESS | PAID_OFFLINE
export function mapPaid(paymentStatus: string): string {
  switch (paymentStatus) {
    case 'paid':
      return 'SUCCESSFULLY_COMPLETED'
    case 'refunded':
      return 'PAID_OFFLINE' // closest existing option; financial admin adjusts
    default:
      return 'NO_PAYMENT' // pending / failed / cash-on-delivery
  }
}

// Orders.Payment Method choices: CASH | BANK_TRANSFER | CARD | Freeba
// Orders.Payment Extra choices include: 'Sent Payment Link'
export function mapPaymentMethod(method: string): { method: string; extra?: string } {
  switch (method) {
    case 'cash':
      return { method: 'CASH' }
    case 'transfer':
      return { method: 'BANK_TRANSFER' }
    case 'card':
      return { method: 'CARD' }
    case 'link':
      return { method: 'CARD', extra: 'Sent Payment Link' }
    case 'wallet':
      return { method: 'Wallet' }
    default:
      return { method: 'CASH' }
  }
}

// Orders.Τιμολόγιο/Απόδειξη choices: Απόδειξη | Τιμολόγιο
export function mapInvoice(invoiceType?: string | null): string | undefined {
  if (!invoiceType) return undefined
  const v = invoiceType.toLowerCase()
  if (v.includes('invoice') || v.includes('τιμ')) return 'Τιμολόγιο'
  return 'Απόδειξη'
}

// Cents → euros (Airtable currency fields store decimal euros).
export function toEuros(cents: number | null | undefined): number {
  return Math.round((cents ?? 0)) / 100
}

// Build an ISO timestamp in Athens wall-clock (delivery_date + time_from are
// stored as Athens local). Appends the correct DST offset (+03:00 summer /
// +02:00 winter) so the kitchen day-grouping lands on the right date.
export function athensIso(dateStr: string, timeStr: string): string {
  const probe = new Date(`${dateStr}T${timeStr.length === 5 ? timeStr + ':00' : timeStr}Z`)
  const tzName =
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Athens', timeZoneName: 'shortOffset' })
      .formatToParts(probe)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+3'
  const m = tzName.match(/GMT([+-]?\d+)/)
  const off = m ? parseInt(m[1], 10) : 3
  const sign = off >= 0 ? '+' : '-'
  const hh = String(Math.abs(off)).padStart(2, '0')
  const t = timeStr.length === 5 ? `${timeStr}:00` : timeStr
  return `${dateStr}T${t}${sign}${hh}:00`
}

// Single-quote escape for Airtable filterByFormula string literals.
export function esc(v: string): string {
  return v.replace(/'/g, "\\'")
}
