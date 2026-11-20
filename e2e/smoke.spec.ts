import { expect, test } from "@playwright/test";

const remote = Boolean(process.env.E2E_CALENDAR_URL);

test.describe("humo @smoke", () => {
  test("GET /api/health responde ok a través del Worker de la SPA", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(response.headers()["strict-transport-security"]).toContain("includeSubDomains");

    const body = (await response.json()) as {
      status: string;
      checks: Record<string, { status: string }>;
    };
    expect(body.status).toBe("ok");
    for (const component of ["d1", "r2", "queues"]) {
      expect(body.checks[component]?.status, component).toBe("ok");
    }
  });

  test("las rutas desconocidas de la API devuelven problem+json", async ({ request }) => {
    const response = await request.get("/api/no-existe");
    expect(response.status()).toBe(404);
    expect(response.headers()["content-type"]).toBe("application/problem+json");
  });

  test("la SPA carga y muestra el estado de la plataforma", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Aplicaciones" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText(/Operativo/);
  });

  test("las rutas profundas usan el fallback de SPA", async ({ page }) => {
    const response = await page.goto("/una/ruta/profunda");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("el HTML desplegado lleva las cabeceras de seguridad", async ({ request }) => {
    test.skip(!remote, "Las cabeceras de _headers solo se aplican en Cloudflare");
    const response = await request.get("/");
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy-report-only"]).toContain("default-src 'self'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["strict-transport-security"]).toContain("includeSubDomains");
  });
});
