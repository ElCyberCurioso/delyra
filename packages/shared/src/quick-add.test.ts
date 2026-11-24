import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quick-add";
import { parseEnglish } from "./quick-add-en";

// Sábado 21 de noviembre de 2026, 18:00 (componentes locales).
const now = new Date(2026, 10, 21, 18, 0);

describe("alta rápida en lenguaje natural", () => {
  it.each([
    ["Dentista mañana 17:30", "Dentista", "2026-11-22", "17:30", "18:30"],
    ["Dentista mañana a las 17:30", "Dentista", "2026-11-22", "17:30", "18:30"],
    ["Cena el viernes a las 21:00", "Cena", "2026-11-27", "21:00", "22:00"],
    ["Reunión el 12/12 de 10:00 a 11:30", "Reunión", "2026-12-12", "10:00", "11:30"],
    ["Yoga hoy de 18 a 19", "Yoga", "2026-11-21", "18:00", "19:00"],
    ["Vuelo a Lisboa 3 de diciembre a las 7", "Vuelo a Lisboa", "2026-12-03", "07:00", "08:00"],
  ])("«%s»", (text, title, date, start, end) => {
    expect(parseQuickAdd(text, now)).toEqual({
      title,
      allDay: false,
      date,
      startTime: start,
      endTime: end,
    });
  });

  it("sin hora es de día completo", () => {
    expect(parseQuickAdd("Médico el lunes", now)).toMatchObject({
      title: "Médico",
      allDay: true,
      date: "2026-11-23",
    });
  });

  it("sin fecha reconocible no propone nada", () => {
    expect(parseQuickAdd("Comprar pan", now)).toBeNull();
    expect(parseQuickAdd("   ", now)).toBeNull();
  });
});

describe("español hablado (F8-07)", () => {
  it.each([
    ["Dentista mañana a las 5 de la tarde", "Dentista", "2026-11-22", "17:00", "18:00"],
    ["Cena mañana a las 9 de la noche", "Cena", "2026-11-22", "21:00", "22:00"],
    ["Café mañana a las diez y media", "Café", "2026-11-22", "10:30", "11:30"],
    ["Llamar a Juan pasado mañana a las 10", "Llamar a Juan", "2026-11-23", "10:00", "11:00"],
    ["Reunión mañana al mediodía", "Reunión", "2026-11-22", "12:00", "13:00"],
    ["Clase el lunes que viene a las 17h", "Clase", "2026-11-23", "17:00", "18:00"],
    ["Revisión el 15/1 a las 9:15", "Revisión", "2027-01-15", "09:15", "10:15"],
    ["Yoga de 5 a 7 de la tarde", "Yoga", "2026-11-21", "17:00", "19:00"],
  ])("«%s»", (text, title, date, start, end) => {
    expect(parseQuickAdd(text, now)).toEqual({
      title,
      allDay: false,
      date,
      startTime: start,
      endTime: end,
    });
  });
});

describe("alta rápida en inglés (F7-06)", () => {
  const en = { locale: "en" as const, parse: parseEnglish };
  it.each([
    ["Dentist tomorrow 5:30pm", "Dentist", "2026-11-22", "17:30", "18:30"],
    ["Dinner on Friday at 9pm", "Dinner", "2026-11-27", "21:00", "22:00"],
    ["Yoga today from 18 to 19", "Yoga", "2026-11-21", "18:00", "19:00"],
    ["Flight to Lisbon December 3 at 7am", "Flight to Lisbon", "2026-12-03", "07:00", "08:00"],
  ])("“%s”", (text, title, date, start, end) => {
    expect(parseQuickAdd(text, now, en)).toEqual({
      title,
      allDay: false,
      date,
      startTime: start,
      endTime: end,
    });
  });

  it("sin hora es de día completo y sin título se llama «New event»", () => {
    expect(parseQuickAdd("Doctor on Monday", now, en)).toMatchObject({
      title: "Doctor",
      allDay: true,
      date: "2026-11-23",
    });
    expect(parseQuickAdd("tomorrow", now, en)).toMatchObject({ title: "New event" });
  });
});
