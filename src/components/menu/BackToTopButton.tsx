import { useEffect, useState } from 'react'
import { useUIStore } from '../../store/useUIStore'

/**
 * WEC-342 — floating "Back to top" pill anchored bottom-center.
 *
 * Tester report: scrolling through breakfast → mains → salads → snacks
 * leaves the customer far from the day selector + cart sidebar. They want
 * a quick way back to the top instead of a long scroll.
 *
 * Behaviour:
 *   - Hidden on mount; shown after scrolling > THRESHOLD pixels.
 *   - Scroll listener is passive + rAF-throttled so it never costs frame
 *     budget on long menus.
 *   - Click → window.scrollTo({ top: 0, behavior: 'smooth' }).
 *   - Mobile (≤768px) hides the button entirely via CSS — the mobile
 *     cart sheet (WEC-264) lives at the bottom of the viewport and would
 *     fight visually with another bottom-anchored control. Mobile users
 *     also have native scroll-to-top via status-bar tap on iOS.
 */
const SCROLL_THRESHOLD = 600

export function BackToTopButton() {
  const lang = useUIStore((s) => s.lang)
  const isEl = lang === 'el'
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let raf = 0
    function onScroll() {
      // rAF throttle — coalesce multiple scroll events into one state
      // update per frame. Cheap on idle pages, essential on long menus.
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setVisible(window.scrollY > SCROLL_THRESHOLD)
      })
    }
    // Read once on mount in case the page was loaded mid-scroll
    // (e.g. browser back/forward with restored scroll position).
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  function handleClick() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // We always render the button so the fade transition has something to
  // animate from. Visibility is controlled via the `visible` class.
  return (
    <button
      type="button"
      className={`back-to-top${visible ? ' visible' : ''}`}
      onClick={handleClick}
      aria-label={isEl ? 'Επιστροφή στην κορυφή' : 'Back to top'}
      // When hidden, take the button out of the tab order so keyboard
      // users don't land on an invisible control.
      tabIndex={visible ? 0 : -1}
      aria-hidden={visible ? undefined : true}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="18 15 12 9 6 15" />
      </svg>
      <span className="back-to-top-label">
        {isEl ? 'Πάνω' : 'Top'}
      </span>
    </button>
  )
}
