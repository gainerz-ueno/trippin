'use client';
// 自分で撮った写真を、このスマホの中（IndexedDB）に保存する
const DB = 'trippin';
const STORE = 'photos';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const st = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        st.createIndex('itemId', 'itemId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const out = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(out?.result ?? out);
        t.onerror = () => reject(t.error);
      })
  );
}

// 長辺1600pxのJPEGに縮める
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('写真を読み込めませんでした'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => reject(new Error('写真を読み込めませんでした'));
    img.src = URL.createObjectURL(file);
  });
}

export async function addPhotos(itemId, files) {
  for (const f of files) {
    const blob = await shrink(f);
    await tx('readwrite', (st) => st.add({ itemId, blob, at: Date.now() }));
  }
}

export function listPhotos(itemId) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(STORE).objectStore(STORE).index('itemId').getAll(itemId);
        req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.at - b.at));
        req.onerror = () => reject(req.error);
      })
  );
}

export function deletePhoto(id) {
  return tx('readwrite', (st) => st.delete(id));
}

export async function deletePhotosOf(itemId) {
  const all = await listPhotos(itemId);
  for (const p of all) await deletePhoto(p.id);
}
