import { defineConfig, devices } from "@playwright/test";

/**
 * Tests e2e. Sin variables de entorno arrancan las dos SPA en local (con el Worker `api`
 * como auxiliar). Con E2E_CALENDAR_URL/E2E_WORK_URL se ejecutan contra producción: solo los
 * marcados con @smoke, que no escriben datos.
 */
const calendarURL = process.env.E2E_CALENDAR_URL ?? "http://localhost:5173";
const workURL = process.env.E2E_WORK_URL ?? "http://localhost:5174";
const remote = Boolean(process.env.E2E_CALENDAR_URL);
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  reporter: ci ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    { name: "calendar", use: { ...devices["Desktop Chrome"], baseURL: calendarURL } },
    { name: "work", use: { ...devices["Desktop Chrome"], baseURL: workURL } },
  ],
  webServer: remote
    ? undefined
    : [
        {
          command: "pnpm --filter @delyra/calendar dev",
          url: calendarURL,
          reuseExistingServer: !ci,
          timeout: 180_000,
        },
        {
          command: "pnpm --filter @delyra/work dev",
          url: workURL,
          reuseExistingServer: !ci,
          timeout: 180_000,
        },
      ],
});
