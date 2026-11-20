import { ThemeProvider } from "@delyra/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "./app";

const server = setupServer(
  http.get("/api/health", () =>
    HttpResponse.json({
      status: "ok",
      environment: "development",
      version: null,
      time: new Date().toISOString(),
      checks: {
        d1: { status: "ok", latencyMs: 1 },
        r2: { status: "ok", latencyMs: 1 },
        queues: { status: "ok", latencyMs: 1 },
      },
    }),
  ),
  http.get("/api/auth/me", () =>
    HttpResponse.json({
      state: "active",
      user: { id: "u1", email: "ana@example.com", name: "Ana López", role: "member" },
      settings: { timeZone: "Europe/Madrid", locale: "es", weekStart: 1 },
    }),
  ),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("App (trabajo)", () => {
  it("con sesión completa muestra la página provisional, el usuario y /api/health", async () => {
    render(
      <ThemeProvider>
        <QueryClientProvider client={new QueryClient()}>
          <App />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Trabajo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Menú de usuario" })).toHaveTextContent("Ana López");
    expect(screen.getByRole("link", { name: /Trabajo/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Calendario/ })).toHaveAttribute(
      "href",
      "http://localhost:5173/",
    );
    expect(await screen.findByText("Operativo")).toBeInTheDocument();
  });
});
