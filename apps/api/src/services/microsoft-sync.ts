import {
  type MicrosoftBoardInfo,
  type MicrosoftBoardSyncRequest,
  newId,
  PROBLEM_TYPES,
} from "@delyra/shared";
import { and, asc, count, eq, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  boardColumns,
  labels,
  type MicrosoftBoardSyncRow,
  microsoftBoardSyncs,
  type MicrosoftConnectionRow,
  microsoftConnections,
  type MicrosoftSyncedCardRow,
  microsoftSyncedCards,
} from "../db/schema";
import { sha256Hex } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { decryptField, encryptField, type Keyring } from "../lib/field-crypto";
import type { Logger } from "../lib/logger";
import type { KanbanRepository } from "../repositories/kanban";
import { boardAccess } from "./board-access";
import { createCard, setArchived, updateCard, type CardPatch } from "./kanban";
import {
  escapeMarkdown,
  GraphClient,
  GraphError,
  GraphUnauthorizedError,
  type MeetingInfo,
  meetingInfo,
  microsoftAccessAad,
  type MicrosoftConfig,
  microsoftRefreshAad,
  MicrosoftRevokedError,
  type MicrosoftTokens,
  refreshMicrosoftToken,
} from "./microsoft";
import { getUserSettings } from "./users";

/**
 * Reuniones de Teams en un tablero (docs/plan-teams.md, ADR-0015).
 *
 * Cada 15 minutos se leen los eventos del calendario de Microsoft 365 de quien configuró el
 * tablero (de un poco antes de ahora hasta N días después) y se reflejan como tarjetas:
 * - evento nuevo → tarjeta nueva en la columna elegida, con fecha, descripción y etiqueta «Teams»;
 * - evento cambiado → se actualizan título, fecha y descripción, salvo lo que la persona haya
 *   editado en la tarjeta (se compara con lo último que escribió Delyra);
 * - evento cancelado o borrado → la tarjeta se archiva.
 * Notas, checklist, comentarios y adjuntos de la tarjeta nunca se tocan.
 */

const MICROSOFT_SYNC_INTERVAL_MS = 15 * 60_000;
export const MANUAL_MICROSOFT_SYNC_MIN_MS = 2 * 60_000;
const DAY_MS = 86_400_000;
const CLAIM_MS = 10 * 60_000;
const ACCESS_MARGIN_MS = 2 * 60_000;
/** Reuniones que ya han empezado (hasta 12 h antes) también se reflejan. */
const LOOKBACK_MS = 12 * 3_600_000;
/** Eventos que desaparecen de la ventana y se consultan uno a uno en cada pasada. */
const MAX_LOOKUPS = 20;
const TEAMS_LABEL = { name: "Teams", color: "#5b5bd6" };

const REVOKED_MESSAGE = "Microsoft ha retirado el permiso de Delyra. Vuelve a conectar tu cuenta.";
const NO_ACCESS_MESSAGE = "Ya no puedes editar este tablero: se ha dejado de volcar.";

function microsoftSyncMessage(error: unknown): string {
  if (error instanceof MicrosoftRevokedError) return REVOKED_MESSAGE;
  if (error instanceof AppError && error.status === 409 && error.problem.detail) {
    return error.problem.detail;
  }
  return "No se ha podido actualizar desde Microsoft 365. Se volverá a intentar más tarde.";
}

// ── Conexión ─────────────────────────────────────────────────────────────────

async function connectionOf(db: Database, ownerId: string) {
  const [row] = await db
    .select()
    .from(microsoftConnections)
    .where(eq(microsoftConnections.ownerId, ownerId))
    .limit(1);
  return row ?? null;
}

async function updateConnection(
  db: Database,
  ownerId: string,
  patch: Partial<
    Pick<
      MicrosoftConnectionRow,
      "refreshTokenEnc" | "accessTokenEnc" | "accessExpiresAt" | "accountEmail" | "status"
    >
  >,
) {
  await db
    .update(microsoftConnections)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(microsoftConnections.ownerId, ownerId));
}

/** Guarda (o renueva al reconectar) la conexión con los tokens recién canjeados. */
export async function saveMicrosoftConnection(
  db: Database,
  keyring: Keyring,
  ownerId: string,
  tokens: MicrosoftTokens,
  now: number,
  fetchImpl: typeof fetch = fetch,
): Promise<MicrosoftConnectionRow> {
  const existing = await connectionOf(db, ownerId);
  const id = existing?.id ?? newId();
  const email = await new GraphClient(tokens.accessToken, fetchImpl).me().catch(() => null);
  const values = {
    refreshTokenEnc: await encryptField(
      tokens.refreshToken,
      keyring,
      microsoftRefreshAad(ownerId, id),
    ),
    accessTokenEnc: await encryptField(
      tokens.accessToken,
      keyring,
      microsoftAccessAad(ownerId, id),
    ),
    accessExpiresAt: now + tokens.expiresIn * 1000,
    accountEmail: email,
    status: "ok" as const,
    updatedAt: new Date(now),
  };
  const [saved] = await db
    .insert(microsoftConnections)
    .values({ id, ownerId, ...values, createdAt: new Date(now) })
    .onConflictDoUpdate({ target: microsoftConnections.ownerId, set: values })
    .returning();
  if (!saved) throw new Error("No se pudo guardar la conexión con Microsoft");
  // Al reconectar, los tableros en pausa se ponen al día enseguida.
  await db
    .update(microsoftBoardSyncs)
    .set({
      status: "pending",
      lastError: null,
      failures: 0,
      nextSyncAt: now,
      updatedAt: new Date(now),
    })
    .where(eq(microsoftBoardSyncs.ownerId, ownerId));
  return saved;
}

async function markRevoked(db: Database, ownerId: string, now: number) {
  await updateConnection(db, ownerId, {
    status: "revoked",
    accessTokenEnc: null,
    accessExpiresAt: null,
  });
  await db
    .update(microsoftBoardSyncs)
    .set({
      status: "error",
      lastError: REVOKED_MESSAGE,
      nextSyncAt: now + DAY_MS,
      updatedAt: new Date(now),
    })
    .where(eq(microsoftBoardSyncs.ownerId, ownerId));
}

/** Token de acceso vigente. Al renovarlo, Microsoft entrega también un token de actualización nuevo. */
async function accessToken(
  db: Database,
  keyring: Keyring,
  config: MicrosoftConfig,
  connection: MicrosoftConnectionRow,
  now: number,
  fetchImpl: typeof fetch,
  force = false,
): Promise<string> {
  const { ownerId, id } = connection;
  if (
    !force &&
    connection.accessTokenEnc &&
    (connection.accessExpiresAt ?? 0) > now + ACCESS_MARGIN_MS
  ) {
    return decryptField(connection.accessTokenEnc, keyring, microsoftAccessAad(ownerId, id));
  }
  const refresh = await decryptField(
    connection.refreshTokenEnc,
    keyring,
    microsoftRefreshAad(ownerId, id),
  );
  const fresh = await refreshMicrosoftToken(config, refresh, fetchImpl);
  await updateConnection(db, ownerId, {
    refreshTokenEnc: await encryptField(
      fresh.refreshToken,
      keyring,
      microsoftRefreshAad(ownerId, id),
    ),
    accessTokenEnc: await encryptField(fresh.accessToken, keyring, microsoftAccessAad(ownerId, id)),
    accessExpiresAt: now + fresh.expiresIn * 1000,
  });
  return fresh.accessToken;
}

/** Cliente de Graph con un token válido; si Graph lo rechaza, se renueva una vez. */
async function withGraph<T>(
  db: Database,
  keyring: Keyring,
  config: MicrosoftConfig,
  connection: MicrosoftConnectionRow,
  now: number,
  fetchImpl: typeof fetch,
  run: (graph: GraphClient) => Promise<T>,
): Promise<T> {
  try {
    const token = await accessToken(db, keyring, config, connection, now, fetchImpl);
    try {
      return await run(new GraphClient(token, fetchImpl));
    } catch (error) {
      if (!(error instanceof GraphUnauthorizedError)) throw error;
      const retry = await accessToken(db, keyring, config, connection, now, fetchImpl, true);
      return await run(new GraphClient(retry, fetchImpl));
    }
  } catch (error) {
    if (error instanceof MicrosoftRevokedError) await markRevoked(db, connection.ownerId, now);
    throw error;
  }
}

/** Desconecta: borra los tokens y deja de volcar (las tarjetas se quedan en sus tableros). */
export async function disconnectMicrosoft(db: Database, ownerId: string): Promise<boolean> {
  const deleted = await db
    .delete(microsoftConnections)
    .where(eq(microsoftConnections.ownerId, ownerId))
    .returning({ id: microsoftConnections.id });
  return deleted.length === 1;
}

// ── Configuración por tablero ────────────────────────────────────────────────

async function syncOfBoard(db: Database, boardId: string) {
  const [row] = await db
    .select()
    .from(microsoftBoardSyncs)
    .where(eq(microsoftBoardSyncs.boardId, boardId))
    .limit(1);
  return row ?? null;
}

/** Activa o cambia el volcado de un tablero con las reuniones de quien lo pide. */
export async function configureBoardSync(
  db: Database,
  userId: string,
  boardId: string,
  input: MicrosoftBoardSyncRequest,
  now: number,
): Promise<MicrosoftBoardSyncRow> {
  await boardAccess(db, userId, { board: boardId }, "write");
  const connection = await connectionOf(db, userId);
  if (!connection)
    throw new AppError(409, { detail: "Conecta primero tu cuenta de Microsoft 365" });
  if (connection.status === "revoked") throw new AppError(409, { detail: REVOKED_MESSAGE });
  const [column] = await db
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(and(eq(boardColumns.id, input.columnId), eq(boardColumns.boardId, boardId)))
    .limit(1);
  if (!column) {
    throw new AppError(422, {
      type: PROBLEM_TYPES.validation,
      errors: [{ path: "columnId", message: "Columna no válida" }],
    });
  }
  const existing = await syncOfBoard(db, boardId);
  if (existing && existing.ownerId !== userId) {
    throw new AppError(409, { detail: "Este tablero ya recibe las reuniones de otra persona" });
  }
  const values = {
    columnId: column.id,
    onlyTeams: input.onlyTeams,
    daysAhead: input.daysAhead,
    connectionId: connection.id,
    status: "pending" as const,
    lastError: null,
    failures: 0,
    nextSyncAt: now,
    updatedAt: new Date(now),
  };
  if (existing) {
    const [row] = await db
      .update(microsoftBoardSyncs)
      .set(values)
      .where(eq(microsoftBoardSyncs.id, existing.id))
      .returning();
    if (!row) throw new AppError(404);
    return row;
  }
  const [row] = await db
    .insert(microsoftBoardSyncs)
    .values({
      id: newId(),
      ownerId: userId,
      boardId,
      labelId: null,
      lastSyncedAt: null,
      createdAt: new Date(now),
      ...values,
    })
    .returning();
  if (!row) throw new Error("No se pudo guardar el volcado");
  return row;
}

/** Deja de volcar: quien lo configuró o el dueño del tablero. Las tarjetas se quedan. */
export async function stopBoardSync(
  db: Database,
  userId: string,
  boardId: string,
): Promise<boolean> {
  const access = await boardAccess(db, userId, { board: boardId }, "read");
  const existing = await syncOfBoard(db, boardId);
  if (!existing) return false;
  if (existing.ownerId !== userId && access.role !== "owner") {
    throw new AppError(403, {
      detail: "Solo puede quitarlo quien lo configuró o el dueño del tablero",
    });
  }
  await db.delete(microsoftBoardSyncs).where(eq(microsoftBoardSyncs.id, existing.id));
  return true;
}

export async function boardSyncInfo(
  db: Database,
  userId: string,
  boardId: string,
  enabled: boolean,
): Promise<MicrosoftBoardInfo> {
  await boardAccess(db, userId, { board: boardId }, "read");
  const [connection, sync] = await Promise.all([
    connectionOf(db, userId),
    syncOfBoard(db, boardId),
  ]);
  let cards = 0;
  if (sync) {
    const [row] = await db
      .select({ total: count() })
      .from(microsoftSyncedCards)
      .where(
        and(eq(microsoftSyncedCards.syncId, sync.id), eq(microsoftSyncedCards.cancelled, false)),
      );
    cards = row?.total ?? 0;
  }
  return {
    enabled,
    connection: connection ? { email: connection.accountEmail, status: connection.status } : null,
    sync: sync
      ? {
          mine: sync.ownerId === userId,
          columnId: sync.columnId,
          onlyTeams: sync.onlyTeams,
          daysAhead: sync.daysAhead,
          status: sync.status,
          error: sync.lastError,
          cards,
          lastSyncedAt:
            sync.lastSyncedAt === null ? null : new Date(sync.lastSyncedAt).toISOString(),
          nextSyncAt: new Date(sync.nextSyncAt).toISOString(),
        }
      : null,
  };
}

export async function boardSyncRow(db: Database, boardId: string) {
  return syncOfBoard(db, boardId);
}

/** Aparta un volcado del planificador hasta `until` (mientras corre la primera pasada). */
export async function claimBoardSync(db: Database, id: string, until: number): Promise<void> {
  await db
    .update(microsoftBoardSyncs)
    .set({ nextSyncAt: until })
    .where(eq(microsoftBoardSyncs.id, id));
}

// ── Reconciliación ───────────────────────────────────────────────────────────

const TEXTS = {
  es: {
    teams: "Reunión de Teams",
    event: "Evento de Outlook",
    allDay: "todo el día",
    organizer: "Organiza",
    location: "Lugar",
    join: "Unirse a la reunión",
    footer: "Desde tu calendario de Microsoft 365.",
    untitled: "(Sin asunto)",
  },
  en: {
    teams: "Teams meeting",
    event: "Outlook event",
    allDay: "all day",
    organizer: "Organiser",
    location: "Location",
    join: "Join the meeting",
    footer: "From your Microsoft 365 calendar.",
    untitled: "(No subject)",
  },
} as const;

/** Descripción de la tarjeta (Markdown; los textos de fuera van escapados). */
function meetingDescription(info: MeetingInfo, locale: string, timeZone: string): string {
  const t = locale === "en" ? TEXTS.en : TEXTS.es;
  const intl = locale === "en" ? "en-GB" : "es-ES";
  const day = new Intl.DateTimeFormat(intl, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: info.allDay ? "UTC" : timeZone,
  }).format(info.startAt);
  const time = (ms: number) =>
    new Intl.DateTimeFormat(intl, { hour: "2-digit", minute: "2-digit", timeZone }).format(ms);
  const when = info.allDay
    ? `${day} (${t.allDay})`
    : `${day}, ${time(info.startAt)}${info.endAt === null ? "" : `–${time(info.endAt)}`}`;
  const lines = [`**${info.joinUrl ? t.teams : t.event}** · ${escapeMarkdown(when)}`];
  if (info.organizer) lines.push(`${t.organizer}: ${escapeMarkdown(info.organizer)}`);
  if (info.location) lines.push(`${t.location}: ${escapeMarkdown(info.location)}`);
  if (info.joinUrl) {
    lines.push(`[${t.join}](${info.joinUrl.replaceAll("(", "%28").replaceAll(")", "%29")})`);
  }
  lines.push(`_${t.footer}_`);
  return lines.join("\n\n");
}

const dueOf = (info: MeetingInfo, timeZone: string): NonNullable<CardPatch["due"]> => ({
  allDay: info.allDay,
  at: info.allDay && info.startDate ? info.startDate : new Date(info.startAt).toISOString(),
  tz: timeZone,
});

async function ensureLabel(
  repo: KanbanRepository,
  row: MicrosoftBoardSyncRow,
): Promise<string | null> {
  const existing = await repo.labelsOf(row.boardId);
  const found =
    existing.find((l) => l.id === row.labelId) ?? existing.find((l) => l.name === TEAMS_LABEL.name);
  if (found) return found.id;
  if (existing.length >= 50) return null;
  const id = newId();
  await repo.db.insert(labels).values({
    id,
    ownerId: repo.ownerId,
    boardId: row.boardId,
    ...TEAMS_LABEL,
    createdAt: new Date(),
  });
  return id;
}

export interface BoardSyncResult {
  created: number;
  updated: number;
  archived: number;
}

/**
 * Pone al día un tablero. `notify` avisa a su canal en vivo si algo cambió. Los errores quedan
 * en la fila (estado y mensaje) y se relanzan.
 */
export async function syncBoard(
  db: Database,
  keyring: Keyring,
  config: MicrosoftConfig,
  row: MicrosoftBoardSyncRow,
  now: number,
  notify: (boardId: string, by: string) => Promise<void> = () => Promise.resolve(),
  fetchImpl: typeof fetch = fetch,
): Promise<BoardSyncResult> {
  const fail = async (message: string, retryIn: number) => {
    await db
      .update(microsoftBoardSyncs)
      .set({
        status: "error",
        lastError: message,
        failures: row.failures + 1,
        nextSyncAt: now + retryIn,
        updatedAt: new Date(now),
      })
      .where(eq(microsoftBoardSyncs.id, row.id));
  };
  const connection = await connectionOf(db, row.ownerId);
  if (connection?.id !== row.connectionId || connection.status === "revoked") {
    await fail(REVOKED_MESSAGE, DAY_MS);
    throw new MicrosoftRevokedError();
  }
  let repo: KanbanRepository;
  try {
    repo = (await boardAccess(db, row.ownerId, { board: row.boardId }, "write")).repo;
  } catch (error) {
    await fail(NO_ACCESS_MESSAGE, DAY_MS);
    throw error;
  }

  const result: BoardSyncResult = { created: 0, updated: 0, archived: 0 };
  try {
    const settings = await getUserSettings(db, row.ownerId);
    const locale = settings?.locale ?? "es";
    const timeZone = settings?.timeZone ?? "Europe/Madrid";
    const links = await db
      .select()
      .from(microsoftSyncedCards)
      .where(eq(microsoftSyncedCards.syncId, row.id));
    const byEvent = new Map(links.map((l) => [l.eventId, l]));
    const untitled = locale === "en" ? TEXTS.en.untitled : TEXTS.es.untitled;
    const titled = (m: MeetingInfo): MeetingInfo => ({ ...m, title: m.title || untitled });

    const { events, lookups } = await withGraph(
      db,
      keyring,
      config,
      connection,
      now,
      fetchImpl,
      async (graph) => {
        const all = (
          await graph.calendarView(
            new Date(now - LOOKBACK_MS),
            new Date(now + row.daysAhead * DAY_MS),
          )
        )
          .map(meetingInfo)
          .filter((m): m is MeetingInfo => m !== null)
          .map(titled);
        const wanted = row.onlyTeams
          ? all.filter((m) => m.joinUrl !== null || byEvent.has(m.eventId))
          : all;
        // Lo que ya tenía tarjeta, era futuro y ya no aparece: se borró, se movió lejos o dejó de ser de Teams.
        const seen = new Set(wanted.map((m) => m.eventId));
        const missing = links
          .filter((l) => !l.cancelled && l.startAt > now && !seen.has(l.eventId))
          .slice(0, MAX_LOOKUPS);
        const found = new Map<string, MeetingInfo | null>();
        for (const link of missing) {
          const event = await graph.event(link.eventId);
          const info = event ? meetingInfo(event) : null;
          found.set(link.eventId, info ? titled(info) : null);
        }
        return { events: wanted.sort((a, b) => a.startAt - b.startAt), lookups: found };
      },
    );

    let labelId = row.labelId;
    const saveLink = async (
      link: MicrosoftSyncedCardRow,
      patch: Partial<MicrosoftSyncedCardRow>,
    ) => {
      await db
        .update(microsoftSyncedCards)
        .set({ ...patch, updatedAt: new Date(now) })
        .where(eq(microsoftSyncedCards.id, link.id));
    };

    const apply = async (info: MeetingInfo, link: MicrosoftSyncedCardRow | undefined) => {
      const description = meetingDescription(info, locale, timeZone);
      const descriptionHash = await sha256Hex(description);
      if (!link) {
        if (info.cancelled || info.startAt + DAY_MS < now) return;
        labelId ??= await ensureLabel(repo, row);
        const card = await createCard(repo, row.columnId, info.title, "meeting");
        await updateCard(repo, card.id, {
          description,
          due: dueOf(info, timeZone),
          labelIds: labelId ? [labelId] : [],
          // Outlook y Teams ya avisan de sus reuniones.
          reminders: [],
        });
        await db.insert(microsoftSyncedCards).values({
          id: newId(),
          syncId: row.id,
          cardId: card.id,
          eventId: info.eventId,
          title: info.title,
          startAt: info.startAt,
          allDay: info.allDay,
          descriptionHash,
          cancelled: false,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        });
        result.created++;
        return;
      }
      const card = await repo.getCard(link.cardId);
      if (!card) return;
      if (info.cancelled) {
        if (!link.cancelled) {
          if (!card.archivedAt) {
            await setArchived(repo, card.id, true);
            result.archived++;
          }
          await saveLink(link, { cancelled: true });
        }
        return;
      }
      // Solo se actualiza lo que sigue tal y como lo dejó Delyra.
      const patch: CardPatch = {};
      const linkPatch: Partial<MicrosoftSyncedCardRow> = {};
      if (info.title !== link.title && card.title === link.title) {
        patch.title = info.title;
        linkPatch.title = info.title;
      }
      if (
        (info.startAt !== link.startAt || info.allDay !== link.allDay) &&
        card.dueAt ===
          (link.allDay
            ? Date.parse(`${new Date(link.startAt).toISOString().slice(0, 10)}T00:00:00Z`)
            : link.startAt)
      ) {
        patch.due = dueOf(info, timeZone);
        linkPatch.startAt = info.startAt;
        linkPatch.allDay = info.allDay;
      }
      if (
        descriptionHash !== link.descriptionHash &&
        (await sha256Hex(card.description)) === link.descriptionHash
      ) {
        patch.description = description;
        linkPatch.descriptionHash = descriptionHash;
      }
      if (Object.keys(patch).length > 0) {
        await updateCard(repo, card.id, patch);
        result.updated++;
      }
      if (Object.keys(linkPatch).length > 0) await saveLink(link, linkPatch);
    };

    for (const info of events) await apply(info, byEvent.get(info.eventId));
    for (const [eventId, info] of lookups) {
      const link = byEvent.get(eventId);
      if (!link) continue;
      // Borrado en el calendario (o, si solo se vuelcan reuniones de Teams, ya no lo es).
      const gone = info === null || (row.onlyTeams && info.joinUrl === null);
      await apply(gone ? { ...(info ?? meetingFromLink(link)), cancelled: true } : info, link);
    }

    await db
      .update(microsoftBoardSyncs)
      .set({
        status: "ok",
        lastError: null,
        failures: 0,
        labelId,
        lastSyncedAt: now,
        nextSyncAt: now + MICROSOFT_SYNC_INTERVAL_MS,
        updatedAt: new Date(now),
      })
      .where(eq(microsoftBoardSyncs.id, row.id));
    if (result.created + result.updated + result.archived > 0)
      await notify(row.boardId, row.ownerId);
    return result;
  } catch (error) {
    if (!(error instanceof MicrosoftRevokedError)) {
      const failures = row.failures + 1;
      await db
        .update(microsoftBoardSyncs)
        .set({
          status: "error",
          lastError: microsoftSyncMessage(error),
          failures,
          nextSyncAt: now + Math.min(MICROSOFT_SYNC_INTERVAL_MS * 2 ** (failures - 1), DAY_MS),
          updatedAt: new Date(now),
        })
        .where(eq(microsoftBoardSyncs.id, row.id));
    }
    if (result.created + result.updated + result.archived > 0)
      await notify(row.boardId, row.ownerId);
    throw error;
  }
}

function meetingFromLink(link: MicrosoftSyncedCardRow): MeetingInfo {
  return {
    eventId: link.eventId,
    title: link.title,
    allDay: link.allDay,
    startAt: link.startAt,
    startDate: null,
    endAt: null,
    cancelled: true,
    joinUrl: null,
    location: null,
    organizer: null,
  };
}

/** Planificador (cada minuto): unos pocos tableros pendientes en cada pasada. */
export async function syncDueMicrosoftBoards(
  db: Database,
  keyring: Keyring,
  config: MicrosoftConfig | null,
  now: number,
  logger: Logger,
  notify: (boardId: string, by: string) => Promise<void>,
  limit = 6,
): Promise<number> {
  if (!config) return 0;
  const due = await db
    .select()
    .from(microsoftBoardSyncs)
    .where(lte(microsoftBoardSyncs.nextSyncAt, now))
    .orderBy(asc(microsoftBoardSyncs.nextSyncAt))
    .limit(limit);
  let synced = 0;
  for (const row of due) {
    const claimed = await db
      .update(microsoftBoardSyncs)
      .set({ nextSyncAt: now + CLAIM_MS })
      .where(
        and(eq(microsoftBoardSyncs.id, row.id), eq(microsoftBoardSyncs.nextSyncAt, row.nextSyncAt)),
      )
      .returning({ id: microsoftBoardSyncs.id });
    if (claimed.length !== 1) continue;
    try {
      const result = await syncBoard(db, keyring, config, row, now, notify);
      logger.info("microsoft_board_synced", { syncId: row.id, ...result });
      synced++;
    } catch (error) {
      logger.warn("microsoft_board_sync_failed", {
        syncId: row.id,
        error:
          error instanceof GraphError
            ? `graph ${String(error.status)}`
            : microsoftSyncMessage(error),
      });
    }
  }
  return synced;
}
