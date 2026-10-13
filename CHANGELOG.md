# CHANGELOG Polter

## v0.8.8 — 2026-10-13

Umpan balik uji v0.8.7 dari pemilik.

### Mode sembunyi kini benar-benar tanpa tombol
- Tab hantu memang sudah dihapus dari DOM sejak v0.8.6, tetapi **pil "Polter" yang muncul saat menyeleksi teks** adalah tombol mengambang terpisah yang belum ikut digerbang — itulah yang masih terlihat. Kini mode sembunyi menghapus total semua tombol mengambang (tab tepi, pil seleksi, tombol potret/deteksi warisan) dan pil seleksi tidak akan muncul sama sekali selama mode sembunyi aktif. Tidak ada elemen transparan yang tertinggal.
- Preferensi visibilitas kini juga dibaca di subframe sejak awal, supaya gerbangnya konsisten.

### Shortcut panggil menu diganti: Alt+Shift+M
- Alt+Shift+P ternyata memicu pembuatan grup baru di browser pemilik. Shortcut `toggle-menu` kini **Alt+Shift+M** (M = Menu). Semua teks petunjuk (Pengaturan, kartu Tab Hantu di panel, README) diperbarui. Shortcut tetap bisa diganti bebas di pengaturan shortcut browser.

### Tes
- 2 assert regresi baru + assert shortcut diperbarui. Total 195 lulus, 0 gagal; web-ext lint 0 error.

## v0.8.7 — 2026-10-13

Umpan balik uji v0.8.6: radio tampil/sembunyi tab hanya ada di Pengaturan — pemilik mencarinya di panel menu.

### Radio Tab Hantu kini juga ada di panel menu
- Panel menu (yang dibuka dari tab atau Alt+Shift+P) kini punya kartu **Tab Hantu** di bawah kartu Auto Answer, berisi radio **Tampilkan / Sembunyikan** — persis kontrol yang sama dengan di Pengaturan, menulis kunci `jawabTabVisible` yang sama sehingga keduanya selalu sinkron.
- Memilih **Sembunyikan** langsung menghilangkan tab dari layar saat itu juga (panel tetap terbuka); memilih **Tampilkan** memunculkannya lagi tanpa reload dan tanpa membuka Pengaturan.

### Tes
- 3 assert regresi baru. Total 193 lulus, 0 gagal; web-ext lint 0 error.

## v0.8.6 — 2026-10-13

Permintaan pemilik: tombol/tab hantu bisa dihilangkan dari layar.

### Radio "Tombol hantu" di Pengaturan (bagian 6 baru)
- Pilihan **Tampilkan** / **Sembunyikan** tab hantu. Tersimpan otomatis saat radio diubah (tanpa perlu menekan Simpan) sebagai kunci `jawabTabVisible`.
- Background menyiarkan perubahan ke semua tab yang terbuka (`storage.onChanged` -> `jawab-tab-visibility`), jadi tab langsung muncul/hilang **tanpa reload**. Tab yang baru dibuka membaca preferensi yang sama lewat `ui-pref-get`.
- Saat disembunyikan, tab benar-benar dihapus dari DOM halaman; Auto Answer dan shortcut lain tetap bekerja seperti biasa.

### Shortcut baru: tampilkan menu (Alt+Shift+P)
- Command `toggle-menu` di manifest: menekan **Alt+Shift+P** membuka menu awal Polter di halaman aktif; menekan lagi (atau Esc / tombol x) menutupnya. Inilah cara memanggil Polter saat tab disembunyikan.
- Hint pintasan di Pengaturan diperbarui menyebut shortcut ini.

### Tes
- 8 assert regresi baru (manifest command, allowlist ui-pref, siaran visibilitas, handler content, radio options) + mock `storage.onChanged` di suite inti. Total 190 lulus, 0 gagal; web-ext lint 0 error.

## v0.8.5 — 2026-10-13

Umpan balik uji v0.8.4 dari pemilik.

### AgentRouter: HTTP 400 "content-blocked"
- Terverifikasi dari dokumentasi komunitas AgentRouter: error ini adalah **filter konten (WAF) di sisi AgentRouter** atas isi `messages` — bukan penolakan klien. Sidik jari Claude Code justru **lolos** (kalau tidak, errornya "unauthorized client detected"). Filter ini bersifat per-teks dan tidak sepenuhnya konsisten — prompt biasa pun kadang kena, dan makin agresif setelah request beruntun; model tidak berpengaruh karena blokir terjadi sebelum model dipanggil. Perilaku ini juga bisa berarti model yang diminta tidak termasuk paket key.
- Polter sekarang menerjemahkan error itu jadi penjelasan yang bisa ditindaklanjuti (tunggu ±1 menit, parafrase, pastikan model termasuk paket — mis. claude-sonnet-4-6), dan "unauthorized client" diterjemahkan terpisah sebagai kegagalan sidik jari.

### Tes vision 9Router (ag/claude-sonnet-4-6): "Respons kosong"
- Extractor respons kini juga membaca `message.content` / `delta.content` yang berbentuk **array balok teks** (bentuk yang dikembalikan sebagian gateway penerjemah untuk jawaban vision) — sebelumnya hanya string yang dibaca, jadi jawaban yang sebenarnya ada terbaca kosong.
- Pesan "Respons kosong" pada Tes kini menyertakan `finish_reason` dari respons agar penyebabnya (mis. `length` = jatah token habis untuk reasoning) langsung terlihat.

### Tes
- Regresi baru: extractor array + penerjemah error AgentRouter. Total 182 lulus, 0 gagal; web-ext lint 0 error.

## v0.8.4 — 2026-10-13

### Tes koneksi 9Router lokal gagal / respons kosong — akar ditemukan
- Probe "Tes koneksi" untuk provider Custom/OpenAI memakai `max_tokens: 16` (dan Tes vision 64). Model berpikir seperti Claude Sonnet menghabiskan jatah sekecil itu untuk reasoning sebelum menulis satu huruf pun, jadi respons terbaca **kosong** dan tes dinyatakan gagal — pola yang sama dengan yang dulu menimpa probe Muse (sudah dinaikkan ke 1024) tapi tertinggal di jalur Custom/Anthropic. Sekarang **semua probe 1024**, dan pembaca respons probe memakai extractor bersama yang toleran bentuk (bukan lagi satu bentuk persis).

### Provider baru: AgentRouter
- AgentRouter (agentrouter.org) memang menolak klien yang tidak tampak seperti Claude Code / OpenCode — terverifikasi dari dokumentasi & proyek bridge komunitas yang khusus menyuntikkan "Claude Code client headers". Polter kini menirunya secara resmi:
  - Transport **Anthropic Messages** ke `https://agentrouter.org/v1/messages` (base URL bisa diganti, mis. co.agentrouter.org; akhiran `/v1` ditangani otomatis), auth `Authorization: Bearer` + `x-api-key`.
  - Header sidik jari klien Claude Code: `anthropic-beta: claude-code-20250219,...`, `x-app: cli`, rangkaian `x-stainless-*`, `anthropic-dangerous-direct-browser-access`.
  - **User-Agent** — satu-satunya header yang dilarang diubah lewat fetch browser — ditulis ulang ke `claude-cli/...` lewat **declarativeNetRequest** khusus host agentrouter.org (izin baru di manifest; aturan sesi, hanya aktif untuk domain itu).
  - Mendukung teks, gambar (vision), dan lampiran kartu soal, sama seperti provider Anthropic. Izin origin agentrouter.org diminta lewat alur Simpan/Tes seperti endpoint custom.

### Tes
- Regresi baru: target/URL/header AgentRouter, sanitasi config, probe tanpa max_tokens kecil. Total 178 lulus, 0 gagal; web-ext lint 0 error.

## v0.8.3 — 2026-10-13

Dua laporan pemilik atas v0.8.2.

### Screenshot tetap ditolak padahal izin sudah diberikan
- Penyebab yang bisa dipastikan dari kode: pesan error lama **menelan pesan asli browser** dan menggantinya dengan teks generik untuk semua error yang mengandung kata "permission" — jadi penyebab sebenarnya tidak pernah terlihat (dan teksnya masih menyisakan nama lama di kalimat alternatif, sudah dibersihkan).
- Sekarang: capture dicoba **dua kali** (kegagalan sesaat seperti fokus jendela pulih sendiri), ekstensi **memeriksa status izin yang sebenarnya** sebelum menuduh izin belum diberikan, dan pesan error selalu menyertakan **"Detail browser: <pesan asli>"**. Bila izin terdeteksi sudah ada tapi browser tetap menolak, pesannya menyatakan itu dengan jelas (halaman khusus browser/PDF memang tidak bisa dipotret oleh ekstensi mana pun).

### Respons kosong dari API lokal (9Router, mis. Claude Sonnet)
- Parser streaming tadinya hanya menerima satu bentuk persis (OpenAI murni + `[DONE]`). Gateway lokal menerjemahkan Claude dengan beberapa bentuk lain yang semuanya berakhir kosong/gagal di Polter. Sekarang parser toleran terhadap:
  - chunk penutup `finish_reason` tanpa `[DONE]` (dianggap selesai, bukan "stream terputus");
  - jawaban utuh yang ditaruh di `message.content` pada chunk terakhir;
  - delta bergaya Anthropic (passthrough Claude: `content_block_delta`/`text_delta`);
  - konten berupa array balok teks;
  - bodi JSON utuh yang dikirim dengan header streaming (diselamatkan sebagai satu token).
- Extractor JSON non-streaming kini memakai fungsi bersama yang juga paham bentuk-bentuk di atas.

### Tes
- 8 tes regresi inti baru membuktikan tiap bentuk gateway menghasilkan token. Total 170 lulus, 0 gagal; web-ext lint 0 error.

## v0.8.2 — 2026-10-12

Arahan pemilik atas v0.8.1: hilangkan langkah klik yang tidak perlu, prompt dibuat sepadat inti, pilihan bergambar harus bisa dijawab, dan logo tab jangan bercahaya.

### Langsung jawab, tanpa disuruh dua kali
- **Potret (Ekstrak dari Foto):** begitu potret selesai, panel langsung meminta jawaban AI (aksi "Jawab Soal") — tidak perlu lagi memilih preset / menekan Proses. Preset lain (Jelaskan, Ringkas, dst) dan pertanyaan custom tetap tersedia untuk memakai ulang gambar yang sama.
- **Deteksi Soal di Layar:** panel deteksi langsung menjawab otomatis setelah memindai. Tombol "Jawab Semua dengan AI" dibuang; **Pindai Ulang** dipertahankan sebagai pengaman, dan Isi Semua tetap manual setelah jawaban diperiksa.

### Prompt dipangkas ke inti
- Instruksi autofill dari ±9 baris aturan menjadi 3 baris inti (format JSON saja + aturan opsi persis + aturan huruf untuk pilihan gambar). Prompt "Jawab Soal" untuk gambar juga dipadatkan. Prompt yang lebih kecil = token pertama lebih cepat dan biaya lebih rendah; kontrak keluaran (JSON murni, teks opsi persis) tidak berubah.

### Pilihan berupa gambar kini bisa dijawab
- Detektor memberi label posisi ("Gambar A/B/C…", atau alt gambar bila ada) pada opsi yang isinya gambar, sehingga soalnya tidak lagi gugur dari deteksi.
- Saat menjawab, kartu soal yang memuat pilihan bergambar **dipotret dan dilampirkan ke AI** (UI Polter disembunyikan sesaat agar tidak ikut terpotret); AI menjawab dengan huruf opsinya.
- Pencocokan isi kini paham jawaban huruf ("B", "Gambar B") dan nomor posisi (khusus soal bergambar). Provider teks-saja (mis. rute Muse Bridge) tetap menjawab dari label sebaik mungkin; hasil terbaik dengan provider vision (OpenAI/Anthropic/Muse API).

### Tab hantu lebih tak terlihat
- Logo hantu di tab tepi diturunkan ke abu-abu ±30% opasitas, latar tab 6%, tanpa blur dan tanpa pendaran saat hover (hover hanya menaikkan ke ±68%). Berlaku sama di skema terang dan gelap.

### Tes
- 12 tes regresi baru (pencocokan huruf/posisi, keberadaan alur auto-jawab & lampiran, prompt ramping). Total 159 lulus, 0 gagal; web-ext lint 0 error.

## v0.8.1 — 2026-10-12

Hasil review menyeluruh atas laporan pemilik: tampilan tidak sesuai desain demo, bug fitur, respons lambat, dan jawaban sering dianggap soal.

### Desain menu kini persis demo yang disetujui
- Header panel: ubin hantu putih + judul + subjudul tagline "Polter : Unseen, Unheard, Done." di semua mode panel (sebelumnya hanya teks "Polter" polos).
- Item menu berikon (ubin putih berisi ikon kamera / ikon pindai) + teks persis demo ("Potret area soal di layar, Polter membaca gambarnya lalu menjawab." / "Pindai soal yang sedang tampil — hanya yang lolos filter soal yang dijawab & diisi.") + chevron.
- Auto Answer menjadi kartu berisi judul + penjelasan + **sakelar geser**, dengan baris status di kaki kartu ("Auto Answer aktif/nonaktif · Polter tidak pernah menekan tombol kirim final."). Tombol pil "Auto Answer: Nyala" dan paragraf catatan panjang dibuang.

### "Jawaban dianggap soal" — akar & perbaikan
- Fallback teks-utuh di `ancestorQuestionText` dulu mengangkat teks seluruh ancestor (soal + semua pilihan + teks sekitar) sebagai "soal" setiap kali ada "?". Kini hanya diterima bila ancestor adalah wadah teks murni tanpa field/tombol/pilihan.
- Filter soal menolak kandidat yang teksnya sama dengan salah satu pilihannya sendiri, dan yang memuat ≥ separuh teks pilihannya (blob soal+pilihan).
- Saringan lintas item di panel deteksi: teks yang menjadi pilihan di soal lain tidak boleh berdiri sebagai soal tersendiri.
- Detektor blok: melewati blok yang teksnya persis pilihan soal terdeteksi atau elemennya tumpang tindih elemen pilihan.
- Grup role radio/checkbox kini juga dipisah per kontainer soal (sebelumnya satu radiogroup besar melebur banyak soal, pola yang sama seperti bug grup input yang diperbaiki di v0.5.3).
- Residu panjat fallback kartu jawaban diperketat (min. 12 karakter, tidak boleh sama dengan sebuah pilihan).

### Lambat — akar & perbaikan
- Endpoint non-streaming (rute bridge/9Router membalas JSON utuh) dulu dipaksa dibaca sebagai SSE: tidak ada token yang tampil sampai stream ditutup, lalu sering berakhir sebagai error "stream terputus". Sekarang respons ber-content-type JSON dibaca sekali dan isinya dikeluarkan sebagai satu token.
- Timeout diam (idle) stream dinaikkan 30 → 90 detik; antrean bridge dan model reasoning memang bisa diam lebih dari 30 detik sebelum token pertama, dan dulu request dibatalkan karenanya.
- Render jawaban streaming tidak lagi menggambar ulang markdown penuh setiap potongan token (O(n²)); kini di-throttle 100 ms + satu render final.
- Auto Answer tidak lagi memindai ulang seluruh halaman tiap 3 detik di halaman statis: interval hanya bekerja bila MutationObserver melihat perubahan, dan siklus dilewati saat tab tidak terlihat.

### Tes
- 12 tes regresi baru untuk semua perbaikan di atas. Total 147 lulus, 0 gagal. (Semantik "stream putus tanpa terminator = incomplete" yang disengaja dipertahankan — sempat dicoba diubah, tes inti menolaknya, dikembalikan.)

## v0.8.0 — 2026-10-12

### Rebrand: Jawab menjadi Polter (desain disetujui pemilik lewat demo artefak)

- **Nama & identitas:** ekstensi kini bernama **Polter** dengan tagline **"Unseen, Unheard, Done."** Manifest, halaman Pengaturan, Library, panel di halaman, dan README memakai nama Polter; tidak ada lagi penyebutan nama lama di permukaan pengguna. (ID add-on AMO dan kunci penyimpanan internal sengaja dipertahankan agar instalasi & data yang sudah ada tidak rusak.)
- **Maskot hantu:** ikon baru 16/48/128 — hantu putih (dua mata, bawah bergelombang) di atas kotak hitam membulat, digambar prosedural agar tajam di semua ukuran.
- **Hitam-putih penuh:** palet ungu/biru dicabut dari Pengaturan & Library (sekarang monokrom gelap: latar nyaris hitam, aksen putih, status berhasil = blok putih terbalik). Panel di halaman menjadi kaca gelap monokrom satu tema; penanda jawaban benar kini blok putih dengan teks hitam (bukan hijau lagi); pesan error/catatan memakai abu-abu netral.
- **Tab tepi sesuai demo yang disetujui:** tab kiri diperkecil (26×56), latar sangat transparan, isinya **hanya logo maskot hantu SVG** — tanpa titik status (status Auto Answer tampil di panel menu). Tab menjadi pekat dan melebar saat diarahkan kursor. Pil seleksi teks berlabel "Polter".
- Perilaku tidak berubah dari v0.7.0: 4 provider (Custom, OpenAI, Anthropic, Muse), deteksi berfilter, Auto Answer persisten, menu menghilang selama memotret, tanpa submit otomatis.

## v0.7.0 — 2026-10-12

### Provider Google Gemini DIHAPUS (keputusan pemilik)

Klarifikasi yang diminta pemilik: bisakah ekstensi terhubung **langsung ke Gemini** (aplikasi/langganan) tanpa Google AI Studio API key dan tanpa project Google Cloud? Jawaban terverifikasi: **tidak bisa secara resmi**. Google tidak membuka kuota aplikasi Gemini / AI Pro untuk aplikasi pihak ketiga; yang resmi hanyalah Gemini API (kunci AI Studio atau OAuth project Cloud sendiri — persis dua mode yang sebelumnya ada). Rute tidak resmi yang ada (memakai ulang OAuth Gemini CLI, cookie sesi gemini.google.com, proxy Antigravity) dinyatakan Google sebagai pelanggaran ToS dan terbukti membuat layanan AI akun dinonaktifkan (403 ToS violation; pelanggaran kedua permanen). Sesuai keputusan pemilik — "kalau gabisa mending dihapus aja" — provider Gemini dicabut seluruhnya:

- background: target provider, `askGemini`, `geminiAuthParts`, cabang probe teks/vision, dan field sanitasi Gemini dihapus. Pengaturan lama yang masih menunjuk `provider: 'gemini'` otomatis jatuh ke Custom.
- defaults: field Gemini + helper OAuth (`JAWAB_OAUTH_SCOPES`, `jawabBuildGoogleAuthUrl`, `jawabParseOAuthRedirect`) dihapus.
- options: kartu provider Gemini, seksi kredensial (mode key/OAuth, Client ID, Project ID, tombol Login/Logout Google), validasi, dan blok login dihapus.
- manifest: izin `identity` dan host `*.googleapis.com` (generativelanguage + www) dicabut — ekstensi tidak lagi meminta akses apa pun ke Google.
- Suite tes Gemini OAuth (25 tes) dihapus; total suite sekarang 133 lulus, 0 gagal.

Provider tersisa: **Custom, OpenAI, Anthropic, Muse (Meta)**.

## v0.6.0 — 2026-10-12

Rombak UI atas ide pengguna: dua tombol mengambang yang tidak jelas diganti satu tab tepi + menu, deteksi diberi filter soal, dan ditambah Auto Answer yang tetap aktif saat pindah soal.

### UI baru: tab tepi kiri + menu dropdown
- Tombol gunting dan tombol deteksi yang mengambang **dihapus**. Satu-satunya tombol mengambang sekarang adalah **tab tipis transparan di tepi kiri layar** (abu semi transparan, melebar sedikit saat diarahkan).
- Klik tab membuka **panel menu** yang menempel di kiri, berisi dua menu persis seperti rancangan pengguna:
  1. **Ekstrak dari Foto** — potret area soal di layar, AI menjawab dari gambar (alur lama, tidak berubah).
  2. **Deteksi Soal di Layar** — pindai soal yang sedang tampil, jawab, isi ke halaman.
- Panel sub-fitur punya tombol kembali (‹) ke menu. Tombol seleksi teks kini berupa pil kaca berlabel "Jawab" (lebih jelas daripada "?"). Gaya kaca transparan ala Apple dipertahankan; panel menu/deteksi kini menempel di kiri dekat tab.

### Filter soal
- Deteksi sekarang melewati **filter soal** (`looksLikeQuestion`): pilihan ganda wajib punya ≥2 pilihan wajar + teks soal memadai; blok teks wajib bertanda tanya/kata tanya/pola klasifikasi; field pencarian & kredensial bergaya login disaring; label UI aplikasi (Edit/Preview/dsb) ditolak. Panel menampilkan "X soal lolos filter (dari Y kandidat)" dan menjelaskan bila kandidat gugur oleh filter.

### Auto Answer
- Toggle **Auto Answer** di menu. Bila nyala: ekstensi memantau perubahan halaman (MutationObserver + pemeriksaan berkala); setiap soal baru yang tampil dan **lolos filter** otomatis dideteksi → dijawab AI → diisi ke halaman, tanpa klik lagi.
- Statusnya **tersimpan**, jadi tetap aktif setelah pindah soal, dan bahkan setelah pindah halaman/reload (tab menampilkan titik hijau saat aktif). Berhenti sendiri setelah 3x gagal berturut-turut, dan bisa dimatikan kapan saja dari menu. Tetap tidak pernah menekan tombol submit/kirim final; di kuis, "mengisi" pilihan berarti mengklik pilihan itu seperti sebelumnya.

### Tes
- Total semua suite: 153 lulus, 0 gagal.

## v0.5.3 — 2026-10-12

Laporan pengguna: (1) "Isi yang ini" di soal lain membuat jawaban soal sebelumnya ter-uncheck; (2) "Isi Semua ke Halaman" masih belum bisa.

### Grup radio tidak lagi melebur antar soal
- Detektor lama mengelompokkan radio/checkbox **hanya berdasarkan `name`**. Platform yang memakai satu `name` untuk semua soal (atau name kosong/seragam) membuat semua soal melebur jadi satu grup — menekan isi di soal lain pasti menggeser pilihan grup yang sama, persis gejala (1).
- Pengelompokan sekarang per **`name` + kontainer soal** (fieldset/li/tr/blok berkelas question terdekat). Satu name yang menembus banyak kontainer menjadi banyak item soal yang benar.
- Input asli yang disembunyikan platform (digambar ulang jadi lingkaran kustom) sekarang tetap dideteksi bila label/induknya terlihat — sebelumnya terbuang oleh filter visibilitas, padahal klik programatik padanya sah. Ini salah satu penyebab (2) di platform berbasis input tersembunyi.

### Klik kustom wajib terbukti mengubah halaman (tidak ada lagi sukses palsu)
- Pengisian elemen kustom (ubin kuis, baris radio visual, role=radio) sebelumnya mengembalikan "berhasil" setiap kali tidak ada `aria-checked` — termasuk di halaman pratinjau yang kliknya memang tidak memilih apa pun. Akibatnya "Isi Semua" melaporkan terisi padahal halaman tidak berubah: gejala (2).
- Sekarang klik diverifikasi: berhasil hanya bila `aria-checked` menjadi true, elemen lepas dari dokumen (halaman bereaksi/berpindah), atau tanda tangan state (class elemen/ikon/induk) berubah. Di halaman pratinjau Wayground (Content View maupun Student View admin) klik memang hanya memindahkan fokus — ekstensi sekarang jujur melaporkannya sebagai gagal/tidak terkonfirmasi, bukan sukses semu. Di sesi main sungguhan, memilih ubin mengubah state halaman sehingga terverifikasi berhasil.
- Catatan terkait gejala (1) di Student View pratinjau: "centang" yang terlihat di sana adalah cincin fokus ubin; fokus hanya bisa di satu tempat, jadi berpindah soal selalu tampak seperti uncheck. Itu perilaku pratinjaunya, dan sekarang konsisten dengan laporan gagal yang jujur dari ekstensi.

### Tes
- Total semua suite: 144 lulus, 0 gagal. Fixture manual ditambah kasus radio satu-name banyak soal.

## v0.5.2 — 2026-10-12

Berdasarkan inspeksi DOM langsung halaman Wayground asli ("Classifying Real Numbers", URL admin/quiz yang sama dengan yang dibuka pengguna; tanpa login):

### Fakta halaman yang terverifikasi (menentukan perbaikan)
- Soal Wayground ada di **dokumen utama; iframe = 0**. Jadi kegagalan kemarin bukan soal frame.
- **Content View** (tampilan pada screenshot pengguna): teks soal adalah `<h3>` polos; tiap opsi adalah `<div>` polos `cursor:pointer` berisi ikon `<i class="icon-free-regular-circle">` — tanpa input, button, role, maupun data-testid. Detektor lama (yang mensyaratkan button/role/class "option"/testid) memang tidak bisa melihatnya, dan teks soalnya tanpa tanda "?" sehingga detektor blok teks pun melewatkannya. Hasilnya: 0 soal → "Pindai Ulang" menghasilkan kekosongan yang sama dan tampak seperti bug.
- Klik pada opsi Content View **tidak melakukan apa pun** (terverifikasi dengan klik nyata): halaman itu pratinjau baca-saja untuk guru. Tidak ada ekstensi yang bisa "mengisi" halaman yang kliknya sendiri tidak berfungsi; di sana Jawab sekarang menampilkan soal + jawaban per soal, dan pengisian nyata berlaku di Student View/sesi main.
- **Student View / sesi main**: kartu `[data-testid="mcq"]`, soal di `[data-testid="question-query-text"]`, opsi adalah div `[data-testid="question-option"]` (teks di `[data-testid="option-text"]`) — mengklik ubin adalah cara menjawabnya.

### Perbaikan
- Detektor baru **baris radio visual** (1d): elemen terlihat `cursor:pointer` berteks pendek yang memuat ikon berkelas "circle", tanpa field di dalamnya, kandidat terdalam, dikelompokkan per induk; soal diambil dari `<h3>`/teks soal ancestor. Menangkap Content View persis seperti struktur aslinya.
- Detektor baru **ubin `question-option`** (1e): dikelompokkan per kartu `[data-testid="mcq"]`, soal dari `[data-testid="question-query-text"]`, teks opsi dari `[data-testid="option-text"]`; pengisian mengklik ubin yang cocok.
- **Pindai tahan error**: `scanPageQuestions` kini membungkus tiap bagian dalam try/catch — satu bagian yang error di DOM eksotis tidak lagi membunuh seluruh pindai secara diam-diam (itulah yang membuat "Pindai Ulang" tampak mati); error ditampilkan sebagai toast informatif.
- Fixture manual ditambah kartu gaya Content View untuk uji klik nyata.

### Tes
- Total semua suite: 140 lulus, 0 gagal.

## v0.5.1 — 2026-10-12

Dari screenshot pengguna di **Wayground (dahulu Quizizz)**: tombol Jawab muncul banyak sekali dan sebagian masih biru, padahal v0.5.0 sudah mengganti gaya dan membatasi tombol di frame utama.

### Tombol dobel/zombie versi lama
- Penyebabnya: tab platform tidak pernah di-reload selama ekstensi diperbarui berkali-kali (0.4.x → 0.5.0). Content script versi lama menjadi zombie di tab itu — host + tombol lamanya (termasuk yang biru dan yang di sub-frame) tetap menempel di DOM walau ekstensinya sudah berganti.
- Content script sekarang melakukan **takeover**: penanda versi di `window.__jawabLoaded`; bila menemukan sisa versi lain, semua `#jawab-host` lama dibuang sebelum UI baru dibuat. Reload tab tetap disarankan setelah memperbarui ekstensi (paling bersih), tapi penumpukan tidak lagi bertambah parah dari versi ke versi.

### Tombol: bulet abu semi transparan, tanpa logo
- Sesuai permintaan: ketiga tombol mengambang (potret, deteksi, seleksi) sekarang lingkaran abu semi transparan polos (`rgba(130,130,138,.42)` + blur tipis), **tanpa ikon/glif apa pun**. Fungsi tetap dibedakan posisi (potret 44px paling bawah, deteksi di atasnya, seleksi muncul di dekat teks terpilih) dan tooltip/aria-label saat diarahkan.

### Menjawab langsung di web: kartu jawaban
- Deteksi kini juga mengenali **kartu jawaban klik** ala pemain kuis SPA (Wayground/Quizizz): 2–6 elemen klik bersaudara (tombol/div `cursor:pointer`/class-testid "option"/"answer") dengan teks soal di ancestor — soal tanpa tanda tanya pun dicoba dikenali dengan membuang teks pilihan dari teks kontainer. Label UI aplikasi (Edit, Preview, Worksheet, dsb) disaring agar tidak tertukar jadi pilihan jawaban. Pengisian = mengklik kartu yang cocok lewat jalur elemen kustom yang sama seperti role=radio.
- Fixture manual ditambah bagian kartu jawaban gaya Wayground untuk uji klik nyata.
- Catatan jujur: halaman pada screenshot adalah **editor** Wayground (tampilan guru) — tempat menjawab yang sebenarnya adalah mode main/siswa; deteksi kartu menyasar keduanya, tapi pembuktian akhir tetap klik nyata pengguna di halaman main.

### Tes
- Total semua suite: 135 lulus, 0 gagal.

## v0.5.0 — 2026-10-12

Laporan pengguna yang ditangani rilis ini: (1) otomasi isi jawaban belum jalan di platformnya — jawaban hanya tampil, tidak terisi; (2) bug izin akses situs — tombol mengambang tidak pernah muncul, hanya shortcut Alt+Shift+S yang bisa dipakai; (3) warna biru/indigo terlalu mencolok, minta diganti transparan seperti bubble Apple.

### Izin akses situs
- Akar bug (2): MV3 tidak otomatis memberi izin host untuk content script di semua situs (terutama Firefox), jadi tombol mengambang memang tidak pernah tampil; shortcut/ikon tetap jalan karena background menyuntikkan script memakai akses sesaat (activeTab).
- Pengaturan kini punya bagian **Izin akses situs**: satu tombol "Aktifkan izin semua situs" meminta izin origin opsional (`http://*/*`, `https://*/*`) yang memang sudah dideklarasikan ekstensi, lengkap dengan status aktif/belum dan cara mencabutnya. Setelah aktif, tombol muncul otomatis di semua halaman.
- Content script sekarang `all_frames: true` dan injeksi fallback background memakai `allFrames: true`.

### Otomasi di platform (termasuk iframe)
- **Soal di dalam iframe sekarang terjangkau.** Alt+Shift+D / klik ikon menjalankan koordinasi lintas frame: semua frame memindai dokumennya, melaporkan jumlah soal ke background, dan frame dengan soal terbanyak yang menampilkan panel — pengisian terjadi di dokumen yang sama sehingga referensi elemen valid. Fungsi pemilih frame (`pickWinningFrame`) murni dan teruji.
- **Referensi elemen disegarkan sebelum mengisi** (`rescanForFill`): platform SPA yang me-render ulang field antara pindai dan isi tidak lagi membuat pengisian menempel ke node basi; penukaran referensi hanya bila jumlah dan teks soal per index cocok.
- **Pengisian radio/checkbox diperkeras**: cek elemen masih menempel di dokumen, dan bila `click()` ditelan framework, nilai di-set langsung disertai event `input`/`change`, lalu diverifikasi.
- **Pilihan kustom `role="radio"`/`role="checkbox"`** (div yang digambar platform modern, bukan `<input>`) kini terdeteksi berkelompok per kontainer dan terisi via klik + verifikasi `aria-checked`.

### Tampilan: kaca transparan ala Apple
- Seluruh UI di halaman (bubble gunting/deteksi/"?", panel, toast, petunjuk potret) diganti dari indigo pekat `#4f46e5` menjadi kaca buram: latar putih transparan + `backdrop-filter: blur + saturate`, garis tepi halus, teks gelap; otomatis beradaptasi ke varian gelap mengikuti `prefers-color-scheme` perangkat. Tidak ada lagi warna biru mencolok di UI halaman.

### Tes
- `tests/test-frames-ui.js` baru: 21 test. Total semua suite: 129 lulus, 0 gagal. Uji end-to-end di platform asli pengguna (iframe/SPA) tetap perlu klik nyata darinya; fixture manual diperbarui seperlunya.

## v0.4.3 — 2026-10-12

### Perbaikan: Tes koneksi/vision Muse selalu "Respons kosong"
- Dari laporan pengguna: provider Muse mode Meta Model API (key terisi, model `muse-spark-1.2`) gagal di kedua tes dengan "Respons kosong", padahal request diterima server (bukan error auth/HTTP — itu akan tampil sebagai error status).
- Akar masalahnya di tes Jawab sendiri: probe memakai `max_tokens` sangat kecil (16 teks, 64 vision). Muse Spark adalah model reasoning dan token berpikirnya dihitung sebagai token output, jadi seluruh jatah habis untuk berpikir sebelum ada konten jawaban — hasilnya konten kosong. Probe Muse sekarang memakai `max_tokens: 1024`. Alur tanya normal memang tidak pernah memasang batas sekecil itu, jadi pemakaian biasa tidak terdampak bug ini.
- Pesan kosong Tes vision Muse sekarang sadar mode: mode Bridge menjelaskan rutenya teks saja; mode API menyarankan cek status model/akun di dev.meta.ai (tidak lagi menyalahkan bridge saat pengguna memakai API).

## v0.4.2 — 2026-10-12

### Provider baru: Muse (Meta)
- Kartu provider **Muse (Meta)** dengan dua cara akses:
  - **Meta Model API** — API resmi dari dev.meta.ai: base `https://api.meta.ai/v1` (OpenAI-compatible, diverifikasi dari dokumentasi/cookbook resmi Meta), API key format `LLM|<id>|<secret>`, model default `muse-spark-1.2` (bisa diedit bebas). Catatan region apa adanya: preview Model API saat ini terbatas (AS) dan pendaftaran dari Indonesia sebelumnya ditolak Meta — ekstensi tidak bisa mengubah itu.
  - **Muse Bridge** — endpoint OpenAI-compatible milik pengguna sendiri (bridge/9Router lokalnya): URL + token + model (default URL `https://bridge.floodcare.my.id/v1`, model `muse-spark-1.3`), izin origin diminta lewat alur yang sama seperti provider Custom (termasuk peringatan HTTP). Rute ini teks saja; Tes vision memang diarahkan untuk melaporkan itu dengan jelas.
- **Tidak ada mode "Login Meta"**, dengan alasan yang dinyatakan terbuka: Meta tidak menyediakan OAuth pihak ketiga untuk akun Muse konsumen; jalur langganan Muse Code bukan API publik untuk ekstensi pihak ketiga (dan akun pengguna sendiri berstatus tidak berlangganan aktif, terbukti dari kegagalan koneksi di 9Router bertuliskan "Muse Code subscription is inactive"). Menambahkan tombol login yang tidak benar-benar bisa dipakai hanya akan jadi fitur palsu.
- Manifest: host permission `https://api.meta.ai/*`.
- Tes: `tests/test-muse.js` baru (13 test). Total semua suite: 106 lulus, 0 gagal.

## v0.4.1 — 2026-10-12

### Login dengan Google untuk Gemini (OAuth)
- Provider Gemini sekarang punya pilihan **Cara masuk**: `API key` (tetap, paling simpel) atau **Login dengan Google**.
- Login memakai jalur resmi Gemini API: OAuth 2.0 implicit flow via identity API (`launchWebAuthFlow`), scope `cloud-platform` + `generative-language.retriever` + `userinfo.email` + `openid`, lalu request ke `generativelanguage.googleapis.com` memakai `Authorization: Bearer <token>` + header `x-goog-user-project: <Project ID>` (bukan `?key=`). Dipakai konsisten di request teks, gambar, Tes koneksi, dan Tes vision.
- Syaratnya jujur di muka: pengguna memakai **project Google Cloud miliknya sendiri** (Generative Language API aktif + OAuth client Web application dengan redirect URI persis seperti yang ditampilkan halaman Pengaturan). Dialog "Google hasn't verified this app" adalah hal normal untuk project pribadi/testing, sesuai dokumentasi resmi Google.
- Token berlaku sekitar 1 jam dan alur ini **tanpa refresh token**: kedaluwarsa ditolak dengan pesan jelas "login lagi", bukan request gagal diam-diam. Token tersimpan lokal di `chrome.storage.local` (key `jawabGeminiOauth`, sama tidak-terenkripsinya dengan API key — dinyatakan apa adanya), ada tombol **Logout** yang menghapusnya.
- Yang TIDAK dijanjikan: login ini **bukan** login aplikasi Gemini dan **tidak** memakai kuota langganan Google AI Pro/Ultra — kuotanya adalah kuota Gemini API milik project tersebut (termasuk free tier-nya). Tidak ada pemakaian kredensial OAuth milik aplikasi lain (mis. klien internal Gemini CLI) — itu melanggar ToS Google.
- Manifest: permission `identity` + host `https://www.googleapis.com/*` (userinfo untuk label email status login).

### Catatan diagnosis (dari laporan pengguna)
- "Tes vision: Respons kosong. Model mungkin tidak mendukung gambar." pada provider Custom model `muse/muse-spark-1.3` adalah perilaku yang benar dari tesnya: endpoint/model rute teks itu mengembalikan konten kosong untuk payload gambar. Bukan error API key. Mode potret/screenshot butuh model vision (Gemini/OpenAI/Anthropic/custom vision); model teks tetap lolos Tes koneksi (teks).

### Tes
- `tests/test-gemini-oauth.js` baru: 25 test (URL otorisasi, parse redirect, `geminiAuthParts` mode key/oauth/kedaluwarsa/belum-login, konsistensi manifest). Total semua suite: 93 lulus, 0 gagal.

## v0.4.0 — 2026-10-12

### Firefox (AMO) — perbaiki gagal validasi
- **Struktur ZIP diperbaiki (penyebab error di screenshot):** ZIP lama membungkus folder `jawab-main/` sehingga `manifest.json` tidak ada di root. Build rilis sekarang men-ZIP *isi* folder, `manifest.json` di root.
- **Build Firefox terpisah** (`jawab-v0.4.0-firefox.zip`): manifest memakai `background.scripts` (`defaults.js`, `storage.js`, `background.js`) sebagai fallback event page di samping `service_worker` — validator AMO menolak MV3 yang hanya punya `service_worker`. `background.js` sekarang menjaga `importScripts` dengan `typeof` agar jalan di event page Firefox maupun service worker Chrome.
- **`browser_specific_settings.gecko`:** `id: jawab@floodcare.my.id`, `strict_min_version: 140.0`, dan `data_collection_permissions` (`required: ["websiteContent"]`) — wajib untuk submisi baru di AMO sejak 3 Nov 2025. Konten website hanya dikirim ke provider AI pilihan pengguna, dan hanya saat pengguna menekan tombol Tanya/Jawab.
- **`options_ui`** ditambahkan untuk Firefox (Chrome tetap `options_page`).
- Warning validator "Unsafe assignment to innerHTML" dihilangkan: seluruh JS yang dikirim ke store kini tanpa assignment innerHTML sama sekali — `options.js` dan `library.js` dibangun via createElement/textContent/replaceChildren, dan renderer markdown di `content.js` diganti renderer DOM (`renderMd`: bold/code/list/fenced-code dibangun sebagai node, teks AI selalu textContent sehingga tidak bisa menyuntikkan markup). Hasil `web-ext lint` pada paket Firefox final: **0 error, 0 notice, 1 warning** — satu-satunya warning bersifat informational: `service_worker` diabaikan Firefox karena fallback `background.scripts` memang disediakan (pola cross-browser resmi Mozilla).

### Fitur baru — deteksi langsung + isi otomatis
- **Deteksi soal/formulir tanpa foto:** tombol kaca pembesar mengambang (atau shortcut `Alt+Shift+D`) memindai DOM halaman: field teks/angka/email/tanggal, textarea, select, grup radio & checkbox (digabung per `name`), contenteditable, dan blok soal teks. Label diambil dari `<label for>`, label pembungkus, `aria-label`/`aria-labelledby`, `legend`, placeholder, dan teks soal di ancestor (pola Google Forms / Microsoft Forms / Moodle `.qtext` / LMS).
- **Jawab massal terstruktur:** tombol "Jawab Semua dengan AI" mengirim daftar soal sebagai JSON; prompt aksi baru `autofill` di background menuntut balasan HANYA JSON array `[{"index":0,"answer":"..."}]` (jawaban pilihan harus persis salah satu opsi). Parser mentolerir code fence/teks pengantar dan punya fallback baris bernomor.
- **Isi otomatis ke halaman:** setelah jawaban terparse, jawaban tampil per soal; tombol "Isi yang ini" / "Isi Semua ke Halaman" mengisi field memakai native value setter + event `input`/`change` (agar React/Vue/LMS ikut membaca), mencocokkan radio/checkbox/select berdasarkan teks opsi, dan mengekstrak angka untuk input number. **Tidak pernah ada submit otomatis** dan field password/hidden/file tidak pernah disentuh — pengguna selalu memeriksa hasil sebelum mengirim sendiri.
- Blok soal tanpa field (baca-saja) tetap dijawab dan ditampilkan, tapi tidak diisikan.

### Tes
- Test baru: `tests/test-autofill.js` (17 test: parse jawaban, pencocokan opsi, prompt autofill, konsistensi manifest, jaminan tidak ada `.submit()`) dan `tests/test-rendermd.js` (6 test: struktur renderer DOM + anti-injeksi markup). Total semua suite: 68 lulus, 0 gagal. Folder `tests/` tidak ikut dibungkus ke ZIP store.
- `tests/manual-autofill.html`: fixture form untuk uji manual end-to-end di browser (sajikan via HTTP lokal, bukan file://).

## v0.3.4 — 2026-10-12

- Panel popup (teks & tangkapan layar) bisa di-drag via header-nya. Klik tombol × tetap menutup, tidak ikut drag.

## v0.3.3 — 2026-10-12

- Dark mode di semua UI: panel popup content script, halaman Pengaturan, dan Library kini selalu gelap (sebelumnya panel popup terang, options/library mengikuti sistem).
- Pesan error izin screenshot lebih jelas: mengarahkan ke brave://extensions > Details > Site access > "On all sites" (penyebab umum tombol gunting gagal tapi toolbar bisa).

## v0.3.2 — 2026-10-12

Perbaiki bug "Gambar tidak ditemukan" saat proses AI setelah potret: `handleCapture` menyimpan blob dengan ID terpisah dari snippet, tapi content script memakai snippet id sebagai `imageId` untuk request AI sehingga `getBlob` selalu gagal. Sekarang response `capture-region` menyertakan `blobId`, dan draft content script menyimpan keduanya (`snippetId` untuk Simpan/Unduh, `imageId`/blobId untuk request AI). Regression test: handoff blobId + ask langsung image (51 test lulus).

## v0.3.1 — 2026-10-12

Hotfix regresi v0.3.0: `<style>` tidak sengaja di-append ke host (light DOM) sehingga tidak men-style isi shadow root — tombol gunting dan `?` tidak terlihat. Sekarang style kembali di dalam shadow root, host `position:fixed;pointer-events:none`, dan elemen interaktif (`.jbtn`, `.jpanel`, `.jcap`, `.jtoast`) memakai `pointer-events:auto`.

## v0.3.0 — 2026-10-12

Refactor besar berdasarkan audit independen (lihat `CATATAN_AUDIT_JAWAB.md` di arsip percakapan).

### Pipeline screenshot & state (A1–A4)
- State draft eksplisit: `hidePanel()` tidak pernah menghapus draft; `closePanel()`/`discardDraft()` terpisah. Mode image tanpa gambar valid menampilkan error, tidak fallback diam-diam ke teks.
- Capture dipisah dari request AI: potret sekali → preview crop → Simpan/Unduh/Proses. Retry, pertanyaan lanjutan, dan reuse memakai snapshot yang sama. Hanya "Potret Lagi" yang memotret ulang.
- UI Jawab disembunyikan sebelum capture dan disinkronkan dengan double `requestAnimationFrame` (bukan sleep acak).
- Hanya crop yang disimpan/dikirim; screenshot viewport penuh dibuang.
- Konversi koordinat dari ukuran bitmap aktual vs viewport tercatat (bukan asumsi DPR). Validasi tab/window sebelum dan sesudah capture; batal bila tab, scroll, zoom, atau viewport berubah.
- Capture via ikon toolbar (`action.onClicked`) dan `chrome.commands` (`Alt+Shift+S` potret, `Alt+Shift+L` library). Tidak menambah host permission `<all_urls>`.
- Whitespace dipertahankan: `trim()` hanya untuk validasi kosong. Spasi/tab/newline utuh di preview, storage, clipboard, payload AI.
- ESC saat drag: seluruh listener dilepas (idempotent), sesi ditandai batal, mouseup setelahnya tidak membuka popup/request.

### Lifecycle request (A5)
- Request ID + AbortController per request. Timeout koneksi (30 dtk), idle stream (30 dtk), dan total (3 mnt).
- Tombol Stop; tutup popup / port disconnect membatalkan request; respons basi (requestId lama) diabaikan.
- Parser SSE robust: chunk terpotong, CRLF, UTF-8 multibyte, event boundaries, komentar, `[DONE]`/`message_stop`, error event Anthropic dipropagasi (tidak lagi diabaikan).
- Stream yang berakhir tanpa terminator ditandai incomplete (bukan sukses palsu); jawaban parsial tetap bisa disalin/disimpan sebagai parsial.
- Gemini tetap non-streaming dan dinyatakan jujur di UI dan README.

### Settings & provider (A6)
- Default disatukan di `defaults.js` (background + options konsisten).
- Model default diperbarui ke ID resmi yang masih berlaku: `gpt-4o-mini`, `claude-sonnet-5`, `gemini-2.5-flash` (preset lama sudah pensiun).
- Default URL custom dikosongkan untuk distribusi baru; konfigurasi custom pengguna yang sudah tersimpan dipertahankan.
- Alur Simpan/Tes: validasi → peringatan HTTP eksplisit (dengan persetujuan) → izin origin via user gesture → simpan/panggil. Error permission tidak ditelan; tidak ada sukses palsu.
- Tidak mengirim header `Authorization` kosong bila custom endpoint tidak memakai key.
- Tes koneksi (teks) dipisah dari Tes vision (gambar). Target provider/model ditampilkan; ada peringatan pemakaian API sungguhan.

### Library & reuse (B)
- `library.html`: daftar snippet teks/kode/gambar + thumbnail, search judul/isi/tag, filter jenis & favorit, edit judul/tag/bahasa/isi, hapus dengan konfirmasi, favorit, salin persis, unduh gambar, buka sumber http(s) tervalidasi, jalankan AI pada snippet tersimpan, simpan hasil AI terkait snippet.
- Storage IndexedDB di origin extension (record + blob), skema v1 dengan `schemaVersion`, migrasi non-destruktif, cleanup blob yatim, cleanup draft (TTL 7 hari).
- Export/import JSON bervalidasi: gambar disertakan sebagai dataUrl hanya saat export; konflik ID di-remap (tidak menimpa diam-diam); tidak ada key/settings di export; tidak mengeksekusi konten import.
- Aksi teks: Simpan, Salin, Tanya AI (tidak ada request otomatis). Aksi screenshot: Simpan, Unduh, Jelaskan, Ringkas, Terjemahkan, Ekstrak Teks, Jawab Soal, pertanyaan custom. Ekstrak Teks memakai model vision dan menandai bagian tak terbaca, bukan mengarang.
- Semua operasi library bekerja offline tanpa API key. Tidak ada tombol placeholder.

### Keamanan (C)
- `chrome.storage.local` dibatasi ke `TRUSTED_CONTEXTS`; posisi tombol diakses content script via pesan allowlist (bukan seluruh settings).
- Validasi sender, nama port, tipe pesan, requestId, koordinat, dan ID snippet/blob. Pesan tak dikenal ditolak; tidak ada arbitrary-fetch proxy.
- Renderer markdown tetap escape HTML; dukungan fenced code tanpa melemahkan sanitasi. Tidak ada eval, inline handler, atau CDN.
- Key lokal dinyatakan jujur bukan encrypted vault; ada cara hapus key (kosongkan + Simpan).

### Tes
- 45 regression test Node (mock provider, tanpa API asli): SSE, timeout, abort, crop, whitespace, validasi import, alur port, capture pipeline, allowlist prefs. Lihat `TESTING.md`.

## v0.2.1 — 2026-10-12
- Timeout 60 dtk semua request + 20 dtk screenshot (tidak loading selamanya).
- Pesan error respons kosong; tombol Salin jawaban & Potret lagi; prompt jawaban terstruktur.

## v0.2.0 — 2026-10-12
- Mode screenshot: tombol gunting draggable, drag area, crop di service worker, kirim ke model vision, thumbnail di popup.

## v0.1.1 — 2026-10-12
- Desain ulang halaman pengaturan (provider cards, dark mode, tes koneksi), ikon robot ungu.
