import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AppShell } from "../layout/app-shell";
import { ThemeProvider } from "../theme/theme-provider";
import { browserLocale, getLocale, LOCALE_STORAGE_KEY, setLocale, translateServer, ui } from ".";
import { LocaleProvider } from "./provider";
import { translateWith } from "./server-messages";

afterEach(async () => {
  await act(() => setLocale("es"));
});

describe("idioma (F7-06)", () => {
  it("elige el primero de los idiomas del navegador que existe; si no, español", () => {
    expect(browserLocale(["fr-FR", "en-US", "es-ES"])).toBe("en");
    expect(browserLocale(["es-MX", "en"])).toBe("es");
    expect(browserLocale(["de-DE"])).toBe("es");
    expect(browserLocale([])).toBe("es");
  });

  it("cambiar a inglés carga la traducción, la recuerda y marca la página", async () => {
    expect(ui().userMenu.signOut).toBe("Cerrar sesión");
    await setLocale("en");
    expect(getLocale()).toBe("en");
    expect(ui().userMenu.signOut).toBe("Sign out");
    expect(ui().errors.apiStatus(503)).toBe("The API responded HTTP 503");
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
  });

  it("la app se vuelve a pintar en el idioma nuevo desde el menú de usuario", async () => {
    render(
      <ThemeProvider>
        <LocaleProvider>
          <AppShell app="work" user={{ name: "Ana López" }}>
            <p>contenido</p>
          </AppShell>
        </LocaleProvider>
      </ThemeProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Menú de usuario/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "English" }));
    expect(await screen.findByRole("button", { name: /User menu/ })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Work/ })).toHaveAttribute("aria-current", "page");
  });

  it("traduce los mensajes del servidor por texto exacto o por patrón, y deja el resto igual", () => {
    const table = {
      exact: { "Sesión caducada": "Session expired" },
      patterns: [[/^Máximo (\d+) personas$/, (n: string) => `At most ${n} people`]] as const,
    };
    expect(translateWith(table, "Sesión caducada")).toBe("Session expired");
    expect(translateWith(table, "Máximo 20 personas")).toBe("At most 20 people");
    expect(translateWith(table, "Otra cosa")).toBe("Otra cosa");
    // En español no se toca nada.
    expect(translateServer("Sesión caducada")).toBe("Sesión caducada");
  });
});
