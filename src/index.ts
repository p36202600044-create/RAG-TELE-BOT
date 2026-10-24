import { Env, TelegramUpdate } from "./types";
import { TelegramBot } from "./telegram";
import { processRagQuery, getAllRagDocuments } from "./rag";
import knowledgeBase from "../data/knowledge_base_compact.json";

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
          const query = message.text.trim();
          const bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);

          // Handle Telegram Slash Commands
          if (query === "/start") {
            const welcomeText =
              `👋 <b>Halo Kak! Selamat Datang di Bot Flazzstore!</b>\n\n` +
              `Saya adalah asisten virtual RAG Flazzstore yang siap membantu Kakak seputar:\n` +
              `📦 <b>Cek Ketersediaan Stok Casing</b> (khususnya tipe iPhone dari iPhone 7 Plus hingga iPhone 18)\n` +
              `📱 <b>Katalog 1.100+ Desain Casing</b> untuk iPhone, Samsung Galaxy (Z Flip, Z Fold, S Series), dll\n` +
              `🎨 <b>Info Custom Casing & Desain Gambar Sendiri</b>\n\n` +
              `<i>Contoh pertanyaan yang bisa Kakak tanyakan:</i>\n` +
              `• "Stok casing iPhone 15 Pro Max ada berapa?"\n` +
              `• "Ada casing motif Japan Girl untuk iPhone 16?"\n` +
              `• "Casing Samsung S24 ada motif apa saja?"\n` +
              `• "Berapa sisa stok iPhone 11 Pro?"\n\n` +
              `Silakan ketik pertanyaan Kakak langsung ya! 😊`;

            await bot.sendMessage(chatId, welcomeText, { parse_mode: "HTML" });
            return new Response("OK");
          }

          if (query === "/stok" || query === "/stock") {
            const stockSummary =
              `📦 <b>Ringkasan Stok Casing iPhone Flazzstore:</b>\n\n` +
              `• iPhone 17 Pro Max: <b>65 unit</b> (Ready)\n` +
              `• iPhone 17 Pro: <b>63 unit</b> (Ready)\n` +
              `• iPhone 17: <b>69 unit</b> (Ready)\n` +
              `• iPhone 16 Pro Max: <b>61 unit</b> (Ready)\n` +
              `• iPhone 16: <b>64 unit</b> (Ready)\n` +
              `• iPhone 15 Pro Max: <b>48 unit</b> (Ready)\n` +
              `• iPhone 15 Pro: <b>55 unit</b> (Ready)\n` +
              `• iPhone 14 Pro Max: <b>44 unit</b> (Ready)\n` +
              `• iPhone 13 Pro Max: <b>47 unit</b> (Ready)\n` +
              `• iPhone 12 Pro Max: <b>51 unit</b> (Ready)\n` +
              `• iPhone 11: <b>31 unit</b> (Ready)\n\n` +
              `<i>Untuk cek tipe lain (misal iPhone XR, 13 Mini, SE), cukup ketik: "stok iPhone XR".</i>`;

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
          return new Response(JSON.stringify({ error: "query is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const result = await processRagQuery(query, env);
        return new Response(JSON.stringify({ ok: true, query, ...result }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // 4. Sync documents into Cloudflare Vectorize (POST /api/sync-vectorize)
    if (url.pathname === "/api/sync-vectorize" && request.method === "POST") {
      if (!env.VECTOR_INDEX || !env.AI) {
        return new Response(
          JSON.stringify({
            error: "VECTOR_INDEX atau Workers AI binding tidak ditemukan di environment Worker.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      try {
        const body: any = await request.json().catch(() => ({}));
        const batchIndex = typeof body.batchIndex === "number" ? body.batchIndex : 0;
        const batchSize = typeof body.batchSize === "number" ? body.batchSize : 25;

        const allDocs = getAllRagDocuments();
        const totalDocs = allDocs.length;
        const totalBatches = Math.ceil(totalDocs / batchSize);

        const start = batchIndex * batchSize;
        const batch = allDocs.slice(start, start + batchSize);

        if (batch.length === 0) {
          return new Response(
            JSON.stringify({ ok: true, done: true, totalDocs, totalBatches }),
            { headers: { "Content-Type": "application/json" } }
          );
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

        return new Response(
          JSON.stringify({
            ok: true,
            batchIndex,
            totalBatches,
            count: vectors.length,
            totalDocs,
            done: batchIndex + 1 >= totalBatches,
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // 5. Metadata / Stats Endpoint (GET /api/stats)
    if (url.pathname === "/api/stats") {
      const stats = {
        totalStockModels: Object.keys((knowledgeBase as any).stock).length,
        totalProducts: (knowledgeBase as any).products.length,
        modelsSupported: [
          "iPhone 18 / 17 / 16 / 15 / 14 / 13 / 12 / 11 / X / XR / 7 Plus",
          "Samsung Galaxy Z Flip & Fold",
          "Samsung Galaxy S20 - S26 Ultra / Plus",
          "Vivo & Xiaomi/Redmi",
        ],
        hasWorkersAI: Boolean(env.AI),
        hasVectorize: Boolean(env.VECTOR_INDEX),
        hasTelegramBotToken: Boolean(env.TELEGRAM_BOT_TOKEN),
      };
      return new Response(JSON.stringify(stats, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // 5. Interactive Testing Web UI (GET /)
    if (url.pathname === "/" && request.method === "GET") {
      const html = renderWebUI();
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};

/**
 * Beautiful, modern HTML Testing Interface for the RAG Bot
 */
function renderWebUI(): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flazzstore RAG AI - Cloudflare & Telegram</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-gradient: radial-gradient(circle at 10% 20%, #0d1117 0%, #161b22 100%);
      --card-bg: rgba(22, 27, 34, 0.85);
      --card-border: rgba(255, 255, 255, 0.08);
      --primary: #38bdf8;
      --primary-hover: #0ea5e9;
      --accent: #818cf8;
      --text-main: #f0f6fc;
      --text-muted: #8b949e;
      --telegram-blue: #229ED9;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: var(--bg-gradient);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px 16px;
    }
    .container {
      width: 100%;
      max-width: 860px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    header {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 20px 24px;
      backdrop-filter: blur(12px);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .logo-badge {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: linear-gradient(135deg, #f97316, #ec4899);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      font-weight: 700;
      color: #fff;
      box-shadow: 0 8px 16px rgba(249, 115, 22, 0.3);
    }
    h1 { font-size: 20px; font-weight: 700; }
    .subtitle { font-size: 13px; color: var(--text-muted); }
    .tags {
      display: flex;
      gap: 8px;
    }
    .tag {
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 20px;
      background: rgba(56, 189, 248, 0.12);
      color: var(--primary);
      border: 1px solid rgba(56, 189, 248, 0.25);
    }
    .tag.telegram {
      background: rgba(34, 158, 217, 0.15);
      color: var(--telegram-blue);
      border-color: rgba(34, 158, 217, 0.3);
    }
    .stats-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 14px 18px;
      backdrop-filter: blur(8px);
    }
    .stat-val { font-size: 22px; font-weight: 700; color: #fff; }
    .stat-lbl { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

    .chat-box {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      height: 480px;
      backdrop-filter: blur(12px);
    }
    .messages {
      flex: 1;
      padding: 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .msg {
      max-width: 82%;
      padding: 12px 16px;
      border-radius: 14px;
      line-height: 1.5;
      font-size: 14px;
      word-wrap: break-word;
    }
    .msg.bot {
      align-self: flex-start;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #e6edf3;
    }
    .msg.user {
      align-self: flex-end;
      background: linear-gradient(135deg, #0284c7, #2563eb);
      color: #fff;
    }
    .msg img {
      max-width: 100%;
      border-radius: 8px;
      margin-top: 10px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .chips {
      display: flex;
      gap: 8px;
      padding: 10px 16px;
      overflow-x: auto;
      background: rgba(13, 17, 23, 0.6);
      border-top: 1px solid var(--card-border);
    }
    .chip {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      padding: 6px 12px;
      font-size: 12px;
      color: #cbd5e1;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s;
    }
    .chip:hover {
      background: rgba(56, 189, 248, 0.2);
      color: var(--primary);
      border-color: var(--primary);
    }
    .input-row {
      display: flex;
      padding: 14px 16px;
      background: rgba(13, 17, 23, 0.9);
      border-top: 1px solid var(--card-border);
      gap: 10px;
    }
    input[type="text"] {
      flex: 1;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      padding: 12px 16px;
      color: #fff;
      font-size: 14px;
      outline: none;
    }
    input[type="text"]:focus {
      border-color: var(--primary);
    }
    button {
      background: var(--primary);
      color: #0d1117;
      font-weight: 600;
      border: none;
      border-radius: 10px;
      padding: 0 20px;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover { background: var(--primary-hover); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="logo-badge">⚡</div>
        <div>
          <h1>Flazzstore RAG Assistant</h1>
          <div class="subtitle">Cloudflare Workers AI + Vectorize + Telegram Bot</div>
        </div>
      </div>
      <div class="tags">
        <span class="tag">Cloudflare Edge</span>
        <span class="tag telegram">Telegram Bot</span>
      </div>
    </header>

    <div class="stats-bar">
      <div class="stat-card">
        <div class="stat-val">35 Tipe</div>
        <div class="stat-lbl">Stok Casing iPhone (PDF)</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">1.114 Produk</div>
        <div class="stat-lbl">Katalog Casing Custom (Excel)</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">1.150 Dokumen</div>
        <div class="stat-lbl">Index Vector RAG</div>
      </div>
    </div>

    <div class="chat-box">
      <div class="messages" id="messages">
        <div class="msg bot">
          👋 Halo Kak! Saya adalah bot RAG Flazzstore yang siap menjawab seputar stok casing iPhone dan 1.100+ katalog casing hp custom. Coba tanyakan sesuatu! 😊
        </div>
      </div>

      <div class="sync-banner" style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 12px; padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <div>
          <div style="font-weight: 600; font-size: 14px; color: var(--primary);">⚡ Database Cloudflare Vectorize</div>
          <div id="syncStatus" style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Index: <code>rag-tele-index</code> (1.150 dokumen siap sinkronisasi)</div>
          <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; margin-top: 8px; overflow: hidden; display: none;" id="syncBarContainer">
            <div id="syncBar" style="width: 0%; height: 100%; background: var(--primary); transition: width 0.3s;"></div>
          </div>
        </div>
        <button id="syncBtn" onclick="startVectorizeSync()" style="padding: 8px 16px; font-size: 12px;">Sync ke Cloudflare Vectorize</button>
      </div>

      <div class="chips">
        <span class="chip" onclick="askChip(this)">Stok iPhone 15 Pro Max</span>
        <span class="chip" onclick="askChip(this)">Casing Japan Girl untuk iPhone 16</span>
        <span class="chip" onclick="askChip(this)">Casing Samsung S24 motif kayu</span>
        <span class="chip" onclick="askChip(this)">Berapa stok iPhone 11 dan 13?</span>
        <span class="chip" onclick="askChip(this)">Bisa custom gambar sendiri?</span>
      </div>

      <form class="input-row" onsubmit="handleSubmit(event)">
        <input type="text" id="userInput" placeholder="Tanyakan stok atau desain casing..." autocomplete="off">
        <button type="submit">Kirim</button>
      </form>
    </div>
  </div>

  <script>
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('userInput');

    function appendMessage(text, isUser, photoUrl) {
      const msg = document.createElement('div');
      msg.className = 'msg ' + (isUser ? 'user' : 'bot');
      msg.innerHTML = text.replace(/\\n/g, '<br>');
      if (photoUrl) {
        const img = document.createElement('img');
        img.src = photoUrl;
        img.alt = 'Foto Produk';
        msg.appendChild(img);
      }
      messagesEl.appendChild(msg);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function askChip(el) {
      inputEl.value = el.innerText;
      handleSubmit(new Event('submit'));
    }

    async function startVectorizeSync() {
      const btn = document.getElementById('syncBtn');
      const barContainer = document.getElementById('syncBarContainer');
      const bar = document.getElementById('syncBar');
      const status = document.getElementById('syncStatus');
      btn.disabled = true;
      barContainer.style.display = 'block';
      status.innerText = 'Memulai sinkronisasi vektor ke Cloudflare...';
      let batchIndex = 0;
      let done = false;
      while (!done) {
        try {
          const res = await fetch('/api/sync-vectorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchIndex, batchSize: 25 })
          });
          const data = await res.json();
          if (!data.ok) {
            status.innerText = 'Error: ' + (data.error || 'Gagal sinkron');
            btn.disabled = false;
            return;
          }
          batchIndex++;
          done = data.done;
          const pct = Math.min(100, Math.round((batchIndex / data.totalBatches) * 100));
          bar.style.width = pct + '%';
          status.innerText = 'Menyimpan batch ' + batchIndex + '/' + data.totalBatches + ' (' + pct + '%)...';
        } catch(err) {
          status.innerText = 'Gagal: ' + err.message;
          btn.disabled = false;
          return;
        }
      }
      status.innerText = '✅ Berhasil! Semua 1.150 dokumen tersimpan di Cloudflare Vectorize.';
      btn.innerText = 'Tersinkronisasi ✅';
    }

    async function handleSubmit(e) {
      e.preventDefault();
      const text = inputEl.value.trim();
      if (!text) return;

      appendMessage(text, true);
      inputEl.value = '';

      const loadingMsg = document.createElement('div');
      loadingMsg.className = 'msg bot';
      loadingMsg.innerText = 'Sedang mencari data... 🔍';
      messagesEl.appendChild(loadingMsg);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: text })
        });
        const data = await res.json();
        messagesEl.removeChild(loadingMsg);
        if (data.ok) {
          appendMessage(data.answer, false, data.topProductPhoto);
        } else {
          appendMessage('Maaf, terjadi kesalahan: ' + (data.error || 'Unknown error'), false);
        }
      } catch (err) {
        messagesEl.removeChild(loadingMsg);
        appendMessage('Gagal terhubung ke server.', false);
      }
    }
  </script>
</body>
</html>`;
}
