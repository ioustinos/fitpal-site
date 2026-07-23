/* ===========================================================
   DIRECTION C — "Energetic / Bold"
   High-contrast green blocks, oversized type, stat-forward.
   Space Grotesk labels. Fitness energy, momentum.
   =========================================================== */
import { FC, ReactNode } from 'react';
import { L, C } from './content';
import LangSwitch from './LangSwitch';
import FpIcon, { FpIconName } from './FpIcon';
import MenuSample from './MenuSample';
import Wave from './Wave';
import './designSystem.scss';

import logoWordmark from 'app/assets/designs/logo-wordmark.svg';
import fabaImg from 'app/assets/designs/dishes/faba.png';
import plateTuna from 'app/assets/designs/photos/plate-tuna.jpg';

const Header: FC = () => (
  <header className="c-hdr">
    <img className="c-logo" src={logoWordmark} alt="Fitpal Meals" />
    <nav className="c-nav">
      <a href="#">{L(...C.nav_subs)}</a>
      <a href="#">{L(...C.nav_ala)}</a>
      <a href="#">{L(...C.nav_b2b)}</a>
      <a href="#">{L(...C.nav_team)}</a>
    </nav>
    <div className="c-hdr-cta">
      {/* WEC-560: no Login/Register on landing — accounts live on the order site. */}
      <a className="btn btn-primary c-start" href="https://order.fitpal.gr/">{L(...C.nav_start)}</a>
    </div>
  </header>
);

const V3: FC = () => (
  <div className="fp dir-c">
    <LangSwitch />
    <style>{`
      .dir-c { background: var(--cream-light); }
      .dir-c .c-kicker { font-family: var(--mono); font-weight: 700; font-size: 12px; letter-spacing: .22em;
        text-transform: uppercase; }

      .dir-c .c-hdr { position: sticky; top: 0; z-index: 40; display: flex; align-items: center; gap: 32px;
        padding: 16px 48px; background: var(--green-dark); }
      .dir-c .c-logo { height: 28px; filter: brightness(0) invert(1); }
      .dir-c .c-nav { display: flex; gap: 28px; margin-left: 12px; }
      .dir-c .c-nav a { font-weight: 700; font-size: 15px; color: rgba(255,252,235,.82); }
      .dir-c .c-nav a:hover { color: var(--green); }
      .dir-c .c-hdr-cta { margin-left: auto; display: flex; align-items: center; gap: 20px; }
      .dir-c .c-login { color: var(--cream-light); font-weight: 700; font-size: 15px; }
      .dir-c .c-start { padding: 11px 22px; font-size: 15px; }

      .dir-c .c-hero { background: var(--green); color: #fff; position: relative; overflow: hidden; }
      .dir-c .c-hero::before { content: ""; position: absolute; width: 130%; height: 80%; left: -15%; bottom: -30%;
        background: var(--green-700); border-radius: 50%; opacity: .5; }
      .dir-c .c-hero-grid { position: relative; z-index: 2; display: grid; grid-template-columns: 1.1fr .9fr; gap: 30px;
        align-items: center; max-width: 1240px; margin: 0 auto; padding: 80px 48px 90px; }
      .dir-c .c-kicker.hero { color: rgba(255,255,255,.85); }
      .dir-c .c-h1 { font-size: clamp(50px, 5.6vw, 88px); line-height: .96; color: #fff; margin-top: 18px; text-transform: none; }
      .dir-c .c-sub { font-size: 21px; color: rgba(255,255,255,.92); margin-top: 24px; max-width: 26em; font-weight: 500; }
      .dir-c .c-cta-row { display: flex; align-items: center; gap: 16px; margin-top: 34px; flex-wrap: wrap; }
      .dir-c .c-hero .btn-primary { background: var(--green-dark); box-shadow: 0 12px 26px -10px rgba(0,0,0,.5); }
      .dir-c .c-hero .btn-primary:hover { background: #06352a; }
      .dir-c .c-ala { position: relative; }
      .dir-c .c-hero .btn-white { background: #fff; color: var(--green-dark); }
      .dir-c .c-ala .badge-offer { position: absolute; bottom: calc(100% + 8px); right: 0; top: auto; transform: rotate(4deg);
        white-space: nowrap; font-size: 12px; padding: 5px 11px; }
      .dir-c .c-hero-vis { position: relative; display: grid; place-items: center; min-height: 420px; }
      .dir-c .c-disc { position: absolute; width: 380px; height: 380px; border-radius: 50%; background: var(--cream); }
      .dir-c .c-plate { position: relative; width: 420px; max-width: 100%; filter: drop-shadow(0 30px 40px rgba(0,0,0,.35));
        animation: c-spin var(--fp-spin, 26s) linear infinite; }
      @keyframes c-spin { to { transform: rotate(360deg); } }
      .dir-c .c-statband { position: relative; z-index: 2; background: var(--green-dark); }
      .dir-c .c-statband-inner { max-width: 1240px; margin: 0 auto; padding: 30px 48px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
      .dir-c .c-stat b { font-family: var(--display); font-size: 46px; color: var(--green); line-height: 1; display: block; }
      .dir-c .c-stat span { font-family: var(--mono); font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: rgba(255,252,235,.7); }

      .dir-c .c-sec { max-width: 1240px; margin: 0 auto; padding: 100px 48px; }
      .dir-c .c-sechead { max-width: 740px; margin-bottom: 52px; }
      .dir-c .c-sechead h2 { font-size: clamp(38px, 4.2vw, 60px); color: var(--green-dark); line-height: 1; }
      .dir-c .c-sechead p { font-size: 20px; color: var(--ink-70); margin-top: 18px; }

      .dir-c .c-grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
      .dir-c .c-block { border-radius: var(--r-lg); padding: 30px 26px; min-height: 250px; display: flex; flex-direction: column; }
      .dir-c .c-block .bn { font-family: var(--mono); font-weight: 700; font-size: 13px; letter-spacing: .1em; }
      .dir-c .c-block h3 { font-size: 24px; margin-top: auto; }
      .dir-c .c-block p { font-size: 15px; margin-top: 10px; }
      .dir-c .c-block.k0 { background: var(--green-dark); color: var(--cream-light); }
      .dir-c .c-block.k0 .bn { color: var(--green); } .dir-c .c-block.k0 h3 { color: #fff; } .dir-c .c-block.k0 p { color: rgba(255,252,235,.75); }
      .dir-c .c-block.k1 { background: var(--green); color: #fff; } .dir-c .c-block.k1 .bn { color: rgba(255,255,255,.7); } .dir-c .c-block.k1 p { color: rgba(255,255,255,.9); }
      .dir-c .c-block.k2 { background: var(--cream); color: var(--green-dark); } .dir-c .c-block.k2 .bn { color: var(--amber-deep); } .dir-c .c-block.k2 p { color: var(--ink-70); }
      .dir-c .c-block.k3 { background: var(--green-dark); color: var(--cream-light); } .dir-c .c-block.k3 .bn { color: var(--green); } .dir-c .c-block.k3 h3 { color: #fff; } .dir-c .c-block.k3 p { color: rgba(255,252,235,.75); }

      .dir-c .c-comp { background: var(--sand); }
      .dir-c .c-table { display: grid; grid-template-columns: 1fr 1.3fr 1fr; max-width: 1000px; margin: 0 auto;
        border-radius: var(--r-lg); overflow: hidden; box-shadow: var(--shadow-lg); }
      .dir-c .c-tcol { display: flex; flex-direction: column; }
      .dir-c .c-tcol.win { background: var(--green); color: #fff; transform: scale(1.0); }
      .dir-c .c-tcol.plain { background: #fff; }
      .dir-c .c-tcol.feats { background: var(--green-dark); color: var(--cream-light); }
      .dir-c .c-th { padding: 26px; min-height: 108px; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
      .dir-c .c-th h3 { font-size: 24px; color: inherit; }
      .dir-c .c-tcol.feats .c-th h3 { color: #fff; }
      .dir-c .c-creco { font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: rgba(255,255,255,.85); }
      .dir-c .c-td { padding: 18px 26px; font-size: 15.5px; min-height: 76px; display: flex; align-items: center; border-top: 1px solid rgba(0,0,0,.06); }
      .dir-c .c-tcol.win .c-td { border-top: 1px solid rgba(255,255,255,.18); font-weight: 600; }
      .dir-c .c-tcol.feats .c-td { border-top: 1px solid rgba(255,255,255,.12); font-weight: 700; }
      .dir-c .c-tcol.plain .c-td { color: var(--ink-70); }
      .dir-c .c-cmp-ico { width: 50px; height: 50px; border-radius: 15px; display: grid; place-items: center; margin-bottom: 12px; }
      .dir-c .c-tcol.win .c-cmp-ico { background: rgba(255,255,255,.2); color: #fff; }
      .dir-c .c-tcol.plain .c-cmp-ico { background: var(--green-dark); color: var(--green); }

      .dir-c .c-how { background: var(--green-dark); color: var(--cream-light); }
      .dir-c .c-how .c-sechead h2 { color: #fff; } .dir-c .c-how .c-sechead p { color: rgba(255,252,235,.72); }
      .dir-c .c-how-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
      .dir-c .c-hstep { border-top: 4px solid var(--green); padding-top: 22px; }
      .dir-c .c-hstep-top { display: flex; align-items: center; gap: 14px; }
      .dir-c .c-hstep-ico { width: 50px; height: 50px; border-radius: 14px; background: var(--green); color: #06342a; display: grid; place-items: center; flex: none; }
      .dir-c .c-hstep .n { font-family: var(--display); font-size: 54px; color: var(--green); line-height: 1; }
      .dir-c .c-hstep h3 { font-size: 22px; color: #fff; margin-top: 8px; }
      .dir-c .c-hstep p { font-size: 15px; color: rgba(255,252,235,.72); margin-top: 10px; }
      .dir-c .c-how-cta { margin-top: 48px; display: flex; align-items: center; gap: 26px; flex-wrap: wrap; }
      .dir-c .c-how-help { color: rgba(255,252,235,.8); font-size: 16px; }
      .dir-c .c-how-help a { color: var(--green); font-weight: 700; }

      .dir-c .c-team .c-sec { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }
      .dir-c .c-team-photo { border-radius: var(--r-lg); overflow: hidden; aspect-ratio: 1/1; box-shadow: var(--shadow-lg); }
      .dir-c .c-team-photo img { width: 100%; height: 100%; object-fit: cover; }
      .dir-c .c-team h2 { font-size: clamp(34px, 3.6vw, 52px); color: var(--green-dark); line-height: 1; }
      .dir-c .c-team p { font-size: 18px; color: var(--ink-70); margin-top: 20px; }

      .dir-c .c-tst-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
      .dir-c .c-tcard { border-radius: var(--r-lg); padding: 30px 26px; background: var(--green-dark); color: var(--cream-light); }
      .dir-c .c-tcard:nth-child(2) { background: var(--green); }
      .dir-c .c-tcard .stars { color: var(--amber); letter-spacing: 2px; margin-bottom: 14px; }
      .dir-c .c-tcard p { font-family: var(--display); font-size: 21px; line-height: 1.3; color: #fff; }
      .dir-c .c-tcard .who { display: block; margin-top: 16px; font-family: var(--mono); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: rgba(255,252,235,.7); }

      .dir-c .c-b2b-inner { background: var(--green); color: #fff; border-radius: var(--r-xl); padding: 56px;
        display: grid; grid-template-columns: 1fr 1fr; gap: 50px; align-items: center; max-width: 1100px; margin: 0 auto; }
      .dir-c .c-b2b h2 { font-size: clamp(34px, 3.4vw, 48px); color: #fff; line-height: 1; }
      .dir-c .c-b2b-inner > div > p { color: rgba(255,255,255,.9); font-size: 17px; margin-top: 16px; }
      .dir-c .c-b2b .btn-white { background: #fff; color: var(--green-dark); margin-top: 26px; }
      .dir-c .c-b2b-feat { background: rgba(255,255,255,.13); border-radius: var(--r-md); padding: 22px 24px; }
      .dir-c .c-b2b-feat + .c-b2b-feat { margin-top: 16px; }
      .dir-c .c-b2b-feat h4 { font-size: 19px; color: #fff; } .dir-c .c-b2b-feat p { color: rgba(255,255,255,.85); font-size: 14.5px; margin-top: 6px; }

      .dir-c .c-nl-inner { background: var(--green-dark); color: var(--cream-light); border-radius: var(--r-xl); padding: 60px; text-align: center; max-width: 820px; margin: 0 auto; }
      .dir-c .c-nl h3 { font-size: clamp(34px, 3.6vw, 50px); color: #fff; }
      .dir-c .c-nl p { font-size: 18px; color: rgba(255,252,235,.78); margin: 14px auto 28px; max-width: 30em; }
      .dir-c .c-nl-form { display: flex; gap: 12px; max-width: 480px; margin: 0 auto; }
      .dir-c .c-nl-form input { flex: 1; border: 0; border-radius: var(--r-pill); padding: 15px 22px; font-family: var(--body); font-size: 16px; }
      .dir-c .c-nl-form input:focus { outline: 2px solid var(--green); }

      .dir-c .c-foot { background: #06342a; color: var(--cream-light); padding: 70px 0 28px; }
      .dir-c .c-foot-grid { max-width: 1240px; margin: 0 auto; padding: 0 48px; display: grid; grid-template-columns: 1.6fr 1fr 1fr 1.2fr; gap: 40px; }
      .dir-c .c-foot h5 { font-family: var(--mono); font-weight: 700; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--green); margin: 0 0 18px; }
      .dir-c .c-foot ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
      .dir-c .c-foot a, .dir-c .c-foot li { color: rgba(255,252,235,.8); font-size: 15px; }
      .dir-c .c-foot a:hover { color: var(--green); }
      .dir-c .c-foot-logo { height: 26px; filter: brightness(0) invert(1); margin-bottom: 16px; }
      .dir-c .c-foot-tag { font-size: 16px; color: rgba(255,252,235,.78); max-width: 24em; }
      .dir-c .c-foot-bottom { max-width: 1240px; margin: 40px auto 0; padding: 22px 48px 0; border-top: 1px solid rgba(255,255,255,.12); display: flex; justify-content: space-between; font-size: 13px; color: rgba(255,252,235,.5); }
    `}</style>

    <Header />

    <section className="c-hero">
      <div className="c-hero-grid">
        <div>
          <span className="c-kicker hero">{L('Dietitian + chef · daily', 'Διατροφολόγος + σεφ · καθημερινά')}</span>
          <h1 className="c-h1">{L(...C.hero_h1)}</h1>
          <p className="c-sub">{L(...C.hero_sub)}</p>
          <div className="c-cta-row">
            <a className="btn btn-primary" href="https://order.fitpal.gr/">{L(...C.cta_goal)}</a>
            <span className="c-ala">
              <a className="btn btn-white" href="https://order.fitpal.gr/">{L(...C.cta_ala)}</a>
              <span className="badge-offer">{L(...C.offer_15)}</span>
            </span>
          </div>
        </div>
        <div className="c-hero-vis">
          <div className="c-disc"></div>
          <img className="c-plate" src={fabaImg} alt="Chicken with saffron rice" />
        </div>
      </div>
      <div className="c-statband">
        <div className="c-statband-inner">
          {([['300+', L('meal options', 'επιλογές γευμάτων')], ['20%', L('cheaper on plans', 'φθηνότερα στα πλάνα')], ['2h', L('delivery slots', '2ωρα παράδοσης')], ['0', L('prep needed', 'prep')]] as Array<[string, ReactNode]>).map((s, i) => (
            <div className="c-stat" key={i}><b>{s[0]}</b><span>{s[1]}</span></div>
          ))}
        </div>
      </div>
    </section>

    <section className="c-sec">
      <div className="c-sechead"><h2>{L(...C.diff_h2)}</h2></div>
      <div className="c-grid4">
        {([[C.diff1_t, C.diff1_b], [C.diff2_t, C.diff2_b], [C.diff3_t, C.diff3_b], [C.diff4_t, C.diff4_b]] as Array<[[string, string], [string, string]]>).map((d, i) => (
          <div className={`c-block k${i}`} key={i}>
            <span className="bn">{'0' + (i + 1)}</span>
            <h3>{L(...d[0])}</h3>
            <p>{L(...d[1])}</p>
          </div>
        ))}
      </div>
    </section>

    <section className="c-comp">
      <div className="c-sec">
        <div className="c-sechead"><h2>{L(...C.comp_h2)}</h2><p>{L(...C.comp_sub)}</p></div>
        <div className="c-table">
          <div className="c-tcol feats">
            <div className="c-th"><h3>{L(...C.comp_col0)}</h3></div>
            {([C.comp_r1, C.comp_r2, C.comp_r3, C.comp_r4, C.comp_r5, C.comp_r6] as Array<[string, string]>).map((r, i) => <div className="c-td" key={i}>{L(...r)}</div>)}
          </div>
          <div className="c-tcol win">
            <div className="c-th">
              <span className="c-cmp-ico"><FpIcon name="repeat" size={26} /></span>
              <span className="c-creco">{L(...C.comp_reco)}</span>
              <h3>{L(...C.comp_subs)}</h3>
            </div>
            {([C.comp_r1a, C.comp_r2a, C.comp_r3a, C.comp_r4a, C.comp_r5a, C.comp_r6a] as Array<[string, string]>).map((r, i) => <div className="c-td" key={i}>{L(...r)}</div>)}
          </div>
          <div className="c-tcol plain">
            <div className="c-th">
              <span className="c-cmp-ico"><FpIcon name="cloche" size={26} /></span>
              <h3 style={{ color: 'var(--green-dark)' }}>{L(...C.comp_ala)}</h3>
            </div>
            {([C.comp_r1b, C.comp_r2b, C.comp_r3b, C.comp_r4b, C.comp_r5b, C.comp_r6b] as Array<[string, string]>).map((r, i) => <div className="c-td" key={i}>{L(...r)}</div>)}
          </div>
        </div>
      </div>
    </section>

    {/* MENU SAMPLE — echoes the order site */}
    <MenuSample bg="var(--sand)" />

    <Wave from="var(--sand)" to="var(--green-dark)" />

    <section className="c-how">
      <div className="c-sec">
        <div className="c-sechead"><h2>{L(...C.how_h2)}</h2><p>{L(...C.how_sub)}</p></div>
        <div className="c-how-grid">
          {([[C.how1_t, C.how1_b, 'target'], [C.how2_t, C.how2_b, 'calendar'], [C.how3_t, C.how3_b, 'chef'], [C.how4_t, C.how4_b, 'pause']] as Array<[[string, string], [string, string], FpIconName]>).map((s, i) => (
            <div className="c-hstep" key={i}>
              <div className="c-hstep-top">
                <span className="c-hstep-ico"><FpIcon name={s[2]} size={26} /></span>
                <div className="n">{'0' + (i + 1)}</div>
              </div>
              <h3>{L(...s[0])}</h3>
              <p>{L(...s[1])}</p>
            </div>
          ))}
        </div>
        <div className="c-how-cta">
          <a className="btn btn-primary" href="#">{L(...C.how_cta)}</a>
          <p className="c-how-help">{L(...C.how_help)} <a href="#">{L(...C.how_call)}</a> {L(...C.or)} <a href="https://wa.me/306937109396">{L(...C.whatsapp)}</a></p>
        </div>
      </div>
    </section>

    <Wave from="var(--green-dark)" to="var(--cream-light)" />

    <section className="c-team">
      <div className="c-sec">
        <div>
          <span className="c-kicker" style={{ color: 'var(--green-700)' }}>{L('Your nutrition team', 'Η ομάδα σου')}</span>
          <h2 style={{ marginTop: 14 }}>{L(...C.team_h2)}</h2>
          <p>{L(...C.team_body)}</p>
        </div>
        <div className="c-team-photo"><img src={plateTuna} alt="Plated dish" /></div>
      </div>
    </section>

    <section className="c-sec" style={{ paddingTop: 0 }}>
      <div className="c-tst-grid">
        {([[C.t1, C.t1n], [C.t2, C.t2n], [C.t3, C.t3n]] as Array<[[string, string], [string, string]]>).map((t, i) => (
          <div className="c-tcard" key={i}><div className="stars">★★★★★</div><p>{L(...t[0])}</p><span className="who">{L(...t[1])}</span></div>
        ))}
      </div>
    </section>

    <section className="c-sec" style={{ paddingTop: 0 }}>
      <div className="c-b2b">
        <div className="c-b2b-inner">
          <div>
            <span className="c-kicker" style={{ color: 'rgba(255,255,255,.8)' }}>Fitpal B2B</span>
            <h2 style={{ marginTop: 14 }}>{L(...C.b2b_h2)}</h2>
            <p>{L(...C.b2b_body)}</p>
            <a className="btn btn-white" href="#">{L(...C.b2b_cta)}</a>
          </div>
          <div>
            <div className="c-b2b-feat"><h4>{L(...C.b2b1_t)}</h4><p>{L(...C.b2b1_b)}</p></div>
            <div className="c-b2b-feat"><h4>{L(...C.b2b2_t)}</h4><p>{L(...C.b2b2_b)}</p></div>
          </div>
        </div>
      </div>
    </section>

    <section className="c-sec" style={{ paddingTop: 0 }}>
      <div className="c-nl-inner">
        <span className="badge-offer" style={{ marginBottom: 18 }}>-15%</span>
        <h3>{L(...C.nl_h3)}</h3>
        <p>{L(...C.nl_body)}</p>
        <div className="c-nl-form"><input type="email" aria-label="email" /><button className="btn btn-primary" type="button">{L(...C.nl_btn)}</button></div>
      </div>
    </section>

    <footer className="c-foot">
      <div className="c-foot-grid">
        <div>
          <img className="c-foot-logo" src={logoWordmark} alt="Fitpal Meals" />
          <p className="c-foot-tag">{L(...C.f_tag)}</p>
        </div>
        <div><h5>{L(...C.f_c2)}</h5><ul><li><a href="#">{L(...C.f_subs)}</a></li><li><a href="#">{L(...C.f_menu)}</a></li><li><a href="#">{L(...C.f_corp)}</a></li></ul></div>
        <div><h5>{L(...C.f_c3)}</h5><ul><li><a href="#">{L(...C.f_about)}</a></li><li><a href="#">{L(...C.f_faq)}</a></li><li><a href="#">{L(...C.f_terms)}</a></li></ul></div>
        <div><h5>{L(...C.f_c4)}</h5><ul><li><a href="tel:+302104253929">+30 210 425 3929</a></li><li><a href="https://wa.me/306937109396">WhatsApp</a></li><li><a href="mailto:support@fitpal.gr">support@fitpal.gr</a></li><li>{L(...C.f_hours)}</li></ul></div>
      </div>
      <div className="c-foot-bottom"><span>{L(...C.f_rights)}</span><span>Made in Athens 🇬🇷</span></div>
    </footer>
  </div>
);

export default V3;
