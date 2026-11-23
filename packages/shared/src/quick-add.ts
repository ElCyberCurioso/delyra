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
  es: /(?:\bde\s+)?(?:las\s+)?\b(\d{1,2})(?:[:.](\d{2}))?(?:\s*h)?\s*(?:a|hasta|-|–)\s*(?:las\s+)?(\d{1,2})(?:[:.](\d{2}))?(?:\s*h)?\b/i,
  en: /(?:\bfrom\s+)?\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:to|until|till|-|–)\s*(\d{1,2})(?:[:.](\d{2}))?\b(?!\s*(?:am|pm))/i,
};
const CONNECTORS: Record<Locale, RegExp> = {
  es: /^(?:el|la|los|las|de|del|a|al|en|para|desde|hasta|y)$/i,
  en: /^(?:the|on|at|in|from|to|for|until|and|by)$/i,
};
const UNTITLED: Record<Locale, string> = { es: "Nuevo evento", en: "New event" };

const pad = (n: number) => String(n).padStart(2, "0");
const validTime = (h: number, m: number) => h >= 0 && h <= 23 && m >= 0 && m <= 59;

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
