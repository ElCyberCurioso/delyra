import { addDays, dateOnlyToUtc, instantToWall, startOfDayInZone } from "@delyra/shared";
import type { Database } from "../db/client";
import { calendarRepository } from "../repositories/calendars";
import { eventRepository } from "../repositories/events";
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
