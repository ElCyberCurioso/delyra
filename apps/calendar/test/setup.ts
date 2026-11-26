import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Las páginas se cargan bajo demanda (`lazyRouteComponent`): en un runner de CI lento, la primera
// espera de `findBy…` puede pasar del segundo por defecto (fallo intermitente en main, F8).
configure({ asyncUtilTimeout: 3000 });

// Las pruebas comprueban los textos en español (jsdom dice «en-US»). F7-06.
localStorage.setItem("delyra-locale", "es");

/** `(min-width: Npx)` / `(max-width: Npx)` según el ancho de jsdom (1024 px); lo demás, no. */
function matchesWidth(query: string): boolean {
  const width = window.innerWidth;
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  if (!min && !max) return false;
  return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
}

if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: matchesWidth(query),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// jsdom no implementa scroll; el router lo usa para restaurar la posición.
window.scrollTo = vi.fn();

afterEach(() => {
  cleanup();
});
