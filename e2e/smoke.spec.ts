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

  test("sin sesión, la SPA lleva al login del calendario recordando la vuelta", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Iniciar sesión" })).toBeVisible();
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe(new URL("/", baseURL).href);
  });

  test("la API exige sesión y rechaza mutaciones de otro origen", async ({ request }) => {
    expect((await request.get("/api/auth/me")).status()).toBe(401);
    const forged = await request.post("/api/auth/logout", {
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      data: {},
    });
    expect(forged.status()).toBe(403);
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
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain(
      "script-src 'self' https://challenges.cloudflare.com",
    );
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["strict-transport-security"]).toContain("includeSubDomains");
  });
});
