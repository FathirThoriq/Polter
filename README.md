<p align="center">
  <img src="icons/icon128.png" alt="Polter" width="128" height="128">
</p>

<h1 align="center">Polter</h1>

<p align="center"><b>Polter: Unseen, Unheard, Done.</b></p>

<p align="center">
  Asisten hantu untuk soal-soal di browsermu — bersembunyi di tepi layar,
  membaca soal dari halaman, layar, atau gambar, lalu menjawab &amp; mengisinya untukmu.
</p>

<p align="center">
  <img alt="Versi" src="https://img.shields.io/badge/versi-0.8.8-black">
  <img alt="Manifest V3" src="https://img.shields.io/badge/manifest-V3-black">
  <img alt="Firefox dan Chrome" src="https://img.shields.io/badge/browser-Firefox%20%7C%20Chrome-black">
  <img alt="Vanilla JS" src="https://img.shields.io/badge/vanilla-JS%20tanpa%20build-black">
  <img alt="Lisensi MIT" src="https://img.shields.io/badge/lisensi-MIT-black">
</p>

---

## Apa itu Polter?

**Polter** adalah ekstensi browser (Manifest V3) yang membantu menjawab soal dan formulir langsung dari halaman yang sedang kamu buka. Ia bekerja seperti hantu: menempel sebagai **tab tipis nyaris transparan di tepi kiri layar** — hanya berisi maskot hantu, tanpa teks, tanpa cahaya mencolok — dan muncul hanya saat dipanggil.

Polter bisa:

- **Mendeteksi soal langsung dari struktur halaman (DOM)** — tanpa perlu memotret layar — lalu menjawab dan **mengisi jawabannya kembali ke halaman** (pilihan ganda, checkbox, select, isian teks/angka).
- **Membaca soal dari potret area layar** — untuk soal yang dirender sebagai gambar/canvas atau terkunci di dalam tampilan yang tidak bisa dibaca DOM-nya.
- **Menjawab soal berseleksi teks** dan menyimpan potongan teks/kode/gambar ke **Library lokal**.
- **Auto Answer**: memantau halaman, lalu menjawab & mengisi sendiri setiap soal baru yang muncul — tetap aktif saat pindah soal maupun pindah halaman.

Satu prinsip yang tidak pernah dilanggar: **Polter tidak pernah menekan tombol kirim/submit final.** Pengiriman selalu olehmu, setelah kamu memeriksa jawabannya. Field password juga tidak pernah disentuh.

📺 **Video penjelasan:** [docs/polter-penjelasan-v2.mp4](docs/polter-penjelasan-v2.mp4)

## Fitur

| Fitur | Keterangan |
|---|---|
| **Deteksi Soal di Layar** | Memindai soal/formulir dari DOM dengan filter ketat (hanya blok yang benar-benar soal yang diteruskan ke AI — jawaban tidak akan tertukar dianggap soal). |
| **Ekstrak dari Foto** | Seret untuk memilih area soal di layar; gambar dibaca AI vision lalu dijawab. Cocok untuk soal bergambar, diagram, dan grafik. Pilihan jawaban yang berupa gambar ikut dilampirkan sebagai konteks. |
| **Auto Answer** | Soal baru yang tampil otomatis dijawab & diisi. Berhenti sendiri setelah 3 kali gagal beruntun. |
| **Mode Sembunyi Total** | Radio *Tab Hantu* (di panel menu & Pengaturan) bisa menghilangkan seluruh tombol mengambang dari layar — bukan sekadar transparan, elemennya benar-benar dihapus. Panggil menu lagi kapan pun dengan shortcut. |
| **Seleksi teks** | Blok teks apa pun → pil *Polter* → Jelaskan / Ringkas / Terjemahkan / Ekstrak / Jawab, atau simpan ke Library. |
| **Library lokal** | Snippet teks/kode/gambar tersimpan lokal (IndexedDB): cari, filter, favorit, edit, ekspor/impor JSON. Bekerja offline tanpa API key. |
| **Banyak jalan ke AI** | 5 provider: Custom/9Router lokal, OpenAI, Anthropic, Muse (Meta), dan AgentRouter (lihat bagian Pengaturan). |
| **Streaming** | Jawaban tampil mengalir token demi token, dirender sebagai Markdown. |

## Dibuat dari apa

Polter ditulis dengan **JavaScript vanilla murni** — tanpa framework, tanpa bundler, tanpa langkah build. File yang ada di repo ini persis file yang dimuat browser.

| Bagian | Teknologi / pendekatan |
|---|---|
| Platform | WebExtensions **Manifest V3** (Firefox ≥ 140 & Chrome) |
| Bahasa | JavaScript (ES2020+), HTML, CSS — tanpa dependensi runtime |
| UI di halaman | Satu host **Shadow DOM** terisolasi; panel kaca gelap monokrom; tab tepi 26×56 px berisi SVG maskot hantu |
| Background | Service worker (Chrome) / event page scripts (Firefox), komunikasi via `runtime` message + port streaming |
| Penyimpanan | `chrome.storage.local` untuk pengaturan & preferensi, **IndexedDB** untuk Library dan draft gambar |
| Jaringan AI | `fetch` streaming (SSE) dengan fallback JSON utuh untuk endpoint non-streaming (mis. gateway lokal); timeout idle longgar untuk model reasoning |
| Kasus khusus | `declarativeNetRequest` dipakai untuk menulis ulang User-Agent khusus domain AgentRouter (lihat catatan provider) |
| Tes | 195 pengujian Node.js (`tests/`, tanpa browser) mencakup parser streaming, deteksi soal, autofill, dan konsistensi UI/manifest |

Struktur berkas:

```
├── manifest.json     # definisi ekstensi, perintah shortcut, izin
├── background.js     # logika AI (5 provider), screenshot, orkestrasi antar-frame
├── content.js        # UI di halaman: tab hantu, panel, deteksi soal, autofill, Auto Answer
├── defaults.js       # nilai default pengaturan bersama
├── storage.js        # lapisan penyimpanan (Library, draft) berbasis IndexedDB
├── options.html/js   # halaman Pengaturan (provider, kredensial, tombol hantu, izin situs)
├── library.html/js   # halaman Library snippet
├── icons/            # maskot hantu 16/48/128
├── tests/            # suite tes Node + fixture manual
└── docs/             # video penjelasan
```

## Instalasi

### Dari rilis (ZIP)

Unduh ZIP sesuai browsermu dari halaman **Releases**, ekstrak ke sebuah folder tetap (jangan dihapus — browser memuat dari folder itu).

### Google Chrome / Chromium

1. Buka `chrome://extensions`, aktifkan **Developer mode** (kanan atas).
2. Klik **Load unpacked**, pilih folder hasil ekstrak (atau folder repo ini setelah clone).
3. Polter langsung aktif. Buka halaman mana pun — tab hantu muncul di tepi kiri layar.

### Mozilla Firefox

Cara cepat (sesi sementara, hilang saat browser ditutup):

1. Buka `about:debugging#/runtime/this-firefox`.
2. Klik **Load Temporary Add-on…**, pilih file `manifest.json` di folder ekstensi.

Cara permanen: paket harus ditandatangani Mozilla (AMO) atau dipasang lewat kanal Developer Edition/Nightly dengan `xpinstall.signatures.required=false`. Di halaman **Pengaturan → Izin akses situs**, klik **Aktifkan izin semua situs** sekali agar tab hantu muncul di semua situs http/https (termasuk soal di dalam iframe).

### Dari sumber

```bash
git clone https://github.com/FathirThoriq/polter.git
cd polter
# muat folder ini sebagai unpacked extension (Chrome) / temporary add-on (Firefox)
```

## Penggunaan

1. **Buka halaman soal/formulir** (platform kuis, LMS, Google Forms, dsb.).
2. Klik **tab hantu** di tepi kiri → panel menu terbuka:
   - **Ekstrak dari Foto** — panel menghilang, seret area soal, Polter membaca gambarnya lalu langsung menjawab.
   - **Deteksi Soal di Layar** — Polter memindai halaman, hanya soal yang lolos filter yang dijawab & langsung diisi.
   - **Auto Answer** (sakelar) — soal baru yang muncul berikutnya dijawab & diisi sendiri.
   - **Tab Hantu** (radio) — *Tampilkan* / *Sembunyikan* seluruh tombol mengambang.
3. **Periksa jawaban yang terisi**, lalu kirim/submit sendiri bila sudah benar.
4. Sembunyikan tab? Panggil menu kapan pun dengan **`Alt+Shift+M`** (tekan lagi untuk menutup).

### Pintasan keyboard

| Shortcut | Fungsi |
|---|---|
| `Alt+Shift+D` | Deteksi soal di halaman |
| `Alt+Shift+S` | Potret area (Ekstrak dari Foto) |
| `Alt+Shift+L` | Buka Library |
| `Alt+Shift+M` | Tampilkan/sembunyikan menu Polter |

Semua shortcut bisa diganti di `chrome://extensions/shortcuts` (Chrome) atau `about:addons` → Polter → Preferences (Firefox).

## Pengaturan provider AI

Di halaman **Pengaturan**, pilih satu provider lalu isi kredensialnya. Tombol **Tes koneksi** dan **Tes vision** memverifikasi key + modelmu sebelum dipakai.

| Provider | Yang dibutuhkan | Catatan |
|---|---|---|
| **Custom** | Base URL + API key + ID model | Endpoint kompatibel OpenAI apa pun — termasuk **9Router lokal** (`http://localhost:20128/v1`). |
| **OpenAI** | API key dari platform.openai.com | Default `gpt-4o-mini`, mendukung vision. |
| **Anthropic** | API key dari console.anthropic.com | Default `claude-sonnet-5`, mendukung vision. |
| **Muse (Meta)** | Mode **Model API** (key `LLM|…` dari dev.meta.ai) atau **Muse Bridge** (endpoint bridge milikmu sendiri + token) | Model API masih pratinjau terbatas region; Bridge bersifat teks saja. Tidak ada mode "login Meta" — Meta memang tidak membuka OAuth Muse konsumen untuk pihak ketiga. |
| **AgentRouter** | API key AgentRouter | Gateway ini menolak klien yang tidak tampak seperti Claude Code, jadi Polter meniru sidik jari klien resminya (header bergaya Claude Code + User-Agent via `declarativeNetRequest`, khusus domain agentrouter.org). Error `content-blocked` berasal dari filter konten AgentRouter sendiri — tunggu ±1 menit, parafrase isi soal, dan pastikan model termasuk paket key-mu. |

> Seluruh API key tersimpan **lokal di browser ini saja** (bukan vault terenkripsi) — siapa pun yang memegang perangkat bisa membacanya. Jangan pakai di perangkat bersama.

## Privasi & batasan

- Teks soal/gambar hanya dikirim ke provider AI **yang kamu pilih dan saat kamu memintanya** (atau saat Auto Answer aktif). Tidak ada server perantara milik Polter dan tidak ada telemetri.
- Polter **tidak pernah** men-submit formulir, tidak menyentuh field password/hidden/file, dan tidak berjalan di halaman internal browser (`about:`/`chrome:`).
- Halaman pratinjau baca-saja (mis. *Content View* guru di Wayground) memang tidak menerima klik menurut desain platformnya — pengisian nyata terjadi di tampilan siswa/sesi bermain.

## Pengembangan

Tidak ada langkah build. Untuk menjalankan tes (Node.js ≥ 18):

```bash
cd tests
node run-tests.js        # suite inti (parser, provider, storage)
node test-autofill.js    # deteksi & pengisian formulir
node test-frames-ui.js   # koordinasi frame, manifest, UI
node test-muse.js        # provider Muse
node test-rendermd.js    # renderer Markdown
```

Total **195 tes** — semuanya harus hijau sebelum rilis. Riwayat perubahan lengkap ada di [CHANGELOG.md](CHANGELOG.md), catatan pengujian manual di [TESTING.md](TESTING.md).

## Lisensi

[MIT](LICENSE) © 2026 Fathir Thoriq.

Gunakan dengan bijak dan sesuai aturan platform serta institusimu — Polter adalah alat bantu, keputusan akhir (termasuk menekan tombol kirim) selalu milikmu.
