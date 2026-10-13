/* Jawab - test renderer markdown DOM v0.4.0 (Node, stub DOM minimal).
   Memastikan renderMd/appendInline dari content.js:
   - menghasilkan struktur p/b/code/li/pre yang benar,
   - TIDAK PERNAH menyuntikkan markup dari teks AI (tag script jadi teks),
   - fenced code dipertahankan utuh sebagai teks.
   Jalankan: node tests/test-rendermd.js
*/
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}

/* ---- stub DOM minimal ---- */
function makeEl(tag) {
  return {
    tag, children: [], _text: '',
    set textContent(v) { this._text = String(v); this.children = []; },
    get textContent() { return this._text + this.children.map((c) => c.textContent || c.text || '').join(''); },
    appendChild(c) { this.children.push(c); return c; },
    replaceChildren() { this.children = []; this._text = ''; }
  };
}
global.document = {
  createElement: (t) => makeEl(t),
  createTextNode: (s) => ({ text: String(s), textContent: String(s) })
};

function extract(name, source) {
  const i = source.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fungsi tidak ditemukan: ' + name);
  let depth = 0;
  const j = source.indexOf('{', i);
  for (let k = j; k < source.length; k++) {
    if (source[k] === '{') depth++;
    else if (source[k] === '}') { depth--; if (!depth) return source.slice(i, k + 1); }
  }
  throw new Error('kurung tidak seimbang: ' + name);
}

const contentSrc = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
eval(extract('appendInline', contentSrc));
eval(extract('renderMd', contentSrc));

const c = makeEl('div');
renderMd(c, 'Halo **tebal** dan `kode`\n\n## Judul\n- satu\n2. dua\n```\nconst x = "<b>";\n```\n<script>alert(1)</script>');

ok('struktur blok benar',
  JSON.stringify(c.children.map((e) => e.tag)) === JSON.stringify(['p', 'p', 'li', 'li', 'pre', 'p']),
  JSON.stringify(c.children.map((e) => e.tag)));
ok('tag script dari teks AI jadi teks, bukan elemen',
  !c.children.some((e) => e.tag === 'script') && c.textContent.includes('<script>alert(1)</script>'));
ok('inline bold ter-render',
  c.children[0].children.some((n) => n.tag === 'b' && n.textContent === 'tebal'));
ok('inline code ter-render',
  c.children[0].children.some((n) => n.tag === 'code' && n.textContent === 'kode'));
ok('fenced code utuh sebagai teks',
  c.children[4].children[0].textContent.includes('const x = "<b>";'));
ok('content.js tanpa assignment innerHTML', !/\.innerHTML\s*=/.test(contentSrc));

console.log('\n' + passed + ' lulus, ' + failed + ' gagal');
process.exit(failed ? 1 : 0);
