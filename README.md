# 📱 RAG Telegram Bot x Cloudflare Workers AI & Vectorize

Sistem **RAG (Retrieval-Augmented Generation)** cerdas yang terintegrasi penuh antara **Cloudflare** (Workers AI + Vectorize) dan **Telegram Bot**, menggunakan data inventaris stok fisik gudang dan katalog produk custom case handphone dari folder `resource/`.

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
|  - Cloudflare Workers AI (LLaMA 3.1)  |   |  - Langsung konek ke Telegram Bot     |
|  - Fallback Hybrid Keyword Matching   |   |  - Cocok untuk uji coba tanpa domain  |
+-------------------+-------------------+   +-------------------+-------------------+
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
6. **Web Dashboard Uji Coba**: Tersedia UI chat interaktif di browser lokal (`http://localhost:8787`).

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
Buka browser di [http://localhost:8787](http://localhost:8787). Anda akan melihat UI interaktif untuk menguji respons RAG, melihat data stok, dan melihat foto produk.

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

### Langkah 4: Set Secret Bot Token di Cloudflare
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
# (Masukkan token bot Telegram Anda saat diminta)
```

Jika ingin menggunakan secret token webhook:
```bash
npx wrangler secret put TELEGRAM_SECRET_TOKEN
```

### Langkah 5: Deploy Worker
```bash
npm run deploy
```
Wrangler akan memberikan URL publik worker Anda, misalnya:  
`https://rag-tele-cf.<subdomain>.workers.dev`

### Langkah 6: Pasang Webhook Telegram ke Cloudflare Worker
Arahkan webhook Telegram ke URL worker Anda:
```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://rag-tele-cf.<subdomain>.workers.dev/webhook"}'
```

Selesai! Sekarang Telegram Bot Anda aktif 24/7 di serverless Cloudflare Edge tanpa perlu server menyala! 🎉

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
│   ├── local_bot.py                # Runner bot Telegram mode polling lokal
│   └── upload_to_vectorize.ts      # Pengunggah embeddings ke Cloudflare Vectorize
├── src/
│   ├── index.ts                    # Cloudflare Worker router & Web UI
│   ├── rag.ts                      # Mesin RAG (Vectorize + Workers AI LLaMA 3.1)
│   ├── telegram.ts                 # Klien API Telegram (pesan, foto, typing)
│   └── types.ts                    # TypeScript definitions
├── wrangler.jsonc                  # Konfigurasi Cloudflare Workers, AI, Vectorize
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```
