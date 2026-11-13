// 昔の形（上の段＝「買い物」「朝ごはん」などのフォルダ）→ 新しい形（旅先フォルダー × カテゴリー）への変換。
// 画面を使わない関数だけ。`node --test` で試せる。変換でお店・お土産・メモ・回る順番は1件も消さない。
import { cleanCustomCats } from './cats.mjs';

export const UNSORTED = '未分類';

// 昔の上の段の名前 → 新しいカテゴリー
export const LEGACY_FOLDER_TO_CAT = {
  '買い物': '買物', '買物': '買物', 'ショッピング': '買物',
  '朝ごはん': '朝食', '朝ご飯': '朝食', '朝食': '朝食', 'モーニング': '朝食',
  '昼ごはん': '昼食', '昼ご飯': '昼食', '昼食': '昼食', 'ランチ': '昼食',
  '夜ごはん': '夕食', '夜ご飯': '夕食', '晩ごはん': '夕食', '晩ご飯': '夕食', '夕ごはん': '夕食', '夕ご飯': '夕食', '夕食': '夕食', 'ディナー': '夕食',
  '夜食': '夜食',
  'おやつ': 'おやつ', 'スイーツ': 'おやつ', 'デザート': 'おやつ',
  'カフェ': 'カフェ',
  '観光': '観光', '観光地': '観光', '名所': '観光',
  '遊ぶ': '遊ぶ', '遊び': '遊ぶ', '娯楽': '遊ぶ', 'アクティビティ': '遊ぶ',
  '朝市': '朝市', '夜市': '夜市',
  '酒場': '酒場', 'お酒': '酒場', 'バー': '酒場', '居酒屋': '酒場',
  '美容': '美容', 'エステ': '美容', 'マッサージ': 'マッサージ',
};

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const legacyCat = (name) => (typeof name === 'string' && has(LEGACY_FOLDER_TO_CAT, name.trim()) ? LEGACY_FOLDER_TO_CAT[name.trim()] : null);
export const isLegacyFolder = (name) => legacyCat(name) !== null;

// お店：旅先が空 → 未分類。昔の上の段の名前 → カテゴリーへ寄せて、旅先は未分類。
// すでにカテゴリーが付いているお店は、そのカテゴリーを残す。件数は変わらない。
export function migrateItems(items, now = Date.now()) {
  return (items || []).map((it) => {
    const cat = legacyCat(it.trip);
    if (cat) return { ...it, category: it.category || cat, trip: UNSORTED, updatedAt: now };
    if (!it.trip) return { ...it, trip: UNSORTED };
    return it;
  });
}

// 旅先フォルダーの一覧：昔の上の段の名前と「未分類」を除き、重ならないようにする（未分類は画面側で必ず先頭に出す）
export function migrateFolderList(folders) {
  return [...new Set((folders || []).filter((f) => f && f !== UNSORTED && !isLegacyFolder(f)))];
}

// お土産：昔の上の段の名前の旅 → 未分類
export function migrateSouvenirs(list, now = Date.now()) {
  return (list || []).map((x) => (isLegacyFolder(x.trip) ? { ...x, trip: UNSORTED, updatedAt: now } : x));
}

// フォルダ名をキーにした表（eタビセツ・回る順番）：昔の名前のキーは、未分類がまだ空なら未分類へ移す。
// 未分類にすでにあるときは、消さず昔のキーのまま残す（見えないだけで失わない）
export function migrateKeyed(obj) {
  const out = { ...(obj || {}) };
  for (const k of Object.keys(out)) {
    if (isLegacyFolder(k) && !out[UNSORTED]) { out[UNSORTED] = out[k]; delete out[k]; }
  }
  return out;
}

// カテゴリー一覧（自分で作ったもの）：基本と同じ名前・重なりを除く
export const migrateCustomCats = cleanCustomCats;

// まとめて変換
export function migrateAll({ items, folders, customCats, souvenirs, notes, plans }, now = Date.now()) {
  return {
    items: migrateItems(items, now),
    folders: migrateFolderList(folders),
    customCats: migrateCustomCats(customCats),
    souvenirs: migrateSouvenirs(souvenirs, now),
    notes: migrateKeyed(notes),
    plans: migrateKeyed(plans),
  };
}

// 旅先フォルダーの削除：中のお店・お土産は消さず「未分類」へ戻す。
// eタビセツ・回る順番は、未分類がまだ空なら未分類へ移す（すでにあるときは削除するフォルダのものは外す）
export function removeFolder({ items, souvenirs, notes, plans }, name, now = Date.now()) {
  if (!name || name === UNSORTED) return { items, souvenirs, notes, plans };
  const move = (o) => {
    const { [name]: gone, ...rest } = o || {};
    if (gone && !rest[UNSORTED]) rest[UNSORTED] = gone;
    return rest;
  };
  return {
    items: (items || []).map((i) => (i.trip === name ? { ...i, trip: UNSORTED, updatedAt: now } : i)),
    souvenirs: (souvenirs || []).map((x) => (x.trip === name ? { ...x, trip: UNSORTED, updatedAt: now } : x)),
    notes: move(notes),
    plans: move(plans),
  };
}
