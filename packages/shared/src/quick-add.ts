import { parse as parseSpanish } from "chrono-node/es";
import type { Locale } from "./constants";

/**
 * Alta rápida en lenguaje natural (F2-12): «Dentista mañana 17:30», «Yoga hoy de 18 a 19»,
 * «Vacaciones el 3 de agosto». chrono-node (es) reconoce la fecha y la hora de inicio; los
 * rangos «de 10 a 11:30» se reconocen aparte porque chrono no los cierra bien en español.
 *
 * En inglés (F7-06) se usa chrono-node/en, que la app descarga solo si hace falta
 * (`@delyra/shared/quick-add-en`) y pasa como `parse`.
 */

/** Analizador de fechas de chrono-node (mismo tipo en todos los idiomas). */
export type QuickAddParser = typeof parseSpanish;

export interface QuickDraft {
  title: string;
  allDay: boolean;
  /** `AAAA-MM-DD` */
  date: string;
  /** `HH:MM` (solo con hora) */
  startTime: string | null;
  endTime: string | null;
}

const MAX_LENGTH = 200;
const RANGES: Record<Locale, RegExp> = {
  // `(?<![\d/:.])`: el «1» de «15/1» o de «9:15» no empieza un rango.
  es: /(?:\bde\s+)?(?:las\s+)?(?<![\d/:.])\b(\d{1,2})(?:[:.](\d{2}))?(?:\s*h)?\s*(?:a|hasta|-|–)\s*(?:las\s+)?(\d{1,2})(?:[:.](\d{2}))?(?:\s*h)?\b/i,
  en: /(?:\bfrom\s+)?(?<![\d/:.])\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:to|until|till|-|–)\s*(\d{1,2})(?:[:.](\d{2}))?\b(?!\s*(?:am|pm))/i,
};
const CONNECTORS: Record<Locale, RegExp> = {
  es: /^(?:el|la|los|las|de|del|a|al|en|para|desde|hasta|y)$/i,
  en: /^(?:the|on|at|in|from|to|for|until|and|by)$/i,
};
const UNTITLED: Record<Locale, string> = { es: "Nuevo evento", en: "New event" };

const pad = (n: number) => String(n).padStart(2, "0");
const validTime = (h: number, m: number) => h >= 0 && h <= 23 && m >= 0 && m <= 59;

// ── Español hablado (F8-07) ──────────────────────────────────────────────────
// chrono-node/es no entiende «a las 5 de la tarde», «10 y media», «17h», «mediodía», «pasado
// mañana» ni «el lunes que viene», justo lo que sale al dictar. Se reescriben antes a una forma que
// sí entiende («17:00», «el 23/11/2026», «el lunes»). La app de Android hace lo mismo (QuickAdd.kt).

const HOUR_WORDS: Readonly<Record<string, number>> = {
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
};
const hourWord = (word: string) => String(HOUR_WORDS[word.toLowerCase()] ?? word);

/** Hora de 24 h a partir de «las 5 de la tarde» (las 12 de la noche o de la madrugada son las 0). */
function dayPartHour(hour: number, part: string): number {
  const p = part.toLowerCase();
  if (p === "tarde" || p === "noche") {
    if (hour === 12) return p === "noche" ? 0 : 12;
    return hour < 12 ? hour + 12 : hour;
  }
  return hour === 12 && p === "madrugada" ? 0 : hour;
}

function hhmm(hour: number, minute: number): string {
  return `${String(hour)}:${pad(minute)}`;
}

// Expresiones literales (sin `new RegExp`), lineales y sobre una entrada de 200 caracteres.
function normalizeSpanish(text: string, reference: Date): string {
  return (
    text
      // Horas en palabras: «a las cinco», «a la una», «de dos a tres».
      .replace(
        /\b(a\s+las?)\s+(una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/gi,
        (_, a: string, w: string) => `${a} ${hourWord(w)}`,
      )
      .replace(
        /\bde\s+(una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\s+a\s+(una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/gi,
        (_, w1: string, w2: string) => `de ${hourWord(w1)} a ${hourWord(w2)}`,
      )
      // «17h», «17 h», «17h30», «17:30h».
      .replace(/(?<![\d:.])(\d{1,2})h(\d{2})\b/gi, "$1:$2")
      .replace(/(?<![\d:.])(\d{1,2}[:.]\d{2})\s?h\b/gi, "$1")
      .replace(/(?<![\d:.])(\d{1,2})\s?h\b/gi, "$1:00")
      // «10 y media», «10 y cuarto», «10 menos cuarto».
      .replace(/(?<![\d:.])(\d{1,2})(?:[:.]00)?\s+y\s+media\b/gi, (_, h: string) =>
        hhmm(Number(h), 30),
      )
      .replace(/(?<![\d:.])(\d{1,2})(?:[:.]00)?\s+y\s+cuarto\b/gi, (_, h: string) =>
        hhmm(Number(h), 15),
      )
      .replace(/(?<![\d:.])(\d{1,2})(?:[:.]00)?\s+menos\s+cuarto\b/gi, (_, h: string) =>
        hhmm(Number(h) <= 1 ? 12 : Number(h) - 1, 45),
      )
      // «de 5 a 7 de la tarde»: la parte del día vale para las dos horas.
      .replace(
        /(?<![\d:.])(\d{1,2})(?:[:.](\d{2}))?\s+a\s+(\d{1,2})(?:[:.](\d{2}))?\s+de\s+la\s+(mañana|madrugada|tarde|noche)/gi,
        (_, h1: string, m1 = "0", h2: string, m2 = "0", p: string) =>
          `${hhmm(dayPartHour(Number(h1), p), Number(m1))} a ${hhmm(dayPartHour(Number(h2), p), Number(m2))}`,
      )
      // «a las 5 de la tarde», «8:30 de la mañana».
      .replace(
        /(?<![\d:.])(\d{1,2})(?:[:.](\d{2}))?\s+de\s+la\s+(mañana|madrugada|tarde|noche)/gi,
        (_, h: string, m = "0", p: string) => hhmm(dayPartHour(Number(h), p), Number(m)),
      )
      .replace(/\b(?:al|a)\s+mediod[ií]a\b/gi, "a las 12:00")
      .replace(/\b(?:a\s+)?(?:la\s+)?medianoche\b/gi, "a las 0:00")
      // «el lunes que viene» es «el lunes» (el siguiente).
      .replace(
        /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+que\s+viene\b/gi,
        "$1",
      )
      // «pasado mañana»: chrono lo confunde con «mañana»; se escribe la fecha.
      .replace(/\bpasado\s+mañana\b/gi, () => {
        const day = new Date(
          reference.getFullYear(),
          reference.getMonth(),
          reference.getDate() + 2,
        );
        return `el ${String(day.getDate())}/${String(day.getMonth() + 1)}/${String(day.getFullYear())}`;
      })
      .replace(/\bsept\b\.?/gi, "sep")
  );
}

function cleanTitle(text: string, locale: Locale): string {
  const connectors = CONNECTORS[locale];
  const words = text.split(/\s+/).filter(Boolean);
  while (words.length > 0 && connectors.test(words.at(-1) ?? "")) words.pop();
  while (words.length > 0 && connectors.test(words[0] ?? "")) words.shift();
  return words.join(" ").replace(/[,;:\s]+$/, "");
}

/**
 * @param reference Fecha cuyas componentes *locales* son «ahora» en la zona del usuario.
 */
export function parseQuickAdd(
  text: string,
  reference: Date,
  options: { locale?: Locale; parse?: QuickAddParser } = {},
): QuickDraft | null {
  // Sin el analizador inglés todavía descargado, se usa el español (entiende horas y fechas).
  const locale = options.parse ? (options.locale ?? "es") : "es";
  const parse = options.parse ?? parseSpanish;
  // Entrada acotada a 200 caracteres y RANGES sin cuantificadores anidados (~1 µs en el peor
  // caso medido); además se ejecuta en el navegador del propio usuario.
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- regex lineal y entrada acotada
  let rest = text.slice(0, MAX_LENGTH).trim();
  if (!rest) return null;
  if (locale === "es") rest = normalizeSpanish(rest, reference);

  let startTime: string | null = null;
  let endTime: string | null = null;
  const range = RANGES[locale].exec(rest);
  if (range) {
    const [match, h1, m1 = "0", h2, m2 = "0"] = range;
    const start = [Number(h1), Number(m1)] as const;
    const end = [Number(h2), Number(m2)] as const;
    if (validTime(...start) && validTime(...end)) {
      startTime = `${pad(start[0])}:${pad(start[1])}`;
      endTime = `${pad(end[0])}:${pad(end[1])}`;
      rest = rest.replace(match, " ");
    }
  }

  const result = parse(rest, reference, { forwardDate: true })[0];
  if (!result && !startTime) return null;

  let date = `${String(reference.getFullYear())}-${pad(reference.getMonth() + 1)}-${pad(reference.getDate())}`;
  if (result) {
    const s = result.start;
    date = `${String(s.get("year") ?? reference.getFullYear())}-${pad(s.get("month") ?? 1)}-${pad(s.get("day") ?? 1)}`;
    if (!startTime && s.isCertain("hour")) {
      startTime = `${pad(s.get("hour") ?? 0)}:${pad(s.get("minute") ?? 0)}`;
      const e = result.end;
      if (e?.isCertain("hour")) endTime = `${pad(e.get("hour") ?? 0)}:${pad(e.get("minute") ?? 0)}`;
    }
    rest = rest.replace(result.text, " ");
  }
  if (startTime && !endTime) {
    const [h = 0, m = 0] = startTime.split(":").map(Number);
    endTime = `${pad(Math.min(h + 1, 23))}:${pad(h + 1 > 23 ? 59 : m)}`;
  }

  return {
    title: cleanTitle(rest, locale) || UNTITLED[locale],
    allDay: startTime === null,
    date,
    startTime,
    endTime,
  };
}
