// WEC-475: Airtable connection constants + token resolution.
// Base "Fitpal" (appQkyoF5gnDpSW9C). Token lives in Netlify env as AIRTABLE_PAT
// (scoped PAT, separate from the Admin Dev app's token).

export const AIRTABLE_API = 'https://api.airtable.com/v0'
export const AIRTABLE_BASE_ID = 'appQkyoF5gnDpSW9C'

export const TABLES = {
  orders: 'tblFP0xONtQSJxPd9',
  childOrders: 'tbljfcHAN40McNOIV',
  orderItems: 'tblxu7U6sAI8jAJKK',
  customers: 'tble7O64X0f6Om6Eo',
  menuReference: 'tblQiMnTsaZu5TWCQ',
} as const

// Retail orders carry this Store Id so the ops views can filter source.
export const RETAIL_STORE_ID = 9999

export function getAirtablePat(): string {
  const pat = process.env.AIRTABLE_PAT
  if (!pat) throw new Error('AIRTABLE_PAT not set')
  return pat
}

export function airtableConfigured(): boolean {
  return !!process.env.AIRTABLE_PAT
}
