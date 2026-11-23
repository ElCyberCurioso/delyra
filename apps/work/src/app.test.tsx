import type { BoardDetail, CardDetail } from "@delyra/shared";
import { ThemeProvider } from "@delyra/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, ws } from "msw";
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
    role: "owner",
    ownerName: null,
    members: 0,
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
      color: null,
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
      color: null,
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
      color: null,
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
      actorName: "Ana López",
    },
  ],
  reminders: [],
};

/** Canal en vivo del tablero (F7-05). */
const live = ws.link("ws://localhost:5174/api/boards/:id/live");

/** Tablero de otra persona, compartido en modo lectura. */
const shared: BoardDetail = {
  ...detail,
  board: { ...detail.board, role: "reader", ownerName: "Bea Ruiz", members: 2 },
};
const sharedCard: CardDetail = {
  ...card,
  commentList: [
    {
      id: "m1",
      body: "Ya está pedido",
      createdAt: "2027-01-02T10:00:00.000Z",
      updatedAt: "2027-01-02T10:00:00.000Z",
      authorName: "Bea Ruiz",
      mine: false,
    },
  ],
};

const server = setupServer(
  live.addEventListener("connection", () => undefined),
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
          role: "owner",
          ownerName: null,
          members: 0,
        },
      ],
    }),
  ),
  http.get("/api/board-invitations", () => HttpResponse.json({ invitations: [] })),
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
    expect(screen.getByRole("button", { name: /Menú de usuario/ })).toHaveTextContent("Ana López");
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

describe("tableros compartidos (F7-04, F7-05)", () => {
  it("acepta una invitación pendiente y abre el tablero", async () => {
    let answered = "";
    server.use(
      http.get("/api/board-invitations", () =>
        HttpResponse.json({
          invitations: [
            {
              id: "inv1",
              boardName: "Obra",
              invitedBy: "Bea Ruiz",
              role: "editor",
              expiresAt: "2027-01-15T00:00:00.000Z",
            },
          ],
        }),
      ),
      http.post("/api/board-invitations/:id/accept", ({ params }) => {
        answered = String(params.id);
        return HttpResponse.json({ boardId: "b1" });
      }),
    );
    const router = renderAt("/");
    const user = userEvent.setup();
    expect(await screen.findByText("Bea Ruiz te invita · Puede editar")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Aceptar la invitación a Obra" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/tableros/b1"));
    expect(answered).toBe("inv1");
  });

  it("en modo lectura no hay controles de edición", async () => {
    server.use(
      http.get("/api/boards/b1", () => HttpResponse.json(shared)),
      http.get("/api/cards/k1", () => HttpResponse.json({ card: sharedCard })),
    );
    renderAt("/tableros/b1");
    expect(await screen.findByText("Solo lectura · de Bea Ruiz")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Columna" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ajustes" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Añadir tarjeta/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Mover la columna/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Personas/ })).toHaveTextContent("3");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Comprar pan" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Ya está pedido")).toBeInTheDocument();
    expect(within(dialog).getByText("Bea Ruiz")).toBeInTheDocument();
    expect(within(dialog).getByText("Ana López:")).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: "Nuevo comentario" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Borrar" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Archivar" })).toBeNull();
    expect(within(dialog).getByRole("combobox", { name: "Prioridad" })).toBeDisabled();
    expect(within(dialog).getByRole("checkbox", { name: "Barra" })).toBeDisabled();
  });

  it("muestra quién más mira el tablero y se refresca con los cambios de otros", async () => {
    let loads = 0;
    server.use(
      http.get("/api/boards/b1", () => {
        loads += 1;
        return HttpResponse.json(detail);
      }),
      live.addEventListener("connection", ({ client }) => {
        client.send(
          JSON.stringify({
            type: "presence",
            users: [
              { id: "u1", name: "Ana López" },
              { id: "u2", name: "Bea Ruiz" },
              { id: "u2", name: "Bea Ruiz" },
            ],
          }),
        );
        // Un cambio propio no hace falta pedirlo de nuevo; uno de otra persona, sí.
        client.send(JSON.stringify({ type: "changed", by: "u1" }));
        client.send(JSON.stringify({ type: "changed", by: "u2" }));
      }),
    );
    renderAt("/tableros/b1");
    expect(await screen.findByText("También aquí: Bea Ruiz")).toBeInTheDocument();
    await waitFor(() => expect(loads).toBe(2));
  });

  it("el dueño invita por email con el permiso elegido", async () => {
    let sent: unknown = null;
    const members = {
      role: "owner",
      members: [
        { userId: "u1", name: "Ana López", role: "owner", email: "ana@example.com", you: true },
      ],
      invitations: [] as unknown[],
    };
    server.use(
      http.get("/api/boards/b1/members", () => HttpResponse.json(members)),
      http.post("/api/boards/b1/invitations", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(
          {
            ...members,
            invitations: [
              {
                id: "inv2",
                email: "bea@example.com",
                role: "reader",
                createdAt: "2027-01-01T00:00:00.000Z",
                expiresAt: "2027-01-15T00:00:00.000Z",
              },
            ],
          },
          { status: 201 },
        );
      }),
    );
    renderAt("/tableros/b1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Compartir" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("ana@example.com")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Email"), "bea@example.com");
    await user.selectOptions(within(dialog).getByLabelText("Permiso"), "reader");
    await user.click(within(dialog).getByRole("button", { name: "Invitar" }));
    expect(await within(dialog).findByText("Invitaciones pendientes")).toBeInTheDocument();
    expect(sent).toEqual({ email: "bea@example.com", role: "reader" });
  });
});
