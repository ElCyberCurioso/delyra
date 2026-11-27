import {
  BACKUP_LIMITS,
  backupSettingsSchema,
  restoreFromBackupRequestSchema,
  startRestoreRequestSchema,
} from "@delyra/shared";
import { type Context, Hono } from "hono";
import { createDb } from "../db/client";
import { AppError } from "../lib/errors";
import { idParam, invalidField, readBody, readUpload } from "../lib/http";
import { safeErrorMessage } from "../lib/logger";
import { currentAuth, requireActiveSession } from "../middleware/session";
import { isZipHead, peekStream, sanitizeFilename } from "../services/attachments";
import { audit } from "../services/audit";
import {
  deleteRestoreData,
  readPlan,
  refreshRestore,
  restoreDto,
  restoreRepository,
  restoreSourceKey,
} from "../services/restores";
import {
  backupDto,
  backupRepository,
  getBackupSettings,
  refreshBackup,
  updateBackupSettings,
} from "../services/user-backups";
import type { AppEnv } from "../types";

/**
 * Copias de seguridad del usuario (F6-02 a F6-05): crear, descargar y borrar copias, ajustar la
 * copia automática y restaurar (de una copia guardada o de un fichero), con deshacer.
 */

const DAY_MS = 86_400_000;
const MANUAL_PER_DAY = 10;
const RESTORES_PER_DAY = 10;

function deps(c: Context<AppEnv>) {
  const db = createDb(c.env.DB);
  const ownerId = currentAuth(c).user.id;
  return {
    db,
    ownerId,
    backups: backupRepository(db, ownerId),
    restores: restoreRepository(db, ownerId),
  };
}

/** Una operación de copia o restauración a la vez por usuario. */
async function assertIdle(c: Context<AppEnv>) {
  const { backups, restores } = deps(c);
  const now = Date.now();
  for (const row of await backups.running()) {
    if ((await refreshBackup(backups, row, now)).status === "running") {
      throw new AppError(409, { detail: "Ya se está haciendo una copia. Espera a que termine." });
    }
  }
  for (const row of await restores.active()) {
    const fresh = await refreshRestore(restores, row, now);
    if (fresh.status === "validating" || fresh.status === "restoring") {
      throw new AppError(409, { detail: "Ya hay una restauración en marcha." });
    }
  }
}

async function launch(
  c: Context<AppEnv>,
  id: string,
  params: Parameters<Env["BACKUP_WORKFLOW"]["create"]>[0],
) {
  try {
    await c.env.BACKUP_WORKFLOW.create(params);
    return true;
  } catch (error) {
    c.get("logger").error("backup_workflow_failed", { id, error: safeErrorMessage(error) });
    return false;
  }
}

export const backupRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  .get("/", async (c) => {
    const { db, ownerId, backups, restores } = deps(c);
    const now = Date.now();
    const rows = await Promise.all(
      (await backups.list()).map((r) => refreshBackup(backups, r, now)),
    );
    const recent = await Promise.all(
      (await restores.list()).map((r) => refreshRestore(restores, r, now)),
    );
    return c.json({
      backups: rows.map(backupDto),
      settings: await getBackupSettings(db, ownerId),
      restores: recent.map(restoreDto),
    });
  })

  .post("/", async (c) => {
    await assertIdle(c);
    const { backups } = deps(c);
    const today = (await backups.list(100)).filter(
      (b) => b.kind === "manual" && b.createdAt.getTime() > Date.now() - DAY_MS,
    );
    if (today.length >= MANUAL_PER_DAY) {
      throw new AppError(429, { detail: "Has hecho muchas copias hoy. Prueba mañana." });
    }
    const row = await backups.create("manual");
    const started = await launch(c, row.id, {
      id: `backup-${row.id}`,
      params: { op: "export", ownerId: row.ownerId, backupId: row.id },
    });
    if (!started) {
      await backups.update(row.id, {
        status: "failed",
        error: "No se ha podido empezar la copia",
        finishedAt: new Date(),
      });
      throw new AppError(503, { detail: "No se ha podido empezar la copia. Reinténtalo." });
    }
    return c.json({ backup: backupDto(row) }, 202);
  })

  .put("/settings", async (c) => {
    const body = await readBody(c, backupSettingsSchema);
    const { db, ownerId } = deps(c);
    await updateBackupSettings(db, ownerId, body);
    return c.json({ settings: await getBackupSettings(db, ownerId) });
  })

  .get("/:id/download", async (c) => {
    const { backups } = deps(c);
    const row = await backups.get(idParam(c));
    if (row?.status !== "ready") throw new AppError(404);
    const object = await c.env.BACKUPS.get(row.r2Key);
    if (!object) throw new AppError(404);
    const date = row.createdAt.toISOString().slice(0, 10);
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(object.size),
        "Content-Disposition": `attachment; filename="delyra-copia-${date}.zip"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  })

  .delete("/:id", async (c) => {
    const { backups } = deps(c);
    const row = await backups.get(idParam(c));
    if (!row) throw new AppError(404);
    if (row.status === "running") throw new AppError(409, { detail: "Espera a que termine" });
    await c.env.BACKUPS.delete(row.r2Key);
    await backups.remove(row.id);
    return c.body(null, 204);
  });

// ── Restauraciones (F6-04) ───────────────────────────────────────────────────

async function assertRestoreQuota(c: Context<AppEnv>) {
  const { restores } = deps(c);
  const recent = (await restores.list(50)).filter(
    (r) => r.createdAt.getTime() > Date.now() - DAY_MS,
  );
  if (recent.length >= RESTORES_PER_DAY) {
    throw new AppError(429, { detail: "Has hecho muchas restauraciones hoy. Prueba mañana." });
  }
}

async function launchValidation(c: Context<AppEnv>, id: string, ownerId: string) {
  const { restores } = deps(c);
  const started = await launch(c, id, {
    id: `restore-${id}-validate`,
    params: { op: "validate", ownerId, restoreId: id },
  });
  if (!started) {
    await restores.update(id, {
      status: "failed",
      error: "No se ha podido empezar a leer la copia. Reinténtalo.",
      finishedAt: new Date(),
    });
  }
  return (await restores.get(id)) ?? null;
}

export const restoreRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  // Fichero subido (zip o json) en streaming, como los adjuntos y las importaciones.
  .post("/upload", async (c) => {
    await assertIdle(c);
    await assertRestoreQuota(c);
    const { length, rawName, body } = readUpload(
      c,
      BACKUP_LIMITS.uploadBytes,
      "La copia supera los 200 MB",
    );
    const { head, stream } = await peekStream(body);
    const isZip = isZipHead(head);
    const isJson =
      !isZip && new TextDecoder().decode(head.slice(0, 64)).trimStart().startsWith("{");
    if (!isZip && !isJson) {
      await stream.cancel();
      throw new AppError(415, { detail: "Sube una copia de Delyra (.zip o .json)" });
    }
    const { restores, ownerId } = deps(c);
    const row = await restores.create({
      filename: sanitizeFilename(rawName || "copia.zip"),
      backupId: null,
      undoOf: null,
    });
    const key = restoreSourceKey(ownerId, row.id);
    const fixed = new FixedLengthStream(length);
    const piping = stream.pipeTo(fixed.writable);
    try {
      await c.env.IMPORTS.put(key, fixed.readable);
      await piping;
    } catch {
      await c.env.IMPORTS.delete(key);
      await restores.remove(row.id);
      throw new AppError(400, { detail: "El fichero no coincide con su tamaño" });
    }
    const launched = await launchValidation(c, row.id, ownerId);
    return c.json({ restore: restoreDto(launched ?? row) }, 202);
  })

  // Restaurar una copia guardada.
  .post("/", async (c) => {
    const body = await readBody(c, restoreFromBackupRequestSchema);
    await assertIdle(c);
    await assertRestoreQuota(c);
    const { backups, restores, ownerId } = deps(c);
    const backup = await backups.get(body.backupId);
    // Una copia de otro usuario responde igual que una inexistente.
    if (backup?.status !== "ready") throw invalidField("backupId", "Copia no encontrada");
    const row = await restores.create({ filename: null, backupId: backup.id, undoOf: null });
    const launched = await launchValidation(c, row.id, ownerId);
    return c.json({ restore: restoreDto(launched ?? row) }, 202);
  })

  .get("/:id", async (c) => {
    const { restores } = deps(c);
    const row = await restores.get(idParam(c));
    if (!row) throw new AppError(404);
    return c.json({ restore: restoreDto(await refreshRestore(restores, row, Date.now())) });
  })

  .post("/:id/start", async (c) => {
    const body = await readBody(c, startRestoreRequestSchema);
    const { restores, ownerId } = deps(c);
    const row = await restores.get(idParam(c));
    if (!row) throw new AppError(404);
    const fresh = await refreshRestore(restores, row, Date.now());
    if (fresh.status !== "ready" || !readPlan(fresh)) {
      throw new AppError(409, {
        detail:
          fresh.status === "expired"
            ? "La vista previa ha caducado. Vuelve a empezar."
            : "Esta restauración ya no se puede empezar",
      });
    }
    const started = await restores.transition(fresh.id, "ready", {
      status: "restoring",
      mode: body.mode,
    });
    if (!started) throw new AppError(409, { detail: "Esta restauración ya se ha empezado" });
    await audit(createDb(c.env.DB), c.get("meta"), "backup.restore_started", {
      userId: ownerId,
      metadata: { mode: body.mode },
    });
    const ok = await launch(c, row.id, {
      id: `restore-${row.id}-run`,
      params: { op: "restore", ownerId, restoreId: row.id },
    });
    if (!ok) {
      await restores.update(row.id, { status: "ready", mode: null });
      throw new AppError(503, { detail: "No se ha podido empezar. Reinténtalo." });
    }
    return c.json({ restore: restoreDto(started) }, 202);
  })

  .post("/:id/undo", async (c) => {
    const { restores, backups, ownerId } = deps(c);
    const row = await restores.get(idParam(c));
    if (!row) throw new AppError(404);
    if ((row.status !== "succeeded" && row.status !== "failed") || !row.preBackupId) {
      throw new AppError(409, { detail: "Esta restauración no se puede deshacer" });
    }
    const backup = await backups.get(row.preBackupId);
    if (backup?.status !== "ready") {
      throw new AppError(409, { detail: "La copia previa ya no está disponible" });
    }
    await assertIdle(c);
    const undo = await restores.create({ filename: null, backupId: backup.id, undoOf: row.id });
    await audit(createDb(c.env.DB), c.get("meta"), "backup.restore_undone", { userId: ownerId });
    const launched = await launchValidation(c, undo.id, ownerId);
    return c.json({ restore: restoreDto(launched ?? undo) }, 202);
  })

  .delete("/:id", async (c) => {
    const { restores, ownerId } = deps(c);
    const row = await restores.get(idParam(c));
    if (!row) throw new AppError(404);
    if (row.status === "validating" || row.status === "restoring") {
      throw new AppError(409, { detail: "Espera a que termine" });
    }
    await deleteRestoreData(c.env.IMPORTS, ownerId, row.id);
    await restores.remove(row.id);
    return c.body(null, 204);
  });
