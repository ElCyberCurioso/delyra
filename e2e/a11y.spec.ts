import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { registerNewUser, remote } from "./support/session";

/**
 * Accesibilidad (F7-06): axe-core con las reglas de WCAG 2.0, 2.1 y 2.2 (A y AA) sobre las
 * pantallas principales, en tema claro y oscuro. Escribe datos: solo en local.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectAccessible(page: Page, name: string) {
  // Las animaciones de entrada (mosaicos, diálogos) dan falsos fallos de contraste a media
  // opacidad: se mide cuando han terminado todas las finitas (los indicadores de carga giran sin fin).
  await page.waitForTimeout(400);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  // FullCalendar no deja enfocar sus zonas con scroll sin romper la semántica de su rejilla
  // (aria-required-children). Los eventos sí son enfocables y la vista Lista («L») es la
  // alternativa accesible: ver ADR-0012.
  results.violations = results.violations
    .map((v) =>
      v.id === "scrollable-region-focusable"
        ? { ...v, nodes: v.nodes.filter((n) => !n.target.join(" ").includes(".fc-")) }
        : v,
    )
    .filter((v) => v.nodes.length > 0);
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact ?? "?"}): ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" "))
        .join(" | ")}`,
  );
  expect(summary, `${name}: ${summary.join("\n")}`).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  test(`pantallas sin sesión, tema ${scheme}`, async ({ page, baseURL }) => {
    test.skip(test.info().project.name !== "calendar", "Basta con un proyecto");
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(new URL("/login", baseURL).href);
    await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await expectAccessible(page, "login");
    await page.goto(new URL("/privacidad", baseURL).href);
    await expectAccessible(page, "privacidad");
  });

  test(`calendario y trabajo con sesión, tema ${scheme}`, async ({ page, baseURL }) => {
    test.skip(remote, "Escribe datos: solo se ejecuta en local");
    test.skip(test.info().project.name !== "work", "Basta con un proyecto");
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: scheme });
    await registerNewUser(page);

    // Calendario (origen 5173), con el editor de eventos abierto.
    await expectAccessible(page, "calendario");
    await page.getByRole("button", { name: "Nuevo evento" }).first().click();
    await expect(page.getByRole("dialog", { name: "Nuevo evento" })).toBeVisible();
    await expectAccessible(page, "editor de eventos");
    await page.keyboard.press("Escape");
    await page.goto(new URL("/ajustes", page.url()).href);
    await expect(page.getByRole("heading", { level: 1, name: "Ajustes" })).toBeVisible();
    await expectAccessible(page, "ajustes");
    await page.goto(new URL("/importar", page.url()).href);
    await expect(
      page.getByRole("heading", { level: 1, name: "Importar desde Google Calendar" }),
    ).toBeVisible();
    await expectAccessible(page, "importar");

    // Trabajo: lista, tablero, tarjeta y compartir.
    await page.goto(new URL("/", baseURL).href);
    await expect(page.getByRole("heading", { level: 1, name: "Tableros" })).toBeVisible();
    await expectAccessible(page, "tableros");
    await page.getByRole("button", { name: "Nuevo tablero" }).first().click();
    const create = page.getByRole("dialog", { name: "Nuevo tablero" });
    await create.getByLabel("Nombre").fill("Accesible");
    await create.getByRole("button", { name: "Crear tablero" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Accesible" })).toBeVisible();
    const column = page
      .getByTestId("column")
      .filter({ has: page.getByRole("heading", { level: 2, name: "Por hacer" }) });
    await column.getByRole("button", { name: "Añadir tarjeta en Por hacer" }).click();
    await column.getByLabel("Título de la nueva tarjeta en Por hacer").fill("Revisar contraste");
    await column.getByLabel("Título de la nueva tarjeta en Por hacer").press("Enter");
    await expect(column.getByTestId("card")).toHaveCount(1);
    await expectAccessible(page, "tablero");
    await column.getByRole("button", { name: "Revisar contraste" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectAccessible(page, "tarjeta");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Compartir" }).click();
    await expect(page.getByRole("dialog", { name: "Compartir el tablero" })).toBeVisible();
    await expectAccessible(page, "compartir");
  });
}
