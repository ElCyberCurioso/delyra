import type { Context } from "hono";
import { idSchema, PROBLEM_TYPES } from "@delyra/shared";
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

/**
 * Id (UUIDv7) de un parámetro de la ruta. Si no tiene ese formato responde 404, igual que un
 * recurso que no existe.
 */
export function idParam(c: Context, name = "id"): string {
  const id = idSchema.safeParse(c.req.param(name));
  if (!id.success) throw new AppError(404);
  return id.data;
}

/**
 * Cabeceras de una subida binaria en streaming (adjuntos, importaciones y copias): el tamaño
 * exacto en `Content-Length` (411 si falta, 413 si pasa de `maxBytes`) y el nombre en
 * `X-Filename`, codificado con encodeURIComponent.
 */
export function readUpload(
  c: Context,
  maxBytes: number,
  tooLarge: string,
): { length: number; rawName: string; body: ReadableStream<Uint8Array> } {
  const length = Number(c.req.header("content-length"));
  if (!Number.isInteger(length) || length <= 0) {
    throw new AppError(411, { detail: "Falta el tamaño del fichero" });
  }
  if (length > maxBytes) throw new AppError(413, { detail: tooLarge });
  let rawName: string;
  try {
    rawName = decodeURIComponent(c.req.header("x-filename") ?? "");
  } catch {
    throw invalidField("filename", "Nombre de fichero no válido");
  }
  const body = c.req.raw.body as ReadableStream<Uint8Array> | null;
  if (!body) throw new AppError(400, { detail: "Falta el fichero" });
  return { length, rawName, body };
}

/** Error 422 de un solo campo, con el mismo formato que los de Zod. */
export function invalidField(path: string, message: string): AppError {
  return new AppError(422, {
    type: PROBLEM_TYPES.validation,
    errors: [{ path, message }],
  });
}
