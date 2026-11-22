import { Hono } from "hono";
import { createDb } from "../db/client";
import { AppError } from "../lib/errors";
import { eventRepository } from "../repositories/events";
import { calendarToIcs } from "../services/exports";
import { resolveFeed, touchFeed } from "../services/feeds";
import { getUserSettings } from "../services/users";
import type { AppEnv } from "../types";

/**
 * Feed ICS público por token (F7-02): `GET /api/feeds/<token>.ics`, sin sesión. Un token que no
 * existe responde 404 igual que uno con formato inválido. Solo lectura.
 */
export const feedRoutes = new Hono<AppEnv>().get("/:file", async (c) => {
  const file = c.req.param("file");
  const token = file.endsWith(".ics") ? file.slice(0, -4) : file;
  const db = createDb(c.env.DB);
  const found = await resolveFeed(db, token);
  if (!found) throw new AppError(404);
  const { feed, calendar } = found;
  const events = eventRepository(db, feed.ownerId);
  const rows = await events.allOfCalendar(calendar.id);
  const reminders = await events.remindersOfEvents(rows.map((r) => r.id));
  const settings = await getUserSettings(db, feed.ownerId);
  const now = Date.now();
  // Una vez por hora como mucho: los clientes consultan el feed a menudo.
  if (!feed.lastAccessedAt || now - feed.lastAccessedAt > 3_600_000) {
    c.executionCtx.waitUntil(touchFeed(db, feed.id, now));
  }
  return new Response(
    calendarToIcs(calendar, rows, reminders, settings?.timeZone ?? "Europe/Madrid", now),
    {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "private, max-age=300",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
});
