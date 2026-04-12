import { useEffect } from 'react'
import type { ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  /** Extra class on the inner container, e.g. 'dish-modal' or 'auth-box' */
  innerClass?: string
  /** Extra class on the overlay backdrop */
  overlayClass?: string
  /** Don't close when clicking backdrop */
  disableBackdropClose?: boolean
}

export function Modal({ open, onClose, children, innerClass, overlayClass, disableBackdropClose }: ModalProps) {
  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Esc to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className={`overlay${overlayClass ? ' ' + overlayClass : ''}`}
      onClick={(e) => {
        if (!disableBackdropClose && e.target === e.currentTarget) onClose()
      }}
    >
      {innerClass ? <div className={innerClass}>{children}</div> : children}
    </div>
  )
}
