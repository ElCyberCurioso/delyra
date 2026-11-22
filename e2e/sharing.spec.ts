import { expect, type Page, test } from "@playwright/test";
import { registerNewUser, remote } from "./support/session";

/**
 * Tableros compartidos y en vivo (F7-04, F7-05): una persona invita a otra, que acepta y ve al
 * momento lo que cambia la primera (y al revés), hasta que pierde el acceso. Dos navegadores
 * con sesiones distintas. Escribe datos: solo en local.
 */

const column = (page: Page, name: string) =>
  page.getByTestId("column").filter({ has: page.getByRole("heading", { level: 2, name }) });

async function addCard(page: Page, columnName: string, title: string) {
  const col = column(page, columnName);
  await col.getByRole("button", { name: `Añadir tarjeta en ${columnName}` }).click();
  const input = col.getByLabel(`Título de la nueva tarjeta en ${columnName}`);
  await input.fill(title);
  await input.press("Enter");
  await expect(col.getByTestId("card").filter({ hasText: title })).toBeVisible();
}

test("compartir un tablero y verlo cambiar en vivo", async ({ browser, baseURL }) => {
  test.skip(remote, "Escribe datos: solo se ejecuta en local");
  test.skip(test.info().project.name !== "work", "Basta con un proyecto");
  test.setTimeout(240_000);
  const ownerContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const guest = await guestContext.newPage();
  await registerNewUser(owner);
  const { email } = await registerNewUser(guest);

  await owner.goto(new URL("/", baseURL).href);
  await owner.getByRole("button", { name: "Nuevo tablero" }).first().click();
  const create = owner.getByRole("dialog", { name: "Nuevo tablero" });
  await create.getByLabel("Nombre").fill("Reforma");
  await create.getByRole("button", { name: "Crear tablero" }).click();
  await expect(owner.getByRole("heading", { level: 1, name: "Reforma" })).toBeVisible();

  // Invitar por email, como editor.
  await owner.getByRole("button", { name: "Compartir" }).click();
  const share = owner.getByRole("dialog", { name: "Compartir el tablero" });
  await share.getByLabel("Email").fill(email);
  await share.getByRole("button", { name: "Invitar" }).click();
  await expect(share.getByText(email)).toBeVisible();
  await owner.keyboard.press("Escape");

  // Quien recibe la invitación la acepta desde su lista de tableros.
  await guest.goto(new URL("/", baseURL).href);
  await guest.getByRole("button", { name: "Aceptar la invitación a Reforma" }).click();
  await expect(guest.getByRole("heading", { level: 1, name: "Reforma" })).toBeVisible();
  await expect(guest.getByText("Puede editar · de Persona E2E")).toBeVisible();

  // Cada una ve a la otra y sus cambios, sin recargar.
  await expect(owner.getByText("También aquí: Persona E2E")).toBeVisible();
  await expect(guest.getByText("También aquí: Persona E2E")).toBeVisible();
  await addCard(owner, "Por hacer", "Azulejos");
  await expect(column(guest, "Por hacer").getByTestId("card")).toHaveText(/Azulejos/);
  await addCard(guest, "Haciendo", "Pintura");
  await expect(column(owner, "Haciendo").getByTestId("card")).toHaveText(/Pintura/);

  // Pasa a solo lectura: su tablero pierde los controles de edición al momento.
  await owner.getByRole("button", { name: /Compartir/ }).click();
  await share.getByLabel("Permiso de Persona E2E").selectOption("reader");
  await expect(guest.getByText("Solo lectura · de Persona E2E")).toBeVisible();
  await expect(guest.getByRole("button", { name: /Añadir tarjeta/ })).toHaveCount(0);

  // Y al quitarle el acceso, se le cierra el tablero.
  owner.once("dialog", (dialog) => void dialog.accept());
  await share.getByRole("button", { name: "Quitar a Persona E2E del tablero" }).click();
  await expect(guest.getByText("Ya no tienes acceso a este tablero.")).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Tablero no disponible" })).toBeVisible();
  await expect(owner.getByText("También aquí")).toHaveCount(0);

  await ownerContext.close();
  await guestContext.close();
});
