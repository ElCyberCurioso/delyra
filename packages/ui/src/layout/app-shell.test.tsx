import { APP_ORIGINS } from "@delyra/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "../theme/theme-provider";
import { AppShell } from "./app-shell";

function renderShell(app: "calendar" | "work", origins = APP_ORIGINS.production) {
  return render(
    <ThemeProvider>
      <AppShell app={app} user={{ name: "Ana López", email: "ana@example.com" }} origins={origins}>
        <p>contenido</p>
      </AppShell>
    </ThemeProvider>,
  );
}

describe("AppShell", () => {
  it("marca la app actual y enlaza a la otra por su dominio", () => {
    renderShell("work");
    const nav = screen.getByRole("navigation", { name: "Aplicaciones" });
    const calendar = within(nav).getByRole("link", { name: /Calendario/ });
    const work = within(nav).getByRole("link", { name: /Trabajo/ });
    expect(calendar).toHaveAttribute("href", "https://delyra.app/");
    expect(calendar).not.toHaveAttribute("aria-current");
    expect(work).toHaveAttribute("href", "https://work.delyra.app/");
    expect(work).toHaveAttribute("aria-current", "page");
  });

  it("deduce los orígenes del entorno actual si no se pasan", () => {
    render(
      <ThemeProvider>
        <AppShell app="calendar" user={null}>
          <p>x</p>
        </AppShell>
      </ThemeProvider>,
    );
    // jsdom corre en http://localhost:5173 → entorno de desarrollo.
    expect(screen.getByRole("link", { name: /Trabajo/ })).toHaveAttribute(
      "href",
      "http://localhost:5174/",
    );
  });

  it("ofrece un enlace para saltar al contenido", () => {
    renderShell("calendar");
    expect(screen.getByRole("link", { name: "Saltar al contenido" })).toHaveAttribute(
      "href",
      "#contenido",
    );
    expect(screen.getByRole("main")).toHaveTextContent("contenido");
  });

  it("cambia el tema desde el menú de usuario", async () => {
    renderShell("calendar");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Menú de usuario/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Oscuro/ }));
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("delyra-theme")).toBe("dark");
  });
});
