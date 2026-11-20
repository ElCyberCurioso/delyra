import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { AppError } from "../lib/errors";
import type { AppEnv } from "../types";

/**
 * Receptor de informes CSP (`report-uri` y Reporting API). Mientras la CSP esté en modo
 * informe (hasta F7-08) sirve para detectar qué bloquearía. Solo registra datos mínimos:
 * directiva, origen bloqueado y ruta del documento, nunca la query ni muestras de código.
 */

const MAX_REPORT_BYTES = 16 * 1024;
const MAX_REPORTS_PER_REQUEST = 20;
const ACCEPTED_TYPES = new Set([
  "application/csp-report",
  "application/reports+json",
  "application/json",
]);

const legacyReportSchema = z.object({
  "csp-report": z.looseObject({
    "document-uri": z.string().optional(),
    "violated-directive": z.string().optional(),
    "effective-directive": z.string().optional(),
    "blocked-uri": z.string().optional(),
    disposition: z.string().optional(),
  }),
});

const reportingApiSchema = z.array(
  z.looseObject({
    type: z.string(),
    body: z
      .looseObject({
        documentURL: z.string().optional(),
        effectiveDirective: z.string().optional(),
        blockedURL: z.string().optional(),
        disposition: z.string().optional(),
      })
      .optional(),
  }),
);

interface CspViolation {
  directive: string;
  blocked: string;
  documentPath: string;
  disposition: string;
}

function toOriginOrKeyword(value: string | undefined): string {
  if (!value) return "unknown";
  if (/^(inline|eval|data|blob|self|wasm-eval|trusted-types-sink)$/i.test(value)) return value;
  try {
    return new URL(value).origin;
  } catch {
    return "other";
  }
}

function toPath(value: string | undefined): string {
  if (!value) return "unknown";
  try {
    return new URL(value).pathname.slice(0, 200);
  } catch {
    return "unknown";
  }
}

const short = (value: string | undefined) => (value ?? "unknown").slice(0, 100);

export function parseCspReports(payload: unknown): CspViolation[] {
  const legacy = legacyReportSchema.safeParse(payload);
  if (legacy.success) {
    const r = legacy.data["csp-report"];
    return [
      {
        directive: short(r["effective-directive"] ?? r["violated-directive"]),
        blocked: toOriginOrKeyword(r["blocked-uri"]),
        documentPath: toPath(r["document-uri"]),
        disposition: short(r.disposition),
      },
    ];
  }
  const modern = reportingApiSchema.safeParse(payload);
  if (modern.success) {
    return modern.data
      .filter((report) => report.type === "csp-violation")
      .slice(0, MAX_REPORTS_PER_REQUEST)
      .map((report) => ({
        directive: short(report.body?.effectiveDirective),
        blocked: toOriginOrKeyword(report.body?.blockedURL),
        documentPath: toPath(report.body?.documentURL),
        disposition: short(report.body?.disposition),
      }));
  }
  throw new AppError(400, { detail: "Informe CSP no reconocido" });
}

export const cspReportRoutes = new Hono<AppEnv>().post(
  "/",
  bodyLimit({
    maxSize: MAX_REPORT_BYTES,
    onError: () => {
      throw new AppError(413);
    },
  }),
  async (c) => {
    const contentType = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!ACCEPTED_TYPES.has(contentType)) throw new AppError(415);

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      throw new AppError(400, { detail: "JSON mal formado" });
    }

    const logger = c.get("logger");
    for (const violation of parseCspReports(payload))
      logger.warn("csp_violation", { ...violation });
    return c.body(null, 204);
  },
);
