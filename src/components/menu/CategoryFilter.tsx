import { useUIStore } from '../../store/useUIStore'
import { CATS } from '../../data/menu'
import { makeTr } from '../../lib/translations'

export function CategoryFilter() {
  const lang = useUIStore((s) => s.lang)
  const activeCat = useUIStore((s) => s.activeCat)
  const setActiveCat = useUIStore((s) => s.setActiveCat)
  const t = makeTr(lang)

  return (
    <div className="cat-pills">
      <button
        className={`cat-pill${activeCat === null ? ' active' : ''}`}
        onClick={() => setActiveCat(null)}
      >
        {t('allCategories')}
      </button>
      {CATS.map((cat) => (
        <button
          key={cat.id}
          className={`cat-pill${activeCat === cat.id ? ' active' : ''}`}
          onClick={() => setActiveCat(cat.id)}
        >
          {lang === 'el' ? cat.labelEl : cat.labelEn}
        </button>
      ))}
    </div>
  )
}
