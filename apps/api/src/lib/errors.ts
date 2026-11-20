import {
  createProblem,
  type InvalidParam,
  PROBLEM_CONTENT_TYPE,
  PROBLEM_TYPES,
  type ProblemInit,
} from "@delyra/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodType } from "zod";
import type { AppEnv } from "../types";

/** Error de aplicación que se traduce tal cual a `application/problem+json`. */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly problem: ProblemInit = {},
    options?: ErrorOptions,
  ) {
    super(problem.detail ?? problem.title ?? `HTTP ${String(status)}`, options);
    this.name = "AppError";
  }
}

export function problemResponse(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  init: ProblemInit = {},
): Response {
  const problem = createProblem(status, { ...init, requestId: c.get("requestId") });
  return c.body(JSON.stringify(problem), status, { "Content-Type": PROBLEM_CONTENT_TYPE });
}

function toInvalidParams(issues: readonly { path: PropertyKey[]; message: string }[]) {
  return issues.slice(0, 20).map<InvalidParam>((issue) => ({
    path: issue.path.map(String).join(".") || "(raíz)",
    message: issue.message,
  }));
}

/** Valida una entrada del cliente; si no es válida, responde 422 con la lista de errores. */
export function parseInput<T extends ZodType>(schema: T, data: unknown): ReturnType<T["parse"]> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(422, {
      type: PROBLEM_TYPES.validation,
      errors: toInvalidParams(result.error.issues),
    });
  }
  return result.data as ReturnType<T["parse"]>;
}
