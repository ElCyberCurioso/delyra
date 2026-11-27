import { CALENDAR_COLORS, type GoogleSyncInfo, newId } from "@delyra/shared";
import type { Database } from "../db/client";
import type { GoogleConnectionRow, GoogleSyncedCalendarRow } from "../db/schema";
import { AppError } from "../lib/errors";
import { decryptField, encryptField, type Keyring } from "../lib/field-crypto";
import { IMPORT_LIMITS, ImportFormatError, ImportLimitError } from "../lib/import-model";
import type { Logger } from "../lib/logger";
import { calendarRepository } from "../repositories/calendars";
import { eventRepository } from "../repositories/events";
import {
  claimGoogleCalendar,
  dueGoogleCalendars,
  googleSyncRepository,
} from "../repositories/google-sync";
import {
  calendarMeta,
  downloadCalendar,
  GoogleApiError,
  GoogleCalendarClient,
  type GoogleConfig,
  GoogleRevokedError,
  GoogleUnauthorizedError,
  refreshAccessToken,
  revokeGoogleToken,
} from "./google";
import { userTimeZone } from "./imports";
import { mirrorCalendar, type SyncResult } from "./subscriptions";

/**
 * Sincronización continua con Google Calendar (F7-09, ADR-0014), solo de Google a Delyra.
 *
 * - Una conexión por persona con el token de actualización cifrado (AES-GCM, AAD ligado a la
 *   persona y a la conexión). Nunca vuelve al cliente ni a los logs. Al desconectar se revoca en
 *   Google y se borra.
 * - Cada calendario elegido se refleja en un calendario de solo lectura de Delyra.
 * - Cada 15 minutos, una consulta incremental con el `syncToken` de Google: si no ha cambiado
 *   nada no se toca la base de datos. Si hay cambios (o el token caducó, 410), se descarga el
 *   calendario entero y se refleja igual que una suscripción iCal (`mirrorCalendar`).
 * - Si Google retira el permiso (`invalid_grant`), la conexión queda «revocada» y no se vuelve a
 *   llamar a Google hasta que la persona reconecte.
 */

const GOOGLE_SYNC_INTERVAL_MS = 15 * 60_000;
export const MANUAL_GOOGLE_SYNC_MIN_MS = 2 * 60_000;
const MAX_GOOGLE_SYNCED = 10;
const DAY_MS = 86_400_000;
const CLAIM_MS = 10 * 60_000;
/** Margen para no usar un token de acceso a punto de caducar. */
const ACCESS_MARGIN_MS = 2 * 60_000;

const REVOKED_MESSAGE = "Google ha retirado el permiso de Delyra. Vuelve a conectar tu cuenta.";
const GONE_MESSAGE =
  "Este calendario ya no está en tu cuenta de Google o has perdido el acceso a él.";

const refreshAad = (ownerId: string, id: string) => `google-refresh:${ownerId}:${id}`;
const accessAad = (ownerId: string, id: string) => `google-access:${ownerId}:${id}`;

function googleSyncMessage(error: unknown): string {
  if (error instanceof GoogleRevokedError) return REVOKED_MESSAGE;
  if (error instanceof GoogleApiError && error.status === 404) return GONE_MESSAGE;
  if (
    error instanceof ImportLimitError ||
    (error instanceof ImportFormatError && !(error instanceof GoogleUnauthorizedError))
  ) {
    return error.message;
  }
  return "No se ha podido sincronizar. Se volverá a intentar más tarde.";
}

// ── Conexión ─────────────────────────────────────────────────────────────────

/** Guarda (o renueva al reconectar) la conexión con los tokens recién canjeados. */
export async function saveGoogleConnection(
  db: Database,
  keyring: Keyring,
  ownerId: string,
  tokens: { accessToken: string; refreshToken: string; expiresIn: number },
  now: number,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleConnectionRow> {
  const repo = googleSyncRepository(db, ownerId);
  const existing = await repo.connection();
  const id = existing?.id ?? newId();
  let accountEmail: string | null = null;
  try {
    const list = await new GoogleCalendarClient(tokens.accessToken, fetchImpl).calendarList();
    const primary = list.find((entry) => entry.primary)?.id ?? null;
    accountEmail = primary && primary.length <= 254 && primary.includes("@") ? primary : null;
  } catch {
    // Solo sirve para mostrar qué cuenta está conectada.
  }
  const saved = await repo.saveConnection({
    id,
    refreshTokenEnc: await encryptField(tokens.refreshToken, keyring, refreshAad(ownerId, id)),
    accessTokenEnc: await encryptField(tokens.accessToken, keyring, accessAad(ownerId, id)),
    accessExpiresAt: now + tokens.expiresIn * 1000,
    accountEmail,
    status: "ok",
  });
  // Al reconectar, lo que estaba en pausa se pone al día enseguida.
  if (existing) {
    await repo.updateAllCalendars({
      status: "pending",
      lastError: null,
      failures: 0,
      nextSyncAt: now,
    });
  }
  return saved;
}

async function markRevoked(db: Database, ownerId: string, now: number): Promise<void> {
  const repo = googleSyncRepository(db, ownerId);
  await repo.updateConnection({ status: "revoked", accessTokenEnc: null, accessExpiresAt: null });
  await repo.updateAllCalendars({
    status: "error",
    lastError: REVOKED_MESSAGE,
    nextSyncAt: now + DAY_MS,
  });
}

/** Token de acceso vigente: el guardado si le queda tiempo o uno nuevo con el de actualización. */
async function accessToken(
  db: Database,
  keyring: Keyring,
  config: GoogleConfig,
  connection: GoogleConnectionRow,
  now: number,
  fetchImpl: typeof fetch,
): Promise<string> {
  const { ownerId, id } = connection;
  if (connection.accessTokenEnc && (connection.accessExpiresAt ?? 0) > now + ACCESS_MARGIN_MS) {
    return decryptField(connection.accessTokenEnc, keyring, accessAad(ownerId, id));
  }
  const refreshToken = await decryptField(
    connection.refreshTokenEnc,
    keyring,
    refreshAad(ownerId, id),
  );
  const fresh = await refreshAccessToken(config, refreshToken, fetchImpl);
  await googleSyncRepository(db, ownerId).updateConnection({
    accessTokenEnc: await encryptField(fresh.accessToken, keyring, accessAad(ownerId, id)),
    accessExpiresAt: now + fresh.expiresIn * 1000,
  });
  return fresh.accessToken;
}

/**
 * Cliente de Calendar con un token válido. Si Google rechaza el guardado (401), se pide otro una
 * vez; si el permiso se ha retirado, la conexión queda revocada.
 */
async function withClient<T>(
  db: Database,
  keyring: Keyring,
  config: GoogleConfig,
  connection: GoogleConnectionRow,
  now: number,
  fetchImpl: typeof fetch,
  run: (client: GoogleCalendarClient) => Promise<T>,
): Promise<T> {
  try {
    const token = await accessToken(db, keyring, config, connection, now, fetchImpl);
    try {
      return await run(new GoogleCalendarClient(token, fetchImpl));
    } catch (error) {
      if (!(error instanceof GoogleUnauthorizedError)) throw error;
      const retry = await accessToken(
        db,
        keyring,
        config,
        { ...connection, accessTokenEnc: null },
        now,
        fetchImpl,
      );
      return await run(new GoogleCalendarClient(retry, fetchImpl));
    }
  } catch (error) {
    if (error instanceof GoogleRevokedError) await markRevoked(db, connection.ownerId, now);
    throw error;
  }
}

async function activeConnection(db: Database, ownerId: string): Promise<GoogleConnectionRow> {
  const connection = await googleSyncRepository(db, ownerId).connection();
  if (!connection) throw new AppError(409, { detail: "Conecta primero tu cuenta de Google" });
  if (connection.status === "revoked") throw new AppError(409, { detail: REVOKED_MESSAGE });
  return connection;
}

function asHttpError(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (error instanceof GoogleApiError && error.status === 404) {
    throw new AppError(404, { detail: "Ese calendario no está en tu cuenta de Google" });
  }
  throw new AppError(error instanceof GoogleRevokedError ? 409 : 502, {
    detail: googleSyncMessage(error),
  });
}

/** Calendarios de la cuenta de Google, marcando los que ya se sincronizan. */
export async function listAccountCalendars(
  db: Database,
  keyring: Keyring,
  config: GoogleConfig,
  ownerId: string,
  now: number,
  fetchImpl: typeof fetch = fetch,
) {
  const connection = await activeConnection(db, ownerId);
  const synced = new Set(
    (await googleSyncRepository(db, ownerId).calendars()).map((row) => row.googleCalendarId),
  );
  try {
    const entries = await withClient(db, keyring, config, connection, now, fetchImpl, (client) =>
      client.calendarList(),
    );
    return entries.map((entry) => {
      const meta = calendarMeta(entry);
      return {
        googleCalendarId: meta.id,
        name: meta.name,
        color: meta.color,
        suggestSkip: meta.suggestSkip,
        synced: synced.has(meta.id),
      };
    });
  } catch (error) {
    return asHttpError(error);
  }
}

/** Empieza a sincronizar un calendario de Google en un calendario nuevo de solo lectura. */
export async function addGoogleCalendar(
  db: Database,
  keyring: Keyring,
  config: GoogleConfig,
  ownerId: string,
  input: { googleCalendarId: string; reminders: boolean },
  now: number,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleSyncedCalendarRow> {
  const repo = googleSyncRepository(db, ownerId);
  const calendars = calendarRepository(db, ownerId);
  const connection = await activeConnection(db, ownerId);
  const existing = await repo.calendars();
  if (existing.some((row) => row.googleCalendarId === input.googleCalendarId)) {
    throw new AppError(409, { detail: "Ya sincronizas ese calendario" });
  }
  if (existing.length >= MAX_GOOGLE_SYNCED) {
    throw new AppError(409, {
      detail: `Puedes sincronizar como mucho ${String(MAX_GOOGLE_SYNCED)} calendarios`,
    });
  }
  if ((await calendars.count()) >= 50) {
    throw new AppError(409, { detail: "Has llegado al máximo de 50 calendarios" });
  }
  let entry;
  try {
    entry = await withClient(db, keyring, config, connection, now, fetchImpl, (client) =>
      client.calendarEntry(input.googleCalendarId),
    );
  } catch (error) {
    return asHttpError(error);
  }
  const meta = calendarMeta(entry);
  const calendar = await calendars.create({
    name: meta.name,
    color: meta.color ?? CALENDAR_COLORS[existing.length % CALENDAR_COLORS.length] ?? "#7c5cff",
    readOnly: true,
  });
  return repo.insertCalendar({
    id: newId(),
    connectionId: connection.id,
    calendarId: calendar.id,
    googleCalendarId: meta.id,
    reminders: input.reminders,
    syncToken: null,
    status: "pending",
    lastError: null,
    failures: 0,
    lastSyncedAt: null,
    nextSyncAt: now,
  });
}

// ── Sincronización ───────────────────────────────────────────────────────────

/** Pone al día un calendario sincronizado. Los errores quedan en la fila (estado y mensaje). */
export async function syncGoogleCalendar(
  db: Database,
  keyring: Keyring,
  config: GoogleConfig,
  row: GoogleSyncedCalendarRow,
  now: number,
  fetchImpl: typeof fetch = fetch,
): Promise<SyncResult> {
  const repo = googleSyncRepository(db, row.ownerId);
  const empty: SyncResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    deleted: 0,
    notModified: true,
  };
  const connection = await repo.connection();
  if (connection?.id !== row.connectionId || connection.status === "revoked") {
    await repo.updateCalendar(row.id, {
      status: "error",
      lastError: REVOKED_MESSAGE,
      nextSyncAt: now + DAY_MS,
    });
    throw new GoogleRevokedError();
  }
  try {
    const result = await withClient(
      db,
      keyring,
      config,
      connection,
      now,
      fetchImpl,
      async (client) => {
        if (row.syncToken) {
          try {
            const changes = await client.changesSince(row.googleCalendarId, row.syncToken);
            if (changes.changed === 0)
              return { ...empty, syncToken: changes.nextSyncToken ?? row.syncToken };
          } catch (error) {
            // 410: el token de Google caducó; se descarga todo otra vez.
            if (!(error instanceof GoogleApiError && error.status === 410)) throw error;
          }
        }
        const meta = calendarMeta(await client.calendarEntry(row.googleCalendarId));
        const { events } = await downloadCalendar(client, meta, {
          defaultTimeZone: await userTimeZone(db, row.ownerId),
          maxEvents: IMPORT_LIMITS.events,
        });
        const counts = await mirrorCalendar(db, row.ownerId, row.calendarId, events, now, {
          reminders: row.reminders,
        });
        return { ...counts, notModified: false, syncToken: client.nextSyncToken };
      },
    );
    const { syncToken, ...counts } = result;
    await repo.updateCalendar(row.id, {
      status: "ok",
      lastError: null,
      failures: 0,
      syncToken,
      lastSyncedAt: now,
      nextSyncAt: now + GOOGLE_SYNC_INTERVAL_MS,
    });
    return counts;
  } catch (error) {
    if (error instanceof GoogleRevokedError) throw error;
    const failures = row.failures + 1;
    await repo.updateCalendar(row.id, {
      status: "error",
      lastError: googleSyncMessage(error),
      failures,
      // Un calendario borrado en Google no se arregla solo: se reintenta una vez al día.
      nextSyncAt:
        error instanceof GoogleApiError && error.status === 404
          ? now + DAY_MS
          : now + Math.min(GOOGLE_SYNC_INTERVAL_MS * 2 ** (failures - 1), DAY_MS),
    });
    throw error;
  }
}

/**
 * Planificador (cada minuto): unos pocos calendarios pendientes en cada pasada. Casi siempre es
 * una consulta incremental sin cambios, así que 6 por minuto dan para 90 calendarios cada 15 min.
 */
export async function syncDueGoogleCalendars(
  db: Database,
  keyring: Keyring,
  config: GoogleConfig | null,
  now: number,
  logger: Logger,
  limit = 6,
): Promise<number> {
  if (!config) return 0;
  let synced = 0;
  for (const row of await dueGoogleCalendars(db, now, limit)) {
    if (!(await claimGoogleCalendar(db, row, now + CLAIM_MS))) continue;
    try {
      const result = await syncGoogleCalendar(db, keyring, config, row, now);
      logger.info("google_calendar_synced", {
        syncId: row.id,
        notModified: result.notModified,
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
      });
      synced++;
    } catch (error) {
      logger.warn("google_calendar_sync_failed", {
        syncId: row.id,
        error: googleSyncMessage(error),
      });
    }
  }
  return synced;
}

// ── Bajas ────────────────────────────────────────────────────────────────────

async function removeCalendar(db: Database, ownerId: string, calendarId: string) {
  await eventRepository(db, ownerId).deleteRemindersOfCalendar(calendarId);
  // Con el calendario se van, en cascada, la fila de sincronización y sus eventos.
  await calendarRepository(db, ownerId).remove(calendarId);
}

/** Deja de sincronizar un calendario y lo borra de Delyra (sigue en Google). */
export async function removeGoogleCalendar(
  db: Database,
  ownerId: string,
  id: string,
): Promise<boolean> {
  const row = await googleSyncRepository(db, ownerId).calendar(id);
  if (!row) return false;
  await removeCalendar(db, ownerId, row.calendarId);
  return true;
}

/**
 * Desconecta la cuenta: revoca el permiso en Google, borra los tokens y los calendarios
 * sincronizados (que siguen en Google).
 */
export async function disconnectGoogle(
  db: Database,
  keyring: Keyring,
  ownerId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ revoked: boolean; calendars: number } | null> {
  const repo = googleSyncRepository(db, ownerId);
  const connection = await repo.connection();
  if (!connection) return null;
  let revoked = false;
  try {
    const refreshToken = await decryptField(
      connection.refreshTokenEnc,
      keyring,
      refreshAad(ownerId, connection.id),
    );
    revoked = await revokeGoogleToken(refreshToken, fetchImpl);
  } catch {
    // Aunque no se pueda revocar, el token se borra igualmente.
  }
  const rows = await repo.calendars();
  for (const row of rows) await removeCalendar(db, ownerId, row.calendarId);
  await repo.deleteConnection();
  return { revoked, calendars: rows.length };
}

// ── DTO ──────────────────────────────────────────────────────────────────────

export async function googleSyncDto(
  db: Database,
  ownerId: string,
  enabled: boolean,
): Promise<GoogleSyncInfo> {
  const repo = googleSyncRepository(db, ownerId);
  const [connection, rows] = await Promise.all([repo.connection(), repo.calendars()]);
  const calendars = calendarRepository(db, ownerId);
  const events = eventRepository(db, ownerId);
  return {
    enabled,
    connection: connection
      ? {
          email: connection.accountEmail,
          status: connection.status,
          connectedAt: connection.createdAt.toISOString(),
        }
      : null,
    calendars: await Promise.all(
      rows.map(async (row) => {
        const calendar = await calendars.get(row.calendarId);
        return {
          id: row.id,
          calendarId: row.calendarId,
          name: calendar?.name ?? "Google",
          color: calendar?.color ?? "#7c5cff",
          reminders: row.reminders,
          status: row.status,
          error: row.lastError,
          events: await events.countInCalendar(row.calendarId),
          lastSyncedAt: row.lastSyncedAt === null ? null : new Date(row.lastSyncedAt).toISOString(),
          nextSyncAt: new Date(row.nextSyncAt).toISOString(),
        };
      }),
    ),
  };
}
