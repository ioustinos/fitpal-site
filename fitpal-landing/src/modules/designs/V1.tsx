/* ===========================================================
   DIRECTION A — "Fresh & Friendly"  (chosen direction, round 3)
   Full-width, interactive: count-up stats, rotating hero plate,
   cycling USP chip, scroll-follower, editorial team/B2B bands.
   =========================================================== */
import { FC, ReactNode, useEffect, useRef, useState } from 'react';
import { L, C } from './content';
import LangSwitch from './LangSwitch';
import FpIcon, { FpIconName } from './FpIcon';
import MenuSample from './MenuSample';
import Wave from './Wave';
import { ORDER_APP, ORDER_APP_SUBS } from './FpShell';
import SiteFooter from './SiteFooter';
import { useBodyLang } from './useBodyLang';
import './designSystem.scss';

import logoWordmark from 'app/assets/designs/logo-wordmark.svg';
import salmon from 'app/assets/designs/dishes/salmon.png';
import faba from 'app/assets/designs/dishes/faba.png';
import dishR03 from 'app/assets/designs/dishes/dish-r-03.png';
import dish05 from 'app/assets/designs/dishes/dish-05.png';
import salad from 'app/assets/designs/dishes/salad.png';

/* ---------- helpers ---------- */
function useInView(opts?: IntersectionObserverInit): [React.RefObject<HTMLElement | null>, boolean] {
  const ref = useRef<HTMLElement | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } });
    }, { threshold: 0.4, ...(opts || {}) });
    io.observe(el);
    const fallback = setTimeout(() => { setSeen(true); io.disconnect(); }, 1200);
    return () => { io.disconnect(); clearTimeout(fallback); };
  }, []);
  return [ref, seen];
}

interface CounterProps {
  to: number;
  suffix?: string;
  prefix?: string;
  dur?: number;
}
const Counter: FC<CounterProps> = ({ to, suffix = '', prefix = '', dur = 1500 }) => {
  const [ref, seen] = useInView();
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (document.body.classList.contains('fp-motion-off')) { setVal(to); return; }
    let raf: number;
    let start: number | undefined;
    const tick = (t: number) => {
      if (start == null) start = t;
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(eased * to));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, to, dur]);
  return <b ref={ref as React.RefObject<HTMLElement>}>{prefix}{val}{suffix}</b>;
};

interface IcoProps { d: string | string[]; }
const AIco: FC<IcoProps> = ({ d }) => (
  <svg viewBox="0 0 24 24" width={26} height={26} fill="none"
    stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {(Array.isArray(d) ? d : [d]).map((p, i) => <path key={i} d={p} />)}
  </svg>
);

/* ---------- interactive hero visual ---------- */
const HERO_DISHES = [salmon, faba, dishR03, dish05, salad];
type HeroSpecKey = 'calorie' | 'signed' | 'recipes' | 'chef' | 'macros';
const HERO_SPECS: Array<[HeroSpecKey, [string, string]]> = [
  ['calorie', ['Calorie-counted', 'Μετρημένες θερμίδες']],
  ['signed',  ['Dietitian-signed', 'Υπογραφή διατροφολόγου']],
  ['recipes', ['300+ recipes', '300+ συνταγές']],
  ['chef',    ['Chef-prepared', 'Μαγειρεμένο από σεφ']],
  ['macros',  ['Personalised macros', 'Προσωποποιημένα macros']],
];
const SPEC_ICON: Record<HeroSpecKey, string[]> = {
  calorie: ['M12 3a6 6 0 0 0-6 6c0 4 6 12 6 12s6-8 6-12a6 6 0 0 0-6-6Z', 'M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  signed:  ['M4 19l8-14 8 14', 'M8.5 13h7'],
  recipes: ['M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z', 'M9 8h6M9 12h6'],
  chef:    ['M7 14h10v5a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-5Z', 'M7 14a3.5 3.5 0 1 1 1.5-6.7 3.3 3.3 0 0 1 6.1 0A3.5 3.5 0 1 1 17 14'],
  macros:  ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 12V3', 'M12 12l7 4'],
};

const HeroVisual: FC = () => {
  const [dish, setDish] = useState(0);
  const [spec, setSpec] = useState(0);
  useEffect(() => {
    const motionOff = () => document.body.classList.contains('fp-motion-off');
    const d = setInterval(() => { if (!motionOff()) setDish((i) => (i + 1) % HERO_DISHES.length); }, 3600);
    const s = setInterval(() => { if (!motionOff()) setSpec((i) => (i + 1) % HERO_SPECS.length); }, 2400);
    return () => { clearInterval(d); clearInterval(s); };
  }, []);
  const nextDish = () => setDish((i) => (i + 1) % HERO_DISHES.length);
  return (
    <div className="a-hero-vis">
      <div className="a-disc"></div>
      <button className="a-plate-btn" type="button" onClick={nextDish} aria-label="next dish">
        {HERO_DISHES.map((src, i) => (
          <img key={src} className={'a-plate' + (i === dish ? ' on' : '')} src={src} alt="" />
        ))}
        <span className="a-plate-hint"><AIco d={['M21 2v6h-6', 'M3 12a9 9 0 0 1 15-6.7L21 8', 'M3 22v-6h6', 'M21 12a9 9 0 0 1-15 6.7L3 16']} /></span>
      </button>
      {/* cycling USP chip — key forces remount for re-animation */}
      <div className="a-spec" key={spec}>
        <span className="a-spec-ic"><AIco d={SPEC_ICON[HERO_SPECS[spec][0]]} /></span>
        {L(...HERO_SPECS[spec][1])}
      </div>
      {/* macro + kcal chips */}
      <div className="a-chip c-kcal"><b>520</b><span>kcal</span></div>
      <div className="a-chip c-pro"><b>42g</b><span>{L('protein', 'πρωτεΐνη')}</span></div>
      <div className="a-chip c-carb"><b>38g</b><span>{L('carbs', 'υδατ.')}</span></div>
      <div className="a-chip c-fat"><b>18g</b><span>{L('fat', 'λιπαρά')}</span></div>
      {/* dish dots */}
      <div className="a-plate-dots">
        {HERO_DISHES.map((_, i) => (
          <button key={i} type="button" aria-label={'dish ' + (i + 1)}
            className={'a-pd' + (i === dish ? ' on' : '')} onClick={() => setDish(i)}></button>
        ))}
      </div>
    </div>
  );
};

/* ---------- scroll-following element ---------- */
const SECTIONS: Array<[string, [string, string]]> = [
  ['hero',  ['Top', 'Αρχή']],
  ['diff',  ['Why Fitpal', 'Γιατί Fitpal']],
  ['comp',  ['Plans vs A La Carte', 'Πλάνα vs A La Carte']],
  ['menu',  ['The menu', 'Το μενού']],
  ['how',   ['How it works', 'Πώς δουλεύει']],
  ['team',  ['Our team', 'Η ομάδα μας']],
  ['tst',   ['Reviews', 'Κριτικές']],
  ['b2b',   ['For business', 'Για επιχειρήσεις']],
  ['nl',    ['Get -15%', 'Πάρε -15%']],
];

const ScrollFollower: FC = () => {
  const [progress, setProgress] = useState(0);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setProgress(max > 0 ? h.scrollTop / max : 0);
      let cur = 0;
      SECTIONS.forEach((s, i) => {
        const el = document.getElementById('a-sec-' + s[0]);
        if (el && el.getBoundingClientRect().top <= h.clientHeight * 0.45) cur = i;
      });
      setIdx(cur);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const atEnd = idx >= SECTIONS.length - 1;
  const go = () => {
    if (atEnd) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const next = document.getElementById('a-sec-' + SECTIONS[idx + 1][0]);
    if (next) next.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const R = 26;
  const CIRC = 2 * Math.PI * R;
  return (
    <button className="a-follow" type="button" onClick={go} aria-label="next section">
      <svg className="a-follow-ring" viewBox="0 0 60 60" width={60} height={60}>
        <circle cx="30" cy="30" r={R} fill="none" stroke="rgba(0,71,57,.14)" strokeWidth={4} />
        <circle cx="30" cy="30" r={R} fill="none" stroke="var(--green)" strokeWidth={4} strokeLinecap="round"
          strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - progress)} transform="rotate(-90 30 30)" />
      </svg>
      <span className="a-follow-ic">
        {atEnd
          ? <AIco d={['M12 19V5', 'M5 12l7-7 7 7']} />
          : <AIco d={['M12 5v14', 'M5 12l7 7 7-7']} />}
      </span>
      <span className="a-follow-lbl">
        <small>{atEnd ? L('Back to', 'Επιστροφή') : L('Next', 'Επόμενο')}</small>
        {L(...(atEnd ? ['top', 'στην αρχή'] as [string, string] : SECTIONS[idx + 1][1]))}
      </span>
    </button>
  );
};

/* TEMP stock imagery (placeholders for handoff — swap for real brand photos) */
const TEAM_PHOTO = 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=900&q=80&auto=format&fit=crop';
const TST_AVATARS = [
  'https://i.pravatar.cc/160?img=45',
  'https://i.pravatar.cc/160?img=13',
  'https://i.pravatar.cc/160?img=49',
];

/* Welcome-discount coupon — click the -15% pill to copy to clipboard.
   Marketing can swap this code; nothing else references it. */
const WELCOME_CODE = 'WELCOME15';

const OfferPill: FC = () => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(WELCOME_CODE);
    } catch {
      // fallback for browsers without clipboard API access
      try {
        const ta = document.createElement('textarea');
        ta.value = WELCOME_CODE;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {}
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };
  return (
    <button
      type="button"
      className={'a-offer-inline' + (copied ? ' a-offer-inline--copied' : '')}
      onClick={handleCopy}
      aria-live="polite"
    >
      {copied ? (
        <>
          <AIco d={['M20 6L9 17l-5-5']} />
          {L(
            <>Code <strong>{WELCOME_CODE}</strong> copied!</>,
            <>Ο κωδικός <strong>{WELCOME_CODE}</strong> αντιγράφθηκε!</>
          )}
        </>
      ) : (
        <>
          <AIco d={['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11']} />
          {L(...C.offer_15)}
          <span className="a-offer-tap">{L('— tap to copy', '— πάτα για αντιγραφή')}</span>
        </>
      )}
    </button>
  );
};

const Header: FC = () => {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <header className="a-hdr">
      <div className="a-hdr-in">
        <img className="a-logo" src={logoWordmark} alt="Fitpal Meals" />
        <nav className="a-nav">
          <a href="/subscriptions">{L(...C.nav_subs)}</a>
          <a href="/a-la-carte">{L(...C.nav_ala)}</a>
          <a href="/b2b">{L(...C.nav_b2b)}</a>
          <a href="/about">{L(...C.nav_team)}</a>
        </nav>
        <div className="a-hdr-cta">
          <a className="a-hdr-phone" href="tel:+302104253929" aria-label="Καλέστε μας">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <span>+30 210 425 3929</span>
          </a>
          <a className="a-hdr-wa" href="https://wa.me/306937109396" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </a>
          <LangSwitch inline />
          {/* WEC-560: accounts live only on the ordering site — single order CTA. */}
          <a className="btn btn-primary a-start" href={ORDER_APP}>{L('Build your plan', 'Φτιάξε το πλάνο σου')}</a>
        </div>
        <button
          className="a-burger"
          type="button"
          aria-label="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open
            ? <AIco d={['M6 6l12 12', 'M6 18L18 6']} />
            : <AIco d={['M4 7h16', 'M4 12h16', 'M4 17h16']} />}
        </button>
      </div>
      <div className={'a-mobile-menu' + (open ? ' open' : '')}>
        <a href="/subscriptions" onClick={close}>{L(...C.nav_subs)}</a>
        <a href="/a-la-carte" onClick={close}>{L(...C.nav_ala)}</a>
        <a href="/b2b" onClick={close}>{L(...C.nav_b2b)}</a>
        <a href="/about" onClick={close}>{L(...C.nav_team)}</a>
        <div className="a-mobile-lang"><LangSwitch inline /></div>
        <div className="a-mobile-contact">
          <a href="tel:+302104253929" className="a-mobile-row">+30 210 425 3929</a>
          <a href="https://wa.me/306937109396" target="_blank" rel="noopener noreferrer" className="a-mobile-row">WhatsApp</a>
        </div>
        <div className="a-mobile-cta">
          {/* WEC-560: no Login/Register on the landing — single order CTA. */}
          <a className="btn btn-primary" href={ORDER_APP} onClick={close}>{L('Build your plan', 'Φτιάξε το πλάνο σου')}</a>
        </div>
      </div>
    </header>
  );
};

const V1: FC = () => {
  // Mobile: prevent horizontal scroll caused by absolutely-positioned hero blobs/chips.
  // Applied at body level (not on .dir-a) so position: sticky on the header keeps working.
  useEffect(() => {
    document.body.classList.add('fp-no-x-scroll');
    return () => { document.body.classList.remove('fp-no-x-scroll'); };
  }, []);
  const lang = useBodyLang();

  return (
  <div className="fp dir-a">
    <style>{`
      .dir-a { background: var(--cream-light); }
      .dir-a .wrap { max-width: 1440px; padding: 0 64px; margin: 0 auto; }
      .dir-a .a-hdr { position: sticky; top: 0; z-index: 40; background: rgba(255,251,239,.86); backdrop-filter: blur(10px);
        border-bottom: 1px solid var(--sand-line); }
      .dir-a .a-hdr-in { max-width: 1440px; margin: 0 auto; display: flex; align-items: center; gap: 32px; padding: 16px 64px; }
      .dir-a .a-logo { height: 30px; }
      .dir-a .a-nav { display: flex; gap: 28px; margin-left: 10px; flex: none; }
      .dir-a .a-nav a { font-weight: 600; font-size: 16px; color: var(--ink-70); position: relative; white-space: nowrap; }
      .dir-a .a-nav a::after { content: ""; position: absolute; left: 0; bottom: -4px; width: 100%; height: 2px;
        background: var(--green); border-radius: 2px; transform: scaleX(0); transform-origin: left; transition: transform .22s ease; }
      .dir-a .a-nav a:hover { color: var(--green-dark); }
      .dir-a .a-nav a:hover::after { transform: scaleX(1); }
      .dir-a .a-hdr-cta { margin-left: auto; display: flex; align-items: center; gap: 18px; }
      .dir-a .a-hdr-phone { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; color: var(--green-dark); font-size: 15px; white-space: nowrap; }
      .dir-a .a-hdr-phone:hover { color: var(--green); }
      .dir-a .a-hdr-wa { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px;
        border-radius: 12px; color: var(--green-dark); transition: background .15s ease, color .15s ease; }
      .dir-a .a-hdr-wa:hover { background: rgba(0, 124, 89, .08); color: var(--green); }
      .dir-a .a-login { font-weight: 700; color: var(--green-dark); font-size: 16px; }
      .dir-a .a-login:hover { color: var(--green); }
      .dir-a .a-start { padding: 12px 22px; font-size: 16px; }
      .dir-a .a-mobile-contact { display: flex; flex-direction: column; gap: 4px; padding: 10px 0 4px; }
      .dir-a .a-mobile-row { color: var(--green-dark); font-weight: 600; font-size: 16px; padding: 6px 0; }
      /* Burger default: hidden on full desktop. Declared BEFORE the media queries
         below so equal-specificity media-query overrides actually win at source order. */
      .dir-a .a-burger { display: none; width: 46px; height: 46px; border: 1px solid var(--sand-line);
        background: #fff; border-radius: 13px; color: var(--green-dark); place-items: center; cursor: pointer; margin-left: auto; }
      .dir-a .a-burger svg { width: 24px; height: 24px; }
      .dir-a .a-mobile-menu { display: none; }

      /* Intermediate desktop 1121–1199: hide phone-number text (icon stays clickable). */
      @media (max-width: 1199px) and (min-width: 1121px) {
        .dir-a .a-hdr-phone span { display: none; }
        .dir-a .a-hdr-phone { padding: 8px; border-radius: 11px; }
      }
      /* Header-only collapse — burger menu kicks in earlier (≤1120px) than the
         content tablet breakpoint (≤1024) because the new cluster has phone + WA +
         lang + login + signup and can't fit at intermediate desktop widths. */
      @media (max-width: 1120px) {
        .dir-a .a-nav, .dir-a .a-hdr-cta { display: none; }
        .dir-a .a-burger { display: grid; }
        .dir-a .a-mobile-menu { display: none; flex-direction: column; padding: 6px 24px 20px;
          background: var(--cream-light); border-bottom: 1px solid var(--sand-line); }
        .dir-a .a-mobile-menu.open { display: flex; animation: a-menu-in .22s ease; }
        .dir-a .a-hdr-in { gap: 12px; }
      }

      /* hero */
      .dir-a .a-hero { position: relative; overflow: hidden; padding: 60px 0 76px; }
      .dir-a .a-hero .wrap { display: grid; grid-template-columns: 1.02fr .98fr; gap: 48px; align-items: center; }
      .dir-a .a-blob { position: absolute; border-radius: 50% 50% 46% 54% / 54% 48% 52% 46%; z-index: 0; }
      .dir-a .a-blob1 { width: 760px; height: 760px; background: radial-gradient(circle at 35% 30%, #d6f3e2, #b9e8cf);
        right: -180px; top: -140px; opacity: .6; }
      .dir-a .a-blob2 { width: 260px; height: 260px; background: var(--cream); left: -90px; bottom: 20px; opacity: .9; }
      .dir-a .a-hero-copy { position: relative; z-index: 2; }
      .dir-a .a-h1 { font-size: clamp(46px, 4.4vw, 70px); color: var(--green-dark); }
      .dir-a .a-h1 em { font-style: normal; color: var(--green); }
      .dir-a .a-sub { font-size: 20px; color: var(--ink-70); margin-top: 20px; max-width: 30em; }
      .dir-a .a-cta-row { display: flex; align-items: center; gap: 16px; margin-top: 30px; flex-wrap: wrap; }
      .dir-a .a-offer-inline { display: inline-flex; align-items: center; gap: 8px; margin-top: 18px;
        background: rgba(245,181,63,.16); color: var(--amber-deep); border: 1px dashed var(--amber-deep);
        font-weight: 800; font-size: 14px; padding: 9px 16px; border-radius: var(--r-pill);
        font-family: var(--body); cursor: pointer; transition: background .15s, transform .12s, border-style .15s, color .15s; }
      .dir-a .a-offer-inline:hover { background: rgba(245,181,63,.28); transform: translateY(-1px); }
      .dir-a .a-offer-inline:active { transform: translateY(0); }
      .dir-a .a-offer-inline svg { width: 17px; height: 17px; }
      .dir-a .a-offer-inline strong { font-family: var(--body); font-weight: 800; letter-spacing: .02em; }
      .dir-a .a-offer-tap { font-weight: 600; font-size: 12px; opacity: .8; }
      .dir-a .a-offer-inline--copied { background: rgba(0,185,107,.16); color: var(--green-700); border-style: solid; border-color: var(--green); }
      .dir-a .a-trust { display: flex; gap: 36px; margin-top: 32px; }
      .dir-a .a-trust div { display: flex; flex-direction: column; }
      .dir-a .a-trust b { font-family: var(--display); font-size: 46px; color: var(--green-dark); line-height: 1; font-variant-numeric: tabular-nums; }
      .dir-a .a-trust span { font-size: 13.5px; color: var(--ink-50); margin-top: 6px; max-width: 9em; }

      /* hero visual — rotating, cycling */
      .dir-a .a-hero-vis { position: relative; z-index: 2; display: grid; place-items: center; min-height: 480px; }
      .dir-a .a-disc { position: absolute; width: 380px; height: 380px; border-radius: 50%;
        background: radial-gradient(circle at 38% 32%, #ffffff, #eef9f2); box-shadow: var(--shadow-md); }
      .dir-a .a-plate-btn { position: relative; width: 420px; height: 420px; border: 0; background: none; cursor: pointer; padding: 0; }
      .dir-a .a-plate { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain;
        filter: drop-shadow(0 34px 42px rgba(0,71,57,.3)); opacity: 0; transform: rotate(-12deg) scale(.92);
        transition: opacity .7s ease, transform .7s ease; }
      .dir-a .a-plate.on { opacity: 1; transform: rotate(0) scale(1); animation: a-spin var(--fp-spin, 26s) linear infinite; }
      @keyframes a-spin { to { transform: rotate(360deg); } }
      .dir-a .a-plate-btn:hover .a-plate-hint { opacity: 1; transform: translateY(0); }
      .dir-a .a-plate-hint { position: absolute; right: 18px; top: 18px; width: 40px; height: 40px; border-radius: 50%;
        background: #fff; color: var(--green-700); display: grid; place-items: center; box-shadow: var(--shadow-md);
        opacity: 0; transform: translateY(-6px); transition: .2s; }
      .dir-a .a-plate-hint svg { width: 20px; height: 20px; }
      .dir-a .a-spec { position: absolute; top: 30px; left: -6px; z-index: 3; display: inline-flex; align-items: center; gap: 10px;
        background: var(--green-dark); color: #fff; font-weight: 700; font-size: 15px; padding: 11px 18px 11px 12px;
        border-radius: var(--r-pill); box-shadow: var(--shadow-lg); animation: a-spec-in .5s ease; }
      @keyframes a-spec-in { from { opacity: 0; transform: translateY(8px) scale(.96); } }
      .dir-a .a-spec-ic { width: 30px; height: 30px; border-radius: 50%; background: var(--green); display: grid; place-items: center; flex: none; }
      .dir-a .a-spec-ic svg { width: 18px; height: 18px; }
      .dir-a .a-chip { position: absolute; background: #fff; border-radius: var(--r-pill); padding: 9px 16px;
        box-shadow: var(--shadow-md); display: flex; align-items: baseline; gap: 6px; font-weight: 700; z-index: 3;
        animation: fp-float-sm 5.5s ease-in-out infinite; }
      .dir-a .a-chip b { font-family: var(--display); font-size: 22px; color: var(--green); }
      .dir-a .a-chip span { font-size: 13px; color: var(--ink-50); font-weight: 600; }
      .dir-a .a-chip.c-kcal { top: 20px; right: 2px; }
      .dir-a .a-chip.c-pro { top: 152px; right: -34px; animation-delay: -1.4s; }
      .dir-a .a-chip.c-carb { bottom: 132px; left: -28px; animation-delay: -2.6s; }
      .dir-a .a-chip.c-fat { bottom: 34px; right: 46px; animation-delay: -3.6s; }
      .dir-a .a-plate-dots { position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; z-index: 4; }
      .dir-a .a-pd { width: 9px; height: 9px; border-radius: 50%; border: 0; background: var(--green-200); cursor: pointer; padding: 0; transition: .2s; }
      .dir-a .a-pd.on { background: var(--green); width: 26px; border-radius: 5px; }

      /* section scaffolding (reduced spacing) */
      .dir-a section { position: relative; }
      .dir-a .a-head { text-align: center; max-width: 760px; margin: 0 auto 40px; }
      .dir-a .a-head h2 { font-size: clamp(34px, 3.4vw, 48px); color: var(--green-dark); }
      .dir-a .a-head p { font-size: 19px; color: var(--ink-70); margin-top: 14px; }

      /* differentiators */
      .dir-a .a-diff { padding: 64px 0; }
      .dir-a .a-grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 22px; }
      .dir-a .a-card { background: #fff; border: 1px solid var(--sand-line); border-radius: var(--r-lg);
        padding: 30px 26px; transition: transform .2s, box-shadow .2s, border-color .2s; cursor: default; }
      .dir-a .a-card:hover { transform: translateY(-6px); box-shadow: var(--shadow-md); border-color: var(--green-200); }
      .dir-a .a-card:hover .a-ico { transform: rotate(-6deg) scale(1.08); }
      .dir-a .a-ico { width: 56px; height: 56px; border-radius: 16px; background: var(--green-50);
        color: var(--green-700); display: grid; place-items: center; margin-bottom: 18px; transition: transform .25s ease; }
      .dir-a .a-card h3 { font-size: 22px; color: var(--green-dark); }
      .dir-a .a-card p { font-size: 15.5px; color: var(--ink-70); margin-top: 10px; }

      /* comparison */
      .dir-a .a-comp { padding: 24px 0 64px; }
      .dir-a .a-table { background: #fff; border: 1px solid var(--sand-line); border-radius: var(--r-xl);
        overflow: hidden; box-shadow: var(--shadow-md); max-width: 1040px; margin: 0 auto; }
      .dir-a .a-trow { display: grid; grid-template-columns: 1.2fr 1.4fr 1.2fr; }
      .dir-a .a-trow + .a-trow { border-top: 1px solid var(--sand-line); }
      .dir-a .a-tcell { padding: 18px 26px; font-size: 16px; display: flex; align-items: center; }
      .dir-a .a-tcell.feat { font-weight: 700; color: var(--green-dark); }
      .dir-a .a-tcell.subs { background: var(--green-50); color: var(--ink); font-weight: 600; position: relative; }
      .dir-a .a-thead .a-tcell { padding: 24px 26px; align-items: flex-start; flex-direction: column; gap: 0; }
      .dir-a .a-thead .subs { background: var(--green); color: #fff; }
      .dir-a .a-thead-top { display: flex; align-items: center; gap: 12px; height: 46px; margin-bottom: 14px; }
      .dir-a .a-cmp-ico { width: 46px; height: 46px; border-radius: 15px; display: grid; place-items: center; transition: transform .25s; flex: none; }
      .dir-a .a-thead .subs .a-cmp-ico { background: rgba(255,255,255,.22); color: #fff; }
      .dir-a .a-cmp-ico.alt { background: var(--green-50); color: var(--green-700); }
      .dir-a .a-thead .subs:hover .a-cmp-ico { transform: rotate(180deg); }
      .dir-a .a-thead h3 { font-size: 24px; color: inherit; }
      .dir-a .a-thead .feat h3 { color: var(--green-dark); }
      .dir-a .a-reco { font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
        background: var(--amber); color: #4a2f00; padding: 6px 12px; border-radius: var(--r-pill); white-space: nowrap; }
      .dir-a .a-check { width: 20px; height: 20px; margin-right: 10px; flex: none; color: var(--green); }

      /* how it works */
      .dir-a .a-how { padding: 60px 0 72px; background: var(--green-dark); color: var(--cream-light); }
      .dir-a .a-how .a-head h2 { color: var(--cream-light); }
      .dir-a .a-how .a-head p { color: rgba(255,252,235,.7); }
      .dir-a .a-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
      .dir-a .a-step { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
        border-radius: var(--r-lg); padding: 26px 24px; transition: transform .2s, background .2s; }
      .dir-a .a-step:hover { transform: translateY(-5px); background: rgba(255,255,255,.1); }
      .dir-a .a-step .n { font-family: var(--display); font-size: 38px; color: var(--green); line-height: 1; }
      .dir-a .a-step-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
      .dir-a .a-step-ico { width: 48px; height: 48px; border-radius: 15px; background: rgba(0,185,107,.16); color: var(--green); display: grid; place-items: center; transition: transform .25s; }
      .dir-a .a-step:hover .a-step-ico { transform: rotate(-8deg) scale(1.08); }
      .dir-a .a-step h3 { font-size: 21px; margin-top: 12px; color: var(--cream-light); }
      .dir-a .a-step p { font-size: 15px; color: rgba(255,252,235,.72); margin-top: 10px; }
      .dir-a .a-how-cta { text-align: center; margin-top: 42px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
      .dir-a .a-help { color: rgba(255,252,235,.82); font-size: 16px; }
      .dir-a .a-help a { color: var(--green); font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }

      /* team — editorial dark band */
      .dir-a .a-team { background: var(--green-dark); }
      .dir-a .a-team-grid { max-width: 1440px; margin: 0 auto; padding: 60px 64px; display: grid;
        grid-template-columns: 1.05fr .95fr; gap: 56px; align-items: center; }
      .dir-a .a-team-photo { border-radius: var(--r-xl); overflow: hidden; box-shadow: var(--shadow-lg);
        aspect-ratio: 4/3; background: rgba(255,255,255,.06); }
      .dir-a .a-team-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .dir-a .a-team-copy .eyebrow { color: var(--green-200); }
      .dir-a .a-team-copy .eyebrow::before { background: var(--green-200); }
      .dir-a .a-team-copy h2 { font-size: clamp(34px, 3.4vw, 50px); color: var(--cream-light); margin-top: 16px; }
      .dir-a .a-team-copy p { font-size: 18px; color: rgba(255,252,235,.86); margin-top: 20px; line-height: 1.65; }

      /* testimonials — with people photos */
      .dir-a .a-tst { padding: 64px 0; }
      .dir-a .a-tst-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }
      .dir-a .a-quote { background: var(--cream); border-radius: var(--r-lg); padding: 30px 28px; border: 1px solid var(--sand-line);
        display: flex; flex-direction: column; transition: transform .2s, box-shadow .2s; }
      .dir-a .a-quote:hover { transform: translateY(-5px); box-shadow: var(--shadow-md); }
      .dir-a .a-stars { color: var(--amber); letter-spacing: 2px; margin-bottom: 12px; }
      .dir-a .a-quote p { font-family: var(--display); font-size: 20px; color: var(--green-dark); line-height: 1.3; }
      .dir-a .a-who { display: flex; align-items: center; gap: 12px; margin-top: auto; padding-top: 18px; border-top: 1px solid var(--sand-line); }
      .dir-a .a-avatar { width: 48px; height: 48px; border-radius: 50%; overflow: hidden; flex: none; box-shadow: var(--shadow-sm); }
      .dir-a .a-avatar img { display: block; width: 100%; height: 100%; object-fit: cover; }
      .dir-a .a-who-name { font-size: 14px; font-weight: 700; color: var(--green-700); font-family: var(--body); }

      /* b2b — editorial split */
      .dir-a .a-b2b { background: var(--green-dark); color: var(--cream-light); }
      .dir-a .a-b2b-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 70px; align-items: center;
        max-width: 1440px; margin: 0 auto; padding: 80px 64px; }
      .dir-a .a-b2b .eyebrow { color: var(--green-200); } .dir-a .a-b2b .eyebrow::before { background: var(--green-200); }
      .dir-a .a-b2b h2 { font-size: clamp(34px, 3.4vw, 48px); color: var(--cream-light); margin-top: 14px; }
      .dir-a .a-b2b-grid > div > p { color: rgba(255,252,235,.8); font-size: 18px; margin-top: 18px; }
      .dir-a .a-b2b .btn { margin-top: 28px; }
      .dir-a .a-b2b-feat { padding: 26px 0; border-top: 1px solid rgba(255,255,255,.16); transition: padding-left .2s; }
      .dir-a .a-b2b-feat:hover { padding-left: 10px; }
      .dir-a .a-b2b-feat h4 { font-size: 22px; color: var(--cream-light); }
      .dir-a .a-b2b-feat p { color: rgba(255,252,235,.75); font-size: 15.5px; margin-top: 8px; }

      /* newsletter */
      .dir-a .a-nl { padding: 64px 0 80px; }
      .dir-a .a-nl-inner { background: var(--cream); border: 1px dashed var(--amber-deep); border-radius: var(--r-xl);
        padding: 50px; text-align: center; max-width: 840px; margin: 0 auto; position: relative; overflow: hidden; }
      .dir-a .a-nl h3 { font-size: 36px; color: var(--green-dark); }
      .dir-a .a-nl p { font-size: 18px; color: var(--ink-70); margin: 12px auto 26px; max-width: 30em; }
      .dir-a .a-nl-form { display: flex; gap: 12px; max-width: 480px; margin: 0 auto; }
      .dir-a .a-nl-form input { flex: 1; border: 1px solid var(--sand-line); border-radius: var(--r-pill);
        padding: 15px 22px; font-family: var(--body); font-size: 16px; background: #fff; }
      .dir-a .a-nl-form input:focus { outline: 2px solid var(--green); }

      /* footer styles live inside SiteFooter component (shared with order site) */

      .dir-a .a-brand { color: var(--green); }

      /* scroll follower */
      .dir-a .a-follow { position: fixed; right: 26px; bottom: 26px; z-index: 60; display: flex; align-items: center; gap: 0;
        background: #fff; border: 1px solid var(--sand-line); border-radius: var(--r-pill); padding: 7px 20px 7px 7px;
        box-shadow: var(--shadow-lg); cursor: pointer; overflow: hidden; transition: transform .18s, box-shadow .18s; }
      .dir-a .a-follow:hover { transform: translateY(-3px); }
      .dir-a .a-follow-ring { position: absolute; left: 7px; top: 50%; transform: translateY(-50%); }
      .dir-a .a-follow-ic { width: 60px; height: 60px; display: grid; place-items: center; color: var(--green-dark); flex: none; }
      .dir-a .a-follow-ic svg { width: 22px; height: 22px; }
      .dir-a .a-follow-lbl { display: flex; flex-direction: column; font-family: var(--display); font-size: 17px; color: var(--green-dark); line-height: 1.1; padding-left: 4px; }
      .dir-a .a-follow-lbl small { font-family: var(--body); font-weight: 700; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-50); }

      /* ============ TABLET ≤ 1024px ============ */
      @media (max-width: 1024px) {
        .dir-a .wrap { padding: 0 24px; }
        .dir-a .a-hdr-in { padding: 12px 20px; gap: 12px; }
        .dir-a .a-nav, .dir-a .a-hdr-cta { display: none; }
        .dir-a .a-burger { display: grid; }
        .dir-a .a-mobile-menu { display: none; flex-direction: column; padding: 6px 24px 20px;
          background: var(--cream-light); border-bottom: 1px solid var(--sand-line); }
        .dir-a .a-mobile-menu.open { display: flex; animation: a-menu-in .22s ease; }
        @keyframes a-menu-in { from { opacity: 0; transform: translateY(-8px); } }
        .dir-a .a-mobile-menu > a { padding: 14px 4px; font-weight: 700; font-size: 18px; color: var(--green-dark);
          border-bottom: 1px solid var(--sand-line); }
        .dir-a .a-mobile-lang { display: flex; justify-content: center; padding: 14px 0 6px; }
        .dir-a .a-mobile-cta { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
        .dir-a .a-mobile-cta .btn { width: 100%; justify-content: center; }

        /* hero — image first, stacked */
        .dir-a .a-hero { padding: 24px 0 44px; }
        .dir-a .a-hero .wrap { grid-template-columns: 1fr; gap: 22px; }
        .dir-a .a-hero-vis { order: -1; min-height: 330px; }
        .dir-a .a-h1 { font-size: clamp(34px, 8.4vw, 48px); }
        .dir-a .a-sub { font-size: 17px; margin-top: 14px; max-width: none; }
        .dir-a .a-cta-row { flex-direction: column; align-items: stretch; gap: 12px; margin-top: 24px; }
        .dir-a .a-cta-row .btn { width: 100%; justify-content: center; }
        .dir-a .a-trust { gap: 22px; margin-top: 26px; }
        .dir-a .a-trust b { font-size: 36px; }
        .dir-a .a-trust span { font-size: 12px; }

        /* hero plate + chips scaled down */
        .dir-a .a-disc { width: 252px; height: 252px; }
        .dir-a .a-plate-btn { width: 280px; height: 280px; }
        .dir-a .a-chip { padding: 7px 12px; }
        .dir-a .a-chip b { font-size: 17px; }
        .dir-a .a-chip span { font-size: 11px; }
        .dir-a .a-chip.c-kcal { top: 4px; right: 6px; }
        .dir-a .a-chip.c-pro { top: 96px; right: -6px; }
        .dir-a .a-chip.c-carb { bottom: 84px; left: -2px; }
        .dir-a .a-chip.c-fat { bottom: 14px; right: 40px; }
        .dir-a .a-spec { top: 4px; left: 0; font-size: 12px; padding: 8px 13px 8px 8px; }
        .dir-a .a-spec-ic { width: 24px; height: 24px; }
        .dir-a .a-spec-ic svg { width: 15px; height: 15px; }

        /* section heads + spacing */
        .dir-a .a-head { margin-bottom: 28px; }
        .dir-a .a-head h2 { font-size: clamp(27px, 6.4vw, 36px); }
        .dir-a .a-head p { font-size: 16px; }
        .dir-a .a-diff { padding: 48px 0; }
        .dir-a .a-comp { padding: 16px 0 48px; }
        .dir-a .a-how { padding: 48px 0 52px; }
        .dir-a .a-tst { padding: 48px 0; }
        .dir-a .a-nl { padding: 48px 0 56px; }

        /* grids collapse */
        .dir-a .a-grid4 { grid-template-columns: repeat(2, 1fr); gap: 14px; }
        .dir-a .a-card { padding: 24px 20px; }
        .dir-a .a-steps { grid-template-columns: repeat(2, 1fr); gap: 14px; }
        .dir-a .a-tst-grid { grid-template-columns: 1fr; gap: 16px; }
        .dir-a .a-b2b-grid { grid-template-columns: 1fr; gap: 26px; padding: 48px 24px; }
        .dir-a .a-team-grid { grid-template-columns: 1fr; gap: 26px; padding: 40px 24px; }
        .dir-a .a-team-photo { aspect-ratio: 16/10; max-height: 320px; }

        /* comparison → feature label full-width, two options side-by-side */
        .dir-a .a-trow { grid-template-columns: 1fr 1fr; }
        .dir-a .a-tcell.feat { grid-column: 1 / -1; background: var(--sand); padding: 11px 18px; font-size: 13.5px;
          text-transform: uppercase; letter-spacing: .04em; }
        .dir-a .a-thead .feat { display: none; }
        .dir-a .a-tcell { padding: 13px 16px; font-size: 13.5px; align-items: flex-start; }
        .dir-a .a-thead .a-tcell { padding: 16px; }
        .dir-a .a-thead h3 { font-size: 18px; }
        .dir-a .a-thead-top { height: auto; margin-bottom: 10px; }
        .dir-a .a-cmp-ico { width: 36px; height: 36px; border-radius: 11px; }
        .dir-a .a-cmp-ico svg { width: 19px; height: 19px; }
        .dir-a .a-reco { font-size: 9px; padding: 4px 8px; }
        .dir-a .a-check { width: 17px; height: 17px; margin-right: 7px; }

        /* newsletter */
        .dir-a .a-nl-inner { padding: 34px 22px; }
        .dir-a .a-nl h3 { font-size: 27px; }
        .dir-a .a-nl p { font-size: 16px; }
        .dir-a .a-nl-form { flex-direction: column; }
        .dir-a .a-nl-form .btn { width: 100%; justify-content: center; }

        /* scroll follower → compact round button */
        .dir-a .a-follow { right: 16px; bottom: 16px; padding: 0; width: 54px; height: 54px; border-radius: 50%; justify-content: center; }
        .dir-a .a-follow-lbl { display: none; }
        .dir-a .a-follow-ic { width: 54px; height: 54px; }
        .dir-a .a-follow-ring { left: 50%; top: 50%; transform: translate(-50%, -50%); width: 54px; height: 54px; }
      }

      /* ============ PHONE ≤ 560px ============ */
      @media (max-width: 560px) {
        .dir-a .wrap { padding: 0 18px; }
        .dir-a .a-grid4 { grid-template-columns: 1fr; }
        .dir-a .a-steps { grid-template-columns: 1fr; }
        .dir-a .a-trust { gap: 16px; }
        .dir-a .a-trust b { font-size: 32px; }
        .dir-a .a-disc { width: 226px; height: 226px; }
        .dir-a .a-plate-btn { width: 254px; height: 254px; }
        .dir-a .a-chip.c-pro { top: 86px; right: 0; }
        .dir-a .a-chip.c-carb { bottom: 76px; left: 2px; }
        .dir-a .a-team-grid, .dir-a .a-b2b-grid { padding: 40px 18px; }
      }
    `}</style>

    <Header />

    {/* HERO */}
    <section className="a-hero" id="a-sec-hero">
      <div className="a-blob a-blob1"></div>
      <div className="a-blob a-blob2"></div>
      <div className="wrap">
        <div className="a-hero-copy">
          <span className="eyebrow">{L('Dietitian + chef, daily', 'Διατροφολόγος + σεφ, καθημερινά')}</span>
          <h1 className="a-h1" style={{ marginTop: 16 }}>{L(...C.hero_h1)}</h1>
          <p className="a-sub">{L(...C.hero_sub)}</p>
          <div className="a-cta-row">
            <a className="btn btn-primary" href={ORDER_APP_SUBS}>{L(...C.cta_goal)}</a>
            <a className="btn btn-ghost" href={ORDER_APP}>{L(...C.cta_ala)}</a>
          </div>
          <OfferPill />
          <div className="a-trust">
            <div><Counter to={300} suffix="+" /><span>{L('meals on the menu', 'γεύματα στο μενού')}</span></div>
            <div><Counter to={20} suffix="%" /><span>{L('cheaper on plans', 'φθηνότερα στα πλάνα')}</span></div>
            <div><Counter to={0} suffix="′" /><span>{L('prep, every day', 'prep, κάθε μέρα')}</span></div>
          </div>
        </div>
        <HeroVisual />
      </div>
    </section>

    {/* DIFFERENTIATORS */}
    <section className="a-diff" id="a-sec-diff">
      <div className="wrap">
        <div className="a-head"><h2>{L(
          <>The <span className="a-brand">Fitpal</span> difference, in every detail</>,
          <>Η <span className="a-brand">Fitpal</span> διαφορά σε κάθε λεπτομέρεια</>,
        )}</h2></div>
        <div className="a-grid4">
          {([
            [<AIco d={['M3 11l9-8 9 8', 'M5 10v10h14V10', 'M9 20v-6h6v6']} />, C.diff1_t, C.diff1_b],
            [<AIco d={['M12 3v18', 'M5 8l7-5 7 5', 'M5 8v8l7 4 7-4V8']} />, C.diff2_t, C.diff2_b],
            [<AIco d={['M3 5h18v12H3z', 'M3 9h18', 'M8 21h8', 'M12 17v4']} />, C.diff3_t, C.diff3_b],
            [<AIco d={['M12 7v5l3 2', 'M21 12a9 9 0 1 1-9-9']} />, C.diff4_t, C.diff4_b],
          ] as Array<[ReactNode, [string, string], [string, string]]>).map((c, i) => (
            <div className="a-card" key={i}>
              <div className="a-ico">{c[0]}</div>
              <h3>{L(...c[1])}</h3>
              <p>{L(...c[2])}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* COMPARISON */}
    <section className="a-comp" id="a-sec-comp">
      <div className="wrap">
        <div className="a-head">
          <h2>{L(...C.comp_h2)}</h2>
          <p>{L(...C.comp_sub)}</p>
        </div>
        <div className="a-table">
          <div className="a-trow a-thead">
            <div className="a-tcell feat">
              <div className="a-thead-top"></div>
              <h3>{L(...C.comp_col0)}</h3>
            </div>
            <div className="a-tcell subs">
              <div className="a-thead-top">
                <span className="a-cmp-ico"><FpIcon name="repeat" size={24} /></span>
                <span className="a-reco">{L(...C.comp_reco)}</span>
              </div>
              <h3>{L(...C.comp_subs)}</h3>
            </div>
            <div className="a-tcell">
              <div className="a-thead-top">
                <span className="a-cmp-ico alt"><FpIcon name="cloche" size={24} /></span>
              </div>
              <h3 style={{ color: 'var(--green-dark)' }}>{L(...C.comp_ala)}</h3>
            </div>
          </div>
          {([
            [C.comp_r1, C.comp_r1a, C.comp_r1b], [C.comp_r2, C.comp_r2a, C.comp_r2b],
            [C.comp_r3, C.comp_r3a, C.comp_r3b], [C.comp_r4, C.comp_r4a, C.comp_r4b],
            [C.comp_r5, C.comp_r5a, C.comp_r5b], [C.comp_r6, C.comp_r6a, C.comp_r6b],
          ] as Array<[[string, string], [string, string], [string, string]]>).map((r, i) => (
            <div className="a-trow" key={i}>
              <div className="a-tcell feat">{L(...r[0])}</div>
              <div className="a-tcell subs">
                <svg className="a-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                {L(...r[1])}
              </div>
              <div className="a-tcell">{L(...r[2])}</div>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* MENU SAMPLE */}
    <div id="a-sec-menu"><MenuSample bg="var(--cream-light)" /></div>

    {/* HOW IT WORKS */}
    <Wave from="var(--cream-light)" to="var(--green-dark)" />
    <section className="a-how" id="a-sec-how">
      <div className="wrap">
        <div className="a-head">
          <h2>{L(...C.how_h2)}</h2>
          <p>{L(...C.how_sub)}</p>
        </div>
        <div className="a-steps">
          {([[1, C.how1_t, C.how1_b, 'target'], [2, C.how2_t, C.how2_b, 'calendar'], [3, C.how3_t, C.how3_b, 'chef'], [4, C.how4_t, C.how4_b, 'pause']] as Array<[number, [string, string], [string, string], FpIconName]>).map((s, i) => (
            <div className="a-step" key={i}>
              <div className="a-step-top">
                <span className="a-step-ico"><FpIcon name={s[3]} size={26} /></span>
                <div className="n">{String(s[0]).padStart(2, '0')}</div>
              </div>
              <h3>{L(...s[1])}</h3>
              <p>{L(...s[2])}</p>
            </div>
          ))}
        </div>
        <div className="a-how-cta">
          <a className="btn btn-primary" href={ORDER_APP_SUBS}>{L(...C.how_cta)}</a>
          <p className="a-help">{L(...C.how_help)} <a href="#">{L(...C.how_call)}</a> {L(...C.or)} <a href="https://wa.me/306937109396">{L(...C.whatsapp)}</a></p>
        </div>
      </div>
    </section>

    {/* TEAM — editorial dark band */}
    <section className="a-team" id="a-sec-team">
      <div className="a-team-grid">
        <div className="a-team-copy">
          <span className="eyebrow">{L('Science + gastronomy', 'Επιστήμη + γαστρονομία')}</span>
          <h2>{L(...C.team_h2)}</h2>
          <p>{L(...C.team_body)}</p>
        </div>
        <div className="a-team-photo"><img src={TEAM_PHOTO} alt="Fitpal dietitian" /></div>
      </div>
    </section>

    {/* TESTIMONIALS */}
    <section className="a-tst" id="a-sec-tst">
      <div className="wrap">
        <div className="a-tst-grid">
          {([[C.t1, C.t1n], [C.t2, C.t2n], [C.t3, C.t3n]] as Array<[[string, string], [string, string]]>).map((t, i) => (
            <div className="a-quote" key={i}>
              <div className="a-stars">★★★★★</div>
              <p>{L(...t[0])}</p>
              <div className="a-who">
                <span className="a-avatar"><img src={TST_AVATARS[i]} alt="" /></span>
                <span className="a-who-name">{L(...t[1])}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* B2B — editorial split */}
    <section className="a-b2b" id="a-sec-b2b">
      <div className="a-b2b-grid">
        <div>
          <span className="eyebrow">Fitpal B2B</span>
          <h2>{L(...C.b2b_h2)}</h2>
          <p>{L(...C.b2b_body)}</p>
          <a className="btn btn-primary" href="/b2b">{L(...C.b2b_cta)}</a>
        </div>
        <div>
          <div className="a-b2b-feat"><h4>{L(...C.b2b1_t)}</h4><p>{L(...C.b2b1_b)}</p></div>
          <div className="a-b2b-feat"><h4>{L(...C.b2b2_t)}</h4><p>{L(...C.b2b2_b)}</p></div>
        </div>
      </div>
    </section>

    {/* NEWSLETTER */}
    <section className="a-nl" id="a-sec-nl">
      <div className="wrap">
        <div className="a-nl-inner">
          <span className="badge-offer" style={{ marginBottom: 18 }}>-15%</span>
          <h3>{L(...C.nl_h3)}</h3>
          <p>{L(...C.nl_body)}</p>
          <div className="a-nl-form">
            <input type="email" placeholder="" aria-label="email" />
            <button className="btn btn-primary" type="button">{L(...C.nl_btn)}</button>
          </div>
        </div>
      </div>
    </section>

    {/* FOOTER — shared component (also used by FpShell pages + the order site). */}
    <SiteFooter lang={lang} logoSrc={logoWordmark} />

    <ScrollFollower />
  </div>
  );
};

export default V1;
