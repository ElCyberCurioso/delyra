import { expect, test } from "@playwright/test";
import { expectCalendar, registerNewUser, remote, signIn, signOut } from "./support/session";
import { totp } from "./support/totp";

/**
 * Flujo completo de identidad (F1-18) con el TOTP generado en el propio test. Escribe datos,
 * así que solo se ejecuta en local (nunca contra producción) y en un único proyecto.
 */

const workURL = process.env.E2E_WORK_URL ?? "http://localhost:5174";

test("invitación → registro → TOTP → login con TOTP y con código de recuperación", async ({
  page,
}) => {
  test.skip(remote, "Escribe datos: solo se ejecuta en local");
  test.skip(test.info().project.name !== "calendar", "Basta con un proyecto");
  test.setTimeout(120_000);

  const { email, secret, recoveryCode } = await registerNewUser(page);

  // Sesión común: la app de trabajo reconoce la misma cookie.
  await page.goto(workURL);
  await expect(page.getByRole("heading", { level: 1, name: "Tableros" })).toBeVisible();

  // Login en dos pasos con un TOTP posterior (el ya usado se rechazaría por anti-replay).
  await signOut(page);
  await signIn(page, email);
  await page.getByLabel("Código").fill(totp(secret, 1));
  await page.getByRole("button", { name: "Verificar" }).click();
  await expectCalendar(page);

  // Sin el móvil: código de recuperación, que solo vale una vez.
  await signOut(page);
  await signIn(page, email);
  await page.getByRole("button", { name: /código de recuperación/ }).click();
  await page.getByLabel("Código de recuperación").fill(recoveryCode);
  await page.getByRole("button", { name: "Verificar" }).click();
  await expectCalendar(page);

  // El historial de la cuenta recoge los accesos.
  await page.goto("/ajustes#actividad");
  await expect(page.getByText("Entrada con un código de recuperación")).toBeVisible();
});

test("una ruta protegida sin sesión lleva al login y vuelve a ella después", async ({ page }) => {
  test.skip(remote, "Solo en local");
  test.skip(test.info().project.name !== "calendar", "Basta con un proyecto");
  await page.goto("/ajustes");
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(new URL("/ajustes", page.url()).href);
});
