import { z } from "zod";

/** Festivos (F7-03): nacionales de España y, opcionalmente, los de una comunidad autónoma. */

export const HOLIDAY_REGIONS = [
  { code: "off", name: "Sin festivos" },
  { code: "ES", name: "Solo nacionales" },
  { code: "ES-AN", name: "Andalucía" },
  { code: "ES-AR", name: "Aragón" },
  { code: "ES-AS", name: "Asturias" },
  { code: "ES-IB", name: "Baleares" },
  { code: "ES-CN", name: "Canarias" },
  { code: "ES-CB", name: "Cantabria" },
  { code: "ES-CL", name: "Castilla y León" },
  { code: "ES-CM", name: "Castilla-La Mancha" },
  { code: "ES-CT", name: "Cataluña" },
  { code: "ES-CE", name: "Ceuta" },
  { code: "ES-EX", name: "Extremadura" },
  { code: "ES-GA", name: "Galicia" },
  { code: "ES-RI", name: "La Rioja" },
  { code: "ES-MD", name: "Comunidad de Madrid" },
  { code: "ES-ML", name: "Melilla" },
  { code: "ES-MC", name: "Región de Murcia" },
  { code: "ES-NC", name: "Navarra" },
  { code: "ES-PV", name: "País Vasco" },
  { code: "ES-VC", name: "Comunidad Valenciana" },
] as const;

export type HolidayRegion = (typeof HOLIDAY_REGIONS)[number]["code"];
export const DEFAULT_HOLIDAY_REGION: HolidayRegion = "ES-MD";

const codes = HOLIDAY_REGIONS.map((r) => r.code) as [HolidayRegion, ...HolidayRegion[]];
export const holidayRegionSchema = z.enum(codes);

export const holidaysQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const holidaySchema = z.object({
  /** `AAAA-MM-DD` */
  date: z.string(),
  name: z.string(),
  /** De la comunidad (no nacional). */
  regional: z.boolean(),
});
export type Holiday = z.infer<typeof holidaySchema>;

export const holidaysResponseSchema = z.object({
  region: holidayRegionSchema,
  holidays: z.array(holidaySchema),
});

export const updateHolidayRegionRequestSchema = z.object({ region: holidayRegionSchema });
