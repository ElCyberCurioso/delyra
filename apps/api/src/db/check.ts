import { sql } from "drizzle-orm";

/**
 * Lista de valores para un `CHECK ("col" IN (…))` del esquema. Solo para constantes del código
 * (nunca datos del usuario): van tal cual en el SQL de la migración.
 */
export const quoted = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "));
