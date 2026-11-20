/**
 * Comprobación opcional contra Have I Been Pwned con k-anonimato (F1-07): solo se envían los
 * 5 primeros caracteres del SHA-1 de la contraseña y se pide relleno para ocultar el tamaño de la
 * respuesta. Devuelve `null` si el servicio no responde: nunca bloquea un registro por su caída.
 */
export async function isPwnedPassword(
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean | null> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const prefix = hex.slice(0, 5);
  const suffix = hex.slice(5);
  try {
    const response = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "delyra-password-check" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    for (const line of (await response.text()).split("\n")) {
      const [candidate, count] = line.trim().split(":");
      if (candidate === suffix && Number(count) > 0) return true;
    }
    return false;
  } catch {
    return null;
  }
}
