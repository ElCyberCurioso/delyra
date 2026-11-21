import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AppError } from "./lib/errors";
import { csrfProtection } from "./middleware/csrf";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { rateLimit } from "./middleware/rate-limit";
import { requestContext } from "./middleware/request-context";
import { requestLogger } from "./middleware/request-logger";
import { securityHeaders } from "./middleware/security-headers";
import { loadSession } from "./middleware/session";
import { accountRoutes } from "./routes/account";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { calendarRoutes } from "./routes/calendars";
import { cspReportRoutes } from "./routes/csp-report";
import { eventRoutes } from "./routes/events";
import { healthRoutes } from "./routes/health";
import { telegramWebhookRoutes } from "./routes/telegram";
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
  // Los informes CSP los envía el navegador sin Origin ni JSON estándar: fuera del CSRF.
  // El webhook de Telegram se autentica con su propio secreto (F3-03).
  api.use("*", csrfProtection({ exemptPaths: ["/api/csp-report", "/api/telegram/webhook"] }));
  api.use(
    "*",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: () => {
        throw new AppError(413);
      },
    }),
  );
  api.use("*", loadSession());
  // El límite estricto es para los intentos (login, registro, códigos…), no para las lecturas
  // (`/auth/me`, `/auth/config`) que cada página hace al cargar: esas van con el general.
  api.use("/auth/*", rateLimit("AUTH_RATE_LIMITER", { onlyMutations: true }));
  api.use("*", rateLimit("API_RATE_LIMITER"));

  api.route("/health", healthRoutes);
  api.route("/csp-report", cspReportRoutes);
  api.route("/auth", authRoutes);
  api.route("/me", accountRoutes);
  api.route("/admin", adminRoutes);
  api.route("/calendars", calendarRoutes);
  api.route("/events", eventRoutes);
  api.route("/telegram", telegramWebhookRoutes);
  app.route("/api", api);

  app.notFound(notFoundHandler);
  app.onError(errorHandler);

  return app;
}
