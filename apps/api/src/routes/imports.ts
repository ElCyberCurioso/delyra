import { idSchema, startImportRequestSchema } from "@delyra/shared";
import { type Context, Hono } from "hono";
import { createDb } from "../db/client";
import type { ImportRow } from "../db/schema";
import { AppError } from "../lib/errors";
import { invalidField, readBody } from "../lib/http";
import { looksLikeIcs } from "../lib/ics";
import { IMPORT_LIMITS } from "../lib/import-model";
import { safeErrorMessage } from "../lib/logger";
import { currentAuth, requireActiveSession } from "../middleware/session";
import { calendarRepository } from "../repositories/calendars";
import { importRepository } from "../repositories/imports";
import { peekStream, sanitizeFilename } from "../services/attachments";
import {
  deleteImportData,
  importDto,
  IMPORTS_PER_DAY,
  refreshStatus,
  sourceKey,
  storedPreview,
} from "../services/imports";
import type { AppEnv } from "../types";

/**
 * Importaciones (F5-02, F5-03). Subir un `.ics` o el `.zip` que exporta Google, ver la vista
 * previa que prepara el Workflow, elegir destinos y seguir el progreso.
 */

const DAY_MS = 86_400_000;

function repo(c: Context<AppEnv>) {
  return importRepository(createDb(c.env.DB), currentAuth(c).user.id);
}

function idParam(c: Context<AppEnv>): string {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) throw new AppError(404);
  return id.data;
}

async function load(c: Context<AppEnv>): Promise<ImportRow> {
  const r = repo(c);
  const row = await r.get(idParam(c));
  if (!row) throw new AppError(404);
  return refreshStatus(r, row, Date.now());
}

/** Una importación a la vez y un máximo diario (protege el Workflow y la cuota de Google). */
export async function assertCanStartImport(c: Context<AppEnv>): Promise<void> {
  const r = repo(c);
  for (const row of await r.active()) {
    const fresh = await refreshStatus(r, row, Date.now());
    if (fresh.status === "analyzing" || fresh.status === "importing") {
      throw new AppError(409, {
        detail: "Ya tienes una importación en marcha. Espera a que termine.",
      });
    }
  }
  if ((await r.createdSince(Date.now() - DAY_MS)) >= IMPORTS_PER_DAY) {
    throw new AppError(429, { detail: "Has hecho demasiadas importaciones hoy. Prueba mañana." });
  }
}

/** Lanza el análisis; si el Workflow no arranca, la importación queda como fallida. */
export async function launchAnalysis(c: Context<AppEnv>, row: ImportRow): Promise<ImportRow> {
  try {
    await c.env.IMPORT_WORKFLOW.create({
      id: `${row.id}-analyze`,
      params: { importId: row.id, ownerId: row.ownerId, phase: "analyze" },
    });
    return row;
  } catch (error) {
    c.get("logger").error("import_workflow_failed", { error: safeErrorMessage(error) });
    return (
      (await repo(c).update(row.id, {
        status: "failed",
        error: "No se ha podido empezar a leer el calendario. Vuelve a intentarlo.",
        googleTokenEnc: null,
        finishedAt: new Date(),
      })) ?? row
    );
  }
}

export const importRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  .get("/", async (c) => {
    const r = repo(c);
    const now = Date.now();
    const rows = await Promise.all((await r.list(10)).map((row) => refreshStatus(r, row, now)));
    return c.json({ imports: rows.map(importDto) });
  })

  // Cuerpo binario en streaming, como los adjuntos (F4-06): `X-Filename` + `Content-Length`.
  .post("/", async (c) => {
    await assertCanStartImport(c);
    const length = Number(c.req.header("content-length"));
    if (!Number.isInteger(length) || length <= 0) {
      throw new AppError(411, { detail: "Falta el tamaño del fichero" });
    }
    if (length > IMPORT_LIMITS.uploadBytes) {
      throw new AppError(413, { detail: "El fichero supera los 25 MB" });
    }
    let rawName: string;
    try {
      rawName = decodeURIComponent(c.req.header("x-filename") ?? "");
    } catch {
      throw invalidField("filename", "Nombre de fichero no válido");
    }
    const body = c.req.raw.body as ReadableStream<Uint8Array> | null;
    if (!body) throw new AppError(400, { detail: "Falta el fichero" });

    // El tipo se decide por el contenido: un zip (`PK\x03\x04`) o un calendario de texto.
    const { head, stream } = await peekStream(body);
    const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
    const isIcs = !isZip && looksLikeIcs(new TextDecoder().decode(head));
    if (!isZip && !isIcs) {
      await stream.cancel();
      throw new AppError(415, {
        detail: "Sube el .zip que exporta Google Calendar o un fichero .ics",
      });
    }

    const r = repo(c);
    const row = await r.create({
      source: "file",
      status: "analyzing",
      filename: sanitizeFilename(rawName || (isZip ? "calendario.zip" : "calendario.ics")),
      sizeBytes: length,
    });
    const key = sourceKey(row.ownerId, row.id);
    const fixed = new FixedLengthStream(length);
    const piping = stream.pipeTo(fixed.writable);
    try {
      await c.env.IMPORTS.put(key, fixed.readable, {
        httpMetadata: { contentType: isZip ? "application/zip" : "text/calendar" },
      });
      await piping;
    } catch {
      await c.env.IMPORTS.delete(key);
      await r.remove(row.id);
      throw new AppError(400, { detail: "El fichero no coincide con su tamaño" });
    }
    return c.json({ import: importDto(await launchAnalysis(c, row)) }, 202);
  })

  .get("/:id", async (c) => c.json({ import: importDto(await load(c)) }))

  .post("/:id/start", async (c) => {
    const row = await load(c);
    const body = await readBody(c, startImportRequestSchema);
    if (row.status !== "ready") {
      throw new AppError(409, {
        detail:
          row.status === "expired"
            ? "La vista previa ha caducado. Vuelve a subir el fichero."
            : "Esta importación ya no se puede empezar",
      });
    }
    const preview = storedPreview(row);
    const keys = new Set(preview.calendars.map((cal) => cal.key));
    const seen = new Set<string>();
    for (const [i, choice] of body.calendars.entries()) {
      if (!keys.has(choice.key) || seen.has(choice.key)) {
        throw invalidField(`calendars.${String(i)}.key`, "Calendario desconocido");
      }
      seen.add(choice.key);
    }
    const chosen = body.calendars.filter((choice) => choice.target !== "skip");
    if (chosen.length === 0) {
      throw invalidField("calendars", "Elige al menos un calendario para importar");
    }
    const calendars = calendarRepository(createDb(c.env.DB), row.ownerId);
    const own = await calendars.list();
    for (const [i, choice] of body.calendars.entries()) {
      if (choice.target !== "existing") continue;
      const target = own.find((cal) => cal.id === choice.calendarId);
      // Un calendario ajeno responde igual que uno inexistente.
      if (!target)
        throw invalidField(`calendars.${String(i)}.calendarId`, "Calendario no encontrado");
      if (target.readOnly) {
        throw invalidField(
          `calendars.${String(i)}.calendarId`,
          "No se puede importar en una suscripción de solo lectura",
        );
      }
    }
    const created = chosen.filter((choice) => choice.target === "new").length;
    if (own.length + created > 50) {
      throw invalidField("calendars", "Se superaría el máximo de 50 calendarios");
    }
    const total = preview.calendars
      .filter((cal) => chosen.some((choice) => choice.key === cal.key))
      .reduce((sum, cal) => sum + cal.events, 0);

    const r = repo(c);
    const started = await r.transition(row.id, "ready", {
      status: "importing",
      options: JSON.stringify(body),
      progressDone: 0,
      progressTotal: total,
    });
    if (!started) throw new AppError(409, { detail: "Esta importación ya se ha empezado" });
    try {
      await c.env.IMPORT_WORKFLOW.create({
        id: `${row.id}-import`,
        params: { importId: row.id, ownerId: row.ownerId, phase: "import" },
      });
    } catch (error) {
      c.get("logger").error("import_workflow_failed", { error: safeErrorMessage(error) });
      // Se puede volver a intentar: la vista previa sigue ahí.
      await r.update(row.id, { status: "ready" });
      throw new AppError(503, { detail: "No se ha podido empezar la importación. Reinténtalo." });
    }
    return c.json({ import: importDto(started) }, 202);
  })

  .delete("/:id", async (c) => {
    const row = await load(c);
    if (row.status === "analyzing" || row.status === "importing") {
      throw new AppError(409, { detail: "Espera a que termine la importación" });
    }
    await deleteImportData(c.env.IMPORTS, row.ownerId, row.id);
    await repo(c).remove(row.id);
    return c.body(null, 204);
  });
