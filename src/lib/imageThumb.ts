// WEC-547: serve small dish thumbnails via Supabase Storage image
// transformations instead of the full-resolution Storage originals.
//
// The admin menu builder renders ~640 dish <img>s (picker 316 + assignments
// 327). Decoding full-res originals into ~40px cards costs 1-2 GB of image
// memory and stalls the main thread mid-drag. A `?width=120` transform decodes
// a tiny image instead.
//
// Only rewrites Supabase public *object* URLs
//   .../storage/v1/object/public/<bucket>/<path>
// into their render/transform form
//   .../storage/v1/render/image/public/<bucket>/<path>?width=..&quality=..
// External or already-transformed URLs are returned unchanged.

export function thumbUrl(
  url: string | null | undefined,
  width = 120,
  quality = 60,
): string {
  if (!url) return ''
  const marker = '/storage/v1/object/public/'
  const i = url.indexOf(marker)
  if (i === -1) return url // not a Supabase Storage object URL — leave as-is
  const transformed =
    url.slice(0, i) + '/storage/v1/render/image/public/' + url.slice(i + marker.length)
  const sep = transformed.includes('?') ? '&' : '?'
  // resize=contain: scale the WHOLE image down to `width` keeping aspect ratio.
  // Supabase's default (cover) center-crops even with only a width set, which
  // zoomed thumbnails into an unrecognisable middle slice (WEC-547 review).
  return `${transformed}${sep}width=${width}&quality=${quality}&resize=contain`
}
