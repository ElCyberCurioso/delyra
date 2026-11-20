import { describe, expect, it } from "vitest";
import { isValidTimeZone, SUGGESTED_TIME_ZONES, timeZoneSchema } from "./constants";
import { formatUtcDate, toIsoUtc } from "./dates";

describe("isValidTimeZone", () => {
  it("acepta zonas IANA", () => {
    for (const tz of SUGGESTED_TIME_ZONES) expect(isValidTimeZone(tz)).toBe(true);
  });

  it.each(["+01:00", "CET1", "Europe/Atlantis", "../../etc/passwd", "", "europe/madrid"])(
    "rechaza %s",
    (tz) => {
      expect(isValidTimeZone(tz)).toBe(false);
    },
  );

  it("se integra en el esquema Zod", () => {
    expect(timeZoneSchema.safeParse("Europe/Madrid").success).toBe(true);
    expect(timeZoneSchema.safeParse("Mars/Olympus").success).toBe(false);
  });
});

describe("fechas", () => {
  it("formatea en UTC aunque la hora local sea otro día", () => {
    expect(formatUtcDate(Date.UTC(2026, 2, 29, 23, 30))).toBe("2026-03-29");
    expect(toIsoUtc(Date.UTC(2026, 9, 25, 1, 0))).toBe("2026-10-25T01:00:00.000Z");
  });

  it("rechaza fechas inválidas", () => {
    expect(() => formatUtcDate(new Date("no"))).toThrow(RangeError);
  });
});
