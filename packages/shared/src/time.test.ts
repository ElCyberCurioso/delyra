import { describe, expect, it } from "vitest";
import {
  dateOnlyToUtc,
  fromFloating,
  instantToWall,
  isValidDateOnly,
  startOfDayInZone,
  toFloating,
  utcToDateOnly,
  wallToInstant,
} from "./time";

const MADRID = "Europe/Madrid";

describe("hora local ↔ instante", () => {
  it("10:00 en Madrid es 09:00Z en invierno y 08:00Z en verano", () => {
    const winter = wallToInstant(
      { year: 2027, month: 1, day: 11, hour: 10, minute: 0, second: 0 },
      MADRID,
    );
    const summer = wallToInstant(
      { year: 2027, month: 6, day: 14, hour: 10, minute: 0, second: 0 },
      MADRID,
    );
    expect(new Date(winter).toISOString()).toBe("2027-01-11T09:00:00.000Z");
    expect(new Date(summer).toISOString()).toBe("2027-06-14T08:00:00.000Z");
    expect(instantToWall(summer, MADRID)).toMatchObject({ hour: 10, minute: 0 });
  });

  it("la hora inexistente de marzo avanza y la duplicada de octubre toma la primera", () => {
    const gap = wallToInstant(
      { year: 2027, month: 3, day: 28, hour: 2, minute: 30, second: 0 },
      MADRID,
    );
    expect(new Date(gap).toISOString()).toBe("2027-03-28T01:30:00.000Z");
    const overlap = wallToInstant(
      { year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 0 },
      MADRID,
    );
    expect(new Date(overlap).toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("resuelve igual en otras zonas, sea cual sea la zona del sistema", () => {
    const NY = "America/New_York";
    // 1 de noviembre de 2026, 01:30 ocurre dos veces: la primera es EDT (UTC−4).
    const overlap = wallToInstant(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 },
      NY,
    );
    expect(new Date(overlap).toISOString()).toBe("2026-11-01T05:30:00.000Z");
    // 14 de marzo de 2027, 02:30 no existe: pasa a las 03:30 EDT.
    const gap = wallToInstant(
      { year: 2027, month: 3, day: 14, hour: 2, minute: 30, second: 0 },
      NY,
    );
    expect(new Date(gap).toISOString()).toBe("2027-03-14T07:30:00.000Z");
    expect(instantToWall(gap, NY)).toMatchObject({ hour: 3, minute: 30 });
  });

  it("flotante: ida y vuelta conserva el instante", () => {
    const ms = Date.parse("2026-10-25T09:15:00Z");
    expect(new Date(toFloating(ms, MADRID)).toISOString()).toBe("2026-10-25T10:15:00.000Z");
    expect(fromFloating(toFloating(ms, MADRID), MADRID)).toBe(ms);
  });
});

describe("fechas sin hora", () => {
  it("convierte AAAA-MM-DD a medianoche UTC y rechaza fechas imposibles", () => {
    expect(utcToDateOnly(dateOnlyToUtc("2028-02-29"))).toBe("2028-02-29");
    expect(isValidDateOnly("2027-02-29")).toBe(false);
    expect(isValidDateOnly("2027-13-01")).toBe(false);
    expect(isValidDateOnly("27-01-01")).toBe(false);
  });

  it("el día empieza a la medianoche de la zona", () => {
    const start = startOfDayInZone(dateOnlyToUtc("2027-06-14"), MADRID);
    expect(new Date(start).toISOString()).toBe("2027-06-13T22:00:00.000Z");
  });
});
