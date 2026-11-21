import { newId } from "@delyra/shared";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { SecurityEvent } from "./notification-text";
import type { NotificationMessage } from "./notifications";
import { telegramConfig } from "./telegram-links";

/** «Chrome en Windows» a partir del User-Agent (aproximado, solo para el aviso). */
export function describeDevice(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browsers: [string, string][] = [
    ["Edg/", "Edge"],
    ["OPR/", "Opera"],
    ["Firefox/", "Firefox"],
    ["Chrome/", "Chrome"],
    ["Safari/", "Safari"],
  ];
  const systems: [string, string][] = [
    ["iPhone", "iOS"],
    ["iPad", "iOS"],
    ["Android", "Android"],
    ["Windows", "Windows"],
    ["Mac OS X", "macOS"],
    ["Linux", "Linux"],
  ];
  const browser = browsers.find(([token]) => userAgent.includes(token))?.[1] ?? "Navegador";
  const os = systems.find(([token]) => userAgent.includes(token))?.[1];
  return os ? `${browser} en ${os}` : browser;
}

/**
 * Aviso de seguridad por Telegram (F3-10): se encola sin esperar y, si el usuario no tiene
 * Telegram vinculado, el consumidor lo descarta. Nunca hace fallar la petición.
 */
export function notifySecurity(c: Context<AppEnv>, userId: string, event: SecurityEvent): void {
  if (!telegramConfig(c.env)) return;
  const meta = c.get("meta");
  const message: NotificationMessage = {
    type: "security",
    idempotencyKey: `sec:${newId()}`,
    ownerId: userId,
    event,
    country: meta.country,
    device: describeDevice(meta.userAgent),
  };
  try {
    c.executionCtx.waitUntil(
      c.env.NOTIFICATIONS.send(message).catch((error: unknown) => {
        c.get("logger").warn("security_notify_failed", { error });
      }),
    );
  } catch (error) {
    c.get("logger").warn("security_notify_failed", { error });
  }
}
