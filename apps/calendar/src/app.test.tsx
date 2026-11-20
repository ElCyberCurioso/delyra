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
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("App (calendario)", () => {
  it("muestra la página provisional con el estado de /api/health", async () => {
    render(
      <ThemeProvider>
        <QueryClientProvider client={new QueryClient()}>
          <App />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Calendario" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Calendario/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await screen.findByText("Operativo")).toBeInTheDocument();
  });
});
