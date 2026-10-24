export interface Env {
  // Cloudflare Workers AI binding
  AI?: any;

  // Cloudflare Vectorize Index binding
  VECTOR_INDEX?: any;

  // Environment variables / Secrets
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_SECRET_TOKEN?: string;
  DEFAULT_MODEL?: string;
  EMBEDDING_MODEL?: string;
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

export interface RagResponse {
  answer: string;
  topProductPhoto?: string;
  sources: Array<{
    id: string;
    title: string;
    type: string;
    score?: number;
  }>;
}
