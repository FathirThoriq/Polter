/* Polter - library.js
   Semua operasi CRUD/search/copy/download berjalan offline tanpa API key.
   Hanya "Proses AI" yang memakai provider terkonfigurasi.
*/
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const grid = $('grid'), emptyEl = $('empty'), statsEl = $('stats');
  const objectUrls = new Map(); /* snippetId -> objectURL, di-revoke saat refresh */

  let filter = { q: '', type: 'all', favorite: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function fmtDate(ts) {
    try { return new Date(ts).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (e) { return ''; }
  }

  function revokeUrls() {
    for (const u of objectUrls.values()) { try { URL.revokeObjectURL(u); } catch (e) {} }
    objectUrls.clear();
  }

  async function thumbUrl(snippet) {
    if (!snippet.imageBlobId) return null;
    if (objectUrls.has(snippet.id)) return objectUrls.get(snippet.id);
    const rec = await JawabStore.getBlob(snippet.imageBlobId);
    if (!rec) return null;
    const url = URL.createObjectURL(rec.blob);
    objectUrls.set(snippet.id, url);
    return url;
  }

  async function refresh() {
    revokeUrls();
    grid.replaceChildren();
    let items;
    try {
      items = await JawabStore.listSnippets({ q: filter.q, type: filter.type, favorite: filter.favorite, status: 'saved' });
    } catch (e) {
      emptyEl.style.display = '';
      emptyEl.textContent = 'Gagal membuka database: ' + e.message;
      return;
    }
    statsEl.textContent = items.length + ' snippet tersimpan (lokal, offline).';
    emptyEl.style.display = items.length ? 'none' : '';
    for (const s of items) {
      grid.appendChild(await cardEl(s));
    }
  }

  function typeLabel(t) {
    return t === 'image' ? 'Gambar' : (t === 'code' ? 'Kode' : 'Teks');
  }

  async function cardEl(s) {
    const card = document.createElement('div');
    card.className = 'card';
    if (s.type === 'image') {
      const url = await thumbUrl(s);
      if (url) {
        const img = document.createElement('img');
        img.className = 'thumb';
        img.src = url;
        img.alt = s.title || 'snippet gambar';
        img.loading = 'lazy';
        card.appendChild(img);
      }
    }
    const body = document.createElement('div');
    body.className = 'cbody';

    const title = document.createElement('p');
    title.className = 'ctitle';
    title.textContent = s.title || '(tanpa judul)';
    body.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'cmeta';
    meta.textContent = typeLabel(s.type) + ' • ' + fmtDate(s.createdAt) +
      (s.sourceTitle ? ' • ' + s.sourceTitle.slice(0, 60) : '');
    body.appendChild(meta);

    if (s.type !== 'image' && s.content) {
      const prev = document.createElement('pre');
      prev.className = 'cprev';
      prev.textContent = s.content.slice(0, 400) + (s.content.length > 400 ? '…' : '');
      body.appendChild(prev);
    }

    if (s.tags && s.tags.length) {
      const tags = document.createElement('div');
      tags.className = 'ctags';
      for (const t of s.tags.slice(0, 8)) {
        const sp = document.createElement('span');
        sp.textContent = t;
        tags.appendChild(sp);
      }
      body.appendChild(tags);
    }

    const acts = document.createElement('div');
    acts.className = 'cactions';

    const mkBtn = (label, fn, cls) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', () => fn(b));
      acts.appendChild(b);
      return b;
    };

    if (s.sourceUrl && /^https?:\/\//.test(s.sourceUrl)) {
      mkBtn('Buka sumber', () => chrome.tabs.create({ url: s.sourceUrl }));
    }
    if (s.type === 'image') {
      mkBtn('Unduh', async () => {
        const r = await chrome.runtime.sendMessage({ type: 'download-image', id: s.id });
        if (r && r.ok) toast('Mengunduh...');
        else toast('Gagal: ' + ((r && r.error) || ''));
      });
    } else {
      mkBtn('Salin', async (b) => {
        try { await navigator.clipboard.writeText(s.content); toast('Tersalin persis.'); }
        catch (e) { toast('Gagal menyalin.'); }
      });
    }
    mkBtn('AI', () => openAiPanel(s));
    if (s.aiResults && s.aiResults.length) {
      mkBtn('Hasil AI (' + s.aiResults.length + ')', () => openResults(s));
    }
    const favBtn = mkBtn(s.favorite ? '★ Favorit' : '☆ Favorit', async () => {
      await JawabStore.updateSnippet(s.id, { favorite: !s.favorite });
      refresh();
    }, s.favorite ? 'fav' : '');
    mkBtn('Edit', () => openEdit(s));
    mkBtn('Hapus', async () => {
      if (!confirm('Hapus snippet "' + (s.title || '').slice(0, 60) + '"? Gambar terkait ikut terhapus.')) return;
      await JawabStore.deleteSnippet(s.id);
      toast('Dihapus.');
      refresh();
    }, 'danger');

    body.appendChild(acts);
    card.appendChild(body);
    return card;
  }

  /* ---------- edit ---------- */

  let editingId = null;
  function openEdit(s) {
    editingId = s.id;
    $('editTitle').value = s.title || '';
    $('editTags').value = (s.tags || []).join(', ');
    $('editLang').value = s.language || '';
    $('editContent').value = s.content || '';
    $('editContent').disabled = (s.type === 'image');
    $('editLang').disabled = (s.type !== 'code');
    $('editDialog').showModal();
  }
  $('editCancel').addEventListener('click', () => $('editDialog').close());
  $('editSave').addEventListener('click', async () => {
    const patch = {
      title: $('editTitle').value.slice(0, 300),
      tags: $('editTags').value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20),
      language: $('editLang').value.slice(0, 60),
    };
    if (!$('editContent').disabled) patch.content = $('editContent').value;
    try {
      await JawabStore.updateSnippet(editingId, patch);
      $('editDialog').close();
      toast('Tersimpan.');
      refresh();
    } catch (e) { toast('Gagal: ' + e.message); }
  });

  /* ---------- hasil AI tersimpan ---------- */

  async function openResults(s) {
    const fresh = await JawabStore.getSnippet(s.id);
    const list = $('resultsList');
    list.replaceChildren();
    for (const r of (fresh.aiResults || []).slice().reverse()) {
      const div = document.createElement('div');
      div.className = 'resitem';
      const meta = document.createElement('div');
      meta.className = 'rmeta';
      meta.textContent = (r.action || '') + ' • ' + (r.provider || '') + ' / ' + (r.model || '') + ' • ' + fmtDate(r.createdAt);
      const pre = document.createElement('pre');
      pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;margin:0 0 6px;max-height:200px;overflow:auto';
      pre.textContent = r.answer;
      const cp = document.createElement('button');
      cp.textContent = 'Salin jawaban';
      cp.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(r.answer); toast('Tersalin.'); }
        catch (e) { toast('Gagal menyalin.'); }
      });
      div.appendChild(meta); div.appendChild(pre); div.appendChild(cp);
      list.appendChild(div);
    }
    $('resultsDialog').showModal();
  }
  $('resultsClose').addEventListener('click', () => $('resultsDialog').close());

  /* ---------- proses AI pada snippet tersimpan ---------- */

  let aiPort = null, aiRequestId = null, aiSnippet = null, aiRaw = '', aiMeta = null, aiAction = 'explain';

  function openAiPanel(s) {
    aiSnippet = s;
    aiRaw = ''; aiMeta = null;
    $('aiTitle').textContent = 'Proses AI: ' + (s.title || typeLabel(s.type)).slice(0, 50);
    const box = $('aiActions');
    box.replaceChildren();
    const defs = s.type === 'image'
      ? [['explain', 'Jelaskan'], ['summarize', 'Ringkas'], ['translate', 'Terjemahkan'], ['extract', 'Ekstrak Teks'], ['answer', 'Jawab Soal']]
      : [['explain', 'Jelaskan'], ['summarize', 'Ringkas'], ['translate', 'Terjemahkan']];
    for (const [key, label] of defs) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => runAi(key));
      box.appendChild(b);
    }
    const custom = document.createElement('button');
    custom.textContent = 'Kirim pertanyaan';
    custom.className = 'primary';
    custom.addEventListener('click', () => {
      if (!$('aiQuestion').value.trim()) { toast('Isi pertanyaan dulu.'); return; }
      runAi('custom');
    });
    box.appendChild(custom);
    $('aiAnswer').textContent = '';
    $('aiSaveResult').style.display = 'none';
    $('aiCopy').style.display = 'none';
    $('aiStop').style.display = 'none';
    $('aiTarget').textContent = '';
    $('aiPanel').classList.add('show');
  }

  function closeAiPanel() {
    stopAi();
    $('aiPanel').classList.remove('show');
    aiSnippet = null;
  }

  function ensureAiPort() {
    if (aiPort) return;
    aiPort = chrome.runtime.connect({ name: 'jawab-stream' });
    aiPort.onMessage.addListener((m) => {
      if (!m || m.requestId !== aiRequestId) return;
      if (m.type === 'chunk') {
        aiRaw += m.text;
        $('aiAnswer').textContent = aiRaw;
      } else if (m.type === 'done') {
        aiMeta = m.meta || null;
        $("aiStop").style.display = 'none';
        finishAi();
      } else if (m.type === 'incomplete') {
        aiRaw += '\n\n[Jawaban terputus sebelum selesai.]';
        $('aiAnswer').textContent = aiRaw;
        $("aiStop").style.display = 'none';
        finishAi();
      } else if (m.type === 'error') {
        $("aiStop").style.display = 'none';
        $('aiAnswer').textContent = (aiRaw ? aiRaw + '\n\n' : '') + 'Error: ' + (m.message || '');
        if (aiRaw.trim()) { $('aiCopy').style.display = ''; }
        disconnectAi();
      }
    });
    aiPort.onDisconnect.addListener(() => {
      aiPort = null;
      $('aiStop').style.display = 'none';
    });
  }

  function disconnectAi() {
    try { if (aiPort) aiPort.disconnect(); } catch (e) {}
    aiPort = null;
    aiRequestId = null;
  }

  function finishAi() {
    $('aiCopy').style.display = aiRaw.trim() ? '' : 'none';
    $('aiSaveResult').style.display = aiRaw.trim() ? '' : 'none';
    if (aiMeta) {
      $('aiTarget').textContent = 'Via ' + (aiMeta.provider || '') + ' / ' + (aiMeta.model || '') +
        ' — ' + (aiMeta.streamed === false ? 'respons penuh (tanpa streaming)' : 'streaming');
    }
    disconnectAi();
  }

  async function runAi(action) {
    if (!aiSnippet) return;
    stopAi();
    aiAction = action;
    aiRaw = ''; aiMeta = null;
    $('aiAnswer').textContent = 'Memproses...';
    $('aiSaveResult').style.display = 'none';
    $('aiCopy').style.display = 'none';
    $('aiStop').style.display = '';
    $('aiTarget').textContent = '';
    aiRequestId = 'r-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
    ensureAiPort();
    aiPort.postMessage({
      type: 'ask-snippet',
      requestId: aiRequestId,
      snippetId: aiSnippet.id,
      action: action,
      question: $('aiQuestion').value || ''
    });
  }

  function stopAi() {
    if (aiPort && aiRequestId) {
      try { aiPort.postMessage({ type: 'stop', requestId: aiRequestId }); } catch (e) {}
    }
    disconnectAi();
    $('aiStop').style.display = 'none';
  }

  $('aiStop').addEventListener('click', stopAi);
  $('aiClose').addEventListener('click', closeAiPanel);
  $('aiCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(aiRaw); toast('Tersalin.'); }
    catch (e) { toast('Gagal menyalin.'); }
  });
  $('aiSaveResult').addEventListener('click', async () => {
    if (!aiSnippet || !aiRaw.trim()) return;
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'save-ai-result',
        snippetId: aiSnippet.id,
        result: {
          action: aiAction,
          provider: (aiMeta && aiMeta.provider) || '',
          model: (aiMeta && aiMeta.model) || '',
          prompt: (aiMeta && aiMeta.prompt) || '',
          answer: aiRaw
        }
      });
      if (res && res.ok) { toast('Hasil AI tersimpan.'); $('aiSaveResult').style.display = 'none'; refresh(); }
      else toast('Gagal: ' + ((res && res.error) || ''));
    } catch (e) { toast('Gagal: ' + e.message); }
  });

  /* ---------- export / import ---------- */

  $('btnExport').addEventListener('click', async () => {
    try {
      const data = await JawabStore.exportJson();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'jawab-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('Backup diunduh (' + data.snippets.length + ' snippet, gambar disertakan).');
    } catch (e) { toast('Gagal export: ' + e.message); }
  });

  let pendingImport = null;
  $('btnImport').addEventListener('click', () => $('fileImport').click());
  $('fileImport').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      const obj = JSON.parse(text);
      const { ok, errors, warnings, stats } = jawabValidateImport(obj);
      const info = $('importInfo');
      if (!ok) {
        info.replaceChildren();
        const eb = document.createElement('b');
        eb.style.color = 'var(--err)';
        eb.textContent = 'File tidak valid:';
        info.appendChild(eb);
        info.appendChild(document.createElement('br'));
        errors.forEach((x, i) => {
          if (i) info.appendChild(document.createElement('br'));
          info.appendChild(document.createTextNode(x));
        });
        $('importConfirm').style.display = 'none';
      } else {
        pendingImport = obj;
        info.replaceChildren();
        const readyLines = [
          'Siap import:',
          '\u2022 ' + stats.snippets + ' snippet',
          '\u2022 ' + stats.blobs + ' gambar',
          '\u2022 ukuran ~' + Math.round(stats.approxBytes / 1024) + ' KB'
        ];
        if (warnings.length) readyLines.push('\u2022 peringatan: ' + warnings.join('; '));
        readyLines.push('', 'ID yang konflik akan dibuat baru (data lama tidak ditimpa). Tidak ada key/settings yang ikut.');
        readyLines.forEach((ln, i) => {
          if (i) info.appendChild(document.createElement('br'));
          info.appendChild(document.createTextNode(ln));
        });
        $('importConfirm').style.display = '';
      }
      $('importDialog').showModal();
    } catch (err) {
      toast('Gagal membaca file: ' + err.message);
    }
  });
  $('importCancel').addEventListener('click', () => { pendingImport = null; $('importDialog').close(); });
  $('importConfirm').addEventListener('click', async () => {
    if (!pendingImport) return;
    try {
      const r = await JawabStore.importJson(pendingImport);
      $('importDialog').close();
      pendingImport = null;
      toast('Import selesai: ' + r.imported + ' snippet' + (r.remapped ? ' (' + r.remapped + ' ID di-remap)' : '') + '.');
      refresh();
    } catch (e) { toast('Gagal import: ' + e.message); }
  });

  $('btnSettings').addEventListener('click', () => { location.href = 'options.html'; });

  /* ---------- filter ---------- */

  let searchTimer = null;
  $('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { filter.q = e.target.value; refresh(); }, 250);
  });
  $('filterType').addEventListener('change', (e) => { filter.type = e.target.value; refresh(); });
  $('filterFav').addEventListener('click', (e) => {
    filter.favorite = !filter.favorite;
    e.target.textContent = filter.favorite ? '★ Favorit' : '☆ Favorit';
    e.target.setAttribute('aria-pressed', String(filter.favorite));
    refresh();
  });

  window.addEventListener('beforeunload', revokeUrls);

  refresh().catch((e) => toast('Gagal memuat: ' + e.message));
})();
