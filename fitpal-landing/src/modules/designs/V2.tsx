/* ===========================================================
   DIRECTION B — "Premium Editorial"
   Photography-led, generous whitespace, Newsreader serif
   headlines. Chef-quality, calm, confident.
   =========================================================== */
import { FC } from 'react';
import { L, C } from './content';
import LangSwitch from './LangSwitch';
import FpIcon from './FpIcon';
import MenuSample from './MenuSample';
import './designSystem.scss';

import logoWordmark from 'app/assets/designs/logo-wordmark.svg';
import plateTuna from 'app/assets/designs/photos/plate-tuna.jpg';
import bananaBread from 'app/assets/designs/photos/banana-bread.jpg';

const Header: FC = () => (
  <header className="b-hdr">
    <div className="b-hdr-inner">
      <img className="b-logo" src={logoWordmark} alt="Fitpal Meals" />
      <nav className="b-nav">
        <a href="#">{L(...C.nav_subs)}</a>
        <a href="#">{L(...C.nav_ala)}</a>
        <a href="#">{L(...C.nav_b2b)}</a>
        <a href="#">{L(...C.nav_team)}</a>
      </nav>
      <div className="b-hdr-cta">
        {/* WEC-560: no Login/Register on landing — accounts live on the order site. */}
        <a className="btn btn-dark b-start" href="https://order.fitpal.gr/">{L(...C.nav_start)}</a>
      </div>
    </div>
  </header>
);

const V2: FC = () => (
  <div className="fp dir-b">
    <LangSwitch />
    <style>{`
      .dir-b { background: var(--cream-light); }
      .dir-b .b-serif { font-family: var(--serif); font-weight: 500; letter-spacing: -0.015em; line-height: 1.02; }
      .dir-b .b-serif em { font-style: italic; color: var(--green); }

      .dir-b .b-hdr { position: sticky; top: 0; z-index: 40; background: rgba(255,251,239,.9); backdrop-filter: blur(12px);
        border-bottom: 1px solid var(--sand-line); }
      .dir-b .b-hdr-inner { display: flex; align-items: center; gap: 36px; padding: 20px 56px; max-width: 1280px; margin: 0 auto; }
      .dir-b .b-logo { height: 28px; }
      .dir-b .b-nav { display: flex; gap: 34px; margin-left: 14px; }
      .dir-b .b-nav a { font-size: 15px; font-weight: 600; letter-spacing: .01em; color: var(--ink-70); }
      .dir-b .b-nav a:hover { color: var(--green-dark); }
      .dir-b .b-hdr-cta { margin-left: auto; display: flex; align-items: center; gap: 24px; }
      .dir-b .b-login { font-weight: 700; font-size: 15px; color: var(--green-dark); }
      .dir-b .b-start { padding: 11px 22px; font-size: 15px; }

      .dir-b .b-hero { background: var(--green-dark); color: var(--cream-light); padding: 0; overflow: hidden; }
      .dir-b .b-hero-grid { display: grid; grid-template-columns: 1.02fr .98fr; align-items: stretch; max-width: 1280px; margin: 0 auto; }
      .dir-b .b-hero-copy { padding: 96px 56px 96px 56px; display: flex; flex-direction: column; justify-content: center; }
      .dir-b .b-hero-copy .eyebrow { color: var(--green-200); }
      .dir-b .b-hero-copy .eyebrow::before { background: var(--green-200); }
      .dir-b .b-h1 { font-size: clamp(46px, 4.4vw, 72px); margin-top: 26px; color: var(--cream-light); }
      .dir-b .b-sub { font-size: 20px; line-height: 1.6; color: rgba(255,252,235,.78); margin-top: 26px; max-width: 28em; }
      .dir-b .b-cta-row { display: flex; align-items: center; gap: 18px; margin-top: 38px; flex-wrap: wrap; }
      .dir-b .b-ala { display: inline-flex; align-items: center; gap: 10px; color: var(--cream-light); font-weight: 700; font-size: 16px; }
      .dir-b .b-ala .arr { width: 34px; height: 34px; border-radius: 50%; border: 1.5px solid rgba(255,252,235,.4);
        display: grid; place-items: center; transition: .2s; }
      .dir-b .b-ala:hover .arr { background: var(--green); border-color: var(--green); }
      .dir-b .b-ala .badge-offer { font-size: 11px; padding: 4px 9px; }
      .dir-b .b-hero-photo { position: relative; min-height: 600px; background: #0c241d; }
      .dir-b .b-hero-photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .dir-b .b-hero-tag { position: absolute; left: 28px; bottom: 28px; background: rgba(255,251,239,.94);
        border-radius: var(--r-md); padding: 16px 20px; max-width: 230px; box-shadow: var(--shadow-lg); }
      .dir-b .b-hero-tag b { font-family: var(--display); color: var(--green-dark); font-size: 18px; display: block; }
      .dir-b .b-hero-tag span { font-size: 13px; color: var(--ink-50); }

      .dir-b .b-sec { max-width: 1280px; margin: 0 auto; padding: 110px 56px; }
      .dir-b .b-sechead { max-width: 760px; margin-bottom: 64px; }
      .dir-b .b-sechead h2 { font-size: clamp(36px, 3.6vw, 54px); color: var(--green-dark); }
      .dir-b .b-sechead p { font-size: 20px; color: var(--ink-70); margin-top: 18px; }

      .dir-b .b-diff { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0; border-top: 1px solid var(--sand-line); }
      .dir-b .b-diff-item { padding: 40px 36px 40px 0; border-bottom: 1px solid var(--sand-line); display: flex; gap: 26px; }
      .dir-b .b-diff-item:nth-child(odd) { padding-right: 56px; border-right: 1px solid var(--sand-line); padding-left: 0; }
      .dir-b .b-diff-item:nth-child(even) { padding-left: 56px; }
      .dir-b .b-diff-n { font-family: var(--serif); font-style: italic; font-size: 30px; color: var(--green); line-height: 1; flex: none; }
      .dir-b .b-diff-item h3 { font-size: 24px; color: var(--green-dark); }
      .dir-b .b-diff-item p { font-size: 16px; color: var(--ink-70); margin-top: 10px; }

      .dir-b .b-comp { background: var(--sand); }
      .dir-b .b-ctable { display: grid; grid-template-columns: 1.1fr 1.4fr 1.1fr; max-width: 980px; align-items: stretch; }
      .dir-b .b-col { display: flex; flex-direction: column; }
      .dir-b .b-col.subs { background: #fff; border-radius: var(--r-lg); box-shadow: var(--shadow-lg); overflow: hidden; position: relative; z-index: 1; }
      .dir-b .b-hcell { min-height: 112px; padding: 26px 28px; display: flex; flex-direction: column; justify-content: flex-end; gap: 7px; }
      .dir-b .b-hcell h3 { font-family: var(--serif); font-size: 25px; color: var(--green-dark); line-height: 1.05; }
      .dir-b .b-cmp-ico { margin-bottom: 14px; color: var(--green); }
      .dir-b .b-col.subs .b-cmp-ico { color: #fff; }
      .dir-b .b-col.subs .b-hcell { background: var(--green); }
      .dir-b .b-col.subs .b-hcell h3 { color: #fff; }
      .dir-b .b-reco { font-family: var(--body); font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: rgba(255,255,255,.92); }
      .dir-b .b-cell { padding: 18px 28px; min-height: 78px; display: flex; align-items: center; font-size: 15.5px; border-top: 1px solid var(--sand-line); }
      .dir-b .b-col.feats .b-cell { font-weight: 700; color: var(--green-dark); }
      .dir-b .b-col.subs .b-cell { color: var(--ink); font-weight: 600; border-top-color: #edf1ec; }
      .dir-b .b-col.ala .b-cell { color: var(--ink-70); }

      .dir-b .b-how-row { display: grid; grid-template-columns: 80px 1fr; gap: 30px; padding: 38px 0; border-top: 1px solid var(--sand-line); }
      .dir-b .b-how-row .b-hn { font-family: var(--serif); font-size: 56px; font-style: italic; color: var(--green); line-height: .9; }
      .dir-b .b-how-row h3 { font-size: 30px; color: var(--green-dark); }
      .dir-b .b-how-row p { font-size: 18px; color: var(--ink-70); margin-top: 12px; max-width: 46em; }
      .dir-b .b-how-cta { margin-top: 56px; display: flex; align-items: center; gap: 28px; flex-wrap: wrap; }
      .dir-b .b-how-help { font-size: 16px; color: var(--ink-70); }
      .dir-b .b-how-help a { color: var(--green-700); font-weight: 700; border-bottom: 1px solid var(--green-200); }

      .dir-b .b-team { position: relative; min-height: 640px; display: grid; align-items: center; }
      .dir-b .b-team img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .dir-b .b-team::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(0,71,57,.92) 0%, rgba(0,71,57,.7) 45%, rgba(0,71,57,.15) 100%); }
      .dir-b .b-team-copy { position: relative; z-index: 2; max-width: 1280px; margin: 0 auto; padding: 0 56px; width: 100%; }
      .dir-b .b-team-copy .inner { max-width: 600px; }
      .dir-b .b-team-copy h2 { font-size: clamp(34px, 3.4vw, 50px); color: var(--cream-light); }
      .dir-b .b-team-copy p { font-size: 18px; color: rgba(255,252,235,.85); margin-top: 22px; line-height: 1.65; }

      .dir-b .b-tst { text-align: center; }
      .dir-b .b-tst .stars { color: var(--amber); letter-spacing: 4px; font-size: 18px; }
      .dir-b .b-tst blockquote { font-family: var(--serif); font-size: clamp(28px, 3vw, 42px); line-height: 1.25;
        color: var(--green-dark); margin: 24px auto 26px; max-width: 16em; }
      .dir-b .b-tst .who { font-weight: 700; color: var(--green-700); font-size: 16px; }
      .dir-b .b-tst .dots { display: flex; gap: 8px; justify-content: center; margin-top: 36px; }
      .dir-b .b-tst .dots i { width: 8px; height: 8px; border-radius: 50%; background: var(--sand-line); }
      .dir-b .b-tst .dots i.on { background: var(--green); width: 26px; border-radius: 4px; }

      .dir-b .b-b2b { background: var(--green-dark); color: var(--cream-light); }
      .dir-b .b-b2b-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 70px; align-items: center; max-width: 1280px; margin: 0 auto; padding: 100px 56px; }
      .dir-b .b-b2b h2 { font-size: clamp(34px, 3.4vw, 50px); color: var(--cream-light); }
      .dir-b .b-b2b > .b-b2b-grid > div > p { color: rgba(255,252,235,.8); font-size: 18px; margin-top: 20px; }
      .dir-b .b-b2b .btn { margin-top: 30px; }
      .dir-b .b-b2b-feat { padding: 26px 0; border-top: 1px solid rgba(255,255,255,.16); }
      .dir-b .b-b2b-feat h4 { font-size: 22px; color: var(--cream-light); font-family: var(--serif); font-style: italic; }
      .dir-b .b-b2b-feat p { color: rgba(255,252,235,.75); font-size: 15.5px; margin-top: 8px; }

      .dir-b .b-nl { text-align: center; max-width: 760px; }
      .dir-b .b-nl .badge-offer { margin-bottom: 20px; }
      .dir-b .b-nl h3 { font-family: var(--serif); font-size: clamp(34px, 3.4vw, 48px); color: var(--green-dark); }
      .dir-b .b-nl p { font-size: 18px; color: var(--ink-70); margin: 16px auto 30px; max-width: 30em; }
      .dir-b .b-nl-form { display: flex; gap: 10px; max-width: 480px; margin: 0 auto; border: 1px solid var(--sand-line);
        background: #fff; border-radius: var(--r-pill); padding: 6px 6px 6px 22px; }
      .dir-b .b-nl-form input { flex: 1; border: 0; font-family: var(--body); font-size: 16px; background: transparent; }
      .dir-b .b-nl-form input:focus { outline: none; }

      .dir-b .b-foot { background: var(--green-dark); color: var(--cream-light); }
      .dir-b .b-foot-grid { max-width: 1280px; margin: 0 auto; padding: 80px 56px 30px; display: grid; grid-template-columns: 1.6fr 1fr 1fr 1.2fr; gap: 40px; }
      .dir-b .b-foot h5 { font-family: var(--body); font-weight: 700; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: var(--green-200); margin: 0 0 18px; }
      .dir-b .b-foot ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
      .dir-b .b-foot a, .dir-b .b-foot li { color: rgba(255,252,235,.8); font-size: 15px; }
      .dir-b .b-foot a:hover { color: var(--green); }
      .dir-b .b-foot-logo { height: 26px; filter: brightness(0) invert(1); margin-bottom: 16px; }
      .dir-b .b-foot-tag { font-family: var(--serif); font-style: italic; font-size: 17px; color: rgba(255,252,235,.8); max-width: 22em; }
      .dir-b .b-foot-bottom { max-width: 1280px; margin: 0 auto; padding: 22px 56px; border-top: 1px solid rgba(255,255,255,.12);
        display: flex; justify-content: space-between; font-size: 13px; color: rgba(255,252,235,.5); }
    `}</style>

    <Header />

    <section className="b-hero">
      <div className="b-hero-grid">
        <div className="b-hero-copy">
          <span className="eyebrow">{L('Dietitian + chef, daily', 'Διατροφολόγος + σεφ, καθημερινά')}</span>
          <h1 className="b-h1 b-serif">{L('Forget ', 'Ξέχνα το ')}<em>{L('“what’s for dinner?”', '«Τι θα φάμε σήμερα;»')}</em>{L('. Focus on your goal.', '. Εστίασε στον στόχο σου.')}</h1>
          <p className="b-sub">{L(...C.hero_sub)}</p>
          <div className="b-cta-row">
            <a className="btn btn-primary" href="https://order.fitpal.gr/">{L(...C.cta_goal)}</a>
            <a className="b-ala" href="https://order.fitpal.gr/">
              <span className="arr"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
              {L(...C.cta_ala)}
              <span className="badge-offer">{L(...C.offer_15)}</span>
            </a>
          </div>
        </div>
        <div className="b-hero-photo">
          <img src={plateTuna} alt="Plated tuna and greens" />
          <div className="b-hero-tag">
            <b>{L('Restaurant taste', 'Γεύση εστιατορίου')}</b>
            <span>{L('home-cooked care, dietitian precision', 'φροντίδα σπιτικού, ακρίβεια διατροφολόγου')}</span>
          </div>
        </div>
      </div>
    </section>

    <section className="b-sec">
      <div className="b-sechead"><h2 className="b-serif">{L(...C.diff_h2)}</h2></div>
      <div className="b-diff">
        {([[C.diff1_t, C.diff1_b], [C.diff2_t, C.diff2_b], [C.diff3_t, C.diff3_b], [C.diff4_t, C.diff4_b]] as Array<[[string, string], [string, string]]>).map((d, i) => (
          <div className="b-diff-item" key={i}>
            <div className="b-diff-n">{'0' + (i + 1)}</div>
            <div><h3>{L(...d[0])}</h3><p>{L(...d[1])}</p></div>
          </div>
        ))}
      </div>
    </section>

    <section className="b-comp">
      <div className="b-sec" style={{ paddingTop: 100, paddingBottom: 100 }}>
        <div className="b-sechead"><h2 className="b-serif">{L(...C.comp_h2)}</h2><p>{L(...C.comp_sub)}</p></div>
        <div className="b-ctable">
          <div className="b-col feats">
            <div className="b-hcell"><h3>{L(...C.comp_col0)}</h3></div>
            {([C.comp_r1, C.comp_r2, C.comp_r3, C.comp_r4, C.comp_r5, C.comp_r6] as Array<[string, string]>).map((r, i) => (
              <div className="b-cell" key={i}>{L(...r)}</div>
            ))}
          </div>
          <div className="b-col subs">
            <div className="b-hcell">
              <span className="b-cmp-ico"><FpIcon name="repeat" size={28} stroke={1.6} /></span>
              <span className="b-reco">{L(...C.comp_reco)}</span>
              <h3>{L(...C.comp_subs)}</h3>
            </div>
            {([C.comp_r1a, C.comp_r2a, C.comp_r3a, C.comp_r4a, C.comp_r5a, C.comp_r6a] as Array<[string, string]>).map((r, i) => (
              <div className="b-cell" key={i}>{L(...r)}</div>
            ))}
          </div>
          <div className="b-col ala">
            <div className="b-hcell">
              <span className="b-cmp-ico"><FpIcon name="cloche" size={28} stroke={1.6} /></span>
              <h3 style={{ fontSize: 22 }}>{L(...C.comp_ala)}</h3>
            </div>
            {([C.comp_r1b, C.comp_r2b, C.comp_r3b, C.comp_r4b, C.comp_r5b, C.comp_r6b] as Array<[string, string]>).map((r, i) => (
              <div className="b-cell" key={i}>{L(...r)}</div>
            ))}
          </div>
        </div>
      </div>
    </section>

    {/* MENU SAMPLE — echoes the order site */}
    <MenuSample bg="var(--cream-light)" />

    <section className="b-sec">
      <div className="b-sechead"><h2 className="b-serif">{L(...C.how_h2)}</h2><p>{L(...C.how_sub)}</p></div>
      {([[C.how1_t, C.how1_b], [C.how2_t, C.how2_b], [C.how3_t, C.how3_b], [C.how4_t, C.how4_b]] as Array<[[string, string], [string, string]]>).map((s, i) => (
        <div className="b-how-row" key={i}>
          <div className="b-hn">{'0' + (i + 1)}</div>
          <div><h3 className="b-serif">{L(...s[0])}</h3><p>{L(...s[1])}</p></div>
        </div>
      ))}
      <div className="b-how-cta">
        <a className="btn btn-primary" href="#">{L(...C.how_cta)}</a>
        <p className="b-how-help">{L(...C.how_help)} <a href="#">{L(...C.how_call)}</a> {L(...C.or)} <a href="https://wa.me/306937109396">{L(...C.whatsapp)}</a></p>
      </div>
    </section>

    <section className="b-team">
      <img src={bananaBread} alt="Freshly baked banana bread" />
      <div className="b-team-copy"><div className="inner">
        <span className="eyebrow" style={{ color: 'var(--green-200)' }}>{L('Science meets gastronomy', 'Επιστήμη + γαστρονομία')}</span>
        <h2 className="b-serif" style={{ marginTop: 16 }}>{L(...C.team_h2)}</h2>
        <p>{L(...C.team_body)}</p>
      </div></div>
    </section>

    <section className="b-sec b-tst">
      <div className="stars">★★★★★</div>
      <blockquote className="b-serif">{L(...C.t1)}</blockquote>
      <div className="who">{L(...C.t1n)}</div>
      <div className="dots"><i className="on"></i><i></i><i></i></div>
    </section>

    <section className="b-b2b">
      <div className="b-b2b-grid">
        <div>
          <span className="eyebrow" style={{ color: 'var(--green-200)' }}>Fitpal B2B</span>
          <h2 className="b-serif" style={{ marginTop: 16 }}>{L(...C.b2b_h2)}</h2>
          <p>{L(...C.b2b_body)}</p>
          <a className="btn btn-primary" href="#">{L(...C.b2b_cta)}</a>
        </div>
        <div>
          <div className="b-b2b-feat"><h4>{L(...C.b2b1_t)}</h4><p>{L(...C.b2b1_b)}</p></div>
          <div className="b-b2b-feat"><h4>{L(...C.b2b2_t)}</h4><p>{L(...C.b2b2_b)}</p></div>
        </div>
      </div>
    </section>

    <section className="b-sec b-nl">
      <span className="badge-offer">-15%</span>
      <h3>{L(...C.nl_h3)}</h3>
      <p>{L(...C.nl_body)}</p>
      <div className="b-nl-form">
        <input type="email" aria-label="email" />
        <button className="btn btn-primary" type="button">{L(...C.nl_btn)}</button>
      </div>
    </section>

    <footer className="b-foot">
      <div className="b-foot-grid">
        <div>
          <img className="b-foot-logo" src={logoWordmark} alt="Fitpal Meals" />
          <p className="b-foot-tag">{L(...C.f_tag)}</p>
        </div>
        <div><h5>{L(...C.f_c2)}</h5><ul><li><a href="#">{L(...C.f_subs)}</a></li><li><a href="#">{L(...C.f_menu)}</a></li><li><a href="#">{L(...C.f_corp)}</a></li></ul></div>
        <div><h5>{L(...C.f_c3)}</h5><ul><li><a href="#">{L(...C.f_about)}</a></li><li><a href="#">{L(...C.f_faq)}</a></li><li><a href="#">{L(...C.f_terms)}</a></li></ul></div>
        <div><h5>{L(...C.f_c4)}</h5><ul><li><a href="tel:+302104253929">+30 210 425 3929</a></li><li><a href="https://wa.me/306937109396">WhatsApp</a></li><li><a href="mailto:support@fitpal.gr">support@fitpal.gr</a></li><li>{L(...C.f_hours)}</li></ul></div>
      </div>
      <div className="b-foot-bottom"><span>{L(...C.f_rights)}</span><span>Made in Athens 🇬🇷</span></div>
    </footer>
  </div>
);

export default V2;
