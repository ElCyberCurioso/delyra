import {
  createEventRequestSchema,
  EDIT_SCOPES,
  EVENT_LIMITS,
  eventsQuerySchema,
  idSchema,
  searchQuerySchema,
  updateEventRequestSchema,
} from "@delyra/shared";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db/client";
import { AppError } from "../lib/errors";
import { idParam, invalidField, readBody, readQuery } from "../lib/http";
import { currentAuth, requireActiveSession } from "../middleware/session";
import { calendarRepository } from "../repositories/calendars";
import { eventRepository, type RangeFilter } from "../repositories/events";
import {
  createEvent,
  deleteEvent,
  eventDetail,
  type EventContext,
  listOccurrences,
  searchEvents,
  updateEvent,
} from "../services/events";
import type { AppEnv } from "../types";

/** Eventos (F2-04, F2-05, F2-13). Las series se expanden en el servidor. */

function context(c: Context<AppEnv>): EventContext {
  const db = createDb(c.env.DB);
  const { user } = currentAuth(c);
  return { events: eventRepository(db, user.id), calendars: calendarRepository(db, user.id) };
}

function rangeFilter(query: { calendars?: string; type?: RangeFilter["type"] }): RangeFilter {
  const filter: RangeFilter = {};
  if (query.calendars !== undefined) {
    const ids = query.calendars.split(",").filter(Boolean);
    if (!ids.every((id) => idSchema.safeParse(id).success)) {
      throw invalidField("calendars", "Lista de calendarios no válida");
    }
    filter.calendarIds = ids;
  }
  if (query.type) filter.type = query.type;
  return filter;
}

const deleteQuerySchema = z.object({
  scope: z.enum(EDIT_SCOPES).default("all"),
  occurrence: z.string().max(40).optional(),
});

export const eventRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  .get("/", async (c) => {
    const query = readQuery(c, eventsQuerySchema);
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    if (!(to > from)) throw invalidField("to", "El fin debe ser posterior al inicio");
    if (to - from > EVENT_LIMITS.rangeDays * 86_400_000) {
      throw invalidField("to", `Como máximo ${String(EVENT_LIMITS.rangeDays)} días`);
    }
    const events = await listOccurrences(context(c), from, to, rangeFilter(query));
    return c.json({ events });
  })

  .get("/search", async (c) => {
    const query = readQuery(c, searchQuerySchema);
    return c.json({ events: await searchEvents(context(c), query.q, rangeFilter(query)) });
  })

  .get("/:id", async (c) => {
    const ctx = context(c);
    const row = await ctx.events.get(idParam(c));
    if (!row) throw new AppError(404);
    return c.json({ event: await eventDetail(ctx, row) });
  })

  .post("/", async (c) => {
    const body = await readBody(c, createEventRequestSchema);
    const ctx = context(c);
    const row = await createEvent(ctx, body);
    return c.json({ event: await eventDetail(ctx, row) }, 201);
  })

  .patch("/:id", async (c) => {
    const id = idParam(c);
    const body = await readBody(c, updateEventRequestSchema);
    const ctx = context(c);
    const row = await updateEvent(ctx, id, body);
    return c.json({ event: await eventDetail(ctx, row) });
  })

  .delete("/:id", async (c) => {
    const id = idParam(c);
    const query = readQuery(c, deleteQuerySchema);
    await deleteEvent(context(c), id, query.scope, query.occurrence);
    return c.body(null, 204);
  });
