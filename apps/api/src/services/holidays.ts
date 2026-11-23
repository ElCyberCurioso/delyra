import {
  DEFAULT_HOLIDAY_REGION,
  type Holiday,
  type HolidayRegion,
  holidayRegionSchema,
  type Locale,
} from "@delyra/shared";
import { and, eq, gte, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import { publicHolidays, userSettings } from "../db/schema";
import type { Logger } from "../lib/logger";

/**
 * Festivos (F7-03). Se descargan de date.nager.at (servicio público y abierto; la petición no
 * lleva ningún dato del usuario), se guardan por año y se refrescan cada mes. Si el servicio no
 * responde y aún no hay datos de ese año, se calculan los nacionales fijos más el Viernes Santo.
 */

export const HOLIDAYS_URL = "https://date.nager.at/api/v3/PublicHolidays";
const COUNTRY = "ES";
const REFRESH_MS = 30 * 86_400_000;
const MAX_BYTES = 256 * 1024;

interface NagerHoliday {
  date?: unknown;
  localName?: unknown;
  name?: unknown;
  global?: unknown;
  counties?: unknown;
  types?: unknown;
}

/** Descarga los festivos de un año (solo los de tipo «Public»). */
export async function fetchHolidays(year: number, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`${HOLIDAYS_URL}/${String(year)}/${COUNTRY}`, {
    headers: { Accept: "application/json" },
    // Workers no admite `redirect: "error"`: con «manual», un 3xx no es `ok` y se trata como fallo.
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Festivos: HTTP ${String(response.status)}`);
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error("Festivos: respuesta demasiado grande");
  const items = JSON.parse(text) as unknown;
  if (!Array.isArray(items)) throw new Error("Festivos: formato inesperado");
  return (items as NagerHoliday[]).flatMap((item) => {
    const date = typeof item.date === "string" ? item.date : "";
    const name = typeof item.localName === "string" ? item.localName.slice(0, 120) : "";
    const nameEn = typeof item.name === "string" ? item.name.slice(0, 120) : null;
    const types = Array.isArray(item.types) ? item.types : [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(String(year)) || !name) return [];
    if (!types.includes("Public")) return [];
    const counties = Array.isArray(item.counties)
      ? item.counties.filter((c): c is string => typeof c === "string" && /^ES-[A-Z]{2}$/.test(c))
      : [];
    return [{ date, name, nameEn, regions: item.global === true ? "" : counties.sort().join(",") }];
  });
}

export async function storeHolidays(
  db: Database,
  year: number,
  rows: readonly { date: string; name: string; nameEn?: string | null; regions: string }[],
  now: number,
) {
  const statements = [
    db
      .delete(publicHolidays)
      .where(and(eq(publicHolidays.country, COUNTRY), eq(publicHolidays.year, year))),
    ...rows.map((row) =>
      db
        .insert(publicHolidays)
        .values({ country: COUNTRY, year, ...row, fetchedAt: now })
        .onConflictDoNothing(),
    ),
  ];
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
}

async function lastFetch(db: Database, year: number): Promise<number | null> {
  const [row] = await db
    .select({ fetchedAt: publicHolidays.fetchedAt })
    .from(publicHolidays)
    .where(and(eq(publicHolidays.country, COUNTRY), eq(publicHolidays.year, year)))
    .limit(1);
  return row?.fetchedAt ?? null;
}

/** Descarga los años que falten o estén viejos. Nunca falla: si no hay red, se queda como está. */
export async function ensureHolidays(
  db: Database,
  years: readonly number[],
  now: number,
  logger?: Logger,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  for (const year of years) {
    const fetched = await lastFetch(db, year);
    if (fetched !== null && now - fetched < REFRESH_MS) continue;
    try {
      const rows = await fetchHolidays(year, fetchImpl);
      if (rows.length > 0) await storeHolidays(db, year, rows, now);
    } catch (error) {
      logger?.warn("holidays_fetch_failed", {
        year,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// ── Respaldo sin red ─────────────────────────────────────────────────────────

/** Domingo de Pascua (algoritmo anónimo gregoriano). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const FIXED_NATIONAL: readonly [string, string, string][] = [
  ["01-01", "Año Nuevo", "New Year's Day"],
  ["01-06", "Epifanía del Señor", "Epiphany"],
  ["05-01", "Fiesta del Trabajo", "Labour Day"],
  ["08-15", "Asunción de la Virgen", "Assumption"],
  ["10-12", "Fiesta Nacional de España", "National Day"],
  ["11-01", "Todos los Santos", "All Saints Day"],
  ["12-06", "Día de la Constitución Española", "Constitution Day"],
  ["12-08", "Inmaculada Concepción", "Immaculate Conception"],
  ["12-25", "Natividad del Señor", "Christmas Day"],
];

export function nationalFallback(year: number, locale: Locale = "es"): Holiday[] {
  const goodFriday = new Date(easterSunday(year).getTime() - 2 * 86_400_000);
  return [
    ...FIXED_NATIONAL.map(([md, es, en]) => ({
      date: `${String(year)}-${md}`,
      name: locale === "en" ? en : es,
      regional: false,
    })),
    {
      date: goodFriday.toISOString().slice(0, 10),
      name: locale === "en" ? "Good Friday" : "Viernes Santo",
      regional: false,
    },
  ].sort((a, b) => a.date.localeCompare(b.date));
}

// ── Consulta ─────────────────────────────────────────────────────────────────

export async function holidayRegionOf(db: Database, ownerId: string): Promise<HolidayRegion> {
  const [row] = await db
    .select({ region: userSettings.holidayRegion })
    .from(userSettings)
    .where(eq(userSettings.userId, ownerId))
    .limit(1);
  const parsed = holidayRegionSchema.safeParse(row?.region);
  return parsed.success ? parsed.data : DEFAULT_HOLIDAY_REGION;
}

export async function setHolidayRegion(db: Database, ownerId: string, region: HolidayRegion) {
  await db
    .update(userSettings)
    .set({ holidayRegion: region, updatedAt: new Date() })
    .where(eq(userSettings.userId, ownerId));
}

/** Festivos entre dos fechas (`AAAA-MM-DD`, ambas incluidas) para una región, en un idioma. */
export async function holidaysBetween(
  db: Database,
  region: HolidayRegion,
  from: string,
  to: string,
  locale: Locale = "es",
): Promise<Holiday[]> {
  if (region === "off") return [];
  const rows = await db
    .select()
    .from(publicHolidays)
    .where(
      and(
        eq(publicHolidays.country, COUNTRY),
        gte(publicHolidays.date, from),
        lte(publicHolidays.date, to),
      ),
    );
  const years = new Set<number>();
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.add(y);
  const withData = new Set(rows.map((r) => r.year));
  const result: Holiday[] = rows
    .filter((r) => r.regions === "" || (region !== "ES" && r.regions.split(",").includes(region)))
    .map((r) => ({
      date: r.date,
      name: locale === "en" ? (r.nameEn ?? r.name) : r.name,
      regional: r.regions !== "",
    }));
  for (const year of years) {
    if (withData.has(year)) continue;
    result.push(...nationalFallback(year, locale).filter((h) => h.date >= from && h.date <= to));
  }
  // Sin duplicados (el mismo día puede venir como nacional y regional).
  const seen = new Set<string>();
  return result
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.regional) - Number(b.regional))
    .filter((h) => {
      const key = `${h.date}|${h.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
