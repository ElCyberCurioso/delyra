import type { BoardDetail, CardDetail } from "@delyra/shared";
import { ThemeProvider } from "@delyra/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    {
      id: "c1",
      name: "Por hacer",
      position: "a0",
      wipLimit: null,
      isDone: false,
      delegated: false,
    },
    { id: "c2", name: "Haciendo", position: "a1", wipLimit: 1, isDone: false, delegated: false },
    { id: "c3", name: "Hecho", position: "a2", wipLimit: null, isDone: true, delegated: false },
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
      kind: "task",
      assignee: null,
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
      kind: "task",
      assignee: null,
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
      kind: "task",
      assignee: null,
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
    // El nombre sale del contenido: tipo, título y el resto de lo que se ve.
    expect(first).toHaveAccessibleName(/^Tarea\..*Comprar pan/);
    expect(first).toHaveTextContent("Recados");
    expect(first).toHaveTextContent("Alta");
    expect(first).toHaveTextContent("1/2");
  });

  it("filtra por texto desde la URL", async () => {
    renderAt("/tableros/b1?q=barn");
    await screen.findByRole("heading", { level: 1, name: "Casa" });
    expect(screen.getAllByTestId("card").map((c) => c.querySelector("p")?.textContent)).toEqual([
      "Barnizar",
    ]);
    // (dnd-kit tiene su propia región viva con role="status").
    expect(screen.getByText(/1 tarjeta coincide/)).toHaveAttribute("role", "status");
  });

  it("abre el detalle con ?tarjeta= y muestra la descripción saneada", async () => {
    const router = renderAt("/tableros/b1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Comprar pan/ }));
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
    await user.click(screen.getByRole("button", { name: /Comprar pan/ }));
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

describe("Reuniones de Teams en el tablero", () => {
  it("al volver de Microsoft abre los ajustes y vuelca las reuniones en la columna elegida", async () => {
    const requests: unknown[] = [];
    let info = {
      enabled: true,
      connection: { email: "ana@contoso.com", status: "ok" },
      sync: null as Record<string, unknown> | null,
    };
    server.use(
      http.get("/api/microsoft/boards/b1", () => HttpResponse.json(info)),
      http.put("/api/microsoft/boards/b1", async ({ request }) => {
        requests.push(await request.json());
        info = {
          ...info,
          sync: {
            mine: true,
            columnId: detail.columns[1]?.id,
            onlyTeams: true,
            daysAhead: 7,
            status: "ok",
            error: null,
            cards: 2,
            lastSyncedAt: "2027-01-02T10:00:00.000Z",
            nextSyncAt: "2027-01-02T10:15:00.000Z",
          },
        };
        return HttpResponse.json(info);
      }),
    );
    const user = userEvent.setup();
    const router = renderAt("/tableros/b1?microsoft=conectada");

    const dialog = await screen.findByRole("dialog", { name: "Ajustes del tablero" });
    const section = await within(dialog).findByRole("region", { name: "Reuniones de Teams" });
    expect(within(section).getByText("Conectado como ana@contoso.com.")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toEqual({}));

    await user.selectOptions(
      within(section).getByLabelText("Columna para las reuniones nuevas"),
      detail.columns[1]?.id ?? "",
    );
    await user.selectOptions(within(section).getByLabelText("Con antelación"), "7");
    expect(within(section).getByLabelText(/Solo reuniones de Teams/)).toBeChecked();
    await user.click(within(section).getByRole("button", { name: "Volcar las reuniones" }));

    expect(await within(section).findByText(/2 reuniones en el tablero/)).toBeInTheDocument();
    expect(requests).toEqual([{ columnId: detail.columns[1]?.id, onlyTeams: true, daysAhead: 7 }]);
    expect(within(section).getByRole("button", { name: "Actualizar ahora" })).toBeInTheDocument();
  });
});

describe("Tipos de tarjeta y tareas que dependen de otra persona", () => {
  it("al pasar una tarjeta a una columna delegada pide el nombre y lo muestra", async () => {
    const waiting = {
      id: "c4",
      name: "Esperando a otros",
      position: "a3",
      wipLimit: null,
      isDone: false,
      delegated: true,
    };
    const withWaiting: BoardDetail = { ...detail, columns: [...detail.columns, waiting] };
    const moves: unknown[] = [];
    server.use(
      http.get("/api/boards/b1", () => HttpResponse.json(withWaiting)),
      http.post("/api/cards/k1/move", async ({ request }) => {
        const body = (await request.json()) as { columnId: string; assignee?: string };
        moves.push(body);
        return HttpResponse.json({
          card: { ...card, columnId: body.columnId, assignee: body.assignee ?? null },
          wipExceeded: false,
        });
      }),
    );
    const user = userEvent.setup();
    renderAt("/tableros/b1?tarjeta=k1");

    // La tarjeta enseña su tipo de un vistazo.
    const [column] = await screen.findAllByTestId("column");
    if (!column) throw new Error("Sin columnas");
    expect(within(column).getAllByText("Tarea").length).toBeGreaterThan(0);

    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Columna"), "c4");
    const ask = await screen.findByRole("dialog", { name: "¿A quién se la pasas?" });
    await user.click(within(ask).getByRole("button", { name: "Pasar la tarea" }));
    expect(within(ask).getByText("Escribe a quién se la pasas.")).toBeInTheDocument();
    await user.type(within(ask).getByLabelText(/Nombre de la persona/), "Laura (gestoría)");
    await user.click(within(ask).getByRole("button", { name: "Pasar la tarea" }));

    await waitFor(() =>
      expect(moves).toEqual([{ columnId: "c4", index: 10_000, assignee: "Laura (gestoría)" }]),
    );
  });
});

describe("Detalle de tarjeta: los cambios se guardan con el botón", () => {
  /** PATCH recibidos; la respuesta es la tarjeta con lo que llegó encima. */
  function recordPatches() {
    const patches: Record<string, unknown>[] = [];
    server.use(
      http.patch("/api/cards/k1", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patches.push(body);
        return HttpResponse.json({ card: { ...card, ...body } });
      }),
    );
    return patches;
  }

  it("elegir fecha, hora y prioridad no sube nada hasta «Guardar cambios», que lo manda de una vez", async () => {
    const patches = recordPatches();
    const user = userEvent.setup();
    renderAt("/tableros/b1?tarjeta=k1");
    const dialog = await screen.findByRole("dialog");
    const save = await within(dialog).findByRole("button", { name: "Guardar cambios" });
    expect(save).toBeDisabled();

    // Como en el navegador: cada parte que se toca (día, hora, minutos) da un valor completo.
    const due = within(dialog).getByLabelText("Fecha límite", { selector: "input" });
    fireEvent.change(due, { target: { value: "2027-05-10T09:00" } });
    fireEvent.change(due, { target: { value: "2027-05-12T09:00" } });
    fireEvent.change(due, { target: { value: "2027-05-12T17:30" } });
    await user.selectOptions(within(dialog).getByLabelText("Prioridad"), "low");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Cambios sin guardar");
    expect(patches).toEqual([]);

    await user.click(save);
    await waitFor(() => expect(patches).toHaveLength(1));
    // Solo lo que cambió, y una sola fecha (17:30 en Madrid son las 15:30 UTC).
    expect(patches[0]).toEqual({
      priority: "low",
      due: { allDay: false, at: "2027-05-12T15:30:00.000Z", tz: "Europe/Madrid" },
    });
    await waitFor(() => expect(save).toBeDisabled());
    expect(within(dialog).getByRole("status")).toHaveTextContent("");
  });

  it("cerrar con cambios sin guardar pregunta antes y no los pierde sin avisar", async () => {
    const patches = recordPatches();
    const user = userEvent.setup();
    const router = renderAt("/tableros/b1?tarjeta=k1");
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(await within(dialog).findByLabelText("Prioridad"), "low");

    // Esc: se queda abierta, con el cambio, si se sigue editando.
    await user.keyboard("{Escape}");
    let ask = await screen.findByRole("dialog", { name: "¿Salir sin guardar?" });
    await user.click(within(ask).getByRole("button", { name: "Seguir editando" }));
    await waitFor(() => expect(ask).not.toBeInTheDocument());
    expect(router.state.location.search).toEqual({ tarjeta: "k1" });
    expect(within(dialog).getByLabelText("Prioridad")).toHaveValue("low");

    // La X: «Guardar y cerrar» lo manda y cierra.
    await user.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    ask = await screen.findByRole("dialog", { name: "¿Salir sin guardar?" });
    await user.click(within(ask).getByRole("button", { name: "Guardar y cerrar" }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(patches).toEqual([{ priority: "low" }]);
  });

  it("«Descartar cambios» cierra sin mandar nada", async () => {
    const patches = recordPatches();
    const user = userEvent.setup();
    const router = renderAt("/tableros/b1?tarjeta=k1");
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("checkbox", { name: "Recados" }));
    await user.keyboard("{Escape}");
    const ask = await screen.findByRole("dialog", { name: "¿Salir sin guardar?" });
    await user.click(within(ask).getByRole("button", { name: "Descartar cambios" }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(patches).toEqual([]);
  });
});

describe("Alta de tarjetas", () => {
  it("se cierra al añadir; con «Añadir otra» se queda abierta y vacía, y se recuerda", async () => {
    localStorage.removeItem("delyra.work.addAnother");
    const created: { columnId: string; title: string }[] = [];
    server.use(
      http.post("/api/columns/:id/cards", async ({ request, params }) => {
        const body = (await request.json()) as { title: string };
        const columnId = String(params.id);
        created.push({ columnId, title: body.title });
        return HttpResponse.json(
          { card: { ...card, id: `n${String(created.length)}`, title: body.title, columnId } },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderAt("/tableros/b1");
    const [todo] = await screen.findAllByTestId("column");
    if (!todo) throw new Error("Sin columnas");
    const title = /Título de la nueva tarjeta en Por hacer/;

    // Por defecto, tras añadir se cierra.
    await user.click(within(todo).getByRole("button", { name: /Añadir tarjeta/ }));
    await user.type(within(todo).getByLabelText(title), "Leche{Enter}");
    await waitFor(() => expect(within(todo).queryByLabelText(title)).not.toBeInTheDocument());
    expect(created).toEqual([{ columnId: "c1", title: "Leche" }]);

    // «Añadir otra»: sigue abierto, vacío y con el foco para la siguiente.
    await user.click(within(todo).getByRole("button", { name: /Añadir tarjeta/ }));
    const another = within(todo).getByRole("checkbox", { name: "Añadir otra" });
    expect(another).not.toBeChecked();
    await user.click(another);
    const input = within(todo).getByLabelText(title);
    await user.type(input, "Huevos{Enter}");
    await waitFor(() => expect(created).toHaveLength(2));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(input).toHaveFocus();
    await user.type(input, "Pan{Enter}");
    await waitFor(() => expect(created.map((c) => c.title)).toEqual(["Leche", "Huevos", "Pan"]));
    expect(within(todo).getByLabelText(title)).toBeInTheDocument();

    // Se recuerda en este navegador: al volver a abrir sigue marcada.
    expect(localStorage.getItem("delyra.work.addAnother")).toBe("on");
    await user.click(within(todo).getByRole("button", { name: "Cancelar" }));
    await user.click(within(todo).getByRole("button", { name: /Añadir tarjeta/ }));
    expect(within(todo).getByRole("checkbox", { name: "Añadir otra" })).toBeChecked();
    localStorage.removeItem("delyra.work.addAnother");
  });
});
