import {
  addDays,
  dateOnlyToUtc,
  instantToWall,
  startOfDayInZone,
  utcToDateOnly,
} from "@delyra/shared";
import type { Database } from "../db/client";
import { calendarRepository } from "../repositories/calendars";
import { eventRepository } from "../repositories/events";
import { kanbanRepository } from "../repositories/kanban";
import { listOccurrences } from "./events";

/** Agenda de un usuario por días locales (comandos del bot y resumen diario, F3-08 y F3-09). */

const pad = (n: number) => String(n).padStart(2, "0");

export function localToday(now: number, timeZone: string): string {
  const w = instantToWall(now, timeZone);
  return `${String(w.year)}-${pad(w.month)}-${pad(w.day)}`;
}

export async function agendaFor(
  db: Database,
  ownerId: string,
  timeZone: string,
  firstDay: string,
  days: number,
) {
  const calendars = calendarRepository(db, ownerId);
  const ctx = { events: eventRepository(db, ownerId), calendars };
  const fromUtc = dateOnlyToUtc(firstDay);
  const from = startOfDayInZone(fromUtc, timeZone);
  const to = startOfDayInZone(addDays(fromUtc, days), timeZone);
  const list = await calendars.list();
  const visible = new Set(list.filter((c) => c.visible).map((c) => c.id));
  const occurrences = (await listOccurrences(ctx, from, to, {})).filter((o) =>
    visible.has(o.calendarId),
  );
  return { occurrences, calendarNames: new Map(list.map((c) => [c.id, c.name])) };
}

export interface TaskItem {
  title: string;
  boardName: string;
  /** Día local de la fecha límite (YYYY-MM-DD). */
  date: string;
  /** Instante de la fecha límite; en las de todo el día, la medianoche UTC del día. */
  dueAt: number;
  allDay: boolean;
  overdue: boolean;
}

/**
 * Tareas abiertas que vencen antes de que acabe `lastDay` (en la zona del usuario), vencidas
 * incluidas (F4-11). Las de columnas «hecho» no cuentan aunque no tengan `completed_at`.
 */
export async function tasksUntil(
  db: Database,
  ownerId: string,
  timeZone: string,
  lastDay: string,
  now: number,
): Promise<TaskItem[]> {
  const today = localToday(now, timeZone);
  const end = utcToDateOnly(addDays(dateOnlyToUtc(lastDay), 1));
  // Margen de un día: las de todo el día se guardan a medianoche UTC, no en la zona local.
  const before = Math.max(dateOnlyToUtc(end), startOfDayInZone(dateOnlyToUtc(end), timeZone));
  const rows = await kanbanRepository(db, ownerId).openTasks(before + 86_400_000);
  const items: TaskItem[] = [];
  for (const { card, boardName, isDone } of rows) {
    if (isDone || card.dueAt === null) continue;
    const date = card.dueAllDay ? utcToDateOnly(card.dueAt) : localToday(card.dueAt, timeZone);
    if (date >= end) continue;
    items.push({
      title: card.title,
      boardName,
      date,
      dueAt: card.dueAt,
      allDay: card.dueAllDay,
      overdue: card.dueAllDay ? date < today : card.dueAt < now,
    });
  }
  return items;
}
