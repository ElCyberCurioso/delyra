import { newId } from "@delyra/shared";
import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import type { Database } from "../db/client";
import { recoveryCodes, userTotp } from "../db/schema";
import { randomBytes, sha256Hex } from "../lib/crypto";
import { decryptField, encryptField, type Keyring } from "../lib/field-crypto";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../lib/totp";

/** Alta de TOTP (F1-09), verificación del segundo factor (F1-08) y códigos de recuperación. */

export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function newRecoveryCode(): string {
  const bytes = randomBytes(10);
  const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b & 31]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replaceAll("-", "");
}

/** Genera una semilla nueva sin confirmar (sustituye a cualquier alta a medias). */
export async function startTotpEnrollment(
  db: Database,
  keyring: Keyring,
  user: { id: string; email: string },
  now = Date.now(),
): Promise<{ secret: string; otpauthUri: string }> {
  const secret = generateTotpSecret();
  const secretEnc = await encryptField(secret, keyring, `totp:${user.id}`);
  await db
    .insert(userTotp)
    .values({
      userId: user.id,
      secretEnc,
      confirmedAt: null,
      lastUsedCounter: 0,
      createdAt: new Date(now),
    })
    .onConflictDoUpdate({
      target: userTotp.userId,
      set: {
        secretEnc,
        confirmedAt: null,
        lastUsedCounter: 0,
        createdAt: new Date(now),
        pendingSecretEnc: null,
        pendingCreatedAt: null,
      },
    });
  return { secret, otpauthUri: otpauthUri(secret, user.email) };
}

async function loadSecret(db: Database, keyring: Keyring, userId: string) {
  const [row] = await db.select().from(userTotp).where(eq(userTotp.userId, userId)).limit(1);
  if (!row) return null;
  return { row, secret: await decryptField(row.secretEnc, keyring, `totp:${userId}`) };
}

/**
 * Acepta el código si es válido y su paso es posterior al último usado. La actualización es
 * condicional, así que dos peticiones simultáneas con el mismo código no pueden pasar las dos.
 */
async function consumeTotp(
  db: Database,
  keyring: Keyring,
  userId: string,
  code: string,
  requireConfirmed: boolean,
  now: number,
): Promise<boolean> {
  const loaded = await loadSecret(db, keyring, userId);
  if (!loaded) return false;
  if (requireConfirmed !== Boolean(loaded.row.confirmedAt)) return false;
  const check = await verifyTotp(loaded.secret, code, loaded.row.lastUsedCounter, now);
  if (!check.valid || check.counter === undefined) return false;
  const updated = await db
    .update(userTotp)
    .set({
      lastUsedCounter: check.counter,
      ...(requireConfirmed ? {} : { confirmedAt: new Date(now) }),
    })
    .where(and(eq(userTotp.userId, userId), lt(userTotp.lastUsedCounter, check.counter)))
    .returning({ userId: userTotp.userId });
  return updated.length === 1;
}

/** Confirma el alta con un código válido y entrega los códigos de recuperación (una sola vez). */
export async function confirmTotpEnrollment(
  db: Database,
  keyring: Keyring,
  userId: string,
  code: string,
  now = Date.now(),
): Promise<string[] | null> {
  if (!(await consumeTotp(db, keyring, userId, code, false, now))) return null;
  return regenerateRecoveryCodes(db, userId, now);
}

/** Sustituye los códigos de recuperación por 10 nuevos. Solo se guardan sus hashes. */
export async function regenerateRecoveryCodes(
  db: Database,
  userId: string,
  now = Date.now(),
): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  const rows = await Promise.all(
    codes.map(async (code) => ({
      id: newId(),
      userId,
      codeHash: await sha256Hex(normalizeRecoveryCode(code)),
      createdAt: new Date(now),
    })),
  );
  await db.batch([
    db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId)),
    db.insert(recoveryCodes).values(rows),
  ]);
  return codes;
}

export type SecondFactorMethod = "totp" | "recovery_code";

/** Verifica un código TOTP (6 dígitos) o un código de recuperación de un solo uso. */
export async function verifySecondFactor(
  db: Database,
  keyring: Keyring,
  userId: string,
  code: string,
  now = Date.now(),
): Promise<SecondFactorMethod | null> {
  const trimmed = code.trim();
  if (/^\d{6}$/.test(trimmed)) {
    return (await consumeTotp(db, keyring, userId, trimmed, true, now)) ? "totp" : null;
  }
  const normalized = normalizeRecoveryCode(trimmed);
  if (!/^[a-z2-7]{10}$/.test(normalized)) return null;
  const used = await db
    .update(recoveryCodes)
    .set({ usedAt: new Date(now) })
    .where(
      and(
        eq(recoveryCodes.userId, userId),
        eq(recoveryCodes.codeHash, await sha256Hex(normalized)),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id });
  return used.length === 1 ? "recovery_code" : null;
}

export async function remainingRecoveryCodes(db: Database, userId: string): Promise<number> {
  const rows = await db
    .select({ id: recoveryCodes.id })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  return rows.length;
}

/** Tiempo para escanear el QR nuevo y confirmarlo durante una reconfiguración. */
export const TOTP_RECONFIGURE_TTL_MS = 10 * 60_000;

/**
 * Prepara una semilla nueva para un TOTP ya confirmado (F1-15). La actual sigue valiendo hasta
 * confirmar la nueva, así que abandonar a medias no deja la cuenta sin segundo factor.
 */
export async function startTotpReconfiguration(
  db: Database,
  keyring: Keyring,
  user: { id: string; email: string },
  now = Date.now(),
): Promise<{ secret: string; otpauthUri: string } | null> {
  const secret = generateTotpSecret();
  const pendingSecretEnc = await encryptField(secret, keyring, `totp:${user.id}`);
  const updated = await db
    .update(userTotp)
    .set({ pendingSecretEnc, pendingCreatedAt: new Date(now) })
    .where(and(eq(userTotp.userId, user.id), isNotNull(userTotp.confirmedAt)))
    .returning({ userId: userTotp.userId });
  return updated.length === 1 ? { secret, otpauthUri: otpauthUri(secret, user.email) } : null;
}

/** Sustituye la semilla por la nueva si el código es válido y no ha caducado. */
export async function confirmTotpReconfiguration(
  db: Database,
  keyring: Keyring,
  userId: string,
  code: string,
  now = Date.now(),
): Promise<boolean> {
  const [row] = await db.select().from(userTotp).where(eq(userTotp.userId, userId)).limit(1);
  const pending = row?.pendingSecretEnc;
  const startedAt = row?.pendingCreatedAt?.getTime() ?? 0;
  if (!pending || now - startedAt > TOTP_RECONFIGURE_TTL_MS) return false;
  const secret = await decryptField(pending, keyring, `totp:${userId}`);
  const check = await verifyTotp(secret, code, 0, now);
  if (!check.valid || check.counter === undefined) return false;
  const updated = await db
    .update(userTotp)
    .set({
      secretEnc: pending,
      lastUsedCounter: check.counter,
      confirmedAt: new Date(now),
      pendingSecretEnc: null,
      pendingCreatedAt: null,
    })
    .where(and(eq(userTotp.userId, userId), eq(userTotp.pendingSecretEnc, pending)))
    .returning({ userId: userTotp.userId });
  return updated.length === 1;
}

export async function totpConfirmedAt(db: Database, userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ confirmedAt: userTotp.confirmedAt })
    .from(userTotp)
    .where(eq(userTotp.userId, userId))
    .limit(1);
  return row?.confirmedAt ?? null;
}

/** Borra el TOTP y los códigos (reseteo de 2FA por un administrador, F1-17). */
export async function resetSecondFactor(db: Database, userId: string): Promise<void> {
  await db.batch([
    db.delete(userTotp).where(eq(userTotp.userId, userId)),
    db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId)),
  ]);
}
