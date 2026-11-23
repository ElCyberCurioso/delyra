import {
  APP_ORIGINS,
  appEnvironmentSchema,
  MAX_PASSKEYS,
  newId,
  type Passkey,
} from "@delyra/shared";
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { and, asc, eq, lt } from "drizzle-orm";
import type { Database } from "../db/client";
import { passkeys, type WebAuthnPurpose, webauthnChallenges } from "../db/schema";
import { fromBase64Url, toBase64Url } from "../lib/crypto";

/**
 * Llaves de acceso (WebAuthn, F7-09) como segundo factor alternativo al TOTP.
 *
 * - El RP es el dominio del calendario (`delyra.app`; `localhost` en desarrollo): ahí están el
 *   inicio de sesión y los ajustes. Solo se acepta ese origen exacto.
 * - Cada ceremonia usa un reto aleatorio guardado junto a la sesión, de un solo uso (se borra al
 *   leerlo) y válido 5 minutos.
 * - Sin atestación (`none`): no hace falta saber el modelo del autenticador y así no se guardan
 *   datos que lo identifiquen.
 * - La verificación de usuario (huella, PIN) se pide si el autenticador la tiene, pero no se exige:
 *   la llave es el segundo factor después de la contraseña.
 */

export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60_000;
const RP_NAME = "Delyra";

export interface RelyingParty {
  id: string;
  origin: string;
}

export function relyingParty(appEnv: string): RelyingParty {
  const origin = APP_ORIGINS[appEnvironmentSchema.parse(appEnv)].calendar;
  return { id: new URL(origin).hostname, origin };
}

async function saveChallenge(
  db: Database,
  sessionId: string,
  purpose: WebAuthnPurpose,
  challenge: string,
  now: number,
) {
  const expiresAt = new Date(now + WEBAUTHN_CHALLENGE_TTL_MS);
  await db
    .insert(webauthnChallenges)
    .values({ sessionId, purpose, challenge, expiresAt })
    .onConflictDoUpdate({
      target: webauthnChallenges.sessionId,
      set: { purpose, challenge, expiresAt },
    });
}

/** Saca el reto de la sesión (un solo uso): null si no hay, es de otra ceremonia o caducó. */
async function takeChallenge(
  db: Database,
  sessionId: string,
  purpose: WebAuthnPurpose,
  now: number,
): Promise<string | null> {
  const [row] = await db
    .delete(webauthnChallenges)
    .where(eq(webauthnChallenges.sessionId, sessionId))
    .returning();
  if (row?.purpose !== purpose || row.expiresAt.getTime() <= now) return null;
  return row.challenge;
}

function parseTransports(value: string | null): AuthenticatorTransport[] | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as AuthenticatorTransport[]) : undefined;
  } catch {
    return undefined;
  }
}

function summary(row: typeof passkeys.$inferSelect): Passkey {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    backedUp: row.backedUp,
  };
}

export async function listPasskeys(db: Database, userId: string): Promise<Passkey[]> {
  const rows = await db
    .select()
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(asc(passkeys.createdAt));
  return rows.map(summary);
}

export async function countPasskeys(db: Database, userId: string): Promise<number> {
  const rows = await db
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));
  return rows.length;
}

/** Opciones para crear una llave nueva. Excluye las que ya tiene para no duplicarlas. */
export async function startPasskeyRegistration(
  db: Database,
  rp: RelyingParty,
  sessionId: string,
  user: { id: string; email: string; name: string },
  now = Date.now(),
) {
  const existing = await db
    .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.userId, user.id));
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.id,
    userName: user.email,
    userDisplayName: user.name,
    userID: new Uint8Array(new TextEncoder().encode(user.id)),
    attestationType: "none",
    excludeCredentials: existing.map((row) => ({
      id: row.credentialId,
      transports: parseTransports(row.transports),
    })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    timeout: WEBAUTHN_CHALLENGE_TTL_MS,
  });
  await saveChallenge(db, sessionId, "register", options.challenge, now);
  return options;
}

export type RegistrationResult =
  { ok: true; passkey: Passkey } | { ok: false; reason: "invalid" | "duplicate" | "limit" };

/** Verifica la respuesta del navegador y guarda la llave. */
export async function finishPasskeyRegistration(
  db: Database,
  rp: RelyingParty,
  sessionId: string,
  userId: string,
  input: { name: string; response: RegistrationResponseJSON },
  now = Date.now(),
): Promise<RegistrationResult> {
  const challenge = await takeChallenge(db, sessionId, "register", now);
  if (!challenge) return { ok: false, reason: "invalid" };
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: false,
    });
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!verification.verified) return { ok: false, reason: "invalid" };
  if ((await countPasskeys(db, userId)) >= MAX_PASSKEYS) return { ok: false, reason: "limit" };

  const { credential, credentialBackedUp } = verification.registrationInfo;
  const row = {
    id: newId(),
    userId,
    credentialId: credential.id,
    publicKey: toBase64Url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ? JSON.stringify(credential.transports) : null,
    name: input.name,
    backedUp: credentialBackedUp,
    createdAt: new Date(now),
    lastUsedAt: null,
  };
  const inserted = await db
    .insert(passkeys)
    .values(row)
    .onConflictDoNothing({ target: passkeys.credentialId })
    .returning({ id: passkeys.id });
  if (inserted.length === 0) return { ok: false, reason: "duplicate" };
  return { ok: true, passkey: summary(row) };
}

/** Opciones para iniciar sesión con una llave; null si la cuenta no tiene ninguna. */
export async function startPasskeyLogin(
  db: Database,
  rp: RelyingParty,
  sessionId: string,
  userId: string,
  now = Date.now(),
) {
  const rows = await db
    .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));
  if (rows.length === 0) return null;
  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    allowCredentials: rows.map((row) => ({
      id: row.credentialId,
      transports: parseTransports(row.transports),
    })),
    userVerification: "preferred",
    timeout: WEBAUTHN_CHALLENGE_TTL_MS,
  });
  await saveChallenge(db, sessionId, "login", options.challenge, now);
  return options;
}

/**
 * Comprueba la firma de la llave sobre el reto de esta sesión. La llave tiene que ser de la
 * misma persona y su contador no puede retroceder (posible clon). Devuelve el id de la llave.
 */
export async function finishPasskeyLogin(
  db: Database,
  rp: RelyingParty,
  sessionId: string,
  userId: string,
  response: AuthenticationResponseJSON,
  now = Date.now(),
): Promise<string | null> {
  const challenge = await takeChallenge(db, sessionId, "login", now);
  if (!challenge) return null;
  const [row] = await db
    .select()
    .from(passkeys)
    .where(and(eq(passkeys.userId, userId), eq(passkeys.credentialId, response.id)))
    .limit(1);
  if (!row) return null;
  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: row.credentialId,
        publicKey: new Uint8Array(fromBase64Url(row.publicKey)),
        counter: row.counter,
        transports: parseTransports(row.transports),
      },
      requireUserVerification: false,
    });
  } catch {
    return null;
  }
  if (!verification.verified) return null;
  const { newCounter, credentialBackedUp } = verification.authenticationInfo;
  // Condicional sobre el contador leído: dos usos simultáneos no pueden pasar los dos.
  const updated = await db
    .update(passkeys)
    .set({ counter: newCounter, backedUp: credentialBackedUp, lastUsedAt: new Date(now) })
    .where(and(eq(passkeys.id, row.id), eq(passkeys.counter, row.counter)))
    .returning({ id: passkeys.id });
  return updated.length === 1 ? row.id : null;
}

export async function deletePasskey(db: Database, userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(passkeys)
    .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
    .returning({ id: passkeys.id });
  return deleted.length === 1;
}

/** Retos que nadie terminó de usar (limpieza del cron diario). */
export async function purgeExpiredChallenges(db: Database, now = Date.now()): Promise<void> {
  await db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, new Date(now)));
}
