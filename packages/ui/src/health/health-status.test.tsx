import type { HealthResponse } from "@delyra/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { HealthStatus } from "./health-status";

const healthy: HealthResponse = {
  status: "ok",
  environment: "production",
  version: "0123456789abcdef",
  time: "2026-11-20T10:00:00.000Z",
  checks: {
    d1: { status: "ok", latencyMs: 4 },
    r2: { status: "ok", latencyMs: 12 },
    queues: { status: "ok", latencyMs: 7 },
  },
};

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderStatus() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HealthStatus />
    </QueryClientProvider>,
  );
}

describe("HealthStatus", () => {
  it("muestra operativo y el detalle de cada componente", async () => {
    server.use(http.get("/api/health", () => HttpResponse.json(healthy)));
    renderStatus();
    expect(await screen.findByText("Operativo")).toBeInTheDocument();
    expect(screen.getByText("Base de datos (D1)")).toBeInTheDocument();
    expect(screen.getByText("12 ms")).toBeInTheDocument();
    expect(screen.getByText("Producción")).toBeInTheDocument();
    expect(screen.getByText("01234567")).toBeInTheDocument();
  });

  it("muestra degradado cuando la API responde 503", async () => {
    server.use(
      http.get("/api/health", () =>
        HttpResponse.json(
          {
            ...healthy,
            status: "degraded",
            checks: { ...healthy.checks, r2: { status: "error", latencyMs: 3000 } },
          },
          { status: 503 },
        ),
      ),
    );
    renderStatus();
    expect(await screen.findByText("Degradado")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("muestra sin conexión si la respuesta no es válida", async () => {
    server.use(
      http.get("/api/health", () => HttpResponse.text("<html>Access</html>", { status: 200 })),
    );
    renderStatus();
    // useHealth reintenta una vez (1 s) antes de dar el error.
    expect(
      await screen.findByText("Sin conexión con la API", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
  });
});
