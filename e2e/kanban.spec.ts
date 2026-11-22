import { expect, type Locator, type Page, test } from "@playwright/test";
import { registerNewUser, remote } from "./support/session";

/**
 * Kanban (F4-12): crear un tablero desde plantilla, arrastrar tarjetas con ratón y con teclado,
 * reordenar columnas y comprobar que todo persiste al recargar. Escribe datos: solo en local.
 */

const column = (page: Page, name: string) =>
  page.getByTestId("column").filter({ has: page.getByRole("heading", { level: 2, name }) });

const cardsIn = (col: Locator) => col.getByTestId("card");

async function addCard(page: Page, columnName: string, title: string) {
  const col = column(page, columnName);
  const input = col.getByLabel(`Título de la nueva tarjeta en ${columnName}`);
  if (!(await input.isVisible())) {
    await col.getByRole("button", { name: `Añadir tarjeta en ${columnName}` }).click();
  }
  await input.fill(title);
  await input.press("Enter");
  await expect(cardsIn(col).filter({ hasText: title })).toBeVisible();
}

/** Arrastre con ratón en varios pasos (el sensor necesita moverse más de 6 px). */
async function drag(page: Page, source: Locator, target: Locator) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Sin caja para arrastrar");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 20 });
  await page.mouse.up();
}

/** Lo que anuncia dnd-kit a los lectores de pantalla (y señal de que el paso ya se aplicó). */
const announced = (page: Page, text: string, timeout?: number) =>
  expect(page.getByRole("status").filter({ hasText: text })).toBeAttached({ timeout });

/**
 * Gesto de teclado completo: coger con espacio, flechas y soltar. El sensor de dnd-kit empieza a
 * escuchar las teclas en un `setTimeout` tras coger, así que se deja una pausa como la de una
 * persona; si aun así se pierde una tecla (timers lentos en CI), se cancela con Escape y se repite.
 */
async function keyboardDrag(
  page: Page,
  handle: Locator,
  pickedUp: string,
  steps: [key: string, announcement: string][],
) {
  let attempt = 0;
  await expect(async () => {
    // Un intento anterior a medias se cancela antes de repetir.
    if (attempt++ > 0) await page.keyboard.press("Escape");
    await handle.focus();
    await page.keyboard.press("Space");
    await announced(page, pickedUp, 2_000);
    await page.waitForTimeout(250);
    for (const [key, text] of steps) {
      await page.keyboard.press(key);
      await announced(page, text, 2_000);
    }
    await page.keyboard.press("Space");
  }).toPass({ timeout: 30_000 });
}

const titles = async (col: Locator) =>
  (await cardsIn(col).allInnerTexts()).map((text) => text.split("\n").at(-1)?.trim() ?? "");

test("tablero: plantilla, arrastrar con ratón y teclado, reordenar columnas", async ({
  page,
  baseURL,
}) => {
  test.skip(remote, "Escribe datos: solo se ejecuta en local");
  test.skip(test.info().project.name !== "work", "Basta con un proyecto");
  test.setTimeout(180_000);
  await registerNewUser(page);

  await page.goto(new URL("/", baseURL).href);
  await expect(page.getByRole("heading", { level: 1, name: "Tableros" })).toBeVisible();
  await page.getByRole("button", { name: "Nuevo tablero" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Nuevo tablero" });
  await dialog.getByLabel("Nombre").fill("Mudanza");
  await dialog.getByLabel(/^Personal/).check();
  await dialog.getByRole("button", { name: "Crear tablero" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mudanza" })).toBeVisible();
  await expect(page.getByTestId("column").getByRole("heading", { level: 2 })).toHaveText([
    "Por hacer",
    "Haciendo",
    "Hecho",
  ]);

  await addCard(page, "Por hacer", "Cajas");
  await addCard(page, "Por hacer", "Furgoneta");
  await addCard(page, "Por hacer", "Llaves");

  // Ratón: «Cajas» a «Haciendo».
  await drag(
    page,
    cardsIn(column(page, "Por hacer")).filter({ hasText: "Cajas" }),
    column(page, "Haciendo"),
  );
  await expect(cardsIn(column(page, "Haciendo"))).toHaveText([/Cajas/]);
  await expect(cardsIn(column(page, "Por hacer"))).toHaveCount(2);

  // Teclado: «Llaves» sube al principio de su columna (espacio, flecha arriba, espacio).
  await keyboardDrag(
    page,
    cardsIn(column(page, "Por hacer")).filter({ hasText: "Llaves" }),
    "«Llaves» está en su sitio, en «Por hacer».",
    [["ArrowUp", "«Llaves» está sobre «Furgoneta», en «Por hacer»."]],
  );
  await expect.poll(() => titles(column(page, "Por hacer"))).toEqual(["Llaves", "Furgoneta"]);

  // Teclado entre columnas: «Furgoneta» a la derecha, a «Haciendo».
  await keyboardDrag(
    page,
    cardsIn(column(page, "Por hacer")).filter({ hasText: "Furgoneta" }),
    "«Furgoneta» está en su sitio, en «Por hacer».",
    [["ArrowRight", "en «Haciendo»"]],
  );
  await expect(cardsIn(column(page, "Haciendo")).filter({ hasText: "Furgoneta" })).toBeVisible();

  // Intro abre el detalle; desde ahí se mueve a «Hecho» y queda terminada.
  await cardsIn(column(page, "Por hacer")).filter({ hasText: "Llaves" }).focus();
  await page.keyboard.press("Enter");
  const detail = page.getByRole("dialog");
  await expect(detail.getByLabel("Columna")).toHaveValue(/.+/);
  await detail.getByLabel("Columna").selectOption({ label: "Hecho" });
  await expect(detail.getByText(/terminada el/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(cardsIn(column(page, "Hecho"))).toHaveText([/Llaves/]);

  // Columnas: «Hecho» al principio con el teclado desde su asa.
  await keyboardDrag(
    page,
    page.getByRole("button", { name: "Mover la columna Hecho" }),
    "Columna «Hecho» en su sitio.",
    [
      ["ArrowLeft", "Columna «Hecho» junto a «Haciendo»."],
      ["ArrowLeft", "Columna «Hecho» junto a «Por hacer»."],
    ],
  );
  await expect(page.getByTestId("column").getByRole("heading", { level: 2 })).toHaveText([
    "Hecho",
    "Por hacer",
    "Haciendo",
  ]);

  // Todo persiste al recargar.
  await page.reload();
  await expect(page.getByTestId("column").getByRole("heading", { level: 2 })).toHaveText([
    "Hecho",
    "Por hacer",
    "Haciendo",
  ]);
  await expect
    .poll(() => titles(column(page, "Haciendo")))
    .toEqual(expect.arrayContaining(["Cajas", "Furgoneta"]));
  expect(await titles(column(page, "Por hacer"))).toEqual([]);
  expect(await titles(column(page, "Hecho"))).toEqual(["Llaves"]);
});
