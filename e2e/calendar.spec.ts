import { expect, type Page, test } from "@playwright/test";
import { registerNewUser, remote } from "./support/session";

/**
 * Calendario (F2-14): serie semanal, mover una ocurrencia («solo este») y cambiar «este y los
 * siguientes». Escribe datos: solo en local y en un único proyecto.
 */

const events = (page: Page, title: string) =>
  page.locator(".fc-timegrid-event", { hasText: title });

async function openEvent(page: Page, title: string) {
  await events(page, title).first().click();
  await expect(page.getByRole("dialog", { name: "Editar evento" })).toBeVisible();
  return page.getByRole("dialog", { name: "Editar evento" });
}

async function saveWithScope(page: Page, scope: "Solo este" | "Este y los siguientes") {
  await page
    .getByRole("dialog", { name: "Editar evento" })
    .getByRole("button", { name: "Guardar" })
    .click();
  await page
    .getByRole("dialog", { name: "Guardar cambios" })
    .getByRole("button", { name: scope })
    .click();
  await expect(page.getByRole("dialog", { name: "Editar evento" })).toBeHidden();
}

test("serie semanal: crear, mover una ocurrencia y cambiar «este y los siguientes»", async ({
  page,
}) => {
  test.skip(remote, "Escribe datos: solo se ejecuta en local");
  test.skip(test.info().project.name !== "calendar", "Basta con un proyecto");
  test.setTimeout(150_000);
  await registerNewUser(page);

  // Crear: lunes 1 de marzo de 2027, de 10:00 a 11:00, cada semana.
  await page.getByRole("button", { name: "Nuevo evento" }).click();
  const create = page.getByRole("dialog", { name: "Nuevo evento" });
  await create.getByLabel("Título").fill("Natación");
  await create.getByLabel("Empieza").fill("2027-03-01");
  await create.getByLabel("Hora de inicio").fill("10:00");
  await create.getByLabel("Termina", { exact: true }).fill("2027-03-01");
  await create.getByLabel("Hora de fin").fill("11:00");
  await create.getByLabel("Repetición").selectOption("weekly");
  await create.getByRole("button", { name: "Guardar" }).click();
  await expect(create).toBeHidden();

  // La búsqueda lleva a la semana del evento.
  await page.getByLabel("Buscar eventos").fill("Natación");
  await page
    .getByRole("region", { name: "Resultados de la búsqueda" })
    .getByRole("button", { name: /Natación/ })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("1 – 7 mar 2027");
  await expect(events(page, "Natación")).toHaveCount(1);
  await expect(events(page, "Natación")).toContainText("10:00");

  // Mover solo la ocurrencia del 8 de marzo a las 12:00.
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  const second = await openEvent(page, "Natación");
  await second.getByLabel("Hora de inicio").fill("12:00");
  await second.getByLabel("Hora de fin").fill("13:00");
  await saveWithScope(page, "Solo este");
  await expect(events(page, "Natación")).toContainText("12:00");

  // Desde el 15 de marzo: «Natación avanzada».
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await expect(events(page, "Natación")).toContainText("10:00");
  const third = await openEvent(page, "Natación");
  await third.getByLabel("Título").fill("Natación avanzada");
  await saveWithScope(page, "Este y los siguientes");
  await expect(events(page, "Natación avanzada")).toHaveCount(1);

  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await expect(events(page, "Natación avanzada")).toHaveCount(1);

  // Las semanas anteriores no cambian.
  await page.getByRole("button", { name: "Anterior", exact: true }).click();
  await page.getByRole("button", { name: "Anterior", exact: true }).click();
  await expect(events(page, "Natación")).toContainText("12:00");
  await expect(events(page, "Natación avanzada")).toHaveCount(0);
  await page.getByRole("button", { name: "Anterior", exact: true }).click();
  await expect(events(page, "Natación")).toContainText("10:00");
});

test("arrastrar un evento con el ratón pide confirmación antes de moverlo", async ({ page }) => {
  test.skip(remote, "Escribe datos: solo se ejecuta en local");
  test.skip(test.info().project.name !== "calendar", "Basta con un proyecto");
  test.setTimeout(120_000);
  await registerNewUser(page);

  // Evento suelto: miércoles 3 de marzo de 2027, de 10:00 a 11:00.
  await page.getByRole("button", { name: "Nuevo evento" }).click();
  const create = page.getByRole("dialog", { name: "Nuevo evento" });
  await create.getByLabel("Título").fill("Revisión dental");
  await create.getByLabel("Empieza").fill("2027-03-03");
  await create.getByLabel("Hora de inicio").fill("10:00");
  await create.getByLabel("Termina", { exact: true }).fill("2027-03-03");
  await create.getByLabel("Hora de fin").fill("11:00");
  await create.getByRole("button", { name: "Guardar" }).click();
  await expect(create).toBeHidden();
  await page.getByLabel("Buscar eventos").fill("Revisión dental");
  await page
    .getByRole("region", { name: "Resultados de la búsqueda" })
    .getByRole("button", { name: /Revisión dental/ })
    .click();
  await page.keyboard.press("Escape");

  const event = events(page, "Revisión dental");
  await expect(event).toContainText("10:00");
  // La categoría (su calendario) va en una etiqueta.
  await expect(event.locator(".delyra-chip")).toHaveText("Personal");

  // Arrastrar desde el borde superior (10:00) hasta la franja de las 12:00.
  async function dragToNoon() {
    // Un diálogo que se cierra (el de crear, el de confirmar) sigue montado, con su fondo por
    // encima de todo, hasta acabar la animación de salida. En CI puede tardar y el ratón pulsaría
    // sobre ese fondo en vez de sobre el evento (y seleccionaría texto en lugar de arrastrar).
    await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
    // La rejilla es alta: primero, que se vean el evento y la franja de las 12:00.
    const noonSlot = page.locator('td.fc-timegrid-slot-lane[data-time="12:00:00"]');
    await noonSlot.scrollIntoViewIfNeeded();
    await event.scrollIntoViewIfNeeded();
    const box = await event.boundingBox();
    const noon = await noonSlot.boundingBox();
    if (!box || !noon) throw new Error("Sin posiciones");
    const x = box.x + box.width / 2;
    await page.mouse.move(x, box.y + 6);
    await page.mouse.down();
    await page.mouse.move(x, box.y + 20, { steps: 5 });
    await page.mouse.move(x, noon.y + 6, { steps: 20 });
    await page.mouse.up();
  }

  await dragToNoon();
  const confirm = page.getByRole("dialog", { name: "¿Mover el evento?" });
  await expect(confirm).toContainText("Antes: mié, 3 mar · 10:00–11:00");
  await expect(confirm).toContainText("Ahora: mié, 3 mar · 12:00–13:00");
  await confirm.getByRole("button", { name: "Cancelar" }).click();
  await expect(confirm).toBeHidden();
  await expect(event).toContainText("10:00");

  await dragToNoon();
  await confirm.getByRole("button", { name: "Mover" }).click();
  await expect(event).toContainText("12:00");
  // Guardado de verdad: tras recargar sigue a las 12:00.
  await page.reload();
  await page.getByLabel("Buscar eventos").fill("Revisión dental");
  await page
    .getByRole("region", { name: "Resultados de la búsqueda" })
    .getByRole("button", { name: /Revisión dental/ })
    .click();
  await page.keyboard.press("Escape");
  await expect(events(page, "Revisión dental")).toContainText("12:00");
});
