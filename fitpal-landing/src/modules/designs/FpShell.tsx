/* ===========================================================
   FpShell — shared site chrome for the new subpages
   (Subscriptions, A La Carte, B2B, About). Mirrors the V1 home
   header / footer / newsletter visuals so cross-page nav stays
   coherent. Same .dir-a token surface but rendered under
   .fp-page (self-contained) so it can coexist with V1.
   =========================================================== */
import { FC, ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { L, C } from './content';
import LangSwitch from './LangSwitch';
import SiteFooter from './SiteFooter';
import { useBodyLang } from './useBodyLang';
import './designSystem.scss';

import logoWordmark from 'app/assets/designs/logo-wordmark.svg';

const ORDER_APP = 'https://dev--fitpal-order.netlify.app/';
const ORDER_APP_SUBS = `${ORDER_APP}?view=subscription`;

type ActiveKey = 'subs' | 'ala' | 'b2b' | 'about';

interface ShellProps {
  active?: ActiveKey;
  newsletter?: boolean;
  children: ReactNode;
}

const NAV: Array<[ActiveKey, string, [string, string]]> = [
  ['subs',  '/subscriptions', ['Subscriptions', 'Συνδρομές']],
  ['ala',   '/a-la-carte',    ['A La Carte', 'A La Carte']],
  ['b2b',   '/b2b',           ['B2B', 'B2B']],
  ['about', '/about',         ['Our Team', 'Η Ομάδα μας']],
];

const Burger: FC<{ open: boolean }> = ({ open }) => (
  <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
    {open ? (
      <>
        <path d="M6 6l12 12" />
        <path d="M6 18L18 6" />
      </>
    ) : (
      <>
        <path d="M4 7h16" />
        <path d="M4 12h16" />
        <path d="M4 17h16" />
      </>
    )}
  </svg>
);

const FpShell: FC<ShellProps> = ({ active, newsletter = true, children }) => {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const lang = useBodyLang();

  // Close mobile menu on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  // Mobile-only body class to kill horizontal scroll from hero decoration
  useEffect(() => {
    document.body.classList.add('fp-no-x-scroll');
    return () => { document.body.classList.remove('fp-no-x-scroll'); };
  }, []);

  return (
    <div className="fp fp-page">
      <style>{`
        .fp-page { background: var(--cream-light); }
        .fp-page .wrap { max-width: 1440px; margin: 0 auto; padding: 0 64px; }

        /* header (mirrors V1) */
        .fp-page .sh-hdr { position: sticky; top: 0; z-index: 40; background: rgba(255,251,239,.86);
          backdrop-filter: blur(10px); border-bottom: 1px solid var(--sand-line); }
        .fp-page .sh-hdr-in { max-width: 1440px; margin: 0 auto; display: flex; align-items: center; gap: 32px; padding: 16px 64px; }
        .fp-page .sh-logo { height: 30px; }
        .fp-page .sh-nav { display: flex; gap: 28px; margin-left: 10px; flex: none; }
        .fp-page .sh-nav a { font-weight: 600; font-size: 16px; color: var(--ink-70); position: relative; white-space: nowrap; }
        .fp-page .sh-nav a:hover { color: var(--green-dark); }
        .fp-page .sh-nav a.on { color: var(--green-dark); font-weight: 700; }
        .fp-page .sh-nav a.on::after { content: ""; position: absolute; left: 0; right: 0; bottom: -6px; height: 2.5px;
          border-radius: 2px; background: var(--green); }
        .fp-page .sh-hdr-cta { margin-left: auto; display: flex; align-items: center; gap: 18px; }
        .fp-page .sh-hdr-phone { display: inline-flex; align-items: center; gap: 8px; font-weight: 600;
          color: var(--green-dark); font-size: 15px; white-space: nowrap; }
        .fp-page .sh-hdr-phone:hover { color: var(--green); }
        .fp-page .sh-hdr-wa { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px;
          border-radius: 12px; color: var(--green-dark); transition: background .15s ease, color .15s ease; }
        .fp-page .sh-hdr-wa:hover { background: rgba(0, 124, 89, .08); color: var(--green); }
        .fp-page .sh-login { font-weight: 700; color: var(--green-dark); font-size: 16px; }
        .fp-page .sh-login:hover { color: var(--green); }
        .fp-page .sh-start { padding: 12px 22px; font-size: 16px; }
        .fp-page .sh-mmenu-contact { display: flex; flex-direction: column; gap: 4px; padding: 10px 0 4px; }
        .fp-page .sh-mmenu-row { color: var(--green-dark); font-weight: 600; font-size: 16px; padding: 6px 0; }
        /* Burger defaults: hidden on full desktop. Declared BEFORE the media queries
           so equal-specificity media overrides actually win at source order. */
        .fp-page .sh-burger { display: none; width: 46px; height: 46px; border: 1px solid var(--sand-line);
          background: #fff; border-radius: 13px; color: var(--green-dark); place-items: center; cursor: pointer; margin-left: auto; }
        .fp-page .sh-mmenu { display: none; }
        .fp-page .sh-mobile-lang { display: flex; justify-content: center; padding: 14px 0 6px; }

        /* Intermediate desktop 1121–1199: hide phone-number text (icon stays clickable). */
        @media (max-width: 1199px) and (min-width: 1121px) {
          .fp-page .sh-hdr-phone span { display: none; }
          .fp-page .sh-hdr-phone { padding: 8px; border-radius: 11px; }
        }
        /* Header-only collapse — burger menu kicks in earlier (≤1120px) than the
           content tablet breakpoint (≤1024) because the new cluster has phone + WA +
           lang + login + signup and can't fit at intermediate desktop widths. */
        @media (max-width: 1120px) {
          .fp-page .sh-nav, .fp-page .sh-hdr-cta { display: none; }
          .fp-page .sh-burger { display: grid; }
          .fp-page .sh-mmenu { display: none; flex-direction: column; padding: 6px 24px 20px;
            background: var(--cream-light); border-bottom: 1px solid var(--sand-line); }
          .fp-page .sh-mmenu.open { display: flex; animation: sh-menu-in .22s ease; }
          .fp-page .sh-hdr-in { gap: 12px; }
        }

        /* newsletter band */
        .fp-page .sh-nl { padding: 56px 0 72px; }
        .fp-page .sh-nl-inner { background: var(--cream); border: 1px dashed var(--amber-deep); border-radius: var(--r-xl);
          padding: 48px; text-align: center; max-width: 840px; margin: 0 auto; }
        .fp-page .sh-nl h3 { font-size: 34px; color: var(--green-dark); }
        .fp-page .sh-nl p { font-size: 17.5px; color: var(--ink-70); margin: 12px auto 26px; max-width: 30em; }
        .fp-page .sh-nl-form { display: flex; gap: 12px; max-width: 480px; margin: 0 auto; }
        .fp-page .sh-nl-form input { flex: 1; border: 1px solid var(--sand-line); border-radius: var(--r-pill);
          padding: 15px 22px; font-family: var(--body); font-size: 16px; background: #fff; }
        .fp-page .sh-nl-form input:focus { outline: 2px solid var(--green); }

        /* footer styles live inside SiteFooter component */

        /* ============ ≤1024px ============ */
        @media (max-width: 1024px) {
          .fp-page .wrap { padding: 0 24px; }
          .fp-page .sh-hdr-in { padding: 12px 20px; gap: 12px; }
          .fp-page .sh-nav, .fp-page .sh-hdr-cta { display: none; }
          .fp-page .sh-burger { display: grid; }
          .fp-page .sh-mmenu { display: none; flex-direction: column; padding: 6px 24px 20px;
            background: var(--cream-light); border-bottom: 1px solid var(--sand-line); }
          .fp-page .sh-mmenu.open { display: flex; animation: sh-menu-in .22s ease; }
          @keyframes sh-menu-in { from { opacity: 0; transform: translateY(-8px); } }
          .fp-page .sh-mmenu > a { padding: 13px 2px; font-weight: 700; font-size: 17px; color: var(--green-dark);
            border-bottom: 1px solid var(--sand-line); }
          .fp-page .sh-mmenu-cta { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
          .fp-page .sh-mmenu-cta .btn { width: 100%; justify-content: center; }
          .fp-page .sh-nl { padding: 40px 0 48px; }
          .fp-page .sh-nl-inner { padding: 34px 22px; }
          .fp-page .sh-nl h3 { font-size: 27px; }
          .fp-page .sh-nl-form { flex-direction: column; }
          .fp-page .sh-nl-form .btn { width: 100%; justify-content: center; }
        }
      `}</style>

      <header className="sh-hdr">
        <div className="sh-hdr-in">
          <Link to="/v1"><img className="sh-logo" src={logoWordmark} alt="Fitpal Meals" /></Link>
          <nav className="sh-nav">
            {NAV.map(([key, to, copy]) => (
              <Link key={key} to={to} className={key === active ? 'on' : ''}>{L(...copy)}</Link>
            ))}
          </nav>
          <div className="sh-hdr-cta">
            <a className="sh-hdr-phone" href="tel:+302104253929" aria-label="Καλέστε μας">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              <span>+30 210 425 3929</span>
            </a>
            <a className="sh-hdr-wa" href="https://wa.me/306937109396" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            </a>
            <LangSwitch inline />
            {/* WEC-560: accounts live only on the ordering site — no Login/Register
                here. Header action is the primary "build your plan" order CTA. */}
            <a className="btn btn-primary sh-start" href={ORDER_APP}>{L('Build your plan', 'Φτιάξε το πλάνο σου')}</a>
          </div>
          <button
            className="sh-burger"
            type="button"
            aria-label="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <Burger open={open} />
          </button>
        </div>
        <nav className={'sh-mmenu' + (open ? ' open' : '')}>
          {NAV.map(([key, to, copy]) => (
            <Link key={key} to={to} onClick={() => setOpen(false)}>{L(...copy)}</Link>
          ))}
          <div className="sh-mobile-lang"><LangSwitch inline /></div>
          <div className="sh-mmenu-contact">
            <a href="tel:+302104253929" className="sh-mmenu-row" onClick={() => setOpen(false)}>+30 210 425 3929</a>
            <a href="https://wa.me/306937109396" target="_blank" rel="noopener noreferrer" className="sh-mmenu-row">WhatsApp</a>
          </div>
          <div className="sh-mmenu-cta">
            {/* WEC-560: no Login/Register on the landing — single order CTA. */}
            <a className="btn btn-primary" href={ORDER_APP} onClick={() => setOpen(false)}>{L('Build your plan', 'Φτιάξε το πλάνο σου')}</a>
          </div>
        </nav>
      </header>

      {children}

      {newsletter && (
        <section className="sh-nl">
          <div className="wrap">
            <div className="sh-nl-inner">
              <span className="badge-offer" style={{ marginBottom: 18 }}>-15%</span>
              <h3>{L(...C.nl_h3)}</h3>
              <p>{L(...C.nl_body)}</p>
              <div className="sh-nl-form">
                <input type="email" placeholder="" aria-label="email" />
                <button className="btn btn-primary" type="button">{L(...C.nl_btn)}</button>
              </div>
            </div>
          </div>
        </section>
      )}

      <SiteFooter lang={lang} logoSrc={logoWordmark} />
    </div>
  );
};

export default FpShell;
export { ORDER_APP, ORDER_APP_SUBS };
