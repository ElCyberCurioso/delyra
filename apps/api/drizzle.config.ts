import { defineConfig } from "drizzle-kit";

// drizzle-kit solo genera el SQL; las migraciones las aplica Wrangler
// (`wrangler d1 migrations apply`), que lleva el registro en la tabla `d1_migrations`.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
});
