import { env, exports } from "cloudflare:workers";
import { vi } from "vitest";
import type { TelegramClient } from "../src/lib/telegram";
import { TelegramError } from "../src/lib/telegram";

/** Telegram simulado para los tests (F3-11). */

/** El del binding de prueba (vitest.config.ts). */
export const WEBHOOK_SECRET = env.TELEGRAM_WEBHOOK_SECRET ?? "";

export interface TelegramCall {
  method: string;
  body: Record<string, unknown>;
}

/** Intercepta `fetch` a api.telegram.org (el resto de peticiones pasan tal cual). */
export function interceptTelegram() {
  const calls: TelegramCall[] = [];
  const original = globalThis.fetch.bind(globalThis);
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://api.telegram.org/")) return original(input, init);
    const method = url.split("/").pop() ?? "";
    const raw = typeof init?.body === "string" ? init.body : "{}";
    const body = JSON.parse(raw) as Record<string, unknown>;
    calls.push({ method, body });
    return Response.json({
      ok: true,
      result: method === "sendMessage" ? { message_id: calls.length } : true,
    });
  });
  return {
    calls,
    sent: () => calls.filter((c) => c.method === "sendMessage"),
    lastText: () => {
      const text = calls.filter((c) => c.method === "sendMessage").at(-1)?.body.text;
      return typeof text === "string" ? text : "";
    },
    restore: () => spy.mockRestore(),
  };
}

let updateId = 1_000;

/** Envía un update al webhook como lo haría Telegram (con `update_id` nuevo si no se indica). */
export async function postUpdate(
  update: Record<string, unknown>,
  secret: string | null = WEBHOOK_SECRET,
) {
  return exports.default.fetch(
    new Request("https://delyra.test/api/telegram/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "149.154.167.220",
        ...(secret === null ? {} : { "X-Telegram-Bot-Api-Secret-Token": secret }),
      },
      body: JSON.stringify({ update_id: ++updateId, ...update }),
    }),
  );
}

export function textUpdate(chatId: number, text: string, type = "private") {
  return { message: { message_id: 1, chat: { id: chatId, type }, text } };
}

let chatCounter = 70_000_000;
export const newChatId = () => ++chatCounter;

/** Cliente de Telegram falso para probar la entrega sin `fetch`. */
export function fakeClient(behaviour: (method: string) => unknown = () => ({ message_id: 1 })) {
  const calls: TelegramCall[] = [];
  const record = (method: string, body: Record<string, unknown>) => {
    calls.push({ method, body });
    const result = behaviour(method);
    if (result instanceof TelegramError) return Promise.reject(result);
    return Promise.resolve(result);
  };
  const client = {
    sendMessage: (chatId: string, text: string, options?: unknown) =>
      record("sendMessage", { chatId, text, options }),
    editMessageText: (chatId: string, messageId: number, text: string) =>
      record("editMessageText", { chatId, messageId, text }),
    answerCallbackQuery: (id: string, text?: string) => record("answerCallbackQuery", { id, text }),
    setWebhook: () => record("setWebhook", {}),
    setMyCommands: () => record("setMyCommands", {}),
  } as unknown as TelegramClient;
  return { client, calls };
}

export { env };
