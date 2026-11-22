import { renderStaticHeadersFile } from "@delyra/shared";
import type { Plugin } from "vite";
import { THEME_INIT_SCRIPT } from "./theme/theme-init-script";

export { pwaOptions } from "./pwa-options";

/**
 * Ficheros estáticos comunes a las dos SPA:
 * - `_headers`: cabeceras de seguridad de Workers Static Assets (F0-12), generadas desde
 *   `@delyra/shared` para que no diverjan de las de la API.
 * - `theme-init.js`: aplica el tema antes del primer pintado sin script inline.
 */
export function delyraStaticFiles(): Plugin {
  return {
    name: "delyra:static-files",
    configureServer(server) {
      server.middlewares.use("/theme-init.js", (_req, res) => {
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.end(THEME_INIT_SCRIPT);
      });
    },
    generateBundle() {
      // Solo en el build del cliente (no en el del Worker).
      if (this.environment.name !== "client") return;
      this.emitFile({ type: "asset", fileName: "_headers", source: renderStaticHeadersFile() });
      this.emitFile({ type: "asset", fileName: "theme-init.js", source: THEME_INIT_SCRIPT });
    },
  };
}
