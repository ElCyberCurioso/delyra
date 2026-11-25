import { describe, expect, it } from "vitest";
import { androidAssetLinks, androidWebAuthnOrigins } from "./android-app";

/** Lo sirve la SPA del calendario tal cual: `https://delyra.app/.well-known/assetlinks.json`. */
const ASSET_LINKS_FILE = "../../../apps/calendar/public/.well-known/assetlinks.json";

describe("app de Android (F8-10)", () => {
  it("el origen WebAuthn es el base64url del SHA-256 del certificado", () => {
    // Huellas de bytes repetidos (sin pinta de secreto para gitleaks): FF da «/» en base64 y
    // FB EF BE da «+», que en base64url pasan a «_» y «-»; el «=» final desaparece.
    const slashes = Array<string>(32).fill("FF").join(":");
    const pluses = [..."FB:EF:BE:".repeat(10).split(":").slice(0, 30), "FB", "EF"].join(":");
    expect(androidWebAuthnOrigins([slashes, pluses])).toEqual([
      `android:apk-key-hash:${"_".repeat(42)}8`,
      `android:apk-key-hash:${"-".repeat(42)}8`,
    ]);
  });

  it("rechaza una huella mal escrita", () => {
    expect(() => androidWebAuthnOrigins(["0D:6A"])).toThrow();
  });

  it("assetlinks.json está al día", async () => {
    await expect(`${JSON.stringify(androidAssetLinks(), null, 2)}\n`).toMatchFileSnapshot(
      ASSET_LINKS_FILE,
    );
  });
});
