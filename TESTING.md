# TESTING.md — Jawab v0.3.0

## Cara menjalankan regression test

```bash
cd jawab
node tests/run-tests.js
```

Hasil saat rilis: **45 lulus, 0 gagal**. Tidak menghubungi provider asli mana pun; semua network di-mock. Ini **bukan** pengganti uji end-to-end di Chrome.

## Yang diuji otomatis (mock)

| # | Area | Kasus |
|---|---|---|
| 1 | SSE OpenAI | chunk terpotong antar read, CRLF, multibyte UTF-8 terbelah, `[DONE]` |
| 2 | SSE OpenAI | stream berakhir tanpa `[DONE]` → error incomplete, bukan sukses; token parsial tetap ada |
| 3 | SSE Anthropic | `content_block_delta` → token; `event: error` (overloaded) dipropagasi sebagai error |
| 4 | Timeout | connect timeout 30 dtk → pesan jelas |
| 5 | Timeout | idle stream (body macet) → timeout, tidak menggantung |
| 6 | Abort | sinyal eksternal (Stop) → "Request dibatalkan" |
| 7 | Crop | DPR 2, zoom (viewport CSS mengecil), clamp tepi, tolak NaN |
| 8 | Whitespace | indentasi/tab/newline akhir utuh di prompt |
| 9 | Util | normalisasi base URL (tidak ganda `/chat/completions`), tanpa `Authorization` kosong, tolak sender asing |
| 10 | Port e2e | chunk + done dengan requestId konsisten; Stop → error dibatalkan |
| 11 | Import | valid; tolak schemaVersion; tolak field kredensial; tolak MIME SVG; tolak konten raksasa |
| 12 | Capture | crop tersimpan sebagai draft + thumbnail; blob adalah crop (bukan full viewport); sourceUrl valid |
| 13 | ask-snippet | dari halaman extension: hanya crop yang dikirim ke provider (full viewport tidak ikut); meta provider/model |
| 14 | ask-snippet | dari origin web → ditolak |
| 15 | ui-pref | hanya field allowlist (posisi tombol); tidak membocorkan key; field asing diabaikan |
| 16 | save-text | whitespace tersimpan identik |
| 17 | Pesan | tipe tak dikenal ditolak (tidak ada arbitrary-fetch proxy) |

## Checklist manual (belum terotomatisasi — lakukan di Chrome asli)

- [ ] Load unpacked: tanpa syntax error, missing asset, CSP inline-handler error, unhandled rejection.
- [ ] Seleksi teks/kode: Simpan → muncul di Library identik (cek spasi/tab/newline). Salin → paste identik.
- [ ] Screenshot: ESC saat drag → tidak ada popup/request. Potret → preview muncul tanpa API key. Simpan/Unduh berfungsi.
- [ ] Request AI: Stop menghentikan; tutup popup menghentikan; jawaban streaming tampil bertahap (OpenAI/Anthropic/Custom); Gemini datang sekaligus.
- [ ] Retry/preset lain pada gambar yang sama tidak memotret ulang (bandingkan isi jawabannya terhadap gambar yang sama walau halaman di-scroll).
- [ ] Tab berubah / scroll / zoom saat memotret → error jelas, bukan gambar salah.
- [ ] Halaman `chrome://` / Web Store: klik ikon → tidak crash (badge `!`).
- [ ] Permission custom endpoint ditolak → pesan jelas, tidak ada sukses palsu.
- [ ] Library: search, filter, favorit, edit, hapus (konfirmasi), export → import round-trip (teks, kode, gambar), restart browser → data tetap ada.
- [ ] Key kosong / URL invalid / offline / HTTP 401/429/5xx / model tidak ada / model tanpa vision → error jelas, tidak ada fallback provider tersembunyi.
- [ ] Pengaturan lama (custom URL + model + posisi tombol) tetap ada setelah update.

## Batasan pengujian

- Service worker dan IndexedDB asli belum diuji di lingkungan ini (tidak ada Chrome test runner di VM). Integrasi IDB diuji manual mengikuti checklist di atas.
- Uji end-to-end permission screenshot Chrome yang sebenarnya belum terverifikasi di sini; alur permission mengikuti dokumentasi resmi dan diuji dengan mock.
- Tes mock tidak diklaim sebagai pengujian API provider asli. Jangan memakai key/endpoint pribadi untuk uji jaringan tanpa izin eksplisit.
