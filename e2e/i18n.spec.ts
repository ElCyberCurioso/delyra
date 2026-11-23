import { expect, test } from "@playwright/test";
import { registerNewUser, remote } from "./support/session";

/**
 * Inglés (F7-06): sin sesión se elige en la página de acceso; con sesión se guarda en la cuenta,
 * se aplica al momento y lo siguen las dos apps.
 */

test("el login se puede ver en inglés @smoke", async ({ page, baseURL }) => {
  test.skip(test.info().project.name !== "calendar", "Basta con un proyecto");
  await page.goto(new URL("/login", baseURL).href);
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Español" }).click();
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
});

test("el idioma de la cuenta se aplica en calendario y trabajo", async ({ page, baseURL }) => {
  test.skip(remote, "Escribe datos: solo se ejecuta en local");
  test.skip(test.info().project.name !== "work", "Basta con un proyecto");
  test.setTimeout(150_000);
  await registerNewUser(page);

  await page.getByRole("button", { name: /Menú de usuario/ }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "New event" }).first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Calendar · Delyra");

  // Se guarda en la cuenta: tras recargar y en la otra app sigue en inglés.
  await page.reload();
  await expect(page.getByRole("button", { name: "New event" }).first()).toBeVisible();
  await page.goto(new URL("/", baseURL).href);
  await expect(page.getByRole("heading", { level: 1, name: "Boards" })).toBeVisible();
  await page.getByRole("button", { name: "New board" }).first().click();
  const create = page.getByRole("dialog", { name: "New board" });
  await create.getByLabel("Name").fill("Moving house");
  await create.getByRole("button", { name: "Create board" }).click();
  // Las columnas de la plantilla se crean en el idioma de la página.
  await expect(page.getByTestId("column").getByRole("heading", { level: 2 })).toHaveText([
    "To do",
    "Doing",
    "Done",
  ]);

  // Y se vuelve al español desde el mismo menú.
  await page.getByRole("button", { name: /User menu/ }).click();
  await page.getByRole("menuitemradio", { name: "Español" }).click();
  await expect(page.getByRole("button", { name: "Compartir" })).toBeVisible();
});
