import knowledgeBase from "../data/knowledge_base_compact.json";
import {
  Env,
  StockItem,
  StockMap,
  StockMutation,
  StockSummary,
} from "./types";

interface CompactKB {
  stock: StockMap;
  products: unknown[];
}

const kb = knowledgeBase as unknown as CompactKB;

/**
 * Original stock snapshot from the PDF/JSON import. Used as the seed for the
 * D1 stock table and as a graceful fallback when D1 is not configured.
 */
export const seedStock: StockMap = kb.stock;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS stock_items (
    model TEXT PRIMARY KEY,
    senin_stock INTEGER NOT NULL DEFAULT 0,
    total_stock INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Stok Banyak / Ready',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS stock_mutations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model TEXT NOT NULL,
    delta INTEGER NOT NULL,
    previous_stock INTEGER NOT NULL,
    new_stock INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    actor TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stock_mutations_model ON stock_mutations (model)`,
  `CREATE INDEX IF NOT EXISTS idx_stock_mutations_created ON stock_mutations (created_at)`,
];

let schemaReady = false;

/**
 * Derive the display status from the number of available units.
 * Thresholds mirror the labels used in the original warehouse PDF.
 */
export function statusForStock(total: number): string {
  if (total <= 0) return "Habis";
  if (total <= 5) return "Stok Sangat Terbatas (Hampir Habis)";
  if (total <= 15) return "Stok Terbatas";
  if (total <= 30) return "Stok Sedang";
  return "Stok Banyak / Ready";
}

export function isLowStock(total: number): boolean {
  return total <= 15;
}

function cloneSeedStock(): StockMap {
  const map: StockMap = {};
  for (const [model, item] of Object.entries(seedStock)) {
    map[model] = { ...item, change: item.total_stock - item.senin_stock };
  }
  return map;
}

/**
 * Create the D1 tables and seed the initial 35 iPhone models if the table is
 * empty. Safe to call on every request: DDL is idempotent and seeding uses
 * INSERT OR IGNORE.
 */
export async function ensureStockDb(env: Env): Promise<boolean> {
  if (!env.DB) return false;
  if (schemaReady) return true;

  try {
    for (const sql of SCHEMA_STATEMENTS) {
      await env.DB.prepare(sql).run();
    }

    const countRow = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM stock_items")
      .first<{ count: number }>();

    if (!countRow || Number(countRow.count) === 0) {
      const now = new Date().toISOString();
      const statements = Object.values(seedStock).map((item) =>
        env.DB!.prepare(
          `INSERT OR IGNORE INTO stock_items
             (model, senin_stock, total_stock, status, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(
          item.model,
          item.senin_stock,
          item.total_stock,
          item.status || statusForStock(item.total_stock),
          now
        )
      );
      if (statements.length > 0) {
        await env.DB.batch(statements);
      }
    }

    schemaReady = true;
    return true;
  } catch (err) {
    console.error("Failed to initialise stock database:", err);
    return false;
  }
}

function rowToStockItem(row: any): StockItem {
  const total = Number(row.total_stock) || 0;
  const initial = Number(row.senin_stock) || 0;
  return {
    model: String(row.model),
    senin_stock: initial,
    change: total - initial,
    total_stock: total,
    status: String(row.status || statusForStock(total)),
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

/**
 * Read the current stock map. Falls back to the bundled snapshot if D1 is not
 * bound (for example on a fresh clone before `wrangler d1 create`).
 */
export async function getStockMap(env: Env): Promise<StockMap> {
  if (!(await ensureStockDb(env))) return cloneSeedStock();

  try {
    const result = await env.DB!.prepare(
      `SELECT model, senin_stock, total_stock, status, updated_at
         FROM stock_items
        ORDER BY total_stock ASC, model ASC`
    ).all<any>();

    const rows = result.results || [];
    if (rows.length === 0) return cloneSeedStock();

    const map: StockMap = {};
    for (const row of rows) {
      const item = rowToStockItem(row);
      map[item.model] = item;
    }
    return map;
  } catch (err) {
    console.error("Failed to read stock from D1, using bundled snapshot:", err);
    return cloneSeedStock();
  }
}

export async function listStock(env: Env): Promise<StockItem[]> {
  const map = await getStockMap(env);
  return Object.values(map).sort((a, b) => {
    if (a.total_stock !== b.total_stock) return a.total_stock - b.total_stock;
    return a.model.localeCompare(b.model);
  });
}

export function summariseStock(items: StockItem[]): StockSummary {
  let totalUnits = 0;
  let lowModels = 0;
  let outModels = 0;
  let readyModels = 0;
  let lastUpdated: string | null = null;

  for (const item of items) {
    totalUnits += item.total_stock;
    if (item.total_stock <= 0) outModels++;
    else if (isLowStock(item.total_stock)) lowModels++;
    else readyModels++;

    if (item.updated_at && (!lastUpdated || item.updated_at > lastUpdated)) {
      lastUpdated = item.updated_at;
    }
  }

  return {
    totalModels: items.length,
    totalUnits,
    readyModels,
    lowModels,
    outModels,
    lastUpdated,
  };
}

export async function getStockSummary(env: Env): Promise<StockSummary> {
  return summariseStock(await listStock(env));
}

export interface AdjustStockInput {
  delta?: number;
  setStock?: number;
  note?: string;
  actor?: string;
}

/**
 * Apply a stock movement. Supports both relative (`delta`) and absolute
 * (`setStock`) updates. Every change is written to stock_mutations so the
 * dashboard can show an audit trail.
 */
export async function adjustStock(
  env: Env,
  model: string,
  input: AdjustStockInput
): Promise<{ item: StockItem; mutation: StockMutation | null } | null> {
  if (!(await ensureStockDb(env))) {
    throw new Error("Database stok (D1) belum dikonfigurasi.");
  }

  const currentRow = await env.DB!.prepare(
    `SELECT model, senin_stock, total_stock, status, updated_at
       FROM stock_items
      WHERE model = ?`
  ).bind(model).first<any>();

  if (!currentRow) return null;

  const current = rowToStockItem(currentRow);
  let nextStock: number;

  if (typeof input.setStock === "number" && Number.isFinite(input.setStock)) {
    nextStock = Math.max(0, Math.round(input.setStock));
  } else {
    const delta = Number(input.delta);
    if (!Number.isFinite(delta) || delta === 0) {
      throw new Error("Isi jumlah perubahan stok atau stok akhir.");
    }
    nextStock = Math.max(0, current.total_stock + Math.round(delta));
  }

  if (nextStock === current.total_stock) {
    return { item: current, mutation: null };
  }

  const actualDelta = nextStock - current.total_stock;
  const status = statusForStock(nextStock);
  const now = new Date().toISOString();
  const note = (input.note || "").trim().slice(0, 240);
  const actor = (input.actor || "admin").trim().slice(0, 80) || "admin";

  await env.DB!.batch([
    env.DB!.prepare(
      `UPDATE stock_items
          SET total_stock = ?, status = ?, updated_at = ?
        WHERE model = ?`
    ).bind(nextStock, status, now, model),
    env.DB!.prepare(
      `INSERT INTO stock_mutations
         (model, delta, previous_stock, new_stock, note, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(model, actualDelta, current.total_stock, nextStock, note, actor, now),
  ]);

  const updated: StockItem = {
    model,
    senin_stock: current.senin_stock,
    change: nextStock - current.senin_stock,
    total_stock: nextStock,
    status,
    updated_at: now,
  };

  return {
    item: updated,
    mutation: {
      id: 0,
      model,
      delta: actualDelta,
      previous_stock: current.total_stock,
      new_stock: nextStock,
      note,
      actor,
      created_at: now,
    },
  };
}

export async function addStockModel(
  env: Env,
  model: string,
  totalStock: number,
  actor: string
): Promise<{ item: StockItem } | { error: string }> {
  if (!(await ensureStockDb(env))) {
    throw new Error("Database stok (D1) belum dikonfigurasi.");
  }

  const cleanModel = model.trim().replace(/\s+/g, " ").slice(0, 80);
  if (cleanModel.length < 2) return { error: "Nama tipe minimal 2 karakter." };

  const exists = await env.DB!.prepare(
    "SELECT model FROM stock_items WHERE lower(model) = lower(?)"
  ).bind(cleanModel).first<any>();
  if (exists) return { error: "Tipe iPhone tersebut sudah ada." };

  const total = Math.max(0, Math.round(totalStock));
  const now = new Date().toISOString();
  const status = statusForStock(total);

  await env.DB!.prepare(
    `INSERT INTO stock_items
       (model, senin_stock, total_stock, status, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(cleanModel, total, total, status, now).run();

  await env.DB!.prepare(
    `INSERT INTO stock_mutations
       (model, delta, previous_stock, new_stock, note, actor, created_at)
     VALUES (?, ?, 0, ?, ?, ?, ?)`
  ).bind(cleanModel, total, total, "Tipe baru ditambahkan", actor.slice(0, 80), now).run();

  return {
    item: {
      model: cleanModel,
      senin_stock: total,
      change: 0,
      total_stock: total,
      status,
      updated_at: now,
    },
  };
}

export async function getStockHistory(
  env: Env,
  model?: string,
  limit: number = 30
): Promise<StockMutation[]> {
  if (!(await ensureStockDb(env))) return [];

  const safeLimit = Math.min(200, Math.max(1, Math.round(limit)));
  try {
    const stmt = model
      ? env.DB!.prepare(
          `SELECT id, model, delta, previous_stock, new_stock, note, actor, created_at
             FROM stock_mutations
            WHERE model = ?
            ORDER BY id DESC
            LIMIT ?`
        ).bind(model, safeLimit)
      : env.DB!.prepare(
          `SELECT id, model, delta, previous_stock, new_stock, note, actor, created_at
             FROM stock_mutations
            ORDER BY id DESC
            LIMIT ?`
        ).bind(safeLimit);

    const result = await stmt.all<any>();
    return (result.results || []).map((row) => ({
      id: Number(row.id),
      model: String(row.model),
      delta: Number(row.delta),
      previous_stock: Number(row.previous_stock),
      new_stock: Number(row.new_stock),
      note: String(row.note || ""),
      actor: String(row.actor || "admin"),
      created_at: String(row.created_at),
    }));
  } catch (err) {
    console.error("Failed to read stock history:", err);
    return [];
  }
}
