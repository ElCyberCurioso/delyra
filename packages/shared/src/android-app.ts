/**
 * App de Android (docs/plan-android.md, F8-10): los paquetes y los certificados de firma en los que
 * confía Delyra. De aquí salen `/.well-known/assetlinks.json` (App Links y llaves de acceso
 * compartidas con la app) y los orígenes que la API acepta en WebAuthn.
 *
 * Las huellas son públicas por diseño (van en `assetlinks.json`); la clave privada no sale nunca del
 * almacén de firma.
 */

const ANDROID_PACKAGES = ["app.delyra", "app.delyra.debug"] as const;

/** SHA-256 de los certificados de firma, como los da `keytool -list -v`. */
const ANDROID_CERT_FINGERPRINTS: readonly string[] = [
  // Certificado debug del ordenador de desarrollo (decisión del 2026-11-25, ADR-0016): permite
  // probar llaves de acceso y App Links en producción con la build debug. En F8-11 se añade el de
  // publicación (Play App Signing) y se valora quitar este.
  "0D:6A:02:D1:3E:47:70:BD:21:DE:F7:2A:DF:91:C5:43:AB:5D:17:59:CC:90:08:B7:77:9B:84:57:5D:26:F2:DF",
];

/** `0D:6A:…` → `DWoC…` (base64url sin relleno de los 32 bytes). */
function fingerprintToBase64Url(fingerprint: string): string {
  const hex = fingerprint.replaceAll(":", "");
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`Huella SHA-256 no válida: ${fingerprint}`);
  let binary = "";
  for (let i = 0; i < hex.length; i += 2)
    binary += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/**
 * Orígenes de la app en WebAuthn: Android firma el `clientDataJSON` con
 * `android:apk-key-hash:<base64url del SHA-256 del certificado>` en vez del origen web.
 */
export function androidWebAuthnOrigins(
  fingerprints: readonly string[] = ANDROID_CERT_FINGERPRINTS,
): string[] {
  return fingerprints.map(
    (fingerprint) => `android:apk-key-hash:${fingerprintToBase64Url(fingerprint)}`,
  );
}

/**
 * `assetlinks.json` (Digital Asset Links): abrir enlaces de delyra.app en la app (App Links) y usar
 * en ella las llaves de acceso de delyra.app (Credential Manager).
 */
export function androidAssetLinks(fingerprints: readonly string[] = ANDROID_CERT_FINGERPRINTS) {
  return ANDROID_PACKAGES.map((packageName) => ({
    relation: [
      "delegate_permission/common.handle_all_urls",
      "delegate_permission/common.get_login_creds",
    ],
    target: {
      namespace: "android_app",
      package_name: packageName,
      sha256_cert_fingerprints: [...fingerprints],
    },
  }));
}
