-- Stok casing iPhone Flazzstore (Cloudflare D1)
-- The Worker also runs these statements lazily on first access, so applying
-- this file manually is optional. It is useful for local resets and audits.
--
-- Apply locally:
--   npx wrangler d1 execute rag-tele-stock --local --file=migrations/0001_stock.sql
-- Apply to production:
--   npx wrangler d1 execute rag-tele-stock --remote --file=migrations/0001_stock.sql

CREATE TABLE IF NOT EXISTS stock_items (
  model TEXT PRIMARY KEY,
  senin_stock INTEGER NOT NULL DEFAULT 0,
  total_stock INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Stok Banyak / Ready',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_mutations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  delta INTEGER NOT NULL,
  previous_stock INTEGER NOT NULL,
  new_stock INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stock_mutations_model ON stock_mutations (model);
CREATE INDEX IF NOT EXISTS idx_stock_mutations_created ON stock_mutations (created_at);
