# Lima Entri Prompt — Tahap 1 (Formatif)

Dokumen ini berisi lima entri prompt untuk pengujian tugas Flazzstore. Semua prompt sudah diimplementasikan di bot Telegram dan API Prompt Lab, sehingga bisa langsung dicoba.

**Sumber data**
- Stok: 35 tipe iPhone, total 1.373 unit (Cloudflare D1: `stock_items`)
- Katalog: 1.114 listing casing (Excel `resource/model.xlsx`)
- Variasi mentah: 158 nilai unik, termasuk anomali seperti `Iphone 14 Mini`, `Iphone 13 Plus`, `Iphone 18 Air`, `Iphone Duo`, dan `SE`

## Cara mencoba

### Di browser (paling cepat)
Buka **https://rag-tele.vercel.app/**, pilih salah satu dari lima kartu, isi input (atau biarkan default), lalu klik **Jalankan**. Hasil JSON muncul langsung di kartu.

### Di Telegram
Buka [@ragteleshofiyanbot](https://t.me/ragteleshofiyanbot), lalu kirim:

| Perintah | Prompt |
|---|---|
| `/restock` atau `/restock 20` | 1 — Prioritas restock |
| `/normalisasi Iphone 14 Mini, XR, Iphone16 Pro` | 2 — Normalisasi variasi |
| `/audit Judul listing... \| Iphone 15, Iphone 14 Mini` | 3 — Audit judul & variasi |
| `/extract IP-JOYFUL-0001` | 4 — Ekstraksi listing ke JSON |
| `/konsistensi` atau `/konsistensi total=48 stok=45 tambahan=2` | 5 — Audit konsistensi stok |

Tanpa argumen, bot memakai data demo dari katalog/stok saat ini. Menu lengkap: `/prompts`.

### Lewat API
```bash
# Daftar lima entri prompt
curl https://rag-tele-shofiyan.workers.dev/api/prompts

# Jalankan salah satu prompt
curl -X POST https://rag-tele-shofiyan.workers.dev/api/prompts/run \
  -H 'Content-Type: application/json' \
  -d '{"id":"restock","input":"15"}'
```

---

## Prompt 1 — Prioritas Restock (Zero-shot)

**Tujuan**  
Menentukan urutan tipe iPhone yang harus di-restock lebih dulu berdasarkan stok fisik, ambang batas, dan target buffer gudang.

**Teknik**  
Zero-shot. Model langsung diberi aturan prioritas dan format keluaran tanpa contoh input-output.

**Prompt lengkap**
```text
Anda adalah analis inventaris Flazzstore. Gunakan hanya data stok di bawah ini.

[STOK GUDANG]
{{STOCK_DATA}}

[ATURAN]
- P1 = stok 0-5 unit (kritis)
- P2 = stok 6-10 unit (rendah)
- P3 = stok 11-{{THRESHOLD}} unit (perhatian)
- Target buffer restock = 40 unit per tipe.
- Saran restock = max(0, 40 - stok saat ini).
- Urutkan P1 lebih dulu, lalu stok terkecil.

[TUGAS]
1. Identifikasi semua tipe dengan stok <= {{THRESHOLD}}.
2. Beri prioritas P1/P2/P3.
3. Hitung saran jumlah restock.
4. Jelaskan alasan singkat per tipe.
5. Kembalikan JSON dengan skema:
{
  "generated_at": "ISO-8601",
  "threshold": number,
  "total_models": number,
  "low_stock_count": number,
  "priorities": [
    {"priority": "P1", "model": "...", "stock": number, "status": "...", "suggested_restock": number, "reason": "..."}
  ]
}
```

**Contoh keluaran** (data aktual, threshold 15)
```json
{
  "threshold": 15,
  "low_stock_count": 5,
  "priorities": [
    {"priority": "P1", "model": "iPhone XS Max", "stock": 4, "suggested_restock": 36, "reason": "Stok kritis, di bawah 5 unit."},
    {"priority": "P2", "model": "iPhone 17 Pro Max MAGSF", "stock": 8, "suggested_restock": 32, "reason": "Stok rendah, perlu restock segera."},
    {"priority": "P3", "model": "iPhone 7 Plus", "stock": 14, "suggested_restock": 26, "reason": "Mendekati batas aman."},
    {"priority": "P3", "model": "iPhone X / XS", "stock": 14, "suggested_restock": 26, "reason": "Mendekati batas aman."},
    {"priority": "P3", "model": "iPhone 16e / 17e", "stock": 15, "suggested_restock": 25, "reason": "Mendekati batas aman."}
  ]
}
```

**Catatan evaluasi**
- Fokus: ketepatan ambang batas, urutan prioritas, dan alasan yang bisa ditindaklanjuti.
- Jangan mengarang stok di luar data.
- Rubrik:
  - **0** — Tidak menjawab atau stok/prioritas salah total.
  - **1** — Menyebut tipe yang benar, tetapi urutan/alasan/saran restock tidak konsisten.
  - **2** — Prioritas, alasan, dan saran restock benar; format JSON valid.
- Saran eksperimen: ubah threshold ke 10/20, bandingkan hasil; tambahkan data penjualan mingguan sebagai sinyal prioritas.

---

## Prompt 2 — Normalisasi Opsi Variasi “Tipe Hp” (Few-shot)

**Tujuan**  
Mengubah variasi mentah dari listing Shopee menjadi nama model iPhone baku, serta menandai variasi yang tidak valid atau tidak ada di stok.

**Teknik**  
Few-shot. Diberikan tiga contoh mapping (dua valid, satu invalid) agar format dan aturan konsisten.

**Prompt lengkap**
```text
Anda adalah data cleaner untuk katalog casing Flazzstore.

[DAFTAR MODEL BAKU]
{{CANONICAL_MODELS}}

[CONTOH]
Input: ["Iphone16 Pro", "XR", "Iphone 14 Mini"]
Output:
[
  {"raw": "Iphone16 Pro", "canonical": "iPhone 16 Pro", "status": "valid"},
  {"raw": "XR", "canonical": "iPhone XR", "status": "valid"},
  {"raw": "Iphone 14 Mini", "canonical": null, "status": "invalid", "nearest": "iPhone 13 Mini", "reason": "Apple tidak merilis iPhone 14 Mini."}
]

[ATURAN]
- Samakan penulisan "Iphone"/"iPhone", spasi, dan huruf besar-kecil.
- "XR" -> "iPhone XR"; "X"/"XS" -> "iPhone X / XS".
- "Iphone 12"/"Iphone 12 Pro" -> "iPhone 12/12 Pro".
- "Iphone 16e"/"Iphone 17e" -> "iPhone 16e / 17e".
- Variasi yang tidak ada di daftar baku harus status "invalid" dan diberi nearest jika ada.
- "Type Hp Lain Chat" bukan model; status "other".
- Jangan mengarang model baru.

[INPUT]
{{INPUT}}

[FORMAT]
{
  "total": number,
  "valid": number,
  "invalid": number,
  "other": number,
  "mappings": [
    {"raw": "...", "canonical": "... atau null", "status": "valid|invalid|other|unknown", "nearest": "... atau null", "reason": "...", "stok": number|null}
  ]
}
```

**Contoh keluaran** (`/normalisasi` tanpa argumen)
```json
{
  "total": 8,
  "valid": 2,
  "invalid": 5,
  "other": 1,
  "mappings": [
    {"raw": "Iphone 14 Mini", "canonical": null, "status": "invalid", "nearest": "iPhone 13 Mini", "stok": null, "nearest_stok": 27},
    {"raw": "Iphone 13 Plus", "canonical": null, "status": "invalid", "nearest": "iPhone 14 Plus", "stok": null, "nearest_stok": 38},
    {"raw": "Iphone 18 Air", "canonical": null, "status": "invalid", "nearest": "iPhone 17 Air", "stok": null, "nearest_stok": 28},
    {"raw": "Iphone Duo", "canonical": null, "status": "invalid", "nearest": null},
    {"raw": "Iphone16 Pro", "canonical": "iPhone 16 Pro", "status": "valid", "stok": 57},
    {"raw": "XR", "canonical": "iPhone XR", "status": "valid", "stok": 17},
    {"raw": "SE", "canonical": null, "status": "invalid", "nearest": null},
    {"raw": "Type Hp Lain Chat", "canonical": null, "status": "other"}
  ]
}
```

**Catatan evaluasi**
- Fokus: konsistensi ejaan, penanganan garis miring, dan penandaan model yang tidak pernah ada.
- Rubrik:
  - **0** — Banyak mapping salah atau model karangan.
  - **1** — Model valid benar, tetapi anomali tidak ditandai atau format tidak konsisten.
  - **2** — Semua mapping valid, anomali ditandai dengan nearest/reason yang tepat.
- Saran eksperimen: uji variasi `Iphone 16 pro max`, `Iphone X`, `Iphone 12 Pro`, dan `Iphone 18 Duo`.

---

## Prompt 3 — Audit Kecocokan Judul dan Variasi terhadap Stok (Chain-of-Thought)

**Tujuan**  
Memeriksa apakah model yang diklaim di judul listing benar-benar tersedia sebagai variasi dan memiliki stok, serta menemukan klaim yang menyesatkan.

**Teknik**  
Chain-of-Thought. Model diminta mengekstrak model dari judul, menormalisasi variasi, membandingkan, mengecek stok, lalu menyimpulkan.

**Prompt lengkap**
```text
Anda adalah auditor katalog Flazzstore. Lakukan audit bertahap (chain-of-thought) pada satu listing.

[DATA STOK]
{{STOCK_DATA}}

[LISTING]
Judul: {{TITLE}}
Variasi: {{VARIATIONS}}

[LANGKAH]
1. Ekstrak semua model iPhone yang diklaim di judul.
2. Normalisasi setiap variasi ke model baku.
3. Bandingkan: model di judul tetapi tidak ada di variasi; variasi tidak valid; variasi di luar judul.
4. Cek stok setiap model yang relevan.
5. Simpulkan apakah listing aman, perlu perbaikan judul, atau perlu perbaikan variasi.

[FORMAT JSON]
{
  "listing": {"judul": "...", "jumlah_variasi": number},
  "langkah": ["...", "..."],
  "model_di_judul": ["..."],
  "model_di_variasi": ["..."],
  "variasi_tidak_valid": [{"raw": "...", "alasan": "..."}],
  "klaim_tanpa_variasi": ["..."],
  "cek_stok": [{"model": "...", "stok": number, "status": "..."}],
  "temuan": ["..."],
  "verdict": "ok|perlu_perbaikan"
}
```

**Contoh keluaran** (default `IP-JOYFUL-0001`)
```json
{
  "model_di_judul": ["iPhone 18", "iPhone 17", "iPhone 16", "iPhone 15", "iPhone 14", "iPhone 13", "iPhone 12/12 Pro", "iPhone 11 Pro Max", "iPhone XR"],
  "klaim_tambahan_di_judul": ["Duo", "SE"],
  "variasi_tidak_valid": [
    {"raw": "Iphone Duo", "alasan": "iPhone Duo tidak ada di daftar stok."},
    {"raw": "Iphone 14 Mini", "alasan": "Apple tidak merilis iPhone 14 Mini."},
    {"raw": "Iphone 13 Plus", "alasan": "Tidak ada iPhone 13 Plus."}
  ],
  "klaim_tanpa_variasi": ["Duo", "SE"],
  "temuan": [
    "Ada 3 variasi tidak valid: Iphone Duo, Iphone 14 Mini, Iphone 13 Plus.",
    "Judul menyebut Duo, SE, tetapi tidak ada variasi/stok yang sesuai."
  ],
  "verdict": "perlu_perbaikan"
}
```

**Catatan evaluasi**
- Fokus: langkah audit harus terlihat, bukan hanya kesimpulan.
- Jangan menuduh listing salah hanya karena model tidak ada di stok jika model itu juga tidak diklaim di judul.
- Rubrik:
  - **0** — Tidak membandingkan judul, variasi, dan stok.
  - **1** — Menemukan sebagian anomali tanpa langkah audit yang jelas.
  - **2** — Langkah audit lengkap, temuan akurat, verdict dapat ditindaklanjuti.
- Saran eksperimen: bandingkan listing yang judulnya menyebut `iPhone 18` tetapi variasi hanya sampai `iPhone 17`.

---

## Prompt 4 — Ekstraksi Listing ke JSON (Structured Output)

**Tujuan**  
Mengubah satu listing Shopee menjadi JSON bersih yang siap masuk ke database katalog, lengkap dengan daftar variasi dan anomali.

**Teknik**  
Structured Output. Skema JSON wajib diberikan, termasuk aturan nilai null dan array kosong.

**Prompt lengkap**
```text
Anda adalah ekstraktor data katalog casing Flazzstore.

[INPUT LISTING]
{{INPUT}}

[SKEMA WAJIB]
{
  "sku": "string|null",
  "nama_produk": "string",
  "brand": "string|null",
  "foto": "url|null",
  "jumlah_variasi": number,
  "variasi_tipe_hp": ["string"],
  "model_terdeteksi": ["string"],
  "anomali": [{"raw": "string", "alasan": "string"}]
}

[ATURAN]
- Jangan menambah field di luar skema.
- Jika data tidak tersedia, gunakan null atau array kosong.
- "model_terdeteksi" hanya berisi model baku yang match dengan stok.
- "anomali" berisi variasi yang tidak valid atau tidak ada di stok.
- Kembalikan JSON valid tanpa penjelasan tambahan.
```

**Contoh keluaran** (`/extract IP-JOYFUL-0001`)
```json
{
  "sku": "IP-JOYFUL-0001",
  "nama_produk": "Case Casing iPhone 18 17 16 15 14 13 12 11 Pro Max Duo Plus Air Mini XR SE Hybrid Custom Joyful Doodle",
  "brand": "iPhone",
  "foto": "https://cf.shopee.co.id/file/...",
  "jumlah_variasi": 35,
  "variasi_tipe_hp": ["Iphone 18 Pro Max", "Iphone 18 Pro", "Iphone 18", "..."],
  "model_terdeteksi": ["iPhone 18 Pro Max", "iPhone 18 Pro", "iPhone 18", "..."],
  "anomali": [
    {"raw": "Iphone Duo", "alasan": "iPhone Duo tidak ada di daftar stok."},
    {"raw": "Iphone 14 Mini", "alasan": "Apple tidak merilis iPhone 14 Mini."}
  ]
}
```

**Catatan evaluasi**
- Fokus: validitas JSON dan kelengkapan field wajib.
- Rubrik:
  - **0** — JSON tidak valid atau field wajib hilang.
  - **1** — JSON valid tetapi ada field salah/karangan.
  - **2** — JSON valid, semua field wajib terisi, anomali terdeteksi.
- Saran eksperimen: uji dengan teks listing bebas, bukan hanya SKU, untuk melihat kualitas ekstraksi heuristik.

---

## Prompt 5 — Audit Konsistensi Stok: Total = Stok + Tambahan (CoT + Structured Output)

**Tujuan**  
Memverifikasi bahwa angka total stok pada setiap baris sama dengan stok awal ditambah tambahan, serta melaporkan selisihnya.

**Teknik**  
Chain-of-Thought + Structured Output. Model menghitung per baris, mengumpulkan selisih, lalu mengembalikan JSON.

**Prompt lengkap**
```text
Anda adalah auditor inventaris Flazzstore.

[DATA STOK]
{{STOCK_DATA}}

[ATURAN]
- Total harus sama dengan stok + tambahan.
- Hitung selisih = total - (stok + tambahan) untuk setiap baris.
- Tandai baris yang tidak konsisten.
- Jangan mengubah data; hanya laporkan.

[LANGKAH]
1. Baca setiap baris stok.
2. Hitung stok + tambahan.
3. Bandingkan dengan total.
4. Kumpulkan baris yang selisihnya bukan 0.
5. Beri kesimpulan.

[FORMAT JSON]
{
  "checked": number,
  "consistent": boolean,
  "discrepancies": [
    {"model": "...", "stok": number, "tambahan": number, "total": number, "selisih": number}
  ],
  "summary": {"total_units": number, "checked_models": number}
}
```

**Contoh keluaran** (`/konsistensi` — data aktual)
```json
{
  "checked": 35,
  "consistent": true,
  "discrepancies": [],
  "summary": {"total_units": 1373, "checked_models": 35}
}
```

**Contoh ketidaksesuaian** (`/konsistensi total=48 stok=45 tambahan=2`)
```json
{
  "checked": 1,
  "consistent": false,
  "discrepancies": [
    {"model": "Input manual", "stok": 45, "tambahan": 2, "total": 48, "selisih": 1}
  ],
  "summary": {"total_units": 48, "checked_models": 1}
}
```

**Catatan evaluasi**
- Fokus: aritmetika benar dan discrepancies akurat.
- Jangan memaksakan temuan palsu jika semua baris konsisten.
- Rubrik:
  - **0** — Salah hitung atau mengubah data.
  - **1** — Menemukan ketidaksesuaian tetapi tanpa rincian selisih.
  - **2** — Semua baris dihitung benar, discrepancies akurat, format JSON valid.
- Saran eksperimen: uji dengan data yang sengaja dimanipulasi (`total=50 stok=45 tambahan=2`) untuk memastikan deteksi selisih.

---

## Ringkasan Implementasi

| # | Prompt | Perintah bot | Endpoint API (`id`) |
|---|---|---|---|
| 1 | Prioritas restock | `/restock [threshold]` | `restock` |
| 2 | Normalisasi variasi | `/normalisasi [daftar]` | `normalisasi` |
| 3 | Audit judul & variasi | `/audit [judul \| variasi]` | `audit` |
| 4 | Ekstraksi listing | `/extract [teks/SKU]` | `extract` |
| 5 | Konsistensi stok | `/konsistensi [model/total=...]` | `konsistensi` |

Output bot berupa teks ringkas + JSON di dalam `<pre>`, sedangkan API mengembalikan `data` terstruktur dan `text` siap tampil.
