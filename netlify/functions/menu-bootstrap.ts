/**
 * WEC-350: DEPRECATED.
 *
 * Originally introduced as a single mega-endpoint that returned every
 * active week's dishes in one response (~150KB). That violated the
 * "only eager-load pivot ± 1 week" rule, so it was split into three
 * smaller endpoints: /api/menu/meta, /api/menu/catalog, /api/menu/week.
 *
 * This stub remains because the FUSE-mounted workspace forbids file
 * deletion. It returns 410 Gone so any straggling caller fails loudly
 * during the cutover rather than silently serving stale data.
 */

import type { Handler } from '@netlify/functions'

export const handler: Handler = async () => ({
  statusCode: 410,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    error: 'menu-bootstrap is gone',
    replacedBy: ['/api/menu-meta', '/api/menu-catalog', '/api/menu-week?menuId=...'],
  }),
})
