import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      /** Binding solo de test con las migraciones leídas por `readD1Migrations`. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
