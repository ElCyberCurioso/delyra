import { holidaysQuerySchema, updateHolidayRegionRequestSchema } from "@delyra/shared";
import { Hono } from "hono";
import { createDb } from "../db/client";
import { invalidField, readBody, readQuery } from "../lib/http";
import { currentAuth, requireActiveSession } from "../middleware/session";
import {
  ensureHolidays,
  holidayRegionOf,
  holidaysBetween,
  setHolidayRegion,
} from "../services/holidays";
import type { AppEnv } from "../types";
import { requestLocale } from "../lib/locale";

/** Festivos de la región elegida (F7-03), como capa de solo lectura del calendario. */

const MAX_RANGE_DAYS = 400;

export const holidayRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  .get("/", async (c) => {
    const query = readQuery(c, holidaysQuerySchema);
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
      throw invalidField("to", "Rango no válido");
    }
    if (to - from > MAX_RANGE_DAYS * 86_400_000) {
      throw invalidField("to", `Como máximo ${String(MAX_RANGE_DAYS)} días`);
    }
    const db = createDb(c.env.DB);
    const region = await holidayRegionOf(db, currentAuth(c).user.id);
    if (region !== "off") {
      const years = [];
      for (let y = Number(query.from.slice(0, 4)); y <= Number(query.to.slice(0, 4)); y++)
        years.push(y);
      // Si falta algún año, se intenta descargar en el momento (y si falla, se usa el respaldo).
      await ensureHolidays(db, years, Date.now(), c.get("logger"));
    }
    const locale = requestLocale(c.req.header("accept-language"));
    return c.json({
      region,
      holidays: await holidaysBetween(db, region, query.from, query.to, locale),
    });
  })

  .put("/region", async (c) => {
    const body = await readBody(c, updateHolidayRegionRequestSchema);
    await setHolidayRegion(createDb(c.env.DB), currentAuth(c).user.id, body.region);
    return c.json({ region: body.region });
  });
