/**
 * Cliente mínimo y tipado de la Bot API de Telegram (F3-02).
 *
 * Errores:
 * - 429: `TelegramError` con `retryAfter` (segundos que pide Telegram).
 * - 5xx o red: reintentable.
 * - 400/401/403/404: permanentes (chat inexistente, bot bloqueado, token no válido…).
 * El token nunca aparece en los mensajes de error ni en los logs.
 */

const API = "https://api.telegram.org";
const TIMEOUT_MS = 10_000;

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface SendOptions {
  replyMarkup?: { inline_keyboard: InlineButton[][] };
  /** Sin vista previa de enlaces (los mensajes llevan URL de Delyra). */
  disablePreview?: boolean;
}

export interface SentMessage {
  message_id: number;
}

export class TelegramError extends Error {
  readonly status: number;
  readonly retryAfter: number | null;
  readonly permanent: boolean;
  readonly description: string;

  constructor(status: number, description: string, retryAfter: number | null = null) {
    super(`Telegram ${String(status)}: ${description}`);
    this.name = "TelegramError";
    this.status = status;
    this.description = description;
    this.retryAfter = retryAfter;
    this.permanent = status !== 429 && status < 500 && status !== 0;
  }

  /** El usuario bloqueó el bot o el chat ya no existe: hay que dejar de escribirle. */
  get chatGone(): boolean {
    return (
      this.status === 403 ||
      (this.status === 400 && /chat not found|user is deactivated/i.test(this.description))
    );
  }
}

interface ApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

export function telegramClient(token: string, fetchImpl: typeof fetch = fetch) {
  async function call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${API}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new TelegramError(0, "Sin conexión con Telegram");
    }
    let data: ApiResponse<T>;
    try {
      data = await response.json();
    } catch {
      throw new TelegramError(response.status || 502, "Respuesta no válida de Telegram");
    }
    if (data.ok && data.result !== undefined) return data.result;
    throw new TelegramError(
      data.error_code ?? response.status,
      data.description ?? "Error desconocido",
      data.parameters?.retry_after ?? null,
    );
  }

  const markup = (options: SendOptions) => ({
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    link_preview_options: { is_disabled: options.disablePreview ?? true },
  });

  return {
    sendMessage(chatId: string, html: string, options: SendOptions = {}) {
      return call<SentMessage>("sendMessage", {
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        ...markup(options),
      });
    },

    /** Editar sin cambios no es un error para nosotros («message is not modified»). */
    async editMessageText(
      chatId: string,
      messageId: number,
      html: string,
      options: SendOptions = {},
    ) {
      try {
        await call<unknown>("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: html,
          parse_mode: "HTML",
          ...markup(options),
        });
      } catch (error) {
        if (error instanceof TelegramError && /not modified/i.test(error.description)) return;
        throw error;
      }
    },

    answerCallbackQuery(callbackQueryId: string, text?: string) {
      return call<boolean>("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        ...(text ? { text } : {}),
      });
    },

    setWebhook(url: string, secretToken: string) {
      return call<boolean>("setWebhook", {
        url,
        secret_token: secretToken,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      });
    },

    /** Sin `languageCode`, son los comandos por defecto (para cualquier idioma). */
    setMyCommands(commands: { command: string; description: string }[], languageCode?: string) {
      return call<boolean>("setMyCommands", {
        commands,
        ...(languageCode ? { language_code: languageCode } : {}),
      });
    },
  };
}

export type TelegramClient = ReturnType<typeof telegramClient>;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&quot;",
  );
}
