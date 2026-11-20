import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db/client";
import { D1ExportClient, D1ExportFailedError, D1ExportPendingError } from "../src/jobs/d1-export";
import {
  listBackupRuns,
  recordBackupFailure,
  recordBackupStart,
  recordBackupSuccess,
  storeDump,
  systemBackupKey,
} from "../src/services/system-backups";

const config = { accountId: "acc", databaseId: "db-1", apiToken: "tok-secreto" };

function apiResponse(result: unknown, init: ResponseInit = {}) {
  return Response.json({ success: true, errors: [], messages: [], result }, init);
}

describe("D1ExportClient", () => {
  it("inicia la exportación con el token y devuelve el bookmark", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(apiResponse({ at_bookmark: "bm-1", status: "active" })),
    );
    const client = new D1ExportClient({ ...config, fetch: fetchMock });

    await expect(client.start()).resolves.toBe("bm-1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc/d1/database/db-1/export");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok-secreto");
    expect(JSON.parse(init?.body as string)).toEqual({ output_format: "polling" });
  });

  it("indica que hay que esperar mientras la exportación sigue activa", async () => {
    const client = new D1ExportClient({
      ...config,
      fetch: () => Promise.resolve(apiResponse({ at_bookmark: "bm-1", status: "active" })),
    });
    await expect(client.poll("bm-1")).rejects.toBeInstanceOf(D1ExportPendingError);
  });

  it("devuelve la URL firmada cuando está lista (formato anidado y plano)", async () => {
    const nested = new D1ExportClient({
      ...config,
      fetch: () =>
        Promise.resolve(
          apiResponse({
            status: "complete",
            result: { signed_url: "https://s/1", filename: "a.sql" },
          }),
        ),
    });
    await expect(nested.poll("bm")).resolves.toEqual({
      signedUrl: "https://s/1",
      filename: "a.sql",
    });

    const flat = new D1ExportClient({
      ...config,
      fetch: () => Promise.resolve(apiResponse({ signed_url: "https://s/2" })),
    });
    await expect(flat.poll("bm")).resolves.toEqual({ signedUrl: "https://s/2", filename: null });
  });

  it("trata credenciales o permisos inválidos como error definitivo, sin filtrar el token", async () => {
    const client = new D1ExportClient({
      ...config,
      fetch: () => Promise.resolve(new Response("forbidden", { status: 403 })),
    });
    const error = await client.start().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(D1ExportFailedError);
    expect(String(error)).not.toContain("tok-secreto");
  });

  it("trata 429 y 5xx como transitorios", async () => {
    const client = new D1ExportClient({
      ...config,
      fetch: () => Promise.resolve(new Response("busy", { status: 503 })),
    });
    const error = await client.start().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(D1ExportFailedError);
  });

  it("falla de forma definitiva si la exportación termina en error", async () => {
    const client = new D1ExportClient({
      ...config,
      fetch: () => Promise.resolve(apiResponse({ status: "error", error: "boom" })),
    });
    await expect(client.poll("bm")).rejects.toBeInstanceOf(D1ExportFailedError);
  });

  it("exige configuración completa", () => {
    expect(() => new D1ExportClient({ ...config, apiToken: "" })).toThrow(D1ExportFailedError);
  });
});

describe("storeDump", () => {
  it("guarda el volcado en R2 con tipo y metadatos", async () => {
    const key = systemBackupKey("2026-11-20");
    const stored = await storeDump(env.BACKUPS, key, new Response("CREATE TABLE x (id);"), {
      trigger: "manual",
    });

    expect(key).toBe("system/daily/2026-11-20.sql");
    expect(stored.sizeBytes).toBe(20);
    const object = await env.BACKUPS.get(key);
    expect(await object?.text()).toBe("CREATE TABLE x (id);");
    expect(object?.httpMetadata?.contentType).toContain("application/sql");
    expect(object?.customMetadata).toEqual({ trigger: "manual" });
  });

  it("no guarda nada si la descarga falla", async () => {
    await expect(
      storeDump(env.BACKUPS, "system/daily/2026-01-01.sql", new Response("x", { status: 403 }), {}),
    ).rejects.toThrow();
    expect(await env.BACKUPS.head("system/daily/2026-01-01.sql")).toBeNull();
  });

  it("rechaza fechas que no son AAAA-MM-DD", () => {
    expect(() => systemBackupKey("../../etc")).toThrow(RangeError);
  });
});

describe("registro de ejecuciones", () => {
  it("guarda inicio, éxito y fallo en system_backup_runs", async () => {
    const db = createDb(env.DB);
    await recordBackupStart(db, { id: "run-1", trigger: "schedule", startedAt: new Date(1000) });
    await recordBackupSuccess(db, "run-1", {
      r2Key: "system/daily/2026-11-20.sql",
      sizeBytes: 42,
      finishedAt: new Date(2000),
    });
    await recordBackupStart(db, { id: "run-2", trigger: "manual", startedAt: new Date(3000) });
    await recordBackupFailure(db, "run-2", { error: "Error: x", finishedAt: new Date(4000) });

    const runs = await listBackupRuns(db);
    expect(runs.map((r) => [r.id, r.status])).toEqual([
      ["run-2", "failed"],
      ["run-1", "succeeded"],
    ]);
    expect(runs[1]).toMatchObject({ sizeBytes: 42, r2Key: "system/daily/2026-11-20.sql" });
  });

  it("es idempotente si el paso de inicio se reintenta", async () => {
    const db = createDb(env.DB);
    const startedAt = new Date(Date.UTC(2030, 0, 1));
    await recordBackupStart(db, { id: "run-3", trigger: "schedule", startedAt });
    await recordBackupFailure(db, "run-3", { error: "x", finishedAt: new Date() });
    await recordBackupStart(db, { id: "run-3", trigger: "schedule", startedAt });
    const runs = await listBackupRuns(db);
    expect(runs.filter((r) => r.id === "run-3")).toEqual([
      expect.objectContaining({ status: "running", error: null, finishedAt: null }),
    ]);
  });
});
