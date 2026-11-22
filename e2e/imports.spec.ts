import { expect, test } from "@playwright/test";
import { registerNewUser, remote } from "./support/session";

/**
 * Importación desde Google (F5-03, F5-07): subir una exportación .ics, elegir destino, seguir
 * el progreso y ver los eventos en el calendario. Repetirla no duplica nada.
 */

const crlf = (lines: string[]) => `${lines.join("\r\n")}\r\n`;

const ICS = crlf([
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "X-WR-CALNAME:Personal de Google",
  "X-WR-TIMEZONE:Europe/Madrid",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Madrid:20270301T100000",
  "DTEND;TZID=Europe/Madrid:20270301T110000",
  "RRULE:FREQ=WEEKLY;COUNT=3",
  "UID:yoga-e2e@google.com",
  "SUMMARY:Yoga importado",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-PT15M",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
]);

test("importar un .ics de Google dos veces sin duplicar", async ({ page }) => {
  test.skip(remote, "Escribe datos: solo se ejecuta en local");
  test.skip(test.info().project.name !== "calendar", "Basta con un proyecto");
  test.setTimeout(150_000);
  await registerNewUser(page);

  for (const round of [1, 2]) {
    await page.goto("/importar");
    await page
      .getByLabel("Archivo (.zip o .ics, hasta 25 MB)")
      .setInputFiles({ name: "google.ics", mimeType: "text/calendar", buffer: Buffer.from(ICS) });
    await page.getByRole("button", { name: "Subir y ver qué contiene" }).click();

    const target = page.getByLabel("Destino de «Personal de Google»");
    await expect(target).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/1 evento · 1 serie · 1 con alerta/)).toBeVisible();
    if (round === 1) {
      await expect(target).toHaveValue("new");
      await expect(page.getByLabel("Nombre del calendario nuevo")).toHaveValue(
        "Personal de Google",
      );
    }
    await page.getByRole("button", { name: "Importar" }).click();
    await expect(page.getByText("Importación terminada")).toBeVisible({ timeout: 30_000 });
    const created = page.locator("dl > div", { hasText: "Nuevos" });
    const already = page.locator("dl > div", { hasText: "Ya estaban" });
    await expect(created).toContainText(round === 1 ? "1" : "0");
    await expect(already).toContainText(round === 1 ? "0" : "1");
  }

  // En el calendario: tres lunes, una sola vez cada uno.
  await page.getByRole("link", { name: "Ver el calendario" }).click();
  await page.getByLabel("Buscar eventos").fill("Yoga importado");
  await page
    .getByRole("region", { name: "Resultados de la búsqueda" })
    .getByRole("button", { name: /Yoga importado/ })
    .first()
    .click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".fc-timegrid-event", { hasText: "Yoga importado" })).toHaveCount(1);
});

test("política de privacidad y condiciones, sin sesión @smoke", async ({ page }) => {
  test.skip(test.info().project.name !== "calendar", "Solo en el calendario");
  await page.goto("/privacidad");
  await expect(
    page.getByRole("heading", { level: 1, name: "Política de privacidad" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Condiciones" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Condiciones de uso" })).toBeVisible();
});
