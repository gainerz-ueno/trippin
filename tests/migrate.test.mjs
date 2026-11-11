// 旅先フォルダー化の変換の試験（`node --test` で動く。動かすのは仕組みの側）
import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_CATS, BASE_CAT_NAMES, allCats, cleanCustomCats } from '../app/lib/cats.mjs';
import { UNSORTED, LEGACY_FOLDER_TO_CAT, legacyCat, migrateItems, migrateFolderList, migrateSouvenirs, migrateKeyed, migrateAll, removeFolder } from '../app/lib/migrate.mjs';

const NOW = 1_800_000_000_000;
const it = (id, trip, category = '', extra = {}) => ({ id, placeId: id, name: id, trip, category, done: false, addedAt: 1, ...extra });

test('3 基本カテゴリーと自作カテゴリーで「マッサージ」は1つだけ', () => {
  const all = allCats(['マッサージ', '屋台', 'マッサージ']);
  assert.equal(all.filter((c) => c === 'マッサージ').length, 1);
  assert.ok(all.includes('屋台'));
  assert.deepEqual(cleanCustomCats(['マッサージ', '屋台', '屋台', '']), ['屋台']);
  assert.equal(new Set(all).size, all.length);
});

test('4 基本カテゴリーに「遊ぶ」があり、色は他と重ならない', () => {
  assert.ok(BASE_CAT_NAMES.includes('遊ぶ'));
  const colors = BASE_CATS.map(([, c]) => c.toLowerCase());
  assert.equal(new Set(colors).size, colors.length);
  // 自分で「遊ぶ」を作っていた人でも1つになる
  assert.equal(allCats(['遊ぶ']).filter((c) => c === '遊ぶ').length, 1);
  assert.deepEqual(cleanCustomCats(['遊ぶ']), []);
});

test('2 対応表：買い物→買物、朝ごはん→朝食、昼ごはん→昼食', () => {
  assert.equal(legacyCat('買い物'), '買物');
  assert.equal(legacyCat('朝ごはん'), '朝食');
  assert.equal(legacyCat('昼ごはん'), '昼食');
  assert.equal(legacyCat('京都'), null);
  assert.equal(legacyCat(UNSORTED), null);
  // 変換先はすべて基本カテゴリー
  for (const c of Object.values(LEGACY_FOLDER_TO_CAT)) assert.ok(BASE_CAT_NAMES.includes(c), c);
});

test('2 お店の変換：1件も失わない・カテゴリーへ寄せる・旅先は未分類', () => {
  const before = [
    it('a', '買い物'), it('b', '朝ごはん'), it('c', '昼ごはん', '観光'), it('d', '京都', '朝食'),
    it('e', ''), it('f', undefined), it('g', UNSORTED, '買物'),
  ];
  const copy = JSON.stringify(before);
  const after = migrateItems(before, NOW);
  assert.equal(JSON.stringify(before), copy, '元のデータは書き換えない');
  assert.equal(after.length, before.length);
  assert.deepEqual(after.map((x) => x.id), before.map((x) => x.id));
  const by = Object.fromEntries(after.map((x) => [x.id, x]));
  assert.deepEqual([by.a.trip, by.a.category], [UNSORTED, '買物']);
  assert.deepEqual([by.b.trip, by.b.category], [UNSORTED, '朝食']);
  assert.deepEqual([by.c.trip, by.c.category], [UNSORTED, '観光'], '付いているカテゴリーは残す');
  assert.deepEqual([by.d.trip, by.d.category], ['京都', '朝食'], '旅先のフォルダーはそのまま');
  assert.equal(by.e.trip, UNSORTED);
  assert.equal(by.f.trip, UNSORTED);
  assert.equal(by.a.updatedAt, NOW, '変えたお店はクラウドへ送られる');
  assert.equal(by.d.updatedAt, undefined);
});

test('2 変換を2回かけても同じ（何度読み込んでも壊れない）', () => {
  const once = migrateItems([it('a', '買い物'), it('b', '京都')], NOW);
  assert.deepEqual(migrateItems(once, NOW + 1), once);
});

test('2 フォルダー一覧：昔の上の段と未分類を外し、旅先は残す', () => {
  assert.deepEqual(migrateFolderList(['京都', '買い物', '沖縄', '京都', UNSORTED, '朝ごはん']), ['京都', '沖縄']);
});

test('2 お土産・eタビセツ・回る順番も失わない', () => {
  const sv = migrateSouvenirs([{ id: 1, trip: '買い物' }, { id: 2, trip: '京都' }], NOW);
  assert.deepEqual(sv.map((x) => x.trip), [UNSORTED, '京都']);
  const k = migrateKeyed({ 買い物: { n: 1 }, 京都: { n: 2 } });
  assert.deepEqual(k, { [UNSORTED]: { n: 1 }, 京都: { n: 2 } });
  // 未分類にすでにあるときは消さず昔のキーに残す
  const k2 = migrateKeyed({ 買い物: { n: 1 }, [UNSORTED]: { n: 9 } });
  assert.deepEqual(k2, { 買い物: { n: 1 }, [UNSORTED]: { n: 9 } });
});

test('2 まとめて変換しても件数が同じ', () => {
  const r = migrateAll({ items: [it('a', '買い物'), it('b', '京都')], folders: ['買い物', '京都'], customCats: ['マッサージ', '屋台'], souvenirs: [{ id: 1, trip: '昼ごはん' }], notes: {}, plans: {} }, NOW);
  assert.equal(r.items.length, 2);
  assert.equal(r.souvenirs.length, 1);
  assert.deepEqual(r.folders, ['京都']);
  assert.deepEqual(r.customCats, ['屋台']);
});

test('2 旅先フォルダーの削除：お店は消さず未分類へ戻る', () => {
  const items = [it('a', '京都'), it('b', '京都', '観光'), it('c', '沖縄'), it('d', UNSORTED)];
  const r = removeFolder({ items, souvenirs: [{ id: 1, trip: '京都' }], notes: { 京都: { n: 1 } }, plans: { 京都: { days: [] } } }, '京都', NOW);
  assert.equal(r.items.length, 4);
  assert.deepEqual(r.items.map((x) => x.trip), [UNSORTED, UNSORTED, '沖縄', UNSORTED]);
  assert.equal(r.items[1].category, '観光');
  assert.equal(r.items[0].updatedAt, NOW);
  assert.equal(r.souvenirs[0].trip, UNSORTED);
  assert.deepEqual(r.notes, { [UNSORTED]: { n: 1 } });
  assert.deepEqual(r.plans, { [UNSORTED]: { days: [] } });
  // 未分類は削除できない
  assert.equal(removeFolder({ items }, UNSORTED, NOW).items, items);
});
