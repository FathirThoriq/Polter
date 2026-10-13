/* Polter - background service worker
   Arsitektur:
   - Port "jawab-stream": request AI (streaming) dengan requestId + AbortController.
     {type:'ask', requestId, draft, question, action}
     {type:'ask-snippet', requestId, snippetId, action, question}
     {type:'stop', requestId}
   - Pesan sekali jalan (runtime.sendMessage): capture-region, ui-pref-*,
     save-text-snippet, finalize-image-snippet, delete-draft, download-image,
     test, test-vision, save-ai-result, get-version.
   - Storage: chrome.storage.local (settings kecil, TRUSTED_CONTEXTS),
     IndexedDB origin extension (snippet + blob) via storage.js.
*/

/* Chrome (service worker): muat via importScripts.
   Firefox (event page, background.scripts): defaults.js & storage.js sudah
   dimuat manifest sebelum file ini, jadi importScripts dilewati. */
if (typeof importScripts === 'function') {
  try { importScripts('defaults.js', 'storage.js'); } catch (e) { /* sudah dimuat manifest */ }
}

/* ============ util ============ */

function isValidRequestId(s) {
  return typeof s === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(s);
}

function isValidRect(r) {
  return !!r && ['x', 'y', 'w', 'h'].every((k) => typeof r[k] === 'number' && isFinite(r[k]));
}

function timeoutReject(ms, message) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

function checkSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) throw new Error('pengirim tidak dikenal');
}

function extUrlPrefix() {
  return chrome.runtime.getURL('');
}

/* ============ config ============ */

async function getConfig() {
  const stored = await chrome.storage.local.get(Object.keys(JAWAB_DEFAULTS));
  return Object.assign({}, JAWAB_DEFAULTS, stored);
}

function providerTarget(cfg) {
  switch (cfg.provider) {
    case 'anthropic': return { provider: 'anthropic', model: cfg.anthropicModel, needsKey: true };
    case 'openai': return { provider: 'openai', model: cfg.openaiModel, needsKey: true };
    case 'muse': return { provider: 'muse', model: cfg.museMode === 'bridge' ? cfg.museBridgeModel : cfg.museModel, needsKey: true };
    case 'agentrouter': return { provider: 'agentrouter', model: cfg.agentrouterModel, needsKey: true, url: cfg.agentrouterUrl };
    case 'custom':
    default: return { provider: 'custom', model: cfg.customModel, needsKey: false, url: cfg.customUrl };
  }
}

function normalizeBaseUrl(url) {
  let u = (url || '').trim().replace(/\/+$/, '');
  u = u.replace(/\/chat\/completions$/, '');
  return u;
}

function authHeaders(apiKey) {
  const h = { 'Content-Type': 'application/json' };
  if (apiKey) h['Authorization'] = 'Bearer ' + apiKey; /* jangan kirim Authorization kosong */
  return h;
}

/* ============ fetch dengan timeout connect/idle/total ============ */

function mapAbortError(e, ctrl) {
  if (e && e.name === 'AbortError') {
    const reason = ctrl && ctrl.signal && ctrl.signal.reason;
    const code = (reason && reason.message) || '';
    if (code === 'TIMEOUT_CONNECT') return new Error('Timeout koneksi (30 detik). Periksa koneksi atau URL endpoint.');
    if (code === 'TIMEOUT_IDLE') return new Error('Timeout stream: tidak ada data selama 90 detik.');
    if (code === 'TIMEOUT_TOTAL') return new Error('Timeout total request (3 menit).');
    return new Error('Request dibatalkan.');
  }
  if (e instanceof TypeError) return new Error('Tidak bisa terhubung. Periksa koneksi internet atau URL endpoint.');
  return e;
}

async function httpError(res, parsedJson) {
  let body = '';
  try { body = (await res.text()).slice(0, 400); } catch (e) {}
  let detail = body;
  try {
    const j = parsedJson || JSON.parse(body);
    detail = (j.error && (j.error.message || JSON.stringify(j.error))) || JSON.stringify(j).slice(0, 300) || body;
  } catch (e) {}
  let msg = 'HTTP ' + res.status + (detail ? ': ' + String(detail).slice(0, 200) : '');
  if (res.status === 401 || res.status === 403) msg += ' (API key salah atau ditolak)';
  else if (res.status === 429) msg += ' (rate limit, coba lagi nanti)';
  else if (res.status === 404) msg += ' (endpoint/model tidak ditemukan)';
  else if (res.status >= 500) msg += ' (server provider bermasalah)';
  return new Error(msg);
}

/* Mengembalikan { res, ctrl, done } - pemanggil wajib memanggil done() di akhir. */
async function fetchHead(url, opts, timeouts, externalSignal) {
  const t = timeouts || {};
  const ctrl = new AbortController();
  const timers = [];
  const abortWith = (code) => { try { ctrl.abort(new Error(code)); } catch (e) { try { ctrl.abort(); } catch (x) {} } };
  timers.push(setTimeout(() => abortWith('TIMEOUT_CONNECT'), t.connectMs || 30000));
  timers.push(setTimeout(() => abortWith('TIMEOUT_TOTAL'), t.totalMs || 180000));
  const done = () => timers.forEach(clearTimeout);
  if (externalSignal) {
    if (externalSignal.aborted) abortWith('STOP');
    else externalSignal.addEventListener('abort', () => abortWith('STOP'), { once: true });
  }
  try {
    const res = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
    clearTimeout(timers[0]); /* headers diterima: timeout koneksi selesai */
    return { res: res, ctrl: ctrl, done: done };
  } catch (e) {
    done();
    throw mapAbortError(e, ctrl);
  }
}

/* ============ parser SSE yang robust ============ */

/* Ambil teks jawaban dari JSON completion utuh - toleran bentuk:
   OpenAI standar, teks legacy, dan balok konten ala Anthropic. */
function joinContentParts(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => {
      if (!b || typeof b !== 'object') return '';
      if (typeof b.text === 'string') return b.text;
      if (typeof b.content === 'string') return b.content;
      return '';
    }).join('');
  }
  return '';
}

function extractCompletionText(j) {
  if (!j || typeof j !== 'object') return '';
  const ch = j.choices && j.choices[0];
  if (ch) {
    if (ch.message) {
      const mc = joinContentParts(ch.message.content);
      if (mc) return mc;
    }
    if (typeof ch.text === 'string' && ch.text) return ch.text;
    if (ch.delta) {
      const dc = joinContentParts(ch.delta.content);
      if (dc) return dc;
    }
  }
  if (Array.isArray(j.content)) {
    const s = j.content.filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join('');
    if (s) return s;
  }
  if (typeof j.output_text === 'string' && j.output_text) return j.output_text;
  return '';
}

function sseDispatchOpenAI(eventName, data) {
  const t = data.trim();
  if (t === '[DONE]') return { done: true };
  let j;
  try { j = JSON.parse(data); } catch (e) { return { parseError: true }; }
  if (j.error) return { error: (j.error.message || 'provider error') };
  const ch = j.choices && j.choices[0];
  if (ch) {
    /* chunk penutup dengan finish_reason = terminator sah walau tanpa [DONE]
       (beberapa gateway lokal, mis. 9Router, tidak mengirim [DONE]) */
    if (ch.finish_reason) return { done: true };
    const d = ch.delta || {};
    if (typeof d.content === 'string' && d.content) return { token: d.content };
    if (Array.isArray(d.content)) {
      const s = d.content.filter((b) => b && typeof b.text === 'string').map((b) => b.text).join('');
      if (s) return { token: s };
    }
    /* sebagian gateway menaruh jawaban utuh di message pada chunk terakhir */
    if (ch.message && typeof ch.message.content === 'string' && ch.message.content) return { token: ch.message.content };
    if (typeof ch.text === 'string' && ch.text) return { token: ch.text };
  }
  /* passthrough bergaya Anthropic (gateway penerjemah Claude kadang begini) */
  if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta' && j.delta.text) return { token: j.delta.text };
  if (j.type === 'message_stop') return { done: true };
  return null;
}

function sseDispatchAnthropic(eventName, data) {
  if (eventName === 'ping') return null;
  if (eventName === 'error') {
    let j;
    try { j = JSON.parse(data); } catch (e) { return { parseError: true }; }
    return { error: (j.error && j.error.message) || 'anthropic error' };
  }
  if (eventName === 'message_stop') return { done: true };
  if (eventName !== 'content_block_delta') return null;
  let j;
  try { j = JSON.parse(data); } catch (e) { return { parseError: true }; }
  const d = j.delta;
  if (d && d.type === 'text_delta' && d.text) return { token: d.text };
  return null;
}

/* Membaca SSE stream. Melempar INCOMPLETE bila stream berakhir tanpa terminator. */
async function readSSE(head, dispatch, onToken, timeouts, extractJson) {
  const reader = head.res.body.getReader();
  const decoder = new TextDecoder();
  const ctrl = head.ctrl;
  let idleTimer = null;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { try { ctrl.abort(new Error('TIMEOUT_IDLE')); } catch (e) {} }, (timeouts && timeouts.idleMs) || 90000);
  };
  const disarmIdle = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = null; };
  let buf = '';
  let eventName = '';
  let dataLines = [];
  let gotTerminator = false;
  let sawParseError = false;
  let sawToken = false;
  let rawAll = '';

  const dispatchEvent = () => {
    const data = dataLines.join('\n');
    const ev = eventName;
    eventName = ''; dataLines = [];
    if (!data && !ev) return;
    const r = dispatch(ev, data);
    if (!r) return;
    if (r.done) gotTerminator = true;
    else if (r.error) throw new Error(r.error);
    else if (r.token) { sawToken = true; onToken(r.token); }
    else if (r.parseError) sawParseError = true;
  };

  const feedLine = (line) => {
    if (line === '') { dispatchEvent(); return; }
    if (line.charAt(0) === ':') return; /* komentar/heartbeat */
    if (line.indexOf('event:') === 0) { eventName = line.slice(6).trim(); return; }
    if (line.indexOf('data:') === 0) {
      const v = line.slice(5);
      dataLines.push(v.charAt(0) === ' ' ? v.slice(1) : v);
      return;
    }
    /* id:, retry: diabaikan */
  };

  armIdle();
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      armIdle();
      const piece = decoder.decode(r.value, { stream: true });
      if (rawAll.length < 2000000) rawAll += piece;
      buf += piece;
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        let line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        feedLine(line);
      }
    }
    buf += decoder.decode();
    /* Proses tail tanpa newline di akhir (jangan hilangkan baris terakhir). */
    if (buf) {
      const tail = buf.split('\n');
      for (let line of tail) {
        if (line.endsWith('\r')) line = line.slice(0, -1);
        feedLine(line);
      }
      dispatchEvent();
    }
  } catch (e) {
    disarmIdle();
    head.done();
    throw mapAbortError(e, ctrl);
  }
  disarmIdle();
  head.done();
  if (!gotTerminator && !sawToken && extractJson) {
    /* Bodi ternyata JSON utuh yang dikirim dengan header streaming:
       selamatkan isinya sebagai satu token daripada gagal total. */
    try {
      const txt = extractJson(rawAll);
      if (txt) { onToken(txt); gotTerminator = true; }
    } catch (e) {}
  }
  if (!gotTerminator) {
    const err = new Error('Stream terputus sebelum selesai.' + (sawParseError ? ' Ada bagian yang tidak bisa diparse.' : ''));
    err.incomplete = true;
    throw err;
  }
}

/* ============ adapter provider ============ */

async function streamOpenAICompatible({ url, apiKey, model, messages, onToken, signal }) {
  const endpoint = normalizeBaseUrl(url) + '/chat/completions';
  const head = await fetchHead(endpoint, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ model: model, stream: true, messages: messages })
  }, null, signal);
  if (!head.res.ok || !head.res.body) {
    const e = await httpError(head.res);
    head.done();
    throw e;
  }
  const ctype = (head.res.headers && head.res.headers.get && head.res.headers.get('content-type')) || '';
  if (ctype.indexOf('json') !== -1) {
    /* Endpoint non-streaming (mis. bridge/9Router): balasannya JSON utuh,
       bukan SSE. Baca sekali, keluarkan isinya sebagai satu token -
       jangan paksa parser SSE yang pasti gagal & terasa "lambat/error". */
    let json = null;
    try { json = await head.res.json(); } catch (e) {}
    head.done();
    if (!json) throw new Error('Respons provider tidak bisa dibaca (bukan SSE/JSON).');
    if (json.error) throw new Error((json.error && json.error.message) || 'provider error');
    const text = extractCompletionText(json);
    if (!String(text).trim()) throw new Error('Respons kosong. Model mungkin tidak menghasilkan konten (atau rute ini teks/gambar saja).');
    onToken(String(text));
    return;
  }
  await readSSE(head, sseDispatchOpenAI, onToken, null, (raw) => {
    try { return extractCompletionText(JSON.parse(raw)); } catch (e) { return ''; }
  });
}

async function streamAnthropic({ apiKey, model, system, messages, onToken, signal }) {
  const head = await fetchHead('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({ model: model, max_tokens: 4096, system: system, stream: true, messages: messages })
  }, null, signal);
  if (!head.res.ok || !head.res.body) {
    const e = await httpError(head.res);
    head.done();
    throw agentrouterFriendlyError(e);
  }
  try {
    await readSSE(head, sseDispatchAnthropic, onToken, null, (raw) => {
      try { return extractCompletionText(JSON.parse(raw)); } catch (e) { return ''; }
    });
  } catch (e) {
    throw agentrouterFriendlyError(e);
  }
}

/* ============ AgentRouter ============
   Gateway ini menolak request yang tidak tampak seperti Claude Code /
   OpenCode. Semua header sidik jari klien bisa dipasang lewat fetch,
   KECUALI User-Agent (header terlarang di fetch browser) - yang itu
   ditulis ulang lewat declarativeNetRequest untuk host agentrouter. */
const AR_UA = 'claude-cli/2.1.114 (external, cli)';
function agentrouterHeaders(key) {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + key,
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,effort-2025-11-24',
    'anthropic-dangerous-direct-browser-access': 'true',
    'x-app': 'cli',
    'x-stainless-lang': 'js',
    'x-stainless-os': 'Linux',
    'x-stainless-arch': 'x64',
    'x-stainless-runtime': 'node',
    'x-stainless-runtime-version': 'v24.3.0',
    'x-stainless-package-version': '0.81.0'
  };
}
let arUaRuleDone = false;
async function ensureAgentRouterUA() {
  if (arUaRuleDone) return;
  arUaRuleDone = true;
  try {
    if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateSessionRules) return;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [9001],
      addRules: [{
        id: 9001, priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'User-Agent', operation: 'set', value: AR_UA }] },
        condition: { urlFilter: '||agentrouter.org', resourceTypes: ['xmlhttprequest', 'other'] }
      }]
    });
  } catch (e) {}
}
function agentrouterMessagesUrl(base) {
  const b = normalizeBaseUrl(base || 'https://agentrouter.org');
  return (b.slice(-3) === '/v1') ? b + '/messages' : b + '/v1/messages';
}
/* Ubah error khas AgentRouter jadi penjelasan yang bisa ditindaklanjuti.
   'content-blocked' BUKAN soal key/header: sidik jari klien sudah lolos
   (kalau tidak, errornya 'unauthorized client detected'). Itu filter konten
   di sisi AgentRouter atas isi messages - bersifat per-teks dan kadang
   makin agresif setelah request beruntun; tunggu sebentar / parafrase /
   pastikan model termasuk paket key bisa membantu. */
function agentrouterFriendlyError(e) {
  const m = String((e && e.message) || e || '');
  if (/content-blocked/i.test(m)) {
    return new Error('AgentRouter menolak isi request (content-blocked) - ini filter konten di sisi AgentRouter, bukan masalah key atau header (sidik jari klien lolos). Coba: tunggu ±1 menit lalu tes lagi, parafrase prompt, dan pastikan model ini termasuk dalam paket key-mu (mis. coba claude-sonnet-4-6).');
  }
  if (/unauthorized client/i.test(m)) {
    return new Error('AgentRouter menolak klien ini (unauthorized client detected) - sidik jari Claude Code tidak lolos di browser ini. Detail: ' + m.slice(0, 140));
  }
  return e;
}

async function streamAgentRouter({ url, apiKey, model, system, messages, onToken, signal }) {
  await ensureAgentRouterUA();
  const head = await fetchHead(agentrouterMessagesUrl(url), {
    method: 'POST',
    headers: agentrouterHeaders(apiKey),
    body: JSON.stringify({ model: model, max_tokens: 4096, system: system, stream: true, messages: messages })
  }, null, signal);
  if (!head.res.ok || !head.res.body) {
    const e = await httpError(head.res);
    head.done();
    throw e;
  }
  await readSSE(head, sseDispatchAnthropic, onToken, null, (raw) => {
    try { return extractCompletionText(JSON.parse(raw)); } catch (e) { return ''; }
  });
}

/* ============ prompt builder (aksi eksplisit, bukan selalu format soal) ============ */

const AI_ACTION_LABEL = {
  explain: 'Jelaskan',
  summarize: 'Ringkas',
  translate: 'Terjemahkan',
  extract: 'Ekstrak Teks',
  answer: 'Jawab Soal',
  autofill: 'Isi Formulir',
  custom: 'Pertanyaan'
};

function buildTextPrompt(text, action, question, isCode, language) {
  /* text disimpan/dikirim apa adanya; trim hanya untuk validasi di pemanggil */
  const kind = isCode ? ('kode' + (language ? ' (' + language + ')' : '')) : 'teks';
  let instruction;
  switch (action) {
    case 'autofill':
      instruction = 'Jawab semua soal JSON ini. Balas HANYA JSON array: [{\"index\":0,\"answer\":\"...\"}] - tanpa teks lain, tanpa markdown.\n' +
        'radio/select: answer = satu teks options, persis. checkbox: gabung \"; \". isian lain: nilai singkat faktual.\n' +
        'Bila options berlabel \"Gambar A\", \"Gambar B\", dst dan ada gambar terlampir: lihat gambarnya, answer = huruf opsinya (\"A\").';
      break;
    case 'summarize': instruction = 'Ringkas ' + kind + ' berikut dalam Bahasa Indonesia dengan ringkas dan jelas.'; break;
    case 'translate': instruction = 'Terjemahkan ' + kind + ' berikut ke Bahasa Indonesia yang natural. Pertahankan format dan struktur aslinya.'; break;
    case 'explain': instruction = 'Jelaskan ' + kind + ' berikut dalam Bahasa Indonesia dengan ringkas dan jelas.'; break;
    default: instruction = 'Jawab berdasarkan ' + kind + ' berikut dalam Bahasa Indonesia dengan ringkas dan jelas.';
  }
  const q = (question || '').trim();
  let p = instruction + '\n\nKonten:\n"""\n' + text + '\n"""';
  if (q) p += '\n\nPertanyaan: ' + q;
  return p;
}

function buildImagePrompt(action, question) {
  const q = (question || '').trim();
  switch (action) {
    case 'summarize':
      return 'Ringkas isi gambar berikut dalam Bahasa Indonesia dengan ringkas dan jelas.' + (q ? '\nFokus: ' + q : '');
    case 'translate':
      return 'Terjemahkan semua teks yang terlihat pada gambar berikut ke Bahasa Indonesia yang natural. ' +
        'Tandai bagian yang tidak terbaca dengan [tidak terbaca]. Jangan mengarang.' + (q ? '\nCatatan: ' + q : '');
    case 'extract':
      return 'Ekstrak SEMUA teks yang terlihat pada gambar berikut apa adanya, pertahankan urutan dan barisnya. ' +
        'Tandai bagian yang tidak terbaca dengan [tidak terbaca]. Jangan mengarang, menebak, atau menambah teks yang tidak ada.' +
        (q ? '\nCatatan: ' + q : '');
    case 'answer':
      return 'Gambar ini berisi soal. Jawab singkat dan tegas dalam Bahasa Indonesia. ' +
        'Untuk tiap soal akhiri dengan baris: Jawaban: [jawaban akhir]. Penjelasan maksimal 1 kalimat bila perlu.' +
        (q ? '\nPertanyaan tambahan: ' + q : '');
    case 'explain':
    default:
      return 'Jelaskan isi gambar berikut dalam Bahasa Indonesia dengan ringkas dan jelas.' + (q ? '\nPertanyaan: ' + q : '');
  }
}

/* ============ endpoint Muse (Meta) ============
   Dua mode, TIDAK ada mode login: Meta tidak menyediakan OAuth pihak
   ketiga untuk akun Muse konsumen, dan jalur langganan Muse Code
   bukan API publik (akun pengguna pun tidak berlangganan aktif).
   - 'api'   : Meta Model API resmi (dev.meta.ai), key format LLM|id|secret,
               base https://api.meta.ai/v1, OpenAI-compatible.
   - 'bridge': endpoint OpenAI-compatible milik pengguna sendiri
               (Muse Bridge / 9Router lokalnya). */
function museEndpoint(cfg) {
  if (cfg.museMode === 'bridge') {
    if (!cfg.museBridgeUrl) throw new Error('URL Muse Bridge belum diisi di Pengaturan.');
    return { url: cfg.museBridgeUrl, key: cfg.museBridgeKey, model: cfg.museBridgeModel };
  }
  if (!cfg.museApiKey) throw new Error('API key Meta Model API belum diisi di Pengaturan.');
  return { url: JAWAB_MUSE_API_URL, key: cfg.museApiKey, model: cfg.museModel };
}

/* ============ eksekusi request AI ============ */

function blobToB64(blob) {
  return blob.arrayBuffer().then((ab) => {
    const bytes = new Uint8Array(ab);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  });
}

async function runTextAsk(cfg, draft, question, action, onToken, signal, attach) {
  const raw = draft.text || '';
  if (!raw.trim()) throw new Error('Teks kosong.');
  const L = JAWAB_LIMITS;
  if (raw.length > L.maxTextChars) {
    throw new Error('Teks terlalu besar (' + raw.length + ' karakter, maks ' + L.maxTextChars + '). Tidak dipotong diam-diam; seleksi lebih kecil.');
  }
  const userText = buildTextPrompt(raw, action, question, draft.isCode, draft.language);
  const target = providerTarget(cfg);
  /* attach: {mime, b64} tangkapan kartu soal untuk pilihan bergambar */
  const userContentOpenAI = attach
    ? [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: 'data:' + attach.mime + ';base64,' + attach.b64 } }]
    : userText;
  switch (target.provider) {
    case 'anthropic':
      if (!cfg.anthropicKey) throw new Error('API key Anthropic belum diisi di Pengaturan.');
      await streamAnthropic({ apiKey: cfg.anthropicKey, model: target.model, system: cfg.systemPrompt, messages: [{ role: 'user', content: attach ? [{ type: 'image', source: { type: 'base64', media_type: attach.mime === 'image/png' ? 'image/png' : 'image/jpeg', data: attach.b64 } }, { type: 'text', text: userText }] : userText }], onToken, signal });
      break;
    case 'agentrouter': {
      if (!cfg.agentrouterKey) throw new Error('API key AgentRouter belum diisi di Pengaturan.');
      const contentAR = attach
        ? [{ type: 'image', source: { type: 'base64', media_type: attach.mime === 'image/png' ? 'image/png' : 'image/jpeg', data: attach.b64 } }, { type: 'text', text: userText }]
        : userText;
      await streamAgentRouter({ url: cfg.agentrouterUrl, apiKey: cfg.agentrouterKey, model: target.model, system: cfg.systemPrompt, messages: [{ role: 'user', content: contentAR }], onToken, signal });
      break;
    }
    case 'openai':
      if (!cfg.openaiKey) throw new Error('API key OpenAI belum diisi di Pengaturan.');
      await streamOpenAICompatible({ url: 'https://api.openai.com/v1', apiKey: cfg.openaiKey, model: target.model, messages: [{ role: 'system', content: cfg.systemPrompt }, { role: 'user', content: userContentOpenAI }], onToken, signal });
      break;
    case 'muse': {
      const ep = museEndpoint(cfg);
      await streamOpenAICompatible({ url: ep.url, apiKey: ep.key, model: ep.model, messages: [{ role: 'system', content: cfg.systemPrompt }, { role: 'user', content: userContentOpenAI }], onToken, signal });
      break;
    }
    case 'custom':
    default:
      if (!target.url) throw new Error('URL endpoint custom belum diisi di Pengaturan.');
      await streamOpenAICompatible({ url: target.url, apiKey: cfg.customKey, model: target.model, messages: [{ role: 'system', content: cfg.systemPrompt }, { role: 'user', content: userContentOpenAI }], onToken, signal });
      break;
  }
  return { provider: target.provider, model: target.model, prompt: userText, streamed: true };
}

async function runImageAsk(cfg, imageId, question, action, onToken, signal) {
  if (typeof imageId !== 'string' || !imageId) throw new Error('ID gambar tidak valid.');
  const rec = await JawabStore.getBlob(imageId);
  if (!rec || !rec.blob) throw new Error('Gambar tidak ditemukan (mungkin sudah dihapus). Potret lagi.');
  const L = JAWAB_LIMITS;
  if (rec.blob.size > L.maxImageBytes) throw new Error('Gambar terlalu besar.');
  const b64 = await blobToB64(rec.blob);
  const mime = rec.mime || 'image/jpeg';
  const prompt = buildImagePrompt(action, question);
  const target = providerTarget(cfg);
  switch (target.provider) {
    case 'anthropic': {
      if (!cfg.anthropicKey) throw new Error('API key Anthropic belum diisi di Pengaturan.');
      const mediaType = mime === 'image/png' ? 'image/png' : (mime === 'image/webp' ? 'image/webp' : 'image/jpeg');
      await streamAnthropic({
        apiKey: cfg.anthropicKey, model: target.model,
        system: cfg.systemPrompt,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text: prompt }
        ] }],
        onToken, signal
      });
      break;
    }
    case 'agentrouter': {
      if (!cfg.agentrouterKey) throw new Error('API key AgentRouter belum diisi di Pengaturan.');
      const mediaTypeAR = mime === 'image/png' ? 'image/png' : (mime === 'image/webp' ? 'image/webp' : 'image/jpeg');
      await streamAgentRouter({
        url: cfg.agentrouterUrl, apiKey: cfg.agentrouterKey, model: target.model,
        system: cfg.systemPrompt,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaTypeAR, data: b64 } },
          { type: 'text', text: prompt }
        ] }],
        onToken, signal
      });
      break;
    }
    case 'openai':
      if (!cfg.openaiKey) throw new Error('API key OpenAI belum diisi di Pengaturan.');
      await streamOpenAICompatible({
        url: 'https://api.openai.com/v1', apiKey: cfg.openaiKey, model: target.model,
        messages: [
          { role: 'system', content: cfg.systemPrompt },
          { role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + b64 } }
          ] }
        ],
        onToken, signal
      });
      break;
    case 'muse': {
      const ep = museEndpoint(cfg);
      await streamOpenAICompatible({
        url: ep.url, apiKey: ep.key, model: ep.model,
        messages: [
          { role: 'system', content: cfg.systemPrompt },
          { role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + b64 } }
          ] }
        ],
        onToken, signal
      });
      break;
    }
    case 'custom':
    default: {
      if (!target.url) throw new Error('URL endpoint custom belum diisi di Pengaturan.');
      await streamOpenAICompatible({
        url: target.url, apiKey: cfg.customKey, model: target.model,
        messages: [
          { role: 'system', content: cfg.systemPrompt },
          { role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + b64 } }
          ] }
        ],
        onToken, signal
      });
      break;
    }
  }
  return { provider: target.provider, model: target.model, prompt: prompt, streamed: true };
}

/* ============ pipeline capture: snapshot sekali, crop saja yang keluar ============ */

function computeCrop(rectCss, metrics, bmpW, bmpH) {
  for (const k of ['x', 'y', 'w', 'h']) {
    const v = rectCss[k];
    if (typeof v !== 'number' || !isFinite(v)) throw new Error('Koordinat tidak valid.');
  }
  if (rectCss.w <= 0 || rectCss.h <= 0) throw new Error('Area tidak valid.');
  if (!metrics || !isFinite(metrics.innerWidth) || !isFinite(metrics.innerHeight) ||
      metrics.innerWidth <= 0 || metrics.innerHeight <= 0) {
    throw new Error('Metrik viewport tidak valid.');
  }
  /* Konversi CSS px -> bitmap px dari ukuran aktual, bukan asumsi DPR. */
  const scaleX = bmpW / metrics.innerWidth;
  const scaleY = bmpH / metrics.innerHeight;
  if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    throw new Error('Rasio bitmap/viewport tidak valid.');
  }
  let sx = Math.round(rectCss.x * scaleX);
  let sy = Math.round(rectCss.y * scaleY);
  let sw = Math.round(rectCss.w * scaleX);
  let sh = Math.round(rectCss.h * scaleY);
  sx = Math.max(0, Math.min(sx, bmpW - 1));
  sy = Math.max(0, Math.min(sy, bmpH - 1));
  sw = Math.max(1, Math.min(sw, bmpW - sx));
  sh = Math.max(1, Math.min(sh, bmpH - sy));
  if (sw < 4 || sh < 4) throw new Error('Area terlalu kecil.');
  return { sx: sx, sy: sy, sw: sw, sh: sh };
}

async function captureCropBlob(windowId, rectCss, metrics) {
  let dataUrl;
  let lastErr = null;
  for (let attempt = 0; attempt < 2 && !dataUrl; attempt++) {
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 350)); /* kegagalan sesaat (fokus jendela dsb) dicoba sekali lagi */
    }
  }
  if (!dataUrl) {
    const m = String((lastErr && lastErr.message) || lastErr);
    if (/permission|access|contents of/i.test(m)) {
      let granted = null;
      try { granted = await chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] }); } catch (x) {}
      if (granted) {
        throw new Error('Izin situs SUDAH diberikan, tapi browser tetap menolak screenshot di halaman ini ' +
          '(halaman khusus browser / PDF / mode tertentu memang tidak bisa dipotret). Detail browser: ' + m.slice(0, 160));
      }
      throw new Error('Izin screenshot ditahan browser. Buka brave://extensions > Polter > Details > Site access, pilih "On all sites", lalu coba lagi. (Alternatif: klik ikon Polter di toolbar / Alt+Shift+S dulu.) Detail browser: ' + m.slice(0, 160));
    }
    throw new Error('Gagal memotret layar: ' + m.slice(0, 160));
  }
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  try {
    const c = computeCrop(rectCss, metrics, bmp.width, bmp.height);
    const MAX = 1568;
    const scale = Math.min(1, MAX / Math.max(c.sw, c.sh));
    const cw = Math.max(1, Math.round(c.sw * scale));
    const ch = Math.max(1, Math.round(c.sh * scale));
    const canvas = new OffscreenCanvas(cw, ch);
    canvas.getContext('2d').drawImage(bmp, c.sx, c.sy, c.sw, c.sh, 0, 0, cw, ch);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  } finally {
    bmp.close();
  }
  /* dataUrl viewport penuh tidak disimpan/dikembalikan: hanya crop yang keluar */
}

async function makeThumbDataUrl(blob, maxSide) {
  const bmp = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    const b64 = await blobToB64(out);
    return 'data:image/jpeg;base64,' + b64;
  } finally {
    bmp.close();
  }
}

async function handleCaptureBlob(sender, msg) {
  const tab = sender.tab;
  if (!tab || typeof tab.id !== 'number') throw new Error('Tab tidak dikenali.');
  if (!isValidRect(msg.rect)) throw new Error('Koordinat tidak valid.');
  const blob = await Promise.race([
    captureCropBlob(tab.windowId, msg.rect, msg.metrics),
    timeoutReject(20000, 'Gagal memotret area soal: timeout 20 detik.')
  ]);
  if (blob.size > JAWAB_LIMITS.maxImageBytes) throw new Error('Hasil crop terlalu besar.');
  const blobId = jawabGenId();
  await JawabStore.putBlob(blobId, 'image/jpeg', blob);
  return { blobId: blobId };
}

async function handleCapture(sender, msg) {
  const tab = sender.tab;
  if (!tab || typeof tab.id !== 'number') throw new Error('Tab tidak dikenali.');
  if (!isValidRect(msg.rect)) throw new Error('Koordinat tidak valid.');
  const tabId = tab.id;
  const windowId = tab.windowId;
  const blob = await Promise.race([
    captureCropBlob(windowId, msg.rect, msg.metrics),
    timeoutReject(20000, 'Gagal memotret layar: timeout 20 detik.')
  ]);
  /* Validasi tab/window asal sesudah capture: jangan ambil tab lain. */
  const stillThere = await chrome.tabs.get(tabId).catch(() => null);
  let activeOk = false;
  try {
    const active = await chrome.tabs.query({ active: true, windowId: windowId });
    activeOk = !!(active && active[0] && active[0].id === tabId);
  } catch (e) {}
  if (!stillThere || !activeOk) {
    throw new Error('Tab berubah saat memotret. Ulangi potret.');
  }
  const L = JAWAB_LIMITS;
  if (blob.size > L.maxImageBytes) throw new Error('Hasil crop terlalu besar.');
  const blobId = jawabGenId();
  await JawabStore.putBlob(blobId, 'image/jpeg', blob);
  const now = jawabNow();
  const id = jawabGenId();
  await JawabStore.addSnippet({
    id: id, type: 'image',
    title: 'Tangkapan ' + new Date(now).toLocaleString('id-ID'),
    content: '', imageBlobId: blobId, language: '', tags: [],
    favorite: false,
    sourceUrl: (typeof tab.url === 'string' && jawabIsHttpUrl(tab.url)) ? tab.url : '',
    sourceTitle: typeof tab.title === 'string' ? tab.title.slice(0, 200) : '',
    status: 'draft', createdAt: now, updatedAt: now, aiResults: []
  });
  const thumb = await makeThumbDataUrl(blob, 480);
  return { id: id, blobId: blobId, thumb: thumb };
}

/* ============ port: streaming AI ============ */

const activeRequests = new Map(); /* requestId -> AbortController */

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'jawab-stream') return;
  let senderOk = false;
  try { checkSender(port.sender); senderOk = true; } catch (e) {}
  if (!senderOk) return;
  const sender = port.sender;
  const portRequests = new Set();
  const safePost = (o) => { try { port.postMessage(o); } catch (e) {} };

  port.onMessage.addListener((msg) => {
    (async () => {
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'stop') {
        const c = msg.requestId && activeRequests.get(msg.requestId);
        if (c) { try { c.abort(new Error('STOP')); } catch (e) {} }
        return;
      }
      if (msg.type !== 'ask' && msg.type !== 'ask-snippet') return;
      const requestId = msg.requestId;
      if (!isValidRequestId(requestId)) {
        safePost({ type: 'error', requestId: '', message: 'requestId tidak valid.' });
        return;
      }
      if (activeRequests.has(requestId)) return; /* cegah duplikat */
      const ctrl = new AbortController();
      activeRequests.set(requestId, ctrl);
      portRequests.add(requestId);
      const onToken = (tok) => safePost({ type: 'chunk', requestId: requestId, text: tok });
      try {
        const cfg = await getConfig();
        const target = providerTarget(cfg);
        let meta;
        if (msg.type === 'ask-snippet') {
          meta = await runSnippetAsk(cfg, msg, onToken, ctrl.signal, sender);
        } else {
          meta = await runDirectAsk(cfg, msg, onToken, ctrl.signal, sender);
        }
        safePost({ type: 'done', requestId: requestId, meta: meta });
      } catch (err) {
        const m = (err && err.message) || String(err);
        if (err && err.incomplete) {
          safePost({ type: 'incomplete', requestId: requestId, message: m });
        } else {
          safePost({ type: 'error', requestId: requestId, message: m });
        }
      } finally {
        activeRequests.delete(requestId);
        portRequests.delete(requestId);
      }
    })();
  });

  port.onDisconnect.addListener(() => {
    for (const rid of portRequests) {
      const c = activeRequests.get(rid);
      if (c) { try { c.abort(new Error('DISCONNECT')); } catch (e) {} }
      activeRequests.delete(rid);
    }
  });
});

async function runDirectAsk(cfg, msg, onToken, signal, sender) {
  const draft = msg.draft;
  if (!draft || (draft.kind !== 'text' && draft.kind !== 'image')) {
    throw new Error('Draft tidak valid.');
  }
  if (draft.kind === 'text') {
    let attach = null;
    if (typeof draft.attachImageId === 'string' && draft.attachImageId) {
      try {
        const rec = await JawabStore.getBlob(draft.attachImageId);
        if (rec && rec.blob && rec.blob.size <= JAWAB_LIMITS.maxImageBytes) {
          attach = { mime: rec.mime || 'image/jpeg', b64: await blobToB64(rec.blob) };
        }
      } catch (e) { attach = null; }
    }
    return runTextAsk(cfg, { text: draft.text, isCode: !!draft.isCode, language: draft.language || '' },
      msg.question, msg.action || 'explain', onToken, signal, attach);
  }
  /* image: tanpa gambar valid -> error jelas, jangan fallback ke teks */
  if (!draft.imageId) throw new Error('Gambar tidak valid. Potret lagi.');
  return runImageAsk(cfg, draft.imageId, msg.question, msg.action || 'explain', onToken, signal);
}

async function runSnippetAsk(cfg, msg, onToken, signal, sender) {
  /* Hanya dari halaman extension tepercaya (library), bukan dari web. */
  const prefix = extUrlPrefix();
  const fromExt = sender.url && sender.url.indexOf(prefix) === 0;
  if (!fromExt) throw new Error('ask-snippet hanya dari halaman extension.');
  const snippetId = msg.snippetId;
  if (typeof snippetId !== 'string' || !snippetId) throw new Error('snippetId tidak valid.');
  const s = await JawabStore.getSnippet(snippetId);
  if (!s) throw new Error('Snippet tidak ditemukan.');
  const action = msg.action || 'explain';
  if (s.type === 'image') {
    if (!s.imageBlobId) throw new Error('Snippet gambar tidak punya blob.');
    return runImageAsk(cfg, s.imageBlobId, msg.question, action, onToken, signal);
  }
  return runTextAsk(cfg, { text: s.content, isCode: s.type === 'code', language: s.language || '' },
    msg.question, action, onToken, signal);
}

/* ============ pesan sekali jalan ============ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      checkSender(sender);
    } catch (e) {
      sendResponse({ ok: false, error: 'pengirim tidak dikenal' });
      return;
    }
    if (!msg || typeof msg.type !== 'string') {
      sendResponse({ ok: false, error: 'pesan tidak dikenal' });
      return;
    }
    try {
      const out = await handleOneShot(msg, sender);
      sendResponse(Object.assign({ ok: true }, out));
    } catch (err) {
      sendResponse({ ok: false, error: (err && err.message) || String(err) });
    }
  })();
  return true;
});

async function handleOneShot(msg, sender) {
  switch (msg.type) {
    case 'capture-region': {
      if (!sender.tab) throw new Error('capture hanya dari tab.');
      const r = await handleCapture(sender, msg);
      return { id: r.id, blobId: r.blobId, thumb: r.thumb };
    }
    case 'capture-blob': {
      if (!sender.tab) throw new Error('capture hanya dari tab.');
      const r = await handleCaptureBlob(sender, msg);
      return { blobId: r.blobId };
    }
    case 'ui-pref-get': {
      /* allowlist: hanya preferensi UI, bukan seluruh settings */
      const v = await chrome.storage.local.get(['jawabBtnLeft', 'jawabBtnTop', 'jawabTabVisible']);
      return {
        btnLeft: (typeof v.jawabBtnLeft === 'number') ? v.jawabBtnLeft : null,
        btnTop: (typeof v.jawabBtnTop === 'number') ? v.jawabBtnTop : null,
        tabVisible: v.jawabTabVisible !== false
      };
    }
    case 'ui-pref-set': {
      const patch = {};
      if (msg.left === null || (typeof msg.left === 'number' && isFinite(msg.left))) patch.jawabBtnLeft = msg.left;
      if (msg.top === null || (typeof msg.top === 'number' && isFinite(msg.top))) patch.jawabBtnTop = msg.top;
      if (typeof msg.tabVisible === 'boolean') patch.jawabTabVisible = msg.tabVisible;
      await chrome.storage.local.set(patch);
      return {};
    }
    case 'save-text-snippet': {
      const d = msg.snippet || {};
      const id = await JawabStore.addSnippet({
        type: d.isCode ? 'code' : 'text',
        title: String(d.title || '').slice(0, 300) || (d.isCode ? 'Snippet kode' : 'Snippet teks'),
        content: String(d.text || ''),
        language: String(d.language || '').slice(0, 60),
        tags: [],
        sourceUrl: jawabIsHttpUrl(d.sourceUrl) ? d.sourceUrl : '',
        sourceTitle: String(d.sourceTitle || '').slice(0, 200),
        status: 'saved'
      });
      return { id: id };
    }
    case 'finalize-image-snippet': {
      if (typeof msg.id !== 'string' || !msg.id) throw new Error('id tidak valid');
      const title = String(msg.title || '').slice(0, 300);
      await JawabStore.updateSnippet(msg.id, { status: 'saved', title: title || undefined });
      return {};
    }
    case 'delete-draft': {
      if (typeof msg.id !== 'string' || !msg.id) throw new Error('id tidak valid');
      const s = await JawabStore.getSnippet(msg.id);
      if (s && s.status === 'draft') await JawabStore.deleteSnippet(msg.id);
      return {};
    }
    case 'download-image': {
      if (typeof msg.id !== 'string' || !msg.id) throw new Error('id tidak valid');
      const s = await JawabStore.getSnippet(msg.id);
      if (!s || !s.imageBlobId) throw new Error('gambar tidak ditemukan');
      const rec = await JawabStore.getBlob(s.imageBlobId);
      if (!rec) throw new Error('blob gambar tidak ditemukan');
      const url = URL.createObjectURL(rec.blob);
      try {
        const safeTitle = (s.title || 'polter').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'polter';
        await chrome.downloads.download({ url: url, filename: safeTitle + '.jpg', saveAs: false });
      } finally {
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 10000);
      }
      return {};
    }
    case 'save-ai-result': {
      const prefix = extUrlPrefix();
      if (!(sender.url && sender.url.indexOf(prefix) === 0)) throw new Error('hanya dari halaman extension');
      const r = msg.result || {};
      const id = await JawabStore.addAiResult(msg.snippetId, {
        action: r.action, provider: r.provider, model: r.model,
        prompt: r.prompt, answer: r.answer
      });
      return { id: id };
    }
    case 'test':
    case 'test-vision': {
      const prefix = extUrlPrefix();
      if (!(sender.url && sender.url.indexOf(prefix) === 0)) throw new Error('tes hanya dari halaman extension');
      const cfg = sanitizeTestCfg(msg.cfg);
      const target = providerTarget(cfg);
      const out = (msg.type === 'test-vision')
        ? await probeVision(cfg, target, msg.imageDataUrl)
        : await probeText(cfg, target);
      return { text: out.text, target: target.provider + ' / ' + (target.model || '(model kosong)') };
    }
    case 'frame-detect-report': {
      /* laporan jumlah soal per frame untuk koordinasi deteksi iframe */
      if (!sender.tab || typeof sender.frameId !== 'number') return {};
      const pend = pendingDetect.get(sender.tab.id);
      if (pend) {
        const c = (typeof msg.count === 'number' && isFinite(msg.count)) ? Math.max(0, Math.min(25, Math.floor(msg.count))) : 0;
        pend.reports.set(sender.frameId, c);
      }
      return {};
    }
    case 'get-version':
      return { version: chrome.runtime.getManifest().version };
    default:
      throw new Error('pesan tidak dikenal: ' + msg.type);
  }
}

/* Sanitasi config dari halaman options untuk tes: hanya field yang dikenal. */
function sanitizeTestCfg(c) {
  c = c || {};
  const pick = (v) => (typeof v === 'string' ? v.slice(0, 500) : '');
  return {
    provider: ['custom', 'openai', 'anthropic', 'muse', 'agentrouter'].indexOf(c.provider) !== -1 ? c.provider : 'custom',
    openaiKey: pick(c.openaiKey), openaiModel: pick(c.openaiModel),
    anthropicKey: pick(c.anthropicKey), anthropicModel: pick(c.anthropicModel),
    museMode: c.museMode === 'bridge' ? 'bridge' : 'api',
    museApiKey: pick(c.museApiKey), museModel: pick(c.museModel),
    museBridgeUrl: pick(c.museBridgeUrl), museBridgeKey: pick(c.museBridgeKey), museBridgeModel: pick(c.museBridgeModel),
    customUrl: pick(c.customUrl), customKey: pick(c.customKey), customModel: pick(c.customModel),
    agentrouterUrl: pick(c.agentrouterUrl), agentrouterKey: pick(c.agentrouterKey), agentrouterModel: pick(c.agentrouterModel),
    systemPrompt: pick(c.systemPrompt)
  };
}

/* ============ probe tes koneksi (non-streaming, prompt kecil) ============ */

async function probeJson(url, opts, signal) {
  const head = await fetchHead(url, opts, { connectMs: 20000, totalMs: 60000 }, signal);
  let json = {};
  try { json = await head.res.json(); } catch (e) {}
  head.done();
  if (!head.res.ok) throw await httpError(head.res, json);
  return json;
}

async function probeText(cfg, target) {
  const sys = 'Balas hanya dengan kata: ok';
  switch (target.provider) {
    case 'anthropic': {
      if (!cfg.anthropicKey) throw new Error('API key Anthropic belum diisi.');
      if (!target.model) throw new Error('Model Anthropic belum diisi.');
      const json = await probeJson('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: target.model, max_tokens: 1024, system: sys, messages: [{ role: 'user', content: 'ping' }] })
      });
      const text = (json.content || []).map((b) => b.text || '').join('').trim();
      if (!text) throw new Error('Respons kosong.');
      return { text: text.slice(0, 120) };
    }
    case 'openai':
    case 'custom': {
      const url = target.provider === 'openai' ? 'https://api.openai.com/v1' : target.url;
      const key = target.provider === 'openai' ? cfg.openaiKey : cfg.customKey;
      if (target.provider === 'openai' && !key) throw new Error('API key OpenAI belum diisi.');
      if (!url) throw new Error('URL endpoint custom belum diisi.');
      if (!target.model) throw new Error('Model belum diisi.');
      const json = await probeJson(normalizeBaseUrl(url) + '/chat/completions', {
        method: 'POST',
        headers: authHeaders(key),
        body: JSON.stringify({ model: target.model, max_tokens: 1024, messages: [{ role: 'system', content: sys }, { role: 'user', content: 'ping' }] })
      });
      const text = extractCompletionText(json).trim();
      if (!text) {
        const fr = json.choices && json.choices[0] && json.choices[0].finish_reason;
        throw new Error('Respons kosong.' + (fr ? ' (finish_reason: ' + fr + (fr === 'length' ? ' - jatah token habis untuk reasoning; model berpikir memang begitu' : '') + ')' : ''));
      }
      return { text: text.slice(0, 120) };
    }
    case 'agentrouter': {
      if (!cfg.agentrouterKey) throw new Error('API key AgentRouter belum diisi.');
      if (!target.model) throw new Error('Model AgentRouter belum diisi.');
      await ensureAgentRouterUA();
      let json;
      try {
        json = await probeJson(agentrouterMessagesUrl(cfg.agentrouterUrl), {
          method: 'POST',
          headers: agentrouterHeaders(cfg.agentrouterKey),
          body: JSON.stringify({ model: target.model, max_tokens: 1024, system: sys, messages: [{ role: 'user', content: 'ping' }] })
        });
      } catch (e) { throw agentrouterFriendlyError(e); }
      const text = extractCompletionText(json).trim();
      if (!text) throw new Error('Respons kosong. Periksa key/model AgentRouter, atau gateway sedang menolak klien ini.');
      return { text: text.slice(0, 120) };
    }
    case 'muse': {
      const ep = museEndpoint(cfg);
      if (!ep.model) throw new Error('Model Muse belum diisi.');
      const json = await probeJson(normalizeBaseUrl(ep.url) + '/chat/completions', {
        method: 'POST',
        headers: authHeaders(ep.key),
        body: JSON.stringify({ model: ep.model, max_tokens: 1024, messages: [{ role: 'system', content: sys }, { role: 'user', content: 'ping' }] })
      });
      const textM = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content || '').trim();
      if (!textM) throw new Error('Respons kosong dari Meta Model API (request diterima). Coba Tes lagi; bila tetap kosong, periksa status model/akun di dev.meta.ai.');
      return { text: textM.slice(0, 120) };
    }
  }
  throw new Error('provider tidak dikenal');
}

function dataUrlToB64(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw new Error('gambar tes tidak valid');
  return { mime: m[1], b64: m[2] };
}

async function probeVision(cfg, target, imageDataUrl) {
  const img = dataUrlToB64(imageDataUrl);
  const prompt = 'Gambar ini berisi tulisan "TES VISION". Tulis ulang tulisan yang kamu lihat, hanya itu.';
  switch (target.provider) {
    case 'anthropic': {
      if (!cfg.anthropicKey) throw new Error('API key Anthropic belum diisi.');
      if (!target.model) throw new Error('Model Anthropic belum diisi.');
      const mediaType = img.mime === 'image/png' ? 'image/png' : (img.mime === 'image/webp' ? 'image/webp' : 'image/jpeg');
      const json = await probeJson('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: target.model, max_tokens: 1024,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: img.b64 } },
            { type: 'text', text: prompt }
          ] }]
        })
      });
      const text = (json.content || []).map((b) => b.text || '').join('').trim();
      if (!text) throw new Error('Respons kosong. Model mungkin tidak mendukung gambar.');
      return { text: text.slice(0, 200) };
    }
    case 'openai':
    case 'custom': {
      const url = target.provider === 'openai' ? 'https://api.openai.com/v1' : target.url;
      const key = target.provider === 'openai' ? cfg.openaiKey : cfg.customKey;
      if (target.provider === 'openai' && !key) throw new Error('API key OpenAI belum diisi.');
      if (!url) throw new Error('URL endpoint custom belum diisi.');
      if (!target.model) throw new Error('Model belum diisi.');
      const json = await probeJson(normalizeBaseUrl(url) + '/chat/completions', {
        method: 'POST',
        headers: authHeaders(key),
        body: JSON.stringify({
          model: target.model, max_tokens: 1024,
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: 'data:' + img.mime + ';base64,' + img.b64 } }
          ] }]
        })
      });
      const text = extractCompletionText(json).trim();
      if (!text) {
        const fr = json.choices && json.choices[0] && json.choices[0].finish_reason;
        throw new Error('Respons kosong. Model mungkin tidak mendukung gambar.' + (fr ? ' (finish_reason: ' + fr + ')' : ''));
      }
      return { text: text.slice(0, 200) };
    }
    case 'agentrouter': {
      if (!cfg.agentrouterKey) throw new Error('API key AgentRouter belum diisi.');
      if (!target.model) throw new Error('Model AgentRouter belum diisi.');
      await ensureAgentRouterUA();
      const mediaType = img.mime === 'image/png' ? 'image/png' : (img.mime === 'image/webp' ? 'image/webp' : 'image/jpeg');
      let json;
      try {
        json = await probeJson(agentrouterMessagesUrl(cfg.agentrouterUrl), {
        method: 'POST',
        headers: agentrouterHeaders(cfg.agentrouterKey),
        body: JSON.stringify({
          model: target.model, max_tokens: 1024,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: img.b64 } },
            { type: 'text', text: prompt }
          ] }]
        })
      });
      } catch (e) { throw agentrouterFriendlyError(e); }
      const textV = extractCompletionText(json).trim();
      if (!textV) throw new Error('Respons kosong. Model mungkin tidak mendukung gambar.');
      return { text: textV.slice(0, 200) };
    }
    case 'muse': {
      const ep = museEndpoint(cfg);
      if (!ep.model) throw new Error('Model Muse belum diisi.');
      const json = await probeJson(normalizeBaseUrl(ep.url) + '/chat/completions', {
        method: 'POST',
        headers: authHeaders(ep.key),
        body: JSON.stringify({
          model: ep.model, max_tokens: 1024,
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: 'data:' + img.mime + ';base64,' + img.b64 } }
          ] }]
        })
      });
      const textM = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content || '').trim();
      if (!textM) throw new Error(cfg.museMode === 'bridge'
        ? 'Respons kosong. Rute Muse Bridge saat ini teks saja, jadi gambar tidak diproses.'
        : 'Respons kosong dari Meta Model API (request diterima). Coba Tes lagi; bila tetap kosong, periksa status model/akun di dev.meta.ai.');
      return { text: textM.slice(0, 200) };
    }
  }
  throw new Error('provider tidak dikenal');
}

/* ============ action toolbar & commands ============ */

function flashBadge(text) {
  try {
    chrome.action.setBadgeText({ text: text });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
    setTimeout(() => { try { chrome.action.setBadgeText({ text: '' }); } catch (e) {} }, 2500);
  } catch (e) {}
}

async function sendToTab(tabId, type) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: type });
    return;
  } catch (e) { /* content script mungkin belum terinject */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tabId, allFrames: true }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: type });
  } catch (e2) {
    flashBadge('!');
  }
}

/* ============ koordinasi deteksi lintas frame ============
   Soal bisa tinggal di iframe (banyak LMS begitu). Alur: background
   menyiarkan 'jawab-detect-probe' ke semua frame; tiap frame memindai
   dokumennya sendiri dan melapor jumlah soal; frame dengan soal
   terbanyak yang menampilkan panel (panel + pengisian terjadi di
   dokumen yang sama, jadi referensi elemen selalu valid). */
const pendingDetect = new Map(); /* tabId -> { reports: Map<frameId, count> } */

function pickWinningFrame(reports) {
  /* reports: [{frameId, count}] -> frameId pemenang.
     Seri -> frameId terkecil (frame utama didahulukan). Kosong -> 0. */
  let best = 0, bestCount = -1;
  for (const r of reports || []) {
    if (!r || typeof r.frameId !== 'number') continue;
    if (r.count > bestCount || (r.count === bestCount && r.frameId < best)) {
      best = r.frameId; bestCount = r.count;
    }
  }
  return best;
}

function finalizeDetect(tabId) {
  const pend = pendingDetect.get(tabId);
  if (!pend) return;
  pendingDetect.delete(tabId);
  const reports = [];
  pend.reports.forEach((count, frameId) => reports.push({ frameId: frameId, count: count }));
  const winner = pickWinningFrame(reports);
  chrome.tabs.sendMessage(tabId, { type: 'jawab-detect-present' }, { frameId: winner }).catch(() => {});
}

async function detectOnTab(tabId) {
  pendingDetect.set(tabId, { reports: new Map() });
  let delivered = false;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'jawab-detect-probe' });
    delivered = true;
  } catch (e) { /* belum ada content script di frame mana pun */ }
  if (!delivered) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tabId, allFrames: true }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, { type: 'jawab-detect-probe' });
      delivered = true;
    } catch (e) { /* halaman tidak bisa diinjeksi (chrome://, dsb) */ }
  }
  if (!delivered) {
    pendingDetect.delete(tabId);
    flashBadge('!');
    return;
  }
  setTimeout(() => finalizeDetect(tabId), 450);
}

async function enterCaptureOnTab(tabId) {
  return sendToTab(tabId, 'jawab-enter-capture');
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || typeof tab.id !== 'number' || !/^https?:\/\//.test(tab.url || '')) {
    flashBadge('!');
    return;
  }
  await enterCaptureOnTab(tab.id);
});

/* radio 'Tombol hantu' berubah di Pengaturan -> siarkan ke semua tab
   supaya tab hantu langsung muncul/hilang tanpa reload */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.jawabTabVisible) return;
  const visible = changes.jawabTabVisible.newValue !== false;
  chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).then((tabs) => {
    (tabs || []).forEach((tb) => {
      if (tb && typeof tb.id === 'number') {
        chrome.tabs.sendMessage(tb.id, { type: 'jawab-tab-visibility', visible: visible }).catch(() => {});
      }
    });
  }).catch(() => {});
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-library') {
    chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
    return;
  }
  if (command === 'detect-questions') {
    const tabsD = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    const tabD = tabsD && tabsD[0];
    if (!tabD || typeof tabD.id !== 'number' || !/^https?:\/\//.test(tabD.url || '')) {
      flashBadge('!');
      return;
    }
    await detectOnTab(tabD.id);
    return;
  }
  if (command === 'toggle-menu') {
    const tabsM = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    const tabM = tabsM && tabsM[0];
    if (!tabM || typeof tabM.id !== 'number' || !/^https?:\/\//.test(tabM.url || '')) {
      flashBadge('!');
      return;
    }
    await sendToTab(tabM.id, 'jawab-toggle-menu');
    return;
  }
  if (command !== 'capture-region') return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const tab = tabs && tabs[0];
  if (!tab || typeof tab.id !== 'number' || !/^https?:\/\//.test(tab.url || '')) {
    flashBadge('!');
    return;
  }
  await enterCaptureOnTab(tab.id);
});

/* ============ init ============ */

function initTrustedContexts() {
  try {
    if (chrome.storage && chrome.storage.local && chrome.storage.local.setAccessLevel) {
      chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    }
  } catch (e) { /* Chrome lama: abaikan */ }
}

chrome.runtime.onInstalled.addListener(() => {
  initTrustedContexts();
  JawabStore.cleanupDrafts().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  initTrustedContexts();
  JawabStore.cleanupDrafts().catch(() => {});
});
