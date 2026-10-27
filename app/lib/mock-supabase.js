'use client';
// テスト用のにせ物のSupabase（NEXT_PUBLIC_TABIBI_MOCK=1 のときだけ使う）
// ・データはこのブラウザの中（localStorage）に置く
// ・本物と同じく「自分の行だけ読める・書ける」をここでも守る（共有リンク・公開eガイドブックは決まった関数だけで読む）
// 本番では使わない（本番のSupabaseの決まりの確かめ方は supabase/check-rls.sql）

const DB_KEY = 'tabibi.mockdb';
const SES_KEY = 'tabibi.mocksession';
const PK = { items: ['user_id', 'id'], settings: ['user_id'], photos: ['id'], shares: ['id'], note_pages: ['id'], guidebooks: ['id'], souvenirs: ['user_id', 'id'], trip_plans: ['user_id', 'trip'] };
const files = new Map(); // storage（このページを開いている間だけ）
// 記録してよい出来事の名前（本物は supabase/migrations/20261027_premium.sql の log_event と同じ一覧）
export const EVENTS = new Set(['search', 'add_place', 'localname', 'ai_recommend', 'ai_quota_hit', 'prem_sheet', 'prem_interest', 'guide_paid_set', 'guide_locked_view', 'guide_buy_interest', 'tpl_pick', 'share_create', 'souvenir_add', 'sv_cap_hit', 'sv_mark']);

const load = () => { try { return JSON.parse(localStorage.getItem(DB_KEY) || '{}'); } catch { return {}; } };
const store = (db) => { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch {} };
const session = () => { try { return JSON.parse(localStorage.getItem(SES_KEY) || 'null'); } catch { return null; } };
const uidNow = () => session()?.user?.id || null;
const same = (t, a, b) => PK[t].every((k) => a[k] === b[k]);
const err = (message) => ({ data: null, error: { message } });

class Query {
  constructor(table) { this.t = table; this.op = 'select'; this.filters = []; this.cols = '*'; this.single = false; this.ord = null; }
  select(cols = '*') { if (this.op === 'select') this.cols = cols; return this; }
  insert(rows) { this.op = 'insert'; this.rows = [].concat(rows); return this; }
  upsert(rows) { this.op = 'upsert'; this.rows = [].concat(rows); return this; }
  update(patch) { this.op = 'update'; this.patch = patch; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(k, v) { this.filters.push((r) => r[k] === v); return this; }
  in(k, vs) { this.filters.push((r) => vs.includes(r[k])); return this; }
  order(k, { ascending = true } = {}) { this.ord = [k, ascending]; return this; }
  maybeSingle() { this.single = true; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  run() {
    const uid = uidNow();
    if (!uid) return err('not logged in');
    const db = load();
    const rows = db[this.t] || [];
    // 行単位のセキュリティ（RLS）：自分の行だけ
    const mine = (r) => r.user_id === uid;
    const match = (r) => mine(r) && this.filters.every((f) => f(r));
    if (this.op === 'select') {
      let out = rows.filter(match);
      if (this.ord) { const [k, asc] = this.ord; out.sort((a, b) => (a[k] > b[k] ? 1 : -1) * (asc ? 1 : -1)); }
      if (this.cols !== '*') { const ks = this.cols.split(',').map((s) => s.trim()); out = out.map((r) => Object.fromEntries(ks.map((k) => [k, r[k]]))); }
      if (this.single) { if (out.length > 1) return err('multiple rows'); return { data: out[0] || null, error: null }; }
      return { data: out, error: null };
    }
    if (this.op === 'insert' || this.op === 'upsert') {
      for (const r of this.rows) {
        if (r.user_id !== uid) return err('new row violates row-level security policy');
        const i = rows.findIndex((x) => same(this.t, x, r));
        if (i >= 0) {
          if (this.op === 'insert') return err('duplicate key');
          if (!mine(rows[i])) return err('new row violates row-level security policy');
          rows[i] = { ...rows[i], ...r };
        } else {
          if (this.t === 'shares' && rows.some((x) => x.user_id === uid && x.folder === r.folder)) return err('duplicate key (user_id, folder)');
          rows.push({ created_at: new Date().toISOString(), ...r });
        }
      }
    } else if (this.op === 'update') {
      rows.forEach((r, i) => { if (match(r)) rows[i] = { ...r, ...this.patch }; });
    } else if (this.op === 'delete') {
      db[this.t] = rows.filter((r) => !match(r));
      store(db);
      return { data: null, error: null };
    }
    db[this.t] = rows;
    store(db);
    return { data: null, error: null };
  }
}

const listeners = new Set();
function setSession(s) {
  try { if (s) localStorage.setItem(SES_KEY, JSON.stringify(s)); else localStorage.removeItem(SES_KEY); } catch {}
  listeners.forEach((fn) => fn(s ? 'SIGNED_IN' : 'SIGNED_OUT', s));
}

const blobToDataUrl = (b) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });
const fileKey = (bucket, path) => bucket + '/' + path;
function saveFile(k, url) {
  files.set(k, url);
  try { const all = JSON.parse(localStorage.getItem('tabibi.mockfiles') || '{}'); all[k] = url; localStorage.setItem('tabibi.mockfiles', JSON.stringify(all)); } catch {}
}
function getFile(k) {
  if (files.has(k)) return files.get(k);
  try { return JSON.parse(localStorage.getItem('tabibi.mockfiles') || '{}')[k] || null; } catch { return null; }
}

export function mockClient() {
  return {
    auth: {
      async getSession() { return { data: { session: session() } }; },
      onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; },
      async signInWithOAuth() {
        // ?mockuser=premium… で開くとプレミアム（月払い）、premiumyear… で年払いとして動く（回数の数え方は /api/noteai のにせ物）
        const raw = (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mockuser')) || '';
        const name = raw.replace(/[^\w-]/g, '').slice(0, 40) || 'mock-user';
        setSession({ access_token: 'mock-token:' + name, user: { id: name } });
        return { data: {}, error: null };
      },
      async signOut() { setSession(null); return { error: null }; },
    },
    from: (t) => new Query(t),
    async rpc(fn, args) {
      const db = load();
      if (fn === 'shared_folder') {
        const sh = (db.shares || []).find((s) => s.id === args.share_id);
        if (!sh) return { data: null, error: null };
        // 共有では、メモ・元の投稿URLは出さない
        const items = (db.items || []).filter((r) => r.user_id === sh.user_id && r.data?.trip === sh.folder)
          .map(({ data: { memo, srcUrl, ...rest } }) => rest);
        return { data: { folder: sh.folder, items }, error: null };
      }
      if (fn === 'shared_extras') {
        const sh = (db.shares || []).find((s) => s.id === args.share_id);
        if (!sh) return { data: null, error: null };
        const plan = (db.trip_plans || []).find((r) => r.user_id === sh.user_id && r.trip === sh.folder)?.data || null;
        const souvenirs = (db.souvenirs || []).filter((r) => r.user_id === sh.user_id && r.trip === sh.folder).map((r) => r.data);
        return { data: { plan, souvenirs }, error: null };
      }
      if (fn === 'guidebook_view') {
        // 本物（supabase/migrations/20261027_premium.sql）と同じ：有料のeガイドブックは、無料で見せるページまでしか返さない（作った本人は全部）
        const g = (db.guidebooks || []).find((x) => x.id === args.gid && x.published);
        if (!g) return { data: null, error: null };
        const pages = db.note_pages || [];
        const pathOf = (id) => pages.find((p) => p.id === id && p.user_id === g.user_id)?.path || null;
        const all = (g.page_ids || []).map(pathOf).filter(Boolean);
        const price = g.price || 0;
        const owner = uidNow() === g.user_id;
        const show = price > 0 && !owner ? all.slice(0, g.free_pages || 0) : all;
        return { data: { title: g.title, author: g.author, description: g.description, price, free_pages: g.free_pages || 0, total_pages: all.length, locked: show.length < all.length, cover: pathOf(g.cover_id), pages: show }, error: null };
      }
      if (fn === 'log_event') {
        // 本物と同じ：決まった名前だけ。ログインしている人は1日1回まで数える
        if (!EVENTS.has(args.ev)) return { data: null, error: null };
        const uid = uidNow();
        const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
        const detail = String(args.detail || '').slice(0, 40);
        const ev = db.events || [];
        if (!uid || !ev.some((e) => e.user_id === uid && e.name === args.ev && e.detail === detail && e.day === day)) {
          ev.push({ user_id: uid, name: args.ev, detail, day });
          db.events = ev; store(db);
        }
        return { data: null, error: null };
      }
      return err('unknown rpc');
    },
    storage: {
      from(bucket) {
        return {
          async upload(path, blob) {
            const uid = uidNow();
            if (!uid || !path.startsWith(uid + '/')) return err('storage RLS');
            saveFile(fileKey(bucket, path), await blobToDataUrl(blob));
            return { data: { path }, error: null };
          },
          async remove(paths) { paths.forEach((p) => files.delete(fileKey(bucket, p))); return { data: null, error: null }; },
          async download(path) {
            const u = getFile(fileKey(bucket, path));
            if (!u) return err('not found');
            return { data: await (await fetch(u)).blob(), error: null };
          },
          async createSignedUrls(paths) {
            return { data: paths.map((p) => ({ path: p, signedUrl: getFile(fileKey(bucket, p)) })), error: null };
          },
        };
      },
    },
  };
}
