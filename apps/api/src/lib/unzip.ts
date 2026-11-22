import { Unzip, UnzipInflate, type UnzipFile } from "fflate";
import { IMPORT_LIMITS, ImportFormatError, ImportLimitError, stripBom } from "./import-model";

/**
 * Descompresión del `.zip` de Google Takeout / «Exportar» (F5-02) con fflate, en streaming.
 *
 * Contra las zip bomb no se confía en los tamaños que declara el propio zip: se cuentan los
 * bytes que de verdad salen del descompresor y se aborta en cuanto se pasa del límite. Solo se
 * extraen los `.ics` (sin rutas raras ni ficheros ocultos) y como mucho `IMPORT_LIMITS.calendars`.
 */

export interface ZipEntry {
  /** Nombre del fichero dentro del zip, sin carpetas. */
  name: string;
  text: string;
}

const decoderOptions = { fatal: false, ignoreBOM: false } as const;

function isCalendarFile(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  return (
    name.toLowerCase().endsWith(".ics") &&
    !name.startsWith(".") &&
    !path.startsWith("__MACOSX/") &&
    !path.includes("..")
  );
}

export async function unzipCalendars(
  body: ReadableStream<Uint8Array>,
  limits: { totalBytes: number; fileBytes: number; files: number } = {
    totalBytes: IMPORT_LIMITS.unzippedBytes,
    fileBytes: IMPORT_LIMITS.icsBytes,
    files: IMPORT_LIMITS.calendars,
  },
): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  let total = 0;
  // En un objeto: el callback de fflate lo modifica y TypeScript no lo sigue en un `let`.
  const state: { failure: Error | null } = { failure: null };
  const fail = (error: Error) => {
    state.failure ??= error;
    throw error;
  };

  const unzip = new Unzip((file: UnzipFile) => {
    if (state.failure || !isCalendarFile(file.name)) return;
    if (entries.length >= limits.files) {
      fail(new ImportLimitError(`El zip tiene más de ${String(limits.files)} calendarios`));
    }
    const decoder = new TextDecoder("utf-8", decoderOptions);
    const parts: string[] = [];
    let size = 0;
    const entry: ZipEntry = { name: file.name.split("/").pop() ?? "calendario.ics", text: "" };
    entries.push(entry);
    file.ondata = (error, chunk, final) => {
      if (error) fail(new ImportFormatError("El zip está dañado"));
      size += chunk.byteLength;
      total += chunk.byteLength;
      if (size > limits.fileBytes)
        fail(new ImportLimitError("Un calendario del zip es demasiado grande"));
      if (total > limits.totalBytes)
        fail(new ImportLimitError("El contenido del zip es demasiado grande"));
      parts.push(decoder.decode(chunk, { stream: !final }));
      if (final) entry.text = stripBom(parts.join(""));
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
        throw error instanceof ImportLimitError || error instanceof ImportFormatError
          ? error
          : new ImportFormatError("El zip está dañado o no se puede leer");
      }
      if (state.failure) throw state.failure;
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const complete = entries.filter((e) => e.text.length > 0);
  if (complete.length === 0) {
    throw new ImportFormatError("El zip no contiene ningún calendario (.ics)");
  }
  return complete;
}
