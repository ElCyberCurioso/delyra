import { expect, test } from "@playwright/test";
import {
  expectCalendar,
  PASSWORD,
  registerNewUser,
  remote,
  signIn,
  signOut,
} from "./support/session";
import { totp } from "./support/totp";

/**
 * Llaves de acceso (F7-09) con el autenticador virtual de Chromium (DevTools Protocol): alta
 * desde Ajustes y login con la llave en lugar del código. Escribe datos: solo en local.
 */

test("alta de una llave de acceso y login con ella en lugar del código", async ({
  page,
  browserName,
}) => {
  test.skip(remote, "Escribe datos: solo se ejecuta en local");
  test.skip(test.info().project.name !== "calendar", "Basta con un proyecto");
  test.skip(browserName !== "chromium", "El autenticador virtual es de Chromium");
  test.setTimeout(120_000);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  const { email, secret } = await registerNewUser(page);

  await page.goto(new URL("/ajustes#verificacion", page.url()).href);
  const panel = page.getByRole("region", { name: "Llaves de acceso" });
  await expect(panel.getByText("Todavía no tienes ninguna.")).toBeVisible();
  await panel.getByRole("button", { name: "Añadir llave" }).click();
  const dialog = page.getByRole("dialog", { name: "Añadir una llave de acceso" });
  await dialog.getByLabel("Contraseña").fill(PASSWORD);
  await dialog.getByLabel(/Código actual/).fill(totp(secret, 1));
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await dialog.getByLabel(/Nombre de la llave/).fill("Llave virtual");
  await dialog.getByRole("button", { name: "Crear la llave" }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByText("Llave virtual")).toBeVisible();
  await expect(panel.getByText("sin usar todavía")).toBeVisible();

  // Login: contraseña y, en el segundo paso, la llave en lugar del código.
  await signOut(page);
  await signIn(page, email);
  await page.getByRole("button", { name: "Usar una llave de acceso" }).click();
  await expectCalendar(page);

  await page.goto(new URL("/ajustes#verificacion", page.url()).href);
  await expect(panel.getByText(/último uso el/)).toBeVisible();
  // El historial de la cuenta recoge el alta.
  await expect(page.getByText("Llave de acceso añadida").first()).toBeVisible();
});
