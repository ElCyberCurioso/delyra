import { joinInstant } from "@delyra/shared";
import { describe, expect, it } from "vitest";
import { fromRrule, toRrule } from "./presets";
import { fromCalendarDate, shiftSeries, splitInstant, toCalendarTime, wallDelta } from "./time";

const MADRID = "Europe/Madrid";

describe("repetición ↔ RRULE", () => {
  // 23 de noviembre de 2026 es lunes.
  const start = "2026-11-23";

  it.each([
    ["daily", "FREQ=DAILY"],
    ["weekdays", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
    ["weekly", "FREQ=WEEKLY;BYDAY=MO"],
    ["monthly", "FREQ=MONTHLY;BYMONTHDAY=23"],
    ["yearly", "FREQ=YEARLY"],
  ] as const)("%s ↔ %s", (preset, rrule) => {
    expect(toRrule({ preset, end: { kind: "never" }, custom: "" }, start)).toBe(rrule);
    expect(fromRrule(rrule, start)).toEqual({ preset, end: { kind: "never" }, custom: "" });
  });

  it("conserva el final por fecha o por número de veces", () => {
    const until = {
      preset: "weekly",
      end: { kind: "until", date: "2027-01-31" },
      custom: "",
    } as const;
    expect(toRrule(until, start)).toBe("FREQ=WEEKLY;BYDAY=MO;UNTIL=20270131T235959Z");
    expect(fromRrule("FREQ=WEEKLY;BYDAY=MO;UNTIL=20270131T235959Z", start)).toEqual(until);
    expect(fromRrule("FREQ=DAILY;COUNT=5", start).end).toEqual({ kind: "count", count: 5 });
  });

  it("lo que no encaja con un ajuste se edita como regla avanzada", () => {
    expect(fromRrule("FREQ=MONTHLY;BYDAY=-1FR", start)).toEqual({
      preset: "custom",
      end: { kind: "never" },
      custom: "FREQ=MONTHLY;BYDAY=-1FR",
    });
    expect(toRrule({ preset: "none", end: { kind: "never" }, custom: "" }, start)).toBeNull();
  });
});

describe("zona horaria del usuario en FullCalendar", () => {
  it("pasa la hora de pared y vuelve al mismo instante, también en verano", () => {
    for (const instant of ["2027-01-11T09:00:00.000Z", "2027-07-12T08:00:00.000Z"]) {
      const wall = toCalendarTime(instant, false, MADRID);
      expect(wall.slice(11, 16)).toBe("10:00");
      expect(fromCalendarDate(new Date(wall), false, MADRID)).toBe(instant);
    }
  });

  it("los días completos no cambian", () => {
    expect(toCalendarTime("2027-08-02", true, MADRID)).toBe("2027-08-02");
    expect(fromCalendarDate(new Date("2027-08-02T00:00:00Z"), true, MADRID)).toBe("2027-08-02");
  });

  it("los campos del editor son la hora local", () => {
    expect(splitInstant("2027-03-29T08:00:00.000Z", MADRID)).toEqual({
      date: "2027-03-29",
      time: "10:00",
    });
    expect(joinInstant("2027-03-29", "10:00", MADRID)).toBe("2027-03-29T08:00:00.000Z");
  });

  it("mover «todos» desde una ocurrencia desplaza la serie en hora de pared", () => {
    // Serie que empezó en invierno (10:00 CET); se mueve una ocurrencia de verano 1 h más tarde.
    const delta = wallDelta("2027-07-12T08:00:00.000Z", "2027-07-12T09:00:00.000Z", false, MADRID);
    const shifted = shiftSeries(
      {
        start: "2027-01-11T09:00:00.000Z",
        end: "2027-01-11T10:00:00.000Z",
        allDay: false,
        tz: MADRID,
      },
      delta,
    );
    expect(shifted).toEqual({ start: "2027-01-11T10:00:00.000Z", end: "2027-01-11T11:00:00.000Z" });
  });
});
