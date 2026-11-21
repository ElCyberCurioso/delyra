import { PROBLEM_TYPES } from "@delyra/shared";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { AppError } from "./errors";
import { isPwnedPassword } from "./pwned";
import { verifyTurnstile } from "./turnstile";

/** Respuesta 429 con `Retry-After` para los bloqueos por fuerza bruta (F1-10). */
export function tooManyAttempts(c: Context<AppEnv>, retryAfterSeconds: number): never {
  c.header("Retry-After", String(Math.max(retryAfterSeconds, 1)));
  throw new AppError(429, { detail: "Demasiados intentos. Vuelve a intentarlo más tarde." });
}

/** Exige un token de Turnstile válido (login, registro y recuperación). */
export async function requireTurnstile(c: Context<AppEnv>, token: string) {
  if (!(await verifyTurnstile(c.env, token, c.get("meta").ip))) {
    throw new AppError(400, { detail: "No se ha superado la verificación antibots" });
  }
}

function invalidPassword(path: string, message: string): never {
  throw new AppError(422, { type: PROBLEM_TYPES.validation, errors: [{ path, message }] });
}

/** Rechaza contraseñas filtradas (Pwned Passwords, k-anonimato) si está activado. */
export async function rejectPwned(c: Context<AppEnv>, password: string, path = "password") {
  if (c.env.PWNED_PASSWORDS_CHECK !== "on") return;
  if ((await isPwnedPassword(password)) === true) {
    invalidPassword(path, "Esta contraseña aparece en filtraciones conocidas. Elige otra.");
  }
}

/**
 * Política de contraseña más allá de la longitud (que valida el esquema): no puede contener la
 * parte local del email y no puede estar filtrada.
 */
export async function enforcePasswordPolicy(
  c: Context<AppEnv>,
  password: string,
  email: string,
  path = "password",
) {
  const localPart = email.split("@")[0] ?? "";
  if (localPart.length >= 4 && password.toLowerCase().includes(localPart)) {
    invalidPassword(path, "La contraseña no puede contener tu email");
  }
  await rejectPwned(c, password, path);
}
