import { scrypt } from "node:crypto";
import { constantTimeEqual, fromBase64Url, randomBytes, toBase64Url } from "./crypto";

/**
 * Hash de contraseñas con scrypt nativo (`node:crypto`), formato tipo PHC:
 * `$scrypt$ln=15,r=8,p=3$<sal>$<hash>`.
 *
 * Argon2id (plan, F1-02) no es viable en Workers: las librerías WASM compilan el módulo en tiempo
 * de ejecución y el runtime lo prohíbe. scrypt con N=2^15, r=8, p=3 (32 MiB) es una de las
 * configuraciones equivalentes que recomienda OWASP y tarda ~200 ms (ADR-0004).
 */

export const PASSWORD_PARAMS = { ln: 15, r: 8, p: 3, keyLength: 32, saltLength: 16 } as const;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Uint8Array, ln: number, r: number, p: number) {
  return new Promise<Uint8Array>((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      PASSWORD_PARAMS.keyLength,
      { N: 2 ** ln, r, p, maxmem: MAX_MEMORY },
      (error, key) => (error ? reject(error) : resolve(new Uint8Array(key))),
    );
  });
}

interface ParsedHash {
  ln: number;
  r: number;
  p: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

function parse(encoded: string): ParsedHash | null {
  const match = /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([\w-]+)\$([\w-]+)$/.exec(
    encoded,
  );
  if (!match) return null;
  const [, ln, r, p, salt, hash] = match;
  return {
    ln: Number(ln),
    r: Number(r),
    p: Number(p),
    salt: fromBase64Url(salt ?? ""),
    hash: fromBase64Url(hash ?? ""),
  };
}

export async function hashPassword(password: string): Promise<string> {
  const { ln, r, p, saltLength } = PASSWORD_PARAMS;
  const salt = randomBytes(saltLength);
  const hash = await derive(password, salt, ln, r, p);
  return `$scrypt$ln=${String(ln)},r=${String(r)},p=${String(p)}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parse(encoded);
  if (!parsed || parsed.ln > 20) return false;
  const candidate = await derive(password, parsed.salt, parsed.ln, parsed.r, parsed.p);
  return constantTimeEqual(candidate, parsed.hash);
}

/** El hash se generó con parámetros distintos de los actuales: conviene recalcularlo al entrar. */
export function needsRehash(encoded: string): boolean {
  const parsed = parse(encoded);
  const { ln, r, p } = PASSWORD_PARAMS;
  return parsed?.ln !== ln || parsed.r !== r || parsed.p !== p;
}

let dummyHash: Promise<string> | undefined;

/**
 * Gasta el mismo tiempo que una verificación real cuando el usuario no existe, para no revelar
 * qué emails están registrados por el tiempo de respuesta.
 */
export async function equalizeTiming(password: string): Promise<void> {
  dummyHash ??= hashPassword("delyra-timing-equalizer");
  await verifyPassword(password, await dummyHash);
}
