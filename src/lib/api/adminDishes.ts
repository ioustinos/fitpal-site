import { supabase } from '../supabase'

// ─── Types (camelCase for client) ──────────────────────────────────────────

export interface AdminVariant {
  id: string
  dishId: string
  labelEl: string
  labelEn: string
  price: number       // cents
  calories: number
  protein: number
  carbs: number
  fat: number
  sortOrder: number
}

export interface AdminDish {
  id: string
  categoryId: string
  nameEl: string
  nameEn: string
  descEl: string
  descEn: string
  imageUrl: string | null
  emoji: string | null
  discountPct: number
  active: boolean
  previewCal: number
  previewPro: number
  previewCarb: number
  previewFat: number
  createdAt: string
  updatedAt: string
  variants: AdminVariant[]
  tagIds: string[]
  categoryNameEl?: string
  categoryNameEn?: string
}

export interface AdminCategory {
  id: string
  nameEl: string
  nameEn: string
  sortOrder: number
  active: boolean
  dishCount?: number
}

export interface AdminTag {
  id: string
  labelEl: string
  labelEn: string
  bgColor: string
  fontColor: string
  sortOrder: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 40)

const makeDishId = (nameEn: string): string =>
  `${slugify(nameEn) || 'dish'}-${Date.now().toString(36).slice(-6)}`

const makeVariantId = (dishId: string): string =>
  `${dishId}-v${Date.now().toString(36).slice(-5)}-${Math.random().toString(36).slice(2, 5)}`

const makeCategoryId = (nameEn: string): string =>
  slugify(nameEn) || `cat-${Date.now().toString(36).slice(-5)}`

const makeTagId = (labelEn: string): string =>
  slugify(labelEn) || `tag-${Date.now().toString(36).slice(-5)}`

// ─── Fetchers ─────────────────────────────────────────────────────────────

export async function fetchAdminDishes(): Promise<{ data: AdminDish[] | null; error: string | null }> {
  const [dishesRes, variantsRes, tagsRes, catsRes] = await Promise.all([
    supabase.from('dishes').select('*').order('updated_at', { ascending: false }),
    supabase.from('dish_variants').select('*').order('sort_order'),
    supabase.from('dish_tags').select('dish_id, tag_id'),
    supabase.from('categories').select('id, name_el, name_en'),
  ])
  if (dishesRes.error) return { data: null, error: dishesRes.error.message }

  const catMap = new Map<string, { nameEl: string; nameEn: string }>()
  for (const c of catsRes.data ?? []) catMap.set(c.id as string, { nameEl: c.name_el as string, nameEn: c.name_en as string })

  const variantsByDish = new Map<string, AdminVariant[]>()
  for (const v of variantsRes.data ?? []) {
    const row = v as {
      id: string; dish_id: string; label_el: string; label_en: string; price: number;
      calories: number | null; protein: number | null; carbs: number | null; fat: number | null; sort_order: number;
    }
    const arr = variantsByDish.get(row.dish_id) ?? []
    arr.push({
      id: row.id, dishId: row.dish_id, labelEl: row.label_el, labelEn: row.label_en ?? '',
      price: row.price, calories: row.calories ?? 0, protein: row.protein ?? 0,
      carbs: row.carbs ?? 0, fat: row.fat ?? 0, sortOrder: row.sort_order ?? 0,
    })
    variantsByDish.set(row.dish_id, arr)
  }

  const tagsByDish = new Map<string, string[]>()
  for (const dt of tagsRes.data ?? []) {
    const arr = tagsByDish.get(dt.dish_id as string) ?? []
    arr.push(dt.tag_id as string)
    tagsByDish.set(dt.dish_id as string, arr)
  }

  const dishes: AdminDish[] = (dishesRes.data ?? []).map((d) => {
    const r = d as {
      id: string; category_id: string; name_el: string; name_en: string | null;
      desc_el: string | null; desc_en: string | null; image_url: string | null; emoji: string | null;
      discount_pct: number | null; active: boolean; created_at: string; updated_at: string;
      preview_cal: number; preview_pro: number; preview_carb: number; preview_fat: number;
    }
    const cat = catMap.get(r.category_id)
    return {
      id: r.id,
      categoryId: r.category_id,
      nameEl: r.name_el,
      nameEn: r.name_en ?? '',
      descEl: r.desc_el ?? '',
      descEn: r.desc_en ?? '',
      imageUrl: r.image_url,
      emoji: r.emoji,
      discountPct: r.discount_pct ?? 0,
      active: r.active,
      previewCal: r.preview_cal, previewPro: r.preview_pro,
      previewCarb: r.preview_carb, previewFat: r.preview_fat,
      createdAt: r.created_at, updatedAt: r.updated_at,
      variants: variantsByDish.get(r.id) ?? [],
      tagIds: tagsByDish.get(r.id) ?? [],
      categoryNameEl: cat?.nameEl, categoryNameEn: cat?.nameEn,
    }
  })
  return { data: dishes, error: null }
}

export async function fetchAdminCategories(): Promise<{ data: AdminCategory[] | null; error: string | null }> {
  const [catsRes, dishesRes] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order'),
    supabase.from('dishes').select('category_id'),
  ])
  if (catsRes.error) return { data: null, error: catsRes.error.message }
  const count = new Map<string, number>()
  for (const d of dishesRes.data ?? []) {
    count.set(d.category_id as string, (count.get(d.category_id as string) ?? 0) + 1)
  }
  const data: AdminCategory[] = (catsRes.data ?? []).map((c) => {
    const r = c as { id: string; name_el: string; name_en: string | null; sort_order: number | null; active: boolean | null }
    return {
      id: r.id, nameEl: r.name_el, nameEn: r.name_en ?? '',
      sortOrder: r.sort_order ?? 0, active: r.active ?? true,
      dishCount: count.get(r.id) ?? 0,
    }
  })
  return { data, error: null }
}

export async function fetchAdminTags(): Promise<{ data: AdminTag[] | null; error: string | null }> {
  const { data, error } = await supabase.from('tags').select('*').order('sort_order')
  if (error) return { data: null, error: error.message }
  const tags: AdminTag[] = (data ?? []).map((t) => {
    const r = t as { id: string; label_el: string; label_en: string | null; bg_color: string | null; font_color: string | null; sort_order: number | null }
    return {
      id: r.id, labelEl: r.label_el, labelEn: r.label_en ?? '',
      bgColor: r.bg_color ?? '#e0e0e0', fontColor: r.font_color ?? '#333333',
      sortOrder: r.sort_order ?? 0,
    }
  })
  return { data: tags, error: null }
}

// ─── Mutations ────────────────────────────────────────────────────────────

interface SaveDishInput {
  id?: string   // undefined = create
  categoryId: string
  nameEl: string
  nameEn: string
  descEl: string
  descEn: string
  imageUrl: string | null
  emoji: string | null
  discountPct: number
  active: boolean
  previewCal: number
  previewPro: number
  previewCarb: number
  previewFat: number
  variants: Array<Omit<AdminVariant, 'dishId'> & { id?: string }>
  tagIds: string[]
}

/**
 * Create or update a dish + its variants + its tag associations.
 * For updates, we replace all variants and tag associations (simpler than diff).
 */
export async function saveDish(input: SaveDishInput): Promise<{ data: { id: string } | null; error: string | null }> {
  const isNew = !input.id
  const id = input.id ?? makeDishId(input.nameEn || input.nameEl)

  const dishRow = {
    id,
    category_id: input.categoryId,
    name_el: input.nameEl,
    name_en: input.nameEn,
    desc_el: input.descEl || null,
    desc_en: input.descEn || null,
    image_url: input.imageUrl,
    emoji: input.emoji || null,
    discount_pct: input.discountPct,
    active: input.active,
    preview_cal: input.previewCal,
    preview_pro: input.previewPro,
    preview_carb: input.previewCarb,
    preview_fat: input.previewFat,
    updated_at: new Date().toISOString(),
  }

  if (isNew) {
    const { error } = await supabase.from('dishes').insert(dishRow)
    if (error) return { data: null, error: error.message }
  } else {
    const { error } = await supabase.from('dishes').update(dishRow).eq('id', id)
    if (error) return { data: null, error: error.message }
  }

  // Replace variants
  const { error: delVarErr } = await supabase.from('dish_variants').delete().eq('dish_id', id)
  if (delVarErr) return { data: null, error: delVarErr.message }

  if (input.variants.length > 0) {
    const variantRows = input.variants.map((v, i) => ({
      id: v.id ?? makeVariantId(id),
      dish_id: id,
      label_el: v.labelEl,
      label_en: v.labelEn || null,
      price: Math.round(v.price),
      calories: Math.round(v.calories),
      protein: Math.round(v.protein),
      carbs: Math.round(v.carbs),
      fat: Math.round(v.fat),
      sort_order: i,
    }))
    const { error: insVarErr } = await supabase.from('dish_variants').insert(variantRows)
    if (insVarErr) return { data: null, error: insVarErr.message }
  }

  // Replace tag associations
  const { error: delTagErr } = await supabase.from('dish_tags').delete().eq('dish_id', id)
  if (delTagErr) return { data: null, error: delTagErr.message }

  if (input.tagIds.length > 0) {
    const tagRows = input.tagIds.map((tid) => ({ dish_id: id, tag_id: tid }))
    const { error: insTagErr } = await supabase.from('dish_tags').insert(tagRows)
    if (insTagErr) return { data: null, error: insTagErr.message }
  }

  return { data: { id }, error: null }
}

export async function deleteDish(id: string): Promise<{ error: string | null }> {
  // Foreign keys with cascade will clean variants + dish_tags; order_items retain their snapshot fields.
  const { error } = await supabase.from('dishes').delete().eq('id', id)
  return { error: error?.message ?? null }
}

export async function toggleDishActive(id: string, active: boolean): Promise<{ error: string | null }> {
  const { error } = await supabase.from('dishes').update({ active, updated_at: new Date().toISOString() }).eq('id', id)
  return { error: error?.message ?? null }
}

// ─── Categories ───────────────────────────────────────────────────────────

export async function saveCategory(c: { id?: string; nameEl: string; nameEn: string; sortOrder: number; active: boolean }): Promise<{ error: string | null }> {
  const row = {
    id: c.id ?? makeCategoryId(c.nameEn || c.nameEl),
    name_el: c.nameEl, name_en: c.nameEn,
    sort_order: c.sortOrder, active: c.active,
  }
  if (c.id) {
    const { error } = await supabase.from('categories').update(row).eq('id', c.id)
    return { error: error?.message ?? null }
  }
  const { error } = await supabase.from('categories').insert(row)
  return { error: error?.message ?? null }
}

export async function deleteCategory(id: string): Promise<{ error: string | null }> {
  // Check for referencing dishes first — cleaner UX than a cryptic FK error
  const { count, error: cntErr } = await supabase
    .from('dishes')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', id)
  if (cntErr) return { error: cntErr.message }
  if ((count ?? 0) > 0) {
    return { error: `Cannot delete — ${count} dish${count === 1 ? '' : 'es'} still use this category.` }
  }
  const { error } = await supabase.from('categories').delete().eq('id', id)
  return { error: error?.message ?? null }
}

// ─── Tags ─────────────────────────────────────────────────────────────────

export async function saveTag(t: { id?: string; labelEl: string; labelEn: string; bgColor: string; fontColor: string; sortOrder: number }): Promise<{ error: string | null }> {
  const row = {
    id: t.id ?? makeTagId(t.labelEn || t.labelEl),
    label_el: t.labelEl, label_en: t.labelEn,
    bg_color: t.bgColor, font_color: t.fontColor,
    sort_order: t.sortOrder,
  }
  if (t.id) {
    const { error } = await supabase.from('tags').update(row).eq('id', t.id)
    return { error: error?.message ?? null }
  }
  const { error } = await supabase.from('tags').insert(row)
  return { error: error?.message ?? null }
}

export async function deleteTag(id: string): Promise<{ error: string | null }> {
  // dish_tags row deletions cascade (if FK is ON DELETE CASCADE); if not, clean them up first.
  await supabase.from('dish_tags').delete().eq('tag_id', id)
  const { error } = await supabase.from('tags').delete().eq('id', id)
  return { error: error?.message ?? null }
}

// ─── Image upload ─────────────────────────────────────────────────────────

export async function uploadDishImage(file: File, dishId: string): Promise<{ url: string | null; error: string | null }> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${dishId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('dish-images').upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type,
  })
  if (error) return { url: null, error: error.message }
  const { data } = supabase.storage.from('dish-images').getPublicUrl(path)
  return { url: data.publicUrl, error: null }
}
