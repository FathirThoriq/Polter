/* Polter - test v0.8.5: koordinasi frame, izin situs, UI kaca (Node).
   Menguji pickWinningFrame dari background.js yang sebenarnya +
   konsistensi manifest/CSS/options. Interaksi frame sungguhan butuh
   browser; lihat tests/manual-autofill.html untuk uji manual.
   Jalankan: node tests/test-frames-ui.js
*/
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}
function eq(name, a, b) {
  ok(name, JSON.stringify(a) === JSON.stringify(b), 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function extract(name, source) {
  let i = source.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fungsi tidak ditemukan: ' + name);
  if (source.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0;
  const j = source.indexOf('{', i);
  for (let k = j; k < source.length; k++) {
    if (source[k] === '{') depth++;
    else if (source[k] === '}') { depth--; if (!depth) return source.slice(i, k + 1); }
  }
  throw new Error('kurung tidak seimbang: ' + name);
}

const bgSrc = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const contentSrc = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
eval(extract('pickWinningFrame', bgSrc));

eq('pemenang = soal terbanyak', pickWinningFrame([{ frameId: 0, count: 2 }, { frameId: 3, count: 9 }]), 3);
eq('seri -> frame utama', pickWinningFrame([{ frameId: 5, count: 4 }, { frameId: 0, count: 4 }]), 0);
eq('kosong -> 0', pickWinningFrame([]), 0);
eq('semua nol -> frame utama', pickWinningFrame([{ frameId: 2, count: 0 }, { frameId: 0, count: 0 }]), 0);
ok('background menangani laporan frame', bgSrc.includes("'frame-detect-report'"));
ok('background menyiarkan probe', bgSrc.includes('jawab-detect-probe'));
ok('injeksi fallback semua frame', bgSrc.includes('allFrames: true'));

ok('content menjawab probe', contentSrc.includes('jawab-detect-probe'));
ok('content menampilkan panel saat present', contentSrc.includes('jawab-detect-present'));
ok('tombol mengambang hanya frame utama', contentSrc.includes('IS_TOP'));
ok('isi memakai pindai segar', contentSrc.includes('function rescanForFill()'));
ok('scan mengenali role radio/checkbox', contentSrc.includes('[role="radio"], [role="checkbox"]'));
ok('fill mendukung elemen kustom', contentSrc.includes('item.customEls'));

/* UI kaca ala Apple: transparan + blur, tanpa biru mencolok lama */
ok('css memakai backdrop-filter', contentSrc.includes('backdrop-filter:blur(22px)'));
ok('css panel kaca gelap monokrom', contentSrc.includes('rgba(14,14,16,.84)'));
ok('css tanpa indigo lama', !contentSrc.includes('#4f46e5'));
ok('css punya varian dark', contentSrc.includes('prefers-color-scheme: dark'));
/* v0.5.1: tombol polos abu tanpa glif + takeover UI lama + kartu jawaban */
ok('tab hantu nyaris tak terlihat', contentSrc.includes('rgba(120,120,128,.06)') && contentSrc.includes('rgba(128,128,136,.30)'));
ok('tab berisi maskot hantu', contentSrc.includes('jghost-eye'));
ok('tanpa glif gunting', !contentSrc.includes('\\u2702'));
ok('tanpa glif kaca pembesar', !contentSrc.includes('\\uD83D\\uDD0D'));
ok('takeover membersihkan host lama', contentSrc.includes("querySelectorAll('#jawab-host')"));
ok('scan kartu jawaban', contentSrc.includes('Kartu jawaban klik'));
ok('kartu jawaban menyaring label UI', contentSrc.includes('UI_LABEL'));
/* v0.5.2: detektor Wayground hasil inspeksi DOM + pindai tahan error */
ok('detektor baris radio visual', contentSrc.includes('[class*="circle" i]'));
ok('detektor ubin question-option', contentSrc.includes('[data-testid="question-option"]'));
ok('detektor kartu mcq', contentSrc.includes('[data-testid="mcq"]'));
ok('pindai per bagian tahan error', contentSrc.includes('const section = (fn)'));
ok('error pindai ditampilkan', contentSrc.includes('lastScanError'));
/* v0.5.3: grup radio per kontainer + verifikasi klik kustom */
ok('grup radio dipisah kontainer', contentSrc.includes('groupContainerKey'));
ok('input tersembunyi berlabel diterima', contentSrc.includes('inputUsable'));
ok('klik kustom diverifikasi state', contentSrc.includes('stateSig'));
ok('klik kustom tidak lagi sukses buta', !contentSrc.includes("return ac ? ac === 'true' : true;"));
/* v0.6.0: tab tepi + menu + filter soal + Auto Answer */
ok('tab tepi kiri tunggal', contentSrc.includes('function initEdgeTab()') && contentSrc.includes('initEdgeTab();'));
ok('dua tombol lama tidak lagi dipasang', !contentSrc.includes('initDetectBtn();'));
ok('panel menu utama', contentSrc.includes('function buildMenuBody(body)'));
ok('menu ekstrak foto', contentSrc.includes('Ekstrak dari Foto'));
ok('menu deteksi soal', contentSrc.includes('Deteksi Soal di Layar'));
ok('filter soal', contentSrc.includes('function looksLikeQuestion(item)'));
ok('auto answer engine', contentSrc.includes('function autoCycle()') && contentSrc.includes('function setAutoAnswer('));
ok('auto answer persisten', contentSrc.includes('jawabAutoAnswer'));
ok('auto answer berhenti sendiri', contentSrc.includes('autoAskSettled'));
/* v0.7.0: provider Gemini dihapus atas keputusan pemilik */
ok('background tanpa provider gemini', !bgSrc.includes("case 'gemini'") && !bgSrc.includes('generativelanguage.googleapis.com'));

const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
eq('manifest versi 0.8.8', man.version, '0.8.8');
eq('manifest bernama Polter', man.name, 'Polter');
ok('manifest tanpa identity', !man.permissions.includes('identity'));
ok('manifest tanpa host googleapis', !(man.host_permissions || []).some((h) => h.includes('googleapis')));
eq('content script all_frames', man.content_scripts[0].all_frames, true);

const optSrc = fs.readFileSync(path.join(ROOT, 'options.js'), 'utf8');
const optHtml = fs.readFileSync(path.join(ROOT, 'options.html'), 'utf8');
ok('options punya tombol izin situs', optHtml.includes('id="grantSiteAccess"'));
ok('options tanpa kartu gemini', !optHtml.includes('data-p="gemini"'));
ok('options tanpa login google', !optSrc.includes('launchWebAuthFlow'));
ok('options meminta izin origins situs', optSrc.includes("chrome.permissions.request({ origins: SITE_ORIGINS })"));

/* v0.8.5: regresi review - jawaban dianggap soal, lambat, desain menu */
function extractFn(name, source) {
  let i = source.indexOf('function ' + name + '(');
  if (i === -1) return null;
  let depth = 0, start = source.indexOf('{', i);
  for (let j = start; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(i, j + 1); }
  }
  return null;
}
eval(extractFn('normText', contentSrc));
eval(extractFn('normMatch', contentSrc));
eval(extractFn('looksLikeQuestion', contentSrc));
ok('filter: soal normal lolos', looksLikeQuestion({ question: 'Which of these numbers is a rational number?', type: 'radio', options: ['0.5', 'pi', 'e', 'sqrt(2)'] }) === true);
ok('filter: "soal" yang = salah satu pilihan ditolak', looksLikeQuestion({ question: 'Integer and rational numbers', type: 'radio', options: ['Integer and rational numbers', 'Natural numbers', 'Whole numbers', 'Irrational numbers'] }) === false);
ok('filter: blob soal+pilihan ditolak', looksLikeQuestion({ question: 'Pilih jawaban: Alpha Beta Gamma', type: 'radio', options: ['Alpha', 'Beta', 'Gamma', 'Delta'] }) === false);
ok('filter: blok tanya lolos', looksLikeQuestion({ question: 'Mengapa langit berwarna biru?', type: 'block', options: [] }) === true);
ok('background: fallback non-SSE', bgSrc.includes('content-type') && bgSrc.includes('Respons provider tidak bisa dibaca'));
ok('background: idle stream 90 detik', bgSrc.includes('90000'));
ok('background: fallback JSON by content-type', bgSrc.includes("ctype.indexOf('json')"));
ok('content: render streaming di-throttle', contentSrc.includes('function scheduleRender()'));
ok('content: menu persis demo (ikon+switch)', contentSrc.includes('jmenu-ic') && contentSrc.includes('jswitch') && contentSrc.includes('autoFootText'));
ok('content: header panel berubin hantu', contentSrc.includes('jhead-ic') && contentSrc.includes('jhead-sub'));
ok('content: saringan lintas item', contentSrc.includes('allOptNorms'));
ok('content: fallback ancestor teks murni', contentSrc.includes('wadah teks murni'));

/* v0.8.5: auto-jawab, prompt ramping, pilihan gambar, tab redup */
eval(extractFn('matchOption', contentSrc));
eq('matchOption huruf opsi', matchOption('B', ['Alpha', 'Beta', 'Gamma']), 1);
eq('matchOption "Gambar C"', matchOption('Gambar C', ['Gambar A', 'Gambar B', 'Gambar C']), 2);
eq('matchOption angka posisi (gambar)', matchOption('2', ['Gambar A', 'Gambar B'], true), 1);
eq('matchOption angka isi (teks, tanpa flag)', matchOption('2', ['satu', 'dua', 'tiga']), -1);
eq('matchOption teks persis tetap utama', matchOption('dua', ['satu', 'dua', 'tiga']), 1);
ok('potret langsung dijawab', contentSrc.includes('pendingImageAutoAsk'));
ok('deteksi langsung dijawab', contentSrc.includes("if (detected.length) startAsk({ question: '', action: 'autofill' })"));
ok('tombol Jawab Semua dibuang, Pindai Ulang tetap', !contentSrc.includes("'Jawab Semua dengan AI'") && contentSrc.includes('Pindai Ulang'));
ok('lampiran kartu bergambar', contentSrc.includes('attachCardImageIfNeeded') && contentSrc.includes("type: 'capture-blob'"));
ok('background capture-blob', bgSrc.includes('handleCaptureBlob'));
ok('background lampiran ke runTextAsk', bgSrc.includes('userContentOpenAI') && bgSrc.includes('attachImageId'));
ok('prompt autofill ramping', bgSrc.includes('Jawab semua soal JSON ini') && !bgSrc.includes('machine learning / pengisian data'));

/* v0.8.5: error screenshot jujur + nama Polter di pesan */
ok('capture menampilkan detail error asli', bgSrc.includes('Detail browser:'));
ok('capture retry sekali', bgSrc.includes('attempt < 2'));
ok('tidak ada sisa nama lama di pesan error capture', !bgSrc.includes('klik ikon Jawab'));

/* v0.8.6: radio sembunyikan tab hantu + shortcut panggil menu */
ok('manifest: command toggle-menu Alt+Shift+M', !!(man.commands && man.commands['toggle-menu'] && man.commands['toggle-menu'].suggested_key && man.commands['toggle-menu'].suggested_key.default === 'Alt+Shift+M'));
ok('background: ui-pref memuat jawabTabVisible', bgSrc.includes('jawabTabVisible'));
ok('background: command toggle-menu diteruskan ke tab', bgSrc.includes("'jawab-toggle-menu'"));
ok('background: siaran perubahan visibilitas tab', bgSrc.includes('jawab-tab-visibility') && bgSrc.includes('storage.onChanged'));
ok('content: toggle menu via shortcut', contentSrc.includes('jawab-toggle-menu') && contentSrc.includes("openPanel('menu', null)"));
ok('content: applyTabVisibility menghapus tab', contentSrc.includes('applyTabVisibility') && contentSrc.includes('edgeBtn.remove()'));
ok('content: init membaca preferensi tab', contentSrc.includes('loadTabVisibility'));
ok('options: radio tabmode + status', optHtml.includes('name="tabmode"') && optHtml.includes('id="tabHide"') && optSrc.includes('jawabTabVisible'));

/* v0.8.7: radio tab hantu juga ada di panel menu */
ok('panel menu: radio jtabmode', contentSrc.includes("inp.name = 'jtabmode'"));
ok('panel menu: radio menulis ui-pref-set tabVisible', contentSrc.includes("type: 'ui-pref-set', tabVisible: visible"));
ok('panel menu: pilihan Tampilkan/Sembunyikan', contentSrc.includes("mkRadio('Tampilkan', true)") && contentSrc.includes("mkRadio('Sembunyikan', false)"));

/* v0.8.8: mode sembunyi = nol tombol mengambang + shortcut Alt+Shift+M */
ok('mode sembunyi: pil seleksi digerbang tabVisible', contentSrc.includes('if (!tabVisible) return;'));
ok('mode sembunyi: semua tombol dihapus total', contentSrc.includes('nol tombol mengambang') && contentSrc.includes('cutBtn.remove()') && contentSrc.includes('detectBtn.remove()'));

/* v0.8.5: probe longgar + AgentRouter terpasang */
ok('probe tanpa max_tokens kecil', !bgSrc.includes('max_tokens: 16') && !bgSrc.includes('max_tokens: 64,'));
ok('agentrouter: transport + DNR UA', bgSrc.includes('streamAgentRouter') && bgSrc.includes('updateSessionRules') && bgSrc.includes('claude-cli/2.1.114'));
ok('agentrouter: kartu + field options', optHtml.includes('data-p="agentrouter"') && optSrc.includes('f-agentrouterKey'));

console.log('\n' + passed + ' lulus, ' + failed + ' gagal');
process.exit(failed ? 1 : 0);
