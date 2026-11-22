import type { BoardDetail, CardDetail } from "@delyra/shared";
import { ThemeProvider } from "@delyra/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createAppRouter } from "./router";

const detail: BoardDetail = {
  board: {
    id: "b1",
    name: "Casa",
    template: "personal",
    autoarchiveDays: 14,
    openCards: 2,
    createdAt: "2027-01-01T00:00:00.000Z",
  },
  columns: [
    { id: "c1", name: "Por hacer", position: "a0", wipLimit: null, isDone: false },
    { id: "c2", name: "Haciendo", position: "a1", wipLimit: 1, isDone: false },
    { id: "c3", name: "Hecho", position: "a2", wipLimit: null, isDone: true },
  ],
  labels: [{ id: "l1", name: "Recados", color: "#27ae60" }],
  cards: [
    {
      id: "k1",
      columnId: "c1",
      title: "Comprar pan",
      position: "a0",
      priority: "high",
      due: null,
      completedAt: null,
      archivedAt: null,
      labelIds: ["l1"],
      checklist: { done: 1, total: 2 },
      comments: 0,
      attachments: 0,
      hasDescription: true,
    },
    {
      id: "k2",
      columnId: "c2",
      title: "Pintar",
      position: "a0",
      priority: "none",
      due: null,
      completedAt: null,
      archivedAt: null,
      labelIds: [],
      checklist: { done: 0, total: 0 },
      comments: 0,
      attachments: 0,
      hasDescription: false,
    },
    {
      id: "k3",
      columnId: "c2",
      title: "Barnizar",
      position: "a1",
      priority: "none",
      due: null,
      completedAt: null,
      archivedAt: null,
      labelIds: [],
      checklist: { done: 0, total: 0 },
      comments: 0,
      attachments: 0,
      hasDescription: false,
    },
  ],
};

const card: CardDetail = {
  ...detail.cards[0]!,
  boardId: "b1",
  description: "Del **horno** de abajo <script>alert(1)</script>",
  checklistItems: [
    { id: "i1", text: "Barra", done: true },
    { id: "i2", text: "Integral", done: false },
  ],
  commentList: [],
  attachmentList: [],
  activity: [
    {
      id: "a1",
      kind: "created",
      data: { column: "Por hacer" },
      createdAt: "2027-01-01T10:00:00.000Z",
    },
  ],
  reminders: [],
};

const server = setupServer(
  http.get("/api/auth/me", () =>
    HttpResponse.json({
      state: "active",
      user: { id: "u1", email: "ana@example.com", name: "Ana López", role: "member" },
      settings: { timeZone: "Europe/Madrid", locale: "es", weekStart: 1 },
    }),
  ),
  http.get("/api/boards", () =>
    HttpResponse.json({
      boards: [
        {
          id: "b1",
          name: "Casa",
          template: "personal",
          autoarchiveDays: 14,
          openCards: 2,
          createdAt: "2027-01-01T00:00:00.000Z",
        },
      ],
    }),
  ),
  http.get("/api/boards/b1", () => HttpResponse.json(detail)),
  http.get("/api/cards/k1", () => HttpResponse.json({ card })),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
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

describe("App (trabajo)", () => {
  it("lista los tableros con la cabecera común", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Tableros" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Menú de usuario" })).toHaveTextContent("Ana López");
    expect(screen.getByRole("link", { name: /Trabajo/ })).toHaveAttribute("aria-current", "page");
    const link = await screen.findByRole("link", { name: /Casa/ });
    expect(link).toHaveAttribute("href", "/tableros/b1");
    expect(link).toHaveTextContent("2 tarjetas abiertas");
  });

  it("pinta columnas, tarjetas y el aviso de WIP superado", async () => {
    renderAt("/tableros/b1");
    expect(await screen.findByRole("heading", { level: 1, name: "Casa" })).toBeInTheDocument();
    const columns = screen.getAllByTestId("column");
    expect(columns.map((c) => within(c).getByRole("heading", { level: 2 }).textContent)).toEqual([
      "Por hacer",
      "Haciendo",
      "Hecho",
    ]);
    const doing = columns[1]!;
    expect(within(doing).getByText("2/1")).toBeInTheDocument();
    expect(within(doing).getByText("(supera el límite WIP)", { exact: false })).toBeInTheDocument();
    const first = within(columns[0]!).getByTestId("card");
    expect(first).toHaveAccessibleName("Comprar pan");
    expect(first).toHaveTextContent("Recados");
    expect(first).toHaveTextContent("Alta");
    expect(first).toHaveTextContent("1/2");
  });

  it("filtra por texto desde la URL", async () => {
    renderAt("/tableros/b1?q=barn");
    await screen.findByRole("heading", { level: 1, name: "Casa" });
    expect(screen.getAllByTestId("card").map((c) => c.getAttribute("aria-label"))).toEqual([
      "Barnizar",
    ]);
    // (dnd-kit tiene su propia región viva con role="status").
    expect(screen.getByText(/1 tarjeta coincide/)).toHaveAttribute("role", "status");
  });

  it("abre el detalle con ?tarjeta= y muestra la descripción saneada", async () => {
    const router = renderAt("/tableros/b1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Comprar pan" }));
    expect(router.state.location.search).toEqual({ tarjeta: "k1" });
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("horno")).toContainHTML("<strong>horno</strong>");
    expect(dialog.querySelector("script")).toBeNull();
    expect(within(dialog).getByRole("checkbox", { name: "Barra" })).toBeChecked();
    expect(within(dialog).getByRole("heading", { name: "Lista (1/2)" })).toBeInTheDocument();
    expect(within(dialog).getByText("Creada en «Por hacer»")).toBeInTheDocument();
  });
});
