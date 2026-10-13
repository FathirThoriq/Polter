/* Jawab - lapisan storage IndexedDB (origin extension).
   Dipakai service worker (importScripts) dan library.html (script tag).
   Jangan dipakai dari content script (origin website) - lihat background.js.

   Skema v1:
   - store "snippets": keyPath id
     { id, type: 'text'|'code'|'image', title, content, imageBlobId,
       language, tags[], favorite, sourceUrl, sourceTitle,
       status: 'draft'|'saved', createdAt, updatedAt, aiResults[] }
   - store "blobs": keyPath id -> { id, mime, blob, createdAt }
*/

var JAWAB_SCHEMA_VERSION = 1;

function jawabGenId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
}

function jawabNow() { return Date.now(); }

var JAWAB_ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

function jawabIsHttpUrl(u) {
  if (typeof u !== 'string' || !u) return false;
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch (e) { return false; }
}

/* Validasi satu record snippet. mode 'import' lebih longgar untuk id/createdAt. */
function jawabValidateSnippet(s) {
  const errs = [];
  if (!s || typeof s !== 'object') return ['bukan object'];
  if (typeof s.id !== 'string' || !s.id || s.id.length > 128) errs.push('id tidak valid');
  if (s.type !== 'text' && s.type !== 'code' && s.type !== 'image') errs.push('type tidak valid');
  if (typeof s.title !== 'string' || s.title.length > 300) errs.push('title tidak valid');
  if (typeof s.content !== 'string') errs.push('content bukan string');
  if (s.content.length > 1000000) errs.push('content terlalu besar');
  if (s.imageBlobId != null && typeof s.imageBlobId !== 'string') errs.push('imageBlobId tidak valid');
  if (s.language != null && (typeof s.language !== 'string' || s.language.length > 60)) errs.push('language tidak valid');
  if (!Array.isArray(s.tags) || s.tags.some(t => typeof t !== 'string' || t.length > 60)) errs.push('tags tidak valid');
  if (typeof s.favorite !== 'boolean') errs.push('favorite bukan boolean');
  if (s.sourceUrl && !jawabIsHttpUrl(s.sourceUrl)) errs.push('sourceUrl bukan http(s)');
  if (s.sourceTitle != null && (typeof s.sourceTitle !== 'string' || s.sourceTitle.length > 300)) errs.push('sourceTitle tidak valid');
  if (s.status !== 'draft' && s.status !== 'saved') errs.push('status tidak valid');
  if (typeof s.createdAt !== 'number' || typeof s.updatedAt !== 'number') errs.push('timestamp tidak valid');
  if (!Array.isArray(s.aiResults)) errs.push('aiResults bukan array');
  else {
    for (const r of s.aiResults) {
      if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.answer !== 'string') {
        errs.push('aiResult tidak valid'); break;
      }
      if (typeof r.answer.length === 'number' && r.answer.length > 1000000) { errs.push('aiResult terlalu besar'); break; }
    }
  }
  /* Jangan pernah menyimpan kredensial di record snippet */
  for (const k of Object.keys(s)) {
    if (/key|token|secret|authorization|password/i.test(k)) errs.push('field terlarang: ' + k);
  }
  return errs;
}

function jawabValidateBlobMeta(m) {
  const errs = [];
  if (!m || typeof m !== 'object') return ['bukan object'];
  if (typeof m.id !== 'string' || !m.id) errs.push('id tidak valid');
  if (JAWAB_ALLOWED_IMAGE_MIME.indexOf(m.mime) === -1) errs.push('MIME tidak diizinkan: ' + m.mime);
  return errs;
}

/* Validasi file import. Mengembalikan {ok, errors[], warnings[], stats}. */
function jawabValidateImport(obj) {
  const errors = [];
  const warnings = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['file bukan JSON object'], warnings, stats: null };
  if (obj.schemaVersion !== 1) { errors.push('schemaVersion tidak didukung: ' + obj.schemaVersion); }
  if (obj.app !== 'jawab') warnings.push('field app bukan "jawab", lanjut dengan hati-hati');
  const snippets = obj.snippets;
  const blobs = obj.blobs || [];
  if (!Array.isArray(snippets)) errors.push('snippets bukan array');
  if (!Array.isArray(blobs)) errors.push('blobs bukan array');
  if (errors.length) return { ok: false, errors, warnings, stats: null };
  const L = (typeof JAWAB_LIMITS !== 'undefined') ? JAWAB_LIMITS : { maxImportItems: 2000, maxImportTotalBytes: 52428800, maxImageBytes: 5242880 };
  if (snippets.length > L.maxImportItems) errors.push('terlalu banyak item: ' + snippets.length);
  let totalBytes = 0;
  const seenIds = {};
  for (const s of snippets) {
    const e = jawabValidateSnippet(s);
    if (e.length) { errors.push('snippet ' + (s && s.id) + ': ' + e.join('; ')); continue; }
    if (seenIds[s.id]) errors.push('id duplikat: ' + s.id);
    seenIds[s.id] = 1;
    totalBytes += (s.content || '').length;
    for (const r of s.aiResults) totalBytes += (r.answer || '').length + (r.prompt || '').length;
  }
  for (const b of blobs) {
    if (!b || typeof b !== 'object' || typeof b.dataUrl !== 'string') { errors.push('blob tidak valid'); continue; }
    const e = jawabValidateBlobMeta(b);
    if (e.length) { errors.push('blob ' + b.id + ': ' + e.join('; ')); continue; }
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(b.dataUrl);
    if (!m) { errors.push('blob ' + b.id + ': dataUrl bukan base64 image yang valid'); continue; }
    const approxBytes = Math.floor(m[2].length * 3 / 4);
    if (approxBytes > L.maxImageBytes) { errors.push('blob ' + b.id + ' terlalu besar'); continue; }
    totalBytes += approxBytes;
  }
  if (totalBytes > L.maxImportTotalBytes) errors.push('total import terlalu besar: ~' + Math.round(totalBytes / 1048576) + 'MB');
  if (errors.length > 20) return { ok: false, errors: errors.slice(0, 20).concat(['...dan ' + (errors.length - 20) + ' error lain']), warnings, stats: null };
  return { ok: errors.length === 0, errors, warnings, stats: { snippets: snippets.length, blobs: blobs.length, approxBytes: totalBytes } };
}

var JawabStore = (function () {
  const DB_NAME = 'jawab-library';
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, JAWAB_SCHEMA_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains('snippets')) {
          const st = db.createObjectStore('snippets', { keyPath: 'id' });
          st.createIndex('updatedAt', 'updatedAt', { unique: false });
          st.createIndex('type', 'type', { unique: false });
        }
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('gagal membuka database'));
      req.onblocked = () => reject(new Error('database diblokir tab lain'));
    });
    return dbPromise;
  }

  function txPromise(storeNames, mode, fn) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      let done = false;
      const tx = db.transaction(storeNames, mode);
      tx.oncomplete = () => { if (!done) { done = true; resolve(result); } };
      tx.onerror = () => { if (!done) { done = true; reject(tx.error || new Error('transaksi gagal')); } };
      tx.onabort = () => { if (!done) { done = true; reject(tx.error || new Error('transaksi dibatalkan')); } };
      let result;
      try {
        result = fn(tx);
        if (result && typeof result.then === 'function') {
          result.then((v) => { result = v; }, (e) => { try { tx.abort(); } catch (x) {} if (!done) { done = true; reject(e); } });
        }
      } catch (e) {
        try { tx.abort(); } catch (x) {}
        if (!done) { done = true; reject(e); }
      }
    }));
  }

  function reqPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('operasi db gagal'));
    });
  }

  function blankSnippet(type) {
    const now = jawabNow();
    return {
      id: jawabGenId(), type: type, title: '', content: '', imageBlobId: null,
      language: '', tags: [], favorite: false, sourceUrl: '', sourceTitle: '',
      status: 'saved', createdAt: now, updatedAt: now, aiResults: []
    };
  }

  async function addSnippet(data) {
    const s = Object.assign(blankSnippet(data.type === 'image' ? 'image' : (data.type === 'code' ? 'code' : 'text')), data);
    s.id = s.id || jawabGenId();
    const now = jawabNow();
    if (!data.createdAt) s.createdAt = now;
    s.updatedAt = now;
    const errs = jawabValidateSnippet(s);
    if (errs.length) throw new Error('snippet tidak valid: ' + errs.join('; '));
    await txPromise(['snippets'], 'readwrite', (tx) => reqPromise(tx.objectStore('snippets').add(s)));
    return s.id;
  }

  async function getSnippet(id) {
    return txPromise(['snippets'], 'readonly', (tx) => reqPromise(tx.objectStore('snippets').get(id)));
  }

  async function listSnippets(filter) {
    filter = filter || {};
    const all = await txPromise(['snippets'], 'readonly', (tx) => reqPromise(tx.objectStore('snippets').index('updatedAt').getAll()));
    let out = all.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    if (filter.type && filter.type !== 'all') out = out.filter((s) => s.type === filter.type);
    if (filter.favorite) out = out.filter((s) => s.favorite);
    if (filter.status) out = out.filter((s) => s.status === filter.status);
    if (filter.q) {
      const q = filter.q.toLowerCase();
      out = out.filter((s) =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.content || '').toLowerCase().includes(q) ||
        (s.tags || []).join(' ').toLowerCase().includes(q));
    }
    return out;
  }

  async function updateSnippet(id, patch) {
    return txPromise(['snippets'], 'readwrite', async (tx) => {
      const st = tx.objectStore('snippets');
      const cur = await reqPromise(st.get(id));
      if (!cur) throw new Error('snippet tidak ditemukan');
      const next = Object.assign({}, cur, patch, { id: cur.id, updatedAt: jawabNow() });
      const errs = jawabValidateSnippet(next);
      if (errs.length) throw new Error('snippet tidak valid: ' + errs.join('; '));
      await reqPromise(st.put(next));
      return next;
    });
  }

  async function deleteSnippet(id) {
    return txPromise(['snippets', 'blobs'], 'readwrite', async (tx) => {
      const st = tx.objectStore('snippets');
      const cur = await reqPromise(st.get(id));
      if (!cur) return false;
      await reqPromise(st.delete(id));
      if (cur.imageBlobId) {
        /* hapus blob hanya jika tidak dipakai snippet lain */
        const all = await reqPromise(st.getAll());
        const stillUsed = all.some((s) => s.imageBlobId === cur.imageBlobId);
        if (!stillUsed) {
          try { await reqPromise(tx.objectStore('blobs').delete(cur.imageBlobId)); } catch (e) {}
        }
      }
      return true;
    });
  }

  async function putBlob(id, mime, blob) {
    if (JAWAB_ALLOWED_IMAGE_MIME.indexOf(mime) === -1) throw new Error('MIME tidak diizinkan: ' + mime);
    const L = (typeof JAWAB_LIMITS !== 'undefined') ? JAWAB_LIMITS : { maxImageBytes: 5242880 };
    if (blob.size > L.maxImageBytes) throw new Error('gambar terlalu besar (' + Math.round(blob.size / 1024) + 'KB)');
    await txPromise(['blobs'], 'readwrite', (tx) =>
      reqPromise(tx.objectStore('blobs').put({ id: id, mime: mime, blob: blob, createdAt: jawabNow() })));
  }

  async function getBlob(id) {
    const rec = await txPromise(['blobs'], 'readonly', (tx) => reqPromise(tx.objectStore('blobs').get(id)));
    return rec || null;
  }

  async function addAiResult(snippetId, result) {
    const r = {
      id: jawabGenId(),
      action: String(result.action || 'custom'),
      provider: String(result.provider || ''),
      model: String(result.model || ''),
      prompt: String(result.prompt || '').slice(0, 4000),
      answer: String(result.answer || ''),
      createdAt: jawabNow()
    };
    if (!r.answer) throw new Error('jawaban kosong, tidak disimpan');
    await txPromise(['snippets'], 'readwrite', async (tx) => {
      const st = tx.objectStore('snippets');
      const cur = await reqPromise(st.get(snippetId));
      if (!cur) throw new Error('snippet tidak ditemukan');
      cur.aiResults = (cur.aiResults || []).concat([r]);
      cur.updatedAt = jawabNow();
      const errs = jawabValidateSnippet(cur);
      if (errs.length) throw new Error('snippet tidak valid: ' + errs.join('; '));
      await reqPromise(st.put(cur));
    });
    return r.id;
  }

  /* Hapus draft lebih tua dari TTL. Dipanggil saat startup. */
  async function cleanupDrafts() {
    const L = (typeof JAWAB_LIMITS !== 'undefined') ? JAWAB_LIMITS : { draftTtlMs: 604800000 };
    const cutoff = jawabNow() - L.draftTtlMs;
    const drafts = await listSnippets({ status: 'draft' });
    let removed = 0;
    for (const d of drafts) {
      if (d.updatedAt < cutoff) {
        await deleteSnippet(d.id);
        removed++;
      }
    }
    return removed;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('gagal membaca blob'));
      fr.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw new Error('dataUrl gambar tidak valid');
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
  }

  /* Export: gambar disertakan sebagai dataUrl tervalidasi (hanya saat export). */
  async function exportJson() {
    const snippets = await listSnippets({ status: 'saved' });
    const blobs = [];
    const seen = {};
    for (const s of snippets) {
      if (s.imageBlobId && !seen[s.imageBlobId]) {
        seen[s.imageBlobId] = 1;
        const rec = await getBlob(s.imageBlobId);
        if (rec) {
          const dataUrl = await blobToDataUrl(rec.blob);
          blobs.push({ id: rec.id, mime: rec.mime, dataUrl: dataUrl });
        }
      }
    }
    return { app: 'jawab', schemaVersion: JAWAB_SCHEMA_VERSION, exportedAt: new Date().toISOString(), snippets, blobs };
  }

  /* Import: validasi ketat, konflik ID di-remap (tidak menimpa diam-diam). */
  async function importJson(obj) {
    const v = jawabValidateImport(obj);
    if (!v.ok) throw new Error('import tidak valid: ' + v.errors.join(' | '));
    const existing = await listSnippets({});
    const existingIds = {};
    existing.forEach((s) => { existingIds[s.id] = 1; });
    const idMap = {};
    let imported = 0, remapped = 0;
    const now = jawabNow();
    /* 1. tulis blob dulu */
    for (const b of (obj.blobs || [])) {
      let newId = b.id;
      if (existingIds[newId] || idMap[newId]) { newId = jawabGenId(); }
      idMap[b.id] = newId;
      const blob = dataUrlToBlob(b.dataUrl);
      await putBlob(newId, b.mime, blob);
    }
    /* 2. tulis snippet dalam satu transaksi */
    await txPromise(['snippets'], 'readwrite', async (tx) => {
      const st = tx.objectStore('snippets');
      for (const s of obj.snippets) {
        let newId = s.id;
        if (existingIds[newId]) { newId = jawabGenId(); remapped++; }
        const copy = JSON.parse(JSON.stringify(s));
        copy.id = newId;
        if (copy.imageBlobId && idMap[copy.imageBlobId]) copy.imageBlobId = idMap[copy.imageBlobId];
        copy.status = 'saved';
        copy.createdAt = now;
        copy.updatedAt = now;
        const errs = jawabValidateSnippet(copy);
        if (errs.length) throw new Error('snippet import tidak valid: ' + errs.join('; '));
        await reqPromise(st.add(copy));
        imported++;
      }
    });
    return { imported, remapped, warnings: v.warnings, stats: v.stats };
  }

  return {
    openDb, blankSnippet, addSnippet, getSnippet, listSnippets,
    updateSnippet, deleteSnippet, putBlob, getBlob,
    addAiResult, cleanupDrafts, exportJson, importJson,
    blobToDataUrl, dataUrlToBlob
  };
})();
