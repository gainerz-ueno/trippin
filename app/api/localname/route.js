// 「候補に追加」したお店だけ、現地の言語の店名・住所を取る（Grab・Uber に貼る用）
// 検索のときに全部取ると1件ごとに料金がかかるので、追加したお店だけにした（docs/マネタイズ根拠.md）
import { KEY, LANGS, detailsIn, alts, fillTranslations } from '../../lib/places';
import { str } from '../../lib/validate';
import { friendly } from '../../lib/gfetch';

export async function POST(req) {
  if (!KEY()) return Response.json({ error: '検索の設定がまだ終わっていません（運営者の設定待ち）' }, { status: 500 });
  try {
    const body = await req.json().catch(() => null);
    const id = typeof body?.id === 'string' ? body.id : '';
    const lang = typeof body?.lang === 'string' ? body.lang : '';
    if (id.length > 300 || !/^[A-Za-z0-9_-]+$/.test(id) || !(LANGS.includes(lang) || lang === 'en') || lang === 'ja') {
      return Response.json({ error: 'お店の指定が正しくありません' }, { status: 400 });
    }
    const jaName = str(body?.jaName, 100);
    const lp = await detailsIn(id, lang);
    if (!lp?.id) return Response.json({ error: '現地の表記を取れませんでした' }, { status: 502 });
    const name = lp.displayName?.text || jaName;
    const address = lp.formattedAddress || '';
    const [out] = await fillTranslations([{ name, address, ...alts(name, address, jaName, lang, true) }]);
    return Response.json({ name: out.name, address: out.address, altName: out.altName, altAddress: out.altAddress });
  } catch (e) {
    return Response.json({ error: friendly(e, '現地の表記を取れませんでした') }, { status: 502 });
  }
}
