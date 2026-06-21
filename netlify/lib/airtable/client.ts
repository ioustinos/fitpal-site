// WEC-475: thin Airtable REST client — find / upsert / create.
// All link fields are set by RECORD ID (resolved by us), never typecast, so we
// never create phantom Μenu Reference / Customer / select rows.

import { AIRTABLE_API, AIRTABLE_BASE_ID, getAirtablePat } from './env'

type Json = Record<string, unknown>

async function atFetch(path: string, init: RequestInit): Promise<any> {
  const res = await fetch(`${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getAirtablePat()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let json: any
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    throw new Error(`Airtable ${res.status} ${path}: ${text.slice(0, 500)}`)
  }
  return json
}

/** First record id matching a filterByFormula, or null. */
export async function findRecordId(tableId: string, formula: string): Promise<string | null> {
  const params = new URLSearchParams({ filterByFormula: formula, maxRecords: '1' })
  const data = await atFetch(`${tableId}?${params.toString()}`, { method: 'GET' })
  return data.records?.[0]?.id ?? null
}

export interface UpsertRecord {
  fields: Json
}

/**
 * Idempotent upsert on `fieldsToMergeOn`. Chunks to Airtable's 10-records/req
 * limit. Returns the resulting records (with ids), order preserved.
 */
export async function upsertRecords(
  tableId: string,
  fieldsToMergeOn: string[],
  records: UpsertRecord[],
): Promise<Array<{ id: string; fields: Json }>> {
  const out: Array<{ id: string; fields: Json }> = []
  for (let i = 0; i < records.length; i += 10) {
    const chunk = records.slice(i, i + 10)
    const data = await atFetch(tableId, {
      method: 'PATCH',
      body: JSON.stringify({ performUpsert: { fieldsToMergeOn }, records: chunk, typecast: false }),
    })
    out.push(...(data.records ?? []))
  }
  return out
}

/** Create a single record, return its id. */
export async function createRecord(tableId: string, fields: Json): Promise<string> {
  const data = await atFetch(tableId, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields }], typecast: false }),
  })
  return data.records[0].id as string
}
