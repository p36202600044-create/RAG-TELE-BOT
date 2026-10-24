import knowledgeBase from "../data/knowledge_base_compact.json";
import { PROMPT_ENTRIES, runPrompt } from "../src/prompts";
import { StockMap } from "../src/types";

const stock = (knowledgeBase as unknown as { stock: StockMap }).stock;
let failures = 0;

function check(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${message}`);
  }
}

console.log(`Menguji ${PROMPT_ENTRIES.length} prompt Tahap 1...\n`);

for (const entry of PROMPT_ENTRIES) {
  console.log(`${entry.number}. ${entry.title} (${entry.technique})`);
  const result = runPrompt(entry.id, "", stock);

  check(Boolean(result), "prompt menghasilkan output");
  if (!result) continue;

  if (entry.id === "restock") {
    check(result.data.total_models === 35, "35 model stok terbaca");
    check(result.data.low_stock_count === 5, "5 model di bawah threshold 15");
    check(
      result.data.priorities[0]?.model === "iPhone XS Max",
      "prioritas pertama iPhone XS Max"
    );
  }

  if (entry.id === "normalisasi") {
    check(result.data.total === 8, "8 variasi demo dinormalisasi");
    check(result.data.valid === 2, "2 variasi valid");
    check(result.data.invalid === 5, "5 variasi invalid");
    check(result.data.other === 1, "1 variasi other");
  }

  if (entry.id === "audit") {
    check(result.data.verdict === "perlu_perbaikan", "verdict perlu_perbaikan");
    check(
      result.data.variasi_tidak_valid.length === 3,
      "3 variasi tidak valid terdeteksi"
    );
    check(
      result.data.klaim_tanpa_variasi.includes("SE"),
      "klaim SE tanpa variasi terdeteksi"
    );
  }

  if (entry.id === "extract") {
    check(result.data.sku === "IP-JOYFUL-0001", "SKU demo terekstrak");
    check(result.data.jumlah_variasi === 35, "35 variasi terekstrak");
    check(result.data.anomali.length >= 2, "anomali terekstrak");
  }

  if (entry.id === "konsistensi") {
    check(result.data.checked === 35, "35 baris stok diperiksa");
    check(result.data.consistent === true, "semua baris konsisten");
    check(result.data.discrepancies.length === 0, "tidak ada selisih");
  }
}

console.log("\nUji kasus tambahan...");
const custom = runPrompt("konsistensi", "total=48 stok=45 tambahan=2", stock);
check(Boolean(custom), "input manual konsistensi berjalan");
check(custom?.data.consistent === false, "selisih 1 terdeteksi");
check(custom?.data.discrepancies[0]?.selisih === 1, "nilai selisih benar");

const normalisasi = runPrompt("normalisasi", "Iphone16 Pro, XR, Iphone 14 Mini", stock);
check(normalisasi?.data.valid === 2, "dua variasi valid");
check(normalisasi?.data.invalid === 1, "satu variasi invalid");

console.log("");
if (failures > 0) {
  console.error(`GAGAL: ${failures} assertion tidak terpenuhi.`);
  process.exit(1);
}
console.log("SEMUA PROMPT LULUS.");
