import stock from "../data/stock_iphone.json";
import { StockItem } from "../src/types";
import {
  welcomeMessage,
  helpMessage,
  promptsMenuMessage,
  stockSummaryMessage,
} from "../src/telegram-text";

const EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/gu;
const ALLOWED_TAGS = /<\/?(b|i|u|s|code|pre|a)(\s[^>]*)?>/g;
const TELEGRAM_LIMIT = 4096;

let failures = 0;

function check(name: string, text: string) {
  const problems: string[] = [];

  const emoji = text.match(EMOJI) || [];
  if (emoji.length > 0) problems.push(`emoji: ${emoji.join(" ")}`);

  if (text.length > TELEGRAM_LIMIT) {
    problems.push(`terlalu panjang: ${text.length} karakter`);
  }

  const opening = (text.match(/<b>/g) || []).length;
  const closing = (text.match(/<\/b>/g) || []).length;
  if (opening !== closing) problems.push(`tag <b> tidak seimbang (${opening}/${closing})`);

  const openI = (text.match(/<i>/g) || []).length;
  const closeI = (text.match(/<\/i>/g) || []).length;
  if (openI !== closeI) problems.push(`tag <i> tidak seimbang (${openI}/${closeI})`);

  const openCode = (text.match(/<code>/g) || []).length;
  const closeCode = (text.match(/<\/code>/g) || []).length;
  if (openCode !== closeCode) {
    problems.push(`tag <code> tidak seimbang (${openCode}/${closeCode})`);
  }

  const stripped = text.replace(ALLOWED_TAGS, "");
  if (/[<>]/.test(stripped)) problems.push("ada karakter < atau > di luar tag yang diizinkan");

  if (problems.length > 0) {
    failures += 1;
    console.error(`GAGAL  ${name}`);
    for (const problem of problems) console.error(`  - ${problem}`);
  } else {
    console.log(`LULUS  ${name} (${text.length} karakter, 0 emoji)`);
  }
}

const items = Object.values(stock) as unknown as StockItem[];

const messages: Array<[string, string]> = [
  ["/start", welcomeMessage()],
  ["/help", helpMessage("https://rag-tele-shofiyan.workers.dev")],
  ["/prompts", promptsMenuMessage("https://rag-tele-shofiyan.workers.dev")],
  ["/stok", stockSummaryMessage(items)],
];

for (const [name, text] of messages) check(name, text);

if (failures > 0) {
  console.error(`\n${failures} pesan Telegram gagal diperiksa.`);
  process.exit(1);
}

console.log(`\nSEMUA PESAN TELEGRAM LULUS (${messages.length} pesan).`);
