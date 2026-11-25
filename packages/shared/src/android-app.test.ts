import { describe, expect, it } from "vitest";
import { androidAssetLinks, androidWebAuthnOrigins } from "./android-app";

/** Lo sirve la SPA del calendario tal cual: `https://delyra.app/.well-known/assetlinks.json`. */
const ASSET_LINKS_FILE = "../../../apps/calendar/public/.well-known/assetlinks.json";

describe("app de Android (F8-10)", () => {
  it("el origen WebAuthn es el base64url del SHA-256 del certificado", () => {
    expect(
      androidWebAuthnOrigins([
        "0D:6A:02:D1:3E:47:70:BD:21:DE:F7:2A:DF:91:C5:43:AB:5D:17:59:CC:90:08:B7:77:9B:84:57:5D:26:F2:DF",
      ]),
    ).toEqual(["android:apk-key-hash:DWoC0T5HcL0h3vcq35HFQ6tdF1nMkAi3d5uEV10m8t8"]);
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
