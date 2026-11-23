import { type ProblemDetails, problemDetailsSchema } from "@delyra/shared";
import { getLocale, translateServer, ui } from "../i18n";

/** Error de la API con el problem+json ya validado (si lo hubo). */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails | null;

  constructor(status: number, problem: ProblemDetails | null) {
    super(problem?.detail ?? problem?.title ?? ui().errors.apiStatus(status));
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }

  /** Mensaje de un campo concreto (errores 422), si lo hay, en el idioma actual. */
  fieldError(path: string): string | undefined {
    const message = this.problem?.errors?.find((error) => error.path === path)?.message;
    return message === undefined ? undefined : translateServer(message);
  }
}

export interface ApiRequestOptions<T> {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Cualquier esquema con `parse` (Zod). */
  schema?: { parse: (data: unknown) => T };
  signal?: AbortSignal;
}

/**
 * Llamada a la API del mismo origen. Las mutaciones van siempre como JSON: la API rechaza
 * cualquier otro Content-Type (parte de la defensa CSRF) y comprueba el Origin.
 */
export async function apiFetch<T = undefined>(
  path: string,
  { method = "GET", body, schema, signal }: ApiRequestOptions<T> = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Language": getLocale(),
  };
  if (method !== "GET") headers["Content-Type"] = "application/json";
  const response = await fetch(new URL(path, window.location.origin), {
    method,
    headers,
    credentials: "same-origin",
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    signal,
  });

  if (!response.ok) {
    let problem: ProblemDetails | null = null;
    try {
      problem = problemDetailsSchema.parse(await response.json());
    } catch {
      // Respuesta sin cuerpo problem+json (p. ej. un proxy): basta con el código.
    }
    throw new ApiError(response.status, problem);
  }
  if (response.status === 204 || !schema) return undefined as T;
  return schema.parse(await response.json());
}

/** Mensaje legible para cualquier error de una llamada. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return ui().errors.tooManyAttempts;
    return translateServer(error.message);
  }
  if (error instanceof TypeError) return ui().errors.offline;
  return ui().errors.generic;
}
