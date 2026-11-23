import { DEFAULT_LOCALE, type Locale, localeSchema } from "@delyra/shared";

/**
 * Idioma de una petición (F7-06): el primero de `Accept-Language` que tengamos. Las SPA lo mandan
 * con el idioma de la interfaz; sirve para lo que el servidor crea con nombre (plantillas,
 * calendarios por defecto, festivos) y para el idioma inicial de una cuenta nueva.
 */
export function requestLocale(header: string | null | undefined): Locale {
  for (const part of (header ?? "").split(",").slice(0, 10)) {
    const tag = part.split(";")[0]?.trim().slice(0, 2).toLowerCase();
    const parsed = localeSchema.safeParse(tag);
    if (parsed.success) return parsed.data;
  }
  return DEFAULT_LOCALE;
}

/** Idioma guardado en la cuenta (o el de por defecto si no es válido). */
export function accountLocale(value: string | null | undefined): Locale {
  return localeSchema.safeParse(value).data ?? DEFAULT_LOCALE;
}
