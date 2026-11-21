import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { totp } from "./totp";

/** Alta y acceso de usuarios en los e2e locales (escriben en la D1 local, nunca en producción). */

export const remote = Boolean(process.env.E2E_CALENDAR_URL);
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password -- contraseña ficticia de prueba
export const PASSWORD = "frase larga de prueba e2e 2026";

/** Crea la invitación en la D1 local con el mismo script que usa el administrador. */
export function createInvitation(email: string): string {
  const output = execFileSync(
    process.execPath,
    [path.join("scripts", "create-invitation.mjs"), "--local", "--email", email],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const link = /http:\/\/localhost:5173\/registro#token=[\w-]+/.exec(output)?.[0];
  if (!link) throw new Error("El script no devolvió un enlace de registro");
  return link;
}

/** Con la site key de prueba, Turnstile se resuelve solo; hay que esperar a que dé el token. */
export async function waitForTurnstile(page: Page) {
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, {
    timeout: 20_000,
  });
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

export async function signIn(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Verificación en dos pasos" })).toBeVisible();
}

/** La pantalla principal del calendario ya está cargada. */
export async function expectCalendar(page: Page) {
  await expect(page.getByRole("button", { name: "Nuevo evento" })).toBeVisible();
}

/**
 * Invitación → registro → alta del TOTP → códigos de recuperación → calendario.
 * Devuelve el email, la semilla TOTP y el primer código de recuperación.
 */
export async function registerNewUser(page: Page) {
  const email = `e2e-${randomUUID().slice(0, 8)}@example.com`;
  await page.goto(createInvitation(email));
  await expect(page.getByText(email)).toBeVisible();
  expect(page.url()).not.toContain("token=");
  await page.getByLabel("Nombre").fill("Persona E2E");
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Repite la contraseña").fill(PASSWORD);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Crear cuenta" }).click();

  await expect(page).toHaveURL(/\/configurar-2fa/);
  const secret = ((await page.locator("details code").textContent()) ?? "").replace(/\s+/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel("Código de 6 dígitos").fill(totp(secret));
  await page.getByRole("button", { name: "Activar" }).click();

  const codes = page.getByRole("list", { name: "Códigos de recuperación" }).getByRole("listitem");
  await expect(codes).toHaveCount(10);
  const recoveryCode = (await codes.first().textContent()) ?? "";
  await page.getByLabel("He guardado los códigos en un lugar seguro.").check();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expectCalendar(page);
  return { email, secret, recoveryCode };
}
