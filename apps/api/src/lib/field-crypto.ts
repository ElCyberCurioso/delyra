import { fromBase64Url, randomBytes, toBase64Url } from "./crypto";

/**
 * Cifrado por campo con AES-256-GCM (F1-02). Formato: `v1:<iv>.<ciphertext>` en base64url.
 * El prefijo identifica la clave para poder rotarla: se cifra siempre con la versión actual y se
 * descifra con la que indique el valor. El dato asociado (AAD) ata el cifrado a su dueño, de modo
 * que copiar el valor a otra fila no sirve.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface Keyring {
  current: string;
  keys: ReadonlyMap<string, CryptoKey>;
}

/** Clave de desarrollo fija (32 bytes en cero). Nunca se acepta en producción. */
const DEV_KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function importKey(base64: string): Promise<CryptoKey> {
  const raw = fromBase64Url(base64);
  if (raw.length !== 32) throw new Error("La clave de cifrado debe tener 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function keyringFromEnv(env: {
  APP_ENV: string;
  FIELD_ENCRYPTION_KEY_V1?: string;
}): Promise<Keyring> {
  let v1 = env.FIELD_ENCRYPTION_KEY_V1;
  if (!v1) {
    if (env.APP_ENV === "production") throw new Error("Falta el secreto FIELD_ENCRYPTION_KEY_V1");
    v1 = DEV_KEY_B64;
  }
  return { current: "v1", keys: new Map([["v1", await importKey(v1)]]) };
}

export async function encryptField(plain: string, keyring: Keyring, aad: string): Promise<string> {
  const key = keyring.keys.get(keyring.current);
  if (!key) throw new Error("Clave de cifrado actual no disponible");
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(plain),
  );
  return `${keyring.current}:${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptField(value: string, keyring: Keyring, aad: string): Promise<string> {
  const match = /^(v\d+):([\w-]+)\.([\w-]+)$/.exec(value);
  if (!match) throw new Error("Valor cifrado con formato no válido");
  const [, version, iv, ciphertext] = match;
  const key = keyring.keys.get(version ?? "");
  if (!key) throw new Error(`Clave de cifrado ${String(version)} no disponible`);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(iv ?? ""), additionalData: encoder.encode(aad) },
    key,
    fromBase64Url(ciphertext ?? ""),
  );
  return decoder.decode(plain);
}
