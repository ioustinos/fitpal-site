import type { CSSProperties } from 'react'

/**
 * Address-recognition icon pool. Each one is a small inline SVG matching
 * the rest of the customer UI's vibe (24x24 viewBox, 2px round stroke,
 * currentColor). The picker UI shows icons only — the EL/EN labels in
 * ADDRESS_ICON_OPTIONS exist for `aria-label` / tooltip use, never
 * rendered as visible text.
 */

export type AddressIconName =
  // Home variants
  | 'home' | 'home-modern' | 'apartment' | 'condo'
  // Work / education
  | 'work' | 'office' | 'school' | 'university'
  // People-tied
  | 'parents' | 'grandparents' | 'partner' | 'kid' | 'baby' | 'roommate'
  // Travel / temporary
  | 'hotel' | 'holiday-home' | 'airbnb'
  // Activity / lifestyle
  | 'gym' | 'yoga' | 'garden' | 'pets'
  // Generic moods + objects
  | 'heart' | 'heart-filled' | 'thumbs-up' | 'star'
  | 'lightning' | 'party' | 'gift' | 'coffee'
  | 'notebook' | 'laptop' | 'book' | 'music'
  | 'sun' | 'moon' | 'plane' | 'beach'
  // Other
  | 'hospital' | 'restaurant' | 'pin'

interface Props {
  name: AddressIconName
  size?: number
  style?: CSSProperties
}

export function AddressIcon({ name, size = 18, style }: Props) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style,
  }
  switch (name) {
    // ── HOME ───────────────────────────────────────────────────────────
    case 'home':
      return (<svg {...p}><path d="M3 11l9-8 9 8v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/></svg>)
    case 'home-modern':
      return (<svg {...p}><path d="M3 12l9-7 9 7v9a1 1 0 01-1 1H4a1 1 0 01-1-1z"/><path d="M9 22v-7h6v7"/></svg>)
    case 'apartment':
      return (<svg {...p}><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/><path d="M10 21v-3h4v3"/></svg>)
    case 'condo':
      return (<svg {...p}><path d="M3 21V10l5-3 5 3v11"/><path d="M13 21v-7l4-2 4 2v7"/></svg>)

    // ── WORK / EDUCATION ──────────────────────────────────────────────
    case 'work':
      return (<svg {...p}><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/><line x1="3" y1="13" x2="21" y2="13"/></svg>)
    case 'office':
      return (<svg {...p}><rect x="5" y="3" width="14" height="18" rx="1"/><line x1="9" y1="7" x2="9.01" y2="7"/><line x1="13" y1="7" x2="13.01" y2="7"/><line x1="9" y1="11" x2="9.01" y2="11"/><line x1="13" y1="11" x2="13.01" y2="11"/><path d="M11 21v-4h2v4"/></svg>)
    case 'school':
      return (<svg {...p}><path d="M3 21h18"/><path d="M5 21V8l7-4 7 4v13"/><path d="M9 21v-6h6v6"/><line x1="12" y1="4" x2="12" y2="2"/></svg>)
    case 'university':
      return (<svg {...p}><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/></svg>)

    // ── PEOPLE-TIED ───────────────────────────────────────────────────
    case 'parents':
      return (<svg {...p}><circle cx="9" cy="7" r="3"/><circle cx="17" cy="7" r="2.5"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M15 21v-2a3 3 0 013-3h1a3 3 0 013 3v2"/></svg>)
    case 'grandparents':
      return (<svg {...p}><circle cx="8" cy="7" r="3"/><circle cx="16" cy="7" r="3"/><path d="M3 21v-2a3 3 0 013-3h4a3 3 0 013 3v2M11 21v-2a3 3 0 013-3h4a3 3 0 013 3v2"/></svg>)
    case 'partner':
      return (<svg {...p}><circle cx="9" cy="8" r="3"/><circle cx="15" cy="8" r="3"/><path d="M3 21v-1a4 4 0 014-4h10a4 4 0 014 4v1"/><path d="M12 13l-1.2-1.2a1 1 0 011.2-1.5 1 1 0 011.2 1.5z" fill="currentColor"/></svg>)
    case 'kid':
      return (<svg {...p}><circle cx="12" cy="7" r="3"/><path d="M8 21v-5a4 4 0 018 0v5"/><line x1="10" y1="17" x2="10" y2="21"/><line x1="14" y1="17" x2="14" y2="21"/></svg>)
    case 'baby':
      return (<svg {...p}><circle cx="12" cy="9" r="5"/><path d="M9 11s1 1.5 3 1.5S15 11 15 11"/><circle cx="9.5" cy="8" r="0.5" fill="currentColor"/><circle cx="14.5" cy="8" r="0.5" fill="currentColor"/><path d="M10 16v5M14 16v5"/></svg>)
    case 'roommate':
      return (<svg {...p}><circle cx="9" cy="9" r="3"/><circle cx="15" cy="9" r="3"/><path d="M3 21v-1a5 5 0 0110 0v1M11 21v-1a5 5 0 0110 0v1"/></svg>)

    // ── TRAVEL / TEMPORARY ────────────────────────────────────────────
    case 'hotel':
      return (<svg {...p}><path d="M2 18V8h20v10"/><path d="M2 18h20"/><path d="M2 14h20"/><circle cx="7" cy="11" r="2"/><path d="M11 14V11h7"/></svg>)
    case 'holiday-home':
      return (<svg {...p}><path d="M5 21V12l5-4 5 4v9"/><path d="M9 21v-5h2v5"/><path d="M16 4l4 4-3 1 2 3-4-1-1 4-1-4-2 1 1-3-3-1z"/></svg>)
    case 'airbnb':
      return (<svg {...p}><rect x="4" y="8" width="16" height="12" rx="1"/><path d="M9 8V5a2 2 0 014 0v3"/><line x1="12" y1="11" x2="12" y2="17"/></svg>)

    // ── ACTIVITY / LIFESTYLE ──────────────────────────────────────────
    case 'gym':
      return (<svg {...p}><line x1="6" y1="9" x2="6" y2="15"/><line x1="18" y1="9" x2="18" y2="15"/><line x1="3" y1="11" x2="3" y2="13"/><line x1="21" y1="11" x2="21" y2="13"/><line x1="6" y1="12" x2="18" y2="12"/></svg>)
    case 'yoga':
      return (<svg {...p}><circle cx="12" cy="5" r="2"/><path d="M12 7v6"/><path d="M6 11l6 2 6-2"/><path d="M9 21l3-8 3 8"/></svg>)
    case 'garden':
      return (<svg {...p}><path d="M12 21V11"/><path d="M12 11c0-3 2-5 5-5 0 3-2 5-5 5z"/><path d="M12 14c0-3-2-5-5-5 0 3 2 5 5 5z"/><path d="M7 21h10"/></svg>)
    case 'pets':
      return (<svg {...p}><circle cx="6" cy="10" r="1.5"/><circle cx="10" cy="6" r="1.5"/><circle cx="14" cy="6" r="1.5"/><circle cx="18" cy="10" r="1.5"/><path d="M8 17a4 4 0 018 0c0 2-2 3-4 3s-4-1-4-3z"/></svg>)

    // ── GENERICS — moods & objects ────────────────────────────────────
    case 'heart':
      return (<svg {...p}><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>)
    case 'heart-filled':
      return (<svg {...p}><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" fill="currentColor"/></svg>)
    case 'thumbs-up':
      return (<svg {...p}><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3z"/><line x1="7" y1="22" x2="7" y2="11"/><path d="M3 22h4V11H3z"/></svg>)
    case 'star':
      return (<svg {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>)
    case 'lightning':
      return (<svg {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>)
    case 'party':                // party popper / confetti
      return (<svg {...p}><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01M22 8h.01M15 2h.01M22 20h.01M22 2L15 13l4 4 7-7"/><path d="M16.5 6 11 11.5"/><path d="M22 22l-2-2-7-3 9-2z"/></svg>)
    case 'gift':
      return (<svg {...p}><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>)
    case 'coffee':
      return (<svg {...p}><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4z"/><line x1="6" y1="2" x2="6" y2="5"/><line x1="10" y1="2" x2="10" y2="5"/><line x1="14" y1="2" x2="14" y2="5"/></svg>)
    case 'notebook':
      return (<svg {...p}><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><line x1="9" y1="6" x2="15" y2="6"/></svg>)
    case 'laptop':
      return (<svg {...p}><rect x="3" y="4" width="18" height="12" rx="2"/><line x1="2" y1="20" x2="22" y2="20"/></svg>)
    case 'book':
      return (<svg {...p}><path d="M4 19.5A2.5 2.5 0 016.5 17H20V2H6.5A2.5 2.5 0 004 4.5v15z"/><path d="M4 19.5A2.5 2.5 0 016.5 22H20"/></svg>)
    case 'music':
      return (<svg {...p}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>)
    case 'sun':
      return (<svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>)
    case 'moon':
      return (<svg {...p}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>)
    case 'plane':
      return (<svg {...p}><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>)
    case 'beach':                // umbrella + sand
      return (<svg {...p}><path d="M12 3v18"/><path d="M3 14a9 9 0 0118 0z"/><path d="M3 21h18"/></svg>)

    // ── OTHER ─────────────────────────────────────────────────────────
    case 'hospital':
      return (<svg {...p}><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/></svg>)
    case 'restaurant':
      return (<svg {...p}><path d="M7 3v6a2 2 0 002 2v10"/><path d="M11 3v8"/><path d="M17 3c-2 0-3 2-3 4v4h2v10"/></svg>)
    case 'pin':
      return (<svg {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>)
  }
}

/**
 * Picker order. Labels are screen-reader / tooltip only — never rendered
 * as visible text in the picker. Adjust freely without breaking anything.
 */
export const ADDRESS_ICON_OPTIONS: { name: AddressIconName; labelEl: string; labelEn: string }[] = [
  // Top — most-used home/work first
  { name: 'home',          labelEl: 'Σπίτι',          labelEn: 'Home' },
  { name: 'work',          labelEl: 'Δουλειά',        labelEn: 'Work' },
  { name: 'apartment',     labelEl: 'Διαμέρισμα',     labelEn: 'Apartment' },
  { name: 'office',        labelEl: 'Γραφείο',        labelEn: 'Office' },
  // People
  { name: 'parents',       labelEl: 'Γονείς',         labelEn: 'Parents' },
  { name: 'partner',       labelEl: 'Σύντροφος',      labelEn: 'Partner' },
  { name: 'grandparents',  labelEl: 'Παππούδες',      labelEn: 'Grandparents' },
  { name: 'kid',           labelEl: 'Παιδί',           labelEn: 'Kid' },
  { name: 'baby',          labelEl: 'Μωρό',            labelEn: 'Baby' },
  { name: 'roommate',      labelEl: 'Συγκάτοικος',    labelEn: 'Roommate' },
  // Activity / education
  { name: 'gym',           labelEl: 'Γυμναστήριο',    labelEn: 'Gym' },
  { name: 'yoga',          labelEl: 'Yoga',            labelEn: 'Yoga' },
  { name: 'school',        labelEl: 'Σχολείο',        labelEn: 'School' },
  { name: 'university',    labelEl: 'Πανεπιστήμιο',   labelEn: 'University' },
  // Travel
  { name: 'holiday-home',  labelEl: 'Εξοχικό',         labelEn: 'Holiday home' },
  { name: 'hotel',         labelEl: 'Ξενοδοχείο',     labelEn: 'Hotel' },
  { name: 'airbnb',        labelEl: 'Ενοικιαζόμενο',  labelEn: 'Rental' },
  { name: 'plane',         labelEl: 'Ταξίδι',          labelEn: 'Trip' },
  { name: 'beach',         labelEl: 'Παραλία',        labelEn: 'Beach' },
  // Lifestyle / mood
  { name: 'heart',         labelEl: 'Καρδιά',         labelEn: 'Heart' },
  { name: 'heart-filled',  labelEl: 'Καρδιά γεμάτη',  labelEn: 'Heart filled' },
  { name: 'thumbs-up',     labelEl: 'Like',            labelEn: 'Thumbs up' },
  { name: 'star',          labelEl: 'Αστέρι',         labelEn: 'Star' },
  { name: 'party',         labelEl: 'Πάρτι',           labelEn: 'Party' },
  { name: 'gift',          labelEl: 'Δώρο',            labelEn: 'Gift' },
  { name: 'lightning',     labelEl: 'Αστραπή',        labelEn: 'Lightning' },
  { name: 'sun',           labelEl: 'Ήλιος',           labelEn: 'Sun' },
  { name: 'moon',          labelEl: 'Φεγγάρι',         labelEn: 'Moon' },
  // Objects
  { name: 'coffee',        labelEl: 'Καφές',           labelEn: 'Coffee' },
  { name: 'laptop',        labelEl: 'Laptop',          labelEn: 'Laptop' },
  { name: 'notebook',      labelEl: 'Σημειωματάριο',  labelEn: 'Notebook' },
  { name: 'book',          labelEl: 'Βιβλίο',          labelEn: 'Book' },
  { name: 'music',         labelEl: 'Μουσική',        labelEn: 'Music' },
  { name: 'garden',        labelEl: 'Κήπος',           labelEn: 'Garden' },
  { name: 'pets',          labelEl: 'Κατοικίδια',     labelEn: 'Pets' },
  { name: 'restaurant',    labelEl: 'Εστιατόριο',     labelEn: 'Restaurant' },
  // Variants kept for completeness
  { name: 'home-modern',   labelEl: 'Σπίτι μοντέρνο', labelEn: 'House (modern)' },
  { name: 'condo',         labelEl: 'Μεζονέτα',       labelEn: 'Condo' },
  { name: 'hospital',      labelEl: 'Νοσοκομείο',     labelEn: 'Hospital' },
  // Always-keep fallback
  { name: 'pin',           labelEl: 'Άλλο',            labelEn: 'Other' },
]
