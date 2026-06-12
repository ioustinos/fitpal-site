/* ===========================================================
   SiteFooter — shared marketing footer used by BOTH the landing
   site (V1, FpShell) and the ordering site (CustomerApp).

   The same source file lives in both repos at the same logical
   location (modules/designs/SiteFooter.tsx in landing,
   components/layout/SiteFooter.tsx in fitpal-site). Keep them
   byte-identical; any edit here must be mirrored.

   Props:
     - lang: 'el' | 'en'  — caller-owned. Landing reads it from
       body.lang-X via a small hook; order site reads useUIStore.lang.
     - logoSrc: string    — wordmark URL; each repo passes its own
       import (Vite gives a hashed URL string).
     - marketingBase: string (optional) — prepended to internal
       marketing routes. Empty on the landing site (links resolve
       relatively). On the order site, pass the landing domain so
       the footer links cross over (e.g. dev--fitpal-landing.netlify.app).
   =========================================================== */
import type { FC } from 'react';

export type FooterLang = 'el' | 'en';

interface Props {
  lang: FooterLang;
  logoSrc: string;
  marketingBase?: string;
}

type Tuple = [string, string]; // [en, el]
const T = (t: Tuple, l: FooterLang) => (l === 'en' ? t[0] : t[1]);

const STR = {
  tag:    ['Forget “what to eat today?”. Focus on your goal.', 'Ξέχνα το «Τι θα φάμε σήμερα;». Εστίασε στον στόχο σου.'] as Tuple,
  c2:     ['EXPLORE', 'ΕΞΕΡΕΥΝΗΣΕ'] as Tuple,
  c3:     ['COMPANY', 'ΕΤΑΙΡΕΙΑ'] as Tuple,
  c4:     ['CONTACT', 'ΕΠΙΚΟΙΝΩΝΙΑ'] as Tuple,
  lSubs:  ['Subscription Plans', 'Συνδρομητικά Πλάνα'] as Tuple,
  lMenu:  ['Weekly Menu (A La Carte)', 'Εβδομαδιαίο Μενού (A La Carte)'] as Tuple,
  lCorp:  ['Corporate Packages (B2B)', 'Εταιρικά Πακέτα (B2B)'] as Tuple,
  lAbout: ['About Us', 'Η Ομάδα μας'] as Tuple,
  lFaq:   ['FAQ', 'Συχνές Ερωτήσεις'] as Tuple,
  lTerms: ['Terms & Privacy', 'Όροι Χρήσης & Πολιτική Απορρήτου'] as Tuple,
  hours:  ['Delivery hours: Mon–Fri · 09:00–13:00', 'Ώρες Delivery: Δευτ–Παρ · 09:00–13:00'] as Tuple,
  rights: ['© 2025 Fitpal Meals. All rights reserved.', '© 2025 Fitpal Meals. Με επιφύλαξη παντός δικαιώματος.'] as Tuple,
  made:   ['Made in Athens', 'Made in Athens'] as Tuple,
};

const SiteFooter: FC<Props> = ({ lang, logoSrc, marketingBase = '' }) => {
  const link = (path: string) => `${marketingBase}${path}`;
  return (
    <footer className="sf">
      <style>{`
        .sf { background: #004739; color: #fffbef; padding: 64px 0 28px;
          font-family: var(--body, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif); }
        .sf .sf-wrap { max-width: 1440px; margin: 0 auto; padding: 0 64px; box-sizing: border-box; }
        .sf .sf-grid { display: grid; grid-template-columns: 1.6fr 1fr 1fr 1.2fr; gap: 40px; }
        .sf h5 { font-family: inherit; font-weight: 700; font-size: 14px; letter-spacing: .1em;
          text-transform: uppercase; color: rgba(255,252,235,.6); margin: 0 0 18px; }
        .sf ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
        .sf a, .sf li { color: rgba(255,252,235,.82); font-size: 15.5px; text-decoration: none; }
        .sf a:hover { color: #2bb673; }
        .sf .sf-logo { height: 28px; filter: brightness(0) invert(1); opacity: .95; margin-bottom: 18px; }
        .sf .sf-tag { font-size: 16px; line-height: 1.55; color: rgba(255,252,235,.78); max-width: 24em; margin: 0; }
        .sf .sf-bottom { border-top: 1px solid rgba(255,255,255,.12); margin-top: 50px; padding-top: 22px;
          display: flex; justify-content: space-between; font-size: 13.5px; color: rgba(255,252,235,.55); }
        @media (max-width: 1024px) {
          .sf { padding: 48px 0 28px; }
          .sf .sf-wrap { padding: 0 24px; }
          .sf .sf-grid { grid-template-columns: 1fr 1fr; gap: 28px; }
          .sf .sf-bottom { flex-direction: column; gap: 8px; align-items: flex-start; }
        }
        @media (max-width: 560px) {
          .sf .sf-grid { grid-template-columns: 1fr; gap: 26px; }
        }
      `}</style>

      <div className="sf-wrap sf-grid">
        <div>
          <img className="sf-logo" src={logoSrc} alt="Fitpal Meals" />
          <p className="sf-tag">{T(STR.tag, lang)}</p>
        </div>
        <div>
          <h5>{T(STR.c2, lang)}</h5>
          <ul>
            <li><a href={link('/subscriptions')}>{T(STR.lSubs, lang)}</a></li>
            <li><a href={link('/a-la-carte')}>{T(STR.lMenu, lang)}</a></li>
            <li><a href={link('/b2b')}>{T(STR.lCorp, lang)}</a></li>
          </ul>
        </div>
        <div>
          <h5>{T(STR.c3, lang)}</h5>
          <ul>
            <li><a href={link('/about')}>{T(STR.lAbout, lang)}</a></li>
            <li><a href="#" aria-disabled="true">{T(STR.lFaq, lang)}</a></li>
            <li><a href="#" aria-disabled="true">{T(STR.lTerms, lang)}</a></li>
          </ul>
        </div>
        <div>
          <h5>{T(STR.c4, lang)}</h5>
          <ul>
            <li><a href="tel:+302104253929">+30 210 425 3929</a></li>
            <li><a href="https://wa.me/306937109396">WhatsApp</a></li>
            <li><a href="mailto:support@fitpal.gr">support@fitpal.gr</a></li>
            <li>{T(STR.hours, lang)}</li>
          </ul>
        </div>
      </div>
      <div className="sf-wrap">
        <div className="sf-bottom">
          <span>{T(STR.rights, lang)}</span>
          <span>{T(STR.made, lang)}</span>
        </div>
      </div>
    </footer>
  );
};

export default SiteFooter;
