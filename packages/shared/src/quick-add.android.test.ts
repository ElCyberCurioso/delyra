import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quick-add";
import { parseEnglish } from "./quick-add-en";

/**
 * F8-07: la app de Android no lleva chrono-node; tiene su propio analizador
 * (`QuickAdd.kt`) y su prueba comprueba que da lo mismo que la web en estas frases. El resultado
 * de la web se guarda en `apps/android/app/src/test/resources/quick-add-cases.json`; si cambia,
 * esta prueba falla hasta regenerarlo:
 * `pnpm --filter @delyra/shared exec vitest run quick-add.android -u`.
 */

const ANDROID_FILE = "../../../apps/android/app/src/test/resources/quick-add-cases.json";
/** Sábado 21 de noviembre de 2026, 18:00 (componentes locales). */
const REFERENCE = "2026-11-21T18:00";

const SPANISH = [
  "Dentista mañana 17:30",
  "Dentista mañana a las 17:30",
  "Cena el viernes a las 21:00",
  "Reunión el 12/12 de 10:00 a 11:30",
  "Yoga hoy de 18 a 19",
  "Vuelo a Lisboa 3 de diciembre a las 7",
  "Médico el lunes",
  "Comprar pan",
  "Cumpleaños de Ana el 5 de enero",
  "Partido el domingo a las 12",
  "Llamar a Juan pasado mañana a las 10",
  "Revisión el 15/1 a las 9:15",
  "Clase de inglés el martes de 17 a 18:30",
  "Comida con Laura hoy a las 14:30",
  "Entrega del proyecto el 30 de noviembre",
  "Café mañana 9.30",
  "Dentista mañana a las 5 de la tarde",
  "Fisio el jueves 18:00",
  "Viaje el 24/12/2026",
  "Revisión ITV 2 de febrero de 2027",
  "Médico el próximo lunes a las 11",
  "Peluquería el sábado a las 10",
  "Reunión 10:00-11:00 mañana",
  "Gimnasio a las 20",
  "Concierto el 3 dic a las 21",
  "Examen el miércoles",
  "Cena mañana a las 9 de la noche",
  "Desayuno mañana a las 8 de la mañana",
  "Reunión mañana al mediodía",
  "Dentista el 1 de diciembre de 9 a 10",
  "Tutoría el viernes 13:00",
  "Médico el 3 de marzo a las 8:45",
  "mañana",
  "Gimnasio a las 10",
  "Peluquería el sábado",
  "Algo el 15 de noviembre",
  "Algo el 21 de noviembre",
  "Algo este viernes",
  "Algo el próximo viernes",
  "Algo el 3 de diciembre de 2027 a las 10:15",
  "Algo a las 7:05",
  "Algo el 28",
  "Algo el 1/2/27",
  "Algo 3 dic.",
  "Algo hoy 23:59",
  "Algo el domingo",
  "Algo de 10 a 11 el lunes",
  "Algo el lunes 17 de mayo",
  "Algo a las 5:30 pm",
  "Algo de 9:30 a 10",
  "Algo el 31/2",
  "Algo el 3 de diciembre 18:00",
  "Algo a las 17:30 mañana",
  "Algo 5 de enero 2027",
  // Español hablado (normalizado antes de analizar).
  "Algo 17h",
  "Algo a las 17h30",
  "Algo mañana a las 10 y media",
  "Algo a las cinco menos cuarto",
  "Algo mañana a las doce y cuarto",
  "Algo a la una",
  "Algo de 5 a 7 de la tarde",
  "Algo a las 12 de la noche",
  "Algo mañana a medianoche",
  "Algo a mediodía",
  "Algo el viernes que viene",
  "Algo el lunes que viene a las 9",
  "Algo pasado mañana",
  "Algo el 3 de sept",
];

const ENGLISH = [
  "Dentist tomorrow 5:30pm",
  "Dinner on Friday at 9pm",
  "Yoga today from 18 to 19",
  "Flight to Lisbon December 3 at 7am",
  "Doctor on Monday",
  "tomorrow",
  "Buy bread",
  "Meeting on 12/12 from 10 to 11:30",
  "Lunch with Laura today at 2:30pm",
  "Call John next Tuesday at 10am",
  "Project due November 30",
  "Gym at 8pm",
  "Party on Saturday at 9pm",
  "Haircut Dec 3 at 10:30",
  "Exam on Wednesday",
  "Trip on 12/24/2026",
  "Standup tomorrow at 9",
  "Review January 15 at 9:15am",
  "Coffee tomorrow at noon",
  "Meeting tomorrow 14:00",
  "Dentist on December 1 from 9 to 10",
  "Call mom on Sunday at 6pm",
  "Interview on March 3 at 8:45am",
  "Gym at 10am",
  "Party on Saturday",
  "Dentist the day after tomorrow at 10am",
  "Dinner this Friday",
  "Trip on 3 December",
  "Meeting at 7",
  "Lunch at 12:30",
  "Call at 5:30 pm",
  "Something on Nov 15",
  "Something 3rd of December",
  "Something December 3rd, 2027",
  "Something next friday",
  "Something at midnight",
  "Something 1/2/27",
  "Something on the 28th",
  "Something at 9 tomorrow",
  "Something tomorrow 9am-10am",
  "Something from 9am to 10am",
  "Something from 2 to 3pm",
  "Something on mon at 9",
  "Something at 10:30 on Monday",
  "Something Monday 9am",
  "Something on Dec. 3",
  "Something on 3 Dec at 5pm",
  "Something tonight",
  "Something tomorrow morning",
  "Something in 2 days",
  "Something at 17:30 tomorrow",
];

function cases() {
  const [date = "", time = ""] = REFERENCE.split("T");
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const now = new Date(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
  return {
    reference: REFERENCE,
    es: SPANISH.map((text) => ({ text, draft: parseQuickAdd(text, now) })),
    en: ENGLISH.map((text) => ({
      text,
      draft: parseQuickAdd(text, now, { locale: "en", parse: parseEnglish }),
    })),
  };
}

describe("alta rápida: casos para Android", () => {
  it("el fichero de la app está al día", async () => {
    await expect(`${JSON.stringify(cases(), null, 2)}\n`).toMatchFileSnapshot(ANDROID_FILE);
  });
});
