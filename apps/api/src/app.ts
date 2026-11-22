import { Hono, type MiddlewareHandler } from "hono";
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
import { boardInvitationRoutes } from "./routes/board-invitations";
import { backupRoutes, restoreRoutes } from "./routes/backups";
import { calendarRoutes } from "./routes/calendars";
import { cspReportRoutes } from "./routes/csp-report";
import { eventRoutes } from "./routes/events";
import { feedRoutes } from "./routes/feeds";
import { googleRoutes } from "./routes/google";
import { healthRoutes } from "./routes/health";
import { holidayRoutes } from "./routes/holidays";
import { importRoutes } from "./routes/imports";
import {
  attachmentRoutes,
  boardRoutes,
  cardRoutes,
  checklistRoutes,
  columnRoutes,
  commentRoutes,
  labelRoutes,
} from "./routes/kanban";
import { subscriptionRoutes } from "./routes/subscriptions";
import { telegramWebhookRoutes } from "./routes/telegram";
import type { AppEnv } from "./types";

/**
 * Las SPA reenvían `/api/*` por Service Binding conservando la URL original, así que
 * todas las rutas cuelgan de `/api`. El middleware se aplica a cualquier ruta, incluidas
 * las inexistentes, para que todo error lleve request id y cabeceras de seguridad.
 */
/** Subidas en streaming: adjuntos (F4-06), importaciones (F5-02) y copias a restaurar (F6-04). */
const UPLOAD_PATH = /^\/api\/(?:cards\/[^/]+\/attachments|imports|restores\/upload)$/;

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", requestContext());
  app.use("*", securityHeaders());
  app.use("*", requestLogger());

  const api = new Hono<AppEnv>();
  // Los informes CSP los envía el navegador sin Origin ni JSON estándar: fuera del CSRF.
  // El webhook de Telegram se autentica con su propio secreto (F3-03).
  api.use(
    "*",
    csrfProtection({
      exemptPaths: ["/api/csp-report", "/api/telegram/webhook"],
      rawBodyPaths: [UPLOAD_PATH],
    }),
  );
  // 64 KB para todo salvo las subidas, que limitan su propio tamaño (F4-06, F5-02).
  const jsonLimit: MiddlewareHandler<AppEnv> = bodyLimit({
    maxSize: 64 * 1024,
    onError: () => {
      throw new AppError(413);
    },
  });
  const limitBody: MiddlewareHandler<AppEnv> = (c, next) => {
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- regex fija, anclada y lineal
    if (UPLOAD_PATH.test(c.req.path)) return next();
    return jsonLimit(c, next);
  };
  api.use("*", limitBody);
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
  api.route("/boards", boardRoutes);
  api.route("/columns", columnRoutes);
  api.route("/labels", labelRoutes);
  api.route("/cards", cardRoutes);
  api.route("/checklist", checklistRoutes);
  api.route("/comments", commentRoutes);
  api.route("/attachments", attachmentRoutes);
  api.route("/imports", importRoutes);
  api.route("/google", googleRoutes);
  api.route("/subscriptions", subscriptionRoutes);
  api.route("/backups", backupRoutes);
  api.route("/restores", restoreRoutes);
  api.route("/feeds", feedRoutes);
  api.route("/holidays", holidayRoutes);
  api.route("/board-invitations", boardInvitationRoutes);
  app.route("/api", api);

  app.notFound(notFoundHandler);
  app.onError(errorHandler);

  return app;
}
