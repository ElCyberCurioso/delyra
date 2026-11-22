import { Unzip, UnzipInflate, type UnzipFile, Zip, ZipDeflate } from "fflate";

/**
 * `.zip` en streaming para las copias de seguridad (F6-02, F6-04).
 *
 * - Escritura: fflate genera el zip a trozos y `R2StreamWriter` lo sube a R2 por partes
 *   (multipart, partes de 8 MiB), así que la memoria no depende del tamaño de la copia.
 * - Lectura: cada entrada se acumula (con su límite) y se entrega entera; se cuentan los bytes
 *   que de verdad salen del descompresor, no los que declara el zip.
 */

const PART_BYTES = 8 * 1024 * 1024;

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Sube a R2 un contenido de tamaño desconocido, por partes iguales de 8 MiB. */
export class R2StreamWriter {
  #upload: R2MultipartUpload | null = null;
  readonly #parts: R2UploadedPart[] = [];
  #chunks: Uint8Array[] = [];
  #buffered = 0;
  #total = 0;

  constructor(
    private readonly bucket: R2Bucket,
    private readonly key: string,
    private readonly options: R2PutOptions & R2MultipartOptions,
  ) {}

  get size(): number {
    return this.#total;
  }

  write(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    this.#chunks.push(chunk);
    this.#buffered += chunk.byteLength;
    this.#total += chunk.byteLength;
  }

  #take(size: number): Uint8Array {
    const out = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const head = this.#chunks[0];
      if (!head) break;
      const needed = size - offset;
      if (head.byteLength <= needed) {
        out.set(head, offset);
        offset += head.byteLength;
        this.#chunks.shift();
      } else {
        out.set(head.subarray(0, needed), offset);
        this.#chunks[0] = head.subarray(needed);
        offset += needed;
      }
    }
    this.#buffered -= size;
    return out;
  }

  /** Sube las partes completas que haya en memoria. */
  async flush(): Promise<void> {
    while (this.#buffered >= PART_BYTES) {
      this.#upload ??= await this.bucket.createMultipartUpload(this.key, this.options);
      const part = await this.#upload.uploadPart(this.#parts.length + 1, this.#take(PART_BYTES));
      this.#parts.push(part);
    }
  }

  async finish(): Promise<R2Object | null> {
    await this.flush();
    const rest = this.#take(this.#buffered);
    if (!this.#upload) return this.bucket.put(this.key, rest, this.options);
    if (rest.byteLength > 0) {
      this.#parts.push(await this.#upload.uploadPart(this.#parts.length + 1, rest));
    }
    return this.#upload.complete(this.#parts);
  }

  async abort(): Promise<void> {
    if (this.#upload) await this.#upload.abort().catch(() => undefined);
    this.#chunks = [];
  }
}

export interface ZipEntryInput {
  name: string;
  data: Uint8Array;
  /** 0 = sin comprimir (adjuntos que ya lo están). */
  level: 0 | 6;
}

/** Escribe un zip con las entradas que se le vayan dando, sin tenerlas todas a la vez. */
export async function writeZip(
  writer: R2StreamWriter,
  entries: AsyncIterable<ZipEntryInput>,
): Promise<void> {
  // En un objeto: el callback lo modifica y TypeScript no lo sigue en un `let`.
  const state: { failure: Error | null } = { failure: null };
  const zip = new Zip((error, chunk) => {
    if (error) state.failure = error;
    else writer.write(chunk);
  });
  for await (const entry of entries) {
    // Siempre con deflate (nivel 0 si no merece la pena): una entrada «stored» de tamaño
    // desconocido no se puede leer después en streaming.
    const file = new ZipDeflate(entry.name, { level: entry.level });
    zip.add(file);
    file.push(entry.data, true);
    if (state.failure) throw state.failure;
    await writer.flush();
  }
  zip.end();
  if (state.failure) throw state.failure;
}

export class ZipLimitError extends Error {
  override name = "ZipLimitError";
}
export class ZipFormatError extends Error {
  override name = "ZipFormatError";
}

/**
 * Lee un zip en streaming y entrega cada entrada entera a `handle` (en orden). `maxBytes`
 * decide el límite de cada entrada por su nombre (0 = se ignora).
 */
export async function readZip(
  body: ReadableStream<Uint8Array>,
  maxBytes: (name: string) => number,
  totalBytes: number,
  handle: (name: string, data: Uint8Array) => Promise<void>,
): Promise<void> {
  const ready: { name: string; data: Uint8Array }[] = [];
  const state: { failure: Error | null; total: number } = { failure: null, total: 0 };
  const fail = (error: Error) => {
    state.failure ??= error;
    throw error;
  };
  const unzip = new Unzip((file: UnzipFile) => {
    const limit = maxBytes(file.name);
    if (state.failure || limit === 0 || file.name.endsWith("/")) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (error) fail(new ZipFormatError("El zip está dañado"));
      size += chunk.byteLength;
      state.total += chunk.byteLength;
      if (size > limit) fail(new ZipLimitError(`«${file.name.slice(0, 60)}» es demasiado grande`));
      if (state.total > totalBytes)
        fail(new ZipLimitError("El contenido del zip es demasiado grande"));
      chunks.push(chunk);
      if (final) ready.push({ name: file.name, data: concat(chunks, size) });
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      try {
        unzip.push(value ?? new Uint8Array(0), done);
      } catch (error) {
        if (state.failure) throw state.failure;
        throw error instanceof ZipLimitError || error instanceof ZipFormatError
          ? error
          : new ZipFormatError("El zip está dañado o no se puede leer");
      }
      if (state.failure) throw state.failure;
      while (ready.length > 0) {
        const entry = ready.shift();
        if (entry) await handle(entry.name, entry.data);
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
