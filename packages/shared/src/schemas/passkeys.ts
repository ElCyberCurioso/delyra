import { z } from "zod";

/**
 * Llaves de acceso (WebAuthn, F7-09). El navegador entrega las respuestas de las ceremonias en
 * JSON con los binarios en base64url; aquí solo se acota su forma y su tamaño, y la verificación
 * criptográfica la hace el servidor con @simplewebauthn/server.
 */

const base64url = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[A-Za-z0-9_-]*$/);

const isoDate = z.iso.datetime();

export const PASSKEY_NAME_MAX_LENGTH = 60;
export const MAX_PASSKEYS = 10;

const clientExtensionResults = z.record(z.string(), z.unknown());

const registrationResponseJsonSchema = z.object({
  id: base64url(1024).min(1),
  rawId: base64url(1024).min(1),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64url(4096).min(1),
    attestationObject: base64url(32_768).min(1),
    authenticatorData: base64url(32_768).optional(),
    transports: z.array(z.string().max(32)).max(10).optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    publicKey: base64url(4096).optional(),
  }),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults,
});

const authenticationResponseJsonSchema = z.object({
  id: base64url(1024).min(1),
  rawId: base64url(1024).min(1),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64url(4096).min(1),
    authenticatorData: base64url(4096).min(1),
    signature: base64url(2048).min(1),
    userHandle: base64url(512).optional(),
  }),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults,
});

export const addPasskeyRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "Ponle un nombre a la llave" })
    .max(PASSKEY_NAME_MAX_LENGTH),
  response: registrationResponseJsonSchema,
});

export const passkeyLoginRequestSchema = z.object({
  response: authenticationResponseJsonSchema,
});

/** Opciones de la ceremonia tal cual las genera el servidor (se pasan sin tocar al navegador). */
export const webauthnOptionsResponseSchema = z.object({
  options: z.record(z.string(), z.unknown()),
});

const passkeySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: isoDate,
  lastUsedAt: isoDate.nullable(),
  backedUp: z.boolean(),
});
export type Passkey = z.infer<typeof passkeySchema>;

export const passkeysResponseSchema = z.object({ passkeys: z.array(passkeySchema) });
