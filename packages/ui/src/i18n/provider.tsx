import { Fragment, type ReactNode, useEffect, useState } from "react";
import { getLocale, subscribeLocale } from "./core";

/**
 * Vuelve a montar la app al cambiar de idioma: así todos los textos se leen de nuevo sin que cada
 * componente se suscriba. La caché de datos (TanStack Query) vive fuera y no se pierde.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState(getLocale);
  useEffect(() => subscribeLocale(setLocale), []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <Fragment key={locale}>{children}</Fragment>;
}
