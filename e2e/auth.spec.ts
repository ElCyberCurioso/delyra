import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { totp } from "./support/totp";

/**
 * Flujo completo de identidad (F1-18) con el TOTP generado en el propio test. Escribe datos,
 * así que solo se ejecuta en local (nunca contra producción) y en un único proyecto.
 */

const remote = Boolean(process.env.E2E_CALENDAR_URL);
const workURL = process.env.E2E_WORK_URL ?? "http://localhost:5174";
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password -- contraseña ficticia de prueba
const PASSWORD = "frase larga de prueba e2e 2026";

/** Crea la invitación en la D1 local con el mismo script que usa el administrador. */
function createInvitation(email: string): string {
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
async function waitForTurnstile(page: Page) {
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, {
    timeout: 20_000,
  });
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function signIn(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Verificación en dos pasos" })).toBeVisible();
}

test("invitación → registro → TOTP → login con TOTP y con código de recuperación", async ({
  page,
}) => {
  test.skip(remote, "Escribe datos: solo se ejecuta en local");
  test.skip(test.info().project.name !== "calendar", "Basta con un proyecto");
  test.setTimeout(120_000);

  const email = `e2e-${randomUUID().slice(0, 8)}@example.com`;
  await page.goto(createInvitation(email));

  // Registro: el token sale del fragmento y desaparece de la barra de direcciones.
  await expect(page.getByText(email)).toBeVisible();
  expect(page.url()).not.toContain("token=");
  await page.getByLabel("Nombre").fill("Persona E2E");
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Repite la contraseña").fill(PASSWORD);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Crear cuenta" }).click();

  // Alta obligatoria del TOTP.
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
  await expect(page.getByRole("heading", { level: 1, name: "Calendario" })).toBeVisible();

  // Sesión común: la app de trabajo reconoce la misma cookie.
  await page.goto(workURL);
  await expect(page.getByRole("heading", { level: 1, name: "Trabajo" })).toBeVisible();

  // Login en dos pasos con un TOTP posterior (el ya usado se rechazaría por anti-replay).
  await signOut(page);
  await signIn(page, email);
  await page.getByLabel("Código").fill(totp(secret, 1));
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Calendario" })).toBeVisible();

  // Sin el móvil: código de recuperación, que solo vale una vez.
  await signOut(page);
  await signIn(page, email);
  await page.getByRole("button", { name: /código de recuperación/ }).click();
  await page.getByLabel("Código de recuperación").fill(recoveryCode);
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Calendario" })).toBeVisible();

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
