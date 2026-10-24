/**
 * Konfigurasi frontend Vercel.
 * Backend (AI, Vectorize, D1, Telegram) tetap berjalan di Cloudflare Worker.
 *
 * Ganti URL di bawah bila Worker dipindah ke domain lain.
 */
window.FLAZZ_API_BASE = "https://rag-tele-cf.rizki210605.workers.dev";
window.FLAZZ_BOT_URL = "https://t.me/ragteleshofiyanbot";
