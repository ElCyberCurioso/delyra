import { EVENT_LIMITS, type EventType, type Feb29Rule } from "@delyra/shared";

/**
 * Formato intermedio de una importación (F5-01, F5-05). Tanto un `.ics` como la API de Google
 * se convierten primero a esta forma, ya validada y saneada, y la importación (F5-02) solo
 * trabaja con ella. Los instantes están en milisegundos con las mismas reglas que `events`:
 * UTC con zona IANA si es con hora; medianoche UTC si es de día completo (fin exclusivo).
 */
export interface ImportedEvent {
  /** `UID` del ICS o `iCalUID` de Google: evita duplicados al repetir la importación. */
  uid: string;
  /** Excepción de una serie: inicio original de la ocurrencia que sustituye. */
  recurrenceId: number | null;
  type: EventType;
  title: string;
  notes: string | null;
  location: string | null;
  url: string | null;
  allDay: boolean;
  startAt: number;
  endAt: number;
  tz: string;
  /** RRULE ya normalizada (sin `DTSTART`, `UNTIL` en hora flotante) o null. */
  rrule: string | null;
  exdates: number[];
  /** Minutos antes del inicio, como `reminders.offset_minutes`. */
  reminders: number[];
  feb29Rule: Feb29Rule | null;
}

/** Límites de una importación (F5-07): tamaño, número de eventos y avisos que se guardan. */
export const IMPORT_LIMITS = {
  /** Tamaño máximo del fichero subido (`.ics` o `.zip`). */
  uploadBytes: 25 * 1024 * 1024,
  /** Tamaño máximo de todo lo descomprimido de un `.zip` (zip bomb). */
  unzippedBytes: 60 * 1024 * 1024,
  /** Tamaño máximo de un `.ics` (suelto, dentro del `.zip` o de una suscripción). */
  icsBytes: 25 * 1024 * 1024,
  /** Calendarios por importación (ficheros `.ics` de un `.zip` o calendarios de Google). */
  calendars: 50,
  /** Eventos en total por importación. */
  events: 30_000,
  /** Eventos que se procesan en cada paso del Workflow. */
  chunk: 250,
  /** Avisos que se guardan en el informe. */
  warnings: 50,
  /** Longitud máxima de un UID. */
  uid: 255,
} as const;

const DAY_MS = 86_400_000;
const MAX_DURATION_MS = EVENT_LIMITS.durationDays * DAY_MS;
const MIN_OFFSET = -24 * 60;
const MAX_OFFSET = 28 * 24 * 60;

/** Quita la marca de orden de bytes (BOM) con la que empiezan algunos ficheros. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export class ImportLimitError extends Error {
  override name = "ImportLimitError";
}

/** Error de formato: el fichero no es un calendario válido. */
export class ImportFormatError extends Error {
  override name = "ImportFormatError";
}

/** Acumula avisos sin crecer sin límite (un fichero malicioso podría generar millones). */
export class Warnings {
  readonly list: string[] = [];
  total = 0;
  add(message: string): void {
    this.total++;
    if (this.list.length < IMPORT_LIMITS.warnings && !this.list.includes(message)) {
      this.list.push(message);
    }
  }
}

// ── Saneado de texto ─────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (match, code: string) => {
    if (code.startsWith("#")) {
      const value =
        code[1] === "x" || code[1] === "X"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * Texto plano a partir de lo que trae el origen. Google manda las notas en HTML (`<br>`,
 * `<a href>`…): se quitan las etiquetas y se decodifican las entidades. Nunca se guarda HTML,
 * y la interfaz pinta estos campos siempre como texto (F5-07, inyección en campos de texto).
 */
export function plainText(raw: string): string {
  let text = raw;
  if (/<[a-z/!][^>]*>/i.test(text)) {
    text = text
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<[^>]*>/g, "");
    text = decodeEntities(text);
  }
  return (
    text
      .replace(/\r\n?/g, "\n")
      // eslint-disable-next-line no-control-regex -- se quitan precisamente los de control
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - 1;
  // Sin partir un par sustituto (emoji) por la mitad.
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return `${text.slice(0, end).trimEnd()}…`;
}

export function cleanTitle(raw: string | null | undefined): string {
  const text = plainText(raw ?? "").replace(/\s*\n\s*/g, " ");
  return truncate(text, EVENT_LIMITS.title) || "(Sin título)";
}

export function cleanText(raw: string | null | undefined, max: number): string | null {
  if (!raw) return null;
  const text = truncate(plainText(raw), max);
  return text === "" ? null : text;
}

export function cleanUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? "";
  if (value.length === 0 || value.length > EVENT_LIMITS.url) return null;
  return /^https?:\/\/[^\s<>"]+$/i.test(value) ? value : null;
}

/** Identificador estable y acotado: los UID muy largos se resumen con un hash. */
export function cleanUid(raw: string | null | undefined, fallback: string): string {
  // eslint-disable-next-line no-control-regex -- sin caracteres de control
  const value = (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const base = value || `sin-uid-${fallback}`;
  return base.length <= IMPORT_LIMITS.uid ? base : `hash-${hash(base)}-${base.slice(0, 64)}`;
}

/** FNV-1a de 64 bits en hexadecimal (no criptográfico: solo para acortar identificadores). */
export function hash(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

export function cleanColor(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase() ?? "";
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) return `#${[...value.slice(1)].map((c) => c + c).join("")}`;
  return null;
}

/** Corrige la duración: el fin debe ser posterior al inicio y como mucho un año después. */
export function fixRange(
  startAt: number,
  endAt: number | null,
  allDay: boolean,
  warnings: Warnings,
): number {
  const minimum = allDay ? DAY_MS : 60_000;
  let end = endAt ?? startAt + (allDay ? DAY_MS : 0);
  if (end - startAt < minimum) end = startAt + minimum;
  if (end - startAt > MAX_DURATION_MS) {
    warnings.add("Algún evento duraba más de un año y se ha acortado");
    end = startAt + MAX_DURATION_MS;
  }
  return end;
}

/** Alertas válidas y sin repetir, como mucho las que admite un evento. */
export function cleanReminders(offsets: readonly number[], warnings: Warnings): number[] {
  const result: number[] = [];
  for (const raw of offsets) {
    const offset = Math.round(raw);
    if (!Number.isFinite(offset) || offset < MIN_OFFSET || offset > MAX_OFFSET) {
      warnings.add("Se han descartado alertas fuera del rango admitido (hasta 4 semanas antes)");
      continue;
    }
    if (!result.includes(offset)) result.push(offset);
  }
  if (result.length > EVENT_LIMITS.reminders) {
    warnings.add(`Solo se conservan ${String(EVENT_LIMITS.reminders)} alertas por evento`);
  }
  return result.slice(0, EVENT_LIMITS.reminders).sort((a, b) => b - a);
}

/**
 * Ordena para importar: primero eventos y series, después las excepciones (necesitan su
 * serie), y aplica las ocurrencias canceladas como borrados (`exdates`) de su serie.
 */
export function finalizeEvents(
  events: readonly ImportedEvent[],
  cancelled: readonly { uid: string; recurrenceId: number }[],
  warnings: Warnings,
): ImportedEvent[] {
  const masters = new Map<string, ImportedEvent>();
  const overrides: ImportedEvent[] = [];
  for (const event of events) {
    if (event.recurrenceId === null) {
      if (masters.has(event.uid)) {
        warnings.add("Había eventos repetidos con el mismo UID: se conserva el último");
      }
      masters.set(event.uid, event);
    } else overrides.push(event);
  }
  for (const { uid, recurrenceId } of cancelled) {
    const master = masters.get(uid);
    if (master?.rrule && !master.exdates.includes(recurrenceId)) master.exdates.push(recurrenceId);
  }
  const seen = new Set<string>();
  const unique = overrides.filter((o) => {
    const key = `${o.uid}:${String(o.recurrenceId)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  for (const master of masters.values()) master.exdates.sort((a, b) => a - b);
  return [...masters.values(), ...unique];
}
