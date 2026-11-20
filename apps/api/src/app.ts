import { Hono } from "hono";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { requestContext } from "./middleware/request-context";
import { requestLogger } from "./middleware/request-logger";
import { securityHeaders } from "./middleware/security-headers";
import { cspReportRoutes } from "./routes/csp-report";
import { healthRoutes } from "./routes/health";
import type { AppEnv } from "./types";

/**
 * Las SPA reenvían `/api/*` por Service Binding conservando la URL original, así que
 * todas las rutas cuelgan de `/api`. El middleware se aplica a cualquier ruta, incluidas
 * las inexistentes, para que todo error lleve request id y cabeceras de seguridad.
 */
export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", requestContext());
  app.use("*", securityHeaders());
  app.use("*", requestLogger());

  const api = new Hono<AppEnv>();
  api.route("/health", healthRoutes);
  api.route("/csp-report", cspReportRoutes);
  app.route("/api", api);

  app.notFound(notFoundHandler);
  app.onError(errorHandler);

  return app;
}
