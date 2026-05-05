import { createClient } from '@supabase/supabase-js'

/**
 * Admin endpoint: import a dish image from an external URL into Supabase Storage.
 *
 * Built so the bulk catalog import can run end-to-end without the operator
 * having to babysit downloads on their laptop. Reusable for:
 *   - Initial bulk import of the 296-dish menu CSV
 *   - Adding new dishes via the admin panel (paste a Drive link, done)
 *   - Re-importing if a dish image gets updated upstream (force=true)
 *
 * The bash sandbox we develop in can't reach drive.google.com — that egress
 * is blocked by Cowork's network policy. Netlify Functions have full
 * outbound, so the work has to happen here.
 *
 * Auth: Authorization: Bearer <jwt>. Validates admin via public.is_admin().
 * Body: { dishId: string, sourceUrl: string, force?: boolean }
 * Returns: { ok: true, publicUrl: string, contentType: string, size: number }
 *          { ok: false, error: string }
 *
 * Idempotency: if dishes.image_url is already a Supabase Storage URL on
 * this project, skip re-download/upload unless force=true. The DB still
 * gets touched only when something changed.
 *
 * Drive URL conversion: takes any Drive view-share form
 *   https://drive.google.com/file/d/<id>/view?usp=sharing
 *   https://drive.google.com/file/d/<id>/view?usp=drive_link
 *   https://drive.google.com/file/d/<id>/view?usp=share_link
 * and rewrites to the direct-download form
 *   https://drive.google.com/uc?export=download&id=<id>
 * which is what the user's Sheets formula produces. Non-Drive URLs are
 * passed through unchanged (e.g. a future admin pastes a CDN URL directly).
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const BUCKET = 'dish-images'

const DRIVE_FILE_RE = /drive\.google\.com\/file\/d\/([^/]+)\//
const DRIVE_DOWNLOAD = (id: string) => `https://drive.google.com/uc?export=download&id=${id}`

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
}

interface Body {
  dishId?: string
  sourceUrl?: string
  force?: boolean
}

function jsonError(status: number, error: string) {
  return Response.json({ ok: false, error }, { status })
}

function toDownloadUrl(raw: string): string {
  const m = DRIVE_FILE_RE.exec(raw)
  if (m) return DRIVE_DOWNLOAD(m[1])
  return raw
}

function publicUrl(supabaseUrl: string, bucket: string, path: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${encodeURIComponent(path)}`
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }
  if (request.method !== 'POST') {
    return jsonError(405, 'Method not allowed')
  }

  // ─── Auth: must be a logged-in admin ──────────────────────────────────
  const auth = request.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return jsonError(401, 'Missing Authorization: Bearer <jwt>')

  // Use the caller's token to check is_admin (no service-role here — keeps
  // the auth surface tight, can't be bypassed by a leaked anon key).
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: isAdminRow, error: adminErr } = await callerClient.rpc('is_admin')
  if (adminErr) {
    console.error('is_admin RPC failed:', adminErr)
    return jsonError(500, 'Auth check failed')
  }
  if (isAdminRow !== true) return jsonError(403, 'Admin only')

  // ─── Body ──────────────────────────────────────────────────────────────
  let body: Body
  try {
    body = await request.json() as Body
  } catch {
    return jsonError(400, 'Invalid JSON body')
  }
  const dishId = (body.dishId ?? '').trim()
  const sourceUrl = (body.sourceUrl ?? '').trim()
  if (!dishId || !sourceUrl) {
    return jsonError(400, 'dishId and sourceUrl are required')
  }

  // ─── Pre-check: dish exists + idempotency ─────────────────────────────
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: dishRow, error: dishErr } = await svc
    .from('dishes')
    .select('id, image_url')
    .eq('id', dishId)
    .single()
  if (dishErr || !dishRow) {
    return jsonError(404, `Dish ${dishId} not found`)
  }
  const alreadyUploaded = (dishRow.image_url ?? '').startsWith(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`)
  if (alreadyUploaded && !body.force) {
    return Response.json({
      ok: true,
      publicUrl: dishRow.image_url,
      skipped: true,
      reason: 'already uploaded — pass force=true to re-import',
    })
  }

  // ─── Download ──────────────────────────────────────────────────────────
  const downloadUrl = toDownloadUrl(sourceUrl)
  let bytes: ArrayBuffer
  let contentType: string
  try {
    const r = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'fitpal-image-import/1.0' },
      redirect: 'follow',
    })
    if (!r.ok) throw new Error(`download HTTP ${r.status}`)
    contentType = (r.headers.get('Content-Type') ?? 'application/octet-stream').split(';')[0]
    if (!contentType.startsWith('image/')) {
      // Drive sometimes returns an HTML interstitial for files >100MB. None
      // of our dish photos hit that, but fail loud if we ever do.
      const sample = await r.text()
      console.error('Non-image response from %s, first 500 chars:', downloadUrl, sample.slice(0, 500))
      return jsonError(502, `Source URL did not return an image (got ${contentType})`)
    }
    bytes = await r.arrayBuffer()
  } catch (err) {
    return jsonError(502, `Download failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ─── Upload ────────────────────────────────────────────────────────────
  const ext = EXT_BY_MIME[contentType] ?? 'jpg'
  const path = `${dishId}.${ext}`
  const { error: upErr } = await svc.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: true, // overwrite on re-imports / force runs
    cacheControl: '31536000', // 1 year — bust by changing the path or via force
  })
  if (upErr) {
    console.error('Storage upload failed:', upErr)
    return jsonError(500, `Upload failed: ${upErr.message}`)
  }

  // ─── Update dishes.image_url ──────────────────────────────────────────
  const newUrl = publicUrl(SUPABASE_URL, BUCKET, path)
  const { error: updErr } = await svc
    .from('dishes')
    .update({ image_url: newUrl })
    .eq('id', dishId)
  if (updErr) {
    console.error('dishes update failed:', updErr)
    return jsonError(500, `DB update failed: ${updErr.message}`)
  }

  return Response.json({
    ok: true,
    publicUrl: newUrl,
    contentType,
    size: bytes.byteLength,
  })
}
