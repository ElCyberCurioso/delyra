import { z } from "zod";
import { localeSchema, timeZoneSchema } from "../constants";
import { idSchema } from "../ids";
import {
  CALENDAR_KINDS,
  EVENT_LIMITS,
  EVENT_TYPES,
  FEB29_RULES,
  REMINDER_CHANNELS,
} from "./calendar";
import { BOARD_TEMPLATES, CARD_PRIORITIES, KANBAN_LIMITS } from "./kanban";

/**
 * Copias de seguridad de usuario (Fase 6). Formato v1 (`docs/formato-backup.md`): un `.zip` con
 * `backup.json` (este esquema) y los adjuntos en `attachments/<id>`.
 *
 * Los `id` del fichero solo sirven para relacionar unas filas con otras dentro de la copia: al
 * restaurar se generan identificadores nuevos y el propietario es siempre quien restaura.
 */

export const BACKUP_FORMAT = "delyra-backup";
export const BACKUP_FORMAT_VERSION = 1;

export const BACKUP_KINDS = ["manual", "auto", "pre_restore"] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];
export const BACKUP_STATUSES = ["running", "ready", "failed"] as const;
export type BackupStatus = (typeof BACKUP_STATUSES)[number];
export const BACKUP_FREQUENCIES = ["off", "daily", "weekly", "monthly"] as const;
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];
export const RESTORE_MODES = ["merge", "replace"] as const;
export type RestoreMode = (typeof RESTORE_MODES)[number];
/**
 * - `validating`: el Workflow comprueba la copia (versión, checksum, referencias, tamaño).
 * - `ready`: vista previa lista; falta elegir fusionar o reemplazar.
 * - `restoring` → `succeeded` | `failed`. `undone`: se deshizo después.
 * - `expired`: no se empezó a tiempo y los datos temporales ya se borraron.
 */
export const RESTORE_STATUSES = [
  "validating",
  "ready",
  "restoring",
  "succeeded",
  "failed",
  "undone",
  "expired",
] as const;
export type RestoreStatus = (typeof RESTORE_STATUSES)[number];

/** Límites de una copia (F6-09): lo que se rechaza sin llegar a tocar datos. */
export const BACKUP_LIMITS = {
  /** Fichero subido para restaurar (zip o json). */
  uploadBytes: 200 * 1024 * 1024,
  /** `backup.json` descomprimido. */
  jsonBytes: 40 * 1024 * 1024,
  calendars: 100,
  events: 100_000,
  reminders: 200_000,
  boards: 200,
  columns: 3_000,
  labels: 5_000,
  cards: 50_000,
  checklist: 100_000,
  comments: 100_000,
  activity: 300_000,
  attachments: 5_000,
  /** Copias que se conservan: automáticas (configurable), manuales y previas a restaurar. */
  keepAutoMax: 12,
  keepManual: 10,
  keepPreRestore: 3,
} as const;

// ── Datos de la copia (v1) ───────────────────────────────────────────────────

const ref = z.string().min(1).max(64);
const ms = z.number().int().min(0).max(8_640_000_000_000);
const text = (max: number) => z.string().max(max);
const nullableText = (max: number) => z.string().max(max).nullable();
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const position = z.string().min(1).max(200);

export const backupDataV1Schema = z.object({
  profile: z.object({
    timeZone: timeZoneSchema,
    locale: localeSchema,
    weekStart: z.number().int().min(0).max(6),
  }),
  calendars: z
    .array(
      z.object({
        id: ref,
        name: text(60).min(1),
        color,
        kind: z.enum(CALENDAR_KINDS),
        visible: z.boolean(),
        position: z.number().int().min(0).max(1000),
      }),
    )
    .max(BACKUP_LIMITS.calendars),
  events: z
    .array(
      z.object({
        id: ref,
        calendarId: ref,
        type: z.enum(EVENT_TYPES),
        title: text(EVENT_LIMITS.title).min(1),
        notes: nullableText(EVENT_LIMITS.notes),
        location: nullableText(EVENT_LIMITS.location),
        url: z
          .string()
          .max(EVENT_LIMITS.url)
          .regex(/^https?:\/\/[^\s]+$/i)
          .nullable(),
        startAt: ms,
        endAt: ms,
        tz: timeZoneSchema,
        allDay: z.boolean(),
        rrule: z
          .string()
          .max(EVENT_LIMITS.rrule)
          .regex(/^[A-Z0-9=;,+-]+$/)
          .nullable(),
        exdates: z.array(ms).max(5_000),
        recurringEventId: ref.nullable(),
        originalStart: ms.nullable(),
        birthYear: z.number().int().min(1900).max(2200).nullable(),
        feb29Rule: z.enum(FEB29_RULES).nullable(),
        icalUid: nullableText(255),
        createdAt: ms,
        updatedAt: ms,
      }),
    )
    .max(BACKUP_LIMITS.events),
  eventReminders: z
    .array(
      z.object({
        eventId: ref,
        offsetMinutes: z
          .number()
          .int()
          .min(-24 * 60)
          .max(28 * 24 * 60),
        channel: z.enum(REMINDER_CHANNELS),
      }),
    )
    .max(BACKUP_LIMITS.reminders),
  boards: z
    .array(
      z.object({
        id: ref,
        name: text(KANBAN_LIMITS.boardName).min(1),
        template: z.enum(BOARD_TEMPLATES),
        autoarchiveDays: z.number().int().min(0).max(365),
        createdAt: ms,
        updatedAt: ms,
      }),
    )
    .max(BACKUP_LIMITS.boards),
  columns: z
    .array(
      z.object({
        id: ref,
        boardId: ref,
        name: text(KANBAN_LIMITS.columnName).min(1),
        position,
        wipLimit: z.number().int().min(1).max(999).nullable(),
        isDone: z.boolean(),
        createdAt: ms,
        updatedAt: ms,
      }),
    )
    .max(BACKUP_LIMITS.columns),
  labels: z
    .array(
      z.object({
        id: ref,
        boardId: ref,
        name: text(KANBAN_LIMITS.labelName).min(1),
        color,
        createdAt: ms,
      }),
    )
    .max(BACKUP_LIMITS.labels),
  cards: z
    .array(
      z.object({
        id: ref,
        boardId: ref,
        columnId: ref,
        title: text(KANBAN_LIMITS.cardTitle).min(1),
        description: text(KANBAN_LIMITS.description),
        position,
        priority: z.enum(CARD_PRIORITIES),
        dueAt: ms.nullable(),
        dueAllDay: z.boolean(),
        dueTz: timeZoneSchema.nullable(),
        completedAt: ms.nullable(),
        archivedAt: ms.nullable(),
        createdAt: ms,
        updatedAt: ms,
      }),
    )
    .max(BACKUP_LIMITS.cards),
  cardLabels: z.array(z.object({ cardId: ref, labelId: ref })).max(BACKUP_LIMITS.cards * 10),
  cardReminders: z
    .array(
      z.object({
        cardId: ref,
        offsetMinutes: z
          .number()
          .int()
          .min(-24 * 60)
          .max(28 * 24 * 60),
        channel: z.enum(REMINDER_CHANNELS),
      }),
    )
    .max(BACKUP_LIMITS.reminders),
  checklist: z
    .array(
      z.object({
        id: ref,
        cardId: ref,
        text: text(KANBAN_LIMITS.checklistText).min(1),
        done: z.boolean(),
        position,
        createdAt: ms,
      }),
    )
    .max(BACKUP_LIMITS.checklist),
  comments: z
    .array(
      z.object({
        id: ref,
        cardId: ref,
        body: text(KANBAN_LIMITS.comment).min(1),
        createdAt: ms,
        updatedAt: ms,
        /** F7-04: `false` si lo escribió otra persona (tablero compartido). Sin él: propio. */
        byOwner: z.boolean().optional(),
      }),
    )
    .max(BACKUP_LIMITS.comments),
  activity: z
    .array(
      z.object({
        id: ref,
        cardId: ref,
        kind: text(40).min(1),
        data: text(4_000),
        createdAt: ms,
        byOwner: z.boolean().optional(),
      }),
    )
    .max(BACKUP_LIMITS.activity),
  attachments: z
    .array(
      z.object({
        id: ref,
        cardId: ref,
        filename: text(120).min(1),
        contentType: text(120).min(1),
        size: z.number().int().min(0).max(KANBAN_LIMITS.attachmentBytes),
        /** SHA-256 en hexadecimal del contenido (`attachments/<id>` dentro del zip). */
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        createdAt: ms,
      }),
    )
    .max(BACKUP_LIMITS.attachments),
});
export type BackupDataV1 = z.infer<typeof backupDataV1Schema>;

/** `backup.json`. El checksum es el SHA-256 de `JSON.stringify(data)`. */
export const backupFileSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  format_version: z.number().int().min(1),
  exported_at: z.iso.datetime(),
  app_version: z.string().max(100).nullable(),
  checksum: z.object({
    algorithm: z.literal("sha256"),
    value: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  data: z.unknown(),
});
export type BackupFile = z.infer<typeof backupFileSchema>;

// ── API ──────────────────────────────────────────────────────────────────────

export const backupCountsSchema = z.object({
  calendars: z.number(),
  events: z.number(),
  boards: z.number(),
  cards: z.number(),
  attachments: z.number(),
});
export type BackupCounts = z.infer<typeof backupCountsSchema>;

export const userBackupSchema = z.object({
  id: z.string(),
  kind: z.enum(BACKUP_KINDS),
  status: z.enum(BACKUP_STATUSES),
  sizeBytes: z.number().nullable(),
  counts: backupCountsSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type UserBackupInfo = z.infer<typeof userBackupSchema>;

export const backupSettingsSchema = z.object({
  frequency: z.enum(BACKUP_FREQUENCIES),
  /** Copias automáticas que se conservan. */
  keep: z.number().int().min(1).max(BACKUP_LIMITS.keepAutoMax),
});
export type BackupSettings = z.infer<typeof backupSettingsSchema>;

export const restoreSchema = z.object({
  id: z.string(),
  status: z.enum(RESTORE_STATUSES),
  mode: z.enum(RESTORE_MODES).nullable(),
  filename: z.string().nullable(),
  /** Copia de la que se restaura (si no es un fichero subido). */
  backupId: z.string().nullable(),
  /** Copia hecha justo antes de restaurar: la que usa «Deshacer». */
  preBackupId: z.string().nullable(),
  /** Restauración que deshace a otra. */
  undoOf: z.string().nullable(),
  exportedAt: z.string().nullable(),
  counts: backupCountsSchema.nullable(),
  warnings: z.array(z.string()),
  progress: z.object({ done: z.number(), total: z.number() }),
  error: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type RestoreInfo = z.infer<typeof restoreSchema>;

export const backupsResponseSchema = z.object({
  backups: z.array(userBackupSchema),
  settings: backupSettingsSchema,
  restores: z.array(restoreSchema),
});
export const backupResponseSchema = z.object({ backup: userBackupSchema });
export const restoreResponseSchema = z.object({ restore: restoreSchema });

export const restoreFromBackupRequestSchema = z.object({ backupId: idSchema });
export const startRestoreRequestSchema = z.object({ mode: z.enum(RESTORE_MODES) });

// ── Backups del sistema (panel de admin, F6-06) ──────────────────────────────

export const systemBackupObjectSchema = z.object({
  key: z.string(),
  tier: z.enum(["daily", "weekly", "monthly"]),
  sizeBytes: z.number(),
  uploadedAt: z.string(),
});
export const systemBackupRunSchema = z.object({
  id: z.string(),
  trigger: z.enum(["schedule", "manual"]),
  status: z.enum(["running", "succeeded", "failed"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  r2Key: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  error: z.string().nullable(),
});
export const systemBackupsResponseSchema = z.object({
  runs: z.array(systemBackupRunSchema),
  objects: z.array(systemBackupObjectSchema),
});
export type SystemBackupObject = z.infer<typeof systemBackupObjectSchema>;
export type SystemBackupRunInfo = z.infer<typeof systemBackupRunSchema>;
