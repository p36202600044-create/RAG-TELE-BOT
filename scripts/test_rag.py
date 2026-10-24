#!/usr/bin/env python3
"""
Test script for RAG retrieval and answers locally in CLI.
Usage:
  python3 scripts/test_rag.py "Berapa stok iPhone 15 Pro Max?"
  python3 scripts/test_rag.py "Ada casing Japan Girl buat iPhone 14?"
  python3 scripts/test_rag.py (runs test suite of sample queries)
"""

import sys
import os
import json
import re

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
KB_FILE = os.path.join(DATA_DIR, "knowledge_base.json")

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
        # short model without 'iphone'
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

def run_query(query, kb):
    print(f"\n========================================================")
    print(f"🔍 PERTANYAAN: \"{query}\"")
    print(f"========================================================")

    matched_stocks = match_stock(query, kb["stock"])
    matched_prods = search_products(query, kb["products"], limit=3)

    print("\n📦 HASIL PENCARIAN STOK GUDANG:")
    if matched_stocks:
        for s in matched_stocks:
            print(f"  • {s['model']}: {s['total_stock']} unit (Status: {s['status']})")
    else:
        print("  (Tidak ada kecocokan tipe iPhone spesifik pada pertanyaan)")

    print("\n📱 HASIL PENCARIAN KATALOG PRODUK:")
    if matched_prods:
        for p in matched_prods:
            vars_prev = ", ".join(p["variations"][:6]) + ("..." if len(p["variations"]) > 6 else "")
            print(f"  • {p['name']}")
            print(f"    SKU: {p['sku'] or '-'} | Brand: {p['brand']}")
            print(f"    Variasi Tipe: {vars_prev}")
            print(f"    Foto: {p['cover_image']}")
    else:
        print("  (Tidak ada produk spesifik yang cocok)")

    print("\n💬 DRAF JAWABAN BOT TELEGRAM:")
    print("--------------------------------------------------------")
    lines = ["Halo Kak! Terima kasih sudah menghubungi Flazzstore. 😊\n"]
    if matched_stocks:
        lines.append("📦 Informasi Stok Casing:")
        for s in matched_stocks:
            lines.append(f"• {s['model']}: Tersedia {s['total_stock']} unit ({s['status']})")
        lines.append("")
    if matched_prods:
        lines.append("📱 Rekomendasi Desain Produk:")
        for p in matched_prods:
            lines.append(f"• {p['name']}")
            if p['sku']: lines.append(f"  SKU: {p['sku']}")
            vars_prev = ", ".join(p["variations"][:5])
            if vars_prev: lines.append(f"  Tipe kompatibel: {vars_prev}...")
        lines.append("")
    lines.append("Casing siap diproses dan dicetak custom! Ada yang ingin ditanyakan lagi? 😊")
    print("\n".join(lines))
    print("--------------------------------------------------------")

def main():
    kb = load_kb()
    if len(sys.argv) > 1:
        query = " ".join(sys.argv[1:])
        run_query(query, kb)
    else:
        test_queries = [
            "Berapa stok casing iPhone 15 Pro Max?",
            "Ada casing motif Japan Girl untuk iPhone 14 Pro?",
            "Casing Samsung Galaxy S24 motif kayu (wood) ada?",
            "iPhone apa saja yang stoknya di atas 60?",
            "Bisa custom desain gambar sendiri?"
        ]
        print(f"Menjalankan {len(test_queries)} sampel pengujian RAG...")
        for q in test_queries:
            run_query(q, kb)

if __name__ == "__main__":
    main()
