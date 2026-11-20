import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { delyraStaticFiles } from "@delyra/ui/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Estado local (D1, R2, Queues) compartido por las dos SPA y por `wrangler dev` del api.
const sharedState = path.resolve(import.meta.dirname, "../../.wrangler/state");

// El entorno de Cloudflare (staging/production) se elige con CLOUDFLARE_ENV al hacer build.
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    delyraStaticFiles(),
    cloudflare({
      persistState: { path: sharedState },
      auxiliaryWorkers: command === "serve" ? [{ configPath: "../api/wrangler.jsonc" }] : [],
    }),
  ],
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
}));
