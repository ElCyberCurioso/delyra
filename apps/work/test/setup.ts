import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Las páginas se cargan bajo demanda (`lazyRouteComponent`): en un runner de CI lento, la primera
// espera de `findBy…` puede pasar del segundo por defecto (fallo intermitente en main, F8).
configure({ asyncUtilTimeout: 3000 });

// Las pruebas comprueban los textos en español (jsdom dice «en-US»). F7-06.
localStorage.setItem("delyra-locale", "es");

if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
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

afterEach(() => {
  cleanup();
});
