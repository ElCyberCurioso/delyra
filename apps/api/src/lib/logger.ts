/**
 * Logging JSON estructurado (F0-13). Workers Logs indexa cada campo del objeto.
 *
 * Campos convenidos: `event`, `level`, `time`, `requestId`, `userId` (seudonimizado),
 * `route` (patrón, nunca la URL con parámetros), `status`, `durationMs`.
 *
 * Cualquier clave sensible se sustituye por "[REDACTED]" antes de escribir
 * (lista en `isSensitiveKey` y en docs/observabilidad.md). Ver §3.5 del plan.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface LogEntry extends LogFields {
  level: LogLevel;
  event: string;
  time: string;
}

export type LogSink = (entry: LogEntry) => void;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export const REDACTED = "[REDACTED]";

/** Fragmentos que, si aparecen en el nombre de la clave, la marcan como sensible. */
const SENSITIVE_FRAGMENTS = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "totp",
  "apikey",
  "chatid",
  "recoverycode",
  "signedurl",
  "privatekey",
  "credential",
  "session",
] as const;

/** Claves sensibles exactas: secretos cortos y contenido de usuario (eventos, tarjetas, notas). */
const SENSITIVE_KEYS = new Set([
  "otp",
  "seed",
  "email",
  "phone",
  "ip",
  "title",
  "notes",
  "description",
  "location",
  "body",
  "content",
  "summary",
  "text",
  "comment",
  "filename",
]);

const MAX_DEPTH = 5;
const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 50;

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (SENSITIVE_KEYS.has(normalized)) return true;
  return SENSITIVE_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/** Copia saneada de un valor arbitrario, apta para registrar. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: sanitize(value.message, depth + 1) };
  }
  if (depth >= MAX_DEPTH) return "[MaxDepth]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitize(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: LogFields = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : sanitize(inner, depth + 1);
    }
    return out;
  }
  return `[${typeof value}]`;
}

export const consoleSink: LogSink = (entry) => {
  const line = JSON.stringify(entry);
  switch (entry.level) {
    case "debug":
      console.debug(line);
      break;
    case "info":
      console.log(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }
};

export function createLogger(base: LogFields = {}, sink: LogSink = consoleSink): Logger {
  const baseFields = sanitize(base) as LogFields;
  const emit = (level: LogLevel, event: string, fields: LogFields = {}) => {
    sink({
      ...baseFields,
      ...(sanitize(fields) as LogFields),
      level,
      event,
      time: new Date().toISOString(),
    });
  };
  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    child: (fields) => createLogger({ ...baseFields, ...fields }, sink),
  };
}

/** Mensaje de error apto para logs y para la base de datos: sin URLs (pueden ir firmadas). */
export function safeErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error ? `${error.name}: ${error.message}` : `NonError: ${String(error)}`;
  return raw.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 500);
}
