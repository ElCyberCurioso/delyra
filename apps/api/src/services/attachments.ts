import type { ATTACHMENT_TYPES } from "@delyra/shared";

/**
 * Adjuntos (F4-06). El tipo se decide por el contenido (firma de los primeros bytes), no por
 * el nombre ni por la cabecera del cliente; el nombre se sanea y se guarda aparte de la clave
 * en R2, que nunca depende de lo que envía el usuario.
 */

export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

/** Bytes que se leen antes de decidir el tipo. */
const SNIFF_BYTES = 512;

const OOXML: AttachmentType[] = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** Tipo real del fichero según sus primeros bytes, o null si no está permitido. */
export function sniffType(head: Uint8Array, declared: string): AttachmentType | null {
  const claimed = declared.split(";")[0]?.trim().toLowerCase() ?? "";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(head, ascii("GIF87a")) || startsWith(head, ascii("GIF89a"))) return "image/gif";
  if (startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(head, ascii("%PDF-"))) return "application/pdf";
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    // Los documentos de Office son ZIP: se respeta el tipo declarado si es uno de ellos.
    return OOXML.find((type) => type === claimed) ?? "application/zip";
  }
  if (claimed === "text/plain" || claimed === "text/csv") {
    if (head.includes(0)) return null;
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(head, {
        stream: true,
      });
    } catch {
      return null;
    }
    // Nada que un navegador pudiera interpretar como página o script.
    const start = text.trimStart().slice(0, 20).toLowerCase();
    if (/^<(!doctype|html|script|svg|\?xml|body|iframe)/.test(start)) return null;
    return claimed;
  }
  return null;
}

/** Nombre seguro: sin rutas, sin caracteres de control ni reservados, como mucho 120. */
export function sanitizeFilename(raw: string): string {
  let name = raw.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex -- se quitan precisamente los de control
  name = name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[<>:"|?*]/g, "_");
  name = name.replace(/^[\s.]+|[\s.]+$/g, "");
  if (name.length > 120) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
    name = name.slice(0, 120 - ext.length) + ext;
  }
  return name || "adjunto";
}

/** `Content-Disposition` de descarga con el nombre en ASCII y en UTF-8 (RFC 6266). */
export function contentDisposition(filename: string): string {
  const fallback = filename
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function attachmentKey(ownerId: string, boardId: string, cardId: string, id: string) {
  return `boards/${ownerId}/${boardId}/${cardId}/${id}`;
}

/** Borra todo lo que cuelga de un prefijo (tarjeta, columna o tablero borrados). */
export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listing = await bucket.list({ prefix, cursor, limit: 1000 });
    const keys = listing.objects.map((o) => o.key);
    if (keys.length > 0) await bucket.delete(keys);
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}

/** ¿Empieza como un zip (`PK\x03\x04`)? */
export function isZipHead(head: Uint8Array): boolean {
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

/**
 * Lee los primeros bytes del cuerpo para decidir el tipo y devuelve un stream equivalente al
 * original (cabeza + resto), sin cargar el fichero entero en memoria.
 */
export async function peekStream(
  body: ReadableStream<Uint8Array>,
): Promise<{ head: Uint8Array; stream: ReadableStream<Uint8Array> }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let done = false;
  while (size < SNIFF_BYTES && !done) {
    const result = await reader.read();
    done = result.done;
    if (result.value) {
      chunks.push(result.value);
      size += result.value.byteLength;
    }
  }
  const head = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    head.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (head.byteLength > 0) controller.enqueue(head);
      if (done) controller.close();
    },
    async pull(controller) {
      const result = await reader.read();
      if (result.done) controller.close();
      else controller.enqueue(result.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { head: head.slice(0, SNIFF_BYTES), stream };
}
