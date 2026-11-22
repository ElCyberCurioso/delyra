import { expect, type Page, test } from "@playwright/test";
import { registerNewUser, remote } from "./support/session";

/**
 * Copias de seguridad (F6-05, F6-09): crear una copia, borrar un evento, restaurar en modo
 * reemplazar (el evento vuelve) y deshacer (vuelve a no estar).
 */

async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const response = await fetch(path, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return response.status === 204 ? null : response.json();
    },
    { method, path, body },
  ) as Promise<T>;
}

async function titles(page: Page) {
  const result = await api<{ events: { title: string }[] }>(
    page,
    "GET",
    "/api/events?from=2027-05-01T00:00:00Z&to=2027-06-01T00:00:00Z",
  );
  return result.events.map((e) => e.title);
}

test("copia, borrar, restaurar reemplazando y deshacer", async ({ page }) => {
  test.skip(remote, "Escribe datos: solo se ejecuta en local");
  test.skip(test.info().project.name !== "calendar", "Basta con un proyecto");
  test.setTimeout(180_000);
  await registerNewUser(page);

  const { calendars } = await api<{ calendars: { id: string; kind: string }[] }>(
    page,
    "GET",
    "/api/calendars",
  );
  const { event } = await api<{ event: { id: string } }>(page, "POST", "/api/events", {
    calendarId: calendars.find((c) => c.kind === "personal")?.id,
    title: "Evento a salvar",
    allDay: false,
    start: "2027-05-10T08:00:00Z",
    end: "2027-05-10T09:00:00Z",
    tz: "Europe/Madrid",
  });

  await page.goto("/ajustes#copias");
  const section = page.locator("section#copias");
  await section.getByRole("button", { name: "Crear copia ahora" }).click();
  await expect(section.getByRole("link", { name: "Descargar" })).toBeVisible({ timeout: 30_000 });
  await expect(section.getByText(/Manual ·/)).toBeVisible();

  await api(page, "DELETE", `/api/events/${event.id}?scope=all`, {});
  expect(await titles(page)).toEqual([]);

  await section.getByRole("button", { name: "Restaurar", exact: true }).click();
  await expect(section.getByText("¿Cómo la restauro?")).toBeVisible({ timeout: 30_000 });
  await section.getByLabel(/Reemplazar/).check();
  await section.getByRole("button", { name: "Restaurar", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Reemplazar" }).click();
  await expect(section.getByText("Copia restaurada.")).toBeVisible({ timeout: 60_000 });
  expect(await titles(page)).toEqual(["Evento a salvar"]);

  await section.getByRole("button", { name: "Deshacer" }).click();
  await expect(section.getByText("Se ha deshecho la restauración.")).toBeVisible({
    timeout: 60_000,
  });
  expect(await titles(page)).toEqual([]);
});
