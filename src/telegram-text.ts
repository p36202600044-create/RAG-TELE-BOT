import { StockItem } from "./types";
import { summariseStock } from "./stock";
import { stockLabel } from "./rag";

/**
 * Message builders for the Telegram bot.
 *
 * Keeping them here (instead of inline in the webhook handler) makes the exact
 * customer-facing text testable without calling the Telegram API. All messages
 * are HTML parse-mode safe and intentionally emoji-free.
 */

export function welcomeMessage(): string {
  return (
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
    `Ketik /stok untuk ringkasan stok terbaru, /prompts untuk lima prompt tugas Tahap 1, atau langsung ketik pertanyaan Kakak.`
  );
}

export function helpMessage(_origin: string): string {
  return (
    `<b>Panduan Bot Flazzstore</b>\n\n` +
    `• /start — sambutan & contoh pertanyaan\n` +
    `• /stok — ringkasan stok casing iPhone terbaru\n` +
    `• /stok iphone 15 pro — cek tipe tertentu\n` +
    `• /prompts — lima prompt tugas Tahap 1\n` +
    `   ↳ /restock, /normalisasi, /audit, /extract, /konsistensi\n` +
    `Prompt Lab: https://rag-tele.vercel.app/\n\n` +
    `Atau langsung tanyakan stok, motif casing, dan custom desain.`
  );
}

export function promptsMenuMessage(_origin: string): string {
  return (
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
    `<b>Prompt Lab (browser):</b> https://rag-tele.vercel.app/\n\n` +
    `Tanpa argumen, bot memakai data demo dari katalog/stok saat ini.`
  );
}

export function stockSummaryMessage(stockItems: StockItem[]): string {
  const summary = summariseStock(stockItems);
  const topStocked = stockItems
    .slice()
    .sort((a, b) => b.total_stock - a.total_stock)
    .slice(0, 10);
  const lowStock = stockItems
    .filter((item) => item.total_stock <= 15)
    .slice(0, 6);

  let message =
    `<b>Ringkasan Stok Casing iPhone Flazzstore</b>\n` +
    `Total: <b>${summary.totalUnits} unit</b> dari <b>${summary.totalModels} tipe</b>\n\n` +
    `<b>Stok terbanyak:</b>\n` +
    topStocked
      .map(
        (s) =>
          `• ${s.model}: <b>${s.total_stock} unit</b> (${stockLabel(s.total_stock)})`
      )
      .join("\n");

  if (lowStock.length > 0) {
    message +=
      `\n\n<b>Perlu restock (≤15 unit):</b>\n` +
      lowStock
        .map((s) => `• ${s.model}: <b>${s.total_stock} unit</b>`)
        .join("\n");
  }

  message +=
    `\n\n<i>Untuk cek tipe lain, ketik: "stok iPhone XR" atau /stok iPhone 13 Mini.</i>`;

  return message;
}
