/* Jawab - test logika autofill v0.4.0 (Node, tanpa DOM/browser).
   Menguji fungsi murni yang sebenarnya dari content.js (parseAnswers,
   matchOption) dan background.js (buildTextPrompt aksi 'autofill')
   dengan mengekstrak source-nya, plus konsistensi manifest.
   Scan DOM & pengisian field butuh halaman nyata: lihat
   tests/manual-autofill.html (sajikan via http server lokal).
   Jalankan: node tests/test-autofill.js
*/
/* TANPA 'use strict' di file ini: eval() di bawah perlu mendefinisikan
   fungsi hasil ekstraksi ke scope modul (eval strict punya scope sendiri). */
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
const bgSrc = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
eval(extract('normText', contentSrc));
eval(extract('normMatch', contentSrc));
eval(extract('parseAnswers', contentSrc));
eval(extract('matchOption', contentSrc));
eval(extract('buildTextPrompt', bgSrc));

/* parseAnswers: JSON murni */
eq('parse json murni',
  parseAnswers('[{"index":0,"answer":"Jakarta"},{"index":1,"answer":"4"}]'),
  { 0: 'Jakarta', 1: '4' });

/* parseAnswers: JSON di dalam code fence + teks pengantar */
eq('parse json fenced',
  parseAnswers('Berikut jawabannya:\n```json\n[{"index":2,"answer":"Merah"}]\n```'),
  { 2: 'Merah' });

/* parseAnswers: fallback baris bernomor */
eq('parse fallback bernomor',
  parseAnswers('1. Jakarta\n2. Empat'),
  { 0: 'Jakarta', 1: 'Empat' });

/* parseAnswers: sampah -> kosong (bukan tebakan) */
eq('parse sampah kosong', parseAnswers('tidak ada jawaban terstruktur'), {});

/* matchOption: exact, contains, tidak ada */
eq('match exact', matchOption('jakarta', ['Bandung', 'Jakarta', 'Surabaya']), 1);
eq('match contains', matchOption('Pilihan: Jakarta', ['Bandung', 'Jakarta']), 1);
eq('match tidak ada', matchOption('Medan', ['Bandung', 'Jakarta']), -1);

/* buildTextPrompt aksi autofill */
{
  const payload = JSON.stringify({ questions: [{ index: 0, question: 'Ibu kota?', type: 'text', options: [] }] });
  const p = buildTextPrompt(payload, 'autofill', '', false, '');
  ok('prompt autofill menuntut JSON saja', p.includes('Balas HANYA JSON array'));
  ok('prompt autofill memuat konten utuh', p.includes(payload));
  ok('prompt autofill menyebut aturan opsi', p.includes('satu teks options, persis'));
}

/* manifest: versi + command deteksi */
{
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  ok('manifest versi 0.8.8', man.version === '0.8.8', man.version);
  ok('manifest punya command detect-questions', !!(man.commands && man.commands['detect-questions']));
  ok('content.js memuat startDetectDraft', contentSrc.includes('function startDetectDraft()'));
  ok('content.js memuat fillDetected', contentSrc.includes('function fillDetected('));
  ok('content.js tidak pernah submit form', !/\.submit\s*\(/.test(contentSrc.replace(/\/\*[\s\S]*?\*\//g, '')));
  ok('background memuat aksi autofill', bgSrc.includes("case 'autofill':"));
  ok('background importScripts dijaga typeof (Firefox event page)',
    bgSrc.includes("typeof importScripts === 'function'"));
}

console.log('\n' + passed + ' lulus, ' + failed + ' gagal');
process.exit(failed ? 1 : 0);
