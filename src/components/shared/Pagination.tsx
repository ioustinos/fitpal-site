import { useUIStore } from '../../store/useUIStore'

/**
 * Pagination bar (WEC-168 / WEC-169).
 *
 * Renders prev / page numbers / next. Returns `null` when there's only one
 * page — keeps the UI quiet for small datasets. Page numbers are clamped
 * to a 7-wide window around the current page so long histories don't spill
 * across the screen.
 */
export interface PaginationProps {
  page: number
  pageCount: number
  onChange: (p: number) => void
}

export function Pagination({ page, pageCount, onChange }: PaginationProps) {
  const lang = useUIStore((s) => s.lang)
  if (pageCount <= 1) return null

  const pages = windowAround(page, pageCount, 7)

  return (
    <nav className="pagination" aria-label={lang === 'el' ? 'Πλοήγηση σελίδων' : 'Pagination'}>
      <button
        type="button"
        className="page-btn"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label={lang === 'el' ? 'Προηγούμενη' : 'Previous'}
      >
        ‹
      </button>
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`e${i}`} className="page-ellipsis">…</span>
        ) : (
          <button
            key={p}
            type="button"
            className={`page-btn${p === page ? ' active' : ''}`}
            onClick={() => onChange(p as number)}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        className="page-btn"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
        aria-label={lang === 'el' ? 'Επόμενη' : 'Next'}
      >
        ›
      </button>
    </nav>
  )
}

/** Build a clamped sliding window of page numbers around `current`,
 *  always including first and last, with ellipses for the gaps. */
function windowAround(current: number, total: number, width: number): Array<number | '…'> {
  if (total <= width) return Array.from({ length: total }, (_, i) => i + 1)
  const half = Math.floor(width / 2)
  let start = Math.max(1, current - half)
  let end = Math.min(total, start + width - 1)
  if (end - start + 1 < width) start = Math.max(1, end - width + 1)

  const out: Array<number | '…'> = []
  if (start > 1) {
    out.push(1)
    if (start > 2) out.push('…')
  }
  for (let i = start; i <= end; i++) out.push(i)
  if (end < total) {
    if (end < total - 1) out.push('…')
    out.push(total)
  }
  return out
}
