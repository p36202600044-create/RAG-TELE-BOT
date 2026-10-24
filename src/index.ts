import { Env, TelegramUpdate } from "./types";
import { TelegramBot } from "./telegram";
import {
  processRagQuery,
  getAllRagDocuments,
  syncStockVectors,
} from "./rag";
import {
  adjustStock,
  addStockModel,
  ensureStockDb,
  getStockHistory,
  getStockMap,
  listStock,
  summariseStock,
} from "./stock";
import indexHtml from "../web/index.html";
import monitorHtml from "../web/monitor.html";
import promptLabHtml from "../web/prompts.html";
import agentUiCss from "../web/assets/agent-ui.css";
// @ts-ignore - Wrangler imports this file as a text asset.
import agentUiJs from "../web/assets/agent-ui.js";
import {
  PROMPT_ENTRIES,
  PromptId,
  runPrompt,
} from "./prompts";
import knowledgeBase from "../data/knowledge_base_compact.json";

function json(data: unknown, status: number = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

interface AdminCheck {
  ok: boolean;
  actor: string;
  response?: Response;
}

/**
 * Protect the monitoring dashboard and stock mutations with HTTP Basic Auth.
 * When ADMIN_PASSWORD is not configured, only local development (localhost /
 * 127.0.0.1) is allowed. Production requires the ADMIN_PASSWORD secret.
 */
function checkAdmin(request: Request, env: Env): AdminCheck {
  const url = new URL(request.url);
  const isLocal =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname.endsWith(".localhost");

  if (!env.ADMIN_PASSWORD) {
    if (isLocal) return { ok: true, actor: "local-dev" };
    return {
      ok: false,
      actor: "",
      response: new Response(
        "Monitoring belum aktif. Set secret ADMIN_PASSWORD terlebih dahulu:\n" +
          "npx wrangler secret put ADMIN_PASSWORD",
        {
          status: 503,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
          },
        }
      ),
    };
  }

  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) {
    return {
      ok: false,
      actor: "",
      response: new Response("Authentication required", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Flazzstore Monitor", charset="UTF-8"',
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      }),
    };
  }

  try {
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(":");
    const user = separator >= 0 ? decoded.slice(0, separator) : decoded;
    const password = separator >= 0 ? decoded.slice(separator + 1) : "";
    const expectedUser = env.ADMIN_USER || "admin";
    if (user === expectedUser && password === env.ADMIN_PASSWORD) {
      return { ok: true, actor: user };
    }
  } catch {
    // fall through to 401
  }

  return {
    ok: false,
    actor: "",
    response: new Response("Invalid username or password", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Flazzstore Monitor", charset="UTF-8"',
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }),
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Telegram-Bot-Api-Secret-Token",
        },
      });
    }

    // 2. Telegram Webhook Endpoint (POST /webhook)
    if (url.pathname === "/webhook" && request.method === "POST") {
      // Validate Telegram secret token if configured
      if (env.TELEGRAM_SECRET_TOKEN) {
        const receivedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (receivedSecret !== env.TELEGRAM_SECRET_TOKEN) {
          return new Response("Unauthorized", { status: 403 });
        }
      }

      if (!env.TELEGRAM_BOT_TOKEN) {
        console.error("TELEGRAM_BOT_TOKEN is not configured");
        return new Response("Bot token missing", { status: 500 });
      }

      try {
        const update: TelegramUpdate = await request.json();
        const message = update.message || update.edited_message;

        if (message && message.text) {
          const chatId = message.chat.id;
          const rawQuery = message.text.trim();
          const commandMatch = rawQuery.match(/^(\/[a-zA-Z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
          const command = commandMatch ? commandMatch[1].toLowerCase() : "";
          const commandArgs = commandMatch && commandMatch[2] ? commandMatch[2].trim() : "";
          let query = rawQuery;
          const bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);

          // Handle Telegram Slash Commands
          if (command === "/start") {
            const welcomeText =
              `<b>Halo Kak! Selamat datang di Bot Flazzstore.</b>\n\n` +
              `Saya asisten virtual RAG Flazzstore yang siap membantu Kakak seputar:\n` +
              `• <b>Cek ketersediaan stok casing iPhone</b> — iPhone 7 Plus hingga iPhone 18\n` +
              `• <b>Katalog 1.100+ desain casing</b> — iPhone, Samsung Galaxy (Z Flip, Z Fold, S Series), dan lainnya\n` +
              `• <b>Info custom casing & desain gambar sendiri</b>\n\n` +
              `<i>Contoh pertanyaan yang bisa Kakak tanyakan:</i>\n` +
              `• "Stok casing iPhone 15 Pro Max ada berapa?"\n` +
              `• "Ada casing motif Japan Girl untuk iPhone 16?"\n` +
              `• "Casing Samsung S24 ada motif apa saja?"\n` +
              `• "Berapa sisa stok iPhone 11 Pro?"\n\n` +
              `Ketik /stok untuk ringkasan stok terbaru, /prompts untuk lima prompt tugas Tahap 1, atau langsung ketik pertanyaan Kakak.`;

            await bot.sendMessage(chatId, welcomeText, { parse_mode: "HTML" });
            return new Response("OK");
          }

          if (command === "/help") {
            const helpText =
              `<b>Panduan Bot Flazzstore</b>\n\n` +
              `• /start — sambutan & contoh pertanyaan\n` +
              `• /stok — ringkasan stok casing iPhone terbaru\n` +
              `• /stok iphone 15 pro — cek tipe tertentu\n` +
              `• /prompts — lima prompt tugas Tahap 1\n` +
              `   ↳ /restock, /normalisasi, /audit, /extract, /konsistensi\n` +
              `Prompt Lab: ${url.origin}/prompts\n\n` +
              `Atau langsung tanyakan stok, motif casing, dan custom desain.`;
            await bot.sendMessage(chatId, helpText, { parse_mode: "HTML" });
            return new Response("OK");
          }

          const promptCommands: Record<string, PromptId> = {
            "/restock": "restock",
            "/normalisasi": "normalisasi",
            "/audit": "audit",
            "/extract": "extract",
            "/konsistensi": "konsistensi",
          };

          if (command === "/prompts" || command === "/prompt") {
            const menuText =
              `<b>Lima Prompt Tugas — Tahap 1</b>\n\n` +
              `1. /restock — Prioritas restock <i>(zero-shot)</i>\n` +
              `2. /normalisasi — Normalisasi variasi "Tipe Hp" <i>(few-shot)</i>\n` +
              `3. /audit — Audit judul & variasi terhadap stok <i>(chain-of-thought)</i>\n` +
              `4. /extract — Ekstraksi listing ke JSON <i>(structured output)</i>\n` +
              `5. /konsistensi — Audit Total = stok + tambahan <i>(CoT + structured output)</i>\n\n` +
              `<b>Contoh pemakaian:</b>\n` +
              `<code>/restock 20</code>\n` +
              `<code>/normalisasi Iphone 14 Mini, XR, Iphone16 Pro</code>\n` +
              `<code>/audit Judul listing... | Iphone 15, Iphone 14 Mini</code>\n` +
              `<code>/extract IP-JOYFUL-0001</code>\n` +
              `<code>/konsistensi total=48 stok=45 tambahan=2</code>\n\n` +
              `<b>Prompt Lab (browser):</b> ${url.origin}/prompts\n\n` +
              `Tanpa argumen, bot memakai data demo dari katalog/stok saat ini.`;
            await bot.sendMessage(chatId, menuText, { parse_mode: "HTML" });
            return new Response("OK");
          }

          if (promptCommands[command]) {
            ctx.waitUntil(bot.sendChatAction(chatId, "typing"));
            const stockMap = await getStockMap(env);
            const result = runPrompt(promptCommands[command], commandArgs, stockMap);
            if (result) {
              await bot.sendMessage(chatId, result.text, { parse_mode: "HTML" });
            } else {
              await bot.sendMessage(chatId, "Prompt tidak ditemukan.");
            }
            return new Response("OK");
          }

          if ((command === "/stok" || command === "/stock") && commandArgs) {
            // "/stok iphone 15 pro" behaves like a normal RAG question.
            query = `stok ${commandArgs}`;
          } else if (command === "/stok" || command === "/stock") {
            const stockItems = await listStock(env);
            const summary = summariseStock(stockItems);
            const topStocked = stockItems
              .slice()
              .sort((a, b) => b.total_stock - a.total_stock)
              .slice(0, 10);
            const lowStock = stockItems
              .filter((item) => item.total_stock <= 15)
              .slice(0, 6);

            let stockSummary =
              `<b>Ringkasan Stok Casing iPhone Flazzstore</b>\n` +
              `Total: <b>${summary.totalUnits} unit</b> dari <b>${summary.totalModels} tipe</b>\n\n` +
              `<b>Stok terbanyak:</b>\n` +
              topStocked
                .map((s) => `• ${s.model}: <b>${s.total_stock} unit</b> (${s.status})`)
                .join("\n");

            if (lowStock.length > 0) {
              stockSummary +=
                `\n\n<b>Perlu restock (≤15 unit):</b>\n` +
                lowStock
                  .map((s) => `• ${s.model}: <b>${s.total_stock} unit</b>`)
                  .join("\n");
            }

            stockSummary +=
              `\n\n<i>Untuk cek tipe lain, ketik: "stok iPhone XR" atau /stok iPhone 13 Mini.</i>`;

            await bot.sendMessage(chatId, stockSummary, { parse_mode: "HTML" });
            return new Response("OK");
          }

          // Send typing indicator
          ctx.waitUntil(bot.sendChatAction(chatId, "typing"));

          // Process RAG Query
          const ragResult = await processRagQuery(query, env);

          // If top product has a photo URL, send photo with caption
          if (ragResult.topProductPhoto && ragResult.topProductPhoto.startsWith("http")) {
            await bot.sendPhoto(chatId, ragResult.topProductPhoto, ragResult.answer, {
              parse_mode: "HTML",
            });
          } else {
            await bot.sendMessage(chatId, ragResult.answer, { parse_mode: "HTML" });
          }
        }

        return new Response("OK", { status: 200 });
      } catch (err: any) {
        console.error("Webhook processing error:", err);
        return new Response("Internal Error", { status: 500 });
      }
    }

    // 3. REST API Endpoint (POST /api/chat) for testing queries
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body: any = await request.json();
        const query = (body.query || "").trim();
        if (!query) {
          return json({ error: "query is required" }, 400);
        }

        const history = Array.isArray(body.history) ? body.history : [];
        const result = await processRagQuery(query, env, history);
        return json({ ok: true, query, ...result });
      } catch (err: any) {
        return json({ error: err.message }, 500);
      }
    }

    // 4. Prompt Lab API (Tahap 1)
    if (url.pathname === "/api/prompts" && request.method === "GET") {
      return json({ ok: true, entries: PROMPT_ENTRIES });
    }

    if (url.pathname === "/api/prompts/run" && request.method === "POST") {
      try {
        const body: any = await request.json();
        const id = String(body.id || "").trim();
        const input = typeof body.input === "string" ? body.input : "";
        const entry = PROMPT_ENTRIES.find((item) => item.id === id);
        if (!entry) {
          return json({ error: "Prompt tidak ditemukan. Gunakan id: restock, normalisasi, audit, extract, konsistensi." }, 400);
        }

        const stockMap = await getStockMap(env);
        const result = runPrompt(id, input, stockMap);
        if (!result) return json({ error: "Prompt gagal dijalankan." }, 500);

        return json({
          ok: true,
          id: result.entry.id,
          title: result.entry.title,
          technique: result.entry.technique,
          text: result.text,
          data: result.data,
        });
      } catch (err: any) {
        return json({ error: err.message }, 500);
      }
    }

    // 5. Sync documents into Cloudflare Vectorize (POST /api/sync-vectorize)
    if (url.pathname === "/api/sync-vectorize" && request.method === "POST") {
      const admin = checkAdmin(request, env);
      if (!admin.ok) return admin.response!;

      if (!env.VECTOR_INDEX || !env.AI) {
        return json(
          {
            error:
              "VECTOR_INDEX atau Workers AI binding tidak ditemukan di environment Worker.",
          },
          400
        );
      }

      try {
        const body: any = await request.json().catch(() => ({}));
        const batchIndex = typeof body.batchIndex === "number" ? body.batchIndex : 0;
        const batchSize = Math.min(
          100,
          Math.max(1, typeof body.batchSize === "number" ? body.batchSize : 25)
        );

        const stockMap = await getStockMap(env);
        const allDocs = getAllRagDocuments(stockMap);
        const totalDocs = allDocs.length;
        const totalBatches = Math.ceil(totalDocs / batchSize);

        const start = batchIndex * batchSize;
        const batch = allDocs.slice(start, start + batchSize);

        if (batch.length === 0) {
          return json({ ok: true, done: true, totalDocs, totalBatches });
        }

        const embeddingModel = env.EMBEDDING_MODEL || "@cf/baai/bge-m3";
        const texts = batch.map((d) => `${d.title}: ${d.text}`);
        const embedRes: any = await env.AI.run(embeddingModel, { text: texts });
        const vectorsData = embedRes.data || embedRes;

        const vectors = batch.map((doc, idx) => ({
          id: doc.id,
          values: vectorsData[idx],
          metadata: {
            type: doc.type,
            title: doc.title,
            text: doc.text.slice(0, 1000),
            ...doc.metadata,
          },
        }));

        await env.VECTOR_INDEX.upsert(vectors);

        return json({
          ok: true,
          batchIndex,
          totalBatches,
          count: vectors.length,
          totalDocs,
          done: batchIndex + 1 >= totalBatches,
        });
      } catch (err: any) {
        return json({ error: err.message }, 500);
      }
    }

    // 5. Metadata / Stats Endpoint (GET /api/stats)
    if (url.pathname === "/api/stats") {
      const stockItems = await listStock(env);
      const summary = summariseStock(stockItems);
      const stats = {
        totalStockModels: summary.totalModels,
        totalStockUnits: summary.totalUnits,
        lowStockModels: summary.lowModels,
        outOfStockModels: summary.outModels,
        totalProducts: (knowledgeBase as any).products.length,
        totalRagDocuments:
          summary.totalModels + 1 + (knowledgeBase as any).products.length,
        promptCount: PROMPT_ENTRIES.length,
        modelsSupported: [
          "iPhone 18 / 17 / 16 / 15 / 14 / 13 / 12 / 11 / X / XR / 7 Plus",
          "Samsung Galaxy Z Flip & Fold",
          "Samsung Galaxy S20 - S26 Ultra / Plus",
          "Vivo & Xiaomi/Redmi",
        ],
        hasWorkersAI: Boolean(env.AI),
        hasVectorize: Boolean(env.VECTOR_INDEX),
        hasDatabase: Boolean(env.DB),
        hasTelegramBotToken: Boolean(env.TELEGRAM_BOT_TOKEN),
      };
      return json(stats);
    }

    // 6. Stock API for the monitoring dashboard (admin only)
    if (url.pathname === "/api/stocks" && request.method === "GET") {
      const admin = checkAdmin(request, env);
      if (!admin.ok) return admin.response!;

      const dbReady = await ensureStockDb(env);
      const items = await listStock(env);
      return json({
        ok: true,
        source: dbReady ? "d1" : "seed",
        summary: summariseStock(items),
        items,
      });
    }

    if (url.pathname === "/api/stocks" && request.method === "POST") {
      const admin = checkAdmin(request, env);
      if (!admin.ok) return admin.response!;

      try {
        const body: any = await request.json();
        const model = typeof body.model === "string" ? body.model.trim() : "";
        const totalStock = Number(body.total_stock);

        if (!model) return json({ error: "Nama tipe wajib diisi." }, 400);
        if (!Number.isFinite(totalStock) || totalStock < 0) {
          return json({ error: "Stok awal harus berupa angka ≥ 0." }, 400);
        }

        const result = await addStockModel(env, model, totalStock, admin.actor);
        if ("error" in result) return json({ error: result.error }, 409);

        let vectorSynced = false;
        try {
          const stockMap = await getStockMap(env);
          vectorSynced = await syncStockVectors(env, stockMap, result.item.model);
        } catch (syncErr) {
          console.warn("Vector sync after add failed:", syncErr);
        }

        return json({ ok: true, item: result.item, vectorSynced });
      } catch (err: any) {
        return json({ error: err.message }, 500);
      }
    }

    if (url.pathname === "/api/stocks/adjust" && request.method === "POST") {
      const admin = checkAdmin(request, env);
      if (!admin.ok) return admin.response!;

      try {
        const body: any = await request.json();
        const model = typeof body.model === "string" ? body.model.trim() : "";
        if (!model) return json({ error: "Model wajib diisi." }, 400);

        const hasDelta = body.delta !== undefined && body.delta !== null;
        const hasSetStock = body.setStock !== undefined && body.setStock !== null;
        if (!hasDelta && !hasSetStock) {
          return json({ error: "Isi delta atau setStock." }, 400);
        }

        const result = await adjustStock(env, model, {
          delta: hasDelta ? Number(body.delta) : undefined,
          setStock: hasSetStock ? Number(body.setStock) : undefined,
          note: typeof body.note === "string" ? body.note : "",
          actor: admin.actor,
        });

        if (!result) return json({ error: "Tipe iPhone tidak ditemukan." }, 404);

        let vectorSynced = false;
        try {
          const stockMap = await getStockMap(env);
          vectorSynced = await syncStockVectors(env, stockMap, model);
        } catch (syncErr) {
          console.warn("Vector sync after stock adjustment failed:", syncErr);
        }

        const items = await listStock(env);
        return json({
          ok: true,
          item: result.item,
          mutation: result.mutation,
          summary: summariseStock(items),
          vectorSynced,
        });
      } catch (err: any) {
        const message = String(err.message || err);
        const status = /tidak ditemukan|wajib|angka|delta/i.test(message) ? 400 : 500;
        return json({ error: message }, status);
      }
    }

    if (url.pathname === "/api/stocks/history" && request.method === "GET") {
      const admin = checkAdmin(request, env);
      if (!admin.ok) return admin.response!;

      const model = url.searchParams.get("model") || undefined;
      const limit = Number(url.searchParams.get("limit") || 30);
      const items = await getStockHistory(env, model, limit);
      return json({ ok: true, items });
    }

    // 7. Shared Agent UI assets (served identically by Cloudflare and Vercel).
    if (url.pathname === "/assets/agent-ui.css" && request.method === "GET") {
      return new Response(agentUiCss, {
        headers: {
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    if (url.pathname === "/assets/agent-ui.js" && request.method === "GET") {
      return new Response(agentUiJs, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // 8. Prompt Lab (GET /prompts) — also available on Vercel
    if (url.pathname === "/prompts" && request.method === "GET") {
      return new Response(promptLabHtml, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    // Frontend config. Cloudflare serves the API same-origin, so the base is
    // intentionally empty; Vercel serves a config.js pointing at this Worker.
    if (url.pathname === "/config.js" && request.method === "GET") {
      return new Response(
        `window.FLAZZ_API_BASE = "";\nwindow.FLAZZ_BOT_URL = "https://t.me/ragteleshofiyanbot";\n`,
        {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    // 9. Stock Monitoring Dashboard (GET /monitor)
    // The HTML is public (noindex) and contains no data; the login screen
    // authenticates against the protected /api/stocks endpoints instead.
    // This keeps Cloudflare and Vercel behaviour identical.
    if (url.pathname === "/monitor" && request.method === "GET") {
      return new Response(monitorHtml, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    // 10. RAG Chat UI (GET /)
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(indexHtml, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
