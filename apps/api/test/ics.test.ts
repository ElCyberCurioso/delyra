import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { convertRrule, parseIcs, summarizeIcs } from "../src/lib/ics";
import {
  cleanTitle,
  ImportFormatError,
  ImportLimitError,
  plainText,
  Warnings,
} from "../src/lib/import-model";
import { unzipCalendars } from "../src/lib/unzip";
import {
  calendarHeader,
  crlf,
  GOOGLE_EXPORT,
  HOSTILE,
  manyEvents,
  WORK_EXPORT,
} from "./fixtures/ics";

/** Parser ICS y descompresión (F5-01, F5-02, F5-07). */

const options = { defaultTimeZone: "Europe/Madrid" };
const utc = (...parts: [number, number, number, number?, number?]) =>
  Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3] ?? 0, parts[4] ?? 0);

function single(lines: string[], tz = "Europe/Madrid") {
  return parseIcs(
    crlf([
      ...calendarHeader("Prueba", tz),
      "BEGIN:VEVENT",
      "UID:u1",
      ...lines,
      "END:VEVENT",
      "END:VCALENDAR",
    ]),
    options,
  );
}

function stream(bytes: Uint8Array, chunk = 1024): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
    },
  });
}

describe("exportación de Google (F5-01)", () => {
  const parsed = parseIcs(GOOGLE_EXPORT, options);
  const byTitle = (title: string) => parsed.events.find((e) => e.title === title);

  it("lee el nombre, la zona y todos los eventos (excepciones al final)", () => {
    expect(parsed.name).toBe("Personal");
    expect(parsed.timeZone).toBe("Europe/Madrid");
    // 4 series o eventos sueltos + 1 excepción (la cancelada pasa a EXDATE).
    expect(parsed.events).toHaveLength(5);
    expect(parsed.events.at(-1)?.recurrenceId).not.toBeNull();
    expect(summarizeIcs(GOOGLE_EXPORT)).toEqual({ name: "Personal", events: 6 });
  });

  it("convierte la serie: TZID, UNTIL en hora flotante, EXDATE y canceladas", () => {
    const weekly = byTitle("Reunión semanal");
    expect(weekly).toMatchObject({
      uid: "7kukuqrfedlm2f9t0vqv4fn9nm@google.com",
      startAt: utc(2026, 11, 2, 9),
      endAt: utc(2026, 11, 2, 10),
      tz: "Europe/Madrid",
      allDay: false,
      reminders: [10],
      location: "Oficina, planta 2",
    });
    // 08:59:59Z son las 09:59:59 en Madrid: la regla se guarda en hora local flotante.
    expect(weekly?.rrule).toContain("UNTIL=20261228T095959Z");
    expect(weekly?.rrule).toContain("BYDAY=MO");
    // El 9 borrado y el 23 cancelado.
    expect(weekly?.exdates).toEqual([utc(2026, 11, 9, 9), utc(2026, 11, 23, 9)]);
    // HTML de Google → texto, con la línea plegada unida.
    expect(weekly?.notes).toBe(
      "Revisar notas\ny tareas pendientes de la semana, con un texto largo que Google pliega en varias líneas",
    );
  });

  it("guarda la ocurrencia movida como excepción de su serie", () => {
    const moved = byTitle("Reunión semanal (movida)");
    expect(moved).toMatchObject({
      uid: "7kukuqrfedlm2f9t0vqv4fn9nm@google.com",
      recurrenceId: utc(2026, 11, 16, 9),
      startAt: utc(2026, 11, 16, 11),
      endAt: utc(2026, 11, 16, 12),
    });
  });

  it("días completos (fin exclusivo), UTC, URL y repetición anual", () => {
    expect(byTitle("Vacaciones")).toMatchObject({
      allDay: true,
      startAt: utc(2026, 12, 24),
      endAt: utc(2026, 12, 27),
      // TRIGGER:-PT15H en un día completo: las 9:00 del día anterior.
      reminders: [900],
    });
    expect(byTitle("Dentista")).toMatchObject({
      startAt: utc(2026, 11, 25, 17),
      tz: "Europe/Madrid",
      url: "https://example.com/cita",
    });
    expect(byTitle("Aniversario")?.rrule).toBe("FREQ=YEARLY");
  });
});

describe("zonas, duraciones y alertas", () => {
  it("TZID de Windows, con prefijo de Mozilla y horas flotantes", () => {
    const windows = single(["DTSTART;TZID=Romance Standard Time:20260701T100000", "SUMMARY:A"]);
    expect(windows.events[0]).toMatchObject({ startAt: utc(2026, 7, 1, 8), tz: "Europe/Madrid" });
    const mozilla = single([
      "DTSTART;TZID=/mozilla.org/20050126_1/America/New_York:20260701T100000",
      "SUMMARY:B",
    ]);
    expect(mozilla.events[0]).toMatchObject({
      startAt: utc(2026, 7, 1, 14),
      tz: "America/New_York",
    });
    const floating = single(["DTSTART:20260701T100000", "SUMMARY:C"], "Atlantic/Canary");
    expect(floating.events[0]).toMatchObject({
      startAt: utc(2026, 7, 1, 9),
      tz: "Atlantic/Canary",
    });
  });

  it("zona desconocida: usa la del calendario y avisa", () => {
    const parsed = single(["DTSTART;TZID=Zona/Inventada:20260701T100000", "SUMMARY:D"]);
    expect(parsed.events[0]?.tz).toBe("Europe/Madrid");
    expect(parsed.warnings.list.join()).toContain("Zona/Inventada");
  });

  it("sin DTEND: DURATION o una duración mínima", () => {
    const withDuration = single(["DTSTART:20260701T100000Z", "DURATION:PT2H", "SUMMARY:E"]);
    expect(withDuration.events[0]?.endAt).toBe(utc(2026, 7, 1, 12));
    const bare = single(["DTSTART:20260701T100000Z", "SUMMARY:F"]);
    expect(bare.events[0]?.endAt).toBe(utc(2026, 7, 1, 10, 1));
    const allDay = single(["DTSTART;VALUE=DATE:20260701", "SUMMARY:G"]);
    expect(allDay.events[0]?.endAt).toBe(utc(2026, 7, 2));
  });

  it("alertas relativas al fin y absolutas, sin repetir y en rango", () => {
    const parsed = single([
      "DTSTART:20260701T100000Z",
      "DTEND:20260701T110000Z",
      "SUMMARY:H",
      "BEGIN:VALARM",
      "TRIGGER;RELATED=END:-PT30M",
      "END:VALARM",
      "BEGIN:VALARM",
      "TRIGGER;VALUE=DATE-TIME:20260701T080000Z",
      "END:VALARM",
      "BEGIN:VALARM",
      "TRIGGER:-PT2H",
      "END:VALARM",
      "BEGIN:VALARM",
      "TRIGGER:-P60D",
      "END:VALARM",
    ]);
    // Fin − 30 min = 30 min tras el inicio → −30; las otras dos son 120; 60 días se descarta.
    expect(parsed.events[0]?.reminders).toEqual([120, -30]);
  });
});

describe("repeticiones", () => {
  const warnings = new Warnings();
  const timed = { allDay: false, tz: "Europe/Madrid" };

  it("convierte UNTIL y limita COUNT", () => {
    expect(convertRrule("FREQ=DAILY;UNTIL=20261231", timed, warnings)).toContain(
      "UNTIL=20261231T235959Z",
    );
    expect(convertRrule("FREQ=DAILY;COUNT=5000", timed, warnings)).toBe("FREQ=DAILY;COUNT=1000");
  });

  it("las repeticiones por horas no se admiten (queda la primera vez)", () => {
    const parsed = single(["DTSTART:20260701T100000Z", "RRULE:FREQ=HOURLY;COUNT=10", "SUMMARY:I"]);
    expect(parsed.events[0]?.rrule).toBeNull();
    expect(parsed.warnings.list.join()).toContain("horas");
  });

  it("ignora partes desconocidas pero conserva la regla", () => {
    expect(convertRrule("FREQ=WEEKLY;BYDAY=MO;BYHOUR=10;X-FOO=1", timed, warnings)).toBe(
      "FREQ=WEEKLY;BYDAY=MO",
    );
  });
});

describe("ficheros malformados y hostiles (F5-07)", () => {
  it("rechaza lo que no es un calendario", () => {
    expect(() => parseIcs("hola", options)).toThrow(ImportFormatError);
    expect(() => parseIcs("<html><body>BEGIN:VCALENDAR</body></html>", options)).toThrow(
      ImportFormatError,
    );
  });

  it("descarta los eventos rotos y sigue con el resto", () => {
    const parsed = parseIcs(
      crlf([
        ...calendarHeader("Roto"),
        "BEGIN:VEVENT",
        "UID:sin-fecha",
        "SUMMARY:Sin fecha",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:mal",
        "DTSTART:no-es-una-fecha",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:bien",
        "DTSTART:20260701T100000Z",
        "SUMMARY:Bien",
        "END:VEVENT",
        "END:VCALENDAR",
      ]),
      options,
    );
    expect(parsed.events.map((e) => e.uid)).toEqual(["bien"]);
    expect(parsed.skipped).toBe(2);
  });

  it("un calendario demasiado grande se rechaza entero", () => {
    expect(() => parseIcs(manyEvents(30), { ...options, maxEvents: 20 })).toThrow(ImportLimitError);
  });

  it("los campos de texto quedan en texto plano, sin HTML ni caracteres de control", () => {
    const parsed = parseIcs(HOSTILE, options);
    const [event] = parsed.events;
    // El nombre era solo HTML: se queda sin nombre y se usa el del fichero.
    expect(parsed.name).toBeNull();
    expect(event?.title).toBe("alert('xss')Hola");
    expect(event?.notes).toBe("clic<b>");
    expect(event?.url).toBeNull();
    expect(event?.location).toBe("Plaza");
    expect(event?.uid.length).toBeLessThanOrEqual(255);
    // El texto decodificado (`<b>`) es texto: la interfaz lo pinta siempre escapado.
    expect(plainText("<p>a</p><p>b</p>")).toBe("a\nb");
    // Acentos, ñ y emojis no son caracteres de control (regresión de un rango mal escrito).
    expect(plainText("Reunión de diseño: ¿Qué tal? ü € 😀")).toBe(
      "Reunión de diseño: ¿Qué tal? ü € 😀",
    );
    expect(cleanTitle("  ")).toBe("(Sin título)");
  });
});

describe("zip de Google (F5-02)", () => {
  it("extrae solo los .ics (sin carpetas ocultas)", async () => {
    const zip = zipSync({
      "Personal_abc@group.calendar.google.com.ics": strToU8(GOOGLE_EXPORT),
      "Trabajo/trabajo.ics": strToU8(WORK_EXPORT),
      "__MACOSX/._trabajo.ics": strToU8("basura"),
      "LEEME.txt": strToU8("hola"),
    });
    const entries = await unzipCalendars(stream(zip));
    expect(entries.map((e) => e.name).sort()).toEqual([
      "Personal_abc@group.calendar.google.com.ics",
      "trabajo.ics",
    ]);
    expect(entries.find((e) => e.name === "trabajo.ics")?.text).toBe(WORK_EXPORT);
  });

  it("aborta una zip bomb al pasar del límite de lo descomprimido", async () => {
    // 8 MB de ceros comprimen a unos pocos KB.
    const bomb = zipSync({ "bomba.ics": new Uint8Array(8 * 1024 * 1024) }, { level: 9 });
    expect(bomb.byteLength).toBeLessThan(100_000);
    await expect(
      unzipCalendars(stream(bomb), {
        totalBytes: 2 * 1024 * 1024,
        fileBytes: 4 * 1024 * 1024,
        files: 50,
      }),
    ).rejects.toBeInstanceOf(ImportLimitError);
  });

  it("rechaza un zip sin calendarios o dañado", async () => {
    await expect(unzipCalendars(stream(zipSync({ "a.txt": strToU8("x") })))).rejects.toBeInstanceOf(
      ImportFormatError,
    );
    const broken = zipSync({ "a.ics": strToU8(WORK_EXPORT) }).slice(0, 60);
    await expect(unzipCalendars(stream(broken))).rejects.toBeInstanceOf(ImportFormatError);
  });

  it("limita el número de calendarios", async () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 4; i++) files[`c${String(i)}.ics`] = strToU8(WORK_EXPORT);
    await expect(
      unzipCalendars(stream(zipSync(files)), { totalBytes: 1e9, fileBytes: 1e9, files: 3 }),
    ).rejects.toBeInstanceOf(ImportLimitError);
  });
});
