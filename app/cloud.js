'use client';
// ログイン（Googleでログイン）と、候補・行ったのお店／設定／写真のクラウド保存（Supabase）
import { createClient } from '@supabase/supabase-js';
import { photoHooks, listPhotos, listAllPhotos, setCloudId, putFromCloud } from './photos';

// 公開用の鍵（ブラウザで使ってよい鍵。読み書きは「本人のデータだけ」にデータベース側で制限している）
const SUPABASE_URL = 'https://yowxqlziedlhsjynspkv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_JawUo2zewG8oKmpmd-Et6w_SvNt6p38';
const BUCKET = 'photos';

let client = null;
export function supa() {
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
  photoHooks.onAdd = uid ? (rec) => uploadPhoto(rec).catch(() => {}) : null;
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
  const { data, error } = await supa().from('items').select('id,data');
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
  const { error } = await supa().from('items').delete().in('id', ids);
  if (error) throw error;
}

// ---- 設定（フォルダ・宿泊先・自分で作ったカテゴリー） ----
export async function pullSettings() {
  const { data, error } = await supa().from('settings').select('data').maybeSingle();
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
  const { data, error } = await supa().from('photos').select('id,item_id,kind,path,created_at');
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
  await supa().from('photos').delete().eq('id', rec.cloudId);
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
