import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  fromBase64Url,
  hmacSha256Hex,
  randomToken,
  sha256Hex,
  toBase64Url,
} from "../src/lib/crypto";
import { decryptField, encryptField, keyringFromEnv } from "../src/lib/field-crypto";
import {
  equalizeTiming,
  hashPassword,
  needsRehash,
  PASSWORD_PARAMS,
  verifyPassword,
} from "../src/lib/password";
import {
  base32Decode,
  base32Encode,
  generateTotp,
  generateTotpSecret,
  hotp,
  otpauthUri,
  totpCounter,
  verifyTotp,
} from "../src/lib/totp";

describe("crypto básico", () => {
  it("genera tokens de 256 bits distintos y aptos para URL", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => randomToken()));
    expect(tokens.size).toBe(100);
    for (const token of tokens) expect(token).toMatch(/^[\w-]{43}$/);
  });

  it("base64url ida y vuelta", () => {
    const bytes = new Uint8Array([0, 255, 251, 62, 63, 128]);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });

  it("SHA-256 y HMAC conocidos", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await hmacSha256Hex("k", "v")).toHaveLength(64);
  });

  it("comparación en tiempo constante", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});

describe("contraseñas (scrypt)", () => {
  it("hashea con sal aleatoria y verifica", async () => {
    const a = await hashPassword("una contraseña bastante larga");
    const b = await hashPassword("una contraseña bastante larga");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\$scrypt\$ln=15,r=8,p=3\$/);
    expect(await verifyPassword("una contraseña bastante larga", a)).toBe(true);
    expect(await verifyPassword("una contraseña bastante largA", a)).toBe(false);
  });

  it("normaliza Unicode (NFKC)", async () => {
    const hash = await hashPassword("ﬁesta-de-contraseñas");
    expect(await verifyPassword("fiesta-de-contraseñas", hash)).toBe(true);
  });

  it("rechaza hashes mal formados y detecta parámetros antiguos", async () => {
    expect(await verifyPassword("x", "texto plano")).toBe(false);
    expect(await verifyPassword("x", "$scrypt$ln=30,r=8,p=1$AA$AA")).toBe(false);
    expect(needsRehash("$scrypt$ln=14,r=8,p=1$AAAA$AAAA")).toBe(true);
    expect(needsRehash(await hashPassword("x".repeat(12)))).toBe(false);
    expect(PASSWORD_PARAMS.ln).toBe(15);
  });

  it("iguala el tiempo cuando el usuario no existe", async () => {
    await expect(equalizeTiming("lo-que-sea")).resolves.toBeUndefined();
  });
});

describe("cifrado por campo (AES-256-GCM)", () => {
  it("cifra con IV aleatorio y descifra con el mismo AAD", async () => {
    const keyring = await keyringFromEnv({ APP_ENV: "development" });
    const a = await encryptField("JBSWY3DPEHPK3PXP", keyring, "user-1");
    const b = await encryptField("JBSWY3DPEHPK3PXP", keyring, "user-1");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(await decryptField(a, keyring, "user-1")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("falla si se mueve el valor a otro usuario (AAD) o se manipula", async () => {
    const keyring = await keyringFromEnv({ APP_ENV: "development" });
    const value = await encryptField("secreto", keyring, "user-1");
    await expect(decryptField(value, keyring, "user-2")).rejects.toThrow();
    await expect(decryptField(`${value.slice(0, -2)}AA`, keyring, "user-1")).rejects.toThrow();
  });

  it("exige una clave real en producción", async () => {
    await expect(keyringFromEnv({ APP_ENV: "production" })).rejects.toThrow(
      /FIELD_ENCRYPTION_KEY_V1/,
    );
  });
});

describe("TOTP (RFC 6238)", () => {
  // Apéndice B de la RFC 6238: SHA-1, semilla ASCII "12345678901234567890", 8 dígitos.
  const rfcSecret = new TextEncoder().encode("12345678901234567890");
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("vector de la RFC en T=%i", async (seconds, expected) => {
    expect(await hotp(rfcSecret, totpCounter(seconds * 1000), 8)).toBe(expected);
  });

  it("base32 ida y vuelta (RFC 4648)", () => {
    expect(base32Encode(new TextEncoder().encode("foobar"))).toBe("MZXW6YTBOI");
    expect(new TextDecoder().decode(base32Decode("MZXW6YTBOI"))).toBe("foobar");
    expect(() => base32Decode("0189!")).toThrow();
  });

  it("acepta el código actual y los de la ventana ±1, no más", async () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const now = Date.UTC(2026, 10, 20, 12, 0, 0);
    for (const delta of [-30_000, 0, 30_000]) {
      const code = await generateTotp(secret, now + delta);
      expect((await verifyTotp(secret, code, 0, now)).valid).toBe(true);
    }
    const old = await generateTotp(secret, now - 90_000);
    expect((await verifyTotp(secret, old, 0, now)).valid).toBe(false);
  });

  it("impide reutilizar un código ya aceptado (anti-replay)", async () => {
    const secret = generateTotpSecret();
    const now = Date.UTC(2026, 10, 20, 12, 0, 0);
    const code = await generateTotp(secret, now);
    const first = await verifyTotp(secret, code, 0, now);
    expect(first.valid).toBe(true);
    expect((await verifyTotp(secret, code, first.counter ?? 0, now)).valid).toBe(false);
  });

  it("rechaza formatos que no son 6 dígitos", async () => {
    const secret = generateTotpSecret();
    for (const code of ["", "12345", "1234567", "abcdef", "12 345"]) {
      expect((await verifyTotp(secret, code, 0)).valid).toBe(false);
    }
  });

  it("construye la URI otpauth", () => {
    const uri = otpauthUri("JBSWY3DPEHPK3PXP", "ana@example.com");
    expect(uri).toBe(
      "otpauth://totp/Delyra%3Aana%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Delyra&algorithm=SHA1&digits=6&period=30",
    );
  });
});
