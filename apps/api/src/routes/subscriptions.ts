import { CALENDAR_COLORS, createSubscriptionRequestSchema, idSchema } from "@delyra/shared";
import { type Context, Hono } from "hono";
import { createDb } from "../db/client";
import { AppError } from "../lib/errors";
import { keyringFromEnv } from "../lib/field-crypto";
import { readBody } from "../lib/http";
import { currentAuth, requireActiveSession } from "../middleware/session";
import { calendarRepository } from "../repositories/calendars";
import { eventRepository } from "../repositories/events";
import { subscriptionRepository } from "../repositories/subscriptions";
import {
  createSubscription,
  MANUAL_SYNC_MIN_MS,
  subscriptionDto,
  syncSubscription,
} from "../services/subscriptions";
import type { AppEnv } from "../types";

/** Suscripciones a la dirección iCal secreta de Google (F5-06). */

function idParam(c: Context<AppEnv>): string {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) throw new AppError(404);
  return id.data;
}

function deps(c: Context<AppEnv>) {
  const db = createDb(c.env.DB);
  const ownerId = currentAuth(c).user.id;
  return { db, ownerId, repo: subscriptionRepository(db, ownerId) };
}

export const subscriptionRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  .get("/", async (c) => {
    const { db, repo } = deps(c);
    const rows = await repo.list();
    return c.json({
      subscriptions: await Promise.all(rows.map((row) => subscriptionDto(db, row))),
    });
  })

  .post("/", async (c) => {
    const body = await readBody(c, createSubscriptionRequestSchema);
    const { db, ownerId, repo } = deps(c);
    const color =
      body.color ?? CALENDAR_COLORS[(await repo.count()) % CALENDAR_COLORS.length] ?? "#7c5cff";
    const { subscription } = await createSubscription(
      db,
      await keyringFromEnv(c.env),
      ownerId,
      { url: body.url, name: body.name, color },
      Date.now(),
    );
    return c.json({ subscription: await subscriptionDto(db, subscription) }, 201);
  })

  .post("/:id/sync", async (c) => {
    const { db, repo } = deps(c);
    const row = await repo.get(idParam(c));
    if (!row) throw new AppError(404);
    const now = Date.now();
    if (row.lastSyncedAt !== null && now - row.lastSyncedAt < MANUAL_SYNC_MIN_MS) {
      throw new AppError(429, { detail: "Se acaba de sincronizar. Espera unos minutos." });
    }
    // El error ya queda registrado en la suscripción (estado y mensaje).
    await syncSubscription(db, await keyringFromEnv(c.env), row, now).catch(() => null);
    const saved = (await repo.get(row.id)) ?? row;
    return c.json({ subscription: await subscriptionDto(db, saved) });
  })

  .delete("/:id", async (c) => {
    const { db, ownerId, repo } = deps(c);
    const row = await repo.get(idParam(c));
    if (!row) throw new AppError(404);
    // Al borrar el calendario se van, en cascada, la suscripción y sus eventos.
    await eventRepository(db, ownerId).deleteRemindersOfCalendar(row.calendarId);
    await calendarRepository(db, ownerId).remove(row.calendarId);
    return c.body(null, 204);
  });
