#!/usr/bin/env python3
"""
Ingestion script for RAG System.
Extracts data from:
1. resource/STOCK CASING - iPhone.pdf
2. resource/model.xlsx
Outputs structured datasets into data/ folder for Cloudflare Vectorize and Workers AI RAG.
"""

import os
import re
import json
import zipfile
import xml.etree.ElementTree as ET
import pypdf

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESOURCE_DIR = os.path.join(BASE_DIR, "resource")
DATA_DIR = os.path.join(BASE_DIR, "data")
PDF_PATH = os.path.join(RESOURCE_DIR, "STOCK CASING - iPhone.pdf")
EXCEL_PATH = os.path.join(RESOURCE_DIR, "model.xlsx")

def parse_stock_pdf(pdf_path):
    print(f"[1/3] Parsing Stock PDF: {pdf_path}")
    reader = pypdf.PdfReader(pdf_path)
    stock_dict = {}

    # Page 1: Initial stock & change
    p1_text = reader.pages[0].extract_text()
    for line in p1_text.split("\n"):
        line = line.strip()
        m = re.match(r"^(iPhone\s+.+?)\s+(\d+)\s+(\d+)$", line)
        if m:
            model, s_senin, change = m.groups()
            model_clean = model.strip()
            stock_dict[model_clean] = {
                "model": model_clean,
                "senin_stock": int(s_senin),
                "change": int(change),
                "total_stock": int(s_senin)
            }

    # Page 2: Final / Total stock column
    if len(reader.pages) > 1:
        p2_text = reader.pages[1].extract_text()
        lines = [l.strip() for l in p2_text.split("\n") if l.strip()]
        if "Jumat Sabtu Total" in lines:
            sep_idx = lines.index("Jumat Sabtu Total")
            models_p2 = lines[2:sep_idx]
            numbers_p2 = lines[sep_idx + 1:]
            for m, n in zip(models_p2, numbers_p2):
                clean_m = m.strip()
                val = int(n.strip()) if n.strip().isdigit() else None
                if val is not None:
                    matched = False
                    for k in stock_dict:
                        if clean_m.lower() == k.lower():
                            stock_dict[k]["total_stock"] = val
                            matched = True
                            break
                    if not matched:
                        stock_dict[clean_m] = {
                            "model": clean_m,
                            "senin_stock": val,
                            "change": 0,
                            "total_stock": val
                        }

    # Normalize status
    for model, item in stock_dict.items():
        total = item["total_stock"]
        if total <= 5:
            item["status"] = "Stok Sangat Terbatas (Hampir Habis)"
        elif total <= 15:
            item["status"] = "Stok Terbatas"
        elif total <= 30:
            item["status"] = "Stok Sedang"
        else:
            item["status"] = "Stok Banyak / Ready"

    print(f"  -> Extracted {len(stock_dict)} iPhone stock models.")
    return stock_dict


def parse_catalog_excel(excel_path):
    print(f"[2/3] Parsing Product Catalog Excel: {excel_path}")
    products = []
    
    with zipfile.ZipFile(excel_path, "r") as z:
        sst_root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        strings = []
        for elem in sst_root.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si"):
            t = "".join([node.text for node in elem.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t") if node.text])
            strings.append(t)

        sheet_root = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        rows = sheet_root.findall(".//s:row", ns)

        variation_cols = [
            "Q", "S", "U", "W", "Y", "AA", "AC", "AE", "AG", "AI", "AK", "AM",
            "AO", "AQ", "AS", "AU", "AW", "AY", "BA", "BC", "BE", "BG", "BI",
            "BK", "BM", "BO", "BQ", "BS", "BU", "BW", "BY", "CA", "CC", "CE",
            "CG", "CI", "CK"
        ]

        for r in rows[6:]:
            row_dict = {}
            for c in r.findall("s:c", ns):
                coord = c.get("r")
                col = "".join([ch for ch in coord if ch.isalpha()])
                v = c.find("s:v", ns)
                val = v.text if v is not None else ""
                if c.get("t") == "s" and val.isdigit():
                    val = strings[int(val)] if int(val) < len(strings) else val
                row_dict[col] = val.strip() if isinstance(val, str) else str(val)

            prod_id = row_dict.get("A", "")
            if not prod_id:
                continue

            name = row_dict.get("C", "")
            sku = row_dict.get("B", "")
            category = row_dict.get("D", "")
            cover_image = row_dict.get("E", "")

            # Images
            images = []
            for col in ["E", "F", "G", "H", "I", "J", "K", "L", "M"]:
                img = row_dict.get(col, "")
                if img and img.startswith("http") and img not in images:
                    images.append(img)

            # Variations (phone models supported)
            variations = []
            for col in variation_cols:
                v_val = row_dict.get(col, "")
                if v_val and v_val != "-" and v_val not in variations:
                    variations.append(v_val)

            # Detect brand
            lower_name = name.lower()
            brands = []
            if "iphone" in lower_name:
                brands.append("iPhone")
            if "samsung" in lower_name:
                brands.append("Samsung")
            if "xiaomi" in lower_name or "redmi" in lower_name:
                brands.append("Xiaomi/Redmi")
            if "oppo" in lower_name:
                brands.append("Oppo")
            if "vivo" in lower_name:
                brands.append("Vivo")
            brand = "/".join(brands) if brands else "Universal/Lainnya"

            products.append({
                "id": prod_id,
                "sku": sku,
                "name": name,
                "brand": brand,
                "category": category,
                "cover_image": cover_image,
                "images": images[:4],
                "variations": variations
            })

    print(f"  -> Extracted {len(products)} products from catalog.")
    return products


def generate_rag_documents(stock_dict, products):
    print("[3/3] Generating RAG Documents and Chunks for Vectorize...")
    docs = []

    # 1. Master stock overview chunk
    total_inventory = sum(item["total_stock"] for item in stock_dict.values())
    top_stocked = sorted(stock_dict.values(), key=lambda x: x["total_stock"], reverse=True)[:5]
    low_stocked = sorted(stock_dict.values(), key=lambda x: x["total_stock"])[:5]
    
    top_str = ", ".join([f"{x['model']} ({x['total_stock']} unit)" for x in top_stocked])
    low_str = ", ".join([f"{x['model']} ({x['total_stock']} unit)" for x in low_stocked])
    
    master_stock_text = (
        f"Laporan Inventaris & Total Stok Casing Flazzstore iPhone:\n"
        f"- Total keseluruhan stok fisik casing iPhone di gudang adalah {total_inventory} unit yang mencakup {len(stock_dict)} tipe iPhone.\n"
        f"- Model dengan stok paling melimpah: {top_str}.\n"
        f"- Model dengan stok paling terbatas: {low_str}.\n"
        f"Stok ini adalah stok fisik casing polos / casing dasar yang siap dicetak custom sesuai desain motif pilihan pelanggan."
    )
    docs.append({
        "id": "doc_stock_master_overview",
        "type": "stock_overview",
        "title": "Ringkasan Total Stok Casing iPhone Flazzstore",
        "text": master_stock_text,
        "metadata": {
            "type": "stock_overview",
            "total_inventory": total_inventory,
            "models_count": len(stock_dict)
        }
    })

    # 2. Individual stock chunks per iPhone model
    for model, info in stock_dict.items():
        doc_id = f"stock_{re.sub(r'[^a-zA-Z0-9]+', '_', model).lower()}"
        text = (
            f"Informasi Stok Casing Flazzstore untuk tipe HP: {info['model']}.\n"
            f"- Total Stok Tersedia: {info['total_stock']} unit.\n"
            f"- Status Ketersediaan: {info['status']}.\n"
            f"- Stok Awal Minggu: {info['senin_stock']} unit, Perubahan: {info['change']} unit.\n"
            f"Keterangan: Tipe {info['model']} dapat dipesan dengan semua motif desain custom yang tersedia di katalog Flazzstore."
        )
        docs.append({
            "id": doc_id,
            "type": "stock_item",
            "title": f"Stok Casing {info['model']}",
            "text": text,
            "metadata": {
                "type": "stock_item",
                "model": info["model"],
                "total_stock": info["total_stock"],
                "status": info["status"]
            }
        })

    # 3. Product catalog chunks
    for idx, prod in enumerate(products):
        doc_id = f"prod_{prod['id']}"
        vars_str = ", ".join(prod["variations"]) if prod["variations"] else "Hubungi admin untuk tipe lain"
        
        # Cross reference with iPhone stock if product supports iPhone
        stock_note = ""
        matched_iphone_stocks = []
        for var in prod["variations"]:
            for m_key, s_val in stock_dict.items():
                if var.lower() in m_key.lower() or m_key.lower() in var.lower():
                    matched_iphone_stocks.append(f"{m_key}: {s_val['total_stock']} unit")
                    break
        if matched_iphone_stocks:
            stock_note = f"\nKetersediaan Stok Casing iPhone Terkait: {', '.join(matched_iphone_stocks[:6])}."

        text = (
            f"Produk Casing: {prod['name']}\n"
            f"- Kode Produk: {prod['id']}\n"
            f"- SKU Induk: {prod['sku']}\n"
            f"- Brand / Merek: {prod['brand']}\n"
            f"- Kategori: {prod['category']}\n"
            f"- Tipe HP yang Tersedia (Variasi): {vars_str}.\n"
            f"- Foto Produk: {prod['cover_image']}"
            f"{stock_note}"
        )
        docs.append({
            "id": doc_id,
            "type": "product",
            "title": prod["name"],
            "text": text,
            "metadata": {
                "type": "product",
                "product_id": prod["id"],
                "sku": prod["sku"],
                "brand": prod["brand"],
                "cover_image": prod["cover_image"],
                "variations_count": len(prod["variations"])
            }
        })

    print(f"  -> Generated {len(docs)} total RAG documents ({len(stock_dict) + 1} stock docs + {len(products)} product docs).")
    return docs


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    stock_dict = parse_stock_pdf(PDF_PATH)
    products = parse_catalog_excel(EXCEL_PATH)
    rag_docs = generate_rag_documents(stock_dict, products)

    # 1. Save data/stock_iphone.json
    stock_file = os.path.join(DATA_DIR, "stock_iphone.json")
    with open(stock_file, "w", encoding="utf-8") as f:
        json.dump(stock_dict, f, indent=2, ensure_ascii=False)
    print(f"Saved: {stock_file}")

    # 2. Save data/knowledge_base.json
    kb_file = os.path.join(DATA_DIR, "knowledge_base.json")
    kb_data = {
        "metadata": {
            "source_pdf": "STOCK CASING - iPhone.pdf",
            "source_excel": "model.xlsx",
            "total_stock_items": len(stock_dict),
            "total_products": len(products),
            "total_rag_documents": len(rag_docs)
        },
        "stock": stock_dict,
        "products": products
    }
    with open(kb_file, "w", encoding="utf-8") as f:
        json.dump(kb_data, f, ensure_ascii=False, indent=2)
    print(f"Saved: {kb_file}")

    # 3. Save compact knowledge base for worker embedding / local bundle
    compact_kb_file = os.path.join(DATA_DIR, "knowledge_base_compact.json")
    compact_products = [
        {
            "id": p["id"],
            "sku": p["sku"],
            "name": p["name"],
            "brand": p["brand"],
            "cover": p["cover_image"],
            "vars": p["variations"]
        }
        for p in products
    ]
    with open(compact_kb_file, "w", encoding="utf-8") as f:
        json.dump({"stock": stock_dict, "products": compact_products}, f, ensure_ascii=False, separators=(',', ':'))
    print(f"Saved: {compact_kb_file} ({os.path.getsize(compact_kb_file) / 1024:.1f} KB)")

    # 4. Save data/rag_documents.json
    docs_file = os.path.join(DATA_DIR, "rag_documents.json")
    with open(docs_file, "w", encoding="utf-8") as f:
        json.dump(rag_docs, f, ensure_ascii=False, indent=2)
    print(f"Saved: {docs_file} ({os.path.getsize(docs_file) / 1024:.1f} KB)")

    print("\nIngestion completed successfully!")

if __name__ == "__main__":
    main()
