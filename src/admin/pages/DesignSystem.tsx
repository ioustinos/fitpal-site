/**
 * Fitpal Design System — single-page reference for everyone touching the UI.
 *
 * Audit-mode + document-mode hybrid: shows the LIVE tokens and components
 * (not just descriptions) so designers, developers, and external collaborators
 * can see exactly what's in the system and copy values/classes without
 * digging through the codebase.
 *
 * Two design "eras" coexist in the codebase and both are documented here:
 *   - **Legacy palette** (`--green-*`, `--cream-*`) — Nunito-based, used by
 *     the customer site and the menu/checkout/account flows.
 *   - **Wallet v2 palette** (`--fp-*`) — Plus Jakarta Sans, used by the new
 *     WalletPage and design-handoff target for upcoming refactors.
 *
 * The wallet-v2 palette is the direction we're moving in. Treat the legacy
 * tokens as "still supported, do not extend" — when building new surfaces,
 * adopt --fp-* unless you're patching an existing legacy page.
 */

import { useState } from 'react'
import { MealIcon } from '../../components/icons/MealIcon'
import { GoalCardArt } from '../../components/icons/GoalIllustration'

type Section =
  | 'brand'
  | 'colors'
  | 'typography'
  | 'spacing'
  | 'buttons'
  | 'forms'
  | 'cards'
  | 'pills'
  | 'icons'
  | 'goals'
  | 'patterns'
  | 'rules'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'brand',      label: 'Brand identity' },
  { id: 'colors',     label: 'Color tokens' },
  { id: 'typography', label: 'Typography' },
  { id: 'spacing',    label: 'Radii & shadows' },
  { id: 'buttons',    label: 'Buttons' },
  { id: 'forms',      label: 'Form controls' },
  { id: 'cards',      label: 'Cards & surfaces' },
  { id: 'pills',      label: 'Status pills' },
  { id: 'icons',      label: 'Meal icons' },
  { id: 'goals',      label: 'Goal illustrations' },
  { id: 'patterns',   label: 'Common patterns' },
  { id: 'rules',      label: 'Usage rules' },
]

export function DesignSystem() {
  const [section, setSection] = useState<Section>('brand')

  return (
    <div className="admin-page ds-page">
      <h1 className="admin-page-title">Fitpal Design System</h1>
      <p className="admin-page-sub">
        Living reference for every visual decision in the customer site, admin, and emails.
        Two palettes coexist — legacy (<code>--green-*</code>) for older flows, wallet-v2
        (<code>--fp-*</code>) for new surfaces. Prefer wallet-v2 going forward.
      </p>

      <div className="ds-layout">
        <nav className="ds-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`ds-nav-item${section === s.id ? ' active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="ds-content">
          {section === 'brand'      && <SectionBrand />}
          {section === 'colors'     && <SectionColors />}
          {section === 'typography' && <SectionTypography />}
          {section === 'spacing'    && <SectionSpacing />}
          {section === 'buttons'    && <SectionButtons />}
          {section === 'forms'      && <SectionForms />}
          {section === 'cards'      && <SectionCards />}
          {section === 'pills'      && <SectionPills />}
          {section === 'icons'      && <SectionIcons />}
          {section === 'goals'      && <SectionGoals />}
          {section === 'patterns'   && <SectionPatterns />}
          {section === 'rules'      && <SectionRules />}
        </div>
      </div>
    </div>
  )
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function Block({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="ds-block">
      <div className="ds-block-head">
        <h2>{title}</h2>
        {desc && <p>{desc}</p>}
      </div>
      <div className="ds-block-body">{children}</div>
    </section>
  )
}

function Swatch({ name, value, fg = '#1a2320' }: { name: string; value: string; fg?: string }) {
  return (
    <div className="ds-swatch">
      <div className="ds-swatch-color" style={{ background: value, color: fg }}>{value}</div>
      <div className="ds-swatch-meta">
        <code>{name}</code>
      </div>
    </div>
  )
}

/* ── Sections ─────────────────────────────────────────────────────── */

function SectionBrand() {
  return (
    <Block title="Brand identity" desc="The Fitpal mark and the two design eras the system spans.">
      <div className="ds-brand-row">
        <div className="ds-brand-mark">
          <div className="ds-logo-lockup">
            fit<span style={{ color: 'var(--green)' }}>pal</span>
          </div>
          <small>Legacy lockup · Nunito 900 weight</small>
        </div>
        <div className="ds-brand-mark ds-brand-mark-v2">
          <div className="ds-logo-lockup ds-logo-lockup-v2">
            fit<span style={{ color: '#7DFFBE' }}>pal</span>
          </div>
          <small>Wallet v2 lockup · Plus Jakarta Sans 800 on dark green</small>
        </div>
      </div>
      <p className="ds-note">
        Two visual eras coexist. When extending existing pages, match their lockup.
        When building new surfaces, prefer the wallet-v2 lockup (Plus Jakarta Sans,
        cream background, soft layered shadows) — that's where the system is heading.
      </p>
    </Block>
  )
}

function SectionColors() {
  return (
    <>
      <Block title="Wallet v2 palette (--fp-*)" desc="Use for any new surface. Already powers WalletPage, OrderReturn, and the wallet admin tabs.">
        <div className="ds-swatch-grid">
          <Swatch name="--fp-cream-100" value="#fdfbf5" />
          <Swatch name="--fp-cream-300" value="#faf6ed" />
          <Swatch name="--fp-cream-500" value="#f5efe4" />
          <Swatch name="--fp-paper"     value="#ffffff" />
          <Swatch name="--fp-green-50"  value="#f1faf4" />
          <Swatch name="--fp-green-100" value="#e3f3ea" />
          <Swatch name="--fp-green-300" value="#a8dcbf" />
          <Swatch name="--fp-green-500" value="#46b57a" fg="#ffffff" />
          <Swatch name="--fp-green-600" value="#2a8a5f" fg="#ffffff" />
          <Swatch name="--fp-green-700" value="#1e6b4a" fg="#ffffff" />
          <Swatch name="--fp-green-900" value="#0f3d2e" fg="#ffffff" />
          <Swatch name="--fp-ink-100"   value="#eef1ec" />
          <Swatch name="--fp-ink-200"   value="#dfe3df" />
          <Swatch name="--fp-ink-500"   value="#6b776f" fg="#ffffff" />
          <Swatch name="--fp-ink-700"   value="#39453f" fg="#ffffff" />
          <Swatch name="--fp-ink-900"   value="#1a2320" fg="#ffffff" />
          <Swatch name="--fp-accent-orange" value="#f08a3e" fg="#ffffff" />
          <Swatch name="--fp-accent-yellow" value="#f2c94c" />
        </div>
      </Block>

      <Block title="Legacy palette (--green-*, --cream-*)" desc="Used by the customer menu, checkout, account, and admin shell. Do not extend — patch in place only.">
        <div className="ds-swatch-grid">
          <Swatch name="--green"        value="#00B96B" fg="#ffffff" />
          <Swatch name="--green-dark"   value="#004739" fg="#ffffff" />
          <Swatch name="--green-mid"    value="#006647" fg="#ffffff" />
          <Swatch name="--green-light"  value="#D4F5E5" />
          <Swatch name="--green-pale"   value="#F0FAF5" />
          <Swatch name="--cream"        value="#FCF2D9" />
          <Swatch name="--cream-dark"   value="#F0E3C0" />
          <Swatch name="--cream-light"  value="#FFFDF5" />
          <Swatch name="--text"         value="#1C2B1C" fg="#ffffff" />
          <Swatch name="--text-mid"     value="#3D5A3D" fg="#ffffff" />
          <Swatch name="--text-muted"   value="#7A957A" fg="#ffffff" />
          <Swatch name="--border"       value="#E2EDE2" />
          <Swatch name="--lime"         value="#CFD72B" />
          <Swatch name="--warn"         value="#B45309" fg="#ffffff" />
          <Swatch name="--warn-bg"      value="#FDF0E2" />
        </div>
      </Block>
    </>
  )
}

function SectionTypography() {
  return (
    <Block title="Typography" desc="One brand type family site-wide — Geologica (SIL OFL, self-hosted, WEC-442).">
      <div className="ds-type-sample" style={{ fontFamily: "'Geologica', system-ui, sans-serif" }}>
        <h3>Geologica — brand font (Latin)</h3>
        <div style={{ fontSize: 32, fontWeight: 900 }}>The quick brown fox 32/900</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>The quick brown fox 22/800</div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>The quick brown fox 16/700</div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>The quick brown fox 13/600 — body copy</div>
      </div>
      <div className="ds-type-sample" style={{ fontFamily: "'Geologica', system-ui, sans-serif" }}>
        <h3>Geologica — Greek</h3>
        <div style={{ fontSize: 32, fontWeight: 900 }}>Φρέσκα γεύματα 32/900</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>Φρέσκα γεύματα 22/800</div>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Φρέσκα γεύματα 17/700</div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>Φρέσκα γεύματα 14/500 — σώμα κειμένου</div>
      </div>
      <p className="ds-note">
        Geologica ships 6 self-hosted weights (400–900), subset to Latin + Greek
        (~32&nbsp;KB each). It replaced Nunito and Plus Jakarta Sans in the brand
        refresh (WEC-439).
      </p>
    </Block>
  )
}

function SectionSpacing() {
  return (
    <Block title="Radii & shadows" desc="Two scales — match your palette choice.">
      <div className="ds-spacing-row">
        <div className="ds-spacing-sample" style={{ borderRadius: 5, background: 'var(--green-pale)' }}>5px · --radius-sm</div>
        <div className="ds-spacing-sample" style={{ borderRadius: 8, background: 'var(--green-pale)' }}>8px · --radius / --fp-radius-sm</div>
        <div className="ds-spacing-sample" style={{ borderRadius: 12, background: 'var(--green-pale)' }}>12px · --radius-lg</div>
        <div className="ds-spacing-sample" style={{ borderRadius: 14, background: '#faf6ed' }}>14px · --fp-radius</div>
        <div className="ds-spacing-sample" style={{ borderRadius: 20, background: '#faf6ed' }}>20px · --fp-radius-lg</div>
        <div className="ds-spacing-sample" style={{ borderRadius: 28, background: '#faf6ed' }}>28px · --fp-radius-xl</div>
      </div>
      <div className="ds-shadow-row">
        <div className="ds-shadow-sample" style={{ boxShadow: '0 1px 2px rgba(15,61,46,0.04), 0 1px 1px rgba(15,61,46,0.03)' }}>--fp-shadow-sm</div>
        <div className="ds-shadow-sample" style={{ boxShadow: '0 4px 16px rgba(15,61,46,0.06), 0 1px 2px rgba(15,61,46,0.04)' }}>--fp-shadow</div>
        <div className="ds-shadow-sample" style={{ boxShadow: '0 14px 40px rgba(15,61,46,0.10), 0 2px 6px rgba(15,61,46,0.05)' }}>--fp-shadow-lg</div>
      </div>
    </Block>
  )
}

function SectionButtons() {
  return (
    <Block title="Buttons" desc="Match the surface palette. Wallet-v2 buttons live on cream backgrounds; legacy buttons live on white or cream.">
      <h3>Wallet v2</h3>
      <div className="ds-btn-row">
        <button className="wpv2-h-cta">Primary CTA (dark)</button>
        <button className="wpv2-aside-cta" style={{ width: 'auto' }}>Sidebar CTA →</button>
        <button className="wpv2-signup-btn">Inline signup</button>
      </div>
      <h3>Legacy customer</h3>
      <div className="ds-btn-row">
        <button className="btn-auth" style={{ width: 'auto' }}>Auth submit</button>
        <button className="btn-conf-done">Confirmation done</button>
        <button className="btn-save-green">Save</button>
        <button className="btn-cancel">Cancel</button>
      </div>
      <h3>Admin</h3>
      <div className="ds-btn-row">
        <button className="admin-btn-primary">Primary</button>
        <button className="admin-btn-ghost">Ghost</button>
        <button className="admin-btn-danger">Danger</button>
      </div>
    </Block>
  )
}

function SectionForms() {
  return (
    <Block title="Form controls" desc="Inputs, selects, textareas, segmented controls, chips.">
      <h3>Wallet v2</h3>
      <div className="ds-form-row">
        <input className="wpv2-input" placeholder="Text input" />
        <div className="wpv2-seg">
          <button type="button" className="wpv2-seg-opt sel">Selected</button>
          <button type="button" className="wpv2-seg-opt">Option</button>
        </div>
      </div>
      <h3>Admin</h3>
      <div className="ds-form-row">
        <input className="admin-input" placeholder="Admin input" />
        <select className="admin-select">
          <option>Admin select</option>
        </select>
      </div>
      <h3>Legacy customer</h3>
      <div className="ds-form-row">
        <input className="form-input" placeholder="Legacy input" />
      </div>
    </Block>
  )
}

function SectionCards() {
  return (
    <Block title="Cards & surfaces" desc="Container chrome for each design era.">
      <div className="ds-card-row">
        <div className="ds-card-demo" style={{ background: '#fff', border: '1px solid #dfe3df', borderRadius: 20, padding: 20, boxShadow: '0 1px 2px rgba(15,61,46,0.04)' }}>
          <strong>Wallet v2 section card</strong>
          <p style={{ fontSize: 13, color: '#6b776f', margin: '6px 0 0' }}>White on cream, 20px radius, soft shadow.</p>
        </div>
        <div className="ds-card-demo" style={{ background: '#fff', border: '1.5px solid #E2EDE2', borderRadius: 8, padding: 20 }}>
          <strong>Legacy card</strong>
          <p style={{ fontSize: 13, color: '#7A957A', margin: '6px 0 0' }}>White, 8px radius, hairline border.</p>
        </div>
      </div>
    </Block>
  )
}

function SectionPills() {
  return (
    <Block title="Status pills" desc="Inline pills for status, badges, and chips.">
      <div className="ds-pill-row">
        <span className="admin-pill-pending">Pending</span>
        <span className="admin-pill-paid">Paid</span>
        <span className="admin-pill-failed">Failed</span>
        <span className="admin-pill-refunded">Refunded</span>
      </div>
      <p className="ds-note">
        Status pills use semantic color (orange = pending, green = success, red = failure, grey = neutral).
        Always pair with a textual label — never communicate state through color alone.
      </p>
    </Block>
  )
}

function SectionIcons() {
  const meals = ['breakfast', 'lunch', 'dinner', 'snack'] as const
  return (
    <Block title="Meal icons (linear, monochrome)" desc="Stroked SVG, single color via currentColor. Replaces emoji in production UI per the icon style rule.">
      <div className="ds-icon-grid">
        {meals.map((m) => (
          <div key={m} className="ds-icon-cell">
            <div className="ds-icon-display"><MealIcon meal={m} size={48} /></div>
            <code>{`<MealIcon meal="${m}" />`}</code>
          </div>
        ))}
      </div>
      <p className="ds-note">
        Icons inherit color via <code>currentColor</code> — wrap them in any text-colored
        element to theme them. Default stroke width 1.6, increase to 2 for hero usage.
      </p>
    </Block>
  )
}

function SectionGoals() {
  const goals = ['lose', 'maintain', 'gain'] as const
  return (
    <Block title="Goal illustrations (duo-chrome)" desc="Larger, richer than navigation icons. Two colors only — primary stroke + soft accent fill.">
      <div className="ds-goal-grid">
        {goals.map((g) => (
          <div key={g} className="ds-goal-cell">
            <GoalCardArt goal={g} />
            <div className="ds-goal-meta">
              <strong>{g[0].toUpperCase() + g.slice(1)}</strong>
              <code>{`<GoalCardArt goal="${g}" />`}</code>
            </div>
          </div>
        ))}
      </div>
    </Block>
  )
}

function SectionPatterns() {
  return (
    <Block title="Common patterns" desc="Compositions worth following.">
      <ul className="ds-pattern-list">
        <li><strong>Sticky right sidebar</strong> — used on WalletPage. Container is <code>position: sticky; top: 24px</code>, parent grid <code>grid-template-columns: minmax(0, 1fr) 380px</code>. Collapses to single column under 1024px.</li>
        <li><strong>Numbered section cards</strong> — used on WalletPage main column. <code>.wpv2-section</code> with <code>.wpv2-section-num</code> badge + <code>.wpv2-section-head</code>. Number badge is 26px circle in <code>--fp-green-100</code> with <code>--fp-green-700</code> text.</li>
        <li><strong>Image goal cards</strong> — large rounded cards with full-width art, body block, and corner checkmark. See WalletPage goal selection. Use <code>GoalCardArt</code> for art, <code>.wpv2-goal</code> for the card shell.</li>
        <li><strong>OTP entry</strong> — single 6-digit input with <code>autoComplete="one-time-code"</code>, <code>inputMode="numeric"</code>, and <code>maxLength={'{OTP_MAX_LENGTH}'}</code>. Sanitize on change with <code>{`replace(/\\D/g, '')`}</code>. Used in AuthModal and WalletPage signup.</li>
        <li><strong>Stat card</strong> — admin dashboard widgets. <code>&lt;StatCard title value hint accent="primary|warning|muted" /&gt;</code> from <code>src/admin/pages/Dashboard.tsx</code>. Color-coded by <code>accent</code>.</li>
      </ul>
    </Block>
  )
}

function SectionRules() {
  return (
    <Block title="Usage rules" desc="The opinionated bits — break them only with reason.">
      <h3>Icons</h3>
      <ul className="ds-rules">
        <li><strong>Linear only.</strong> Stroked outlines, never filled emoji.</li>
        <li><strong>Monochrome default; duo-chrome OK for hero illustrations.</strong> Never three or more colors in one mark.</li>
        <li><strong>No shading, gradients, 3D, drop shadows inside icons.</strong> Flat geometry only.</li>
        <li><strong>Scale-friendly.</strong> Use viewBox so the same source renders at 14px (inline) and 80px (hero).</li>
      </ul>
      <h3>Colors</h3>
      <ul className="ds-rules">
        <li><strong>Never hardcode hex.</strong> Use CSS vars from the relevant era's palette.</li>
        <li><strong>Communicate state with text + color, not color alone.</strong> WCAG and color-blind users.</li>
        <li><strong>Don't mix palettes on one surface.</strong> A page is either wallet-v2 (<code>--fp-*</code>) or legacy (<code>--green-*</code>) — not both.</li>
      </ul>
      <h3>Typography</h3>
      <ul className="ds-rules">
        <li>Don't introduce new font sizes — pick from the scale shown in Typography section.</li>
        <li>Greek copy first when translating; English second. The site's primary market is Greek.</li>
      </ul>
      <h3>Components</h3>
      <ul className="ds-rules">
        <li><strong>Reuse, don't reinvent.</strong> If you need a button/input/card, audit this page first.</li>
        <li><strong>Patch existing pages with their own era.</strong> Don't drop wallet-v2 buttons into legacy menu pages.</li>
        <li><strong>Document new patterns here.</strong> If you add a reusable component, add a section so the next person finds it.</li>
      </ul>
    </Block>
  )
}
