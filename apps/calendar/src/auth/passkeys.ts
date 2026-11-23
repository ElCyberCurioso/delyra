import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

/**
 * Llaves de acceso en el navegador (F7-09). La librería se carga solo al usarla, así no pesa en
 * la carga inicial del calendario.
 */

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

export async function createPasskeyCredential(options: Record<string, unknown>) {
  const { startRegistration } = await import("@simplewebauthn/browser");
  return startRegistration({
    optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
  });
}

export async function getPasskeyAssertion(options: Record<string, unknown>) {
  const { startAuthentication } = await import("@simplewebauthn/browser");
  return startAuthentication({
    optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
  });
}

/**
 * Errores del propio navegador: la persona canceló o se agotó el tiempo (`cancelled`), o el
 * dispositivo ya tiene una llave de esta cuenta (`exists`). El resto los explica el servidor.
 */
export function passkeyErrorKind(error: unknown): "cancelled" | "exists" | null {
  if (!(error instanceof Error)) return null;
  const code = "code" in error ? error.code : undefined;
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" || error.name === "InvalidStateError") {
    return "exists";
  }
  if (
    code === "ERROR_CEREMONY_ABORTED" ||
    error.name === "NotAllowedError" ||
    error.name === "AbortError"
  ) {
    return "cancelled";
  }
  return null;
}
