import { useSyncExternalStore } from "react";

/**
 * ¿Se cumple la media query? Se actualiza al girar el dispositivo o cambiar el tamaño de la
 * ventana. Sin `matchMedia` (tests, SSR) devuelve `fallback`.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}
