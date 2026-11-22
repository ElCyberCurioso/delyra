import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      // Las migraciones se aplican desde cero en cada fichero de test (DoD §3.4, punto 5).
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            CF_ACCOUNT_ID: "test-account",
            D1_DATABASE_ID: "test-database",
            D1_EXPORT_API_TOKEN: "test-token",
            // Bot ficticio: las llamadas a api.telegram.org se simulan en los tests.
            TELEGRAM_BOT_TOKEN: "123456:token-de-prueba",
            TELEGRAM_WEBHOOK_SECRET: "secreto-del-webhook-de-prueba",
            TELEGRAM_BOT_USERNAME: "DelyraPruebasBot",
            // Cliente OAuth ficticio: accounts.google.com y googleapis.com se simulan (F5-07).
            GOOGLE_CLIENT_ID: "cliente-de-prueba.apps.googleusercontent.com",
            GOOGLE_CLIENT_SECRET: "secreto-oauth-de-prueba",
          },
        },
      };
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
