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
  /** Snapshot of the menu's current category order (ids). */
  categoryOrder: string[]
  /** Global category definitions — provides labels and tells us which ids exist. */
  categories: AdminCategory[]
  /** Called with the new order after a drag completes. Caller persists + updates state. */
  onChange: (next: string[]) => void
  /** Disabled when no menu is selected. */
  disabled?: boolean
}

/**
 * WEC-253: per-menu category ordering. Drag-reorder strip of category pills
 * scoped to the currently selected weekly menu. Persists into
 * `weekly_menus.category_order`.
 *
 * Why a separate DndContext from the menu builder's main DndContext: the two
 * sortable surfaces (categories vs. day-dish assignments) handle different
 * item shapes and different drop targets. Keeping them isolated avoids the
 * collision-detection cross-contamination that would otherwise need a
 * dnd-kit "modifier" or a custom collision detector to suppress.
 */
export function CategoryOrderStrip({
  categoryOrder,
  categories,
  onChange,
  disabled = false,
}: CategoryOrderStripProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const catById = new Map(categories.map((c) => [c.id, c]))

  // Render any ids in categoryOrder that still exist in `categories`. Filter
  // unknowns silently (covers the case where a category was deleted but the
  // menu still references it — shouldn't happen, but cheap to guard).
  const items = categoryOrder.filter((id) => catById.has(id))

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = items.indexOf(String(active.id))
    const newIdx = items.indexOf(String(over.id))
    if (oldIdx < 0 || newIdx < 0) return
    onChange(arrayMove(items, oldIdx, newIdx))
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
              return <CategoryPill key={id} id={id} label={cat.nameEl} />
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

interface CategoryPillProps {
  id: string
  label: string
}

function CategoryPill({ id, label }: CategoryPillProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
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
