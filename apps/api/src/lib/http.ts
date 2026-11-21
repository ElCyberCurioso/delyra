import type { Context } from "hono";
import { PROBLEM_TYPES } from "@delyra/shared";
import type { ZodType } from "zod";
import { AppError, parseInput } from "./errors";

/** Lee el cuerpo JSON y lo valida con Zod; 400 si no es JSON, 422 si no cumple el esquema. */
export async function readBody<T extends ZodType>(
  c: Context,
  schema: T,
): Promise<ReturnType<T["parse"]>> {
  let data: unknown;
  try {
    data = await c.req.json();
  } catch {
    throw new AppError(400, { detail: "JSON mal formado" });
  }
  return parseInput(schema, data);
}

/** Valida los parámetros de la query string con Zod; 422 si no cumplen el esquema. */
export function readQuery<T extends ZodType>(c: Context, schema: T): ReturnType<T["parse"]> {
  return parseInput(schema, c.req.query());
}

/** Error 422 de un solo campo, con el mismo formato que los de Zod. */
export function invalidField(path: string, message: string): AppError {
  return new AppError(422, {
    type: PROBLEM_TYPES.validation,
    errors: [{ path, message }],
  });
}
