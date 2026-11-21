import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quick-add";

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
