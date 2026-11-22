import { expect, test } from "@playwright/test";
import { remote } from "./support/session";

/**
 * Presupuesto de rendimiento en producción (F7-07), tras cada despliegue: LCP de la pantalla de
 * acceso por debajo de 2,5 s y la respuesta a una interacción (aproximación de INP con la Event
 * Timing API) por debajo de 200 ms. En local (servidor de desarrollo) no es representativo.
 */

test("LCP e interacción dentro del presupuesto @smoke", async ({ page }) => {
  test.skip(!remote, "Solo contra producción");
  test.skip(test.info().project.name !== "calendar", "Basta con un proyecto");
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();

  const lcp = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          resolve(entries.at(-1)?.startTime ?? 0);
        }).observe({ type: "largest-contentful-paint", buffered: true });
        setTimeout(() => resolve(-1), 5_000);
      }),
  );
  test.info().annotations.push({ type: "LCP", description: `${String(Math.round(lcp))} ms` });
  expect(lcp).toBeGreaterThan(0);
  expect(lcp).toBeLessThan(2_500);

  await page.evaluate(() => {
    const store = window as unknown as { __maxEvent: number };
    store.__maxEvent = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        store.__maxEvent = Math.max(store.__maxEvent, entry.duration);
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  });
  // Enviar el formulario vacío: valida en el cliente y muestra los errores.
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Email").click();
  await page.keyboard.type("a");
  await page.waitForTimeout(500);
  const inp = await page.evaluate(() => (window as unknown as { __maxEvent: number }).__maxEvent);
  test.info().annotations.push({ type: "INP", description: `${String(Math.round(inp))} ms` });
  expect(inp).toBeLessThan(200);
});
