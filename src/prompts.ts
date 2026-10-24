import knowledgeBase from "../data/knowledge_base_compact.json";
import { ProductItem, StockItem, StockMap } from "./types";

interface CompactKB {
  stock: StockMap;
  products: ProductItem[];
}

const kb = knowledgeBase as unknown as CompactKB;
const DEFAULT_PRODUCT_SKU = "IP-JOYFUL-0001";

export type PromptId =
  | "restock"
  | "normalisasi"
  | "audit"
  | "extract"
  | "konsistensi";

export interface PromptEntry {
  id: PromptId;
  number: number;
  title: string;
  technique: string;
  goal: string;
  prompt: string;
  exampleOutput: string;
  evaluationNotes: string;
  rubric: string[];
}

export interface PromptRunResult {
  entry: PromptEntry;
  text: string;
  data: any;
}

export const DEFAULT_NORMALIZATION_INPUT = [
  "Iphone 14 Mini",
  "Iphone 13 Plus",
  "Iphone 18 Air",
  "Iphone Duo",
  "Iphone16 Pro",
  "XR",
  "SE",
  "Type Hp Lain Chat",
];

/* ------------------------------------------------------------------ */
/* Prompt entries (Tahap 1)                                            */
/* ------------------------------------------------------------------ */

export const PROMPT_ENTRIES: PromptEntry[] = [
  {
    id: "restock",
    number: 1,
    title: "Prioritas Restock Casing iPhone",
    technique: "Zero-shot",
    goal:
      "Menentukan urutan tipe iPhone yang harus di-restock lebih dulu berdasarkan stok fisik saat ini, ambang batas, dan target buffer gudang.",
    prompt: `Anda adalah analis inventaris Flazzstore. Gunakan hanya data stok di bawah ini.

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
}`,
    exampleOutput: `{
  "threshold": 15,
  "low_stock_count": 5,
  "priorities": [
    {"priority": "P1", "model": "iPhone XS Max", "stock": 4, "suggested_restock": 36, "reason": "Stok kritis, di bawah 5 unit."},
    {"priority": "P2", "model": "iPhone 17 Pro Max MAGSF", "stock": 8, "suggested_restock": 32, "reason": "Stok rendah, perlu restock segera."},
    {"priority": "P3", "model": "iPhone X / XS", "stock": 14, "suggested_restock": 26, "reason": "Mendekati batas aman."}
  ]
}`,
    evaluationNotes:
      "Fokus penilaian: ketepatan ambang batas, urutan prioritas, dan alasan yang bisa ditindaklanjuti. Model tidak boleh mengarang stok di luar data.",
    rubric: [
      "0 — Tidak menjawab atau stok/prioritas salah total.",
      "1 — Menyebut tipe yang benar tetapi urutan/alasan/saran restock tidak konsisten.",
      "2 — Prioritas, alasan, dan saran restock benar serta format JSON valid.",
    ],
  },
  {
    id: "normalisasi",
    number: 2,
    title: "Normalisasi Opsi Variasi “Tipe Hp”",
    technique: "Few-shot",
    goal:
      "Mengubah variasi mentah dari listing Shopee menjadi nama model iPhone yang baku, serta menandai variasi yang tidak valid atau tidak ada di stok.",
    prompt: `Anda adalah data cleaner untuk katalog casing Flazzstore.

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
}`,
    exampleOutput: `{
  "total": 3,
  "valid": 2,
  "invalid": 1,
  "other": 0,
  "mappings": [
    {"raw": "Iphone16 Pro", "canonical": "iPhone 16 Pro", "status": "valid", "stok": 57},
    {"raw": "XR", "canonical": "iPhone XR", "status": "valid", "stok": 17},
    {"raw": "Iphone 14 Mini", "canonical": null, "status": "invalid", "nearest": "iPhone 13 Mini", "stok": null, "reason": "Apple tidak merilis iPhone 14 Mini."}
  ]
}`,
    evaluationNotes:
      "Few-shot membantu konsistensi format. Perhatikan kasus ejaan tanpa spasi, garis miring, dan model yang tidak pernah ada.",
    rubric: [
      "0 — Banyak mapping salah atau model karangan.",
      "1 — Model valid benar, tetapi anomali tidak ditandai atau format tidak konsisten.",
      "2 — Semua mapping valid, anomali ditandai dengan nearest/reason yang tepat.",
    ],
  },
  {
    id: "audit",
    number: 3,
    title: "Audit Kecocokan Judul dan Variasi terhadap Stok",
    technique: "Chain-of-Thought",
    goal:
      "Memeriksa apakah model yang diklaim di judul listing benar-benar tersedia sebagai variasi dan memiliki stok, serta menemukan klaim yang menyesatkan.",
    prompt: `Anda adalah auditor katalog Flazzstore. Lakukan audit bertahap (chain-of-thought) pada satu listing.

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
}`,
    exampleOutput: `{
  "listing": {"judul": "Case Casing iPhone 18 17 16 ... SE Hybrid Custom Joyful Doodle", "jumlah_variasi": 35},
  "langkah": [
    "Model di judul: iPhone 18, 17, 16, 15, 14, 13, 12/12 Pro, 11, XR; klaim tambahan: Duo, SE.",
    "Variasi tidak valid: Iphone Duo, Iphone 14 Mini, Iphone 13 Plus.",
    "SE dan Duo disebut di judul tetapi tidak memiliki variasi/stok yang sesuai."
  ],
  "variasi_tidak_valid": [
    {"raw": "Iphone Duo", "alasan": "Tidak ada di daftar stok."},
    {"raw": "Iphone 14 Mini", "alasan": "Apple tidak merilis iPhone 14 Mini."},
    {"raw": "Iphone 13 Plus", "alasan": "Tidak ada iPhone 13 Plus."}
  ],
  "klaim_tanpa_variasi": ["SE", "Duo"],
  "cek_stok": [{"model": "iPhone 18", "stok": 20, "status": "Stok Sedang"}],
  "temuan": ["Judul menjanjikan SE/Duo yang tidak tersedia.", "Ada 3 variasi tidak valid."],
  "verdict": "perlu_perbaikan"
}`,
    evaluationNotes:
      "Chain-of-thought harus terlihat sebagai langkah audit, bukan sekadar kesimpulan. Pastikan tidak menuduh listing salah jika model hanya tidak ada di stok tetapi memang bukan klaim judul.",
    rubric: [
      "0 — Tidak membandingkan judul, variasi, dan stok.",
      "1 — Menemukan sebagian anomali tanpa langkah audit yang jelas.",
      "2 — Langkah audit lengkap, temuan akurat, verdict dapat ditindaklanjuti.",
    ],
  },
  {
    id: "extract",
    number: 4,
    title: "Ekstraksi Listing ke JSON",
    technique: "Structured Output",
    goal:
      "Mengubah satu listing Shopee menjadi JSON bersih yang siap masuk ke database katalog, lengkap dengan daftar variasi dan anomali.",
    prompt: `Anda adalah ekstraktor data katalog casing Flazzstore.

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
- Kembalikan JSON valid tanpa penjelasan tambahan.`,
    exampleOutput: `{
  "sku": "IP-JOYFUL-0001",
  "nama_produk": "Case Casing iPhone 18 17 16 15 14 13 12 11 Pro Max Duo Plus Air Mini XR SE Hybrid Custom Joyful Doodle",
  "brand": "iPhone",
  "foto": "https://cf.shopee.co.id/file/...",
  "jumlah_variasi": 35,
  "variasi_tipe_hp": ["Iphone 18 Pro Max", "Iphone 18 Pro", "Iphone 18", "..."],
  "model_terdeteksi": ["iPhone 18 Pro Max", "iPhone 18 Pro", "iPhone 18", "..."],
  "anomali": [
    {"raw": "Iphone Duo", "alasan": "Tidak ada di daftar stok."},
    {"raw": "Iphone 14 Mini", "alasan": "Apple tidak merilis iPhone 14 Mini."}
  ]
}`,
    evaluationNotes:
      "Nilai konsistensi skema, bukan panjang jawaban. JSON harus bisa langsung di-parse dan field wajib tidak boleh hilang.",
    rubric: [
      "0 — JSON tidak valid atau field wajib hilang.",
      "1 — JSON valid tetapi ada field salah/karangan.",
      "2 — JSON valid, semua field wajib terisi, anomali terdeteksi.",
    ],
  },
  {
    id: "konsistensi",
    number: 5,
    title: "Audit Konsistensi Stok: Total = Stok + Tambahan",
    technique: "Chain-of-Thought + Structured Output",
    goal:
      "Memverifikasi bahwa angka total stok pada setiap baris sama dengan stok awal ditambah tambahan, serta melaporkan selisihnya.",
    prompt: `Anda adalah auditor inventaris Flazzstore.

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
}`,
    exampleOutput: `{
  "checked": 35,
  "consistent": true,
  "discrepancies": [],
  "summary": {"total_units": 1373, "checked_models": 35}
}`,
    evaluationNotes:
      "Gunakan aritmetika sederhana dan tampilkan baris yang diperiksa. Jika semua konsisten, jangan memaksakan temuan palsu.",
    rubric: [
      "0 — Salah hitung atau mengubah data.",
      "1 — Menemukan ketidaksesuaian tetapi tanpa rincian selisih.",
      "2 — Semua baris dihitung benar, discrepancies akurat, format JSON valid.",
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function normalizeKey(value: string): string {
  return String(value)
    .toLowerCase()
    .replace(/iphone/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildCanonicalIndex(stockMap: StockMap): Map<string, string> {
  const index = new Map<string, string>();
  for (const model of Object.keys(stockMap)) {
    index.set(normalizeKey(model), model);
    index.set(normalizeKey(model.replace(/^iphone\s*/i, "")), model);
  }
  const aliases: Record<string, string> = {
    x: "iPhone X / XS",
    xs: "iPhone X / XS",
    xr: "iPhone XR",
    "12": "iPhone 12/12 Pro",
    "12 pro": "iPhone 12/12 Pro",
    "16e": "iPhone 16e / 17e",
    "17e": "iPhone 16e / 17e",
  };
  for (const [alias, model] of Object.entries(aliases)) {
    if (stockMap[model]) index.set(alias, model);
  }
  return index;
}

function findDefaultProduct(): ProductItem {
  return (
    kb.products.find((p) => p.sku === DEFAULT_PRODUCT_SKU) ||
    kb.products[0]
  );
}

function findProduct(input: string): ProductItem | null {
  const text = String(input || "").trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  const bySku = kb.products.find((p) => p.sku && lower.includes(p.sku.toLowerCase()));
  if (bySku) return bySku;

  const byId = kb.products.find((p) => p.id && lower.includes(p.id.toLowerCase()));
  if (byId) return byId;

  return (
    kb.products.find((p) => lower.includes(p.name.toLowerCase())) ||
    kb.products.find((p) => p.name.toLowerCase().includes(lower) && lower.length >= 12) ||
    null
  );
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function stockFor(stockMap: StockMap, canonical: string | null): StockItem | null {
  if (!canonical) return null;
  return stockMap[canonical] || null;
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

interface NormalizedVariation {
  raw: string;
  canonical: string | null;
  status: "valid" | "invalid" | "other" | "unknown";
  nearest: string | null;
  reason: string;
  stok: number | null;
  stock_status: string | null;
  nearest_stok?: number | null;
}

const INVALID_RULES: Array<{
  test: RegExp;
  nearest: string | null;
  reason: string;
}> = [
  {
    test: /(^|\s)14\s*mini(\s|$)/,
    nearest: "iPhone 13 Mini",
    reason: "Apple tidak merilis iPhone 14 Mini; model Mini terdekat adalah iPhone 13 Mini.",
  },
  {
    test: /(^|\s)13\s*plus(\s|$)/,
    nearest: "iPhone 14 Plus",
    reason: "Tidak ada iPhone 13 Plus; opsi Plus terdekat adalah iPhone 14 Plus.",
  },
  {
    test: /(^|\s)18\s*air(\s|$)/,
    nearest: "iPhone 17 Air",
    reason: "iPhone 18 Air tidak ada di stok; model Air terdekat adalah iPhone 17 Air.",
  },
  {
    test: /(^|\s)duo(\s|$)/,
    nearest: null,
    reason: "iPhone Duo tidak ada di daftar stok.",
  },
  {
    test: /(^|\s)se(\s|$)/,
    nearest: null,
    reason: "iPhone SE tidak ada di daftar stok.",
  },
];

export function normalizeVariation(
  raw: string,
  stockMap: StockMap
): NormalizedVariation {
  const text = String(raw || "").trim();
  const key = normalizeKey(text);
  const index = buildCanonicalIndex(stockMap);

  if (!key) {
    return {
      raw: text,
      canonical: null,
      status: "unknown",
      nearest: null,
      reason: "Nilai variasi kosong.",
      stok: null,
      stock_status: null,
    };
  }

  if (key === "type hp lain chat") {
    return {
      raw: text,
      canonical: null,
      status: "other",
      nearest: null,
      reason: "Bukan model iPhone; opsi chat untuk tipe lain.",
      stok: null,
      stock_status: null,
    };
  }

  for (const rule of INVALID_RULES) {
    if (rule.test.test(key)) {
      const nearestStock = stockFor(stockMap, rule.nearest);
      return {
        raw: text,
        canonical: null,
        status: "invalid",
        nearest: rule.nearest,
        reason: rule.reason,
        stok: null,
        stock_status: null,
        nearest_stok: nearestStock ? nearestStock.total_stock : null,
      };
    }
  }

  const exact = index.get(key);
  if (exact) {
    const stock = stockFor(stockMap, exact);
    return {
      raw: text,
      canonical: exact,
      status: "valid",
      nearest: null,
      reason: "Cocok dengan model baku.",
      stok: stock ? stock.total_stock : null,
      stock_status: stock ? stock.status : null,
    };
  }

  // Fuzzy match: cari key baku terpanjang yang menjadi bagian dari input.
  const candidates = Array.from(index.entries())
    .filter(([candidate]) => candidate.length >= 2 && (` ${key} `).includes(` ${candidate} `))
    .sort((a, b) => b[0].length - a[0].length);

  if (candidates.length > 0) {
    const canonical = candidates[0][1];
    const stock = stockFor(stockMap, canonical);
    return {
      raw: text,
      canonical,
      status: "valid",
      nearest: null,
      reason: "Dicocokkan dengan model baku terdekat.",
      stok: stock ? stock.total_stock : null,
      stock_status: stock ? stock.status : null,
    };
  }

  return {
    raw: text,
    canonical: null,
    status: "unknown",
    nearest: null,
    reason: "Tidak cocok dengan model baku mana pun.",
    stok: null,
    stock_status: null,
  };
}

function normalizeList(
  values: string[],
  stockMap: StockMap
): NormalizedVariation[] {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, 80)
    .map((value) => normalizeVariation(value, stockMap));
}

/* ------------------------------------------------------------------ */
/* Title model extraction                                              */
/* ------------------------------------------------------------------ */

function modelAliases(model: string): string[] {
  const short = model.replace(/^iphone\s*/i, "");
  const aliases = [short];
  if (short.includes("/")) {
    for (const part of short.split("/")) aliases.push(part.trim());
  }
  return unique(aliases.map(normalizeKey).filter((a) => a.length >= 1));
}

function extractModelsFromTitle(title: string, stockMap: StockMap): string[] {
  const tokens = normalizeKey(title).split(" ").filter(Boolean);
  const matches: Array<{
    start: number;
    end: number;
    length: number;
    model: string;
  }> = [];

  for (const model of Object.keys(stockMap)) {
    for (const alias of modelAliases(model)) {
      const parts = alias.split(" ").filter(Boolean);
      if (parts.length === 0) continue;
      for (let i = 0; i <= tokens.length - parts.length; i += 1) {
        let matched = true;
        for (let j = 0; j < parts.length; j += 1) {
          if (tokens[i + j] !== parts[j]) {
            matched = false;
            break;
          }
        }
        if (matched) {
          matches.push({
            start: i,
            end: i + parts.length,
            length: parts.length,
            model,
          });
        }
      }
    }
  }

  // Pilih klaim terpanjang pada posisi yang sama agar "iPhone 15 Pro Max"
  // tidak ikut dihitung sebagai "iPhone 15" atau "iPhone 15 Pro".
  matches.sort((a, b) => a.start - b.start || b.length - a.length);
  const selected: typeof matches = [];
  for (const match of matches) {
    const overlaps = selected.some(
      (item) => match.start < item.end && item.start < match.end
    );
    if (!overlaps) selected.push(match);
  }

  return unique(
    selected.sort((a, b) => a.start - b.start).map((match) => match.model)
  );
}

function extractUnknownTitleClaims(title: string): string[] {
  const key = ` ${normalizeKey(title)} `;
  const claims: string[] = [];
  if (key.includes(" 14 mini ")) claims.push("iPhone 14 Mini");
  if (key.includes(" 13 plus ")) claims.push("iPhone 13 Plus");
  if (key.includes(" 18 air ")) claims.push("iPhone 18 Air");
  if (key.includes(" duo ")) claims.push("Duo");
  if (key.includes(" se ")) claims.push("SE");
  return unique(claims);
}

/* ------------------------------------------------------------------ */
/* Prompt 1 — Restock                                                  */
/* ------------------------------------------------------------------ */

function runRestock(stockItems: StockItem[], threshold: number): any {
  const safeThreshold = Number.isFinite(threshold) ? Math.max(1, Math.min(200, Math.round(threshold))) : 15;
  const priorities = stockItems
    .filter((item) => item.total_stock <= safeThreshold)
    .sort((a, b) => a.total_stock - b.total_stock || a.model.localeCompare(b.model))
    .map((item) => {
      const priority = item.total_stock <= 5 ? "P1" : item.total_stock <= 10 ? "P2" : "P3";
      const suggested = Math.max(0, 40 - item.total_stock);
      const reason =
        item.total_stock <= 0
          ? "Stok habis; tidak bisa menerima pesanan."
          : item.total_stock <= 5
            ? "Stok kritis, di bawah 5 unit."
            : item.total_stock <= 10
              ? "Stok rendah, perlu restock segera."
              : "Mendekati batas aman; siapkan restock.";
      return {
        priority,
        model: item.model,
        stock: item.total_stock,
        status: item.status,
        suggested_restock: suggested,
        reason,
      };
    });

  return {
    generated_at: new Date().toISOString(),
    threshold: safeThreshold,
    total_models: stockItems.length,
    total_units: stockItems.reduce((sum, item) => sum + item.total_stock, 0),
    low_stock_count: priorities.length,
    priorities,
  };
}

/* ------------------------------------------------------------------ */
/* Prompt 2 — Normalisation                                            */
/* ------------------------------------------------------------------ */

function runNormalisasi(values: string[], stockMap: StockMap): any {
  const mappings = normalizeList(values, stockMap);
  return {
    total: mappings.length,
    valid: mappings.filter((m) => m.status === "valid").length,
    invalid: mappings.filter((m) => m.status === "invalid").length,
    other: mappings.filter((m) => m.status === "other").length,
    unknown: mappings.filter((m) => m.status === "unknown").length,
    mappings,
  };
}

/* ------------------------------------------------------------------ */
/* Prompt 3 — Audit listing                                            */
/* ------------------------------------------------------------------ */

function runAudit(title: string, variations: string[], stockMap: StockMap): any {
  const titleModels = extractModelsFromTitle(title, stockMap);
  const unknownClaims = extractUnknownTitleClaims(title);
  const normalized = normalizeList(variations, stockMap);
  const validVariations = unique(
    normalized.filter((m) => m.status === "valid" && m.canonical).map((m) => m.canonical as string)
  );
  const invalidVariations = normalized
    .filter((m) => m.status === "invalid")
    .map((m) => ({ raw: m.raw, alasan: m.reason, nearest: m.nearest }));

  const missingInVariations = titleModels.filter((m) => !validVariations.includes(m));
  const missingUnknown = unknownClaims.filter((claim) => {
    return !normalized.some(
      (m) => m.status === "valid" && m.canonical && normalizeKey(m.canonical) === normalizeKey(claim)
    );
  });

  const relevantModels = unique([...titleModels, ...validVariations]);
  const stockChecks = relevantModels.map((model) => {
    const stock = stockFor(stockMap, model);
    return {
      model,
      stok: stock ? stock.total_stock : 0,
      status: stock ? stock.status : "Tidak ada di stok",
    };
  });

  const findings: string[] = [];
  if (invalidVariations.length > 0) {
    findings.push(
      `Ada ${invalidVariations.length} variasi tidak valid: ${invalidVariations
        .map((v) => v.raw)
        .join(", ")}.`
    );
  }
  if (missingInVariations.length > 0) {
    findings.push(
      `Model di judul tanpa variasi: ${missingInVariations.join(", ")}.`
    );
  }
  if (missingUnknown.length > 0) {
    findings.push(
      `Judul menyebut ${missingUnknown.join(", ")}, tetapi tidak ada variasi/stok yang sesuai.`
    );
  }
  const outOfStock = stockChecks.filter((s) => s.stok <= 0);
  if (outOfStock.length > 0) {
    findings.push(
      `Model tanpa stok: ${outOfStock.map((s) => s.model).join(", ")}.`
    );
  }

  return {
    listing: { judul: title, jumlah_variasi: variations.length },
    langkah: [
      `Ekstrak model dari judul: ${titleModels.join(", ") || "tidak ada"}.`,
      `Normalisasi ${variations.length} variasi; ${validVariations.length} valid, ${invalidVariations.length} tidak valid.`,
      "Bandingkan model judul dengan variasi dan stok gudang.",
      "Simpulkan temuan dan verdict.",
    ],
    model_di_judul: titleModels,
    klaim_tambahan_di_judul: unknownClaims,
    model_di_variasi: validVariations,
    variasi_tidak_valid: invalidVariations,
    klaim_tanpa_variasi: unique([...missingInVariations, ...missingUnknown]),
    cek_stok: stockChecks,
    temuan: findings,
    verdict: findings.length > 0 ? "perlu_perbaikan" : "ok",
  };
}

/* ------------------------------------------------------------------ */
/* Prompt 4 — Extraction                                               */
/* ------------------------------------------------------------------ */

function extractFromProduct(product: ProductItem, stockMap: StockMap): any {
  const normalized = normalizeList(product.vars, stockMap);
  const models = unique(
    normalized.filter((m) => m.status === "valid" && m.canonical).map((m) => m.canonical as string)
  );
  const anomalies = normalized
    .filter((m) => m.status === "invalid" || m.status === "unknown")
    .map((m) => ({ raw: m.raw, alasan: m.reason }));

  return {
    sku: product.sku || null,
    nama_produk: product.name,
    brand: product.brand || null,
    foto: product.cover || null,
    jumlah_variasi: product.vars.length,
    variasi_tipe_hp: product.vars,
    model_terdeteksi: models,
    anomali: anomalies,
  };
}

function extractFromText(input: string, stockMap: StockMap): any {
  const text = String(input || "").trim();
  const product = findProduct(text);
  if (product) return extractFromProduct(product, stockMap);

  const skuMatch = text.match(/\b[A-Z]{2,}-[A-Z0-9-]{3,}\b/);
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  const brandMatch = text.match(/\b(iPhone|Samsung|Vivo|Xiaomi|Redmi|Oppo|Realme)\b/i);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const name = lines[0] || text.slice(0, 200);

  let variations: string[] = [];
  const variationIndex = lines.findIndex((line) => /variasi|type hp|tipe hp/i.test(line));
  if (variationIndex >= 0) {
    const marker = lines[variationIndex];
    const colonIndex = marker.indexOf(":");
    const inline = colonIndex >= 0 ? marker.slice(colonIndex + 1).trim() : "";
    variations = [inline, ...lines.slice(variationIndex + 1)]
      .filter(Boolean)
      .join(",")
      .split(/[,;|]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  const normalized = normalizeList(variations, stockMap);
  const models = unique(
    normalized.filter((m) => m.status === "valid" && m.canonical).map((m) => m.canonical as string)
  );
  const anomalies = normalized
    .filter((m) => m.status === "invalid" || m.status === "unknown")
    .map((m) => ({ raw: m.raw, alasan: m.reason }));

  return {
    sku: skuMatch ? skuMatch[0] : null,
    nama_produk: name.slice(0, 240),
    brand: brandMatch ? brandMatch[0] : null,
    foto: urlMatch ? urlMatch[0] : null,
    jumlah_variasi: variations.length,
    variasi_tipe_hp: variations,
    model_terdeteksi: models,
    anomali: anomalies,
  };
}

/* ------------------------------------------------------------------ */
/* Prompt 5 — Stock consistency                                        */
/* ------------------------------------------------------------------ */

function runKonsistensi(input: string, stockMap: StockMap): any {
  const text = String(input || "").trim();
  const totalMatch = text.match(/total\s*=\s*(-?\d+)/i);
  const stockMatch = text.match(/(?:stok|stok_awal|senin)\s*=\s*(-?\d+)/i);
  const additionMatch = text.match(/(?:tambahan|change|perubahan)\s*=\s*(-?\d+)/i);

  let rows: Array<{
    model: string;
    stok: number;
    tambahan: number;
    total: number;
    selisih: number;
    konsisten: boolean;
  }> = [];

  if (totalMatch && stockMatch && additionMatch) {
    const total = Number(totalMatch[1]);
    const stok = Number(stockMatch[1]);
    const tambahan = Number(additionMatch[1]);
    rows = [
      {
        model: "Input manual",
        stok,
        tambahan,
        total,
        selisih: total - (stok + tambahan),
        konsisten: total === stok + tambahan,
      },
    ];
  } else {
    let items = Object.values(stockMap);
    if (text) {
      const key = normalizeKey(text);
      const exact = items.filter((item) => normalizeKey(item.model) === key);
      const partial = items.filter((item) => {
        const itemKey = normalizeKey(item.model);
        return itemKey.includes(key) || key.includes(itemKey);
      });
      const selected = exact.length > 0 ? exact : partial;
      if (selected.length > 0) items = selected;
    }

    rows = items.map((item) => {
      const stok = item.senin_stock;
      const tambahan = item.change;
      const total = item.total_stock;
      return {
        model: item.model,
        stok,
        tambahan,
        total,
        selisih: total - (stok + tambahan),
        konsisten: total === stok + tambahan,
      };
    });
  }

  const discrepancies = rows.filter((row) => !row.konsisten);
  return {
    checked: rows.length,
    consistent: discrepancies.length === 0,
    discrepancies,
    summary: {
      total_units: rows.reduce((sum, row) => sum + row.total, 0),
      checked_models: rows.length,
    },
    rows,
  };
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

function formatPromptText(entry: PromptEntry, data: any): string {
  const json = JSON.stringify(data, null, 2);
  const clipped = json.length > 3300 ? json.slice(0, 3300) + "\n... (dipotong)" : json;
  return (
    `<b>${escapeHtml(entry.title)}</b>\n` +
    `<i>Teknik: ${escapeHtml(entry.technique)}</i>\n\n` +
    `<pre>${escapeHtml(clipped)}</pre>`
  );
}

export function runPrompt(
  id: string,
  input: string,
  stockMap: StockMap
): PromptRunResult | null {
  const entry = PROMPT_ENTRIES.find((item) => item.id === id);
  if (!entry) return null;

  const stockItems = Object.values(stockMap).sort((a, b) =>
    a.model.localeCompare(b.model)
  );
  const textInput = String(input || "").trim();
  let data: any;

  switch (entry.id) {
    case "restock": {
      const thresholdMatch = textInput.match(/\d{1,3}/);
      const threshold = thresholdMatch ? Number(thresholdMatch[0]) : 15;
      data = runRestock(stockItems, threshold);
      break;
    }
    case "normalisasi": {
      const values = textInput
        ? textInput.split(/[,;\n|]/).map((value) => value.trim()).filter(Boolean)
        : DEFAULT_NORMALIZATION_INPUT;
      data = runNormalisasi(values, stockMap);
      break;
    }
    case "audit": {
      const product = findProduct(textInput) || findDefaultProduct();
      let title = product.name;
      let variations = product.vars;
      if (textInput.includes("|")) {
        const parts = textInput.split("|");
        title = parts[0].trim() || title;
        variations = parts
          .slice(1)
          .join("|")
          .split(/[,;\n]/)
          .map((value) => value.trim())
          .filter(Boolean);
      } else if (textInput && !findProduct(textInput)) {
        title = textInput;
        variations = [];
      }
      data = runAudit(title, variations, stockMap);
      break;
    }
    case "extract": {
      data = textInput
        ? extractFromText(textInput, stockMap)
        : extractFromProduct(findDefaultProduct(), stockMap);
      break;
    }
    case "konsistensi": {
      data = runKonsistensi(textInput, stockMap);
      break;
    }
    default:
      return null;
  }

  return { entry, data, text: formatPromptText(entry, data) };
}

export function getPromptEntry(id: string): PromptEntry | undefined {
  return PROMPT_ENTRIES.find((entry) => entry.id === id);
}
