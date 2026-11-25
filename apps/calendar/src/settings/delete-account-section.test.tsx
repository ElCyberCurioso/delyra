import type * as DelyraUi from "@delyra/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DeleteAccountSection } from "./delete-account-section";

/** Eliminar la cuenta desde Ajustes (F8-12). */

const local = vi.hoisted(() => ({ clearOfflineData: vi.fn(), forgetUser: vi.fn() }));
vi.mock("@delyra/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof DelyraUi>()),
  clearOfflineData: local.clearOfflineData,
  forgetUser: local.forgetUser,
}));

let summary = { sharedBoards: 0, sharedWith: 0, lastAdmin: false };
const deletions: unknown[] = [];
const server = setupServer(
  http.get("/api/me/deletion", () => HttpResponse.json(summary)),
  http.delete("/api/me", async ({ request }) => {
    const body = (await request.json()) as { password: string; code: string };
    deletions.push(body);
    if (body.password !== "buena") {
      return HttpResponse.json(
        {
          type: "about:blank",
          title: "Bad Request",
          status: 400,
          detail: "La contraseña o el código no son correctos",
        },
        { status: 400 },
      );
    }
    return new HttpResponse(null, { status: 204 });
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  deletions.length = 0;
  vi.clearAllMocks();
});
afterAll(() => server.close());

function renderSection() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DeleteAccountSection />
    </QueryClientProvider>,
  );
}

describe("eliminar la cuenta (F8-12)", () => {
  it("avisa de los tableros compartidos y borra con contraseña y código", async () => {
    summary = { sharedBoards: 2, sharedWith: 1, lastAdmin: false };
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: "Eliminar mi cuenta…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tienes 2 tableros compartidos con 1 persona: se borrarán también para ella.",
    );

    await user.type(screen.getByLabelText("Contraseña"), "mala");
    await user.type(screen.getByLabelText("Código actual"), "123 456");
    await user.click(screen.getByRole("button", { name: "Eliminar mi cuenta para siempre" }));
    expect(await screen.findByText("La contraseña o el código no son correctos")).toBeVisible();
    expect(local.clearOfflineData).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Contraseña"));
    await user.type(screen.getByLabelText("Contraseña"), "buena");
    await user.click(screen.getByRole("button", { name: "Eliminar mi cuenta para siempre" }));
    await waitFor(() => expect(local.clearOfflineData).toHaveBeenCalled());
    expect(local.forgetUser).toHaveBeenCalled();
    expect(deletions.at(-1)).toEqual({ password: "buena", code: "123456" });
  });

  it("la única persona administradora no ve el formulario", async () => {
    summary = { sharedBoards: 0, sharedWith: 0, lastAdmin: true };
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: "Eliminar mi cuenta…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Eres la única persona administradora",
    );
    expect(screen.queryByLabelText("Contraseña")).toBeNull();
  });
});
