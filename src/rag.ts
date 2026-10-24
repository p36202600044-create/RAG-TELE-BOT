import { Env, RagResponse, StockItem, ProductItem } from "./types";
import knowledgeBase from "../data/knowledge_base_compact.json";

interface CompactKB {
  stock: Record<string, StockItem>;
  products: ProductItem[];
}

const kb = knowledgeBase as CompactKB;

/**
 * Clean & tokenize text for keyword search
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Direct check for iPhone models mentioned in query
 */
export function findMatchingStock(query: string): StockItem[] {
  const qLower = query.toLowerCase();
  const matched: StockItem[] = [];

  // Sort model names by length descending to match specific ones first (e.g. "iPhone 14 Pro Max" before "iPhone 14")
  const models = Object.keys(kb.stock).sort((a, b) => b.length - a.length);

  for (const model of models) {
    const mLower = model.toLowerCase();
    // Normalize spaces and slashes
    const mNorm = mLower.replace(/\s+/g, " ");
    const qNorm = qLower.replace(/[\/\-_]/g, " ").replace(/\s+/g, " ");

    if (qNorm.includes(mNorm)) {
      matched.push(kb.stock[model]);
      continue;
    }

    // Try without "iphone" prefix (e.g. user just types "14 pro max" or "xr" or "13 mini")
    const shortModel = mLower.replace(/^iphone\s*/, "").trim();
    if (shortModel.length >= 2) {
      const pattern = new RegExp(`\\b${shortModel}\\b`, "i");
      if (pattern.test(qNorm)) {
        matched.push(kb.stock[model]);
      }
    }
  }

  return matched;
}

/**
 * In-memory keyword/BM25 style search across products
 */
export function searchProducts(query: string, limit: number = 5): Array<{ product: ProductItem; score: number }> {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const scored: Array<{ product: ProductItem; score: number }> = [];

  for (const p of kb.products) {
    let score = 0;
    const nameLower = p.name.toLowerCase();
    const skuLower = p.sku.toLowerCase();
    const brandLower = p.brand.toLowerCase();
    const varsLower = p.vars.map((v) => v.toLowerCase()).join(" ");

    for (const token of qTokens) {
      // Exact SKU match is highest priority
      if (skuLower.includes(token)) score += 15;
      // Name match
      if (nameLower.includes(token)) score += 6;
      // Variation/compatible model match
      if (varsLower.includes(token)) score += 4;
      // Brand match
      if (brandLower.includes(token)) score += 3;
    }

    // Bonus for phrase match
    if (nameLower.includes(query.toLowerCase().trim())) {
      score += 20;
    }

    if (score > 0) {
      scored.push({ product: p, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Main RAG Query Processor
 */
export async function processRagQuery(query: string, env: Env): Promise<RagResponse> {
  const matchedStocks = findMatchingStock(query);
  let relevantDocs: string[] = [];
  let sources: Array<{ id: string; title: string; type: string; score?: number }> = [];
  let topPhoto: string | undefined = undefined;

  // 1. Add Stock Information Context if matched or if asking about general stock
  const isStockQuery =
    /stok|stock|ready|sisa|ada berapa|tersedia|gudang/i.test(query);

  if (matchedStocks.length > 0) {
    for (const s of matchedStocks) {
      relevantDocs.push(
        `[STOK GUDANG] Tipe: ${s.model} | Total Tersedia: ${s.total_stock} unit | Status: ${s.status} (Stok awal: ${s.senin_stock}, Perubahan: ${s.change})`
      );
      sources.push({
        id: `stock_${s.model}`,
        title: `Stok ${s.model}`,
        type: "stock",
      });
    }
  } else if (isStockQuery && /iphone/i.test(query)) {
    // User asking generally about iPhone stock without specific model
    const topStocked = Object.values(kb.stock)
      .sort((a, b) => b.total_stock - a.total_stock)
      .slice(0, 5)
      .map((s) => `${s.model}: ${s.total_stock} unit`)
      .join(", ");

    relevantDocs.push(
      `[STOK GUDANG MASTER] Flazzstore memiliki 35 tipe iPhone. Model stok terbanyak saat ini: ${topStocked}. Total model lengkap dari iPhone 7 Plus hingga iPhone 18 Pro Max.`
    );
    sources.push({
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
          topK: 4,
          returnMetadata: "all",
        });

        if (queryRes.matches && queryRes.matches.length > 0) {
          vectorUsed = true;
          for (const match of queryRes.matches) {
            const meta = match.metadata || {};
            if (meta.text) {
              relevantDocs.push(`[KATALOG VECTOR] ${meta.text}`);
            } else if (meta.name) {
              relevantDocs.push(
                `[KATALOG] ${meta.name} (SKU: ${meta.sku || "-"}) - Tipe: ${meta.vars || "-"}`
              );
            }
            if (!topPhoto && meta.cover_image) {
              topPhoto = meta.cover_image;
            }
            sources.push({
              id: match.id,
              title: meta.title || meta.name || match.id,
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
  const matchingProducts = searchProducts(query, 4);
  for (const item of matchingProducts) {
    const p = item.product;
    const varsPreview = p.vars.slice(0, 8).join(", ") + (p.vars.length > 8 ? "..." : "");
    relevantDocs.push(
      `[KATALOG PRODUK] Nama: ${p.name} | SKU: ${p.sku} | Brand: ${p.brand} | Tipe Tersedia: ${varsPreview} | Foto: ${p.cover}`
    );
    if (!topPhoto && p.cover) {
      topPhoto = p.cover;
    }
    sources.push({
      id: p.id,
      title: p.name,
      type: "product",
      score: item.score,
    });
  }

  // If no specific documents found, provide general shop context
  if (relevantDocs.length === 0) {
    relevantDocs.push(
      `Flazzstore menyediakan casing handphone custom berkualitas untuk iPhone, Samsung (Galaxy Z Flip, Z Fold, S Series), dan merek lainnya dengan lebih dari 1.100 desain motif unik (Japan Girl, Wood Art, Cute Bold Line, Joyful Doodle, dll). Pelanggan juga dapat memesan custom gambar/desain sendiri.`
    );
  }

  // 4. Generate Answer using Cloudflare Workers AI (LLaMA 3.1)
  const systemPrompt = `Anda adalah Asisten Virtual Cerdas Flazzstore (Customer Support RAG Bot) di Telegram.
Tugas Anda adalah melayani pelanggan dengan ramah, sopan, dan informatif dalam Bahasa Indonesia.

Gunakan HANYA informasi dari [KONTEKS] di bawah ini untuk menjawab pertanyaan pelanggan.
Panduan Menjawab:
1. Sapa pelanggan dengan ramah (misal: "Halo Kak! 😊").
2. Jika pelanggan bertanya tentang stok casing iPhone, sebutkan tipe dan jumlah stok yang tersedia secara akurat sesuai data [STOK GUDANG].
3. Jika pelanggan menanyakan casing atau motif tertentu, sebutkan nama produk, SKU, dan beberapa tipe HP yang kompatibel.
4. Jika stok tersedia, katakan stok ready dan siap dipesan. Jika stok di bawah 10 unit, ingatkan bahwa stok terbatas.
5. Bila relevan, sebutkan bahwa Flazzstore juga melayani custom desain gambar sendiri.
6. Buat format pesan yang rapi, gunakan bullet point (•) atau emoji agar mudah dibaca di layar Telegram. Jangan sebut kata "berdasarkan dokumen [KONTEKS]". Berbicaralah langsung seperti admin toko profesional.`;

  const contextText = relevantDocs.join("\n\n");
  const userPrompt = `Pertanyaan Pelanggan: "${query}"\n\n[KONTEKS FLazzstore]:\n${contextText}\n\nBerikan jawaban terbaik untuk pelanggan:`;

  let answer = "";

  if (env.AI) {
    try {
      const llmModel = env.DEFAULT_MODEL || "@cf/meta/llama-3.1-8b-instruct";
      const aiResponse: any = await env.AI.run(llmModel, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 600,
        temperature: 0.3,
      });

      answer = aiResponse.response || aiResponse.text || "";
    } catch (aiErr) {
      console.error("Workers AI generation error:", aiErr);
    }
  }

  // Fallback answer generator if Workers AI is not available (e.g. offline dev test)
  if (!answer) {
    answer = generateFallbackAnswer(query, matchedStocks, matchingProducts);
  }

  return {
    answer,
    topProductPhoto: topPhoto,
    sources,
  };
}

/**
 * Smart heuristic response generator (guarantees instantaneous accurate response even without LLM)
 */
function generateFallbackAnswer(
  query: string,
  matchedStocks: StockItem[],
  matchedProducts: Array<{ product: ProductItem; score: number }>
): string {
  let lines: string[] = ["Halo Kak! Terima kasih sudah menghubungi Flazzstore. 😊\n"];

  if (matchedStocks.length > 0) {
    lines.push("📦 <b>Informasi Stok Casing:</b>");
    for (const s of matchedStocks) {
      lines.push(
        `• <b>${s.model}</b>: Tersedia <b>${s.total_stock} unit</b> (${s.status})`
      );
    }
    lines.push("");
  }

  if (matchedProducts.length > 0) {
    lines.push("📱 <b>Rekomendasi Produk & Desain Terkait:</b>");
    for (const item of matchedProducts.slice(0, 3)) {
      const p = item.product;
      const vars = p.vars.slice(0, 5).join(", ");
      lines.push(`• <b>${p.name}</b>`);
      if (p.sku) lines.push(`  SKU: <code>${p.sku}</code>`);
      if (vars) lines.push(`  Tipe: <i>${vars}...</i>`);
    }
    lines.push("");
  }

  if (matchedStocks.length === 0 && matchedProducts.length === 0) {
    lines.push(
      "Kami menyediakan aneka casing custom untuk iPhone, Samsung Galaxy (Z Flip, Z Fold, S Series), dan merek lainnya dengan lebih dari 1.100 desain motif pilihan, serta bisa custom gambar sendiri! ✨\n\nSilakan sebutkan tipe HP atau motif casing yang Kakak cari."
    );
  } else {
    lines.push(
      "Semua casing dibuat dengan material berkualitas tinggi dan siap diproses custom sesuai pesanan Kakak! Ada yang ingin ditanyakan lagi? 😊"
    );
  }

  return lines.join("\n");
}

/**
 * Dynamically generate all 1,150 RAG chunk documents for Vectorize
 */
export function getAllRagDocuments() {
  const docs: Array<{
    id: string;
    type: string;
    title: string;
    text: string;
    metadata: Record<string, any>;
  }> = [];

  // 1. Master stock overview
  const stockItems = Object.values(kb.stock);
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

  // 2. Individual stock items
  for (const item of stockItems) {
    const id = `stock_${item.model.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    docs.push({
      id,
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

  // 3. Products
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
