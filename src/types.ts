export interface Env {
  // Cloudflare Workers AI binding
  AI?: any;

  // Cloudflare Vectorize Index binding
  VECTOR_INDEX?: any;

  // Cloudflare D1 binding for editable stock data
  DB?: D1Database;

  // Environment variables / Secrets
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_SECRET_TOKEN?: string;
  DEFAULT_MODEL?: string;
  EMBEDDING_MODEL?: string;

  // Dashboard (HTTP Basic Auth) credentials
  ADMIN_USER?: string;
  ADMIN_PASSWORD?: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  reply_to_message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface StockItem {
  model: string;
  senin_stock: number;
  change: number;
  total_stock: number;
  status: string;
  updated_at?: string;
}

export interface StockMap {
  [model: string]: StockItem;
}

export interface StockMutation {
  id: number;
  model: string;
  delta: number;
  previous_stock: number;
  new_stock: number;
  note: string;
  actor: string;
  created_at: string;
}

export interface StockSummary {
  totalModels: number;
  totalUnits: number;
  readyModels: number;
  lowModels: number;
  outModels: number;
  lastUpdated: string | null;
}

export interface ProductItem {
  id: string;
  sku: string;
  name: string;
  brand: string;
  cover: string;
  vars: string[];
}

export interface RagDocument {
  id: string;
  type: "stock_overview" | "stock_item" | "product";
  title: string;
  text: string;
  metadata?: Record<string, any>;
}

export interface RagTrace {
  stockSource: "d1" | "snapshot";
  stockModels: number;
  stockUnits: number;
  vectorUsed: boolean;
  vectorMatches: number;
  productMatches: number;
  contextDocs: number;
  generatedBy: "workers-ai" | "fallback";
}

export interface RagResponse {
  answer: string;
  topProductPhoto?: string;
  sources: Array<{
    id: string;
    title: string;
    type: string;
    score?: number;
  }>;
  trace?: RagTrace;
}
