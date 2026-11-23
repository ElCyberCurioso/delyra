import { isGoogleIcalUrl, newId, type SubscriptionInfo } from "@delyra/shared";
import type { Database } from "../db/client";
import type { SubscriptionRow } from "../db/schema";
import { AppError } from "../lib/errors";
import { decryptField, encryptField, type Keyring } from "../lib/field-crypto";
import { looksLikeIcs, parseIcs } from "../lib/ics";
import {
  IMPORT_LIMITS,
  type ImportedEvent,
  ImportFormatError,
  ImportLimitError,
  stripBom,
} from "../lib/import-model";
import type { Logger } from "../lib/logger";
import { calendarRepository } from "../repositories/calendars";
import { eventRepository } from "../repositories/events";
import {
  claimSubscription,
  dueSubscriptions,
  subscriptionRepository,
} from "../repositories/subscriptions";
import { applyImportedEvents, type ApplyCounts } from "./import-apply";
import { userTimeZone } from "./imports";

/**
 * Suscripción a la dirección iCal secreta de Google (F5-06).
 *
 * - SSRF: solo `https://calendar.google.com/calendar/ical/….ics` (`isGoogleIcalUrl`), sin seguir
 *   redirecciones, con tiempo y tamaño máximos. La URL se vuelve a validar antes de cada
 *   descarga por si la fila se hubiera alterado.
 * - La dirección es un secreto: se guarda cifrada y nunca se devuelve ni se escribe en logs.
 * - Cada hora, con `If-None-Match`/`If-Modified-Since`: si Google responde 304 no se toca nada.
 * - El calendario es de solo lectura y refleja el origen: lo que desaparece de él se borra.
 */

const HOUR_MS = 3_600_000;
export const SUBSCRIPTION_INTERVAL_MS = HOUR_MS;
/** «Sincronizar ahora» como mucho cada 5 minutos. */
export const MANUAL_SYNC_MIN_MS = 5 * 60_000;
export const MAX_SUBSCRIPTIONS = 10;
const MAX_BACKOFF_MS = 24 * HOUR_MS;
const FETCH_TIMEOUT_MS = 20_000;
/** Mientras una sincronización está en curso, nadie más la reclama. */
const CLAIM_MS = 10 * 60_000;

const aad = (ownerId: string, id: string) => `subscription:${ownerId}:${id}`;

/** `calendar.google.com/calendar/ical/abcd…/basic.ics`: reconocible pero sin el secreto. */
export function urlHint(raw: string): string {
  const url = new URL(raw);
  const parts = url.pathname.split("/").filter(Boolean);
  const calendar = decodeURIComponent(parts[2] ?? "");
  const file = parts.at(-1) ?? "";
  return `${url.hostname}/calendar/ical/${calendar.slice(0, 4)}…/${file}`;
}

export class FeedError extends Error {
  override name = "FeedError";
}

export type FeedResult =
  | { status: "not-modified" }
  | { status: "ok"; text: string; etag: string | null; lastModified: string | null };

/** Descarga el `.ics` respetando la caché del servidor (ETag / Last-Modified). */
export async function fetchFeed(
  url: string,
  cache: { etag: string | null; lastModified: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<FeedResult> {
  if (!isGoogleIcalUrl(url)) throw new FeedError("La dirección de la suscripción no es válida");
  const headers = new Headers({ Accept: "text/calendar, text/plain;q=0.5" });
  if (cache.etag) headers.set("If-None-Match", cache.etag);
  if (cache.lastModified) headers.set("If-Modified-Since", cache.lastModified);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers,
      // Nada de seguir redirecciones: podrían llevar a otro host (SSRF).
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new FeedError("No se ha podido conectar con Google Calendar");
  }
  if (response.status === 304) return { status: "not-modified" };
  if (response.status >= 300 && response.status < 400) {
    throw new FeedError("La dirección redirige a otro sitio y no se sigue");
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new FeedError(
      "Google no reconoce la dirección: puede que la hayas restablecido. Pega la nueva.",
    );
  }
  if (!response.ok || !response.body) {
    throw new FeedError(`Google Calendar respondió ${String(response.status)}`);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > IMPORT_LIMITS.icsBytes) {
    await response.body.cancel();
    throw new ImportLimitError("El calendario es demasiado grande");
  }
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > IMPORT_LIMITS.icsBytes) {
      await reader.cancel();
      throw new ImportLimitError("El calendario es demasiado grande");
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  const text = stripBom(parts.join(""));
  if (!looksLikeIcs(text.slice(0, 512))) {
    throw new ImportFormatError("La dirección no devuelve un calendario (.ics)");
  }
  return {
    status: "ok",
    text,
    etag: response.headers.get("etag")?.slice(0, 200) ?? null,
    lastModified: response.headers.get("last-modified")?.slice(0, 100) ?? null,
  };
}

export function subscriptionMessage(error: unknown): string {
  if (
    error instanceof FeedError ||
    error instanceof ImportFormatError ||
    error instanceof ImportLimitError
  ) {
    return error.message;
  }
  return "No se ha podido sincronizar. Se volverá a intentar más tarde.";
}

export interface SyncResult extends ApplyCounts {
  deleted: number;
  notModified: boolean;
}

/**
 * Deja un calendario de solo lectura igual que el origen (suscripción iCal o calendario de
 * Google sincronizado): crea y actualiza lo que llega y borra lo que ya no está (series, eventos
 * sueltos y excepciones).
 */
export async function mirrorCalendar(
  db: Database,
  ownerId: string,
  calendarId: string,
  imported: readonly ImportedEvent[],
  now: number,
  options: { reminders: boolean } = { reminders: false },
): Promise<ApplyCounts & { deleted: number }> {
  const events = eventRepository(db, ownerId);
  const ctx = { events, calendars: calendarRepository(db, ownerId), now };
  const counts = await applyImportedEvents(ctx, imported, {
    target: () => Promise.resolve(calendarId),
    scope: { calendarId },
    reminders: options.reminders,
    mirror: true,
  });

  const present = new Set(imported.map((e) => e.uid));
  const standalone = new Set(
    imported
      .filter((e) => e.recurrenceId !== null)
      .map((e) => `${e.uid}#${String(e.recurrenceId)}`),
  );
  const stale = (await events.uidsOfCalendar(calendarId))
    .filter((e) => e.icalUid === null || (!present.has(e.icalUid) && !standalone.has(e.icalUid)))
    .map((e) => e.id);
  await events.hardDelete(stale);
  const overridesByUid = new Map<string, Set<number>>();
  for (const event of imported) {
    if (event.recurrenceId === null) continue;
    const set = overridesByUid.get(event.uid) ?? new Set<number>();
    set.add(event.recurrenceId);
    overridesByUid.set(event.uid, set);
  }
  let deleted = stale.length;
  const masters = await events.findByUids(
    imported.filter((e) => e.recurrenceId === null && e.rrule).map((e) => e.uid),
    { calendarId },
  );
  for (const master of masters) {
    const keep = overridesByUid.get(master.icalUid ?? "") ?? new Set<number>();
    for (const override of await events.overridesOf(master.id)) {
      if (!keep.has(override.originalStart ?? -1)) {
        await events.deleteOverride(override.id);
        deleted++;
      }
    }
  }
  return { ...counts, deleted };
}

/** Sincroniza una suscripción: refleja en su calendario lo que haya ahora en Google. */
export async function syncSubscription(
  db: Database,
  keyring: Keyring,
  row: SubscriptionRow,
  now: number,
  fetchImpl: typeof fetch = fetch,
): Promise<SyncResult> {
  const repo = subscriptionRepository(db, row.ownerId);
  const empty: SyncResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    deleted: 0,
    notModified: false,
  };
  try {
    const url = await decryptField(row.urlEnc, keyring, aad(row.ownerId, row.id));
    const feed = await fetchFeed(url, row, fetchImpl);
    if (feed.status === "not-modified") {
      await repo.update(row.id, {
        status: "ok",
        lastError: null,
        failures: 0,
        lastSyncedAt: now,
        nextSyncAt: now + SUBSCRIPTION_INTERVAL_MS,
      });
      return { ...empty, notModified: true };
    }
    const parsed = parseIcs(feed.text, { defaultTimeZone: await userTimeZone(db, row.ownerId) });
    const { deleted, ...counts } = await mirrorCalendar(
      db,
      row.ownerId,
      row.calendarId,
      parsed.events,
      now,
    );

    await repo.update(row.id, {
      status: "ok",
      lastError: null,
      failures: 0,
      etag: feed.etag,
      lastModified: feed.lastModified,
      lastSyncedAt: now,
      nextSyncAt: now + SUBSCRIPTION_INTERVAL_MS,
    });
    return { ...counts, deleted, notModified: false };
  } catch (error) {
    const failures = row.failures + 1;
    await repo.update(row.id, {
      status: "error",
      lastError: subscriptionMessage(error),
      failures,
      // Reintentos cada vez más espaciados (1 h, 2 h, 4 h… hasta un día).
      nextSyncAt: now + Math.min(SUBSCRIPTION_INTERVAL_MS * 2 ** (failures - 1), MAX_BACKOFF_MS),
    });
    throw error;
  }
}

/** Planificador (cada minuto): unas pocas suscripciones pendientes en cada pasada. */
export async function syncDueSubscriptions(
  db: Database,
  keyring: Keyring,
  now: number,
  logger: Logger,
  limit = 3,
): Promise<number> {
  let synced = 0;
  for (const row of await dueSubscriptions(db, now, limit)) {
    if (!(await claimSubscription(db, row, now + CLAIM_MS))) continue;
    try {
      const result = await syncSubscription(db, keyring, row, now);
      logger.info("subscription_synced", {
        subscriptionId: row.id,
        notModified: result.notModified,
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
      });
      synced++;
    } catch (error) {
      logger.warn("subscription_sync_failed", {
        subscriptionId: row.id,
        error: subscriptionMessage(error),
      });
    }
  }
  return synced;
}

// ── Alta y DTO ───────────────────────────────────────────────────────────────

export async function createSubscription(
  db: Database,
  keyring: Keyring,
  ownerId: string,
  input: { url: string; name?: string; color: string },
  now: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ subscription: SubscriptionRow; result: SyncResult }> {
  const repo = subscriptionRepository(db, ownerId);
  const calendars = calendarRepository(db, ownerId);
  if ((await repo.count()) >= MAX_SUBSCRIPTIONS) {
    throw new AppError(409, {
      detail: `Puedes tener como mucho ${String(MAX_SUBSCRIPTIONS)} suscripciones`,
    });
  }
  if ((await calendars.count()) >= 50) {
    throw new AppError(409, { detail: "Has llegado al máximo de 50 calendarios" });
  }
  // Primera descarga antes de crear nada: si la dirección no sirve, se dice enseguida.
  let feed: FeedResult;
  try {
    feed = await fetchFeed(input.url, { etag: null, lastModified: null }, fetchImpl);
  } catch (error) {
    throw new AppError(422, { detail: subscriptionMessage(error) });
  }
  const fromFeed =
    feed.status === "ok" ? /X-WR-CALNAME[^:]*:(.*)/i.exec(feed.text)?.[1]?.trim() : undefined;
  const name =
    [input.name, fromFeed].find((v) => v !== undefined && v !== "") ?? "Suscripción de Google";
  const calendar = await calendars.create({
    name: name.replace(/\\([\\;,])/g, "$1").slice(0, 60),
    color: input.color,
    readOnly: true,
  });
  const id = newId();
  const subscription = await repo.insert({
    id,
    calendarId: calendar.id,
    urlEnc: await encryptField(input.url, keyring, aad(ownerId, id)),
    urlHint: urlHint(input.url),
    etag: null,
    lastModified: null,
    status: "pending",
    lastError: null,
    failures: 0,
    lastSyncedAt: null,
    nextSyncAt: now,
  });
  const result = await syncSubscription(db, keyring, subscription, now, () =>
    // La primera sincronización reutiliza la descarga que ya se hizo.
    Promise.resolve(
      feed.status === "ok"
        ? new Response(feed.text, {
            status: 200,
            headers: {
              "content-type": "text/calendar",
              ...(feed.etag ? { etag: feed.etag } : {}),
              ...(feed.lastModified ? { "last-modified": feed.lastModified } : {}),
            },
          })
        : new Response(null, { status: 304 }),
    ),
  ).catch(() => null);
  const saved = (await repo.get(id)) ?? subscription;
  return {
    subscription: saved,
    result: result ?? {
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      deleted: 0,
      notModified: false,
    },
  };
}

export async function subscriptionDto(
  db: Database,
  row: SubscriptionRow,
): Promise<SubscriptionInfo> {
  const calendar = await calendarRepository(db, row.ownerId).get(row.calendarId);
  return {
    id: row.id,
    calendarId: row.calendarId,
    name: calendar?.name ?? "Suscripción",
    color: calendar?.color ?? "#7c5cff",
    urlHint: row.urlHint,
    status: row.status,
    error: row.lastError,
    events: await eventRepository(db, row.ownerId).countInCalendar(row.calendarId),
    lastSyncedAt: row.lastSyncedAt === null ? null : new Date(row.lastSyncedAt).toISOString(),
    nextSyncAt: new Date(row.nextSyncAt).toISOString(),
  };
}
