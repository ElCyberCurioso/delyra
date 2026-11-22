import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Festivos oficiales (F7-03), comunes a todos los usuarios: no son datos de nadie. Se descargan
 * de date.nager.at una vez por año y se refrescan cada mes.
 */
export const publicHolidays = sqliteTable(
  "public_holidays",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    country: text("country").notNull(),
    year: integer("year").notNull(),
    /** `AAAA-MM-DD` */
    date: text("date").notNull(),
    name: text("name").notNull(),
    /** Comunidades separadas por comas (`ES-MD,ES-CL`); vacío = nacional. */
    regions: text("regions").notNull().default(""),
    fetchedAt: integer("fetched_at").notNull(),
  },
  (t) => [
    index("public_holidays_lookup_idx").on(t.country, t.date),
    uniqueIndex("public_holidays_unique_idx").on(t.country, t.date, t.name, t.regions),
    index("public_holidays_year_idx").on(t.country, t.year),
  ],
);

export type PublicHoliday = typeof publicHolidays.$inferSelect;
