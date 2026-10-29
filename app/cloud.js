'use client';
// ログイン（Googleでログイン）と、候補・行ったのお店／設定／写真のクラウド保存（Supabase）
import { createClient } from '@supabase/supabase-js';
import { photoHooks, listPhotos, listAllPhotos, setCloudId, putFromCloud } from './photos';

import { SUPABASE_URL, SUPABASE_KEY } from './lib/supabase-public';
import { mockClient } from './lib/mock-supabase';
const BUCKET = 'photos';
// テスト用モード（本物のSupabaseを使わない）。本番のビルドでは付けない
// まちがって本番で付けても動かないよう、自分のパソコン（localhost）で開いたときだけ
export const MOCK = process.env.NEXT_PUBLIC_TABIBI_MOCK === '1' && typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

let client = null;
export function supa() {
  if (!client && MOCK) client = mockClient();
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

let uid = null;
export function setUser(id) {
  uid = id || null;
  // 「わたしたちの写真」（people:）は、いまはこのスマホの中だけに置く
  photoHooks.onAdd = uid ? (rec) => (rec.kind === 'people' ? null : uploadPhoto(rec).catch(() => {})) : null;
  photoHooks.onDelete = uid ? (rec) => deleteCloudPhoto(rec).catch(() => {}) : null;
}

export function signIn() {
  return supa().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/' } });
}
export function signOut() {
  setUser(null);
  return supa().auth.signOut();
}

const now = () => new Date().toISOString();
const stamp = (it) => it?.updatedAt || it?.addedAt || 0;

// ---- お店 ----
export async function pullItems() {
  const { data, error } = await supa().from('items').select('id,data').eq('user_id', uid);
  if (error) throw error;
  return (data || []).map((r) => r.data);
}
export async function upsertItems(list) {
  if (!uid || !list.length) return;
  for (let i = 0; i < list.length; i += 200) {
    const rows = list.slice(i, i + 200).map((it) => ({ user_id: uid, id: it.id, data: it, updated_at: now() }));
    const { error } = await supa().from('items').upsert(rows);
    if (error) throw error;
  }
}
export async function deleteItems(ids) {
  if (!uid || !ids.length) return;
  const { error } = await supa().from('items').delete().eq('user_id', uid).in('id', ids);
  if (error) throw error;
}

// ---- 設定（フォルダ・宿泊先・自分で作ったカテゴリー） ----
export async function pullSettings() {
  const { data, error } = await supa().from('settings').select('data').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  return data?.data || null;
}
export async function pushSettings(data) {
  if (!uid) return;
  const { error } = await supa().from('settings').upsert({ user_id: uid, data, updated_at: now() });
  if (error) throw error;
}

// ---- 写真 ----
let photoRows = new Map(); // itemId -> [{id, kind, path, created_at}]
export async function pullPhotoRows() {
  const { data, error } = await supa().from('photos').select('id,item_id,kind,path,created_at').eq('user_id', uid);
  if (error) throw error;
  photoRows = new Map();
  for (const r of data || []) {
    if (!photoRows.has(r.item_id)) photoRows.set(r.item_id, []);
    photoRows.get(r.item_id).push(r);
  }
  return data || [];
}
async function uploadPhoto(rec) {
  if (!uid) return;
  if (!rec.cloudId) rec = await setCloudId(rec);
  const path = `${uid}/${encodeURIComponent(rec.itemId)}/${rec.cloudId}.jpg`;
  const up = await supa().storage.from(BUCKET).upload(path, rec.blob, { contentType: 'image/jpeg', upsert: true });
  if (up.error) throw up.error;
  const row = { id: rec.cloudId, user_id: uid, item_id: rec.itemId, kind: rec.kind || 'memo', path, created_at: new Date(rec.at || Date.now()).toISOString() };
  const { error } = await supa().from('photos').upsert(row);
  if (error) throw error;
  if (!photoRows.has(rec.itemId)) photoRows.set(rec.itemId, []);
  photoRows.get(rec.itemId).push(row);
}
async function deleteCloudPhoto(rec) {
  if (!uid || !rec.cloudId) return;
  const rows = photoRows.get(rec.itemId) || [];
  const row = rows.find((r) => r.id === rec.cloudId);
  const path = row?.path || `${uid}/${encodeURIComponent(rec.itemId)}/${rec.cloudId}.jpg`;
  await supa().storage.from(BUCKET).remove([path]);
  await supa().from('photos').delete().eq('user_id', uid).eq('id', rec.cloudId);
  photoRows.set(rec.itemId, rows.filter((r) => r.id !== rec.cloudId));
}

// このお店の写真で、まだスマホに入っていないものをクラウドから取ってくる（見たときだけ。通信量を抑える）
export async function ensurePhotos(itemId) {
  if (!uid) return 0;
  const rows = photoRows.get(itemId) || [];
  if (!rows.length) return 0;
  const have = new Set((await listPhotos(itemId)).map((p) => p.cloudId));
  let n = 0;
  for (const r of rows) {
    if (have.has(r.id)) continue;
    const { data, error } = await supa().storage.from(BUCKET).download(r.path);
    if (error || !data) continue;
    if (await putFromCloud({ itemId, cloudId: r.id, kind: r.kind, at: Date.parse(r.created_at) || Date.now(), blob: data })) n++;
  }
  return n;
}

// 前からスマホにある写真で、まだクラウドにないものを上げる
export async function uploadMissingPhotos(itemIds) {
  if (!uid) return;
  const cloudIds = new Set([...photoRows.values()].flat().map((r) => r.id));
  const all = await listAllPhotos();
  for (const rec of all) {
    if (!itemIds.has(rec.itemId)) continue;
    if (rec.cloudId && cloudIds.has(rec.cloudId)) continue;
    try { await uploadPhoto(rec); } catch {}
  }
}

// ---- はじめのそろえ（このスマホの中身とクラウドを合わせる） ----
// synced：前回このスマホとクラウドでそろえたお店のID（クラウドにないなら、別の端末で消したということ）
export function mergeItems(local, cloud, synced) {
  const cloudMap = new Map(cloud.map((it) => [it.id, it]));
  const out = new Map(cloudMap);
  const toUpload = [];
  const removed = [];
  for (const it of local) {
    const c = cloudMap.get(it.id);
    if (!c) {
      if (synced.has(it.id)) removed.push(it.id);
      else { out.set(it.id, it); toUpload.push(it); }
    } else if (stamp(it) > stamp(c)) {
      out.set(it.id, it);
      toUpload.push(it);
    }
  }
  const merged = [...out.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  return { merged, toUpload, removed };
}

// ---- フォルダの共有（リンクを知っている人だけ、読むだけ） ----
const shareId = () => {
  const c = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(10); crypto.getRandomValues(a);
  return [...a].map((n) => c[n % c.length]).join('');
};
export async function getShare(folder) {
  if (!uid) return null;
  const { data, error } = await supa().from('shares').select('id').eq('user_id', uid).eq('folder', folder).maybeSingle();
  if (error) throw error;
  return data?.id || null;
}
export async function createShare(folder) {
  if (!uid) throw new Error('ログインしてください');
  const id = shareId();
  const { error } = await supa().from('shares').insert({ id, user_id: uid, folder });
  if (error) throw error;
  return id;
}
export async function deleteShare(folder) {
  if (!uid) return;
  const { error } = await supa().from('shares').delete().eq('user_id', uid).eq('folder', folder);
  if (error) throw error;
}
export async function renameShare(from, to) {
  if (!uid) return;
  await supa().from('shares').update({ folder: to }).eq('user_id', uid).eq('folder', from);
}
export async function fetchShared(id) {
  const { data, error } = await supa().rpc('shared_folder', { share_id: id });
  if (error) throw error;
  return data; // { folder, items } または null
}

// ---- 自分のeガイドブック（保存したeタビセツ＝ページ、表紙、eガイドブック） ----
const GUIDE = 'guide';
const newUuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));

// どんな画像でもJPEGにそろえる（保存の量を小さく）
async function toJpeg(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 1440 / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const out = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('画像を保存できませんでした'))), 'image/jpeg', 0.9));
  return { blob: out, w: c.width, h: c.height };
}

export async function savePage({ blob, kind = 'note', trip = '', title = '' }) {
  if (!uid) throw new Error('Googleでログインしてください');
  const j = await toJpeg(blob);
  const id = newUuid();
  const path = `${uid}/${kind === 'cover' ? 'c' : 'p'}/${id}.jpg`;
  const up = await supa().storage.from(GUIDE).upload(path, j.blob, { contentType: 'image/jpeg' });
  if (up.error) throw up.error;
  const row = { id, user_id: uid, kind, trip: String(trip).slice(0, 60), title: String(title).slice(0, 60), path, w: j.w, h: j.h };
  const { error } = await supa().from('note_pages').insert(row);
  if (error) { await supa().storage.from(GUIDE).remove([path]); throw error; }
  return row;
}
export async function listPages() {
  if (!uid) return [];
  const { data, error } = await supa().from('note_pages').select('id,kind,trip,title,path,w,h,created_at').eq('user_id', uid).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
export async function deletePage(p) {
  if (!uid) return;
  const { error } = await supa().from('note_pages').delete().eq('user_id', uid).eq('id', p.id);
  if (error) throw error;
  await supa().storage.from(GUIDE).remove([p.path]);
}
// 画像を見るための一時的なURL（1時間）
export async function guideUrls(paths) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return {};
  const { data, error } = await supa().storage.from(GUIDE).createSignedUrls(list, 3600);
  if (error) throw error;
  return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}
export async function listGuides() {
  if (!uid) return [];
  const { data, error } = await supa().from('guidebooks').select('*').eq('user_id', uid).order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
export async function saveGuide(g) {
  if (!uid) throw new Error('Googleでログインしてください');
  const row = {
    id: g.id || shareId(), user_id: uid, title: String(g.title || '').slice(0, 60) || '旅のeガイドブック',
    author: String(g.author || '').slice(0, 30), description: String(g.description || '').slice(0, 300),
    cover_id: g.cover_id || null, page_ids: (g.page_ids || []).slice(0, 60), published: !!g.published,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supa().from('guidebooks').upsert(row);
  if (error) throw new Error('保存できませんでした。もう一度試してください');
  return row;
}
export async function deleteGuide(id) {
  if (!uid) return;
  const { error } = await supa().from('guidebooks').delete().eq('user_id', uid).eq('id', id);
  if (error) throw error;
}
export async function fetchGuide(id) {
  const { data, error } = await supa().rpc('guidebook_view', { gid: id });
  if (error) throw error;
  return data; // { title, author, description, price, free_pages, total_pages, locked, cover, pages } または null
}

// ---- わからないことを測るための記録（決まった名前だけ。ログインしている人は1日1回まで数える） ----
// 失敗しても画面は止めない
export function logEvent() {} // 記録はしない

// ---- お土産（旅のあとに、買ったものを記録） ----
// 1つ＝1行。写真は小さくしてデータの中に入れる（共有リンク・eガイドブックでもそのまま見せられるように）
export async function pullSouvenirs() {
  const { data, error } = await supa().from('souvenirs').select('id,data').eq('user_id', uid);
  if (error) throw error;
  return (data || []).map((r) => r.data);
}
export async function upsertSouvenirs(list) {
  if (!uid || !list.length) return;
  for (let i = 0; i < list.length; i += 50) {
    const rows = list.slice(i, i + 50).map((s) => ({ user_id: uid, id: s.id, trip: String(s.trip || '').slice(0, 60), data: s, updated_at: now() }));
    const { error } = await supa().from('souvenirs').upsert(rows);
    if (error) throw error;
  }
}
export async function deleteSouvenirs(ids) {
  if (!uid || !ids.length) return;
  const { error } = await supa().from('souvenirs').delete().eq('user_id', uid).in('id', ids);
  if (error) throw error;
}

// ---- 1日の回る順番（旅程）：旅（フォルダ）ごとに1行 ----
export async function pullPlans() {
  const { data, error } = await supa().from('trip_plans').select('trip,data').eq('user_id', uid);
  if (error) throw error;
  return (data || []).map((r) => ({ ...r.data, id: r.trip }));
}
export async function upsertPlans(list) {
  if (!uid || !list.length) return;
  const rows = list.map(({ id, ...p }) => ({ user_id: uid, trip: String(id).slice(0, 60), data: p, updated_at: now() }));
  const { error } = await supa().from('trip_plans').upsert(rows);
  if (error) throw error;
}
export async function deletePlans(trips) {
  if (!uid || !trips.length) return;
  const { error } = await supa().from('trip_plans').delete().eq('user_id', uid).in('trip', trips);
  if (error) throw error;
}

// 共有リンクで見せる旅程・お土産（共有しているフォルダの分だけ）
export async function fetchSharedExtras(id) {
  const { data, error } = await supa().rpc('shared_extras', { share_id: id });
  if (error) throw error;
  return data; // { plan, souvenirs } または null
}
