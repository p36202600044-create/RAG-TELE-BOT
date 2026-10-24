/**
 * Telegram Bot API client for Cloudflare Workers
 */

export class TelegramBot {
  private token: string;
  private baseUrl: string;

  constructor(token: string) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  /**
   * Send text message to Telegram chat
   */
  async sendMessage(
    chatId: number | string,
    text: string,
    options: {
      parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
      reply_to_message_id?: number;
      disable_web_page_preview?: boolean;
    } = {}
  ): Promise<any> {
    const url = `${this.baseUrl}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: options.parse_mode ?? "HTML",
      reply_to_message_id: options.reply_to_message_id,
      disable_web_page_preview: options.disable_web_page_preview ?? false,
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data: any = await res.json();
      if (!data.ok) {
        // Fallback without parse_mode if formatting had errors
        if (options.parse_mode) {
          return this.sendMessage(chatId, text, {
            ...options,
            parse_mode: undefined,
          });
        }
        console.error("Telegram sendMessage error:", data);
      }
      return data;
    } catch (err) {
      console.error("Telegram network error:", err);
      return null;
    }
  }

  /**
   * Send photo to Telegram chat with caption
   */
  async sendPhoto(
    chatId: number | string,
    photoUrl: string,
    caption?: string,
    options: {
      parse_mode?: "HTML" | "Markdown";
      reply_to_message_id?: number;
    } = {}
  ): Promise<any> {
    const url = `${this.baseUrl}/sendPhoto`;
    const payload = {
      chat_id: chatId,
      photo: photoUrl,
      caption: caption ? caption.slice(0, 1024) : undefined,
      parse_mode: options.parse_mode ?? "HTML",
      reply_to_message_id: options.reply_to_message_id,
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: any = await res.json();
      if (!data.ok) {
        console.warn("sendPhoto failed, falling back to sendMessage with image link:", data);
        const fallbackText = caption
          ? `${caption}\n\n<a href="${photoUrl}">Lihat foto produk</a>`
          : `<a href="${photoUrl}">Lihat foto produk</a>`;
        return this.sendMessage(chatId, fallbackText, { parse_mode: "HTML" });
      }
      return data;
    } catch (err) {
      console.error("Telegram sendPhoto error:", err);
      return null;
    }
  }

  /**
   * Send typing indicator
   */
  async sendChatAction(chatId: number | string, action: string = "typing"): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, action }),
      });
    } catch (err) {
      // Ignore chat action failures
    }
  }

  /**
   * Set webhook for Cloudflare Worker
   */
  async setWebhook(webhookUrl: string, secretToken?: string): Promise<any> {
    const payload: any = {
      url: webhookUrl,
      allowed_updates: ["message", "edited_message"],
    };
    if (secretToken) {
      payload.secret_token = secretToken;
    }

    const res = await fetch(`${this.baseUrl}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  /**
   * Get current webhook info
   */
  async getWebhookInfo(): Promise<any> {
    const res = await fetch(`${this.baseUrl}/getWebhookInfo`);
    return res.json();
  }
}
