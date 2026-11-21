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
