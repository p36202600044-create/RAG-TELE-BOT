#!/usr/bin/env python3
"""
Local Telegram Bot runner (Long Polling Mode).
Allows testing the RAG Telegram bot immediately on your local machine
without needing a public webhook URL or Cloudflare deployment yet.

Usage:
  1. Set TELEGRAM_BOT_TOKEN in .env or pass as argument:
     python3 scripts/local_bot.py
     python3 scripts/local_bot.py --token "YOUR_TELEGRAM_BOT_TOKEN"
"""

import sys
import os
import json
import time
import urllib.request
import urllib.parse
import re

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
KB_FILE = os.path.join(DATA_DIR, "knowledge_base.json")
ENV_FILE = os.path.join(BASE_DIR, ".env")

def load_env():
    env = {}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def load_kb():
    if not os.path.exists(KB_FILE):
        print(f"Error: {KB_FILE} not found. Please run 'python3 scripts/ingest.py' first.")
        sys.exit(1)
    with open(KB_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def tokenize(text):
    return [t for t in re.sub(r'[^a-zA-Z0-9\s]', ' ', text.lower()).split() if len(t) > 1]

def match_stock(query, stock_dict):
    q_lower = query.lower()
    matched = []
    models_sorted = sorted(stock_dict.keys(), key=lambda x: len(x), reverse=True)
    for model in models_sorted:
        m_lower = model.lower()
        if m_lower in q_lower:
            matched.append(stock_dict[model])
            continue
        short = re.sub(r'^iphone\s*', '', m_lower).strip()
        if short and re.search(r'\b' + re.escape(short) + r'\b', q_lower):
            matched.append(stock_dict[model])
    return matched

def search_products(query, products, limit=3):
    tokens = tokenize(query)
    if not tokens:
        return []
    scored = []
    for p in products:
        score = 0
        name = p["name"].lower()
        sku = p.get("sku", "").lower()
        brand = p.get("brand", "").lower()
        vars_text = " ".join(p.get("variations", [])).lower()
        
        for t in tokens:
            if t in sku: score += 15
            if t in name: score += 6
            if t in vars_text: score += 4
            if t in brand: score += 3
        
        if query.lower().strip() in name:
            score += 20
        
        if score > 0:
            scored.append((score, p))
    
    scored.sort(key=lambda x: x[0], reverse=True)
    return [p for _, p in scored[:limit]]

def generate_rag_answer(query, kb):
    matched_stocks = match_stock(query, kb["stock"])
    matched_prods = search_products(query, kb["products"], limit=3)
    
    lines = ["Halo Kak! Terima kasih sudah menghubungi Flazzstore. 😊\n"]
    top_photo = None

    if matched_stocks:
        lines.append("📦 <b>Informasi Stok Casing:</b>")
        for s in matched_stocks:
            lines.append(f"• <b>{s['model']}</b>: Tersedia <b>{s['total_stock']} unit</b> ({s['status']})")
        lines.append("")

    if matched_prods:
        lines.append("📱 <b>Rekomendasi Produk & Desain:</b>")
        for p in matched_prods:
            lines.append(f"• <b>{p['name']}</b>")
            if p.get("sku"):
                lines.append(f"  SKU: <code>{p['sku']}</code>")
            vars_prev = ", ".join(p.get("variations", [])[:5])
            if vars_prev:
                lines.append(f"  Tipe HP: <i>{vars_prev}...</i>")
            if not top_photo and p.get("cover_image") and p["cover_image"].startswith("http"):
                top_photo = p["cover_image"]
        lines.append("")

    if not matched_stocks and not matched_prods:
        lines.append(
            "Kami menyediakan ribuan motif casing custom untuk iPhone, Samsung Galaxy (Z Flip, Z Fold, S Series), dll. "
            "Kakak juga bisa custom cetak foto/gambar sendiri! ✨\n\n"
            "Silakan sebutkan tipe HP atau motif yang Kakak inginkan."
        )
    else:
        lines.append("Casing ready untuk diproses cetak! Ada yang ingin ditanyakan lagi? 😊")

    return "\n".join(lines), top_photo

class TelegramClient:
    def __init__(self, token):
        self.token = token
        self.base_url = f"https://api.telegram.org/bot{token}"

    def get_updates(self, offset=None, timeout=30):
        url = f"{self.base_url}/getUpdates?timeout={timeout}"
        if offset:
            url += f"&offset={offset}"
        req = urllib.request.Request(url)
        try:
            with urllib.request.urlopen(req, timeout=timeout+10) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"[Warn] getUpdates error: {e}")
            return {"ok": False, "result": []}

    def send_message(self, chat_id, text, parse_mode="HTML"):
        url = f"{self.base_url}/sendMessage"
        payload = json.dumps({
            "chat_id": chat_id,
            "text": text,
            "parse_mode": parse_mode
        }).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"[Error] sendMessage error: {e}")
            # Try fallback without parse_mode
            if parse_mode:
                self.send_message(chat_id, text, parse_mode=None)

    def send_photo(self, chat_id, photo_url, caption="", parse_mode="HTML"):
        url = f"{self.base_url}/sendPhoto"
        payload = json.dumps({
            "chat_id": chat_id,
            "photo": photo_url,
            "caption": caption[:1024] if caption else "",
            "parse_mode": parse_mode
        }).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"[Warn] sendPhoto failed, falling back to text: {e}")
            self.send_message(chat_id, caption or f"Lihat foto: {photo_url}")

    def send_chat_action(self, chat_id, action="typing"):
        url = f"{self.base_url}/sendChatAction"
        payload = json.dumps({"chat_id": chat_id, "action": action}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req):
                pass
        except Exception:
            pass

def main():
    print("=" * 60)
    print("🤖 FLAZZSTORE RAG TELEGRAM BOT (LOCAL RUNNER)")
    print("=" * 60)

    env_vars = load_env()
    token = None

    # Check CLI argument
    if len(sys.argv) > 1 and sys.argv[1].startswith("--token="):
        token = sys.argv[1].split("=", 1)[1]
    elif len(sys.argv) > 2 and sys.argv[1] == "--token":
        token = sys.argv[2]
    elif "TELEGRAM_BOT_TOKEN" in env_vars:
        token = env_vars["TELEGRAM_BOT_TOKEN"]

    if not token or token == "YOUR_TELEGRAM_BOT_TOKEN_HERE":
        print("\n⚠️  TELEGRAM_BOT_TOKEN belum diset.")
        print("Silakan masukkan Telegram Bot Token dari @BotFather di bawah ini:")
        try:
            token = input("Bot Token: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nDibatalkan.")
            sys.exit(0)

    if not token:
        print("Bot token kosong. Keluar.")
        sys.exit(1)

    kb = load_kb()
    print(f"\n✅ Knowledge Base loaded: {len(kb['stock'])} stok iPhone & {len(kb['products'])} katalog produk.")

    tg = TelegramClient(token)

    # Check bot identity
    try:
        req = urllib.request.Request(f"{tg.base_url}/getMe")
        with urllib.request.urlopen(req) as resp:
            bot_info = json.loads(resp.read().decode("utf-8"))
            if bot_info.get("ok"):
                username = bot_info["result"].get("username")
                name = bot_info["result"].get("first_name")
                print(f"🤖 Terhubung ke Bot: @{username} ({name})")
            else:
                print(f"❌ Token bot tidak valid: {bot_info}")
                sys.exit(1)
    except Exception as e:
        print(f"❌ Gagal koneksi ke Telegram API: {e}")
        sys.exit(1)

    print("\n🚀 Bot aktif dan mendengarkan pesan (Polling Mode)...")
    print("Tekan Ctrl+C untuk berhenti.\n")

    offset = None
    while True:
        try:
            res = tg.get_updates(offset=offset, timeout=20)
            if res.get("ok") and res.get("result"):
                for update in res["result"]:
                    offset = update["update_id"] + 1
                    msg = update.get("message")
                    if not msg or not msg.get("text"):
                        continue

                    chat_id = msg["chat"]["id"]
                    user_name = msg.get("from", {}).get("first_name", "Pelanggan")
                    text = msg["text"].strip()
                    print(f"📩 [{user_name}]: {text}")

                    tg.send_chat_action(chat_id, "typing")

                    if text == "/start":
                        welcome = (
                            f"👋 <b>Halo {user_name}! Selamat datang di Flazzstore!</b>\n\n"
                            f"Saya adalah Bot Asisten Cerdas RAG Flazzstore.\n"
                            f"Saya bisa bantu cek:\n"
                            f"📦 <b>Stok Casing iPhone</b> (35 tipe lengkap)\n"
                            f"📱 <b>Katalog 1.100+ Desain Casing</b> (iPhone, Samsung Galaxy, dll)\n"
                            f"🎨 <b>Pemesanan Custom Gambar Sendiri</b>\n\n"
                            f"<i>Coba tanyakan misalnya:</i>\n"
                            f"• 'Berapa stok iPhone 15 Pro Max?'\n"
                            f"• 'Ada casing motif Japan Girl?'\n"
                            f"• 'Casing Samsung S24 motif apa aja?'\n\n"
                            f"Silakan ketik pertanyaan Kakak ya! 😊"
                        )
                        tg.send_message(chat_id, welcome)
                        continue

                    if text in ["/stok", "/stock"]:
                        stock_info = (
                            "📦 <b>Ringkasan Stok Casing iPhone Terpopuler:</b>\n\n"
                            "• iPhone 17 Pro Max: <b>65 unit</b>\n"
                            "• iPhone 17 Pro: <b>63 unit</b>\n"
                            "• iPhone 17: <b>69 unit</b>\n"
                            "• iPhone 16 Pro Max: <b>61 unit</b>\n"
                            "• iPhone 16: <b>64 unit</b>\n"
                            "• iPhone 15 Pro Max: <b>48 unit</b>\n"
                            "• iPhone 15 Pro: <b>55 unit</b>\n"
                            "• iPhone 14 Pro Max: <b>44 unit</b>\n"
                            "• iPhone 13 Pro Max: <b>47 unit</b>\n"
                            "• iPhone 12 Pro Max: <b>51 unit</b>\n"
                            "• iPhone 11: <b>31 unit</b>\n\n"
                            "<i>Ketik 'stok [tipe]' untuk cek tipe lainnya!</i>"
                        )
                        tg.send_message(chat_id, stock_info)
                        continue

                    # Process RAG
                    answer, photo_url = generate_rag_answer(text, kb)

                    if photo_url:
                        tg.send_photo(chat_id, photo_url, caption=answer)
                    else:
                        tg.send_message(chat_id, answer)

                    print(f"📤 [Bot -> {user_name}]: Pesan terkirim.")
            time.sleep(1)
        except KeyboardInterrupt:
            print("\n🛑 Bot dihentikan.")
            break
        except Exception as e:
            print(f"[Error loop]: {e}")
            time.sleep(2)

if __name__ == "__main__":
    main()
