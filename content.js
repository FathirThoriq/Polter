/* Polter - content script
   - Tombol "?" untuk seleksi teks/kode -> popup aksi (Simpan/Salin/Tanya AI).
   - Tombol gunting draggable -> capture area -> preview -> Simpan/Unduh/Proses AI.
   - State draft eksplisit; hidePanel() tidak pernah menghapus draft.
   - Capture sekali per snapshot; retry/reuse memakai gambar yang sama.
   - Tidak ada request AI otomatis.
*/
(function () {
  'use strict';
  if (window.__jawabLoaded === '0.8.8') return;
  const hadOldJawab = !!window.__jawabLoaded;
  window.__jawabLoaded = '0.8.8';
  if (hadOldJawab) {
    /* Tab ini masih memuat UI versi lama (zombie setelah ekstensi diperbarui
       tanpa reload): buang semua host lamanya supaya tombol tidak dobel.
       Reload tab tetap cara paling bersih, tapi ini menolong otomatis. */
    try { document.querySelectorAll('#jawab-host').forEach((n) => n.remove()); } catch (e) {}
  }

  /* ============ state ============ */
  let host = null;
  let shadow = null;
  let qBtn = null;        /* tombol "?" seleksi */
  let cutBtn = null;      /* tombol gunting */
  let panel = null;       /* popup */
  let draft = null;       /* {kind:'text',text,isCode,language,sourceUrl,sourceTitle}
                             | {kind:'image',imageId,thumb,title,sourceUrl,sourceTitle} */
  let port = null;
  let currentRequestId = null;
  let lastRaw = '';
  let lastMeta = null;
  let answering = false;
  let expectDisconnect = false;
  let captureSession = null; /* {overlay, rectEl, startX, startY, cancelled, ...listeners} */
  let pendingImageAutoAsk = false; /* potret segar -> langsung dijawab AI, tanpa klik lagi */
  let currentAction = 'explain';
  let detectBtn = null;   /* tombol deteksi soal/formulir */
  let panelMode = '';     /* 'text' | 'image' | 'detect' */
  let detected = [];      /* hasil scanPage(): {question,type,options,el,els,_ansEl,_fillBtn} */
  let parsedAnswers = {}; /* index -> answer string, hasil parse JSON dari AI */
  let lastScanError = ''; /* error bagian pindai terakhir (untuk ditampilkan, bukan ditelan) */
  let lastScanRawCount = 0; /* jumlah kandidat sebelum filter soal */
  let edgeBtn = null;     /* tab tipis tepi kiri (satu-satunya tombol mengambang) */
  let tabVisible = true;  /* radio 'Tombol hantu' di Pengaturan: false = tab hilang, menu dipanggil via shortcut */
  const autoState = { on: false, busy: false, pendingSig: '', lastSig: '', errors: 0, observer: null, timer: null, dirty: true };

  const MIN_SEL = 3;
  const IS_TOP = (window.top === window); /* tombol mengambang hanya di frame utama;
    frame lain tetap bisa memindai + menampilkan panel saat diminta background */

  /* ============ css (dark mode) ============ */
  const CSS = `
    .jbtn{position:fixed;z-index:2147483647;width:34px;height:34px;border-radius:50%;
      background:rgba(18,18,20,.42);backdrop-filter:blur(8px) saturate(140%);
      -webkit-backdrop-filter:blur(8px) saturate(140%);
      border:1px solid rgba(255,255,255,.25);color:#f5f5f7;font-size:17px;font-weight:600;cursor:pointer;
      box-shadow:0 2px 10px rgba(0,0,0,.25);
      display:flex;align-items:center;justify-content:center;
      font-family:system-ui,sans-serif;pointer-events:auto;}
    .jbtn:hover{background:rgba(18,18,20,.62);}
    .jcut{width:44px;height:44px;font-size:20px;}
    .jpanel{position:fixed;z-index:2147483647;width:340px;max-width:calc(100vw - 24px);
      background:rgba(14,14,16,.84);backdrop-filter:blur(22px) saturate(150%);
      -webkit-backdrop-filter:blur(22px) saturate(150%);
      border:1px solid rgba(255,255,255,.16);border-radius:18px;
      box-shadow:0 12px 40px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.05);
      font-family:system-ui,sans-serif;font-size:13px;color:#f5f5f7;overflow:hidden;pointer-events:auto;}
    .jhead{display:flex;align-items:center;gap:8px;padding:10px 12px;background:transparent;color:#f5f5f7;
      border-bottom:1px solid rgba(255,255,255,.1);
      font-weight:700;font-size:13px;cursor:move;user-select:none;-webkit-user-select:none;}
    .jhead .jx{margin-left:auto;background:none;border:none;color:inherit;font-size:16px;cursor:pointer;
      padding:2px 6px;border-radius:6px;}
    .jhead .jx:hover{background:rgba(255,255,255,.12);}
    .jbody{padding:10px 12px;max-height:60vh;overflow-y:auto;}
    .jprev{background:rgba(255,255,255,.07);border-radius:8px;padding:8px 10px;margin:0 0 8px;max-height:140px;
      overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12px;color:inherit;}
    .jthumb{width:100%;border-radius:8px;margin-bottom:8px;display:block;background:rgba(255,255,255,.07);}
    .jrow{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;}
    .jbtn2{border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#f5f5f7;border-radius:18px;
      padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;}
    .jbtn2:hover{background:rgba(255,255,255,.16);}
    .jbtn2.on{background:#f5f5f7;color:#0a0a0b;border-color:#f5f5f7;}
    .jbtn2:disabled{opacity:.5;cursor:default;}
    .jinput{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.18);border-radius:8px;
      padding:7px 9px;font-size:12px;margin-bottom:8px;font-family:inherit;
      background:rgba(255,255,255,.08);color:#f5f5f7;}
    .jsec{font-size:11px;font-weight:700;color:rgba(255,255,255,.45);text-transform:uppercase;
      letter-spacing:.04em;margin:10px 0 6px;}
    .jans{background:rgba(255,255,255,.06);border-radius:8px;padding:8px 10px;font-size:13px;line-height:1.55;
      max-height:260px;overflow-y:auto;word-break:break-word;margin-bottom:8px;color:#f5f5f7;}
    .jans:empty{display:none;}
    .jans p{margin:6px 0;}
    .jans pre{background:rgba(255,255,255,.08);color:#f5f5f7;padding:8px;border-radius:6px;overflow:auto;font-size:12px;}
    .jans code{background:rgba(255,255,255,.12);color:#f5f5f7;border-radius:4px;padding:1px 5px;font-size:12px;}
    .jans pre code{background:none;padding:0;}
    .jerr{background:rgba(255,255,255,.09);color:#fafafa;border:1px solid rgba(255,255,255,.35);border-radius:8px;
      padding:8px 10px;font-size:12px;margin-bottom:8px;}
    .jload{color:rgba(255,255,255,.5);font-size:12px;margin-bottom:8px;}
    .jnote{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.22);color:#e4e4e7;border-radius:8px;
      padding:8px 10px;font-size:12px;margin-bottom:8px;}
    .jcap{position:fixed;inset:0;z-index:2147483646;cursor:crosshair;background:rgba(0,0,0,.08);pointer-events:auto;}
    .jcap-rect{position:fixed;border:1.5px solid rgba(255,255,255,.95);background:rgba(255,255,255,.10);
      box-shadow:0 0 0 1px rgba(0,0,0,.35);z-index:2147483646;}
    .jcap-hint{position:fixed;z-index:2147483646;background:rgba(12,12,14,.85);color:#fff;font-size:12px;
      backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
      padding:6px 10px;border-radius:8px;pointer-events:none;font-family:system-ui,sans-serif;}
    .jtoast{position:fixed;z-index:2147483647;bottom:24px;left:50%;transform:translateX(-50%);
      background:rgba(12,12,14,.88);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
      color:#fff;font-size:13px;padding:10px 16px;border-radius:10px;
      box-shadow:0 4px 16px rgba(0,0,0,.35);font-family:system-ui,sans-serif;max-width:80vw;pointer-events:auto;}
    .jqitem{background:rgba(255,255,255,.06);border-radius:8px;padding:8px 10px;margin-bottom:8px;}
    .jqmeta{font-size:11px;color:rgba(255,255,255,.5);font-weight:700;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px;}
    .jqtext{font-size:12.5px;white-space:pre-wrap;word-break:break-word;color:#f5f5f7;}
    .jqopts{font-size:11.5px;color:rgba(255,255,255,.5);margin-top:4px;white-space:pre-wrap;word-break:break-word;}
    .jqans{display:none;background:#f5f5f7;border:1px solid #f5f5f7;color:#0a0a0b;border-radius:8px;
      padding:7px 9px;font-size:12.5px;margin-top:7px;white-space:pre-wrap;word-break:break-word;}
    .jdetect{font-size:15px;}
    .jedge{position:fixed;left:0;top:50%;transform:translateY(-50%);width:26px;height:56px;
      border-radius:0 12px 12px 0;background:rgba(120,120,128,.06);
      backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
      border:1px solid rgba(255,255,255,.07);border-left:none;cursor:pointer;
      z-index:2147483647;pointer-events:auto;padding:0;
      display:flex;align-items:center;justify-content:center;
      color:rgba(128,128,136,.30);transition:width .15s,background .15s,color .15s;}
    .jedge svg{width:17px;height:17px;display:block;}
    .jedge:hover{width:32px;background:rgba(120,120,128,.16);color:rgba(128,128,136,.68);}
    .jedge .jghost-eye{fill:rgba(255,255,255,.45);}
    .jback{background:none;border:none;color:inherit;font-size:17px;cursor:pointer;padding:2px 6px;border-radius:6px;}
    .jback:hover{background:rgba(255,255,255,.12);}
    .jmenu-item{display:block;width:100%;box-sizing:border-box;text-align:left;cursor:pointer;
      background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:12px;
      padding:10px 12px;margin-bottom:8px;font-family:inherit;color:#f5f5f7;}
    .jmenu-item:hover{background:rgba(255,255,255,.15);}
    .jmenu-item{display:flex;align-items:center;gap:10px;}
    .jmenu-tx{flex:1;min-width:0;}
    .jmenu-tx b{display:block;font-size:13.5px;margin-bottom:2px;}
    .jmenu-tx span{font-size:11.5px;color:rgba(255,255,255,.55);line-height:1.45;display:block;}
    .jmenu-ic{width:36px;height:36px;border-radius:10px;background:#f5f5f7;color:#0a0a0b;
      display:flex;align-items:center;justify-content:center;flex:none;}
    .jmenu-ic svg{width:19px;height:19px;display:block;}
    .jmenu-lens{fill:#f5f5f7;}
    .jmenu-ch{color:rgba(255,255,255,.4);font-size:19px;flex:none;padding-right:2px;}
    .jhead-ic{width:30px;height:30px;border-radius:9px;background:#f5f5f7;color:#0a0a0b;
      display:flex;align-items:center;justify-content:center;flex:none;}
    .jhead-ic svg{width:18px;height:18px;display:block;}
    .jhead-ic .jghost-eye{fill:#f5f5f7;}
    .jhead-tx{display:flex;flex-direction:column;line-height:1.25;min-width:0;}
    .jhead-title{font-size:13px;font-weight:700;}
    .jhead-sub{font-size:10.5px;font-weight:400;color:rgba(255,255,255,.55);}
    .jauto-card{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.07);
      border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:10px 12px;margin-bottom:8px;}
    .jauto-tx{flex:1;min-width:0;}
    .jauto-tx b{display:block;font-size:13.5px;margin-bottom:2px;}
    .jauto-tx span{font-size:11.5px;color:rgba(255,255,255,.55);line-height:1.45;display:block;}
    .jswitch{width:42px;height:24px;border-radius:12px;border:1px solid rgba(255,255,255,.25);
      background:rgba(255,255,255,.12);position:relative;cursor:pointer;flex:none;padding:0;}
    .jswitch-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;
      background:#f5f5f7;transition:left .15s;}
    .jswitch.on{background:#f5f5f7;border-color:#f5f5f7;}
    .jswitch.on .jswitch-knob{left:20px;background:#0a0a0b;}
    .jauto-foot{font-size:11px;color:rgba(255,255,255,.45);padding:0 2px;}
    .jtab-card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);
      border-radius:12px;padding:10px 12px;margin-bottom:8px;}
    .jtab-tx b{display:block;font-size:13.5px;margin-bottom:2px;}
    .jtab-tx span{font-size:11.5px;color:rgba(255,255,255,.55);line-height:1.45;display:block;}
    .jradio-row{display:flex;gap:16px;margin-top:9px;}
    .jradio{display:flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer;color:#f5f5f7;}
    .jradio input{accent-color:#f5f5f7;width:15px;height:15px;margin:0;cursor:pointer;}
    .jask{width:auto;height:30px;border-radius:15px;padding:0 13px;font-size:12.5px;color:#f5f5f7;font-weight:600;}
    @media (prefers-color-scheme: dark){
      .jedge{color:rgba(170,170,178,.32);}
      .jedge:hover{color:rgba(170,170,178,.7);}
      .jedge .jghost-eye{fill:rgba(0,0,0,.4);}
    }

  `;

  function ensureHost() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'jawab-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = CSS;
    shadow.appendChild(st); /* style HARUS di dalam shadow root agar berlaku */
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* escape HTML: renderer tidak pernah memasukkan raw HTML */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* mini markdown -> DOM (textContent di mana-mana: tidak ada innerHTML,
     teks AI tidak pernah bisa menyuntikkan markup) */
  function appendInline(parent, text) {
    const re = /(\*\*[^*]+\*\*|`[^`\n]+`)/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      const tok = m[0];
      if (tok.charAt(0) === '*') {
        const b = document.createElement('b');
        b.textContent = tok.slice(2, -2);
        parent.appendChild(b);
      } else {
        const c = document.createElement('code');
        c.textContent = tok.slice(1, -1);
        parent.appendChild(c);
      }
      last = m.index + tok.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function renderMd(container, src) {
    container.replaceChildren();
    const lines = String(src).split('\n');
    let inFence = false;
    let fenceBuf = [];
    const flushFence = () => {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = fenceBuf.join('\n');
      pre.appendChild(code);
      container.appendChild(pre);
      fenceBuf = [];
    };
    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        if (inFence) { flushFence(); inFence = false; } else inFence = true;
        continue;
      }
      if (inFence) { fenceBuf.push(line); continue; }
      if (!line.trim()) continue;
      const h = /^#{2,3}\s+(.*)$/.exec(line);
      if (h) {
        const hp = document.createElement('p');
        const hb = document.createElement('b');
        appendInline(hb, h[1]);
        hp.appendChild(hb);
        container.appendChild(hp);
        continue;
      }
      const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
      if (li) {
        const item = document.createElement('li');
        appendInline(item, li[1]);
        container.appendChild(item);
        continue;
      }
      const para = document.createElement('p');
      appendInline(para, line);
      container.appendChild(para);
    }
    if (inFence) flushFence();
  }
  function toast(msg, ms) {
    ensureHost();
    const t = el('div', 'jtoast', msg);
    shadow.appendChild(t);
    setTimeout(() => t.remove(), ms || 3500);
  }

  /* ============ messaging ke background ============ */

  function bg(msg) {
    return chrome.runtime.sendMessage(msg);
  }

  async function loadBtnPos() {
    try {
      const r = await bg({ type: 'ui-pref-get' });
      if (r && r.ok) return { left: r.btnLeft, top: r.btnTop };
    } catch (e) {}
    return { left: null, top: null };
  }

  function saveBtnPos(left, top) {
    bg({ type: 'ui-pref-set', left: left, top: top }).catch(() => {});
  }

  /* ============ tombol gunting (draggable) ============ */

  function initScissors() {
    ensureHost();
    if (cutBtn) return;
    cutBtn = el('button', 'jbtn jcut', '');
    cutBtn.title = 'Potret area (atau klik ikon Jawab / Alt+Shift+S)';
    cutBtn.setAttribute('aria-label', 'Potret area untuk Jawab');
    shadow.appendChild(cutBtn);
    loadBtnPos().then((p) => {
      if (typeof p.left === 'number') cutBtn.style.left = p.left + 'px';
      else cutBtn.style.right = '18px';
      if (typeof p.top === 'number') cutBtn.style.top = p.top + 'px';
      else cutBtn.style.bottom = '18px';
    });
    let sx, sy, ox, oy, moved;
    cutBtn.addEventListener('mousedown', (e) => {
      moved = false; sx = e.clientX; sy = e.clientY;
      const r = cutBtn.getBoundingClientRect(); ox = r.left; oy = r.top;
      cutBtn.style.right = 'auto'; cutBtn.style.bottom = 'auto';
      const mm = (ev) => {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 6) moved = true;
        if (moved) {
          cutBtn.style.left = (ox + ev.clientX - sx) + 'px';
          cutBtn.style.top = (oy + ev.clientY - sy) + 'px';
        }
      };
      const mu = () => {
        document.removeEventListener('mousemove', mm);
        document.removeEventListener('mouseup', mu);
        if (moved) {
          const r2 = cutBtn.getBoundingClientRect();
          saveBtnPos(Math.round(r2.left), Math.round(r2.top));
        } else {
          enterCaptureMode();
        }
      };
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    });
  }

  /* ============ tombol "?" seleksi teks ============ */

  function inPasswordField(node) {
    let n = node;
    while (n && n !== document.documentElement) {
      if (n.tagName === 'INPUT' && n.type === 'password') return true;
      n = n.parentNode;
    }
    return false;
  }

  function getSelectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const raw = sel.toString();
    if (!raw || raw.trim().length < MIN_SEL) return null; /* trim hanya untuk validasi */
    const node = sel.anchorNode;
    if (node && inPasswordField(node)) return null;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    /* deteksi kode: ancestor pre/code atau class language-* */
    let isCode = false, language = '';
    let n = node && node.parentNode;
    let depth = 0;
    while (n && n !== document.body && depth < 6) {
      const tag = n.tagName;
      if (tag === 'PRE' || tag === 'CODE') { isCode = true; }
      const cls = (n.className && typeof n.className === 'string') ? n.className : '';
      const m = /language-([\w+-]+)/.exec(cls);
      if (m) { isCode = true; language = m[1]; }
      n = n.parentNode; depth++;
    }
    return { raw: raw, isCode: isCode, language: language, rect: rect };
  }

  function showQBtn(x, y) {
    if (!tabVisible) return; /* mode sembunyi: pil seleksi pun tidak muncul */
    ensureHost();
    hideQBtn();
    qBtn = el('button', 'jbtn jask', 'Polter');
    qBtn.title = 'Tanya Polter';
    qBtn.setAttribute('aria-label', 'Tanya Polter tentang seleksi');
    qBtn.style.left = Math.min(x, window.innerWidth - 92) + 'px';
    qBtn.style.top = Math.max(4, y - 44) + 'px';
    qBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    qBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const info = getSelectionInfo();
      if (!info) { hideQBtn(); return; }
      startTextDraft(info);
    });
    shadow.appendChild(qBtn);
  }

  function hideQBtn() {
    if (qBtn) { qBtn.remove(); qBtn = null; }
  }

  document.addEventListener('mouseup', (e) => {
    if (!IS_TOP || captureSession) return;
    if (host && host.contains(e.target)) return;
    setTimeout(() => {
      if (captureSession || panel) return;
      const info = getSelectionInfo();
      if (info && info.rect) {
        showQBtn(info.rect.right, info.rect.top);
      } else {
        hideQBtn();
      }
    }, 10);
  });

  document.addEventListener('mousedown', (e) => {
    if (host && host.contains(e.target)) return;
    hideQBtn();
  });

  document.addEventListener('keyup', (e) => {
    if (!IS_TOP || captureSession || panel) return;
    if (e.key === 'Shift' || e.key.startsWith('Arrow')) {
      const info = getSelectionInfo();
      if (info && info.rect) showQBtn(info.rect.right, info.rect.top);
    }
  });

  /* ============ deteksi soal / formulir langsung di halaman (v0.4.0) ============
     Tanpa foto/screenshot: scan DOM untuk field + labelnya dan blok soal.
     Pengisian bersifat user-triggered dan TIDAK PERNAH men-submit form. */

  function normText(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function normMatch(s) {
    return normText(s).toLowerCase().replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  function isVisibleEl(elm) {
    if (!elm || !elm.getBoundingClientRect) return false;
    const r = elm.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    try {
      const st = window.getComputedStyle(elm);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    } catch (e) {}
    return true;
  }

  function strippedText(node, removeSelectors) {
    try {
      const c = node.cloneNode(true);
      const sel = removeSelectors || 'script,style,input,select,textarea,button';
      c.querySelectorAll(sel).forEach((n) => n.remove());
      return normText(c.textContent);
    } catch (e) { return ''; }
  }

  function labelElementText(labelEl, fieldEl) {
    /* teks label tanpa isi field di dalamnya (penting untuk <select>: jangan ikutkan semua opsi) */
    return strippedText(labelEl, 'script,style,input,select,textarea,button,option');
  }

  function findLabelByFor(elm) {
    if (!elm.id) return null;
    const labels = document.querySelectorAll('label');
    for (const l of labels) { if (l.htmlFor === elm.id) return l; }
    return null;
  }

  function textByIds(attr) {
    if (!attr) return '';
    const parts = [];
    for (const id of String(attr).split(/\s+/)) {
      const t = document.getElementById(id);
      if (t) parts.push(normText(t.textContent));
    }
    return normText(parts.join(' '));
  }

  function ancestorQuestionText(elm) {
    /* Naik ke ancestor terdekat yang memuat teks soal (menutup pola Google Forms,
       Microsoft Forms, Moodle .qtext, dan LMS lain yang labelnya bukan <label>). */
    let anc = elm.parentElement;
    let depth = 0;
    while (anc && anc !== document.body && depth < 6) {
      const hit = anc.querySelector(
        ':scope .qtext, :scope [class*="question" i], :scope [role="heading"], ' +
        ':scope legend, :scope h1, :scope h2, :scope h3, :scope h4');
      if (hit && hit !== elm) {
        const t = strippedText(hit);
        if (t.length >= 8 && t.length <= 600) return t;
      }
      /* Fallback teks utuh ancestor DULU menjadi sumber "jawaban dianggap
         soal": teks ancestor = soal + SEMUA pilihan + teks sekitar. Sekarang
         hanya diterima bila ancestor itu wadah teks murni (tanpa field /
         tombol / pilihan di dalamnya) - ciri wadah batang soal, bukan kartu
         soal+pilihan. */
      const whole = strippedText(anc);
      if (whole.length >= 10 && whole.length <= 700 && whole.indexOf('?') !== -1 &&
          !anc.querySelector('input, select, textarea, button, [role="button"], [role="radio"], [role="checkbox"]')) return whole;
      anc = anc.parentElement; depth++;
    }
    return '';
  }

  function getFieldLabel(elm) {
    const byFor = findLabelByFor(elm);
    if (byFor) { const t = labelElementText(byFor, elm); if (t.length >= 2) return t.slice(0, 500); }
    const wrap = elm.closest ? elm.closest('label') : null;
    if (wrap) { const t = labelElementText(wrap, elm); if (t.length >= 2) return t.slice(0, 500); }
    const aria = normText(elm.getAttribute && elm.getAttribute('aria-label'));
    if (aria.length >= 2) return aria.slice(0, 500);
    const labelledBy = textByIds(elm.getAttribute && elm.getAttribute('aria-labelledby'));
    if (labelledBy.length >= 2) return labelledBy.slice(0, 500);
    const ancQ = ancestorQuestionText(elm);
    if (ancQ) return ancQ.slice(0, 500);
    const ph = normText(elm.getAttribute && elm.getAttribute('placeholder'));
    if (ph.length >= 2) return ph.slice(0, 500);
    const describedBy = textByIds(elm.getAttribute && elm.getAttribute('aria-describedby'));
    if (describedBy.length >= 8) return describedBy.slice(0, 500);
    const nm = normText(elm.getAttribute && (elm.getAttribute('name') || elm.getAttribute('id')));
    if (nm) return nm.replace(/[_-]+/g, ' ').slice(0, 500);
    return '';
  }

  function optionLabelFor(input) {
    const byFor = findLabelByFor(input);
    if (byFor) { const t = labelElementText(byFor, input); if (t) return t; }
    const wrap = input.closest ? input.closest('label') : null;
    if (wrap) { const t = labelElementText(wrap, input); if (t) return t; }
    const aria = normText(input.getAttribute && input.getAttribute('aria-label'));
    if (aria) return aria;
    return normText(input.value);
  }

  function groupQuestionText(firstInput, type) {
    const fs = firstInput.closest ? firstInput.closest('fieldset') : null;
    if (fs) {
      const leg = fs.querySelector('legend');
      if (leg) { const t = strippedText(leg); if (t.length >= 3) return t.slice(0, 500); }
    }
    const ancQ = ancestorQuestionText(firstInput);
    if (ancQ) return ancQ.slice(0, 500);
    const nm = normText(firstInput.getAttribute('name'));
    if (nm) return ('Pilihan untuk: ' + nm.replace(/[_-]+/g, ' ')).slice(0, 500);
    return type === 'radio' ? 'Soal pilihan ganda (label soal tidak terdeteksi)' : 'Soal centang (label soal tidak terdeteksi)';
  }

  function scanPageQuestions() {
    lastScanError = '';
    const section = (fn) => {
      try { fn(); } catch (e) {
        if (!lastScanError) lastScanError = (e && e.message) || String(e);
      }
    };
    const out = [];
    const seenQ = new Set();
    const push = (item) => {
      const key = normMatch(item.question) + '|' + item.type;
      if (item.question && seenQ.has(key)) return;
      if (item.question) seenQ.add(key);
      if (out.length < 25) out.push(item);
    };

    /* 1) Grup radio / checkbox. Digabung per name DAN per kontainer soal:
       platform yang memakai satu name untuk semua soal (atau name kosong)
       tidak boleh melebur semua soal jadi satu grup - gejalanya "isi soal
       lain, jawaban sebelumnya ter-uncheck". Input asli yang disembunyikan
       platform (digambar ulang sebagai lingkaran kustom) tetap diterima
       bila label/induknya terlihat, karena klik programatik padanya sah. */
    section(() => {
    const groups = new Map();
    const containerIds = new Map();
    const groupContainerKey = (elm) => {
      const c = elm.closest && elm.closest('fieldset, li, tr, [class*="question" i], [data-testid*="question" i]');
      if (!c) return 'root';
      if (!containerIds.has(c)) containerIds.set(c, 'k' + containerIds.size);
      return containerIds.get(c);
    };
    const inputUsable = (inp) => {
      if (isVisibleEl(inp)) return true;
      const lab = (inp.closest && inp.closest('label')) || findLabelByFor(inp);
      if (lab && isVisibleEl(lab)) return true;
      const par = inp.parentElement;
      return !!(par && isVisibleEl(par));
    };
    document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((inp) => {
      if (!inputUsable(inp)) return;
      const key = inp.type + ':' + (inp.name || ('solo-' + (inp.id || Math.random()))) + '@' + groupContainerKey(inp);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(inp);
    });
    groups.forEach((els, key) => {
      const type = els[0].type;
      const options = els.map((i) => optionLabelFor(i)).filter(Boolean);
      push({
        question: groupQuestionText(els[0], type),
        type: type, options: options, el: null, els: els.slice()
      });
    });

    });
    /* 1b) Opsi kustom berbasis role (banyak platform kuis modern menggambar
       pilihan sebagai div role=radio/checkbox, bukan <input> asli).
       Konservatif: hanya yang terlihat, berkelompok dalam satu kontainer,
       dan kontainernya tidak sudah memuat input asli sejenis. */
    section(() => {
    const roleByContainer = new Map();
    const roleContainerIds = new Map();
    document.querySelectorAll('[role="radio"], [role="checkbox"]').forEach((elm) => {
      if (!isVisibleEl(elm)) return;
      const role = elm.getAttribute('role');
      const container = (elm.closest && (elm.closest('[role="radiogroup"], fieldset, form'))) ||
        elm.parentElement;
      if (!container) return;
      if (container.querySelector && container.querySelector('input[type="' + role + '"]')) return;
      /* pisahkan juga per kontainer soal di dalam radiogroup/form besar,
         pola yang sama seperti grup input asli */
      const qBox = (elm.closest && elm.closest('fieldset, li, [class*="question" i], [data-testid*="question" i]')) || container;
      if (!roleContainerIds.has(qBox)) roleContainerIds.set(qBox, 'q' + roleContainerIds.size);
      const key = roleContainerIds.get(qBox);
      if (!roleByContainer.has(key)) roleByContainer.set(key, { radio: [], checkbox: [], box: container });
      roleByContainer.get(key)[role].push(elm);
    });
    roleByContainer.forEach((byRole) => {
      for (const role of ['radio', 'checkbox']) {
        const els = byRole[role];
        if (!els.length) continue;
        const options = els.map((e) => normText(e.getAttribute('aria-label') || e.textContent)).filter(Boolean);
        if (options.length !== els.length) continue;
        push({
          question: groupQuestionText(els[0], role),
          type: role, options: options, el: null, els: els.slice(), customEls: true
        });
      }
    });

    });
    /* 1c) Kartu jawaban klik (pemain kuis SPA ala Wayground/Quizizz: tiap
       jawaban adalah tombol/kartu yang diklik, tanpa <input> dan tanpa
       role). Konservatif: 2-6 elemen klik bersaudara berteks pendek, tidak
       memuat field, di luar nav/header/footer, labelnya bukan tombol UI
       aplikasi (Edit/Preview/dsb), dan ada teks soal di ancestor. */
    section(() => {
    const UI_LABEL = /^(edit|preview|worksheet|share|save|delete|duplicate|next|back|submit|finish|check|hint|report|add|more|ai enhance.*)$/i;
    const cardSeen = new Set();
    const parentSeen = new Set();
    document.querySelectorAll('button, [role="button"], [class*="option" i], [class*="answer" i], [data-testid*="option" i], [data-testid*="answer" i]').forEach((seed) => {
      if (cardSeen.has(seed) || !isVisibleEl(seed)) return;
      const parent = seed.parentElement;
      if (!parent || parentSeen.has(parent)) return;
      parentSeen.add(parent);
      if (parent.closest && parent.closest('nav, header, footer')) return;
      const sibs = Array.from(parent.children).filter((c) => {
        if (!isVisibleEl(c)) return false;
        const isBtn = c.tagName === 'BUTTON' || (c.getAttribute && c.getAttribute('role') === 'button');
        if (!isBtn) {
          try { if (window.getComputedStyle(c).cursor !== 'pointer') return false; }
          catch (e) { return false; }
        }
        if (c.querySelector && c.querySelector('input, select, textarea')) return false;
        const tx = normText(c.textContent);
        return tx.length >= 1 && tx.length <= 120 && !UI_LABEL.test(tx);
      });
      if (sibs.length < 2 || sibs.length > 6) return;
      let hasImgC = false;
      const options = sibs.map((s, oi) => {
        const tx = normText(s.textContent);
        if (tx) return tx;
        const img = s.querySelector && s.querySelector('img');
        if (img) { hasImgC = true; return normText(img.getAttribute('alt')) || ('Gambar ' + 'ABCDEFGH'[oi]); }
        return '';
      }).filter(Boolean);
      if (options.length !== sibs.length) return;
      let q = ancestorQuestionText(sibs[0]);
      if (!q) {
        /* soal kuis sering tanpa tanda tanya: ambil teks ancestor setelah
           teks pilihan dibuang */
        let anc = parent, depth = 0;
        while (anc && anc !== document.body && depth < 4 && !q) {
          let txt = strippedText(anc);
          for (const opt of options) txt = txt.split(opt).join(' ');
          txt = normText(txt);
          if (txt.length >= 12 && txt.length <= 400 &&
              !options.some((o) => normMatch(o) === normMatch(txt))) q = txt;
          anc = anc.parentElement; depth++;
        }
      }
      if (!q) return;
      sibs.forEach((s) => cardSeen.add(s));
      push({ question: q, type: 'radio', options: options, el: null, els: sibs.slice(), customEls: true, imgOptions: hasImgC, cardEl: parent });
    });

    });

    /* 1d) Baris pilihan radio visual (pola Wayground Content View yang
       terverifikasi dari inspeksi DOM 2026-10-12: opsi adalah <div> polos
       cursor:pointer berisi ikon lingkaran <i class="icon-...-circle">,
       tanpa input/button/role/testid sama sekali; soal di <h3> kartu).
       Kandidat: terlihat, teks pendek, memuat ikon "circle", tanpa field
       di dalamnya; yang dipakai yang paling dalam (bukan pembungkusnya);
       dikelompokkan per induk. */
    section(() => {
      const cands = [];
      document.querySelectorAll('div, li, label, span').forEach((elm) => {
        if (!isVisibleEl(elm)) return;
        const tx = normText(elm.textContent);
        if (tx.length < 1 || tx.length > 120) return;
        if (!elm.querySelector || !elm.querySelector('[class*="circle" i]')) return;
        if (elm.querySelector('input, select, textarea, button')) return;
        try { if (window.getComputedStyle(elm).cursor !== 'pointer') return; }
        catch (e) { return; }
        cands.push(elm);
      });
      const rows = cands.filter((c) => !cands.some((o) => o !== c && c.contains(o)));
      const byParent = new Map();
      rows.forEach((r) => {
        const par = r.parentElement;
        if (!par) return;
        if (!byParent.has(par)) byParent.set(par, []);
        byParent.get(par).push(r);
      });
      byParent.forEach((els) => {
        if (els.length < 2 || els.length > 8) return;
        const options = els.map((e) => normText(e.textContent)).filter(Boolean);
        if (options.length !== els.length) return;
        const q = ancestorQuestionText(els[0]);
        if (!q) return;
        push({ question: q, type: 'radio', options: options, el: null, els: els.slice(), customEls: true });
      });
    });

    /* 1e) Ubin jawaban data-testid (pola Wayground Student View / sesi main
       yang terverifikasi: kartu [data-testid="mcq"], soal di
       [data-testid="question-query-text"], tiap opsi adalah div
       [data-testid="question-option"] dengan teks di
       [data-testid="option-text"]; mengklik ubin = menjawab). */
    section(() => {
      const opts = Array.from(document.querySelectorAll('[data-testid="question-option"]')).filter(isVisibleEl);
      if (!opts.length) return;
      const byCard = new Map();
      for (const o of opts) {
        const card = (o.closest && o.closest('[data-testid="mcq"]')) || o.parentElement;
        if (!card) continue;
        if (!byCard.has(card)) byCard.set(card, []);
        byCard.get(card).push(o);
      }
      byCard.forEach((els, card) => {
        const qEl = card.querySelector('[data-testid="question-query-text"]');
        const q = qEl ? normText(qEl.textContent) : ancestorQuestionText(els[0]);
        if (!q) return;
        let hasImg = false;
        const options = els.map((o, oi) => {
          const txEl = o.querySelector('[data-testid="option-text"]');
          const tx = normText(txEl ? txEl.textContent : o.textContent);
          if (tx) return tx;
          /* pilihan berupa gambar: beri label posisi agar soal tetap
             terdeteksi; gambarnya sendiri dikirim ke AI sebagai lampiran */
          const img = o.querySelector && o.querySelector('img');
          if (img) { hasImg = true; return normText(img.getAttribute('alt')) || ('Gambar ' + 'ABCDEFGH'[oi]); }
          return '';
        }).filter(Boolean);
        if (options.length !== els.length || options.length < 2) return;
        push({ question: q.slice(0, 500), type: 'radio', options: options, el: null, els: els.slice(), customEls: true, imgOptions: hasImg, cardEl: card });
      });
    });

    /* 2) Field isian: text-like input, textarea, select, contenteditable */
    section(() => {
    const SKIP_TYPES = ['hidden', 'password', 'file', 'submit', 'button', 'image', 'reset', 'radio', 'checkbox'];
    const fields = document.querySelectorAll('input, textarea, select, [contenteditable="true"]');
    fields.forEach((elm) => {
      if (host && (elm === host)) return;
      if (!isVisibleEl(elm)) return;
      const tag = elm.tagName;
      let type;
      if (tag === 'TEXTAREA') type = 'textarea';
      else if (tag === 'SELECT') type = 'select';
      else if (elm.isContentEditable) type = 'textarea';
      else {
        type = (elm.getAttribute('type') || 'text').toLowerCase();
        if (SKIP_TYPES.indexOf(type) !== -1) return;
        if (type === 'search' && elm.closest && elm.closest('form[role="search"], header, nav')) return;
      }
      const q = getFieldLabel(elm);
      if (!q || q.length < 2) return;
      const options = type === 'select'
        ? Array.from(elm.options || []).map((o) => normText(o.textContent)).filter((t) => t && !/^(pilih|select|--)/i.test(t))
        : [];
      push({ question: q, type: type, options: options, el: elm, els: null });
    });

    });
    /* 3) Blok soal tanpa field (kuis/teks): tampil sebagai soal baca-saja */
    section(() => {
    const blocks = document.querySelectorAll(
      'h1,h2,h3,h4,p,li,legend,[class*="question" i],[id*="question" i]');
    blocks.forEach((elm) => {
      if (out.length >= 25) return;
      if (!isVisibleEl(elm)) return;
      if (elm.querySelector && elm.querySelector('input,select,textarea')) return;
      const t = normText(elm.innerText || elm.textContent);
      if (t.length < 12 || t.length > 600) return;
      if (t.indexOf('?') === -1) return;
      /* jangan angkat teks JAWABAN menjadi soal: lewati blok yang teksnya
         persis salah satu pilihan dari soal yang sudah terdeteksi, atau
         yang elemennya memuat/dimuat elemen pilihan terdeteksi */
      const tnorm = normMatch(t);
      const isOptionText = out.some((o) => (o.options || []).some((op) => normMatch(op) === tnorm));
      if (isOptionText) return;
      const overlaps = out.some((o) => (o.els || []).some((e2) => e2 && (e2 === elm || e2.contains(elm) || elm.contains(e2))));
      if (overlaps) return;
      const dup = out.some((o) => {
        const a = normMatch(o.question), b = normMatch(t);
        return a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
      });
      if (dup) return;
      push({ question: t, type: 'block', options: [], el: null, els: null });
    });

    });
    out.forEach((item, i) => { item.index = i; });
    return out;
  }

  /* ---- filter soal: memastikan kandidat memang soal, bukan elemen UI ----
     Pilihan ganda: wajib >=2 pilihan wajar dan teks soal cukup panjang.
     Blok teks: wajib ada tanda tanya / kata tanya / pola klasifikasi.
     Field isian: label asli (bukan pencarian/login/dsb). */
  function looksLikeQuestion(item) {
    if (!item) return false;
    const q = normText(item.question);
    if (q.length < 3) return false;
    if (/^(home|menu|login|sign in|sign up|search|dashboard|settings|pengaturan|beranda|profil|profile|notifikasi|notifications?|keranjang|cart|checkout|logout|keluar|daftar|register)$/i.test(q)) return false;
    if (item.options && item.options.length >= 2) {
      if (q.length < 8) return false;
      const badOpt = item.options.some((o) => /^(edit|preview|next|back|submit|add|more|worksheet|share|ai enhance.*)$/i.test(normText(o)));
      if (badOpt) return false;
      const qn = normMatch(q);
      const optNorms = item.options.map((o) => normMatch(o)).filter(Boolean);
      if (optNorms.indexOf(qn) !== -1) return false; /* "soal" ini sebenarnya sebuah pilihan */
      const contained = optNorms.filter((on) => on.length >= 3 && qn.indexOf(on) !== -1).length;
      if (optNorms.length >= 2 && contained >= Math.ceil(optNorms.length / 2)) return false; /* blob soal+pilihan */
      return item.options.every((o) => { const n = normText(o); return n.length >= 1 && n.length <= 120; });
    }
    if (item.type === 'block') {
      if (q.length < 12) return false;
      if (q.indexOf('?') !== -1) return true;
      return /\b(apa|siapa|kapan|dimana|di mana|mengapa|bagaimana|berapa|manakah|klasifikasikan|tentukan|pilihlah|jelaskan|uraikan|what|who|when|where|why|how|which|classify|identify|choose|select|determine|describe|name the)\b/i.test(q) || /:\s*\S+/.test(q);
    }
    /* field isian: tolak field pencarian & kredensial bergaya login */
    if (/^(cari|search|telusuri|username|user name|password|kata sandi|e-?mail address for)/i.test(q)) return false;
    return q.length >= 3;
  }

  /* ---- parse jawaban AI (JSON array) dengan fallback baris bernomor ---- */

  function parseAnswers(raw) {
    const map = {};
    if (!raw) return map;
    const start = raw.indexOf('['), end = raw.lastIndexOf(']');
    if (start !== -1 && end > start) {
      try {
        const arr = JSON.parse(raw.slice(start, end + 1));
        if (Array.isArray(arr)) {
          for (const it of arr) {
            if (!it || typeof it !== 'object') continue;
            const idx = (typeof it.index === 'number') ? it.index :
              (typeof it.nomor === 'number' ? it.nomor - 1 : null);
            const ans = (it.answer != null) ? it.answer : it.jawaban;
            if (idx != null && ans != null) map[idx] = String(ans).trim();
          }
          if (Object.keys(map).length) return map;
        }
      } catch (e) { /* lanjut ke fallback */ }
    }
    const lines = String(raw).split('\n');
    for (const ln of lines) {
      const m = /^\s*(\d{1,2})[\.\)]\s*(.+)$/.exec(ln);
      if (m) map[parseInt(m[1], 10) - 1] = m[2].trim();
    }
    return map;
  }

  /* ---- pengisian ke halaman (tanpa submit, event input/change dibangkitkan
          agar framework seperti React/Vue ikut membaca nilai baru) ---- */

  function setNativeValue(elm, value) {
    let proto = null;
    if (elm.tagName === 'TEXTAREA') proto = window.HTMLTextAreaElement && HTMLTextAreaElement.prototype;
    else if (elm.tagName === 'INPUT') proto = window.HTMLInputElement && HTMLInputElement.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(elm, value);
    else elm.value = value;
    elm.dispatchEvent(new Event('input', { bubbles: true }));
    elm.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function matchOption(answer, options, positional) {
    const na = normMatch(answer);
    if (!na) return -1;
    for (let i = 0; i < options.length; i++) {
      if (normMatch(options[i]) === na) return i;
    }
    /* jawaban berupa huruf opsi ("B", "Gambar B") -> posisi */
    const lm = /^(?:gambar|opsi|pilihan|option)? ?([a-z])$/.exec(na);
    if (lm) {
      const li = lm[1].charCodeAt(0) - 97;
      if (li >= 0 && li < options.length) return li;
    }
    /* jawaban berupa nomor posisi ("2") - hanya untuk pilihan bergambar,
       di soal teks angka bisa berarti isi jawaban itu sendiri */
    if (positional) {
      const nm = /^(\d{1,2})$/.exec(na);
      if (nm) {
        const ni = parseInt(nm[1], 10) - 1;
        if (ni >= 0 && ni < options.length) return ni;
      }
    }
    for (let i = 0; i < options.length; i++) {
      const no = normMatch(options[i]);
      if (no && (na.indexOf(no) !== -1 || no.indexOf(na) !== -1)) return i;
    }
    return -1;
  }

  function fillDetected(item, answer) {
    if (!item || !answer) return false;
    answer = String(answer).trim().replace(/^["']|["']$/g, '');
    try {
      if (item.customEls) {
        /* Pilihan kustom (div role=radio, ubin kuis, baris radio visual):
           klik WAJIB terbukti mengubah state halaman, kalau tidak jangan
           mengaku berhasil - di halaman pratinjau klik memang tidak
           memilih apa pun, dan sukses palsu hanya membingungkan.
           Bukti diterima: aria-checked jadi true, elemen lepas dari
           dokumen (halaman berpindah soal), atau tanda tangan state
           (class elemen/ikon/induk) berubah setelah klik. */
        if (!item.els || !item.els.length) return false;
        const stateSig = (elm) => {
          let sig = (typeof elm.className === 'string') ? elm.className : '';
          const icon = elm.querySelector && elm.querySelector('i, svg, [class*="circle" i], [class*="check" i]');
          if (icon && typeof icon.className === 'string') sig += '|' + icon.className;
          const par = elm.parentElement;
          if (par && typeof par.className === 'string') sig += '|' + par.className;
          return sig;
        };
        const clickCustom = (elm) => {
          if (!elm || !document.contains(elm)) return false;
          const before = stateSig(elm);
          elm.click();
          elm.dispatchEvent(new Event('input', { bubbles: true }));
          elm.dispatchEvent(new Event('change', { bubbles: true }));
          if (!document.contains(elm)) return true;
          const ac = elm.getAttribute && elm.getAttribute('aria-checked');
          if (ac) return ac === 'true';
          return stateSig(elm) !== before;
        };
        if (item.type === 'radio') {
          const idx = matchOption(answer, item.options, item.imgOptions);
          if (idx === -1) return false;
          return clickCustom(item.els[idx]);
        }
        const partsC = answer.split(/[;,\n]/).map((s) => s.trim()).filter(Boolean);
        let anyC = false;
        partsC.forEach((part) => {
          const idx = matchOption(part, item.options, item.imgOptions);
          if (idx !== -1 && clickCustom(item.els[idx])) anyC = true;
        });
        if (!anyC) {
          const idx = matchOption(answer, item.options, item.imgOptions);
          if (idx !== -1) anyC = clickCustom(item.els[idx]);
        }
        return anyC;
      }
      if (item.type === 'radio') {
        const idx = matchOption(answer, item.options, item.imgOptions);
        if (idx === -1 || !item.els[idx] || !document.contains(item.els[idx])) return false;
        const target = item.els[idx];
        if (!target.checked) target.click();
        if (!target.checked) {
          /* sebagian framework menelan click(): set langsung + event */
          target.checked = true;
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return target.checked;
      }
      if (item.type === 'checkbox') {
        if (!item.els || !item.els.length) return false;
        if (item.els.length === 1) {
          const only = item.els[0];
          if (!document.contains(only)) return false;
          if (!only.checked) only.click();
          if (!only.checked) {
            only.checked = true;
            only.dispatchEvent(new Event('input', { bubbles: true }));
            only.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return only.checked;
        }
        const parts = answer.split(/[;,\n]/).map((p) => p.trim()).filter(Boolean);
        let any = false;
        parts.forEach((p) => {
          const idx = matchOption(p, item.options, item.imgOptions);
          if (idx !== -1 && item.els[idx] && !item.els[idx].checked) { item.els[idx].click(); any = true; }
          else if (idx !== -1) any = true;
        });
        if (!any) {
          const idx = matchOption(answer, item.options, item.imgOptions);
          if (idx !== -1 && item.els[idx]) { if (!item.els[idx].checked) item.els[idx].click(); any = true; }
        }
        return any;
      }
      const elm = item.el;
      if (!elm || !document.contains(elm)) return false;
      if (item.type === 'select') {
        const opts = Array.from(elm.options || []);
        const texts = opts.map((o) => normText(o.textContent));
        let idx = matchOption(answer, texts);
        if (idx === -1) {
          idx = opts.findIndex((o) => normMatch(o.value) === normMatch(answer));
        }
        if (idx === -1) return false;
        elm.selectedIndex = idx;
        elm.dispatchEvent(new Event('input', { bubbles: true }));
        elm.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      if (elm.isContentEditable) {
        elm.focus();
        elm.textContent = answer;
        elm.dispatchEvent(new Event('input', { bubbles: true }));
        elm.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      let v = answer;
      if (elm.type === 'number') {
        const m = /-?\d+(?:[.,]\d+)?/.exec(answer.replace(/\./g, ''));
        if (m) v = m[0].replace(',', '.');
      }
      setNativeValue(elm, v);
      return normText(elm.value) !== '';
    } catch (e) { return false; }
  }

  function distributeAnswers() {
    parsedAnswers = parseAnswers(lastRaw);
    const n = Object.keys(parsedAnswers).length;
    const body = panel && panel.querySelector('.jbody');
    if (!n) {
      toast('Jawaban AI tidak terbaca sebagai daftar terstruktur. Jawaban mentahnya tetap tampil di panel, isi manual dari situ ya.');
      return;
    }
    let shown = 0;
    for (const item of detected) {
      const ans = parsedAnswers[item.index];
      if (ans == null || !item._ansEl) continue;
      item._ansEl.style.display = '';
      item._ansEl.textContent = 'Jawaban: ' + ans;
      if (item._fillBtn) item._fillBtn.style.display = (item.type === 'block') ? 'none' : '';
      shown++;
    }
    if (body && body._fillAllBtn) body._fillAllBtn.style.display = shown ? '' : 'none';
    toast(n + ' jawaban terparse. Periksa dulu, lalu klik "Isi Semua ke Halaman". Tidak ada yang di-submit otomatis.');
  }

  /* Segarkan referensi elemen sebelum mengisi: platform SPA sering
     me-render ulang field antara pemindaian dan pengisian, sehingga
     referensi lama menempel ke node yang sudah dibuang. Pindai ulang,
     dan tukar referensi hanya bila jumlah + teks soal per index cocok. */
  function rescanForFill() {
    try {
      const fresh = scanPageQuestions();
      if (fresh.length !== detected.length) return;
      for (let i = 0; i < detected.length; i++) {
        if (fresh[i].type !== detected[i].type) continue;
        if (normMatch(fresh[i].question) !== normMatch(detected[i].question)) continue;
        detected[i].el = fresh[i].el;
        detected[i].els = fresh[i].els;
        detected[i].options = fresh[i].options;
        detected[i].customEls = fresh[i].customEls;
      }
    } catch (e) { /* gagal segarkan: pakai referensi lama */ }
  }

  function fillAllDetected() {
    rescanForFill();
    let okCount = 0, failCount = 0;
    for (const item of detected) {
      const ans = parsedAnswers[item.index];
      if (ans == null || item.type === 'block') continue;
      if (fillDetected(item, ans)) okCount++; else failCount++;
    }
    toast('Terisi: ' + okCount + ', gagal: ' + failCount + '. Periksa hasilnya sebelum submit (ekstensi tidak men-submit apa pun).', 5000);
  }

  /* ---- tombol deteksi (mengambang, di atas tombol gunting) ---- */

  function initDetectBtn() {
    ensureHost();
    if (detectBtn) return;
    detectBtn = el('button', 'jbtn jdetect', '');
    detectBtn.title = 'Deteksi soal / formulir di halaman ini (tanpa foto)';
    detectBtn.setAttribute('aria-label', 'Deteksi soal di halaman');
    detectBtn.style.right = '18px';
    detectBtn.style.bottom = '74px';
    detectBtn.addEventListener('click', (e) => { e.stopPropagation(); startDetectDraft(); });
    shadow.appendChild(detectBtn);
  }

  function startDetectDraft() {
    hideQBtn();
    discardDraft();
    const scanned = scanPageQuestions();
    lastScanRawCount = scanned.length;
    detected = scanned.filter(looksLikeQuestion);
    /* saringan lintas item: teks yang menjadi PILIHAN di soal lain tidak
       boleh berdiri sebagai soal tersendiri (gejala "jawaban dianggap soal") */
    const allOptNorms = new Set();
    detected.forEach((d) => (d.options || []).forEach((o) => { const n = normMatch(o); if (n.length >= 4) allOptNorms.add(n); }));
    detected = detected.filter((d) => {
      const qn = normMatch(d.question);
      if (!allOptNorms.has(qn)) return true;
      return (d.options || []).some((o) => normMatch(o) === qn); /* miliknya sendiri sudah ditangani filter */
    });
    detected.forEach((d, i) => { d.index = i; });
    parsedAnswers = {};
    draft = {
      kind: 'text',
      text: JSON.stringify({
        url: location.href, title: document.title,
        questions: detected.map((d) => ({ index: d.index, question: d.question, type: d.type, options: d.options }))
      }),
      isCode: false, language: '',
      sourceUrl: location.href, sourceTitle: document.title
    };
    currentAction = 'autofill';
    openPanel('detect', null);
    if (lastScanError) {
      toast('Sebagian pemindaian gagal di halaman ini: ' + lastScanError +
        '. Hasil yang tampil adalah bagian yang berhasil dipindai.', 5000);
    }
  }

  /* ============ draft teks ============ */

  function startTextDraft(info) {
    hideQBtn();
    discardDraft();
    draft = {
      kind: 'text',
      text: info.raw, /* mentah: spasi/tab/newline dipertahankan */
      isCode: info.isCode,
      language: info.language,
      sourceUrl: location.href,
      sourceTitle: document.title
    };
    currentAction = 'explain';
    openPanel('text', info.rect);
  }

  /* ============ tab tepi kiri + menu utama (v0.6) ============
     Satu-satunya tombol mengambang: tab tipis transparan di tepi kiri.
     Klik membuka panel menu berisi dua fitur + Auto Answer. */

  function ghostSvgEl() {
    const svgNS = 'http://www.w3.org/2000/svg';
    const gsvg = document.createElementNS(svgNS, 'svg');
    gsvg.setAttribute('viewBox', '0 0 24 24');
    gsvg.setAttribute('aria-hidden', 'true');
    const gbody = document.createElementNS(svgNS, 'path');
    gbody.setAttribute('d', 'M12 2a8 8 0 0 0-8 8v11.2l2.7-2 2.65 2 2.65-2 2.65 2 2.65-2 2.7 2V10a8 8 0 0 0-8-8z');
    gbody.setAttribute('fill', 'currentColor');
    gsvg.appendChild(gbody);
    [8.8, 15.2].forEach((cx) => {
      const eye = document.createElementNS(svgNS, 'circle');
      eye.setAttribute('cx', String(cx));
      eye.setAttribute('cy', '10.2');
      eye.setAttribute('r', '1.25');
      eye.setAttribute('class', 'jghost-eye');
      gsvg.appendChild(eye);
    });
    return gsvg;
  }

  function menuIconEl(kind) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    if (kind === 'camera') {
      const bp = document.createElementNS(NS, 'path');
      bp.setAttribute('d', 'M9.2 4.5 7.6 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2.6L14.8 4.5a1.5 1.5 0 0 0-1.2-.5H10.4a1.5 1.5 0 0 0-1.2.5z');
      bp.setAttribute('fill', 'currentColor');
      svg.appendChild(bp);
      const lens = document.createElementNS(NS, 'circle');
      lens.setAttribute('cx', '12');
      lens.setAttribute('cy', '13');
      lens.setAttribute('r', '3.4');
      lens.setAttribute('class', 'jmenu-lens');
      svg.appendChild(lens);
    } else {
      const bp = document.createElementNS(NS, 'path');
      bp.setAttribute('d', 'M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M3.5 12h17');
      bp.setAttribute('fill', 'none');
      bp.setAttribute('stroke', 'currentColor');
      bp.setAttribute('stroke-width', '2');
      bp.setAttribute('stroke-linecap', 'round');
      svg.appendChild(bp);
    }
    return svg;
  }

  function initEdgeTab() {
    ensureHost();
    if (edgeBtn) return;
    edgeBtn = el('button', 'jedge', '');
    edgeBtn.title = 'Polter - buka menu';
    edgeBtn.setAttribute('aria-label', 'Buka menu Polter');
    edgeBtn.appendChild(ghostSvgEl());
    edgeBtn.addEventListener('click', (e) => { e.stopPropagation(); openPanel('menu', null); });
    shadow.appendChild(edgeBtn);
  }

  function applyTabVisibility(v) {
    tabVisible = !!v;
    if (!tabVisible) {
      /* mode sembunyi: nol tombol mengambang — semuanya dihapus total dari
         DOM (bukan dibuat transparan): pil seleksi, tombol potret/deteksi */
      hideQBtn();
      if (cutBtn) { cutBtn.remove(); cutBtn = null; }
      if (detectBtn) { detectBtn.remove(); detectBtn = null; }
    }
    if (!IS_TOP) return;
    if (tabVisible) initEdgeTab();
    else if (edgeBtn) { edgeBtn.remove(); edgeBtn = null; }
  }

  function loadTabVisibility() {
    bg({ type: 'ui-pref-get' }).then((r) => {
      applyTabVisibility(!r || r.tabVisible !== false);
    }).catch(() => applyTabVisibility(true));
  }

  function autoFootText() {
    return 'Auto Answer ' + (autoState.on ? 'aktif' : 'nonaktif') +
      ' \u00B7 Polter tidak pernah menekan tombol kirim final.';
  }

  function buildMenuBody(body) {
    const mkItem = (iconKind, title, desc, onClick) => {
      const item = el('button', 'jmenu-item');
      const ic = el('span', 'jmenu-ic');
      ic.appendChild(menuIconEl(iconKind));
      item.appendChild(ic);
      const tx = el('span', 'jmenu-tx');
      tx.appendChild(el('b', '', title));
      tx.appendChild(el('span', '', desc));
      item.appendChild(tx);
      item.appendChild(el('span', 'jmenu-ch', '\u203A'));
      item.addEventListener('click', onClick);
      body.appendChild(item);
    };
    mkItem('camera', 'Ekstrak dari Foto',
      'Potret area soal di layar, Polter membaca gambarnya lalu menjawab.',
      () => { enterCaptureMode(); });
    mkItem('scan', 'Deteksi Soal di Layar',
      'Pindai soal yang sedang tampil \u2014 hanya yang lolos filter soal yang dijawab & diisi.',
      () => { startDetectDraft(); });

    const card = el('div', 'jauto-card');
    const atx = el('div', 'jauto-tx');
    atx.appendChild(el('b', '', 'Auto Answer'));
    atx.appendChild(el('span', '',
      'Soal baru yang tampil otomatis dijawab & diisi. Tetap aktif saat pindah soal atau halaman.'));
    card.appendChild(atx);
    const sw = el('button', 'jswitch' + (autoState.on ? ' on' : ''), '');
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', autoState.on ? 'true' : 'false');
    sw.setAttribute('aria-label', 'Auto Answer');
    sw.appendChild(el('span', 'jswitch-knob', ''));
    sw.addEventListener('click', () => { setAutoAnswer(!autoState.on); });
    card.appendChild(sw);
    body.appendChild(card);
    const foot = el('div', 'jauto-foot', autoFootText());
    body.appendChild(foot);

    /* kartu Tab Hantu: radio tampil/sembunyi tab langsung dari panel menu,
       menulis kunci yang sama dengan radio di Pengaturan */
    const tabCard = el('div', 'jtab-card');
    const ttx = el('div', 'jtab-tx');
    ttx.appendChild(el('b', '', 'Tab Hantu'));
    ttx.appendChild(el('span', '',
      'Sembunyikan tab dari layar — panggil menu lagi dengan Alt+Shift+M.'));
    tabCard.appendChild(ttx);
    const rrow = el('div', 'jradio-row');
    const mkRadio = (label, visible) => {
      const lab = el('label', 'jradio');
      const inp = document.createElement('input');
      inp.type = 'radio';
      inp.name = 'jtabmode';
      inp.checked = tabVisible === visible;
      inp.addEventListener('change', () => {
        if (!inp.checked) return;
        applyTabVisibility(visible);
        bg({ type: 'ui-pref-set', tabVisible: visible }).catch(() => {});
      });
      lab.appendChild(inp);
      lab.appendChild(el('span', '', label));
      return lab;
    };
    rrow.appendChild(mkRadio('Tampilkan', true));
    rrow.appendChild(mkRadio('Sembunyikan', false));
    tabCard.appendChild(rrow);
    body.appendChild(tabCard);
    body._autoToggle = sw;
    body._autoStatus = foot;
  }

  /* ============ capture mode ============ */

  function enterCaptureMode() {
    if (captureSession) return; /* idempotent */
    hideQBtn();
    closePanel(); /* draft baru: buang draft lama secara eksplisit */
    ensureHost();
    const overlay = el('div', 'jcap');
    const rectEl = el('div', 'jcap-rect');
    rectEl.style.display = 'none';
    const hint = el('div', 'jcap-hint', 'Seret area yang ingin dipotret. ESC untuk batal.');
    shadow.appendChild(overlay);
    shadow.appendChild(rectEl);
    shadow.appendChild(hint);
    const session = {
      overlay: overlay, rectEl: rectEl, hint: hint,
      startX: 0, startY: 0, dragging: false, cancelled: false
    };
    captureSession = session;

    const onMoveHint = (e) => {
      hint.style.left = (e.clientX + 14) + 'px';
      hint.style.top = (e.clientY + 14) + 'px';
    };
    const onDown = (e) => {
      if (session.cancelled) return;
      session.dragging = true;
      session.startX = e.clientX; session.startY = e.clientY;
    };
    const onMove = (e) => {
      onMoveHint(e);
      if (!session.dragging || session.cancelled) return;
      const x = Math.min(e.clientX, session.startX);
      const y = Math.min(e.clientY, session.startY);
      const w = Math.abs(e.clientX - session.startX);
      const h = Math.abs(e.clientY - session.startY);
      rectEl.style.display = 'block';
      rectEl.style.left = x + 'px'; rectEl.style.top = y + 'px';
      rectEl.style.width = w + 'px'; rectEl.style.height = h + 'px';
      session.rect = { x: x, y: y, w: w, h: h };
    };
    const onUp = (e) => {
      if (session.cancelled || !session.dragging) { cleanupCapture(); return; }
      const r = session.rect;
      cleanupCapture();
      if (r && r.w >= 8 && r.h >= 8) {
        finishCapture(r);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        session.cancelled = true;
        cleanupCapture();
        toast('Potret dibatalkan.');
      }
    };
    session.listeners = [
      [overlay, 'mousedown', onDown],
      [document, 'mousemove', onMove],
      [document, 'mousemove', onMoveHint],
      [document, 'mouseup', onUp],
      [document, 'keydown', onKey]
    ];
    for (const [t, ev, fn] of session.listeners) t.addEventListener(ev, fn);
  }

  /* cleanup idempotent: lepas SEMUA listener, pulihkan, tandai batal */
  function cleanupCapture() {
    const s = captureSession;
    captureSession = null;
    if (!s) return;
    if (s.listeners) {
      for (const [t, ev, fn] of s.listeners) {
        try { t.removeEventListener(ev, fn); } catch (e) {}
      }
    }
    try { s.overlay.remove(); } catch (e) {}
    try { s.rectEl.remove(); } catch (e) {}
    try { s.hint.remove(); } catch (e) {}
  }

  const paintSync = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  async function finishCapture(rect) {
    const metrics = {
      scrollX: window.scrollX, scrollY: window.scrollY,
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      dpr: window.devicePixelRatio || 1
    };
    /* Sembunyikan seluruh UI Jawab agar tidak ikut terpotret, sinkron dengan paint. */
    const prevDisplay = host.style.display;
    host.style.display = 'none';
    await paintSync();
    let res;
    try {
      res = await bg({ type: 'capture-region', rect: rect, metrics: metrics });
    } catch (e) {
      res = { ok: false, error: 'Gagal menghubungi extension: ' + e.message };
    }
    host.style.display = prevDisplay;
    if (!res || !res.ok) {
      draft = { kind: 'image', snippetId: null, imageId: null, error: (res && res.error) || 'Gagal memotret.' };
      openPanel('image', rect);
      return;
    }
    /* Validasi metrik sesudah capture: scroll/zoom/resize membatalkan. */
    const now = {
      scrollX: window.scrollX, scrollY: window.scrollY,
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      dpr: window.devicePixelRatio || 1
    };
    const changed = ['scrollX', 'scrollY', 'innerWidth', 'innerHeight', 'dpr']
      .some((k) => now[k] !== metrics[k]);
    if (changed) {
      bg({ type: 'delete-draft', id: res.id }).catch(() => {});
      draft = { kind: 'image', snippetId: null, imageId: null, error: 'Halaman berubah (scroll/zoom/resize) saat memotret. Ulangi potret.' };
      openPanel('image', rect);
      return;
    }
    draft = {
      kind: 'image',
      snippetId: res.id, /* id snippet (untuk Simpan/Unduh) */
      imageId: res.blobId, /* id blob (untuk request AI) */
      thumb: res.thumb,
      title: '',
      sourceUrl: location.href,
      sourceTitle: document.title
    };
    currentAction = 'answer';
    pendingImageAutoAsk = true;
    openPanel('image', rect);
  }

  /* ============ panel ============ */

  function hidePanel() {
    /* hanya cleanup UI; draft TIDAK disentuh */
    panelMode = '';
    if (panel) { panel.remove(); panel = null; }
    if (port) {
      expectDisconnect = true;
      try { port.disconnect(); } catch (e) {}
      port = null;
    }
    answering = false;
    currentRequestId = null;
    lastRaw = '';
  }

  function discardDraft() { draft = null; }

  function closePanel() {
    /* ✕ / ESC: tutup UI dan buang draft memori (draft gambar sudah aman di IDB) */
    if (draft && draft.kind === 'image' && draft.imageId && !draft.savedOnce) {
      /* biarkan sebagai draft di library; cleanup TTL yang menghapus */
    }
    hidePanel();
    discardDraft();
  }

  function placePanel(panelEl, anchorRect) {
    let x = window.innerWidth - 364;
    let y = 80;
    if (panelMode === 'menu' || panelMode === 'detect') { x = 14; y = 110; }
    if (anchorRect) {
      x = Math.min(anchorRect.left, window.innerWidth - 364);
      y = Math.min(Math.max(8, anchorRect.bottom + 8), window.innerHeight - 200);
      if (x < 8) x = 8;
    }
    panelEl.style.left = Math.max(8, x) + 'px';
    panelEl.style.top = Math.max(8, y) + 'px';
  }

  function openPanel(mode, anchorRect) {
    hidePanel(); /* UI lama dihancurkan; draft tetap milik pemanggil */
    panelMode = mode;
    ensureHost();
    panel = el('div', 'jpanel');
    panel.setAttribute('role', 'dialog');
    const modeLabel = mode === 'image' ? 'Polter - tangkapan layar'
      : (mode === 'detect' ? 'Polter - deteksi halaman'
        : (mode === 'menu' ? 'Polter' : 'Polter - seleksi teks'));
    panel.setAttribute('aria-label', modeLabel);
    const head = el('div', 'jhead');
    if (mode !== 'menu') {
      const back = el('button', 'jback', '\u2039');
      back.title = 'Kembali ke menu';
      back.setAttribute('aria-label', 'Kembali ke menu');
      back.addEventListener('click', () => openPanel('menu', null));
      head.appendChild(back);
    }
    const headIc = el('span', 'jhead-ic');
    headIc.appendChild(ghostSvgEl());
    head.appendChild(headIc);
    const headTx = el('span', 'jhead-tx');
    const headTitle = el('span', 'jhead-title',
      mode === 'menu' ? 'Polter' : modeLabel.replace('Polter - ', ''));
    headTx.appendChild(headTitle);
    headTx.appendChild(el('span', 'jhead-sub', 'Polter : Unseen, Unheard, Done.'));
    head.appendChild(headTx);
    const x = el('button', 'jx', '\u00D7');
    x.setAttribute('aria-label', 'Tutup');
    x.addEventListener('click', () => closePanel());
    head.appendChild(x);
    panel.appendChild(head);
    const body = el('div', 'jbody');
    panel.appendChild(body);
    if (mode === 'image') buildImageBody(body);
    else if (mode === 'detect') buildDetectBody(body);
    else if (mode === 'menu') buildMenuBody(body);
    else buildTextBody(body);
    shadow.appendChild(panel);
    placePanel(panel, anchorRect);
    /* drag panel via header */
    let px, py, pox, poy, pmoved;
    head.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('.jx')) return; /* tombol close */
      pmoved = false; px = e.clientX; py = e.clientY;
      const r = panel.getBoundingClientRect(); pox = r.left; poy = r.top;
      const mm = (ev) => {
        if (Math.abs(ev.clientX - px) + Math.abs(ev.clientY - py) > 4) pmoved = true;
        if (pmoved) {
          panel.style.left = Math.max(0, Math.min(pox + ev.clientX - px, window.innerWidth - 60)) + 'px';
          panel.style.top = Math.max(0, Math.min(poy + ev.clientY - py, window.innerHeight - 40)) + 'px';
        }
      };
      const mu = () => {
        document.removeEventListener('mousemove', mm);
        document.removeEventListener('mouseup', mu);
      };
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
      e.preventDefault();
    });
    const input = body.querySelector('.jinput');
    if (input) input.focus();
  }

  function answerEls(body) {
    const ans = el('div', 'jans');
    ans.setAttribute('aria-live', 'polite');
    body.appendChild(ans);
    const row = el('div', 'jrow');
    const stop = el('button', 'jbtn2', 'Stop');
    stop.style.display = 'none';
    stop.setAttribute('aria-label', 'Hentikan request');
    stop.addEventListener('click', () => stopAsk('dibatalkan pengguna'));
    const copy = el('button', 'jbtn2', 'Salin jawaban');
    copy.style.display = 'none';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(lastRaw);
        copy.textContent = 'Tersalin!';
        setTimeout(() => { copy.textContent = 'Salin jawaban'; }, 1500);
      } catch (e) { toast('Gagal menyalin.'); }
    });
    row.appendChild(stop);
    row.appendChild(copy);
    body.appendChild(row);
    return { ans: ans, stop: stop, copy: copy };
  }

  /* ---- body deteksi halaman ---- */

  function buildDetectBody(body) {
    const info = el('div', 'jprev',
      detected.length + ' soal lolos filter' +
        (lastScanRawCount > detected.length ? ' (dari ' + lastScanRawCount + ' kandidat yang terdeteksi mentah)' : '') +
        ', langsung dari halaman ini (tanpa foto) dan langsung dijawab otomatis. ' +
        'Periksa jawabannya, lalu "Isi Semua ke Halaman". Ekstensi tidak pernah menekan tombol submit.');
    body.appendChild(info);

    if (!detected.length) {
      const note = el('div', 'jnote',
        lastScanRawCount > 0
          ? 'Ada ' + lastScanRawCount + ' kandidat terdeteksi, tapi tidak ada yang lolos filter soal (kemungkinan besar itu elemen UI, bukan soal). Bila menurutmu itu soal beneran, pakai Ekstrak dari Foto atau seleksi teks.'
          : 'Tidak ada soal/field yang terdeteksi di frame ini. Halaman ini mungkin menggambar soal sebagai gambar/canvas, ' +
            'memakai komponen yang tidak standar, atau soalnya belum tampil. Coba tampilkan soalnya dulu lalu Pindai Ulang, ' +
            'atau pakai seleksi teks / potret area seperti biasa.');
      body.appendChild(note);
    }

    const list = el('div', '');
    for (const item of detected) {
      const box = el('div', 'jqitem');
      const meta = el('div', 'jqmeta',
        '#' + (item.index + 1) + ' - ' + item.type + (item.type === 'block' ? ' (baca saja, tidak ada field untuk diisi)' : ''));
      box.appendChild(meta);
      const qt = el('div', 'jqtext', item.question);
      box.appendChild(qt);
      if (item.options && item.options.length) {
        const op = el('div', 'jqopts', 'Pilihan: ' + item.options.join(' | '));
        box.appendChild(op);
      }
      const ans = el('div', 'jqans');
      item._ansEl = ans;
      box.appendChild(ans);
      const row = el('div', 'jrow');
      row.style.marginTop = '6px';
      row.style.marginBottom = '0';
      const fillBtn = el('button', 'jbtn2', 'Isi yang ini');
      fillBtn.style.display = 'none';
      fillBtn.addEventListener('click', () => {
        const a = parsedAnswers[item.index];
        if (a == null) return;
        rescanForFill();
        const fresh = detected[item.index] || item;
        toast(fillDetected(fresh, a) ? 'Terisi: soal #' + (item.index + 1) : 'Gagal mengisi soal #' + (item.index + 1) + ' (field berubah / jawaban tidak cocok dengan pilihan)');
      });
      item._fillBtn = fillBtn;
      row.appendChild(fillBtn);
      box.appendChild(row);
      list.appendChild(box);
    }
    body.appendChild(list);

    const row = el('div', 'jrow');
    const rescan = el('button', 'jbtn2', 'Pindai Ulang');
    rescan.addEventListener('click', () => startDetectDraft());
    const fillAll = el('button', 'jbtn2', 'Isi Semua ke Halaman');
    fillAll.style.display = 'none';
    fillAll.addEventListener('click', fillAllDetected);
    row.appendChild(rescan); row.appendChild(fillAll);
    body.appendChild(row);
    body._fillAllBtn = fillAll;

    const a = answerEls(body);
    body._jawab = a;
    /* langsung jawab - tanpa klik tambahan; Pindai Ulang tetap ada di atas */
    if (detected.length) startAsk({ question: '', action: 'autofill' });
  }

  /* ---- body teks ---- */

  function buildTextBody(body) {
    const prev = el('pre', 'jprev', draft.text);
    body.appendChild(prev);

    const typeRow = el('div', 'jrow');
    const tBtn = el('button', 'jbtn2' + (draft.isCode ? '' : ' on'), 'Teks');
    const cBtn = el('button', 'jbtn2' + (draft.isCode ? ' on' : ''), 'Kode');
    const lang = el('input', 'jinput', '');
    lang.placeholder = 'bahasa (cth: js, python)';
    lang.value = draft.language || '';
    lang.style.display = draft.isCode ? '' : 'none';
    lang.style.marginBottom = '0';
    lang.style.width = '140px';
    tBtn.addEventListener('click', () => {
      draft.isCode = false; tBtn.classList.add('on'); cBtn.classList.remove('on'); lang.style.display = 'none';
    });
    cBtn.addEventListener('click', () => {
      draft.isCode = true; cBtn.classList.add('on'); tBtn.classList.remove('on'); lang.style.display = '';
    });
    lang.addEventListener('input', () => { draft.language = lang.value; });
    typeRow.appendChild(tBtn); typeRow.appendChild(cBtn); typeRow.appendChild(lang);
    body.appendChild(typeRow);

    const row = el('div', 'jrow');
    const save = el('button', 'jbtn2', 'Simpan');
    const copy = el('button', 'jbtn2', 'Salin');
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const r = await bg({
          type: 'save-text-snippet',
          snippet: {
            text: draft.text, isCode: draft.isCode, language: draft.language,
            title: (draft.isCode ? 'Kode: ' : '') + draft.text.slice(0, 60).replace(/\s+/g, ' '),
            sourceUrl: draft.sourceUrl, sourceTitle: draft.sourceTitle
          }
        });
        if (r && r.ok) toast('Tersimpan di Library.');
        else toast('Gagal menyimpan: ' + ((r && r.error) || ''));
      } catch (e) { toast('Gagal menyimpan: ' + e.message); }
      save.disabled = false;
    });
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(draft.text); toast('Tersalin.'); }
      catch (e) { toast('Gagal menyalin.'); }
    });
    row.appendChild(save); row.appendChild(copy);
    body.appendChild(row);

    const sec = el('div', 'jsec', 'Tanya AI (tidak otomatis)');
    body.appendChild(sec);
    const chips = el('div', 'jrow');
    const actions = [['explain', 'Jelaskan'], ['summarize', 'Ringkas'], ['translate', 'Terjemahkan']];
    const chipBtns = {};
    for (const [key, label] of actions) {
      const b = el('button', 'jbtn2' + (key === currentAction ? ' on' : ''), label);
      b.addEventListener('click', () => {
        currentAction = key;
        for (const k of Object.keys(chipBtns)) chipBtns[k].classList.toggle('on', k === key);
      });
      chipBtns[key] = b;
      chips.appendChild(b);
    }
    body.appendChild(chips);
    const q = el('input', 'jinput', '');
    q.placeholder = 'Pertanyaan (opsional), Enter untuk kirim';
    q.setAttribute('aria-label', 'Pertanyaan tambahan');
    body.appendChild(q);
    const go = el('button', 'jbtn2', 'Tanya AI');
    go.addEventListener('click', () => startAsk({ question: q.value, action: currentAction }));
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') startAsk({ question: q.value, action: currentAction }); });
    body.appendChild(go);

    const a = answerEls(body);
    body._jawab = a;
  }

  /* ---- body gambar ---- */

  function buildImageBody(body) {
    if (draft.error || !draft.imageId) {
      const err = el('div', 'jerr', draft.error || 'Gambar tidak valid.');
      body.appendChild(err);
      const row = el('div', 'jrow');
      const re = el('button', 'jbtn2', 'Potret Lagi');
      re.addEventListener('click', () => { closePanel(); enterCaptureMode(); });
      row.appendChild(re);
      body.appendChild(row);
      return;
    }
    const title = el('input', 'jinput', '');
    title.placeholder = 'Judul (opsional)';
    title.value = draft.title || '';
    title.setAttribute('aria-label', 'Judul gambar');
    title.addEventListener('input', () => { draft.title = title.value; });
    body.appendChild(title);

    const img = el('img', 'jthumb', '');
    img.src = draft.thumb;
    img.alt = 'Preview potret area';
    body.appendChild(img);

    const row = el('div', 'jrow');
    const save = el('button', 'jbtn2', 'Simpan');
    const dl = el('button', 'jbtn2', 'Unduh');
    const re = el('button', 'jbtn2', 'Potret Lagi');
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const r = await bg({ type: 'finalize-image-snippet', id: draft.snippetId, title: draft.title });
        if (r && r.ok) { draft.savedOnce = true; toast('Tersimpan di Library.'); }
        else toast('Gagal menyimpan: ' + ((r && r.error) || ''));
      } catch (e) { toast('Gagal menyimpan: ' + e.message); }
      save.disabled = false;
    });
    dl.addEventListener('click', async () => {
      try {
        const r = await bg({ type: 'download-image', id: draft.snippetId });
        if (r && r.ok) toast('Mengunduh...');
        else toast('Gagal mengunduh: ' + ((r && r.error) || ''));
      } catch (e) { toast('Gagal mengunduh: ' + e.message); }
    });
    re.addEventListener('click', () => { closePanel(); enterCaptureMode(); });
    row.appendChild(save); row.appendChild(dl); row.appendChild(re);
    body.appendChild(row);

    const sec = el('div', 'jsec', 'Proses dengan AI (gambar yang sama dipakai ulang)');
    body.appendChild(sec);
    const presets = el('div', 'jrow');
    const defs = [
      ['explain', 'Jelaskan'], ['summarize', 'Ringkas'], ['translate', 'Terjemahkan'],
      ['extract', 'Ekstrak Teks'], ['answer', 'Jawab Soal']
    ];
    for (const [key, label] of defs) {
      const b = el('button', 'jbtn2', label);
      b.addEventListener('click', () => startAsk({ question: q.value, action: key }));
      presets.appendChild(b);
    }
    body.appendChild(presets);
    const q = el('input', 'jinput', '');
    q.placeholder = 'Pertanyaan custom (opsional)';
    q.setAttribute('aria-label', 'Pertanyaan custom');
    body.appendChild(q);
    const go = el('button', 'jbtn2', 'Proses');
    go.addEventListener('click', () => {
      if (!q.value.trim()) { toast('Isi pertanyaan custom dulu, atau pakai preset di atas.'); return; }
      startAsk({ question: q.value, action: 'custom' });
    });
    body.appendChild(go);

    const a = answerEls(body);
    body._jawab = a;
    if (pendingImageAutoAsk) {
      pendingImageAutoAsk = false;
      startAsk({ question: '', action: 'answer' });
    }
  }

  /* ============ Auto Answer ============
     Bila aktif (tersimpan di storage, jadi tetap aktif setelah pindah
     soal maupun pindah halaman): pantau perubahan DOM; soal baru yang
     lolos filter -> deteksi ulang -> tanya AI -> distribusi -> isi
     otomatis. Berhenti sendiri setelah 3x gagal berturut-turut.
     Tidak pernah menekan tombol submit/kirim final. */

  function autoSignature(items) {
    return items.map((i) => normMatch(i.question) + '~' + i.type + '~' + (i.options ? i.options.length : 0)).join('||');
  }

  function refreshAutoUI() {
    const body = panel && panel.querySelector('.jbody');
    if (body && body._autoToggle) {
      body._autoToggle.classList.toggle('on', autoState.on);
      body._autoToggle.setAttribute('aria-checked', autoState.on ? 'true' : 'false');
    }
    if (body && body._autoStatus) {
      body._autoStatus.textContent = autoFootText();
    }
  }

  function setAutoAnswer(on, silent) {
    autoState.on = !!on;
    try { chrome.storage.local.set({ jawabAutoAnswer: autoState.on }); } catch (e) {}
    if (autoState.on) {
      autoWatchStart();
      if (!silent) toast('Auto Answer AKTIF. Soal baru yang tampil akan dijawab + diisi otomatis.');
      autoCycle();
    } else {
      autoWatchStop();
      autoState.lastSig = '';
      autoState.pendingSig = '';
      autoState.busy = false;
      if (!silent) toast('Auto Answer mati.');
    }
    refreshAutoUI();
  }

  function autoWatchStart() {
    if (autoState.observer) return;
    let deb = null;
    autoState.observer = new MutationObserver(() => {
      autoState.dirty = true;
      if (deb) clearTimeout(deb);
      deb = setTimeout(autoCycle, 700);
    });
    try { autoState.observer.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    /* interval hanya memindai bila observer melihat perubahan - halaman
       statis tidak dipindai ulang tiap 3 detik (sumber rasa "lambat") */
    autoState.timer = setInterval(() => { if (autoState.dirty) autoCycle(); }, 3000);
  }

  function autoWatchStop() {
    if (autoState.observer) { autoState.observer.disconnect(); autoState.observer = null; }
    if (autoState.timer) { clearInterval(autoState.timer); autoState.timer = null; }
  }

  function autoCycle() {
    if (!autoState.on || autoState.busy || answering || captureSession) return;
    if (document.hidden) return;
    if (panel && panelMode !== 'detect' && panelMode !== 'menu') return; /* jangan rebut mode teks/gambar */
    let items;
    try { items = scanPageQuestions().filter(looksLikeQuestion); } catch (e) { return; }
    autoState.dirty = false;
    if (!items.length) return;
    if (autoSignature(items) === autoState.lastSig) return;
    autoState.busy = true;
    startDetectDraft();
    const sig2 = autoSignature(detected);
    if (!detected.length || sig2 === autoState.lastSig) { autoState.busy = false; return; }
    autoState.pendingSig = sig2;
    startAsk({ question: '', action: 'autofill' });
    if (!answering) { autoState.pendingSig = ''; autoState.busy = false; }
  }

  function autoAskSettled(success, countError) {
    if (!autoState.pendingSig) return;
    if (success) {
      try { fillAllDetected(); } catch (e) {}
      autoState.lastSig = autoState.pendingSig;
      autoState.errors = 0;
    } else if (countError !== false) {
      autoState.errors++;
      if (autoState.errors >= 3 && autoState.on) {
        setAutoAnswer(false, true);
        toast('Auto Answer dimatikan otomatis: gagal 3x berturut-turut.', 5000);
      }
    }
    autoState.pendingSig = '';
    autoState.busy = false;
  }

  function initAutoAnswer() {
    try {
      chrome.storage.local.get(['jawabAutoAnswer'], (r) => {
        if (r && r.jawabAutoAnswer) setAutoAnswer(true, true);
      });
    } catch (e) {}
  }

  /* ============ port client: requestId, stop, stale-guard ============ */

  function ensurePort() {
    if (port) return;
    port = chrome.runtime.connect({ name: 'jawab-stream' });
    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(() => {
      const wasAnswering = answering;
      const rid = currentRequestId;
      port = null;
      answering = false;
      currentRequestId = null;
      if (wasAnswering && !expectDisconnect && rid) {
        const a = panel && panel.querySelector('.jbody')._jawab;
        if (a) {
          a.stop.style.display = 'none';
          const err = el('div', 'jerr', 'Koneksi ke extension terputus. ' +
            (lastRaw ? 'Sebagian jawaban di atas mungkin tidak lengkap.' : 'Tidak ada jawaban yang diterima.'));
          a.ans.after(err);
          if (lastRaw) a.copy.style.display = '';
        }
      }
      expectDisconnect = false;
    });
  }

  let renderTimer = null;
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      const b = panel && panel.querySelector('.jbody');
      const cur = b && b._jawab;
      if (cur && cur.ans) renderMd(cur.ans, lastRaw);
    }, 100);
  }
  function flushRender(a) {
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    if (a && a.ans) renderMd(a.ans, lastRaw);
  }

  function onPortMessage(m) {
    if (!m || m.requestId !== currentRequestId) return; /* abaikan respons basi */
    const body = panel && panel.querySelector('.jbody');
    const a = body && body._jawab;
    if (!a) return;
    if (m.type === 'chunk') {
      lastRaw += m.text;
      scheduleRender();
    } else if (m.type === 'done') {
      lastMeta = m.meta || null;
      finishAnswer(a, false);
    } else if (m.type === 'incomplete') {
      lastRaw += '\n\n[Jawaban terputus sebelum selesai.]';
      finishAnswer(a, true);
    } else if (m.type === 'error') {
      answering = false;
      a.stop.style.display = 'none';
      autoAskSettled(false);
      const err = el('div', 'jerr', m.message || 'Terjadi kesalahan.');
      if (lastRaw) {
        /* simpan parsial sebagai parsial: jawaban tetap tampil + tombol salin */
        a.ans.after(err);
        a.copy.style.display = '';
      } else {
        a.ans.replaceChildren();
        a.ans.after(err);
      }
      expectDisconnect = true;
      try { port.disconnect(); } catch (e) {}
      port = null;
      currentRequestId = null;
    }
  }

  function finishAnswer(a, wasIncomplete) {
    answering = false;
    flushRender(a);
    a.stop.style.display = 'none';
    if (panelMode === 'detect' && lastRaw.trim()) {
      /* distribusi jawaban per soal + tampilkan tombol isi */
      try { distributeAnswers(); } catch (e) {}
    }
    autoAskSettled(!!lastRaw.trim());
    if (!lastRaw.trim()) {
      a.ans.replaceChildren();
      const err = el('div', 'jerr',
        'Tidak ada jawaban dari provider. Untuk gambar, pastikan provider mendukung vision (coba OpenAI/Anthropic/Muse).');
      a.ans.after(err);
    } else {
      a.copy.style.display = '';
    }
    expectDisconnect = true;
    try { port.disconnect(); } catch (e) {}
    port = null;
    currentRequestId = null;
  }

  function startAsk(opts) {
    if (answering || !draft) return;
    if (draft.kind === 'image' && !draft.imageId) {
      toast('Gambar tidak valid. Potret lagi.');
      return;
    }
    const body = panel && panel.querySelector('.jbody');
    const a = body && body._jawab;
    if (!a) return;
    answering = true;
    lastRaw = '';
    lastMeta = null;
    a.ans.replaceChildren();
    a.copy.style.display = 'none';
    const loading = el('div', 'jload', 'Memproses...');
    a.ans.after(loading);
    a.stop.style.display = '';
    const requestId = 'r-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
    currentRequestId = requestId;
    const sendIt = (attachImageId) => {
      ensurePort();
      const payload = {
        type: 'ask',
        requestId: requestId,
        question: opts.question || '',
        action: opts.action || 'explain',
        draft: draft.kind === 'text'
          ? { kind: 'text', text: draft.text, isCode: draft.isCode, language: draft.language }
          : { kind: 'image', imageId: draft.imageId }
      };
      if (attachImageId && payload.draft.kind === 'text') payload.draft.attachImageId = attachImageId;
      try {
        port.postMessage(payload);
      } catch (e) {
        loading.remove();
        answering = false;
        currentRequestId = null;
        a.stop.style.display = 'none';
        toast('Gagal menghubungi extension.');
        return;
      }
      /* hapus indikator loading saat konten jawaban pertama muncul */
      const obs = new MutationObserver(() => {
        if (a.ans.childNodes.length) { loading.remove(); obs.disconnect(); }
      });
      obs.observe(a.ans, { childList: true });
      setTimeout(() => { loading.remove(); obs.disconnect(); }, 120000);
    };
    if (opts.action === 'autofill') {
      attachCardImageIfNeeded().then((id) => sendIt(id)).catch(() => sendIt(null));
    } else {
      sendIt(null);
    }
  }

  /* Bila ada soal yang pilihannya berupa gambar, potret kartu soal itu
     untuk dilampirkan ke AI - teks label "Gambar A/B" saja tidak cukup
     untuk menjawab. UI Polter disembunyikan sesaat agar tidak ikut
     terpotret. Mengembalikan blobId atau null (tetap lanjut tanpa gambar). */
  async function attachCardImageIfNeeded() {
    const items = detected.filter((d) => d.imgOptions && d.cardEl && document.contains(d.cardEl));
    if (!items.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
    for (const d of items) {
      const r = d.cardEl.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top);
      x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
      any = true;
    }
    if (!any) return null;
    const rx = Math.max(0, x0 - 6), ry = Math.max(0, y0 - 6);
    const rect = {
      x: rx, y: ry,
      w: Math.min(window.innerWidth, x1 + 6) - rx,
      h: Math.min(window.innerHeight, y1 + 6) - ry
    };
    if (rect.w < 10 || rect.h < 10) return null;
    const prevDisplay = host ? host.style.display : '';
    if (host) host.style.display = 'none';
    try {
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const r = await bg({ type: 'capture-blob', rect: rect, metrics: { innerWidth: window.innerWidth, innerHeight: window.innerHeight } });
      return (r && r.blobId) ? r.blobId : null;
    } catch (e) {
      return null;
    } finally {
      if (host) host.style.display = prevDisplay;
    }
  }

  function stopAsk(reason) {
    if (!answering || !currentRequestId) return;
    autoAskSettled(false, false);
    try { if (port) port.postMessage({ type: 'stop', requestId: currentRequestId }); } catch (e) {}
    const body = panel && panel.querySelector('.jbody');
    const a = body && body._jawab;
    answering = false;
    if (a) {
      a.stop.style.display = 'none';
      const n = el('div', 'jnote', 'Dihentikan' + (reason ? ': ' + reason : '') + '.');
      a.ans.after(n);
      if (lastRaw.trim()) a.copy.style.display = '';
    }
    expectDisconnect = true;
    try { if (port) port.disconnect(); } catch (e) {}
    port = null;
    currentRequestId = null;
  }

  /* ============ keyboard global ============ */

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (captureSession) return; /* ditangani listener capture sendiri */
    if (panel) {
      if (answering) stopAsk('dibatalkan');
      closePanel();
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
      hideQBtn();
    } else {
      hideQBtn();
    }
  });

  /* pesan dari background (ikon toolbar / shortcut) */
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'jawab-enter-capture') {
      if (IS_TOP) enterCaptureMode();
    }
    if (msg.type === 'jawab-detect-questions') {
      startDetectDraft();
    }
    if (msg.type === 'jawab-detect-probe') {
      /* koordinasi lintas frame: pindai dokumen ini, lapor jumlahnya saja;
         background yang memutuskan frame mana yang menampilkan panel */
      try {
        const items = scanPageQuestions();
        bg({ type: 'frame-detect-report', count: items.length }).catch(() => {});
      } catch (e) {}
    }
    if (msg.type === 'jawab-detect-present') {
      startDetectDraft();
    }
    if (msg.type === 'jawab-toggle-menu') {
      if (IS_TOP) { if (panel) closePanel(); else openPanel('menu', null); }
    }
    if (msg.type === 'jawab-tab-visibility') {
      applyTabVisibility(msg.visible !== false);
    }
  });

  /* ============ init ============ */

  loadTabVisibility();
  if (IS_TOP) {
    initAutoAnswer();
  }
})();
