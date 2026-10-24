/**
 * Script to batch generate embeddings and upload to Cloudflare Vectorize
 *
 * Requirements:
 * - CLOUDFLARE_ACCOUNT_ID in .env
 * - CLOUDFLARE_API_TOKEN in .env
 * - Cloudflare Vectorize index created:
 *     npx wrangler vectorize create rag-tele-index --dimensions=1024 --metric=cosine
 *
 * Usage:
 *   npx tsx scripts/upload_to_vectorize.ts
 */

import fs from "fs";
import path from "path";

const BASE_DIR = path.resolve(__dirname, "..");
const DOCS_PATH = path.join(BASE_DIR, "data", "rag_documents.json");
const ENV_PATH = path.join(BASE_DIR, ".env");

function loadEnv(): Record<string, string | undefined> {
  const env: Record<string, string> = {};
  if (fs.existsSync(ENV_PATH)) {
    const lines = fs.readFileSync(ENV_PATH, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
        const [k, ...v] = trimmed.split("=");
        env[k.trim()] = v.join("=").trim().replace(/^['"]|['"]$/g, "");
      }
    }
  }
  return { ...env, ...process.env };
}

interface RagDoc {
  id: string;
  type: string;
  title: string;
  text: string;
  metadata?: Record<string, any>;
}

async function main() {
  console.log("==========================================================");
  console.log("🚀 CLOUDFLARE VECTORIZE INGESTION PIPELINE");
  console.log("==========================================================");

  const env = loadEnv();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  const indexName = env.VECTORIZE_INDEX_NAME || "rag-tele-index";
  const embeddingModel = env.EMBEDDING_MODEL || "@cf/baai/bge-m3";

  if (!fs.existsSync(DOCS_PATH)) {
    console.error(`❌ Dokumen ${DOCS_PATH} tidak ditemukan. Jalankan 'npm run ingest' terlebih dahulu.`);
    process.exit(1);
  }

  const rawDocs = fs.readFileSync(DOCS_PATH, "utf-8");
  const docs: RagDoc[] = JSON.parse(rawDocs);
  console.log(`📄 Memuat ${docs.length} dokumen RAG dari ${DOCS_PATH}`);

  if (!accountId || !apiToken) {
    console.log("\n⚠️  CLOUDFLARE_ACCOUNT_ID atau CLOUDFLARE_API_TOKEN belum diatur dalam .env.");
    console.log("💡 File dokumen sudah siap dan diekspor ke format JSON.");
    console.log("\nUntuk mengupload ke Cloudflare Vectorize:");
    console.log("1. Buat index Vectorize dengan dimensi 1024:");
    console.log(`   npx wrangler vectorize create ${indexName} --dimensions=1024 --metric=cosine`);
    console.log("2. Masukkan kredensial Cloudflare ke file .env:");
    console.log("   CLOUDFLARE_ACCOUNT_ID=your_account_id");
    console.log("   CLOUDFLARE_API_TOKEN=your_api_token");
    console.log("3. Jalankan kembali perintah ini: npm run upload:vectorize\n");
    return;
  }

  console.log(`\n🔗 Menghubungkan ke Cloudflare Account: ${accountId}`);
  console.log(`📊 Index Tujuan: ${indexName} | Embedding Model: ${embeddingModel}`);

  const BATCH_SIZE = 20;
  const totalBatches = Math.ceil(docs.length / BATCH_SIZE);
  console.log(`📦 Memproses dalam ${totalBatches} batch (${BATCH_SIZE} dokumen per batch)...`);

  let successCount = 0;

  for (let b = 0; b < totalBatches; b++) {
    const batch = docs.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    const texts = batch.map((d) => `${d.title}: ${d.text}`);

    console.log(`\n[Batch ${b + 1}/${totalBatches}] Mengenerate embeddings untuk ${batch.length} dokumen...`);

    try {
      // 1. Call Workers AI Embedding API
      const aiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${embeddingModel}`;
      const embedRes = await fetch(aiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: texts }),
      });

      const embedData: any = await embedRes.json();
      if (!embedData.success) {
        console.error(`❌ Gagal generate embeddings pada batch ${b + 1}:`, embedData.errors);
        continue;
      }

      const vectors = embedData.result?.data || embedData.result;

      // 2. Format vectors for Vectorize
      const vectorizePayload = batch.map((doc, idx) => ({
        id: doc.id,
        values: vectors[idx],
        metadata: {
          type: doc.type,
          title: doc.title,
          text: doc.text.slice(0, 1000), // Max metadata snippet
          ...(doc.metadata || {}),
        },
      }));

      // 3. Upsert to Vectorize index
      const ndjson = vectorizePayload.map((v) => JSON.stringify(v)).join("\n");
      const vecUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/${indexName}/insert`;
      const upsertRes = await fetch(vecUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/x-ndjson",
        },
        body: ndjson,
      });

      const upsertData: any = await upsertRes.json();
      if (upsertData.success) {
        successCount += batch.length;
        console.log(`✅ Batch ${b + 1} berhasil diunggah (${successCount}/${docs.length} dokumen tersimpan)`);
      } else {
        console.error(`❌ Gagal upsert ke Vectorize pada batch ${b + 1}:`, upsertData.errors);
      }
    } catch (err) {
      console.error(`❌ Kesalahan jaringan pada batch ${b + 1}:`, err);
    }
  }

  console.log("\n==========================================================");
  console.log(`🎉 Selesai! Berhasil mengunggah ${successCount} dari ${docs.length} dokumen ke Vectorize.`);
  console.log("==========================================================");
}

main().catch(console.error);
