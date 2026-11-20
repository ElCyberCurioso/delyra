import type { Context } from "hono";
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
