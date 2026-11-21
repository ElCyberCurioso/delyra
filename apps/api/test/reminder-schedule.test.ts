import { dateOnlyToUtc } from "@delyra/shared";
import { describe, expect, it } from "vitest";
import type { Series } from "../src/lib/recurrence";
import { nextFireAt } from "../src/services/reminder-schedule";

const MADRID = "Europe/Madrid";
const at = (value: string) => Date.parse(value);
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

const weeklyMonday10: Series = {
  startAt: at("2026-10-19T08:00:00Z"), // lunes 10:00 CEST
  endAt: at("2026-10-19T09:00:00Z"),
  tz: MADRID,
  allDay: false,
  type: "event",
  rrule: "FREQ=WEEKLY",
  exdates: [],
};

describe("next_fire_at", () => {
  it("evento suelto: avisa antes del inicio y nunca en el pasado", () => {
    const single: Series = { ...weeklyMonday10, rrule: null };
    expect(iso(nextFireAt(single, [], 15, at("2026-10-01T00:00:00Z")))).toBe(
      "2026-10-19T07:45:00.000Z",
    );
    expect(nextFireAt(single, [], 15, at("2026-10-19T07:50:00Z"))).toBeNull();
  });

  it("serie semanal: la alerta respeta el cambio de horario de octubre", () => {
    // Tras la ocurrencia del 19 (CEST), la siguiente es el 26 a las 10:00 CET = 09:00Z.
    expect(iso(nextFireAt(weeklyMonday10, [], 15, at("2026-10-20T00:00:00Z")))).toBe(
      "2026-10-26T08:45:00.000Z",
    );
  });

  it("y el de marzo", () => {
    const march: Series = {
      ...weeklyMonday10,
      startAt: at("2027-03-22T09:00:00Z"),
      endAt: at("2027-03-22T10:00:00Z"),
    };
    expect(iso(nextFireAt(march, [], 60, at("2027-03-23T00:00:00Z")))).toBe(
      "2027-03-29T07:00:00.000Z", // 10:00 CEST − 1 h
    );
  });

  it("salta las ocurrencias borradas y usa el nuevo inicio de las movidas", () => {
    const series = { ...weeklyMonday10, exdates: [at("2026-10-26T09:00:00Z")] };
    expect(iso(nextFireAt(series, [], 0, at("2026-10-20T00:00:00Z")))).toBe(
      "2026-11-02T09:00:00.000Z",
    );
    const moved = [
      {
        originalStart: at("2026-10-26T09:00:00Z"),
        startAt: at("2026-10-27T15:00:00Z"),
        allDay: false,
      },
    ];
    expect(iso(nextFireAt(weeklyMonday10, moved, 0, at("2026-10-20T00:00:00Z")))).toBe(
      "2026-10-27T15:00:00.000Z",
    );
  });

  it("día completo: relativo a las 00:00 de la zona (el día anterior a las 9:00 y el mismo día)", () => {
    const start = dateOnlyToUtc("2027-05-17");
    const birthday: Series = {
      startAt: start,
      endAt: start + 86_400_000,
      tz: MADRID,
      allDay: true,
      type: "birthday",
      rrule: "FREQ=YEARLY",
      exdates: [],
    };
    const now = at("2027-05-01T00:00:00Z");
    expect(iso(nextFireAt(birthday, [], 15 * 60, now))).toBe("2027-05-16T07:00:00.000Z");
    expect(iso(nextFireAt(birthday, [], -9 * 60, now))).toBe("2027-05-17T07:00:00.000Z");
    // Pasado el cumpleaños, salta al año siguiente.
    expect(iso(nextFireAt(birthday, [], -9 * 60, at("2027-05-17T08:00:00Z")))).toBe(
      "2028-05-17T07:00:00.000Z",
    );
  });

  it("una serie terminada no vuelve a avisar", () => {
    const finished = { ...weeklyMonday10, rrule: "FREQ=WEEKLY;COUNT=2" };
    expect(nextFireAt(finished, [], 0, at("2026-10-27T00:00:00Z"))).toBeNull();
  });
});
