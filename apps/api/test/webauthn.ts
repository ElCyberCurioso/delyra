/**
 * Autenticador WebAuthn por software para los tests (F7-09): clave P-256 (ES256), atestación
 * `none` y contador de firmas controlable. Produce las mismas respuestas JSON que el navegador.
 */

type Cbor = number | string | Uint8Array | Map<number | string, Cbor> | { [key: string]: Cbor };

function head(major: number, length: number): number[] {
  if (length < 24) return [(major << 5) | length];
  if (length < 0x100) return [(major << 5) | 24, length];
  if (length < 0x10000) return [(major << 5) | 25, length >> 8, length & 0xff];
  return [
    (major << 5) | 26,
    (length >>> 24) & 0xff,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
  ];
}

/** CBOR mínimo: enteros, texto, bytes y mapas (lo que usan la atestación y las claves COSE). */
function cbor(value: Cbor): number[] {
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return [...head(3, bytes.length), ...bytes];
  }
  if (value instanceof Uint8Array) return [...head(2, value.length), ...value];
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return [...head(5, entries.length), ...entries.flatMap(([k, v]) => [...cbor(k), ...cbor(v)])];
}

export function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function uint32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ]);
}

/** Firma ECDSA de WebCrypto (r‖s) → DER, que es lo que entrega un autenticador real. */
function toDer(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    const trimmed = bytes.slice(i);
    const body = (trimmed[0] ?? 0) & 0x80 ? concat(new Uint8Array([0]), trimmed) : trimmed;
    return concat(new Uint8Array([0x02, body.length]), body);
  };
  const r = integer(raw.slice(0, 32));
  const s = integer(raw.slice(32));
  return concat(new Uint8Array([0x30, r.length + s.length]), r, s);
}

interface CreationOptions {
  challenge: string;
  rp: { id: string };
}
interface RequestOptions {
  challenge: string;
  rpId: string;
}

export class SoftAuthenticator {
  counter = 0;
  readonly credentialId = crypto.getRandomValues(new Uint8Array(16));

  private constructor(private readonly keys: CryptoKeyPair) {}

  static async create(): Promise<SoftAuthenticator> {
    const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    return new SoftAuthenticator(keys);
  }

  get id(): string {
    return b64url(this.credentialId);
  }

  private clientData(type: string, challenge: string, origin: string): Uint8Array {
    return new TextEncoder().encode(
      JSON.stringify({ type, challenge, origin, crossOrigin: false }),
    );
  }

  /** Respuesta a `navigator.credentials.create()`. */
  async register(
    options: CreationOptions,
    { origin = "http://localhost:5173", challenge = options.challenge } = {},
  ) {
    const exported = (await crypto.subtle.exportKey("raw", this.keys.publicKey)) as ArrayBuffer;
    const raw = new Uint8Array(exported);
    const cose = new Map<number, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, raw.slice(1, 33)],
      [-3, raw.slice(33, 65)],
    ]);
    const authData = concat(
      await sha256(new TextEncoder().encode(options.rp.id)),
      new Uint8Array([0x45]), // UP + UV + AT
      uint32(this.counter),
      new Uint8Array(16), // AAGUID
      new Uint8Array([this.credentialId.length >> 8, this.credentialId.length & 0xff]),
      this.credentialId,
      new Uint8Array(cbor(cose)),
    );
    const attestationObject = new Uint8Array(cbor({ fmt: "none", attStmt: {}, authData }));
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key" as const,
      response: {
        clientDataJSON: b64url(this.clientData("webauthn.create", challenge, origin)),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  /** Respuesta a `navigator.credentials.get()`; cada firma sube el contador. */
  async sign(
    options: RequestOptions,
    { origin = "http://localhost:5173", counter = this.counter + 1 } = {},
  ) {
    this.counter = counter;
    const clientDataJSON = this.clientData("webauthn.get", options.challenge, origin);
    const authData = concat(
      await sha256(new TextEncoder().encode(options.rpId)),
      new Uint8Array([0x05]), // UP + UV
      uint32(counter),
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        this.keys.privateKey,
        concat(authData, await sha256(clientDataJSON)),
      ),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key" as const,
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(toDer(signature)),
      },
      clientExtensionResults: {},
    };
  }
}
