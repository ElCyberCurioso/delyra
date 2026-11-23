import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from "@delyra/shared";

/**
 * Idiomas de la interfaz (F7-06). Cada parte de la app define su catálogo en español (el que se
 * carga siempre) y una traducción con la misma forma, que solo se descarga si hace falta. El
 * compilador obliga a que la traducción tenga todas las claves y las mismas funciones.
 *
 * El idioma vale para toda la página: al cambiarlo, `LocaleProvider` vuelve a montar la app, así
 * que se puede leer el catálogo en cualquier función de render sin suscribirse.
 */

export const LOCALE_STORAGE_KEY = "delyra-locale";

/** Traducción de un catálogo: las mismas claves; las funciones, con los mismos parámetros. */
export type Translation<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : T[K] extends string
      ? string
      : T[K] extends readonly string[]
        ? readonly string[]
        : Translation<T[K]>;
};

const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);

function storedLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/** El primero de los idiomas del navegador que tengamos; si no hay ninguno, español. */
export function browserLocale(languages: readonly string[] = navigator.languages): Locale {
  for (const tag of languages) {
    const base = tag.slice(0, 2).toLowerCase();
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

let current: Locale =
  typeof window === "undefined" ? DEFAULT_LOCALE : (storedLocale() ?? browserLocale());

interface Entry {
  en: unknown;
  load: () => Promise<{ default: unknown }>;
}
const catalogs: Entry[] = [];
const listeners = new Set<(locale: Locale) => void>();

async function ensureEnglish(entry: Entry) {
  if (entry.en === null) entry.en = (await entry.load()).default;
}

export const getLocale = (): Locale => current;

/** Etiqueta para `Intl` (fechas, números, listas). */
export const intlLocale = (locale: Locale = current): string =>
  locale === "es" ? "es-ES" : "en-GB";

/** Cambia el idioma: primero descarga lo que falte, luego avisa (la app se vuelve a montar). */
export async function setLocale(next: Locale): Promise<void> {
  if (next === "en") await Promise.all(catalogs.map(ensureEnglish));
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // Sin almacenamiento (modo privado): vale para esta visita.
  }
  if (next === current) return;
  current = next;
  document.documentElement.lang = next;
  for (const listener of listeners) listener(next);
}

export function subscribeLocale(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Registra un catálogo y devuelve su lector. Se usa con `await` en el nivel superior del módulo:
 * si la página está en inglés, el módulo no termina de cargar hasta tener la traducción.
 */
export async function defineMessages<T, E = Translation<T>>(
  es: T,
  load: () => Promise<{ default: E }>,
): Promise<() => T> {
  const entry: Entry = { en: null, load };
  catalogs.push(entry);
  if (current === "en") await ensureEnglish(entry);
  return () => (current === "en" && entry.en !== null ? (entry.en as T) : es);
}
