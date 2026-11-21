import { dateOnlyToUtc } from "@delyra/shared";
import { describe, expect, it } from "vitest";
import {
  checkRrule,
  expandSeries,
  isOccurrenceStart,
  occurrencesAfter,
  type Series,
  seriesEnd,
  splitRule,
} from "../src/lib/recurrence";

const MADRID = "Europe/Madrid";
const iso = (ms: number) => new Date(ms).toISOString();
const at = (value: string) => Date.parse(value);

function weekly(start: string, rrule = "FREQ=WEEKLY", minutes = 60): Series {
  const startAt = at(start);
  return {
    startAt,
    endAt: startAt + minutes * 60_000,
    tz: MADRID,
    allDay: false,
    type: "event",
    rrule,
    exdates: [],
  };
}

describe("validación de RRULE", () => {
  it("normaliza reglas válidas", () => {
    expect(checkRrule("FREQ=WEEKLY;BYDAY=MO,WE")).toEqual({
      ok: true,
      rrule: "FREQ=WEEKLY;BYDAY=MO,WE",
    });
  });

  it.each([
    ["FREQ=MINUTELY", /diaria, semanal/],
    ["FREQ=HOURLY;INTERVAL=1", /diaria, semanal/],
    ["FREQ=DAILY;COUNT=5000", /Como máximo/],
    ["FREQ=DAILY;BYHOUR=10", /no admitida/],
    ["FREQ=DAILY;DTSTART=20260101T100000Z", /no admitida/],
    ["FREQ=DAILY;COUNT=3;UNTIL=20270101T000000Z", /COUNT o UNTIL/],
    ["FREQ=NUNCA", /diaria, semanal/],
    ["INTERVAL=2", /diaria, semanal/],
  ])("rechaza %s", (rrule, message) => {
    const result = checkRrule(rrule);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });
});

describe("cambios de horario en Europe/Madrid", () => {
  it("una cita semanal a las 10:00 sigue a las 10:00 tras el último domingo de octubre", () => {
    const series = weekly("2026-10-19T08:00:00Z"); // lunes 10:00 CEST
    const occurrences = expandSeries(
      series,
      at("2026-10-18T00:00:00Z"),
      at("2026-11-03T00:00:00Z"),
    );
    expect(occurrences.map((o) => iso(o.start))).toEqual([
      "2026-10-19T08:00:00.000Z",
      "2026-10-26T09:00:00.000Z", // 10:00 CET
      "2026-11-02T09:00:00.000Z",
    ]);
    expect(occurrences.every((o) => o.end - o.start === 3_600_000)).toBe(true);
  });

  it("y tras el último domingo de marzo", () => {
    const series = weekly("2027-03-22T09:00:00Z"); // lunes 10:00 CET
    const occurrences = expandSeries(
      series,
      at("2027-03-21T00:00:00Z"),
      at("2027-04-06T00:00:00Z"),
    );
    expect(occurrences.map((o) => iso(o.start))).toEqual([
      "2027-03-22T09:00:00.000Z",
      "2027-03-29T08:00:00.000Z", // 10:00 CEST
      "2027-04-05T08:00:00.000Z",
    ]);
  });

  it("una cita diaria a las 02:30 pasa a las 03:30 el día que esa hora no existe", () => {
    const series = weekly("2027-03-27T01:30:00Z", "FREQ=DAILY;COUNT=3"); // 02:30 CET
    const starts = expandSeries(series, at("2027-03-27T00:00:00Z"), at("2027-03-30T00:00:00Z")).map(
      (o) => iso(o.start),
    );
    expect(starts).toEqual([
      "2027-03-27T01:30:00.000Z",
      "2027-03-28T01:30:00.000Z", // 03:30 CEST (02:30 no existe)
      "2027-03-29T00:30:00.000Z", // 02:30 CEST
    ]);
  });
});

describe("expansión", () => {
  it("excluye las ocurrencias borradas", () => {
    const series = {
      ...weekly("2026-11-02T09:00:00Z"),
      exdates: [at("2026-11-09T09:00:00Z")],
    };
    const starts = expandSeries(series, at("2026-11-01T00:00:00Z"), at("2026-11-17T00:00:00Z")).map(
      (o) => iso(o.start),
    );
    expect(starts).toEqual(["2026-11-02T09:00:00.000Z", "2026-11-16T09:00:00.000Z"]);
  });

  it("incluye una ocurrencia que empezó antes del rango y sigue en curso", () => {
    const series = weekly("2026-11-02T09:00:00Z", "FREQ=WEEKLY", 180);
    const occurrences = expandSeries(
      series,
      at("2026-11-02T10:00:00Z"),
      at("2026-11-02T11:00:00Z"),
    );
    expect(occurrences).toHaveLength(1);
  });

  it("los eventos de día completo se repiten por fecha, sin zona", () => {
    const start = dateOnlyToUtc("2026-12-24");
    const series: Series = {
      startAt: start,
      endAt: start + 2 * 86_400_000,
      tz: MADRID,
      allDay: true,
      type: "event",
      rrule: "FREQ=YEARLY",
      exdates: [],
    };
    const [occurrence] = expandSeries(
      series,
      at("2027-12-01T00:00:00Z"),
      at("2028-01-01T00:00:00Z"),
    );
    expect(iso(occurrence?.start ?? 0)).toBe("2027-12-24T00:00:00.000Z");
    expect(iso(occurrence?.end ?? 0)).toBe("2027-12-26T00:00:00.000Z");
  });

  it("calcula el fin de una serie con COUNT o UNTIL, y null si no termina", () => {
    expect(seriesEnd(weekly("2026-11-02T09:00:00Z"))).toBeNull();
    const counted = weekly("2026-11-02T09:00:00Z", "FREQ=WEEKLY;COUNT=3");
    expect(iso(seriesEnd(counted) ?? 0)).toBe("2026-11-16T10:00:00.000Z");
  });
});

describe("cumpleaños", () => {
  function birthday(date: string, extra: Partial<Series> = {}): Series {
    const start = dateOnlyToUtc(date);
    return {
      startAt: start,
      endAt: start + 86_400_000,
      tz: MADRID,
      allDay: true,
      type: "birthday",
      rrule: "FREQ=YEARLY",
      exdates: [],
      ...extra,
    };
  }

  it("se repite cada año y calcula la edad", () => {
    const series = birthday("1990-05-17", { birthYear: 1990 });
    const [occurrence] = expandSeries(
      series,
      at("2027-05-01T00:00:00Z"),
      at("2027-06-01T00:00:00Z"),
    );
    expect(iso(occurrence?.start ?? 0)).toBe("2027-05-17T00:00:00.000Z");
    expect(occurrence?.age).toBe(37);
  });

  it("el 29 de febrero se celebra el 28 o el 1 de marzo según la regla", () => {
    const range = [at("2027-02-01T00:00:00Z"), at("2027-03-31T00:00:00Z")] as const;
    const feb28 = expandSeries(birthday("2000-02-29", { feb29Rule: "feb28" }), ...range);
    const mar1 = expandSeries(birthday("2000-02-29", { feb29Rule: "mar1" }), ...range);
    expect(iso(feb28[0]?.start ?? 0)).toBe("2027-02-28T00:00:00.000Z");
    expect(iso(mar1[0]?.start ?? 0)).toBe("2027-03-01T00:00:00.000Z");
    const leap = expandSeries(
      birthday("2000-02-29"),
      at("2028-02-01T00:00:00Z"),
      at("2028-03-31T00:00:00Z"),
    );
    expect(iso(leap[0]?.start ?? 0)).toBe("2028-02-29T00:00:00.000Z");
  });

  it("las siguientes ocurrencias empiezan en el próximo año si este ya pasó", () => {
    let first: number | null = null;
    for (const occurrence of occurrencesAfter(birthday("1990-05-17"), at("2027-06-01T00:00:00Z"))) {
      first = occurrence.start;
      break;
    }
    expect(iso(first ?? 0)).toBe("2028-05-17T00:00:00.000Z");
  });
});

describe("corte de series («este y los siguientes»)", () => {
  it("con UNTIL, la serie anterior termina justo antes de la ocurrencia", () => {
    const series = weekly("2026-11-02T09:00:00Z");
    const split = splitRule(series, at("2026-11-16T09:00:00Z"));
    expect(split.countBefore).toBe(2);
    const before = { ...series, rrule: split.before };
    const starts = expandSeries(before, at("2026-11-01T00:00:00Z"), at("2026-12-31T00:00:00Z")).map(
      (o) => iso(o.start),
    );
    expect(starts).toEqual(["2026-11-02T09:00:00.000Z", "2026-11-09T09:00:00.000Z"]);
    expect(split.after).toBe("FREQ=WEEKLY");
  });

  it("con COUNT, reparte las repeticiones entre las dos series", () => {
    const series = weekly("2026-11-02T09:00:00Z", "FREQ=WEEKLY;COUNT=5");
    const split = splitRule(series, at("2026-11-16T09:00:00Z"));
    expect(split.before).toBe("FREQ=WEEKLY;COUNT=2");
    expect(split.after).toBe("FREQ=WEEKLY;COUNT=3");
  });

  it("reconoce qué inicios pertenecen a la serie", () => {
    const series = weekly("2026-11-02T09:00:00Z");
    expect(isOccurrenceStart(series, at("2026-11-09T09:00:00Z"))).toBe(true);
    expect(isOccurrenceStart(series, at("2026-11-10T09:00:00Z"))).toBe(false);
  });
});
