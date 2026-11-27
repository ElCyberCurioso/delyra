import { z } from "zod";
import { timeZoneSchema } from "../constants";
import { idSchema } from "../ids";
import { isValidDateOnly } from "../time";
import { emailSchema } from "./auth";
import { reminderInputSchema } from "./calendar";

/** Kanban de work.delyra.app (Fase 4). */

export const CARD_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type CardPriority = (typeof CARD_PRIORITIES)[number];

/** Tipo de tarjeta: qué representa (una tarea, una reunión pendiente, una llamada…). */
export const CARD_KINDS = ["task", "meeting", "call", "email", "errand", "note"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const BOARD_TEMPLATES = ["personal", "sprint", "audit", "empty"] as const;

/** Tableros compartidos (F7-04): papel de un miembro y papel de quien mira el tablero. */
export const BOARD_MEMBER_ROLES = ["editor", "reader"] as const;
export type BoardMemberRole = (typeof BOARD_MEMBER_ROLES)[number];
const BOARD_ROLES = ["owner", "editor", "reader"] as const;
export type BoardRole = (typeof BOARD_ROLES)[number];
export type BoardTemplate = (typeof BOARD_TEMPLATES)[number];

export const LABEL_COLORS = [
  "#eb5757",
  "#f2994a",
  "#f2c94c",
  "#27ae60",
  "#2f80ed",
  "#7c5cff",
  "#d6409f",
  "#8d6e63",
] as const;

export const KANBAN_LIMITS = {
  boardName: 80,
  columnName: 60,
  cardTitle: 300,
  /** Nombre de la persona a la que se ha pasado una tarjeta (columnas delegadas). */
  assignee: 80,
  description: 20_000,
  labelName: 40,
  checklistText: 300,
  comment: 5_000,
  columnsPerBoard: 30,
  cardsPerBoard: 2_000,
  labelsPerBoard: 50,
  checklistPerCard: 100,
  attachmentsPerCard: 20,
  /** Tamaño máximo de un adjunto (F4-06). */
  attachmentBytes: 10 * 1024 * 1024,
} as const;

/** Tipos de adjunto admitidos; el servidor los comprueba por su contenido, no por su nombre. */
export const ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

const name = (max: number, empty: string) =>
  z
    .string()
    .trim()
    .min(1, { error: empty })
    .max(max, { error: `Máximo ${String(max)} caracteres` });
const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, { error: "Color no válido" });

// ── Peticiones ─────────────────────────────────────────────────────────────────

export const createBoardRequestSchema = z.object({
  name: name(KANBAN_LIMITS.boardName, "Ponle un nombre"),
  template: z.enum(BOARD_TEMPLATES).default("personal"),
});

export const updateBoardRequestSchema = z
  .object({
    name: name(KANBAN_LIMITS.boardName, "Ponle un nombre"),
    /** Días tras los que se archivan las tarjetas terminadas (0 = nunca). */
    autoarchiveDays: z.number().int().min(0).max(365),
  })
  .partial();

export const columnRequestSchema = z.object({
  name: name(KANBAN_LIMITS.columnName, "Ponle un nombre"),
  wipLimit: z.number().int().min(1).max(999).nullable().default(null),
  isDone: z.boolean().default(false),
  /** Tareas que dependen de otra persona: al llevar una tarjeta aquí se pide a quién se pasa. */
  delegated: z.boolean().default(false),
});
export const updateColumnRequestSchema = columnRequestSchema.partial();

export const moveRequestSchema = z.object({ index: z.number().int().min(0).max(10_000) });

export const labelRequestSchema = z.object({
  name: name(KANBAN_LIMITS.labelName, "Ponle un nombre"),
  color: colorSchema,
});
export const updateLabelRequestSchema = labelRequestSchema.partial();

/** Fecha límite: `AAAA-MM-DD` (todo el día) o instante ISO. */
const dueSchema = z
  .object({
    allDay: z.boolean(),
    at: z.string().max(40),
    tz: timeZoneSchema,
  })
  .superRefine((value, ctx) => {
    const ok = value.allDay ? isValidDateOnly(value.at) : !Number.isNaN(Date.parse(value.at));
    if (!ok) ctx.addIssue({ code: "custom", path: ["at"], message: "Fecha no válida" });
  });

/** Nombre libre (no tiene que ser alguien de Delyra); vacío = sin asignar. */
const assigneeSchema = z
  .string()
  .trim()
  .max(KANBAN_LIMITS.assignee, { error: `Máximo ${String(KANBAN_LIMITS.assignee)} caracteres` })
  .transform((value) => (value === "" ? null : value))
  .nullable();

export const createCardRequestSchema = z.object({
  title: name(KANBAN_LIMITS.cardTitle, "Ponle un título"),
  kind: z.enum(CARD_KINDS).default("task"),
});

export const updateCardRequestSchema = z
  .object({
    title: name(KANBAN_LIMITS.cardTitle, "Ponle un título"),
    description: z.string().max(KANBAN_LIMITS.description),
    priority: z.enum(CARD_PRIORITIES),
    color: colorSchema.nullable(),
    due: dueSchema.nullable(),
    labelIds: z.array(idSchema).max(KANBAN_LIMITS.labelsPerBoard),
    reminders: z.array(reminderInputSchema).max(10),
    kind: z.enum(CARD_KINDS),
    assignee: assigneeSchema,
  })
  .partial();

export const moveCardRequestSchema = z.object({
  columnId: idSchema,
  index: z.number().int().min(0).max(10_000),
  /** Al llevarla a una columna delegada: a quién se le ha pasado. */
  assignee: assigneeSchema.optional(),
});

export const checklistItemRequestSchema = z.object({
  text: name(KANBAN_LIMITS.checklistText, "Escribe algo"),
});
export const updateChecklistItemRequestSchema = z
  .object({ text: name(KANBAN_LIMITS.checklistText, "Escribe algo"), done: z.boolean() })
  .partial();

export const commentRequestSchema = z.object({
  body: name(KANBAN_LIMITS.comment, "Escribe un comentario"),
});

// ── Respuestas ─────────────────────────────────────────────────────────────────

const iso = z.iso.datetime();

const boardSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  template: z.enum(BOARD_TEMPLATES),
  autoarchiveDays: z.number(),
  openCards: z.number(),
  createdAt: iso,
  /** Papel de quien lo mira (F7-04). */
  role: z.enum(BOARD_ROLES),
  /** Nombre del dueño si es un tablero compartido contigo; null si es tuyo. */
  ownerName: z.string().nullable(),
  /** Personas con acceso además del dueño. */
  members: z.number(),
});
export type BoardSummary = z.infer<typeof boardSummarySchema>;

const columnSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.string(),
  wipLimit: z.number().nullable(),
  isDone: z.boolean(),
  delegated: z.boolean(),
});
export type BoardColumn = z.infer<typeof columnSchema>;

const labelSchema = z.object({ id: z.string(), name: z.string(), color: z.string() });
export type CardLabel = z.infer<typeof labelSchema>;

const dueInfoSchema = z.object({ allDay: z.boolean(), at: z.string(), tz: z.string() });

const cardSummarySchema = z.object({
  id: z.string(),
  columnId: z.string(),
  title: z.string(),
  position: z.string(),
  priority: z.enum(CARD_PRIORITIES),
  kind: z.enum(CARD_KINDS),
  /** Persona a la que se ha pasado (columnas delegadas). */
  assignee: z.string().nullable(),
  color: z.string().nullable(),
  due: dueInfoSchema.nullable(),
  completedAt: iso.nullable(),
  archivedAt: iso.nullable(),
  labelIds: z.array(z.string()),
  checklist: z.object({ done: z.number(), total: z.number() }),
  comments: z.number(),
  attachments: z.number(),
  hasDescription: z.boolean(),
});
export type CardSummary = z.infer<typeof cardSummarySchema>;

export const boardDetailSchema = z.object({
  board: boardSummarySchema,
  columns: z.array(columnSchema),
  cards: z.array(cardSummarySchema),
  labels: z.array(labelSchema),
});
export type BoardDetail = z.infer<typeof boardDetailSchema>;

const cardDetailSchema = cardSummarySchema.extend({
  boardId: z.string(),
  description: z.string(),
  checklistItems: z.array(z.object({ id: z.string(), text: z.string(), done: z.boolean() })),
  commentList: z.array(
    z.object({
      id: z.string(),
      body: z.string(),
      createdAt: iso,
      updatedAt: iso,
      authorName: z.string().nullable(),
      /** Lo escribió quien mira: puede editarlo. */
      mine: z.boolean(),
    }),
  ),
  attachmentList: z.array(
    z.object({
      id: z.string(),
      filename: z.string(),
      contentType: z.string(),
      size: z.number(),
      createdAt: iso,
    }),
  ),
  activity: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      data: z.record(z.string(), z.unknown()),
      createdAt: iso,
      actorName: z.string().nullable(),
    }),
  ),
  reminders: z.array(
    z.object({ id: z.string(), offsetMinutes: z.number(), nextFireAt: iso.nullable() }),
  ),
});
export type CardDetail = z.infer<typeof cardDetailSchema>;

/** Tarjetas con fecha límite para la capa «Tareas» del calendario (F4-11). */
const dueCardSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  boardName: z.string(),
  title: z.string(),
  priority: z.enum(CARD_PRIORITIES),
  due: dueInfoSchema,
  completed: z.boolean(),
});
export type DueCard = z.infer<typeof dueCardSchema>;

// ── Envolturas de respuesta (validación en el cliente) ─────────────────────────

export const boardsResponseSchema = z.object({ boards: z.array(boardSummarySchema) });
export const cardResponseSchema = z.object({ card: cardDetailSchema });
export const moveCardResponseSchema = z.object({
  card: cardDetailSchema,
  wipExceeded: z.boolean(),
});
export const labelResponseSchema = z.object({ label: labelSchema });
const archivedCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  columnId: z.string(),
  archivedAt: iso.nullable(),
  completedAt: iso.nullable(),
});
export const archivedCardsResponseSchema = z.object({ cards: z.array(archivedCardSchema) });
export const dueCardsResponseSchema = z.object({ cards: z.array(dueCardSchema) });

// ── Tableros compartidos y tiempo real (F7-04, F7-05) ────────────────────────

export const BOARD_SHARING_LIMITS = { members: 20, invitationDays: 14 } as const;

const boardMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  role: z.enum(BOARD_ROLES),
  /** Solo lo ve el dueño (a quien invitó por email). */
  email: z.string().nullable(),
  you: z.boolean(),
});

const boardInvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(BOARD_MEMBER_ROLES),
  createdAt: iso,
  expiresAt: iso,
});

export const boardMembersResponseSchema = z.object({
  role: z.enum(BOARD_ROLES),
  members: z.array(boardMemberSchema),
  /** Pendientes de aceptar (solo para el dueño). */
  invitations: z.array(boardInvitationSchema),
});
export type BoardMembers = z.infer<typeof boardMembersResponseSchema>;

export const inviteToBoardRequestSchema = z.object({
  email: emailSchema,
  role: z.enum(BOARD_MEMBER_ROLES),
});
export const updateBoardMemberRequestSchema = z.object({ role: z.enum(BOARD_MEMBER_ROLES) });

const pendingBoardInvitationSchema = z.object({
  id: z.string(),
  boardName: z.string(),
  invitedBy: z.string().nullable(),
  role: z.enum(BOARD_MEMBER_ROLES),
  expiresAt: iso,
});
export type PendingBoardInvitation = z.infer<typeof pendingBoardInvitationSchema>;
export const pendingBoardInvitationsResponseSchema = z.object({
  invitations: z.array(pendingBoardInvitationSchema),
});
export const acceptedBoardInvitationSchema = z.object({ boardId: z.string() });

/** Mensajes del canal en vivo de un tablero (no llevan datos del tablero, solo avisos). */
export const boardLiveMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("changed"), by: z.string() }),
  z.object({
    type: z.literal("presence"),
    users: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
  /** Se le ha quitado el acceso a quien lo recibe (justo antes de cerrar su conexión). */
  z.object({ type: z.literal("revoked") }),
]);
export type BoardLiveMessage = z.infer<typeof boardLiveMessageSchema>;
