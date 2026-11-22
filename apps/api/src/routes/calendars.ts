import { createCalendarRequestSchema, idSchema, updateCalendarRequestSchema } from "@delyra/shared";
import { type Context, Hono } from "hono";
import { createDb } from "../db/client";
import type { Calendar } from "../db/schema";
import { AppError } from "../lib/errors";
import { readBody } from "../lib/http";
import { currentAuth, requireActiveSession } from "../middleware/session";
import { calendarRepository } from "../repositories/calendars";
import { eventRepository } from "../repositories/events";
import type { AppEnv } from "../types";

/** Calendarios del usuario (F2-03). Un calendario ajeno responde 404, como uno inexistente. */

const MAX_CALENDARS = 50;

function repos(c: Context<AppEnv>) {
  const db = createDb(c.env.DB);
  const { user } = currentAuth(c);
  return { calendars: calendarRepository(db, user.id), events: eventRepository(db, user.id) };
}

function idParam(c: Context<AppEnv>): string {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) throw new AppError(404);
  return id.data;
}

const dto = (row: Calendar) => ({
  id: row.id,
  name: row.name,
  color: row.color,
  kind: row.kind,
  visible: row.visible,
  position: row.position,
  readOnly: row.readOnly,
});

export const calendarRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  .get("/", async (c) => {
    const { calendars } = repos(c);
    await calendars.ensureDefaults();
    return c.json({ calendars: (await calendars.list()).map(dto) });
  })

  .post("/", async (c) => {
    const body = await readBody(c, createCalendarRequestSchema);
    const { calendars } = repos(c);
    if ((await calendars.count()) >= MAX_CALENDARS) {
      throw new AppError(409, {
        detail: `Has llegado al máximo de ${String(MAX_CALENDARS)} calendarios`,
      });
    }
    return c.json({ calendar: dto(await calendars.create(body)) }, 201);
  })

  .patch("/:id", async (c) => {
    const id = idParam(c);
    const body = await readBody(c, updateCalendarRequestSchema);
    const row = await repos(c).calendars.update(id, body);
    if (!row) throw new AppError(404);
    return c.json({ calendar: dto(row) });
  })

  .delete("/:id", async (c) => {
    const id = idParam(c);
    const { calendars, events } = repos(c);
    if (!(await calendars.get(id))) throw new AppError(404);
    if ((await calendars.count()) <= 1) {
      throw new AppError(409, { detail: "Necesitas al menos un calendario" });
    }
    await events.deleteRemindersOfCalendar(id);
    await calendars.remove(id);
    return c.body(null, 204);
  });
