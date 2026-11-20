const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/**
 * Seudónimo estable de un identificador (HMAC-SHA256 truncado a 96 bits) para los logs:
 * permite agrupar las peticiones de un mismo usuario sin registrar su id real.
 */
export async function pseudonymize(value: string, key: string): Promise<string> {
  if (!key) throw new Error("Falta la clave de seudonimización");
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
  return toBase64Url(new Uint8Array(signature).slice(0, 12));
}
