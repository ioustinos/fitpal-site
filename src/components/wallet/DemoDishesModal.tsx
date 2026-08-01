// WEC-582: subscription-wizard "demo dishes" showcase popup.
//
// Opened from the wizard link «Δες μερικά πιάτα από το μενού μας». Reuses the
// shared <Modal> (Esc + backdrop close, body-scroll lock). The wizard stays
// mounted behind it, so wizard state is preserved. One row per category, 3 cards
// visible, native horizontal scroll (= mobile swipe) plus arrow buttons to reveal
// a 4th/5th card. Showcase only — no add-to-cart.

import { useEffect, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { thumbUrl } from '../../lib/imageThumb'
import { fetchDemoDishes, type DemoCategory } from '../../lib/api/demoDishes'

interface Props {
  open: boolean
  onClose: () => void
  isEl: boolean
}

export function DemoDishesModal({ open, onClose, isEl }: Props) {
  const [cats, setCats] = useState<DemoCategory[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(false)

  // Load once, on first open; cache for the session (the curated set rarely
  // changes and re-fetching on every open is wasteful).
  useEffect(() => {
    if (!open || cats) return
    let alive = true
    setLoading(true); setErr(false)
    fetchDemoDishes().then(({ data, error }) => {
      if (!alive) return
      if (error) setErr(true)
      setCats(data ?? [])
      setLoading(false)
    })
    return () => { alive = false }
  }, [open, cats])

  return (
    <Modal open={open} onClose={onClose} innerClass="demo-modal" overlayClass="demo-overlay">
      <div className="demo-modal-head">
        <h2>{isEl ? 'Μερικά πιάτα από το μενού μας' : 'Some dishes from our menu'}</h2>
        <button className="demo-modal-close" onClick={onClose} aria-label={isEl ? 'Κλείσιμο' : 'Close'}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="demo-modal-body">
        {loading && <p className="demo-modal-msg">{isEl ? 'Φόρτωση…' : 'Loading…'}</p>}
        {!loading && err && <p className="demo-modal-msg">{isEl ? 'Κάτι πήγε στραβά. Δοκίμασε ξανά.' : 'Something went wrong. Please try again.'}</p>}
        {!loading && !err && cats && cats.length === 0 && (
          <p className="demo-modal-msg">{isEl ? 'Σύντομα διαθέσιμα δείγματα πιάτων.' : 'Sample dishes coming soon.'}</p>
        )}
        {!loading && !err && cats && cats.map((c) => (
          <DemoCatRow key={c.id} cat={c} isEl={isEl} />
        ))}
      </div>
    </Modal>
  )
}

function DemoCatRow({ cat, isEl }: { cat: DemoCategory; isEl: boolean }) {
  const scroller = useRef<HTMLDivElement>(null)
  const scrollByCards = (dir: number) => {
    const el = scroller.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }
  const hasCarousel = cat.dishes.length > 3

  return (
    <section className="demo-cat">
      <div className="demo-cat-head">
        <h3>{isEl ? cat.nameEl : cat.nameEn}</h3>
        {hasCarousel && (
          <div className="demo-cat-arrows">
            <button type="button" onClick={() => scrollByCards(-1)} aria-label={isEl ? 'Προηγούμενα' : 'Previous'}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <button type="button" onClick={() => scrollByCards(1)} aria-label={isEl ? 'Επόμενα' : 'Next'}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
        )}
      </div>

      <div className="demo-cat-scroller" ref={scroller}>
        {cat.dishes.map((d) => (
          <article className="demo-card" key={d.id}>
            <div className="demo-card-img">
              {d.imageUrl
                ? <img src={thumbUrl(d.imageUrl, 300)} alt="" loading="lazy" decoding="async" />
                : <div className="demo-card-noimg" aria-hidden="true" />}
            </div>
            <div className="demo-card-name">{isEl ? d.nameEl : d.nameEn}</div>
            {d.calories != null && (
              <div className="demo-card-macros">
                <span className="demo-kcal">{Math.round(d.calories)} kcal</span>
                {d.protein != null && <span className="demo-chip demo-chip-p">{isEl ? 'Π' : 'P'} {Math.round(d.protein)}</span>}
                {d.carbs != null && <span className="demo-chip demo-chip-c">{isEl ? 'Υ' : 'C'} {Math.round(d.carbs)}</span>}
                {d.fat != null && <span className="demo-chip demo-chip-f">{isEl ? 'Λ' : 'F'} {Math.round(d.fat)}</span>}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
