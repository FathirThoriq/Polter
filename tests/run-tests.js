/* Jawab - regression test tahap A (Node, mock provider, tanpa API asli).
   Menguji source background.js/storage.js yang sebenarnya via vm.
   Bukan pengganti uji end-to-end Chrome (lihat TESTING.md).
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const results = [];
function ok(name, cond, extra) {
  if (cond) { passed++; results.push('PASS ' + name); }
  else { failed++; results.push('FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}
function eq(name, a, b) {
  ok(name, JSON.stringify(a) === JSON.stringify(b), 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

/* ---------- stub chrome ---------- */
const listeners = {};
let storageData = {};
let fetchImpl = null;

const chromeStub = {
  runtime: {
    id: 'test-ext-id',
    onConnect: { addListener: (fn) => { listeners.onConnect = fn; } },
    onMessage: { addListener: (fn) => { listeners.onMessage = fn; } },
    onInstalled: { addListener: (fn) => { listeners.onInstalled = fn; } },
    onStartup: { addListener: (fn) => { listeners.onStartup = fn; } },
    getURL: (p) => 'chrome-extension://test-ext-id/' + p,
    getManifest: () => ({ version: '0.3.0' }),
  },
  storage: {
    onChanged: { addListener: () => {} },
    local: {
      get: async (keys) => {
        const out = {};
        const arr = Array.isArray(keys) ? keys : Object.keys(keys || {});
        for (const k of arr) if (k in storageData) out[k] = storageData[k];
        return out;
      },
      set: async (obj) => { Object.assign(storageData, obj); },
      setAccessLevel: () => {},
    },
  },
  tabs: {
    captureVisibleTab: async () => { throw new Error('not stubbed'); },
    get: async () => null,
    query: async () => [],
    sendMessage: async () => { throw new Error('no receiver'); },
    create: async () => ({}),
  },
  action: {
    onClicked: { addListener: (fn) => { listeners.onClicked = fn; } },
    setBadgeText: () => {}, setBadgeBackgroundColor: () => {},
  },
  commands: { onCommand: { addListener: (fn) => { listeners.onCommand = fn; } } },
  downloads: { download: async () => 1 },
  permissions: { contains: async () => true, request: async () => true },
  scripting: { executeScript: async () => {} },
};

function sseBody(chunks) {
  let i = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (i >= chunks.length) return { done: true, value: undefined };
        return { done: false, value: new TextEncoder().encode(chunks[i++]) };
      },
      cancel: async () => {},
    }),
  };
}

/* body yang menggantung sampai signal abort (simulasi stream macet) */
function hangingBody(signal) {
  let rejectRead = null;
  signal.addEventListener('abort', () => {
    if (rejectRead) rejectRead(new DOMException('aborted', 'AbortError'));
  });
  return {
    getReader: () => ({
      read: () => new Promise((_, rej) => { rejectRead = rej; }),
      cancel: async () => {},
    }),
  };
}

function fakeFetch(url, opts) {
  if (fetchImpl) return fetchImpl(url, opts);
  throw new Error('fetch tidak di-stub untuk ' + url);
}

/* ---------- muat source asli ke vm ---------- */
const ctx = vm.createContext({
  chrome: chromeStub,
  fetch: fakeFetch,
  importScripts: () => {},
  console: console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  TextDecoder, TextEncoder, URL, Blob, DOMException,
  AbortController, AbortSignal, btoa, atob,
  crypto: require('crypto').webcrypto,
  indexedDB: undefined, // storage IDB tidak diuji di Node (lihat TESTING.md)
});
ctx.window = ctx;
ctx.globalThis = ctx;

for (const f of ['defaults.js', 'storage.js', 'background.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const G = (name) => vm.runInContext(name, ctx);

async function main() {
  /* ===== 1. SSE OpenAI: chunk terpotong, CRLF, multibyte ===== */
  {
    const readSSE = G('readSSE');
    const dispatch = G('sseDispatchOpenAI');
    const tokens = [];
    // "héllo" dipotong tepat di tengah byte multibyte + CRLF
    const fullText = 'data: {"choices":[{"delta":{"content":"héllo"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":" dunia"}}]}\r\n\r\ndata: [DONE]\r\n\r\n';
    const fullBytes = new TextEncoder().encode(fullText);
    const cutAt = fullBytes.indexOf(0xc3) + 1; // belah di tengah sequence 2-byte é
    const raw1 = fullBytes.slice(0, cutAt);
    const raw2 = fullBytes.slice(cutAt);
    const head = {
      res: { body: { getReader: () => {
        const parts = [raw1, raw2];
        let i = 0;
        return { read: async () => i >= parts.length ? { done: true, value: undefined } : { done: false, value: parts[i++] }, cancel: async () => {} };
      } } },
      ctrl: new AbortController(), done: () => {}
    };
    await readSSE(head, dispatch, (t) => tokens.push(t), { idleMs: 2000 });
    eq('sse-openai split/multibyte/crlf', tokens.join(''), 'héllo dunia');
  }

  /* ===== 2. SSE berakhir tanpa terminator -> incomplete, bukan sukses ===== */
  {
    const readSSE = G('readSSE');
    const dispatch = G('sseDispatchOpenAI');
    const tokens = [];
    const head = { res: { body: sseBody(['data: {"choices":[{"delta":{"content":"parsial"}}]}\n\n']) }, ctrl: new AbortController(), done: () => {} };
    let err = null;
    try { await readSSE(head, dispatch, (t) => tokens.push(t), { idleMs: 2000 }); }
    catch (e) { err = e; }
    ok('sse-openai tanpa [DONE] -> error incomplete', !!(err && err.incomplete), err && err.message);
    eq('sse-openai token parsial tetap ada', tokens.join(''), 'parsial');
  }

  /* ===== 3. Anthropic: delta ok, error event dipropagasi ===== */
  {
    const readSSE = G('readSSE');
    const dispatch = G('sseDispatchAnthropic');
    const tokens = [];
    const chunks = [
      'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"halo"}}\n\n',
      'event: message_stop\ndata: {}\n\n',
    ];
    const head = { res: { body: sseBody(chunks) }, ctrl: new AbortController(), done: () => {} };
    await readSSE(head, dispatch, (t) => tokens.push(t), { idleMs: 2000 });
    eq('sse-anthropic delta', tokens.join(''), 'halo');

    const errChunks = ['event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n'];
    const head2 = { res: { body: sseBody(errChunks) }, ctrl: new AbortController(), done: () => {} };
    let err = null;
    try { await readSSE(head2, dispatch, () => {}, { idleMs: 2000 }); } catch (e) { err = e; }
    ok('sse-anthropic error event dipropagasi', !!(err && /Overloaded/.test(err.message)), err && err.message);
  }

  /* ===== 4. fetchHead: connect timeout ===== */
  {
    const fetchHead = G('fetchHead');
    fetchImpl = (url, opts) => new Promise((_, rej) => {
      opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    });
    let err = null;
    try { await fetchHead('https://x.test/', {}, { connectMs: 60, totalMs: 5000 }); }
    catch (e) { err = e; }
    ok('fetchHead connect timeout', !!(err && /Timeout koneksi/.test(err.message)), err && err.message);
    fetchImpl = null;
  }

  /* ===== 5. readSSE: idle timeout saat body macet ===== */
  {
    const readSSE = G('readSSE');
    const dispatch = G('sseDispatchOpenAI');
    const ctrl = new AbortController();
    const head = { res: { body: hangingBody(ctrl.signal) }, ctrl: ctrl, done: () => {} };
    let err = null;
    try { await readSSE(head, dispatch, () => {}, { idleMs: 80 }); }
    catch (e) { err = e; }
    ok('readSSE idle timeout', !!(err && /tidak ada data selama/.test(err.message)), err && err.message);
  }

  /* ===== 6. abort eksternal (Stop) ===== */
  {
    const fetchHead = G('fetchHead');
    const ext = new AbortController();
    fetchImpl = (url, opts) => new Promise((_, rej) => {
      opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    });
    const p = fetchHead('https://x.test/', {}, { connectMs: 5000, totalMs: 5000 }, ext.signal);
    ext.abort(new Error('STOP'));
    let err = null;
    try { await p; } catch (e) { err = e; }
    ok('fetchHead abort eksternal -> dibatalkan', !!(err && /dibatalkan/.test(err.message)), err && err.message);
    fetchImpl = null;
  }

  /* ===== 7. computeCrop ===== */
  {
    const computeCrop = G('computeCrop');
    // dpr 2: bitmap 2000x1600, viewport 1000x800
    eq('computeCrop dpr2', computeCrop({ x: 10, y: 20, w: 100, h: 50 }, { innerWidth: 1000, innerHeight: 800 }, 2000, 1600),
      { sx: 20, sy: 40, sw: 200, sh: 100 });
    // zoom 125%: viewport css mengecil, bitmap tetap
    eq('computeCrop zoom', computeCrop({ x: 0, y: 0, w: 800, h: 600 }, { innerWidth: 800, innerHeight: 600 }, 2000, 1500),
      { sx: 0, sy: 0, sw: 2000, sh: 1500 });
    // clamp tepi
    const c = computeCrop({ x: 990, y: 790, w: 100, h: 100 }, { innerWidth: 1000, innerHeight: 800 }, 2000, 1600);
    ok('computeCrop clamp tepi', c.sx + c.sw <= 2000 && c.sy + c.sh <= 1600, JSON.stringify(c));
    let threw = false;
    try { computeCrop({ x: NaN, y: 0, w: 10, h: 10 }, { innerWidth: 1000, innerHeight: 800 }, 2000, 1600); } catch (e) { threw = true; }
    ok('computeCrop tolak NaN', threw);
  }

  /* ===== 8. whitespace dipertahankan ===== */
  {
    const buildTextPrompt = G('buildTextPrompt');
    const raw = '    const x = 1;\n\treturn x;\n';
    const p = buildTextPrompt(raw, 'explain', '', true, 'js');
    ok('whitespace kode utuh di prompt', p.includes(raw), JSON.stringify(p.slice(0, 80)));
  }

  /* ===== 9. util: normalizeBaseUrl, authHeaders, checkSender ===== */
  {
    const normalizeBaseUrl = G('normalizeBaseUrl');
    eq('normalizeBaseUrl tidak ganda', normalizeBaseUrl('https://a.test/v1/chat/completions'), 'https://a.test/v1');
    eq('normalizeBaseUrl trailing slash', normalizeBaseUrl('https://a.test/v1//'), 'https://a.test/v1');
    const authHeaders = G('authHeaders');
    const h = authHeaders('');
    ok('authHeaders tanpa key -> tanpa Authorization', !('Authorization' in h));
    ok('authHeaders dengan key', authHeaders('k').Authorization === 'Bearer k');
    const checkSender = G('checkSender');
    let threw = false;
    try { checkSender({ id: 'asing' }); } catch (e) { threw = true; }
    ok('checkSender tolak pengirim asing', threw);
  }

  /* ===== 10. alur port end-to-end dengan mock fetch ===== */
  {
    storageData = { provider: 'openai', openaiKey: 'k-test', openaiModel: 'gpt-4o-mini' };
    fetchImpl = async (url) => {
      if (String(url).includes('/chat/completions')) {
        return { ok: true, status: 200, body: sseBody(['data: {"choices":[{"delta":{"content":"jawab"}}]}\n\n', 'data: [DONE]\n\n']) };
      }
      throw new Error('url tak dikenal ' + url);
    };
    const port = {
      name: 'jawab-stream',
      sender: { id: 'test-ext-id', tab: { id: 7, windowId: 1 } },
      posted: [],
      postMessage(o) { this.posted.push(o); },
      disconnect() { if (this._d) this._d(); },
      onMessage: { addListener: (fn) => { port._m = fn; } },
      onDisconnect: { addListener: (fn) => { port._d = fn; } },
    };
    listeners.onConnect(port);
    port._m({ type: 'ask', requestId: 'r-e2e-1', draft: { kind: 'text', text: '  halo  ' }, question: '', action: 'explain' });
    await new Promise((r) => setTimeout(r, 300));
    const types = port.posted.map((p) => p.type);
    ok('port e2e chunk+done', types.includes('chunk') && types[types.length - 1] === 'done', JSON.stringify(types));
    const chunk = port.posted.find((p) => p.type === 'chunk');
    eq('port e2e token', chunk && chunk.text, 'jawab');
    ok('port e2e requestId konsisten', port.posted.every((p) => p.requestId === 'r-e2e-1'));

    /* stop membatalkan */
    const port2 = {
      name: 'jawab-stream',
      sender: { id: 'test-ext-id', tab: { id: 7, windowId: 1 } },
      posted: [],
      postMessage(o) { this.posted.push(o); },
      disconnect() { if (this._d) this._d(); },
      onMessage: { addListener: (fn) => { port2._m = fn; } },
      onDisconnect: { addListener: (fn) => { port2._d = fn; } },
    };
    fetchImpl = (url, opts) => new Promise((_, rej) => {
      opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    });
    listeners.onConnect(port2);
    port2._m({ type: 'ask', requestId: 'r-e2e-2', draft: { kind: 'text', text: 'halo' }, question: '', action: 'explain' });
    await new Promise((r) => setTimeout(r, 100));
    port2._m({ type: 'stop', requestId: 'r-e2e-2' });
    await new Promise((r) => setTimeout(r, 200));
    const errMsg = port2.posted.find((p) => p.type === 'error');
    ok('port stop -> error dibatalkan', !!(errMsg && /dibatalkan/.test(errMsg.message)), JSON.stringify(port2.posted.map((p) => p.type)));
    fetchImpl = null;
  }

  /* ===== 11. validasi import ===== */
  {
    const jawabValidateImport = G('jawabValidateImport');
    const good = {
      app: 'jawab', schemaVersion: 1, exportedAt: '2026-10-12T00:00:00Z',
      snippets: [{
        id: 'a1', type: 'code', title: 't', content: '  x  ', imageBlobId: null,
        language: 'js', tags: ['a'], favorite: false, sourceUrl: 'https://x.test/p',
        sourceTitle: 't', status: 'saved', createdAt: 1, updatedAt: 2, aiResults: []
      }],
      blobs: [],
    };
    const v1 = jawabValidateImport(good);
    ok('import valid', v1.ok, JSON.stringify(v1.errors));

    const badSchema = Object.assign({}, good, { schemaVersion: 99 });
    ok('import tolak schemaVersion', !jawabValidateImport(badSchema).ok);

    const secret = JSON.parse(JSON.stringify(good));
    secret.snippets[0].apiKey = 'xxx';
    ok('import tolak field kredensial', !jawabValidateImport(secret).ok);

    const badMime = JSON.parse(JSON.stringify(good));
    badMime.blobs = [{ id: 'b1', mime: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }];
    ok('import tolak MIME svg', !jawabValidateImport(badMime).ok);

    const big = JSON.parse(JSON.stringify(good));
    big.snippets[0].content = 'x'.repeat(1000001);
    ok('import tolak konten raksasa', !jawabValidateImport(big).ok);
  }

  console.log('\n' + results.join('\n'));
  console.log('\n' + passed + ' lulus, ' + failed + ' gagal');

  /* ===== TAHAP B: capture pipeline, ask-snippet, ui-pref ===== */
  await stageB();

  console.log('\n--- tahap B ---');
  console.log(results.slice(results._bStart).join('\n'));
  console.log('\nTOTAL ' + passed + ' lulus, ' + failed + ' gagal');
  process.exit(failed ? 1 : 0);
}

async function stageB() {
  results._bStart = results.length;
  const ctxB = vm.createContext ? null : null; // reuse ctx utama
  // stub API bitmap/canvas di context utama (lookup dinamis saat dipanggil)
  G('Object'); // noop
  const nodeFetch = fetch;
  // pasang stub ke context via runInContext assignment
  vm.runInContext(`
    globalThis.createImageBitmap = async (blob) => ({ width: 2000, height: 1600, close: () => {} });
    globalThis.OffscreenCanvas = class {
      constructor(w, h) { this.width = w; this.height = h; }
      getContext() { return { drawImage: () => {} }; }
      async convertToBlob() { return new Blob(['CROP-BYTES'], { type: 'image/jpeg' }); }
    };
  `, ctx);
  const memBlobs = new Map();
  const memSnippets = new Map();
  vm.runInContext(`
    globalThis.JawabStore = {
      putBlob: async (id, mime, blob) => { __memBlobs.set(id, { mime, blob }); },
      getBlob: async (id) => __memBlobs.get(id) || null,
      addSnippet: async (data) => { const id = data.id || ('test-' + Math.random().toString(36).slice(2)); __memSnippets.set(id, Object.assign({}, data, { id })); return id; },
      getSnippet: async (id) => __memSnippets.get(id) || null,
      updateSnippet: async (id, patch) => { const s = __memSnippets.get(id); Object.assign(s, patch); return s; },
      deleteSnippet: async (id) => { __memSnippets.delete(id); return true; },
    };
  `, ctx);
  ctx.__memBlobs = memBlobs;
  ctx.__memSnippets = memSnippets;

  const FULL_B64 = Buffer.from('FULL-VIEWPORT-'.repeat(200)).toString('base64');
  const FULL_DATAURL = 'data:image/png;base64,' + FULL_B64;
  chromeStub.tabs.captureVisibleTab = async () => FULL_DATAURL;
  chromeStub.tabs.get = async (id) => ({ id: id });
  chromeStub.tabs.query = async () => [{ id: 5 }];

  const sendOneShot = (msg, sender) => new Promise((resolve) => {
    listeners.onMessage(msg, sender, (res) => resolve(res));
  });
  const tabSender = { id: 'test-ext-id', tab: { id: 5, windowId: 1, url: 'https://contoh.test/hal', title: 'Halaman' } };

  /* fetch: data: URL -> fetch asli; sisanya -> tangkap body */
  let lastBody = null;
  fetchImpl = async (url, opts) => {
    if (String(url).startsWith('data:')) return nodeFetch(url, opts);
    lastBody = opts && opts.body;
    return { ok: true, status: 200, body: sseBody(['data: [DONE]\n\n']) };
  };

  /* 1. capture-region: crop tersimpan sebagai draft, full screenshot dibuang */
  {
    const res = await sendOneShot({
      type: 'capture-region',
      rect: { x: 10, y: 10, w: 200, h: 100 },
      metrics: { innerWidth: 1000, innerHeight: 800, scrollX: 0, scrollY: 0, dpr: 2 },
    }, tabSender);
    ok('capture-region ok', !!(res && res.ok && res.id && res.thumb && res.thumb.startsWith('data:image/jpeg')), JSON.stringify(res).slice(0, 200));
    const s = memSnippets.get(res.id);
    ok('capture tersimpan sebagai draft', !!(s && s.status === 'draft' && s.type === 'image'));
    ok('capture sourceUrl http(s) valid', s && s.sourceUrl === 'https://contoh.test/hal');
    const rec = memBlobs.get(s.imageBlobId);
    const cropB64 = Buffer.from(await rec.blob.arrayBuffer()).toString('base64');
    ok('blob adalah crop (bukan full viewport)', cropB64 === Buffer.from('CROP-BYTES').toString('base64'));
    ok('full viewport tidak tersimpan di blob', !cropB64.includes(FULL_B64.slice(0, 40)));
  }

  /* 2. ask-snippet dari library: hanya crop yang dikirim ke provider */
  {
    const draftId = [...memSnippets.keys()][0];
    storageData = { provider: 'openai', openaiKey: 'k', openaiModel: 'm' };
    const port = {
      name: 'jawab-stream',
      sender: { id: 'test-ext-id', url: 'chrome-extension://test-ext-id/library.html' },
      posted: [],
      postMessage(o) { this.posted.push(o); },
      disconnect() { if (this._d) this._d(); },
      onMessage: { addListener: (fn) => { port._m = fn; } },
      onDisconnect: { addListener: (fn) => { port._d = fn; } },
    };
    listeners.onConnect(port);
    port._m({ type: 'ask-snippet', requestId: 'r-b2', snippetId: draftId, action: 'explain', question: '' });
    await new Promise((r) => setTimeout(r, 300));
    const done = port.posted.find((p) => p.type === 'done');
    ok('ask-snippet done', !!done, JSON.stringify(port.posted.map((p) => p.type)));
    const bodyStr = String(lastBody || '');
    ok('payload hanya berisi crop', bodyStr.includes(Buffer.from('CROP-BYTES').toString('base64')));
    ok('payload tidak berisi full viewport', !bodyStr.includes(FULL_B64.slice(0, 60)));
    ok('ask-snippet meta ada provider/model', !!(done && done.meta && done.meta.provider === 'openai'));
  }

  /* 3. ask-snippet dari web ditolak */
  {
    const port = {
      name: 'jawab-stream',
      sender: { id: 'test-ext-id', tab: { id: 5 }, url: 'https://jahat.test/' },
      posted: [],
      postMessage(o) { this.posted.push(o); },
      disconnect() {},
      onMessage: { addListener: (fn) => { port._m = fn; } },
      onDisconnect: { addListener: () => {} },
    };
    listeners.onConnect(port);
    port._m({ type: 'ask-snippet', requestId: 'r-b3', snippetId: 'x', action: 'explain', question: '' });
    await new Promise((r) => setTimeout(r, 200));
    const err = port.posted.find((p) => p.type === 'error');
    ok('ask-snippet dari web ditolak', !!err, JSON.stringify(port.posted.map((p) => p.type)));
  }

  /* 4. ui-pref: hanya field allowlist, bukan seluruh settings */
  {
    storageData = { provider: 'openai', openaiKey: 'RAHASIA', jawabBtnLeft: 111, jawabBtnTop: 222 };
    const r = await sendOneShot({ type: 'ui-pref-get' }, { id: 'test-ext-id', tab: { id: 5 } });
    eq('ui-pref-get allowlist', r, { ok: true, btnLeft: 111, btnTop: 222, tabVisible: true });
    ok('ui-pref tidak membocorkan key', !JSON.stringify(r).includes('RAHASIA'));
    const r2 = await sendOneShot({ type: 'ui-pref-set', left: 10, top: 20, openaiKey: 'X' }, { id: 'test-ext-id', tab: { id: 5 } });
    ok('ui-pref-set ok', !!(r2 && r2.ok));
    ok('ui-pref-set mengabaikan field asing', storageData.openaiKey === 'RAHASIA');
    eq('ui-pref-set tersimpan', [storageData.jawabBtnLeft, storageData.jawabBtnTop], [10, 20]);
  }

  /* 5. save-text-snippet: whitespace identik */
  {
    const raw = '    const x = 1;\n\treturn x;\n';
    const r = await sendOneShot({ type: 'save-text-snippet', snippet: { text: raw, isCode: true, language: 'js', title: 't', sourceUrl: 'https://a.test/', sourceTitle: 't' } }, tabSender);
    ok('save-text ok', !!(r && r.ok && r.id));
    const s = memSnippets.get(r.id);
    eq('whitespace tersimpan identik', s && s.content, raw);
  }

  /* 6. pesan tak dikenal ditolak */
  {
    const r = await sendOneShot({ type: 'fetch-apapun', url: 'https://jahat.test/' }, tabSender);
    ok('pesan tak dikenal ditolak', !!(r && !r.ok), JSON.stringify(r));
  }

  /* 7. v0.8.3: toleransi SSE gateway lokal (9Router dsb) */
  {
    const readSSE = G('readSSE');
    const dispatch = G('sseDispatchOpenAI');
    const extractCompletionText = G('extractCompletionText');
    const mkHead = (chunks) => ({ res: { body: sseBody(chunks) }, ctrl: new AbortController(), done: () => {} });
    const extractJson = (raw) => { try { return extractCompletionText(JSON.parse(raw)); } catch (e) { return ''; } };

    /* finish_reason tanpa [DONE] = selesai, bukan incomplete */
    const tok1 = [];
    let err1 = null;
    try {
      await readSSE(mkHead([
        'data: {"choices":[{"delta":{"content":"halo"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
      ]), dispatch, (x) => tok1.push(x), { idleMs: 2000 }, extractJson);
    } catch (e) { err1 = e; }
    ok('sse finish_reason tanpa [DONE] tuntas', !err1, err1 && err1.message);
    eq('sse finish_reason token utuh', tok1.join(''), 'halo');

    /* jawaban utuh di message pada chunk terakhir */
    const tok2 = [];
    await readSSE(mkHead([
      'data: {"choices":[{"message":{"content":"utuh"}}]}\n\n',
      'data: [DONE]\n\n'
    ]), dispatch, (x) => tok2.push(x), { idleMs: 2000 }, extractJson);
    eq('sse message.content terbaca', tok2.join(''), 'utuh');

    /* delta bergaya Anthropic (passthrough Claude) */
    const tok3 = [];
    await readSSE(mkHead([
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"claude"}}\n\n',
      'data: {"type":"message_stop"}\n\n'
    ]), dispatch, (x) => tok3.push(x), { idleMs: 2000 }, extractJson);
    eq('sse delta anthropic terbaca', tok3.join(''), 'claude');

    /* bodi JSON utuh ber-header streaming -> diselamatkan extractor */
    const tok4 = [];
    let err4 = null;
    try {
      await readSSE(mkHead(['{"choices":[{"message":{"content":"json utuh"}}]}']),
        dispatch, (x) => tok4.push(x), { idleMs: 2000 }, extractJson);
    } catch (e) { err4 = e; }
    ok('sse bodi JSON tidak gagal', !err4, err4 && err4.message);
    eq('sse bodi JSON jadi token', tok4.join(''), 'json utuh');

    eq('extractCompletionText anthropic blocks', extractCompletionText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), 'ab');
    eq('extractCompletionText legacy text', extractCompletionText({ choices: [{ text: 'legacy' }] }), 'legacy');
  }

  /* 8. v0.8.4: AgentRouter */
  {
    const providerTarget = G('providerTarget');
    const agentrouterMessagesUrl = G('agentrouterMessagesUrl');
    const agentrouterHeaders = G('agentrouterHeaders');
    const sanitizeTestCfg = G('sanitizeTestCfg');
    const tgt = providerTarget({ provider: 'agentrouter', agentrouterModel: 'claude-sonnet-4-6', agentrouterUrl: 'https://agentrouter.org' });
    eq('agentrouter target', [tgt.provider, tgt.model, tgt.needsKey], ['agentrouter', 'claude-sonnet-4-6', true]);
    eq('agentrouter url tanpa /v1', agentrouterMessagesUrl('https://agentrouter.org'), 'https://agentrouter.org/v1/messages');
    eq('agentrouter url dengan /v1', agentrouterMessagesUrl('https://agentrouter.org/v1'), 'https://agentrouter.org/v1/messages');
    const h = agentrouterHeaders('sk-x');
    ok('agentrouter header sidik jari', h['x-app'] === 'cli' && /claude-code-20250219/.test(h['anthropic-beta']) && h['Authorization'] === 'Bearer sk-x' && h['x-api-key'] === 'sk-x');
    const sc = sanitizeTestCfg({ provider: 'agentrouter', agentrouterKey: 'k', agentrouterModel: 'm', agentrouterUrl: 'u' });
    eq('sanitize agentrouter lolos', [sc.provider, sc.agentrouterKey, sc.agentrouterModel], ['agentrouter', 'k', 'm']);
  }

  /* 9. v0.8.5: extractor content array + error AgentRouter */
  {
    const extractCompletionText = G('extractCompletionText');
    const agentrouterFriendlyError = G('agentrouterFriendlyError');
    eq('extractor message.content array', extractCompletionText({ choices: [{ message: { content: [{ type: 'text', text: 'TES ' }, { type: 'text', text: 'VISION' }] } }] }), 'TES VISION');
    eq('extractor delta.content array', extractCompletionText({ choices: [{ delta: { content: [{ type: 'text', text: 'x' }] } }] }), 'x');
    const friendly = agentrouterFriendlyError(new Error('HTTP 400: content-blocked (request id: abc)'));
    ok('content-blocked jadi penjelasan', /filter konten di sisi AgentRouter/.test(friendly.message));
    const passthrough = agentrouterFriendlyError(new Error('HTTP 500: lain'));
    eq('error lain diteruskan apa adanya', passthrough.message, 'HTTP 500: lain');
  }

  fetchImpl = null;
}

main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
