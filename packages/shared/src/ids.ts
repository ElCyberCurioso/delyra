import { uuidv7 } from "uuidv7";
import { z } from "zod";

/** Identificador ordenable por tiempo (UUIDv7, RFC 9562). */
export function newId(): string {
  return uuidv7();
}

export const idSchema = z.uuid({ version: "v7", error: "Identificador no válido" });

export type Id = z.infer<typeof idSchema>;

/** Instante de creación codificado en los 48 bits altos de un UUIDv7. */
export function idTimestamp(id: string): Date {
  const parsed = idSchema.parse(id);
  const hex = parsed.replaceAll("-", "").slice(0, 12);
  return new Date(Number.parseInt(hex, 16));
}
