# # RAG-TELE-BOT

> **Sistem RAG (Retrieval-Augmented Generation) Terintegrasi Cloudflare (Workers AI + Vectorize + D1) & Bot Telegram**  
> Dilengkapi Pipeline Otomatis Generator **Literature GAP Matrix** (Tugas Tambahan Awal RTM 2 - Fakultas Teknik UDINUS).

## 🔗 Akses Cepat & Deployment Aktif

- **Bot Telegram**: [t.me/ragteleshofiyanbot](https://t.me/ragteleshofiyanbot)
- **Web Chat / Uji RAG**: [rag-tele-cf.rizki210605.workers.dev](https://rag-tele-cf.rizki210605.workers.dev/)
- **Monitoring Stok**: [rag-tele-cf.rizki210605.workers.dev/monitor](https://rag-tele-cf.rizki210605.workers.dev/monitor) — login admin (HTTP Basic Auth)
- **Prompt Lab (Vercel)**: [rag-tele.vercel.app](https://rag-tele.vercel.app/) — uji lima prompt tugas dari browser
- **Literature GAP Matrix (MD)**: [`LITERATURE_GAP_MATRIX.md`](./LITERATURE_GAP_MATRIX.md)
- **Laporan Kulino (MD)**: [`KULINO_LITERATURE_GAP_MATRIX.md`](./KULINO_LITERATURE_GAP_MATRIX.md)
- **GAP Matrix (Spreadsheet CSV)**: [`data/literature_gap_matrix.csv`](./data/literature_gap_matrix.csv)
- **Dokumen Lima Prompt**: [`PROMPTS.md`](./PROMPTS.md)

---

## 🎓 Tugas Tambahan: Awal RTM 2 (Fakultas Teknik UDINUS)

Untuk memenuhi instruksi tugas perkuliahan **Fakultas Teknik Universitas Dian Nuswantoro**:
1. **Literature GAP Matrix**: Mengkaji 10 artikel ilmiah bereputasi internasional (IEEE, ACM, Springer Nature, Elsevier, NeurIPS) pada domain **Industri (E-Commerce, Ritel, Inventori)** dengan perbandingan lintas domain (Keuangan & Kesehatan).
2. **Pipeline RAG Generator**: Script `scripts/pipeline_gap_matrix.py` yang mampu mengindeks korpus paper, melakukan hybrid retrieval, menyintesis matriks kesenjangan riset (*Research GAP*), dan menjawab query riset ilmiah.
3. **Hasil Siap Unggah Kulino**: Berkas laporan lengkap di [`KULINO_LITERATURE_GAP_MATRIX.md`](./KULINO_LITERATURE_GAP_MATRIX.md) dan [`KULINO_SUBMISSION.html`](./KULINO_SUBMISSION.html).

### Cara Menjalankan Pipeline RAG GAP Matrix
```bash
# Generate seluruh matriks (Markdown, CSV, HTML, Kulino Doc)
python3 scripts/pipeline_gap_matrix.py --generate

# Query interaktif berbasis RAG terhadap literatur ilmiah
python3 scripts/pipeline_gap_matrix.py --query "Bagaimana mengatasi sinkronisasi stok realtime e-commerce pada RAG?"

# Tampilkan statistik korpus paper
python3 scripts/pipeline_gap_matrix.py --summary
```

---

## 📊 Sumber Data (Resource)

Sistem ini mengekstrak dan memproses dua sumber data utama:
1. **`resource/STOCK CASING - iPhone.pdf`**  
   - Berisi data inventaris fisik stok casing iPhone Flazzstore di gudang (35 tipe: dari iPhone 7 Plus hingga iPhone 18 Pro Max).
   - Data mencakup stok awal, mutasi harian, total stok riil, dan status ketersediaan (*Ready / Terbatas*).
2. **`resource/model.xlsx`**  
   - Berisi **1.114 produk** casing custom handphone (iPhone, Samsung Galaxy Z Flip/Fold, Samsung S-Series, dll).
   - Lengkap dengan Kode Produk, SKU Induk, Kategori, Foto Produk Shopee CDN, dan variasi tipe HP yang didukung.

---

## 🏗️ Arsitektur Sistem

```
                 +--------------------------------------------------+
                 |              Folder resource/                     |
                 |  - STOCK CASING - iPhone.pdf (35 tipe iPhone)    |
                 |  - model.xlsx (1.114 katalog produk casing)      |
                 +------------------------+-------------------------+
                                          |
                                          v  (python3 scripts/ingest.py)
                 +--------------------------------------------------+
                 |              data/ Generated                     |
                 |  - knowledge_base.json                           |
                 |  - knowledge_base_compact.json                   |
                 |  - rag_documents.json (1.150 vektor dokumen)     |
                 +------------------------+-------------------------+
                                          |
                 +------------------------+-------------------------+
                 |                                                  |
                 v                                                  v
   [MODE 1: CLOUDFLARE EDGE (PROD)]               [MODE 2: LOCAL BOT (DEV)]
+---------------------------------------+   +---------------------------------------+
|  Cloudflare Worker (/webhook)         |   |  Local Long-Polling Runner            |
|  - Cloudflare Vectorize (Vector DB)   |   |  - python3 scripts/local_bot.py       |
|  - Cloudflare Workers AI (Llama 3.3)  |   |  - Langsung konek ke Telegram Bot     |
|  - Fallback Hybrid Keyword Matching   |   |  - Cocok untuk uji coba tanpa domain  |
|  - D1 Database (stok editable)        |   +-------------------+-------------------+
|  - Dashboard /monitor (Basic Auth)    |                       |
+-------------------+-------------------+                       |
                    |                                           |
                    +--------------------+----------------------+
                                         |
                                         v
                         +-------------------------------+
                         |      Telegram Bot (@Bot)      |
                         |   - Balas teks HTML/Markdown  |
                         |   - Kirim preview foto casing |
                         +-------------------------------+
```

---

## ⚡ Fitur Utama

1. **Pengecekan Stok Real-time**: Menjawab pertanyaan stok casing iPhone secara presisi berdasarkan dokumen PDF gudang.
2. **Pencarian Katalog Desain**: Menemukan motif (Japan Girl, Wood Art, Mickey Mouse, Joyful Doodle, Otomotif, dll) dari 1.114 produk.
3. **Kirim Foto Otomatis**: Jika ada foto sampel casing yang cocok dari katalog, bot langsung mengirimkan foto tersebut ke Telegram.
4. **Cross-Check Tipe Kompatibel**: Memastikan tipe HP pelanggan didukung oleh motif casing tersebut dan menampilkan stok casingnya.
5. **Dua Mode Operasional**:
   - **Mode Cloudflare Serverless**: Berjalan 24/7 di Cloudflare edge gratis dengan webhook.
   - **Mode Local Polling**: Bisa langsung dijalankan di komputer lokal menggunakan Python tanpa perlu webhook / tunnel.
6. **Web Dashboard Monitoring Stok**: Halaman `/monitor` untuk melihat stok, mencari tipe iPhone, menambah tipe baru, mengubah stok, dan melihat riwayat perubahan. Data disimpan di **Cloudflare D1**, sehingga bot Telegram dan dashboard selalu memakai angka stok yang sama.
7. **Sinkronisasi RAG Otomatis**: Setiap perubahan stok langsung memperbarui dokumen stok di Cloudflare Vectorize. Tombol **Sync RAG** di dashboard menyinkronkan ulang seluruh index bila diperlukan.
8. **Web Dashboard Uji Coba**: Tersedia UI chat interaktif di browser lokal (`http://localhost:8787`).
9. **Lima Prompt Tahap 1**: Bot Telegram dan Prompt Lab menyediakan lima prompt siap uji — prioritas restock (zero-shot), normalisasi variasi (few-shot), audit judul/variasi (chain-of-thought), ekstraksi listing ke JSON (structured output), dan audit konsistensi stok (CoT + structured output). Dokumentasi lengkap ada di [`PROMPTS.md`](./PROMPTS.md).

---

## 🚀 Panduan Penggunaan Cepat

### 1. Persiapan Awal
Jalankan ingestion untuk mengekstrak data dari `resource/` (sudah diekstrak):
```bash
npm run ingest
```
Hasil file akan tersimpan di dalam folder `data/` (`1.150` dokumen RAG).

---

### 2. Uji Coba via Terminal (CLI)
Coba tanyakan pertanyaan RAG langsung di terminal:
```bash
# Uji coba dengan query khusus:
python3 scripts/test_rag.py "Berapa stok iPhone 15 Pro Max?"
python3 scripts/test_rag.py "Ada casing motif Japan Girl untuk iPhone 14 Pro?"
python3 scripts/test_rag.py "Casing Samsung Galaxy S24 motif kayu ada?"

# Atau jalankan suite tes bawaan:
npm run test:rag
```

---

### 3. Jalankan Bot Telegram di Lokal (Tanpa Deploy)
Anda bisa langsung menghubungkan bot ke Telegram secara instan menggunakan token dari [@BotFather](https://t.me/BotFather):

1. Buka Telegram dan chat ke [@BotFather](https://t.me/BotFather).
2. Kirim `/newbot` lalu ikuti petunjuk hingga mendapatkan **HTTP API Token** (contoh: `123456789:ABCdefGHI...`).
3. Buat file `.env` (atau salin dari `.env.example`):
   ```bash
   cp .env.example .env
   ```
   Lalu isi token Anda:
   ```ini
   TELEGRAM_BOT_TOKEN="123456789:ABCdefGHI..."
   ```
4. Jalankan bot:
   ```bash
   npm run bot:local
   # atau:
   python3 scripts/local_bot.py --token="123456789:ABCdefGHI..."
   ```
5. Buka bot Anda di Telegram dan kirim pesan `/start` atau langsung tanyakan:
   - *"Berapa stok iPhone 14 Pro Max?"*
   - *"Ada casing Japan Girl buat iPhone 16?"*
   - *"Casing Samsung S24 motif apa aja yang ada?"*

---

### 4. Uji Coba Web Testing Dashboard Lokal
Jalankan dev server Cloudflare Worker:
```bash
npm run dev
```
Buka browser di [http://localhost:8787](http://localhost:8787). Anda akan melihat UI interaktif untuk menguji respons RAG, melihat data stok, dan melihat foto produk. Halaman [http://localhost:8787/prompts](http://localhost:8787/prompts) menyediakan Prompt Lab untuk lima prompt Tahap 1.

---

### 5. Monitoring & Input Stok via Web
Buka [http://localhost:8787/monitor](http://localhost:8787/monitor) saat `npm run dev` berjalan.

Halaman monitoring menyediakan:
- Ringkasan total SKU, total unit, stok rendah (≤ 15), dan stok habis.
- Daftar 35+ tipe iPhone dengan pencarian dan filter.
- Tombol cepat `−1` / `+1`, serta tombol **Atur** untuk mengisi stok fisik secara absolut.
- Form **Tambah Tipe** untuk model iPhone baru.
- Riwayat 30 perubahan terakhir beserta catatan dan admin yang mengubah.
- Tombol **Export CSV** dan **Sync RAG** (sinkron ulang Vectorize).

Stok disimpan di Cloudflare D1 (`stock_items`) dan setiap perubahan dicatat di `stock_mutations`. Bot Telegram, endpoint `/api/chat`, dan dashboard membaca sumber data yang sama.

**Login dashboard** memakai HTTP Basic Auth:
- Lokal: jika `ADMIN_PASSWORD` kosong, akses dari `localhost` diizinkan.
- Produksi: wajib set secret `ADMIN_PASSWORD` (dan opsional `ADMIN_USER`, default `admin`).
```bash
npx wrangler secret put ADMIN_PASSWORD
```

---

### 6. Lima Prompt Tahap 1 (Bot + API + Prompt Lab)
Lima prompt formatif sudah terpasang di bot dan bisa diuji tanpa mengubah kode:

| # | Prompt | Perintah Telegram | API `id` |
|---|---|---|---|
| 1 | Prioritas restock (zero-shot) | `/restock` atau `/restock 20` | `restock` |
| 2 | Normalisasi variasi “Tipe Hp” (few-shot) | `/normalisasi Iphone 14 Mini, XR` | `normalisasi` |
| 3 | Audit judul & variasi vs stok (CoT) | `/audit Judul... \| Iphone 15, Iphone 14 Mini` | `audit` |
| 4 | Ekstraksi listing ke JSON (structured output) | `/extract IP-JOYFUL-0001` | `extract` |
| 5 | Audit Total = stok + tambahan | `/konsistensi` atau `/konsistensi total=48 stok=45 tambahan=2` | `konsistensi` |

Menu bantuan di bot: `/prompts`. Tanpa argumen, bot memakai data demo dari katalog/stok saat ini.

Uji lewat API:
```bash
curl https://rag-tele-cf.<subdomain>.workers.dev/api/prompts

curl -X POST https://rag-tele-cf.<subdomain>.workers.dev/api/prompts/run \
  -H 'Content-Type: application/json' \
  -d '{"id":"konsistensi","input":"total=48 stok=45 tambahan=2"}'
```

Untuk tampilan web, deploy folder `web/` ke Vercel (lihat bagian **Deploy Frontend ke Vercel**), lalu buka `/prompts`.

Uji cepat semua prompt dari terminal:
```bash
npm run test:prompts
```

Uji format pesan bot Telegram (panjang, tag HTML, dan emoji):
```bash
npm run test:telegram
```

---

### 7. Uji Cepat API RAG
```bash
curl -X POST http://localhost:8787/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"query":"Berapa stok iPhone 15 Pro Max?"}'
```
Respons berisi `answer`, `sources`, dan `topProductPhoto` (jika ada foto produk yang cocok).

---

## ☁️ Panduan Deploy ke Cloudflare Workers & Vectorize

### Langkah 1: Login ke Cloudflare
```bash
npx wrangler login
```

### Langkah 2: Buat Vector Database (Cloudflare Vectorize)
Buat index vector bernama `rag-tele-index` dengan dimensi 1024 (sesuai embedding model `@cf/baai/bge-m3`):
```bash
npx wrangler vectorize create rag-tele-index --dimensions=1024 --metric=cosine
```

### Langkah 3: Upload Vektor Dokumen ke Vectorize
Masukkan `CLOUDFLARE_ACCOUNT_ID` dan `CLOUDFLARE_API_TOKEN` ke file `.env`, lalu jalankan:
```bash
npm run upload:vectorize
```

### Langkah 4: Buat Database D1 untuk Stok
Buat database stok, lalu salin `database_id` yang muncul ke binding `DB` di `wrangler.jsonc`:
```bash
npx wrangler d1 create rag-tele-stock
```
Tabel dan seed 35 tipe iPhone dibuat otomatis oleh Worker saat pertama kali diakses. Untuk membuatnya manual:
```bash
npm run db:migrate:remote
```

### Langkah 5: Set Secret Bot Token & Dashboard
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
# (Masukkan token bot Telegram Anda saat diminta)

npx wrangler secret put ADMIN_PASSWORD
# (Masukkan password untuk halaman /monitor)
```

Jika ingin menggunakan secret token webhook:
```bash
npx wrangler secret put TELEGRAM_SECRET_TOKEN
# (Masukkan string acak, misalnya hasil: openssl rand -hex 24)
```

### Langkah 6: Deploy Worker
```bash
npm run typecheck
npm run deploy
```
Wrangler akan memberikan URL publik worker Anda, misalnya:  
`https://rag-tele-cf.<subdomain>.workers.dev`

### Langkah 7: Pasang Webhook Telegram ke Cloudflare Worker
Arahkan webhook Telegram ke URL worker Anda. Jika memakai `TELEGRAM_SECRET_TOKEN`, sertakan juga di parameter `secret_token`:
```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://rag-tele-cf.<subdomain>.workers.dev/webhook",
    "secret_token": "<TELEGRAM_SECRET_TOKEN>"
  }'
```

Cek status webhook:
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

Selesai! Sekarang Telegram Bot Anda aktif 24/7 di serverless Cloudflare Edge tanpa perlu server menyala, dan stok bisa dikelola dari halaman `/monitor`. 🎉

---

## ▲ Deploy Frontend ke Vercel

Frontend statis di folder `web/` bisa dipisahkan dari backend Cloudflare. AI, Vectorize, D1, dan webhook Telegram **tetap** di Cloudflare Worker.

### Opsi A — Vercel CLI (dari root repo)
```bash
npx vercel login
npx vercel --prod
```
Saat diminta:
- **Set up and deploy**: `Y`
- **Which scope**: pilih akun Anda
- **Link to existing project?**: `N` (atau `Y` bila sudah pernah)
- **Project name**: `flazzstore-rag` (bebas)
- **In which directory is your code located?**: `./` (root repo, bukan `web/`)
- **Want to modify these settings?**: `N`

`vercel.json` sudah mengatur `outputDirectory: "web"` dan mematikan install/build yang tidak perlu. File `.vercelignore` juga mengecualikan `.env`, `.dev.vars`, dan `note` agar kredensial tidak ikut terunggah. Setelah selesai, buka:
- `https://<project>.vercel.app/` — chat
- `https://<project>.vercel.app/monitor` — monitoring stok
- `https://<project>.vercel.app/prompts` — Prompt Lab

### Opsi B — Vercel Dashboard
1. Import repository GitHub.
2. **Root Directory**: root repo (tempat `vercel.json`), **bukan** `web/`.
3. Framework Preset: **Other**.
4. Build Command: kosongkan / `echo "static"`.
5. Output Directory: `web`.
6. Deploy.

### Konfigurasi API Base
Frontend memanggil Worker melalui `window.FLAZZ_API_BASE` di [`web/config.js`](./web/config.js):
```js
window.FLAZZ_API_BASE = "https://rag-tele-cf.rizki210605.workers.dev";
window.FLAZZ_BOT_URL = "https://t.me/ragteleshofiyanbot";
```
Ganti URL bila Worker dipindah ke domain lain, lalu redeploy Vercel. Worker sudah mengirim header CORS `Access-Control-Allow-Origin: *`, termasuk pada respons login 401/503, sehingga dashboard bisa memakai Basic Auth dari domain Vercel.

> **Catatan:** login monitoring memakai HTTP Basic Auth. Browser akan mengirim kredensial setelah pengguna memasukkan username/password di form login dashboard; kredensial disimpan di `sessionStorage`, bukan di source code.

---

## 📂 Struktur Proyek

```
rag-tele/
├── resource/
│   ├── STOCK CASING - iPhone.pdf   # Data stok fisik iPhone Flazzstore
│   └── model.xlsx                  # Data 1.114 katalog casing custom
├── data/
│   ├── stock_iphone.json           # Hasil parse 35 model stok iPhone
│   ├── knowledge_base.json         # Master database terstruktur
│   ├── knowledge_base_compact.json # Database ringan untuk bundling Worker
│   └── rag_documents.json          # 1.150 dokumen chunk RAG untuk Vectorize
├── scripts/
│   ├── ingest.py                   # Script ekstraksi PDF & Excel
│   ├── test_rag.py                 # CLI tester RAG
│   ├── test_prompts.ts             # Uji lima prompt Tahap 1
│   ├── local_bot.py                # Runner bot Telegram mode polling lokal
│   └── upload_to_vectorize.ts      # Pengunggah embeddings ke Cloudflare Vectorize
├── migrations/
│   └── 0001_stock.sql              # Skema D1: stock_items + stock_mutations
├── src/
│   ├── index.ts                    # Cloudflare Worker router & Web UI
│   ├── rag.ts                      # Mesin RAG (Vectorize + Workers AI Llama 3.3)
│   ├── stock.ts                    # Repository stok D1, seed, audit trail
│   ├── dashboard.ts                # Halaman /monitor (monitoring & input stok)
│   ├── prompts.ts                  # Lima prompt Tahap 1 + runner deterministik
│   ├── telegram.ts                 # Klien API Telegram (pesan, foto, typing)
│   └── types.ts                    # TypeScript definitions
├── web/
│   ├── config.js                   # API base Cloudflare untuk frontend Vercel
│   ├── index.html                  # Chat frontend
│   ├── monitor.html                # Dashboard monitoring stok
│   └── prompts.html                # Prompt Lab lima prompt
├── PROMPTS.md                      # Dokumentasi lima entri prompt + rubrik
├── vercel.json                     # Konfigurasi deploy frontend statis
├── wrangler.jsonc                  # Konfigurasi Cloudflare Workers, AI, Vectorize
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```
