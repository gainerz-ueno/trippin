'use client';
// ガイドブックの表紙（テンプレートで作る）。幅1080pxで作って、そのまま画像にする
import { fontOf } from './fonts';
import { sizeOf, PAD, Ph, Title } from './NoteCanvas';

export default function CoverCanvas({ cover, photoUrl, nodeRef }) {
  const size = sizeOf(cover.size);
  const tpl = PAD[cover.tpl] ? cover.tpl : 'lovely';
  const f = fontOf(cover.font);
  const [pt, pr, pb, pl] = PAD[tpl][size.id];
  const tl = [...(cover.title || '')].length;
  const tfs = tl <= 6 ? 104 : tl <= 9 ? 88 : tl <= 12 ? 72 : 58;
  return (
    <div ref={nodeRef} className={`nt cv ${tpl} ${size.id}`} style={{
      width: size.w, height: size.h, padding: `${pt}px ${pr}px ${pb}px ${pl}px`,
      backgroundImage: `url(/note/${tpl}-${size.id}.jpg)`,
      fontFamily: `"${f.family}", "Zen Maru Gothic", sans-serif`, '--tfs': tfs + 'px',
    }}>
      <header className="cv-head">
        <p className="cv-kicker">TRAVEL GUIDE BOOK</p>
        <Title note={{ title: cover.title }} tpl={tpl} />
        {cover.sub && <p className="cv-sub"><span>{cover.sub}</span></p>}
      </header>
      <div className="cv-photo">
        <div className="cv-frame">
          <Ph src={photoUrl} />
          {(tpl === 'notebook' || tpl === 'collage') && <i className="cv-tape" />}
        </div>
        <img className="cv-st" src={`/note/${tpl}-camera.png`} alt="" />
        <img className="cv-st2" src={`/note/${tpl}-suitcase.png`} alt="" />
      </div>
      <footer className="cv-foot">
        <p className="cv-by">{[cover.author && `by ${cover.author}`, cover.date].filter(Boolean).join('　·　')}</p>
        <img className="nt-logo" src="/logo.png" alt="Tabibi" />
      </footer>
    </div>
  );
}
