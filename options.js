/* Polter - options.js
   Alur Simpan/Tes: validasi -> (custom: peringatan HTTP + izin origin via user gesture)
   -> simpan / panggil API. Error permission tidak pernah ditelan.
*/
(function () {
  'use strict';

  const state = { provider: 'custom', ackedHttpHosts: [], museMode: 'api' };

  const $ = (id) => document.getElementById(id);
  const val = (id) => { const e = $(id); return e ? e.value : ''; };

  /* ---------- render ---------- */

  /* DOM dibangun dengan createElement/textContent (bukan innerHTML)
     agar lolos validator AMO tanpa warning "Unsafe assignment to innerHTML". */
  function addField(box, id, label, type, hint) {
    const lab = document.createElement('label');
    lab.htmlFor = id;
    lab.textContent = label;
    box.appendChild(lab);
    const inp = document.createElement('input');
    inp.type = type || 'text';
    inp.id = id;
    inp.value = '';
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    box.appendChild(inp);
    if (hint) {
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = hint;
      box.appendChild(h);
    }
    return inp;
  }

  function renderFields() {
    const box = $('fieldsBox');
    const H = JAWAB_MODEL_HINTS;
    box.replaceChildren();
    if (state.provider === 'custom') {
      addField(box, 'f-customUrl', 'Base URL endpoint', 'text',
        'cth: https://api.contoh.com/v1, tanpa /chat/completions di akhir. Key boleh kosong bila endpoint tidak butuh.');
      const warn = document.createElement('div');
      warn.className = 'httpwarn';
      warn.id = 'httpWarn';
      const b = document.createElement('b');
      b.textContent = 'HTTP tidak terenkripsi.';
      warn.appendChild(b);
      warn.appendChild(document.createTextNode(' Key dan isi request bisa disadap di jaringan. Hanya untuk endpoint lokal/pribadi.'));
      warn.appendChild(document.createElement('br'));
      const wl = document.createElement('label');
      wl.style.cssText = 'margin-top:6px;font-weight:400';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = 'httpAck';
      cb.style.width = 'auto';
      wl.appendChild(cb);
      wl.appendChild(document.createTextNode(' Saya paham risikonya, lanjutkan dengan HTTP.'));
      warn.appendChild(wl);
      box.appendChild(warn);
      addField(box, 'f-customKey', 'API key (opsional)', 'password', 'Dikosongkan bila endpoint tidak memakai key.');
      addField(box, 'f-customModel', 'Model ID', 'text', H.custom + '. ID model custom tidak disamakan dengan katalog provider resmi.');
    } else if (state.provider === 'openai') {
      addField(box, 'f-openaiKey', 'API key OpenAI', 'password', 'Dari platform.openai.com.');
      addField(box, 'f-openaiModel', 'Model', 'text', H.openai + '.');
    } else if (state.provider === 'anthropic') {
      addField(box, 'f-anthropicKey', 'API key Anthropic', 'password', 'Dari console.anthropic.com.');
      addField(box, 'f-anthropicModel', 'Model', 'text', H.anthropic + '.');
    } else if (state.provider === 'agentrouter') {
      addField(box, 'f-agentrouterUrl', 'Base URL', 'text',
        'https://agentrouter.org — TANPA /v1 di akhir: mode yang dipakai adalah Anthropic Messages, sama seperti Claude Code.');
      addField(box, 'f-agentrouterKey', 'API key AgentRouter', 'password', 'Dari agentrouter.org/console/token (format sk-...).');
      addField(box, 'f-agentrouterModel', 'Model', 'text', H.agentrouter + '.');
      const note = document.createElement('div');
      note.className = 'hint';
      note.textContent = 'AgentRouter menolak klien yang tidak tampak seperti Claude Code. Polter mengirim header sidik jari Claude Code dan menulis ulang User-Agent lewat declarativeNetRequest (perlu izin akses situs untuk agentrouter.org — diminta saat Simpan/Tes).';
      box.appendChild(note);
    } else if (state.provider === 'muse') {
      const modeLab = document.createElement('label');
      modeLab.htmlFor = 'f-museMode';
      modeLab.textContent = 'Cara akses';
      box.appendChild(modeLab);
      const modeSel = document.createElement('select');
      modeSel.id = 'f-museMode';
      const optApi = document.createElement('option');
      optApi.value = 'api';
      optApi.textContent = 'Meta Model API (API key resmi dari dev.meta.ai)';
      const optBridge = document.createElement('option');
      optBridge.value = 'bridge';
      optBridge.textContent = 'Muse Bridge (endpoint OpenAI-compatible milik sendiri)';
      modeSel.appendChild(optApi);
      modeSel.appendChild(optBridge);
      modeSel.value = state.museMode;
      modeSel.addEventListener('change', () => {
        const cur = currentFormCfg();
        state.museMode = modeSel.value;
        fillForm(cur);
      });
      box.appendChild(modeSel);
      if (state.museMode === 'bridge') {
        addField(box, 'f-museBridgeUrl', 'Base URL bridge', 'text',
          'cth: https://bridge.floodcare.my.id/v1, tanpa /chat/completions di akhir.');
        addField(box, 'f-museBridgeKey', 'Token bridge (bila ada)', 'password',
          'Token endpoint milikmu sendiri, sama seperti yang dipakai di 9Router-mu.');
        addField(box, 'f-museBridgeModel', 'Model ID', 'text', H.muse + '.');
        const note = document.createElement('div');
        note.className = 'hint';
        note.textContent = 'Rute bridge saat ini teks saja: Tes vision kemungkinan gagal "respons kosong", dan itu wajar. Tes koneksi (teks) yang menentukan rute ini hidup.';
        box.appendChild(note);
      } else {
        addField(box, 'f-museApiKey', 'API key Meta Model API', 'password',
          'Dari dev.meta.ai, formatnya LLM|<id>|<secret>. Preview API saat ini terbatas region (AS); pendaftaran dari Indonesia bisa ditolak Meta.');
        addField(box, 'f-museModel', 'Model', 'text', H.muse + '.');
      }
    }
    const urlInput = $('f-customUrl');
    if (urlInput) urlInput.addEventListener('input', updateHttpWarn);
  }

  function updateHttpWarn() {
    const warn = $('httpWarn');
    if (!warn) return;
    const v = val('f-customUrl').trim();
    let isHttp = false;
    try { isHttp = new URL(v).protocol === 'http:'; } catch (e) {}
    warn.classList.toggle('show', isHttp);
  }

  function renderProviderCards() {
    document.querySelectorAll('.prov').forEach((card) => {
      const sel = card.dataset.p === state.provider;
      card.classList.toggle('sel', sel);
      card.setAttribute('aria-pressed', sel ? 'true' : 'false');
    });
  }

  function selectProvider(p) {
    state.provider = p;
    renderProviderCards();
    fillForm();
  }

  /* ---------- load / fill ---------- */

  async function load() {
    const keys = Object.keys(JAWAB_DEFAULTS).concat(['jawabAckedHttp']);
    const v = await chrome.storage.local.get(keys);
    state.provider = v.provider || JAWAB_DEFAULTS.provider;
    state.museMode = v.museMode === 'bridge' ? 'bridge' : 'api';
    state.ackedHttpHosts = Array.isArray(v.jawabAckedHttp) ? v.jawabAckedHttp : [];
    renderProviderCards();
    fillForm(v);
    $('systemPrompt').value = (typeof v.systemPrompt === 'string') ? v.systemPrompt : JAWAB_DEFAULTS.systemPrompt;
    try {
      const tv = await chrome.storage.local.get(['jawabTabVisible']);
      if (tv.jawabTabVisible === false) { const hr = $('tabHide'); if (hr) hr.checked = true; }
      else { const sr = $('tabShow'); if (sr) sr.checked = true; }
    } catch (e) {}
    $('footer').textContent = 'Polter v' + chrome.runtime.getManifest().version +
      ' — seleksi teks/kode atau potret area, simpan ke Library, proses dengan AI saat diminta.';
    const logo = $('logo');
    logo.addEventListener('error', () => { logo.style.display = 'none'; });
  }

  function fillForm(v) {
    v = v || {};
    renderFields();
    const set = (id, value, def) => {
      const e = $(id);
      if (e) e.value = (typeof value === 'string') ? value : (def || '');
    };
    set('f-customUrl', v.customUrl, JAWAB_DEFAULTS.customUrl);
    set('f-customKey', v.customKey, '');
    set('f-customModel', v.customModel, JAWAB_DEFAULTS.customModel);
    set('f-openaiKey', v.openaiKey, '');
    set('f-openaiModel', v.openaiModel, JAWAB_DEFAULTS.openaiModel);
    set('f-anthropicKey', v.anthropicKey, '');
    set('f-anthropicModel', v.anthropicModel, JAWAB_DEFAULTS.anthropicModel);
    set('f-museApiKey', v.museApiKey, '');
    set('f-museModel', v.museModel, JAWAB_DEFAULTS.museModel);
    set('f-museBridgeUrl', v.museBridgeUrl, JAWAB_DEFAULTS.museBridgeUrl);
    set('f-museBridgeKey', v.museBridgeKey, '');
    set('f-museBridgeModel', v.museBridgeModel, JAWAB_DEFAULTS.museBridgeModel);
    set('f-agentrouterUrl', v.agentrouterUrl, JAWAB_DEFAULTS.agentrouterUrl);
    set('f-agentrouterKey', v.agentrouterKey, '');
    set('f-agentrouterModel', v.agentrouterModel, JAWAB_DEFAULTS.agentrouterModel);
    const museModeEl = $('f-museMode');
    if (museModeEl) museModeEl.value = state.museMode;
    updateHttpWarn();
  }

  function currentFormCfg() {
    return {
      provider: state.provider,
      openaiKey: val('f-openaiKey'), openaiModel: val('f-openaiModel').trim(),
      anthropicKey: val('f-anthropicKey'), anthropicModel: val('f-anthropicModel').trim(),
      museMode: state.museMode,
      museApiKey: val('f-museApiKey'), museModel: val('f-museModel').trim(),
      museBridgeUrl: val('f-museBridgeUrl').trim(), museBridgeKey: val('f-museBridgeKey'),
      museBridgeModel: val('f-museBridgeModel').trim(),
      customUrl: val('f-customUrl').trim(), customKey: val('f-customKey'), customModel: val('f-customModel').trim(),
      agentrouterUrl: val('f-agentrouterUrl').trim(), agentrouterKey: val('f-agentrouterKey'), agentrouterModel: val('f-agentrouterModel').trim(),
      systemPrompt: val('systemPrompt')
    };
  }

  /* ---------- validasi ---------- */

  function validate(cfg) {
    const errors = [];
    if (cfg.provider === 'custom') {
      if (!cfg.customUrl) errors.push('Base URL endpoint custom wajib diisi.');
      else {
        let u;
        try { u = new URL(cfg.customUrl); }
        catch (e) { errors.push('Base URL tidak valid.'); }
        if (u && u.protocol !== 'http:' && u.protocol !== 'https:') {
          errors.push('Base URL harus http:// atau https://.');
        }
      }
      if (!cfg.customModel) errors.push('Model ID custom wajib diisi.');
    } else if (cfg.provider === 'openai') {
      if (!cfg.openaiKey) errors.push('API key OpenAI wajib diisi.');
      if (!cfg.openaiModel) errors.push('Model OpenAI wajib diisi.');
    } else if (cfg.provider === 'anthropic') {
      if (!cfg.anthropicKey) errors.push('API key Anthropic wajib diisi.');
      if (!cfg.anthropicModel) errors.push('Model Anthropic wajib diisi.');
    } else if (cfg.provider === 'agentrouter') {
      if (!cfg.agentrouterUrl) errors.push('Base URL AgentRouter wajib diisi.');
      else {
        let u;
        try { u = new URL(cfg.agentrouterUrl); } catch (e) { errors.push('Base URL AgentRouter tidak valid.'); }
        if (u && u.protocol !== 'http:' && u.protocol !== 'https:') errors.push('Base URL AgentRouter harus http:// atau https://.');
      }
      if (!cfg.agentrouterKey) errors.push('API key AgentRouter wajib diisi.');
      if (!cfg.agentrouterModel) errors.push('Model AgentRouter wajib diisi.');
    } else if (cfg.provider === 'muse') {
      if (cfg.museMode === 'bridge') {
        if (!cfg.museBridgeUrl) errors.push('URL Muse Bridge wajib diisi.');
        else {
          let u;
          try { u = new URL(cfg.museBridgeUrl); } catch (e) { errors.push('URL Muse Bridge tidak valid.'); }
          if (u && u.protocol !== 'http:' && u.protocol !== 'https:') errors.push('URL Muse Bridge harus http:// atau https://.');
        }
        if (!cfg.museBridgeModel) errors.push('Model Muse Bridge wajib diisi.');
      } else {
        if (!cfg.museApiKey) errors.push('API key Meta Model API wajib diisi.');
        if (!cfg.museModel) errors.push('Model Muse wajib diisi.');
      }
    }
    return errors;
  }

  /* URL yang butuh izin origin (custom, atau Muse mode bridge) */
  function permUrlFor(cfg) {
    if (cfg.provider === 'custom') return cfg.customUrl;
    if (cfg.provider === 'agentrouter') return cfg.agentrouterUrl;
    if (cfg.provider === 'muse' && cfg.museMode === 'bridge') return cfg.museBridgeUrl;
    return null;
  }

  function checkHttpAck(cfg) {
    const permUrl = permUrlFor(cfg);
    if (!permUrl) return null;
    let u;
    try { u = new URL(permUrl); } catch (e) { return null; }
    if (u.protocol !== 'http:') return null;
    if (state.ackedHttpHosts.indexOf(u.host) !== -1) return null;
    const box = $('httpAck');
    if (!box || !box.checked) {
      return 'Endpoint memakai HTTP tanpa enkripsi. Centang persetujuan pada peringatan di atas untuk lanjut.';
    }
    return null;
  }

  /* Izin origin custom: dipanggil LANGSUNG dari user gesture, sebelum await lain. */
  async function ensureCustomPermission(url) {
    const u = new URL(url);
    const pattern = u.origin + '/*';
    let has = false;
    try { has = await chrome.permissions.contains({ origins: [pattern] }); }
    catch (e) { throw new Error('Gagal memeriksa izin origin: ' + e.message); }
    if (has) return;
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [pattern] });
    } catch (e) {
      throw new Error('Gagal meminta izin akses ke ' + u.origin + ': ' + e.message);
    }
    if (!granted) {
      throw new Error('Izin akses ke ' + u.origin + ' DITOLAK. Extension tidak bisa menjangkau endpoint tanpanya.');
    }
  }

  function setStatus(msg, ok) {
    const s = $('status');
    s.textContent = msg;
    s.className = 'status ' + (ok ? 'ok' : 'err');
  }

  function showResult(ok, titleText, bodyText) {
    const r = $('testResult');
    r.className = ok ? 'ok' : 'err';
    r.replaceChildren();
    if (titleText) {
      const b = document.createElement('b');
      b.textContent = titleText;
      r.appendChild(b);
      r.appendChild(document.createElement('br'));
    }
    r.appendChild(document.createTextNode(bodyText || ''));
    r.style.display = 'block';
  }

  /* ---------- aksi ---------- */

  async function onSave() {
    setStatus('', true);
    const cfg = currentFormCfg();
    const errors = validate(cfg);
    if (errors.length) { setStatus(errors[0], false); return; }
    try {
      const permUrl = permUrlFor(cfg);
      if (permUrl) {
        const ackErr = checkHttpAck(cfg);
        if (ackErr) { setStatus(ackErr, false); return; }
        await ensureCustomPermission(permUrl);
      }
      const toSave = {
        provider: cfg.provider,
        openaiKey: cfg.openaiKey, openaiModel: cfg.openaiModel,
        anthropicKey: cfg.anthropicKey, anthropicModel: cfg.anthropicModel,
        museMode: cfg.museMode, museApiKey: cfg.museApiKey, museModel: cfg.museModel,
        museBridgeUrl: cfg.museBridgeUrl, museBridgeKey: cfg.museBridgeKey, museBridgeModel: cfg.museBridgeModel,
        customUrl: cfg.customUrl, customKey: cfg.customKey, customModel: cfg.customModel,
        systemPrompt: cfg.systemPrompt
      };
      if (permUrl) {
        try {
          const u = new URL(permUrl);
          if (u.protocol === 'http:' && state.ackedHttpHosts.indexOf(u.host) === -1) {
            state.ackedHttpHosts.push(u.host);
            toSave.jawabAckedHttp = state.ackedHttpHosts;
          }
        } catch (e) {}
      }
      await chrome.storage.local.set(toSave);
      setStatus('Tersimpan.', true);
    } catch (e) {
      setStatus(e.message || String(e), false);
    }
  }

  function makeTestImage() {
    const c = document.createElement('canvas');
    c.width = 360; c.height = 120;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 360, 120);
    g.fillStyle = '#111111';
    g.font = 'bold 34px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('TES VISION 123', 180, 60);
    return c.toDataURL('image/png');
  }

  async function onTest(isVision) {
    setStatus('', true);
    $('testResult').style.display = 'none';
    const cfg = currentFormCfg();
    const errors = validate(cfg);
    if (errors.length) { setStatus(errors[0], false); return; }
    const btn = $(isVision ? 'testVision' : 'test');
    try {
      const permUrl = permUrlFor(cfg);
      if (permUrl) {
        const ackErr = checkHttpAck(cfg);
        if (ackErr) { setStatus(ackErr, false); return; }
        await ensureCustomPermission(permUrl);
      }
      btn.disabled = true;
      const target = cfg.provider + ' / ' +
        (cfg.provider === 'openai' ? cfg.openaiModel :
          cfg.provider === 'anthropic' ? cfg.anthropicModel :
              cfg.provider === 'muse' ? (cfg.museMode === 'bridge' ? cfg.museBridgeModel : cfg.museModel) :
                cfg.provider === 'agentrouter' ? cfg.agentrouterModel :
                (cfg.customModel || '(model kosong)'));
      setStatus('Menghubungi ' + target + ' ... (memakai API sungguhan)', true);
      const msg = { type: isVision ? 'test-vision' : 'test', cfg: cfg };
      if (isVision) msg.imageDataUrl = makeTestImage();
      const res = await chrome.runtime.sendMessage(msg);
      if (res && res.ok) {
        setStatus('Berhasil.', true);
        showResult(true, res.target || target, 'Respons: ' + (res.text || '(kosong)'));
      } else {
        setStatus('Gagal.', false);
        showResult(false, target, (res && res.error) || 'tidak diketahui');
      }
    } catch (e) {
      setStatus('Gagal.', false);
      showResult(false, '', e.message || String(e));
    } finally {
      btn.disabled = false;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------- izin akses situs (tombol mengambang di semua halaman) ---------- */

  const SITE_ORIGINS = ['http://*/*', 'https://*/*'];

  async function refreshSiteAccessStatus() {
    const box = $('siteAccessStatus');
    if (!box) return;
    try {
      const has = await chrome.permissions.contains({ origins: SITE_ORIGINS });
      box.textContent = has
        ? 'Status: izin semua situs AKTIF. Tab Polter akan muncul otomatis di halaman http/https.'
        : 'Status: belum aktif. Tombol mengambang hanya muncul setelah shortcut/klik ikon dipakai di tab itu.';
    } catch (e) {
      box.textContent = 'Status: tidak bisa diperiksa di browser ini.';
    }
  }

  async function onGrantSiteAccess() {
    try {
      const granted = await chrome.permissions.request({ origins: SITE_ORIGINS });
      setStatus(granted
        ? 'Izin semua situs diberikan. Muat ulang tab platformmu, tab Polter akan muncul.'
        : 'Izin ditolak. Kamu masih bisa memakai shortcut dan klik ikon ekstensi.', !!granted);
    } catch (e) {
      setStatus('Gagal meminta izin: ' + (e.message || String(e)), false);
    }
    refreshSiteAccessStatus();
  }

  /* ---------- init ---------- */

  document.querySelectorAll('.prov').forEach((card) => {
    card.addEventListener('click', () => selectProvider(card.dataset.p));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectProvider(card.dataset.p); }
    });
  });
  $('save').addEventListener('click', onSave);
  document.querySelectorAll('input[name="tabmode"]').forEach((r) => {
    r.addEventListener('change', async () => {
      const visible = $('tabShow') ? $('tabShow').checked : true;
      const st = $('tabModeStatus');
      try {
        await chrome.storage.local.set({ jawabTabVisible: visible });
        if (st) st.textContent = visible
          ? 'Tab hantu ditampilkan di tepi layar.'
          : 'Tab hantu disembunyikan — panggil menu dengan Alt+Shift+M.';
      } catch (e) {
        if (st) st.textContent = 'Gagal menyimpan pilihan tab: ' + (e.message || String(e));
      }
    });
  });
  const grantBtn = $('grantSiteAccess');
  if (grantBtn) grantBtn.addEventListener('click', onGrantSiteAccess);
  refreshSiteAccessStatus();
  $('test').addEventListener('click', () => onTest(false));
  $('testVision').addEventListener('click', () => onTest(true));

  load().catch((e) => setStatus('Gagal memuat pengaturan: ' + e.message, false));
})();
