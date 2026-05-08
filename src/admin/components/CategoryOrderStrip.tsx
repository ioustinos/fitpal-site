import { useEffect, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { AdminCategory } from '../../lib/api/adminDishes'

interface CategoryOrderStripProps {
  /** Saved order from the server (the menu's persisted category_order). */
  categoryOrder: string[]
  /** Global category definitions — provides labels and tells us which ids exist. */
  categories: AdminCategory[]
  /**
   * Persists the new order. Resolves on success, rejects on failure.
   * The strip awaits this promise so it can lock the Apply button while
   * the write is in flight — that's how we prevent overlapping writes
   * from arriving out of order.
   */
  onApply: (next: string[]) => Promise<void>
  /** Disabled when no menu is selected. */
  disabled?: boolean
}

/** Shallow array equality, by reference + length + element-wise. */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * WEC-253: per-menu category ordering. Drag-reorder strip of category pills
 * scoped to the currently selected weekly menu.
 *
 * UX model — draft + apply (not auto-save):
 *   - Each drag updates a LOCAL `draft` only.
 *   - "Apply" button persists the draft in one network round-trip.
 *   - "Reset" reverts the draft back to the saved order.
 *   - While a write is in flight, Apply is disabled — that's the lock that
 *     prevents two rapid reorders from racing each other into the DB out of
 *     order.
 *
 * Why a separate DndContext from the menu builder's main DndContext: the two
 * sortable surfaces (categories vs. day-dish assignments) handle different
 * item shapes and different drop targets. Keeping them isolated avoids the
 * collision-detection cross-contamination that would otherwise need a
 * dnd-kit modifier or a custom collision detector to suppress.
 */
export function CategoryOrderStrip({
  categoryOrder,
  categories,
  onApply,
  disabled = false,
}: CategoryOrderStripProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const catById = new Map(categories.map((c) => [c.id, c]))

  // Local draft. Initializes from the server order and stays in sync whenever
  // the parent passes a new array (e.g. when the user switches between menus,
  // or after Apply succeeds and the parent updates the saved snapshot).
  const [draft, setDraft] = useState<string[]>(categoryOrder)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    setDraft(categoryOrder)
  }, [categoryOrder])

  // Render only ids that exist in `categories` (defensive against deleted cats).
  const items = draft.filter((id) => catById.has(id))
  const isDirty = !arraysEqual(draft, categoryOrder)

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = items.indexOf(String(active.id))
    const newIdx = items.indexOf(String(over.id))
    if (oldIdx < 0 || newIdx < 0) return
    setDraft(arrayMove(items, oldIdx, newIdx))
    // A new local edit invalidates the post-save flash.
    setJustSaved(false)
  }

  async function handleApply() {
    if (saving || !isDirty) return
    setSaving(true)
    try {
      await onApply(draft)
      // Parent will update `categoryOrder` to match `draft`, the prop sync
      // effect will line everything up. Show the success flash for a moment.
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 1800)
    } catch {
      // Parent's onApply already surfaces the error to the user; we just
      // leave the draft as-is so they can retry without re-dragging.
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    setDraft(categoryOrder)
    setJustSaved(false)
  }

  if (disabled || items.length === 0) {
    return (
      <div className="admin-cat-order-strip admin-cat-order-strip-disabled">
        <span className="admin-text-muted" style={{ fontSize: '0.8rem' }}>
          {disabled
            ? 'Select a menu to reorder its categories'
            : 'No categories configured for this menu'}
        </span>
      </div>
    )
  }

  return (
    <div className="admin-cat-order-strip">
      <span className="admin-form-label" style={{ marginRight: 8 }}>Category order</span>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items} strategy={horizontalListSortingStrategy}>
          <div className="admin-cat-pills">
            {items.map((id) => {
              const cat = catById.get(id)!
              return <CategoryPill key={id} id={id} label={cat.nameEl} disabled={saving} />
            })}
          </div>
        </SortableContext>
      </DndContext>

      <div className="admin-cat-order-actions">
        {isDirty && !saving && (
          <span className="admin-text-muted admin-cat-order-dirty">Unsaved</span>
        )}
        {justSaved && !isDirty && (
          <span className="admin-cat-order-saved">Saved ✓</span>
        )}
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="admin-btn-ghost admin-cat-order-view"
          aria-label="Open the customer menu in a new tab to verify the new order"
        >
          View on menu ↗
        </a>
        <button
          className="admin-btn-ghost"
          onClick={handleReset}
          disabled={!isDirty || saving}
          type="button"
        >
          Reset
        </button>
        <button
          className="admin-btn-primary"
          onClick={handleApply}
          disabled={!isDirty || saving}
          type="button"
        >
          {saving ? 'Saving…' : 'Apply'}
        </button>
      </div>
    </div>
  )
}

interface CategoryPillProps {
  id: string
  label: string
  disabled?: boolean
}

function CategoryPill({ id, label, disabled = false }: CategoryPillProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    cursor: disabled ? 'not-allowed' : undefined,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="admin-cat-pill"
      role="button"
      aria-label={`Drag to reorder ${label}`}
    >
      {label}
    </div>
  )
}
