import { Env, RagResponse, StockItem, StockMap, ProductItem } from "./types";
import { ensureStockDb, getStockMap } from "./stock";
import knowledgeBase from "../data/knowledge_base_compact.json";

interface CompactKB {
  stock: Record<string, StockItem>;
  products: ProductItem[];
}

const kb = knowledgeBase as CompactKB;

const STOPWORDS = new Set([
  "casing", "case", "cover", "hybrid", "custom", "hardcase", "softcase",
  "premium", "motif", "motifnya", "desain", "design", "gambar", "sendiri",
  "bisa", "boleh", "ada", "apa", "saja", "yang", "untuk", "harga", "stok",
  "ready", "dan", "dengan", "halo", "kak", "saya", "mau", "cari", "minta",
  "info", "produk", "tipe", "hp", "handphone", "phone", "apakah", "berapa",
  "tersedia", "punya", "dijual", "jual", "tanya", "ingin", "pesan",
]);

/**
 * Clean & tokenize text for keyword search
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Direct check for iPhone models mentioned in query
 */
export function findMatchingStock(
  query: string,
  stock: StockMap = kb.stock
): StockItem[] {
  const qLower = query.toLowerCase();
  const matched: StockItem[] = [];

  // Sort model names by length descending to match specific ones first (e.g. "iPhone 14 Pro Max" before "iPhone 14")
  const models = Object.keys(stock).sort((a, b) => b.length - a.length);

  for (const model of models) {
    const mLower = model.toLowerCase();
    // Normalize spaces and slashes
    const mNorm = mLower.replace(/\s+/g, " ");
    const qNorm = qLower.replace(/[\/\-_]/g, " ").replace(/\s+/g, " ");

    if (qNorm.includes(mNorm)) {
      matched.push(stock[model]);
      continue;
    }

    // Try without "iphone" prefix (e.g. user just types "14 pro max" or "xr" or "13 mini")
    const shortModel = mLower.replace(/^iphone\s*/, "").trim();
    if (shortModel.length >= 2) {
      const pattern = new RegExp(`\\b${shortModel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (pattern.test(qNorm)) {
        matched.push(stock[model]);
      }
    }
  }

  return matched;
}

/**
 * In-memory keyword/BM25 style search across products
 */
export function searchProducts(
  query: string,
  limit: number = 5,
  brandFilter: string = ""
): Array<{ product: ProductItem; score: number }> {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const scored: Array<{ product: ProductItem; score: number }> = [];

  for (const p of kb.products) {
    // Skip placeholder/custom-service listings and listings without variants:
    // they carry no SKU or compatible types and pollute motif recommendations.
    if (!p.vars || p.vars.length === 0) continue;
    if (brandFilter && brandGroup(p.brand, p.name) !== brandFilter) continue;

    let score = 0;
    const nameLower = p.name.toLowerCase();
    const skuLower = p.sku.toLowerCase();
    const brandLower = p.brand.toLowerCase();
    const varsLower = p.vars.map((v) => v.toLowerCase()).join(" ");

    for (const token of qTokens) {
      // Exact SKU match is highest priority
      if (skuLower && skuLower.includes(token)) score += 15;
      // Name match
      if (nameLower.includes(token)) score += 6;
      // Variation/compatible model match
      if (varsLower.includes(token)) score += 4;
      // Brand match
      if (brandLower.includes(token)) score += 3;
    }

    // Prefer complete catalog rows over rows missing a SKU.
    if (score > 0 && p.sku) score += 2;

    // Bonus for phrase match
    if (nameLower.includes(query.toLowerCase().trim())) {
      score += 20;
    }

    if (score >= 6) {
      scored.push({ product: p, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Main RAG Query Processor
 */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export async function processRagQuery(
  query: string,
  env: Env,
  history: ChatTurn[] = []
): Promise<RagResponse> {
  const stockDbReady = await ensureStockDb(env);
  const stockMap = await getStockMap(env);
  const matchedStocks = findMatchingStock(query, stockMap);
  const targetBrand = wantedBrand(query);
  const queryTokens = tokenize(query);
  let relevantDocs: string[] = [];
  let sources: Array<{ id: string; title: string; type: string; score?: number }> = [];
  const sourceKeys = new Set<string>();
  const seenProductKeys = new Set<string>();
  let topPhoto: string | undefined = undefined;
  let vectorMatches = 0;
  let productMatches = 0;
  let aiGenerated = false;

  function addSource(source: { id: string; title: string; type: string; score?: number }) {
    const key = `${source.type}:${source.id}`;
    if (sourceKeys.has(key)) return;
    sourceKeys.add(key);
    sources.push(source);
  }

  // 1. Add Stock Information Context if matched or if asking about general stock
  const isStockQuery =
    /stok|stock|ready|sisa|ada berapa|tersedia|gudang/i.test(query);

  if (matchedStocks.length > 0) {
    for (const s of matchedStocks) {
      relevantDocs.push(
        `[STOK GUDANG] Tipe: ${s.model} | Total Tersedia: ${s.total_stock} unit | Status: ${s.status} (Stok awal: ${s.senin_stock}, Perubahan: ${s.change})`
      );
      addSource({
        id: `stock_${s.model}`,
        title: `Stok ${s.model}`,
        type: "stock",
      });
    }
  } else if (isStockQuery && /iphone/i.test(query)) {
    // User asking generally about iPhone stock without specific model
    const topStocked = Object.values(stockMap)
      .sort((a, b) => b.total_stock - a.total_stock)
      .slice(0, 5)
      .map((s) => `${s.model}: ${s.total_stock} unit`)
      .join(", ");

    const totalUnits = Object.values(stockMap).reduce(
      (sum, item) => sum + item.total_stock,
      0
    );
    relevantDocs.push(
      `[STOK GUDANG MASTER] Flazzstore memiliki ${Object.keys(stockMap).length} tipe iPhone dengan total ${totalUnits} unit. Model stok terbanyak saat ini: ${topStocked}. Total model lengkap dari iPhone 7 Plus hingga iPhone 18 Pro Max.`
    );
    addSource({
      id: "stock_master",
      title: "Ringkasan Stok iPhone",
      type: "stock_overview",
    });
  }

  // 2. Vector Search (if Cloudflare Vectorize is bound)
  let vectorUsed = false;
  if (env.VECTOR_INDEX && env.AI) {
    try {
      const embeddingModel = env.EMBEDDING_MODEL || "@cf/baai/bge-m3";
      const embedRes: any = await env.AI.run(embeddingModel, {
        text: [query],
      });

      const vector = embedRes.data?.[0] || embedRes[0];
      if (vector && Array.isArray(vector)) {
        const queryRes: any = await env.VECTOR_INDEX.query(vector, {
          topK: 6,
          returnMetadata: "all",
        });

        if (queryRes.matches && queryRes.matches.length > 0) {
          vectorUsed = true;
          vectorMatches = queryRes.matches.length;
          for (const match of queryRes.matches) {
            const meta = match.metadata || {};
            const metaType = String(meta.type || "");

            // Stock documents are already sourced live from D1 above. Use them
            // only as a fallback when the direct stock match missed the model,
            // and never render them as catalog entries.
            if (metaType === "stock_item") {
              if (
                meta.model &&
                !matchedStocks.some((s) => s.model === meta.model)
              ) {
                relevantDocs.push(
                  `[STOK GUDANG] Tipe: ${meta.model} | Total tersedia: ${meta.total_stock} unit`
                );
                addSource({
                  id: match.id,
                  title: `Stok ${meta.model}`,
                  type: "vector_match",
                  score: match.score,
                });
              }
              continue;
            }
            if (metaType === "stock_overview") continue;
            if (
              targetBrand &&
              brandGroup(meta.brand || "", meta.title || meta.name || "") !== targetBrand
            ) {
              continue;
            }

            const motif = productMotif(meta.title || meta.name || "");
            const productKey = String(meta.sku || motif).toLowerCase();
            if (seenProductKeys.has(productKey)) continue;

            // Placeholder listings for the custom-design service are not real
            // catalog motifs and must not become photo captions or sources.
            if (
              !String(meta.sku || "").trim() &&
              /request|desain\s+gambar|custom/i.test(meta.title || meta.name || "")
            ) {
              continue;
            }

            // Vector recall is intentionally broad. Keep a product only when
            // its motif words actually appear in the question, otherwise a
            // generic question pulls in random anime/car designs.
            const motifTokens = tokenize(motif);
            const hasOverlap = motifTokens.some((token) =>
              queryTokens.includes(token)
            );
            if (!hasOverlap) continue;

            seenProductKeys.add(productKey);

            if (meta.text) {
              relevantDocs.push(`[KATALOG VECTOR] ${cleanVectorText(meta.text, query)}`);
            } else if (meta.name) {
              const types = Array.isArray(meta.vars)
                ? meta.vars
                : String(meta.vars || "").split(/\s*,\s*/);
              relevantDocs.push(
                `[KATALOG] Motif: ${motif} | SKU: ${meta.sku ? cleanSku(meta.sku) : "-"} | Brand: ${meta.brand || "-"} | Contoh tipe: ${formatProductTypes(types, 5, meta.brand, query)}`
              );
            }
            if (!topPhoto && meta.cover_image) {
              topPhoto = meta.cover_image;
            }
            addSource({
              id: match.id,
              title: motif || meta.sku || match.id,
              type: "vector_match",
              score: match.score,
            });
          }
        }
      }
    } catch (vErr) {
      console.warn("Vectorize search error, falling back to local index:", vErr);
    }
  }

  // 3. Fallback / Augment with In-Memory Keyword Search
  const matchingProducts = searchProducts(query, 4, targetBrand);
  productMatches = matchingProducts.length;
  for (const item of matchingProducts) {
    const p = item.product;
    const motif = productMotif(p.name);
    const productKey = String(p.sku || motif).toLowerCase();
    if (seenProductKeys.has(productKey)) continue;
    seenProductKeys.add(productKey);
    const brand = displayBrand(p.brand, p.name);
    const skuPart = p.sku ? ` | SKU: ${cleanSku(p.sku)}` : "";
    relevantDocs.push(
      `[KATALOG PRODUK] Motif: ${motif}${skuPart} | Brand: ${brand} | Jumlah tipe: ${p.vars.length} | Contoh tipe: ${formatProductTypes(p.vars, 5, brand, query)}`
    );
    if (!topPhoto && p.cover) {
      topPhoto = p.cover;
    }
    addSource({
      id: p.id,
      title: motif,
      type: "product",
      score: item.score,
    });
  }

  // Custom design is a service, not a catalog motif. Add explicit context so
  // the model does not pad the answer with unrelated listings.
  const asksCustom =
    /(custom|desain\s+sendiri|gambar\s+sendiri|request\s+desain|pesan\s+desain)/i.test(
      query
    );
  if (asksCustom) {
    relevantDocs.push(
      `[LAYANAN] Flazzstore menerima pesanan custom desain gambar sendiri. Pelanggan cukup mengirim gambar/desain yang diinginkan, lalu memilih tipe HP. Tidak ada batas motif katalog untuk custom.`
    );
  }

  // If no specific documents found, provide general shop context
  if (relevantDocs.length === 0) {
    relevantDocs.push(
      `Flazzstore menyediakan casing handphone custom berkualitas untuk iPhone, Samsung (Galaxy Z Flip, Z Fold, S Series), dan merek lainnya dengan lebih dari 1.100 desain motif unik (Japan Girl, Wood Art, Cute Bold Line, Joyful Doodle, dll). Pelanggan juga dapat memesan custom gambar/desain sendiri.`
    );
  }

  // 4. Generate Answer using Cloudflare Workers AI (Llama 3.3)
  const systemPrompt = `Anda adalah Asisten Virtual Flazzstore (customer support RAG) untuk Telegram dan web.
Jawab dalam Bahasa Indonesia yang ramah, singkat, dan rapi.

Gunakan HANYA informasi dari [KONTEKS]. Jangan mengarang stok, SKU, harga, atau tipe HP.

Aturan format:
1. Mulai dengan "Halo Kak!" lalu satu baris kosong. Untuk jawaban lanjutan, langsung jawab tanpa mengulang sapaan.
2. Jika [KONTEKS] memuat [STOK GUDANG] untuk tipe iPhone yang ditanyakan, SELALU tulis bagian <b>Stok casing</b>. Maksimal 4 baris dengan format: "• <model> — <jumlah> unit (<status>)". Gunakan status singkat: Ready, Stok sedang, Stok rendah, Sangat terbatas, atau Habis.
3. Jika ada produk, tulis bagian <b>Desain terkait</b>. Maksimal 3 produk. Gunakan nama motif singkat saja; JANGAN menyalin judul listing lengkap. Format:
   • <b>Motif</b> — <code>SKU</code>
     <brand> · <jumlah> tipe (3 contoh tipe, lalu "+N tipe lain")
   Gunakan angka "Jumlah tipe" dari konteks apa adanya; jangan menghitung sendiri dari contoh tipe.
   Jika produk tidak punya SKU, tulis nama motif saja tanpa <code> dan tanpa kata "SKU".
   Tampilkan hanya produk yang benar-benar relevan dengan pertanyaan.
4. Sebutkan layanan custom gambar HANYA jika [LAYANAN] ada di konteks. Jangan menambahkannya pada jawaban katalog biasa.
5. Jika tidak ada stok atau produk yang cocok, jelaskan layanan secara singkat dan minta tipe HP atau motif yang dicari.
6. Akhiri dengan satu kalimat ajakan singkat, maksimal 12 kata, contoh: "Ada tipe atau motif lain yang ingin dicek?"
7. Jangan gunakan emoji. Jangan memakai tabel markdown. Jangan menyebut "[KONTEKS]" atau "dokumen".
8. Jangan menambahkan paragraf basa-basi, ringkasan ulang, atau kalimat penutup kedua.

Contoh format (jangan salin datanya):
Halo Kak!

<b>Stok casing</b>
• iPhone 13 Mini — 27 unit (Stok sedang)
• iPhone 13 — 32 unit (Ready)

<b>Desain terkait</b>
• Japan Girl — <code>IP-JPNGIRLART-0001</code>
  iPhone · 31 tipe (17 Pro Max, 17 Pro, 17 Air, +28 tipe lain)

Ada tipe atau motif lain yang ingin dicek?`;

  const contextText = relevantDocs.join("\n\n");
  const userPrompt = `Pertanyaan Pelanggan: "${query}"\n\n[KONTEKS Flazzstore]:\n${contextText}\n\nTulis jawaban final sesuai aturan format di atas:`;

  // Keep follow-up questions grounded: pass a short, sanitized conversation
  // history, but never let it replace the retrieved context.
  const safeHistory = history
    .filter(
      (turn) =>
        turn &&
        (turn.role === "user" || turn.role === "assistant") &&
        typeof turn.content === "string"
    )
    .slice(-6)
    .map((turn) => ({
      role: turn.role,
      content: turn.content
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 700),
    }))
    .filter((turn) => turn.content.length > 0);

  let answer = "";

  if (env.AI) {
    try {
      const llmModel = env.DEFAULT_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
      const aiResponse: any = await env.AI.run(llmModel, {
        messages: [
          { role: "system", content: systemPrompt },
          ...safeHistory,
          { role: "user", content: userPrompt },
        ],
        max_tokens: 600,
        temperature: 0.3,
      });

      answer = aiResponse.response || aiResponse.text || "";
      aiGenerated = Boolean(answer);
    } catch (aiErr) {
      console.error("Workers AI generation error:", aiErr);
    }
  }

  // Fallback answer generator if Workers AI is not available (e.g. offline dev test)
  if (!answer) {
    answer = generateFallbackAnswer(query, matchedStocks, matchingProducts);
  }

  const stockItems = Object.values(stockMap);
  return {
    answer,
    topProductPhoto: topPhoto,
    sources,
    trace: {
      stockSource: stockDbReady ? "d1" : "snapshot",
      stockModels: stockItems.length,
      stockUnits: stockItems.reduce((sum, item) => sum + item.total_stock, 0),
      vectorUsed,
      vectorMatches,
      productMatches,
      contextDocs: relevantDocs.length,
      generatedBy: aiGenerated ? "workers-ai" : "fallback",
    },
  };
}

/**
 * Extract a short motif name from the auto-generated catalog title, e.g.
 * "Hybrid Case Casing iPhone 17 ... XR SE Japan Girl" -> "Japan Girl".
 * Device names and model numbers are dropped; the remaining suffix is the motif.
 */
const DEVICE_TOKENS = new Set([
  "hybrid", "hybri", "case", "casing", "cover", "hardcase", "softcase",
  "custom", "premium", "motif", "motifnya", "desain", "design", "gambar",
  "request", "iphone", "samsung", "galaxy", "google", "pixel", "vivo",
  "iqoo", "oppo", "xiaomi", "redmi", "realme", "infinix", "oneplus",
  "nokia", "huawei", "note", "tab", "z", "flip", "fold", "ultra", "plus",
  "fe", "edge", "pro", "max", "air", "mini", "duo", "xr", "se", "xl",
  "xs", "x", "lite", "5g", "4g",
]);

export function productMotif(name: string): string {
  const tokens = String(name || "").split(/\s+/).filter(Boolean);
  const kept = tokens.filter((token) => {
    const lower = token.toLowerCase();
    if (DEVICE_TOKENS.has(lower)) return false;
    if (/^\d{1,3}[a-z]?$/.test(lower)) return false;
    if (/^[a-z]\d{1,3}[a-z]?$/.test(lower)) return false;
    return true;
  });
  const motif = kept.slice(0, 6).join(" ").trim();
  if (motif.length >= 2) return motif;
  return tokens.slice(-4).join(" ").slice(0, 48) || String(name || "").slice(0, 48);
}

function formatProductTypes(
  vars: string[],
  limit = 3,
  brand = "",
  query = ""
): string {
  const cleaned = vars
    .map((value) =>
      String(value || "")
        .replace(/^Iphone\b/i, "iPhone")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .filter((value) => !/^type\s*hp\s*lain/i.test(value))
    .map((value) => {
      const label = brand.toLowerCase();
      if (label === "iphone") return value.replace(/^iPhone\s+/i, "");
      if (label === "samsung") return value.replace(/^Samsung\s+/i, "");
      if (label.includes("google")) return value.replace(/^(Google\s+)?(Pixel\s+)?/i, "");
      if (label === "vivo") return value.replace(/^Vivo\s+/i, "");
      return value;
    })
    .filter(Boolean);
  const unique = Array.from(new Set(cleaned));
  if (unique.length === 0) return "";

  // Show the variants the customer actually asked about first, so a query for
  // "Samsung S24" does not lead with S26/S25 just because of catalog order.
  const queryTokens = tokenize(query);
  const ranked = unique.map((value, index) => {
    const lower = value.toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      const pattern = new RegExp(
        `\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i"
      );
      if (pattern.test(lower)) score += 1;
    }
    return { value, index, score };
  });
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);

  const shown = ranked.slice(0, limit).map((item) => item.value).join(", ");
  const remaining = unique.length - limit;
  return remaining > 0 ? `${shown}, +${remaining} tipe lain` : shown;
}

function cleanSku(sku: string): string {
  return String(sku || "")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function displayBrand(brand: string, name: string): string {
  if (brand === "Universal/Lainnya" && /google\s+pixel/i.test(name)) {
    return "Google Pixel";
  }
  return brand || "-";
}

function brandGroup(brand: string, name: string): string {
  const label = displayBrand(brand, name).toLowerCase();
  if (label.includes("iphone")) return "iphone";
  if (label.includes("samsung")) return "samsung";
  if (label.includes("pixel") || label.includes("google")) return "google";
  if (label.includes("vivo")) return "vivo";
  return "other";
}

function wantedBrand(query: string): string {
  if (/\biphone\b/i.test(query)) return "iphone";
  if (/\b(samsung|galaxy)\b|z\s*(flip|fold)/i.test(query)) return "samsung";
  if (/\b(pixel|google)\b/i.test(query)) return "google";
  if (/\b(vivo|iqoo)\b/i.test(query)) return "vivo";
  return "";
}

export function stockLabel(total: number): string {
  if (total <= 0) return "Habis";
  if (total <= 5) return "Sangat terbatas";
  if (total <= 15) return "Stok rendah";
  if (total <= 30) return "Stok sedang";
  return "Ready";
}

/**
 * Vector documents store the full listing title in `text`. Rewrite it into the
 * same compact motif/SKU/types shape used by the prompt, so the model does not
 * copy the auto-generated title verbatim.
 */
function cleanVectorText(text: string, query = ""): string {
  const source = String(text || "").trim();
  const match = source.match(
    /^Produk Casing:\s*([\s\S]+?)\.\s*SKU:\s*([\s\S]+?)\.\s*Brand:\s*([\s\S]+?)\.\s*Tipe HP yang didukung:\s*([\s\S]+?)\.\s*Link Foto:/
  );
  if (!match) {
    return source.length > 420 ? `${source.slice(0, 420)}…` : source;
  }
  const types = match[4].split(/\s*,\s*/).filter(Boolean);
  const brand = displayBrand(match[3], match[1]);
  const sku = cleanSku(match[2]);
  const full = sku ? kb.products.find((p) => cleanSku(p.sku) === sku) : undefined;
  const fullVars = full && full.vars.length > 0 ? full.vars : types;
  const skuPart = sku && sku !== "SKU" ? ` | SKU: ${sku}` : "";
  return `Motif: ${productMotif(match[1])}${skuPart} | Brand: ${brand} | Jumlah tipe: ${fullVars.length} | Contoh tipe: ${formatProductTypes(fullVars, 5, brand, query)}`;
}

/**
 * Smart heuristic response generator (guarantees instantaneous accurate response even without LLM)
 */
function generateFallbackAnswer(
  query: string,
  matchedStocks: StockItem[],
  matchedProducts: Array<{ product: ProductItem; score: number }>
): string {
  const lines: string[] = ["Halo Kak!", ""];

  if (matchedStocks.length > 0) {
    lines.push("<b>Stok casing</b>");
    for (const s of matchedStocks) {
      lines.push(
        `• ${s.model} — <b>${s.total_stock} unit</b> (${stockLabel(s.total_stock)})`
      );
    }
    lines.push("");
  }

  if (matchedProducts.length > 0) {
    lines.push("<b>Desain terkait</b>");
    for (const item of matchedProducts.slice(0, 3)) {
      const p = item.product;
      const motif = productMotif(p.name);
      const brand = displayBrand(p.brand, p.name);
      const skuPart = p.sku ? ` — <code>${cleanSku(p.sku)}</code>` : "";
      lines.push(`• <b>${motif}</b>${skuPart}`);
      const types = formatProductTypes(p.vars, 3, brand, query);
      const typeCount = p.vars.length ? ` · ${p.vars.length} tipe` : "";
      if (types) {
        lines.push(`  ${brand}${typeCount} (${types})`);
      } else {
        lines.push(`  ${brand}${typeCount}`);
      }
    }
    lines.push("");
  }

  if (matchedStocks.length === 0 && matchedProducts.length === 0) {
    lines.push(
      "Flazzstore menyediakan casing custom untuk iPhone, Samsung Galaxy (Z Flip, Z Fold, S Series), Google Pixel, dan lainnya dengan 1.100+ desain motif. Bisa juga custom gambar sendiri.",
      "",
      "Sebutkan tipe HP atau motif yang Kakak cari, nanti saya cek ketersediaannya."
    );
  } else {
    lines.push("Ada tipe atau motif lain yang ingin dicek?");
  }

  return lines.join("\n");
}

type VectorDoc = {
  id: string;
  type: "stock_overview" | "stock_item" | "product";
  title: string;
  text: string;
  metadata: Record<string, any>;
};

function stockDocId(model: string): string {
  return `stock_${model.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

/**
 * Build the stock overview + stock item documents. Pass `onlyModel` to update
 * the overview plus a single model after a dashboard stock movement.
 */
export function buildStockDocuments(
  stockMap: StockMap = kb.stock,
  onlyModel?: string
): VectorDoc[] {
  const docs: VectorDoc[] = [];
  const stockItems = Object.values(stockMap);
  const totalStock = stockItems.reduce((acc, curr) => acc + curr.total_stock, 0);

  docs.push({
    id: "doc_stock_master_overview",
    type: "stock_overview",
    title: "Ringkasan Total Stok Casing iPhone Flazzstore",
    text: `Laporan Inventaris Stok Casing Flazzstore iPhone: Total stok gudang adalah ${totalStock} unit untuk ${stockItems.length} tipe iPhone dari iPhone 7 Plus hingga iPhone 18. Stok fisik ini adalah casing polos yang siap dicetak custom sesuai desain motif pilihan pelanggan.`,
    metadata: {
      type: "stock_overview",
      total_inventory: totalStock,
      models_count: stockItems.length,
    },
  });

  const selected = onlyModel
    ? stockItems.filter((item) => item.model === onlyModel)
    : stockItems;

  for (const item of selected) {
    docs.push({
      id: stockDocId(item.model),
      type: "stock_item",
      title: `Stok Casing ${item.model}`,
      text: `Informasi Stok Casing Flazzstore untuk tipe ${item.model}: Total stok tersedia ${item.total_stock} unit (${item.status}). Stok awal minggu ${item.senin_stock} unit. Siap dipesan custom.`,
      metadata: {
        type: "stock_item",
        model: item.model,
        total_stock: item.total_stock,
        status: item.status,
      },
    });
  }

  return docs;
}

/**
 * Re-embed and upsert the stock overview and one (or all) stock item into
 * Cloudflare Vectorize so the RAG index stays in sync with the dashboard.
 */
export async function syncStockVectors(
  env: Env,
  stockMap: StockMap,
  onlyModel?: string
): Promise<boolean> {
  if (!env.VECTOR_INDEX || !env.AI) return false;

  try {
    const docs = buildStockDocuments(stockMap, onlyModel);
    const embeddingModel = env.EMBEDDING_MODEL || "@cf/baai/bge-m3";
    const embedRes: any = await env.AI.run(embeddingModel, {
      text: docs.map((doc) => `${doc.title}: ${doc.text}`),
    });
    const vectorsData = embedRes.data || embedRes;

    await env.VECTOR_INDEX.upsert(
      docs.map((doc, idx) => ({
        id: doc.id,
        values: vectorsData[idx],
        metadata: {
          type: doc.type,
          title: doc.title,
          text: doc.text.slice(0, 1000),
          ...doc.metadata,
        },
      }))
    );
    return true;
  } catch (err) {
    console.error("Failed to sync stock vectors:", err);
    return false;
  }
}

/**
 * Dynamically generate all 1,150 RAG chunk documents for Vectorize.
 */
export function getAllRagDocuments(stockMap: StockMap = kb.stock): VectorDoc[] {
  const docs: VectorDoc[] = buildStockDocuments(stockMap);

  // Products
  for (const p of kb.products) {
    const varsStr = p.vars.slice(0, 15).join(", ");
    docs.push({
      id: `prod_${p.id}`,
      type: "product",
      title: p.name,
      text: `Produk Casing: ${p.name}. SKU: ${p.sku}. Brand: ${p.brand}. Tipe HP yang didukung: ${varsStr}. Link Foto: ${p.cover}`,
      metadata: {
        type: "product",
        product_id: p.id,
        sku: p.sku,
        brand: p.brand,
        cover_image: p.cover,
      },
    });
  }

  return docs;
}
