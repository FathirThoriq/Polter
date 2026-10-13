/* Jawab - test provider Muse (Meta) v0.4.3 (Node, tanpa browser).
   Menguji museEndpoint + providerTarget dari background.js yang
   sebenarnya, konsistensi defaults, opsi UI, dan manifest.
   Request sungguhan ke api.meta.ai / bridge butuh key/token milik
   pengguna; tidak diuji di sini.
   Jalankan: node tests/test-muse.js
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

eval(fs.readFileSync(path.join(ROOT, 'defaults.js'), 'utf8'));
const bgSrc = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
eval(extract('museEndpoint', bgSrc));
eval(extract('providerTarget', bgSrc));

/* mode api */
eq('api endpoint', museEndpoint({ museMode: 'api', museApiKey: 'LLM|1|secret', museModel: 'muse-spark-1.2' }),
  { url: 'https://api.meta.ai/v1', key: 'LLM|1|secret', model: 'muse-spark-1.2' });
{
  let msg = '';
  try { museEndpoint({ museMode: 'api', museApiKey: '', museModel: 'muse-spark-1.2' }); } catch (e) { msg = e.message; }
  ok('api tanpa key ditolak', /API key Meta Model API belum diisi/.test(msg), msg);
}
/* mode bridge */
eq('bridge endpoint', museEndpoint({
  museMode: 'bridge', museBridgeUrl: 'https://bridge.contoh.id/v1',
  museBridgeKey: 'tok', museBridgeModel: 'muse-spark-1.3'
}), { url: 'https://bridge.contoh.id/v1', key: 'tok', model: 'muse-spark-1.3' });
{
  let msg = '';
  try { museEndpoint({ museMode: 'bridge', museBridgeUrl: '', museBridgeKey: '', museBridgeModel: 'x' }); } catch (e) { msg = e.message; }
  ok('bridge tanpa URL ditolak', /URL Muse Bridge belum diisi/.test(msg), msg);
}
/* providerTarget memilih model sesuai mode */
eq('target api', providerTarget({ provider: 'muse', museMode: 'api', museModel: 'muse-spark-1.2' }).model, 'muse-spark-1.2');
eq('target bridge', providerTarget({ provider: 'muse', museMode: 'bridge', museBridgeModel: 'muse-spark-1.3' }).model, 'muse-spark-1.3');

/* defaults + UI + manifest */
ok('defaults muse lengkap', JAWAB_DEFAULTS.museMode === 'api' &&
  JAWAB_DEFAULTS.museModel === 'muse-spark-1.2' &&
  JAWAB_DEFAULTS.museBridgeModel === 'muse-spark-1.3' &&
  typeof JAWAB_DEFAULTS.museApiKey === 'string');
ok('url API resmi', JAWAB_MUSE_API_URL === 'https://api.meta.ai/v1');
{
  const optSrc = fs.readFileSync(path.join(ROOT, 'options.js'), 'utf8');
  const optHtml = fs.readFileSync(path.join(ROOT, 'options.html'), 'utf8');
  ok('options punya kartu muse', optHtml.includes('data-p="muse"'));
  ok('options punya field muse', optSrc.includes('f-museApiKey') && optSrc.includes('f-museBridgeUrl'));
  ok('sanitize menerima provider muse', bgSrc.includes("'anthropic', 'muse'"));
}
{
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  eq('manifest versi 0.8.8', man.version, '0.8.8');
  ok('manifest host api.meta.ai', man.host_permissions.includes('https://api.meta.ai/*'));
  /* Muse Spark = model reasoning: token berpikir dihitung sebagai output,
     jadi probe max_tokens kecil menghasilkan konten kosong (bug v0.4.2). */
  ok('probe muse max_tokens besar', (bgSrc.match(/model: ep\.model, max_tokens: 1024/g) || []).length === 2);
  ok('pesan vision sadar mode', bgSrc.includes("cfg.museMode === 'bridge'"));
}

console.log('\n' + passed + ' lulus, ' + failed + ' gagal');
process.exit(failed ? 1 : 0);
