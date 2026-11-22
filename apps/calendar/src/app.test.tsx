import type * as DelyraUi from "@delyra/ui";
import { ThemeProvider } from "@delyra/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { useEffect } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "./router";

// Turnstile real necesita la red de Cloudflare: en las pruebas entrega el token de prueba.
vi.mock("@delyra/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof DelyraUi>();
  return {
    ...actual,
    Turnstile: ({ onToken }: { onToken: (token: string | null) => void }) => {
      useEffect(() => onToken("XXXX.DUMMY.TOKEN.XXXX"), [onToken]);
      return null;
    },
  };
});

type State = "anonymous" | "pending_2fa" | "pending_totp" | "active";
let sessionState: State = "anonymous";
const user = { id: "u1", email: "ana@example.com", name: "Ana", role: "admin" as const };

function meResponse() {
  if (sessionState === "anonymous") {
    return HttpResponse.json(
      { type: "about:blank", title: "Autenticación requerida", status: 401 },
      { status: 401 },
    );
  }
  return HttpResponse.json({
    state: sessionState,
    user: sessionState === "pending_2fa" ? null : user,
    settings:
      sessionState === "active" ? { timeZone: "Europe/Madrid", locale: "es", weekStart: 1 } : null,
  });
}

const requests: { path: string; body: unknown }[] = [];
const eventRanges: { from: string; to: string }[] = [];
const CALENDAR_ID = "01a1fa43-8aed-7103-b1ae-9ca51d83586b";

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
  http.get("/api/auth/me", meResponse),
  http.get("/api/calendars", () =>
    HttpResponse.json({
      calendars: [
        {
          id: CALENDAR_ID,
          name: "Personal",
          color: "#7c5cff",
          kind: "personal",
          visible: true,
          position: 0,
          readOnly: false,
        },
      ],
    }),
  ),
  http.get("/api/cards/due", () => HttpResponse.json({ cards: [] })),
  http.get("/api/holidays", () =>
    HttpResponse.json({
      region: "ES-MD",
      holidays: [{ date: "2026-12-25", name: "Natividad del Señor", regional: false }],
    }),
  ),
  http.get("/api/events", ({ request }) => {
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    eventRanges.push({ from, to });
    // Un evento a mitad del rango visible, sea cual sea la fecha de hoy.
    const start = new Date((Date.parse(from) + Date.parse(to)) / 2);
    start.setUTCHours(9, 0, 0, 0);
    return HttpResponse.json({
      events: [
        {
          id: "e1",
          eventId: "e1",
          calendarId: CALENDAR_ID,
          type: "event",
          title: "Dentista",
          notes: null,
          location: null,
          url: null,
          allDay: false,
          start: start.toISOString(),
          end: new Date(start.getTime() + 3_600_000).toISOString(),
          tz: "Europe/Madrid",
          recurring: false,
          originalStart: null,
          age: null,
        },
      ],
    });
  }),
  http.get("/api/auth/config", () =>
    HttpResponse.json({ turnstileSiteKey: "1x00000000000000000000AA" }),
  ),
  http.post("/api/auth/login", async ({ request }) => {
    const body = await request.json();
    requests.push({ path: "login", body });
    sessionState = "pending_2fa";
    return HttpResponse.json({ next: "2fa" });
  }),
  http.post("/api/auth/login/second-factor", async ({ request }) => {
    const body = (await request.json()) as { code: string };
    requests.push({ path: "second-factor", body });
    if (body.code !== "123456") {
      return HttpResponse.json(
        { type: "about:blank", title: "No autorizado", status: 401, detail: "Código incorrecto" },
        { status: 401 },
      );
    }
    sessionState = "active";
    return HttpResponse.json({ next: "done", remainingRecoveryCodes: 10 });
  }),
);

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  sessionState = "anonymous";
  requests.length = 0;
  eventRanges.length = 0;
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(
    <ThemeProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return router;
}

const IMPORT_ID = "01a1fa43-8aed-7103-b1ae-9ca51d835999";

function importInfo(status: "ready" | "importing" | "succeeded") {
  return {
    id: IMPORT_ID,
    source: "file",
    status,
    filename: "takeout.zip",
    calendars: [
      {
        key: "0",
        name: "Personal",
        color: null,
        timeZone: "Europe/Madrid",
        events: 120,
        recurring: 4,
        withReminders: 30,
        birthdays: 0,
        firstStart: "2024-01-08T09:00:00.000Z",
        lastStart: "2026-12-28T09:00:00.000Z",
        suggestedCalendarId: CALENDAR_ID,
        suggestSkip: false,
      },
      {
        key: "1",
        name: "Festivos en España",
        color: "#16a765",
        timeZone: "Europe/Madrid",
        events: 40,
        recurring: 0,
        withReminders: 0,
        birthdays: 0,
        firstStart: null,
        lastStart: null,
        suggestedCalendarId: null,
        suggestSkip: true,
      },
    ],
    warnings: ["Se han descartado 2 eventos"],
    progress: { done: status === "succeeded" ? 120 : 0, total: 120 },
    report:
      status === "succeeded"
        ? { created: 118, updated: 0, unchanged: 2, skipped: 0, calendars: [], warnings: [] }
        : null,
    error: null,
    createdAt: "2026-11-22T10:00:00.000Z",
    finishedAt: status === "succeeded" ? "2026-11-22T10:01:00.000Z" : null,
  };
}

describe("Importar desde Google (F5-03)", () => {
  it("vista previa: destino sugerido, festivos sin importar y el informe al terminar", async () => {
    sessionState = "active";
    let status: "ready" | "succeeded" = "ready";
    server.use(
      http.get(`/api/imports/${IMPORT_ID}`, () =>
        HttpResponse.json({ import: importInfo(status) }),
      ),
      http.post(`/api/imports/${IMPORT_ID}/start`, async ({ request }) => {
        requests.push({ path: "start", body: await request.json() });
        status = "succeeded";
        return HttpResponse.json({ import: importInfo("importing") }, { status: 202 });
      }),
    );
    renderAt(`/importar?import=${IMPORT_ID}`);
    const user = userEvent.setup();
    const personal = await screen.findByLabelText("Destino de «Personal»");
    expect(personal).toHaveValue(CALENDAR_ID);
    expect(screen.getByLabelText("Destino de «Festivos en España»")).toHaveValue("skip");
    expect(screen.getByText(/120 eventos · 4 series · 30 con alertas/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Importar" }));
    expect(requests.find((r) => r.path === "start")?.body).toEqual({
      reminders: true,
      calendars: [
        { key: "0", target: "existing", calendarId: CALENDAR_ID },
        { key: "1", target: "skip" },
      ],
    });
    expect(
      await screen.findByText("Importación terminada", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("118")).toBeInTheDocument();
  });

  it("las páginas de privacidad y condiciones son públicas", async () => {
    sessionState = "anonymous";
    renderAt("/privacidad");
    expect(
      await screen.findByRole("heading", { name: "Política de privacidad" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/calendar\.readonly/).length).toBeGreaterThan(0);
  });
});

describe("App (calendario)", () => {
  it("con sesión completa muestra el calendario con los eventos del rango visible", async () => {
    sessionState = "active";
    renderAt("/");
    expect(await screen.findByRole("button", { name: "Nuevo evento" })).toBeInTheDocument();
    expect(await screen.findByText("Dentista")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Personal" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Semana" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("link", { name: /Calendario/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const [range] = eventRanges;
    expect(range && Date.parse(range.to) - Date.parse(range.from)).toBe(7 * 86_400_000);
  });

  it("en el móvil: vista de 3 días, botón flotante y calendarios en una hoja", async () => {
    sessionState = "active";
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    try {
      renderAt("/");
      const user = userEvent.setup();
      expect(await screen.findByRole("radio", { name: "3 días" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(screen.queryByRole("radio", { name: "Semana" })).toBeNull();
      // (jsdom no aplica CSS: la barra lateral también está en el DOM.)
      const floating = screen
        .getAllByRole("button", { name: "Nuevo evento" })
        .find((button) => button.className.includes("fixed"));
      expect(floating).toBeDefined();
      await user.click(screen.getByRole("button", { name: "Calendarios y filtros" }));
      const sheet = await screen.findByRole("dialog", { name: "Calendarios y filtros" });
      expect(within(sheet).getByRole("checkbox", { name: "Personal" })).toBeChecked();
      expect(
        within(sheet).getByRole("checkbox", { name: "Tareas con fecha límite" }),
      ).toBeChecked();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    }
  });

  it("atajos de teclado: «?» abre la ayuda y no se disparan al escribir", async () => {
    sessionState = "active";
    renderAt("/");
    const user = userEvent.setup();
    await screen.findByText("Dentista");
    await user.type(screen.getByLabelText("Buscar eventos"), "?");
    expect(screen.queryByRole("dialog", { name: "Atajos de teclado" })).toBeNull();
    await user.click(document.body);
    await user.keyboard("?");
    expect(await screen.findByRole("dialog", { name: "Atajos de teclado" })).toBeInTheDocument();
    expect(screen.getByText("Nuevo evento", { selector: "dd" })).toBeInTheDocument();
  });

  it("sin sesión lleva al login recordando a dónde volver", async () => {
    const router = renderAt("/");
    expect(await screen.findByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ next: "http://localhost:5173/" });
  });

  it("login con contraseña, luego TOTP, y vuelta al inicio", async () => {
    const userEvents = userEvent.setup();
    const router = renderAt("/login");
    await userEvents.type(await screen.findByLabelText("Email"), "Ana@Example.com");
    await userEvents.type(screen.getByLabelText("Contraseña"), "una contraseña muy segura");
    await userEvents.click(screen.getByRole("button", { name: "Continuar" }));

    expect(
      await screen.findByRole("heading", { name: "Verificación en dos pasos" }),
    ).toBeInTheDocument();
    expect(requests[0]?.body).toEqual({
      email: "ana@example.com",
      password: "una contraseña muy segura",
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    });

    await userEvents.type(screen.getByLabelText("Código"), "000000");
    await userEvents.click(screen.getByRole("button", { name: "Verificar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Código incorrecto");

    await userEvents.clear(screen.getByLabelText("Código"));
    await userEvents.type(screen.getByLabelText("Código"), "123456");
    await userEvents.click(screen.getByRole("button", { name: "Verificar" }));
    expect(await screen.findByRole("button", { name: "Nuevo evento" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("valida el formulario antes de llamar a la API", async () => {
    const userEvents = userEvent.setup();
    renderAt("/login");
    await userEvents.type(await screen.findByLabelText("Email"), "no-es-un-email");
    await userEvents.click(screen.getByRole("button", { name: "Continuar" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true"),
    );
    expect(requests).toHaveLength(0);
  });

  it("tras el segundo factor vuelve a la ruta propia de ?next=", async () => {
    sessionState = "pending_2fa";
    const userEvents = userEvent.setup();
    const router = renderAt("/login/verificar?next=%2Fajustes");
    await userEvents.type(await screen.findByLabelText("Código"), "123456");
    await userEvents.click(screen.getByRole("button", { name: "Verificar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/ajustes"));
  });

  it("no acepta destinos externos en ?next=", async () => {
    sessionState = "pending_2fa";
    const userEvents = userEvent.setup();
    const router = renderAt("/login/verificar?next=https%3A%2F%2Fevil.example%2F");
    await userEvents.type(await screen.findByLabelText("Código"), "123456");
    await userEvents.click(screen.getByRole("button", { name: "Verificar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("un enlace de registro sin token muestra que la invitación no es válida", async () => {
    renderAt("/registro");
    expect(
      await screen.findByRole("heading", { name: "Invitación no válida" }),
    ).toBeInTheDocument();
  });
});
