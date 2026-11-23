import { type BackupDataV1, fromFloating, toFloating } from "@delyra/shared";
import type { Calendar, EventRow, Reminder } from "../db/schema";

/**
 * Exportaciones sueltas (F6-02): un calendario en ICS (RFC 5545) y un tablero en CSV o JSON.
 * El ICS se puede volver a importar en Delyra (F5-01) o en Google, Apple u Outlook.
 */

const CRLF = "\r\n";

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Pliega a 75 octetos (UTF-8) como pide RFC 5545, sin partir un carácter. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function basic(ms: number, withTime: boolean, utc: boolean): string {
  const d = new Date(ms);
  const date = `${String(d.getUTCFullYear())}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  if (!withTime) return date;
  return `${date}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}${utc ? "Z" : ""}`;
}

/** `DTSTART;VALUE=DATE:20261224` o `DTSTART;TZID=Europe/Madrid:20261224T100000`. */
function timeProperty(name: string, ms: number, allDay: boolean, tz: string): string {
  if (allDay) return `${name};VALUE=DATE:${basic(ms, false, false)}`;
  return `${name};TZID=${tz}:${basic(toFloating(ms, tz), true, false)}`;
}

/** La RRULE se guarda con UNTIL en hora flotante; en el ICS va en UTC (o como fecha). */
function exportRrule(rrule: string, allDay: boolean, tz: string): string {
  return rrule
    .split(";")
    .map((part) => {
      const match = /^UNTIL=(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(part);
      if (!match) return part;
      const [, y, mo, d, h, mi, s] = match.map(Number);
      const floating = Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0);
      return allDay
        ? `UNTIL=${basic(floating, false, false)}`
        : `UNTIL=${basic(fromFloating(floating, tz), true, true)}`;
    })
    .join(";");
}

function parseExdates(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === "number") : [];
  } catch {
    return [];
  }
}

export function calendarToIcs(
  calendar: Pick<Calendar, "name" | "color">,
  rows: readonly EventRow[],
  reminders: readonly Pick<Reminder, "targetId" | "offsetMinutes">[],
  timeZone: string,
  now = Date.now(),
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Delyra//Calendario//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendar.name)}`,
    `X-WR-TIMEZONE:${timeZone}`,
    `COLOR:${calendar.color}`,
  ];
  const masters = new Map(rows.filter((r) => r.recurringEventId === null).map((r) => [r.id, r]));
  const uidOf = (row: EventRow) => row.icalUid ?? `${row.id}@delyra.app`;
  const remindersOf = new Map<string, number[]>();
  for (const r of reminders) {
    remindersOf.set(r.targetId, [...(remindersOf.get(r.targetId) ?? []), r.offsetMinutes]);
  }

  for (const row of rows) {
    const master = row.recurringEventId === null ? row : masters.get(row.recurringEventId);
    if (!master) continue;
    const birthday = row.type === "birthday";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(uidOf(master))}`,
      `DTSTAMP:${basic(now, true, true)}`,
      timeProperty("DTSTART", row.startAt, row.allDay, row.tz),
      timeProperty("DTEND", row.endAt, row.allDay, row.tz),
      `SUMMARY:${escapeText(row.title)}`,
    );
    if (row.notes) lines.push(`DESCRIPTION:${escapeText(row.notes)}`);
    if (row.location) lines.push(`LOCATION:${escapeText(row.location)}`);
    if (row.url) lines.push(`URL:${row.url}`);
    if (row.recurringEventId !== null && row.originalStart !== null) {
      lines.push(timeProperty("RECURRENCE-ID", row.originalStart, master.allDay, master.tz));
    } else if (birthday) {
      lines.push("RRULE:FREQ=YEARLY", "CATEGORIES:Cumpleaños");
    } else if (row.rrule) {
      lines.push(`RRULE:${exportRrule(row.rrule, row.allDay, row.tz)}`);
      for (const exdate of parseExdates(row.exdates)) {
        lines.push(timeProperty("EXDATE", exdate, row.allDay, row.tz));
      }
    }
    if (row.recurringEventId === null) {
      for (const offset of remindersOf.get(row.id) ?? []) {
        lines.push(
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          `DESCRIPTION:${escapeText(row.title)}`,
          offset >= 0 ? `TRIGGER:-PT${String(offset)}M` : `TRIGGER:PT${String(-offset)}M`,
          "END:VALARM",
        );
      }
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join(CRLF) + CRLF;
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/**
 * Celda CSV (RFC 4180). Lo que empieza por `=`, `+`, `-`, `@`, tabulador o retorno se precede de
 * un apóstrofo: una hoja de cálculo no lo ejecutará como fórmula (inyección CSV).
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly (readonly (string | number | boolean | null)[])[]): string {
  // BOM: Excel reconoce así el UTF-8 (acentos).
  return String.fromCharCode(0xfeff) + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

// ── Tablero (JSON y CSV) ─────────────────────────────────────────────────────

const PRIORITY_NAMES: Record<string, string> = {
  none: "",
  low: "Baja",
  medium: "Media",
  high: "Alta",
  urgent: "Urgente",
};

const byPosition = <T extends { position: string }>(a: T, b: T) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

/** Un tablero legible y autocontenido (sin ids internos) a partir de los datos de la copia. */
export function boardExport(data: BackupDataV1, boardId: string) {
  const board = data.boards.find((b) => b.id === boardId);
  if (!board) return null;
  const labels = data.labels.filter((l) => l.boardId === boardId);
  const labelName = new Map(labels.map((l) => [l.id, l.name]));
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  const columns = data.columns
    .filter((c) => c.boardId === boardId)
    .sort(byPosition)
    .map((column) => ({
      name: column.name,
      isDone: column.isDone,
      wipLimit: column.wipLimit,
      cards: data.cards
        .filter((card) => card.columnId === column.id)
        .sort(byPosition)
        .map((card) => ({
          title: card.title,
          description: card.description,
          priority: card.priority,
          color: card.color,
          due:
            card.dueAt === null
              ? null
              : card.dueAllDay
                ? iso(card.dueAt)?.slice(0, 10)
                : iso(card.dueAt),
          completedAt: iso(card.completedAt),
          archivedAt: iso(card.archivedAt),
          createdAt: iso(card.createdAt),
          labels: data.cardLabels
            .filter((l) => l.cardId === card.id)
            .map((l) => labelName.get(l.labelId) ?? ""),
          checklist: data.checklist
            .filter((i) => i.cardId === card.id)
            .sort(byPosition)
            .map((i) => ({ text: i.text, done: i.done })),
          comments: data.comments
            .filter((c) => c.cardId === card.id)
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((c) => ({ body: c.body, createdAt: iso(c.createdAt) })),
          attachments: data.attachments
            .filter((a) => a.cardId === card.id)
            .map((a) => ({ filename: a.filename, size: a.size })),
        })),
    }));
  return {
    format: "delyra-board",
    exportedAt: new Date().toISOString(),
    board: { name: board.name, template: board.template },
    labels: labels.map((l) => ({ name: l.name, color: l.color })),
    columns,
  };
}

export function boardCsv(board: NonNullable<ReturnType<typeof boardExport>>): string {
  const rows: (string | number | boolean | null)[][] = [
    [
      "Columna",
      "Título",
      "Descripción",
      "Prioridad",
      "Fecha límite",
      "Etiquetas",
      "Checklist",
      "Completada",
      "Archivada",
      "Creada",
    ],
  ];
  for (const column of board.columns) {
    for (const card of column.cards) {
      const done = card.checklist.filter((i) => i.done).length;
      rows.push([
        column.name,
        card.title,
        card.description,
        PRIORITY_NAMES[card.priority] ?? "",
        card.due ?? "",
        card.labels.join(", "),
        card.checklist.length > 0 ? `${String(done)}/${String(card.checklist.length)}` : "",
        card.completedAt ?? "",
        card.archivedAt ?? "",
        card.createdAt ?? "",
      ]);
    }
  }
  return toCsv(rows);
}
