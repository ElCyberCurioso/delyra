import { randomBytes } from "./crypto";

/**
 * TOTP (RFC 6238) con HMAC-SHA1 de WebCrypto: 6 dígitos, pasos de 30 s y ventana de ±1 paso.
 * Compatible con Google Authenticator, Aegis, 1Password, etc. (F1-03).
 */

export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Base32 no válido");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

/** Semilla de 160 bits en base32 (lo que recomienda la RFC 4226 para HMAC-SHA1). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export async function hotp(
  secret: Uint8Array,
  counter: number,
  digits = TOTP_DIGITS,
): Promise<string> {
  const message = new ArrayBuffer(8);
  const view = new DataView(message);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, [
    "sign",
  ]);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    ((hmac[offset + 1] ?? 0) << 16) |
    ((hmac[offset + 2] ?? 0) << 8) |
    (hmac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpCounter(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD);
}

export async function generateTotp(secretBase32: string, nowMs = Date.now()): Promise<string> {
  return hotp(base32Decode(secretBase32), totpCounter(nowMs));
}

export interface TotpCheck {
  valid: boolean;
  /** Paso aceptado; se guarda para impedir reutilizarlo (anti-replay). */
  counter?: number;
}

/**
 * Comprueba un código dentro de la ventana. Rechaza cualquier paso igual o anterior al último
 * aceptado, de modo que un código interceptado no sirve dos veces.
 */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  lastUsedCounter: number,
  nowMs = Date.now(),
): Promise<TotpCheck> {
  if (!/^\d{6}$/.test(code)) return { valid: false };
  const secret = base32Decode(secretBase32);
  const current = totpCounter(nowMs);
  let matched: number | undefined;
  // Se recorren todos los pasos de la ventana para no revelar por tiempo cuál coincidió.
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset++) {
    const counter = current + offset;
    if ((await hotp(secret, counter)) === code && counter > lastUsedCounter) matched ??= counter;
  }
  return matched === undefined ? { valid: false } : { valid: true, counter: matched };
}

export function otpauthUri(secretBase32: string, account: string, issuer = "Delyra"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
