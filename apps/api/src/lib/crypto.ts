import { timingSafeEqual } from "node:crypto";

/** Utilidades criptográficas básicas sobre WebCrypto (F1-02). */

const encoder = new TextEncoder();

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Token opaco de 256 bits, apto para URL (sesiones, invitaciones, recuperación). */
export function randomToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes));
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const data = typeof value === "string" ? encoder.encode(value) : value;
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

export async function hmacSha256Hex(key: string, value: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)));
}

/** Comparación en tiempo constante; longitudes distintas devuelven `false` sin atajos visibles. */
export function constantTimeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const left = typeof a === "string" ? encoder.encode(a) : a;
  const right = typeof b === "string" ? encoder.encode(b) : b;
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
