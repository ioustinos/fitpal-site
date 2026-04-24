import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  DragOverlay,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  fetchAdminDishes, fetchAdminCategories, fetchAdminTags,
  type AdminDish, type AdminCategory, type AdminTag,
} from '../../lib/api/adminDishes'
import {
  addDays, fmtIso, mondayOf, weekDays,
  fetchMenusOverlapping, fetchMenuDayDishes,
  createWeeklyMenu, deleteWeeklyMenu, setMenuActive, renameMenu, setMenuDateActive,
  addDishToDay, removeMenuDayDish, reorderMenuDayDishes, duplicateMenuContent,
  type AdminWeeklyMenu, type AdminMenuDayDish,
} from '../../lib/api/adminMenus'

const DAY_NAMES_BY_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/**
 * Derive the 3-letter weekday label directly from a YYYY-MM-DD string.
 *
 * We parse the parts manually rather than `new Date(iso)`, because the latter
 * treats bare ISO-date strings as UTC midnight — which in Athens (UTC+2/+3)
 * lands on the previous calendar day and yields the wrong weekday.
 *
 * WEC-122 / #24: columns were labelled by positional index (`DAY_NAMES[idx]`),
 * which silently masked the upstream `fmtIso` timezone bug — bad dates got
 * "Mon..Fri" labels even when they were actually Sun..Thu. Computing the label
 * from the date itself means any future date-handling regression becomes
 * visually obvious ("Sun" column where "Mon" should be) instead of silently
 * wrong.
 */
function dayNameFromIso(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  const dow = new Date(y, m - 1, d).getDay()
  return DAY_NAMES_BY_DOW[dow]
}

export function Menus() {
  const [monday, setMonday] = useState<Date>(() => mondayOf(new Date()))
  const weekStart = fmtIso(monday)
  const weekEnd = fmtIso(addDays(monday, 4))

  const [menusInWeek, setMenusInWeek] = useState<AdminWeeklyMenu[]>([])
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<AdminMenuDayDish[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingName, setEditingName] = useState<string>('')

  const [dishes, setDishes] = useState<AdminDish[]>([])
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [tags, setTags] = useState<AdminTag[]>([])
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState<string | 'all'>('all')
  const [filterTag, setFilterTag] = useState<string | 'all'>('all')

  const [draggingId, setDraggingId] = useState<string | null>(null)
  /** Date the user is currently hovering over while dragging — used to light up
      the whole day column even when the cursor is over a child assignment card
      (which would otherwise steal the `isOver` signal from the column droppable). */
  const [hoverDate, setHoverDate] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  // ─── Load dishes + categories once ──────────────────────────────
  useEffect(() => {
    (async () => {
      const [dr, cr, tr] = await Promise.all([fetchAdminDishes(), fetchAdminCategories(), fetchAdminTags()])
      setDishes((dr.data ?? []).filter((d) => d.active))
      setCategories(cr.data ?? [])
      setTags(tr.data ?? [])
    })()
  }, [])

  // ─── Load menus + assignments for selected week ─────────────────
  async function loadWeek() {
    setLoading(true)
    setError(null)
    const { data, error } = await fetchMenusOverlapping(weekStart, weekEnd)
    if (error) { setError(error); setLoading(false); return }
    setMenusInWeek(data ?? [])
    const exact = data?.find((m) => m.fromDate === weekStart) ?? data?.[0] ?? null
    setSelectedMenuId(exact?.id ?? null)
    setEditingName(exact?.name ?? '')
    if (exact) {
      const { data: ad, error: aerr } = await fetchMenuDayDishes(exact.id)
      if (aerr) setError(aerr)
      setAssignments(ad ?? [])
    } else {
      setAssignments([])
    }
    setLoading(false)
  }
  useEffect(() => { loadWeek() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [weekStart])

  const selectedMenu = useMemo(
    () => menusInWeek.find((m) => m.id === selectedMenuId) ?? null,
    [menusInWeek, selectedMenuId],
  )
  const inactiveDates = useMemo(() => new Set(selectedMenu?.inactiveDates ?? []), [selectedMenu])

  const dishById = useMemo(() => new Map(dishes.map((d) => [d.id, d])), [dishes])
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const filteredDishes = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return dishes.filter((d) => {
      if (filterCategory !== 'all' && d.categoryId !== filterCategory) return false
      if (filterTag !== 'all' && !d.tagIds.includes(filterTag)) return false
      if (needle) {
        const hay = `${d.nameEl} ${d.nameEn}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [dishes, search, filterCategory, filterTag])

  const days = weekDays(monday).map(fmtIso)

  const dishUsage = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const a of assignments) {
      const arr = m.get(a.dishId) ?? []
      const dayIdx = days.indexOf(a.date)
      if (dayIdx >= 0) arr.push(dayNameFromIso(a.date))
      m.set(a.dishId, arr)
    }
    return m
  }, [assignments, days])

  // ─── Actions ──────────────────────────────────────────────────────
  async function handleNewMenu() {
    setError(null)
    const { data, error } = await createWeeklyMenu({ fromDate: weekStart, toDate: weekEnd, name: `Week of ${weekStart}` })
    if (error) { setError(error); return }
    await loadWeek()
    if (data) setSelectedMenuId(data.id)
  }
  async function handleDuplicateFromPrev() {
    if (!selectedMenuId) { setError('Create or select a menu first.'); return }
    setError(null)
    const prevMonday = addDays(monday, -7)
    const prevIso = fmtIso(prevMonday)
    const prevEnd = fmtIso(addDays(prevMonday, 4))
    const { data: prev, error: pErr } = await fetchMenusOverlapping(prevIso, prevEnd)
    if (pErr) { setError(pErr); return }
    const prevMenu = prev?.find((m) => m.fromDate === prevIso) ?? prev?.[0]
    if (!prevMenu) { setError('No menu found for last week to duplicate.'); return }
    const { error: dupErr } = await duplicateMenuContent(prevMenu.id, selectedMenuId, 7)
    if (dupErr) { setError(dupErr); return }
    await loadWeek()
  }
  async function handleTogglePublish() {
    if (!selectedMenu) return
    const { error } = await setMenuActive(selectedMenu.id, !selectedMenu.active)
    if (error) { setError(error); return }
    await loadWeek()
  }
  async function handleRename() {
    if (!selectedMenu) return
    const newName = editingName.trim() || null
    if (newName === selectedMenu.name) return
    const { error } = await renameMenu(selectedMenu.id, newName)
    if (error) { setError(error); return }
    await loadWeek()
  }
  async function handleDelete() {
    if (!selectedMenu) return
    if (!confirm(`Delete menu "${selectedMenu.name ?? selectedMenu.fromDate}"? All day assignments will be removed.`)) return
    const { error } = await deleteWeeklyMenu(selectedMenu.id)
    if (error) { setError(error); return }
    await loadWeek()
  }
  async function handleRemoveAssignment(id: string) {
    const prev = assignments
    setAssignments(assignments.filter((a) => a.id !== id))
    const { error } = await removeMenuDayDish(id)
    if (error) { setError(error); setAssignments(prev) }
  }
  async function handleAddDishToDay(dishId: string, date: string, sortOrder: number) {
    if (!selectedMenuId) { setError('Create a menu for this week first.'); return }
    const { data, error } = await addDishToDay(selectedMenuId, date, dishId, sortOrder)
    if (error) { setError(error); return }
    if (data) setAssignments((prev) => [...prev, data])
  }
  async function handleReorderAssignments(updated: AdminMenuDayDish[]) {
    setAssignments(updated)
    const changed = updated.filter((u, i) => {
      const prev = assignments[i]
      return !prev || prev.id !== u.id || prev.sortOrder !== u.sortOrder || prev.date !== u.date
    })
    if (changed.length === 0) return
    const { error } = await reorderMenuDayDishes(
      updated.map((a) => ({ id: a.id, date: a.date, sortOrder: a.sortOrder })),
    )
    if (error) setError(error)
  }

  async function handleToggleDayActive(date: string) {
    if (!selectedMenu) return
    const currentlyInactive = inactiveDates.has(date)
    const { error } = await setMenuDateActive(selectedMenu.id, date, currentlyInactive)
    if (error) { setError(error); return }
    await loadWeek()
  }

  // ─── Drag handlers ────────────────────────────────────────────────
  function onDragStart(e: DragStartEvent) {
    setDraggingId(String(e.active.id))
    setHoverDate(null)
  }

  function onDragOver(e: DragOverEvent) {
    const overId = e.over ? String(e.over.id) : null
    if (!overId) { setHoverDate(null); return }
    if (overId.startsWith('col:')) {
      setHoverDate(overId.slice(4))
    } else if (overId.startsWith('asn:')) {
      const raw = overId.slice(4)
      const asn = assignments.find((a) => a.id === raw)
      setHoverDate(asn?.date ?? null)
    } else {
      setHoverDate(null)
    }
  }

  function onDragEnd(e: DragEndEvent) {
    setDraggingId(null)
    setHoverDate(null)
    const activeId = String(e.active.id)
    const overId = e.over ? String(e.over.id) : null
    if (!overId) return

    const isFromLibrary = activeId.startsWith('lib:')
    const activeRawId = activeId.split(':')[1]

    // Dropped on a day column (empty slot or column body)
    if (overId.startsWith('col:')) {
      const date = overId.slice(4)
      if (inactiveDates.has(date)) return
      if (isFromLibrary) {
        const sortOrder = assignments.filter((a) => a.date === date).length
        handleAddDishToDay(activeRawId, date, sortOrder)
      } else {
        const asn = assignments.find((a) => a.id === activeRawId)
        if (!asn || asn.date === date) return
        const updated = assignments.map((a) =>
          a.id === activeRawId
            ? { ...a, date, sortOrder: assignments.filter((x) => x.date === date).length }
            : a,
        )
        handleReorderAssignments(updated)
      }
      return
    }

    // Dropped on another assignment (reorder or cross-day move)
    if (overId.startsWith('asn:')) {
      const overRawId = overId.slice(4)
      const targetAsn = assignments.find((a) => a.id === overRawId)
      if (!targetAsn) return
      if (inactiveDates.has(targetAsn.date)) return

      if (isFromLibrary) {
        const sortOrder = targetAsn.sortOrder
        handleAddDishToDay(activeRawId, targetAsn.date, sortOrder)
        return
      }

      const activeAsn = assignments.find((a) => a.id === activeRawId)
      if (!activeAsn) return

      if (activeAsn.date !== targetAsn.date) {
        // Different day → move to that day
        const updated = assignments.map((a) =>
          a.id === activeRawId
            ? { ...a, date: targetAsn.date, sortOrder: assignments.filter((x) => x.date === targetAsn.date).length }
            : a,
        )
        handleReorderAssignments(updated)
        return
      }

      // Same day → reorder within day, restricted to same category
      const activeDish = dishById.get(activeAsn.dishId)
      const targetDish = dishById.get(targetAsn.dishId)
      if (!activeDish || !targetDish) return
      if (activeDish.categoryId !== targetDish.categoryId) return   // only reorder within same category

      const sameGroup = assignments
        .filter((a) => a.date === activeAsn.date)
        .filter((a) => {
          const d = dishById.get(a.dishId)
          return d && d.categoryId === activeDish.categoryId
        })
        .sort((a, b) => a.sortOrder - b.sortOrder)

      const from = sameGroup.findIndex((a) => a.id === activeAsn.id)
      const to = sameGroup.findIndex((a) => a.id === targetAsn.id)
      if (from === -1 || to === -1 || from === to) return

      const reorderedIds = arrayMove(sameGroup.map((a) => a.id), from, to)
      // Assign new sort_orders to the reordered subset while preserving their
      // original slot (min..min+len-1 of sort_orders within that same-day same-category subset)
      const slotSortOrders = sameGroup.map((a) => a.sortOrder)
      const idToNewSort = new Map<string, number>()
      reorderedIds.forEach((id, i) => idToNewSort.set(id, slotSortOrders[i]))

      const updated = assignments.map((a) =>
        idToNewSort.has(a.id) ? { ...a, sortOrder: idToNewSort.get(a.id)! } : a,
      )
      handleReorderAssignments(updated)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────
  const draggingDish =
    draggingId?.startsWith('lib:') ? dishById.get(draggingId.slice(4)) :
    draggingId?.startsWith('asn:') ? (() => { const a = assignments.find((x) => x.id === draggingId.slice(4)); return a ? dishById.get(a.dishId) : undefined })() :
    undefined

  return (
    <div className="admin-page admin-menus">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Menu builder</h1>
          <p className="admin-page-sub">
            Week of <strong>{weekStart}</strong> — {weekEnd}
          </p>
        </div>
        <div className="admin-page-actions">
          <button className="admin-btn-ghost" onClick={() => setMonday(addDays(monday, -7))}>← Prev week</button>
          <button className="admin-btn-ghost" onClick={() => setMonday(mondayOf(new Date()))}>Today</button>
          <button className="admin-btn-ghost" onClick={() => setMonday(addDays(monday, 7))}>Next week →</button>
        </div>
      </div>

      <div className="admin-menu-controls">
        <div className="admin-menu-select-wrap">
          <label className="admin-form-label">Menu</label>
          {menusInWeek.length === 0 ? (
            <div className="admin-text-muted">No menu for this week yet.</div>
          ) : (
            <select className="admin-select" value={selectedMenuId ?? ''} onChange={(e) => {
              const id = e.target.value
              setSelectedMenuId(id)
              const m = menusInWeek.find((x) => x.id === id)
              setEditingName(m?.name ?? '')
              if (id) fetchMenuDayDishes(id).then(({ data }) => setAssignments(data ?? []))
            }}>
              {menusInWeek.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name ?? `${m.fromDate} — ${m.toDate}`}{m.active ? ' • published' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
        {selectedMenu && (
          <div className="admin-menu-select-wrap">
            <label className="admin-form-label">Name</label>
            <input
              className="admin-input"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={handleRename}
              placeholder="Optional menu name"
            />
          </div>
        )}
        <div className="admin-menu-actions">
          <button className="admin-btn-ghost" onClick={handleNewMenu}>+ New menu</button>
          {selectedMenu && (
            <>
              <button className="admin-btn-ghost" onClick={handleDuplicateFromPrev}>Duplicate from last week</button>
              <button
                className={selectedMenu.active ? 'admin-btn-ghost' : 'admin-btn-primary'}
                onClick={handleTogglePublish}
              >
                {selectedMenu.active ? 'Unpublish' : 'Publish'}
              </button>
              <button className="admin-btn-danger" onClick={handleDelete}>Delete</button>
            </>
          )}
        </div>
      </div>

      {error && <div className="admin-error-banner">{error}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
          <div className="admin-menu-layout">
            {/* Library — sticky on horizontal scroll */}
            <aside className="admin-menu-lib">
              <div className="admin-menu-lib-head">
                <input
                  className="admin-input"
                  type="search"
                  placeholder="Search dishes…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select className="admin-select" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                  <option value="all">All categories</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.nameEl}</option>)}
                </select>
                <select className="admin-select" value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
                  <option value="all">All tags</option>
                  {tags.map((t) => <option key={t.id} value={t.id}>{t.labelEl}</option>)}
                </select>
              </div>
              <div className="admin-menu-lib-body">
                {filteredDishes.length === 0 && <div className="admin-text-muted" style={{ padding: 12 }}>No dishes match.</div>}
                {filteredDishes.map((d) => (
                  <LibraryCard key={d.id} dish={d} usedOn={dishUsage.get(d.id) ?? []} disabled={!selectedMenuId} />
                ))}
              </div>
            </aside>

            {/* Day columns — horizontally scrollable so the library (left) stays visible
                while the user scrolls across to Friday. Vertical growth still uses
                the browser's native page scroll. */}
            <div className="admin-menu-days-wrap">
              <div className="admin-menu-days">
                {days.map((dateIso) => {
                  const dayAsns = assignments.filter((a) => a.date === dateIso)
                  const isInactive = inactiveDates.has(dateIso)
                  return (
                    <DayColumn
                      key={dateIso}
                      dateIso={dateIso}
                      dayName={dayNameFromIso(dateIso)}
                      assignments={dayAsns}
                      dishById={dishById}
                      categories={categories}
                      catById={catById}
                      inactive={isInactive}
                      menuExists={!!selectedMenuId}
                      isDragTarget={hoverDate === dateIso}
                      onRemove={handleRemoveAssignment}
                      onToggleActive={() => handleToggleDayActive(dateIso)}
                    />
                  )
                })}
              </div>
            </div>
          </div>

          <DragOverlay>
            {draggingDish ? <DishCardVisual dish={draggingDish} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {!selectedMenuId && !loading && (
        <div className="admin-menu-empty">
          <p>No menu exists for this week yet. Click <strong>+ New menu</strong> to create one.</p>
        </div>
      )}
    </div>
  )
}

// ─── Components ─────────────────────────────────────────────────────────────

function LibraryCard({ dish, usedOn, disabled }: { dish: AdminDish; usedOn: string[]; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `lib:${dish.id}`,
    data: { type: 'library', dishId: dish.id },
    disabled,
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`admin-dish-card admin-dish-card-lib${usedOn.length ? ' used' : ''}${isDragging ? ' dragging' : ''}`}
    >
      <DishCardVisual dish={dish} />
      {usedOn.length > 0 && <div className="admin-dish-used-hint">used: {usedOn.join(', ')}</div>}
    </div>
  )
}

function DayColumn({
  dateIso, dayName, assignments, dishById, categories, catById, inactive, menuExists, isDragTarget, onRemove, onToggleActive,
}: {
  dateIso: string
  dayName: string
  assignments: AdminMenuDayDish[]
  dishById: Map<string, AdminDish>
  categories: AdminCategory[]
  catById: Map<string, AdminCategory>
  inactive: boolean
  menuExists: boolean
  /** True if the cursor is currently over this column or any of its assignments while dragging. */
  isDragTarget: boolean
  onRemove: (id: string) => void
  onToggleActive: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${dateIso}`,
    disabled: !menuExists || inactive,
  })
  const showHover = (isOver || isDragTarget) && !inactive

  // Group assignments by category, preserving categories.sort_order
  const groups = useMemo(() => {
    const byCat = new Map<string, AdminMenuDayDish[]>()
    for (const a of assignments) {
      const d = dishById.get(a.dishId)
      const cid = d?.categoryId ?? 'uncategorized'
      const arr = byCat.get(cid) ?? []
      arr.push(a)
      byCat.set(cid, arr)
    }
    for (const arr of byCat.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder)

    // Order categories by sort_order; put "uncategorized" last
    const ordered: Array<{ catId: string; catName: string; items: AdminMenuDayDish[] }> = []
    const used = new Set<string>()
    for (const c of [...categories].sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (byCat.has(c.id)) {
        ordered.push({ catId: c.id, catName: c.nameEl, items: byCat.get(c.id)! })
        used.add(c.id)
      }
    }
    for (const [cid, items] of byCat) {
      if (!used.has(cid)) ordered.push({ catId: cid, catName: catById.get(cid)?.nameEl ?? '—', items })
    }
    return ordered
  }, [assignments, dishById, categories, catById])

  const total = assignments.length

  return (
    <div ref={setNodeRef} className={`admin-day-col${showHover ? ' over' : ''}${inactive ? ' inactive' : ''}`}>
      <header className="admin-day-col-head">
        <div>
          <div className="admin-day-name">{dayName}</div>
          <div className="admin-day-date">{dateIso.slice(5)}</div>
        </div>
        <div className="admin-day-count">{total}</div>
        <button
          className={`admin-day-toggle${inactive ? ' is-closed' : ''}`}
          onClick={onToggleActive}
          title={inactive ? 'Reopen this day' : 'Mark this day closed (kitchen closed / holiday)'}
        >
          {inactive ? 'Open Day' : 'Close Day'}
        </button>
      </header>

      <SortableContext items={assignments.map((a) => `asn:${a.id}`)} strategy={verticalListSortingStrategy}>
        <div className="admin-day-col-body">
          {inactive && (
            <div className="admin-day-closed-note">
              Kitchen closed — customers will not see this day.
            </div>
          )}
          {total === 0 && !inactive && (
            <div className="admin-day-empty">{menuExists ? 'Drop a dish here' : '—'}</div>
          )}
          {groups.map((g) => (
            <div key={g.catId} className="admin-day-cat-group">
              <div className="admin-day-cat-header">{g.catName}</div>
              {g.items.map((a) => {
                const dish = dishById.get(a.dishId)
                if (!dish) {
                  return (
                    <AssignmentCard
                      key={a.id}
                      id={a.id}
                      dish={{ id: a.dishId, nameEl: `(missing: ${a.dishId})`, imageUrl: null, emoji: '?' } as AdminDish}
                      onRemove={() => onRemove(a.id)}
                    />
                  )
                }
                return <AssignmentCard key={a.id} id={a.id} dish={dish} onRemove={() => onRemove(a.id)} />
              })}
            </div>
          ))}
        </div>
      </SortableContext>
    </div>
  )
}

function AssignmentCard({ id, dish, onRemove }: { id: string; dish: AdminDish; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `asn:${id}`,
  })
  return (
    <div
      ref={setNodeRef}
      className={`admin-dish-card assigned${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div {...attributes} {...listeners} style={{ flex: 1, cursor: 'grab', minWidth: 0 }}>
        <DishCardVisual dish={dish} />
      </div>
      <button className="admin-dish-remove" onClick={onRemove} title="Remove from this day">×</button>
    </div>
  )
}

/** Shared visual — used in library + assignments + drag overlay.
    Shows nameEl only (English sub is hidden to keep cards dense in day columns). */
function DishCardVisual({ dish }: { dish: AdminDish }) {
  return (
    <div className="admin-dish-card-inner">
      {dish.imageUrl
        ? <img src={dish.imageUrl} alt="" className="admin-dish-card-img" />
        : <div className="admin-dish-card-img admin-dish-card-img-empty">{dish.emoji ?? '🍽️'}</div>
      }
      <div className="admin-dish-card-text">
        <div className="admin-dish-card-name">{dish.nameEl}</div>
      </div>
    </div>
  )
}
