import { healthResponseSchema } from "@delyra/shared";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createLogger, type LogEntry } from "../src/lib/logger";
import { runHealthChecks } from "../src/services/health";

const request = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://delyra.app${path}`, init));

describe("GET /api/health", () => {
  it("responde 200 con D1, R2 y Queues en verde", async () => {
    const response = await request("/api/health");
    expect(response.status).toBe(200);
    const body = healthResponseSchema.parse(await response.json());
    expect(body.status).toBe("ok");
    expect(body.environment).toBe("development");
    expect(body.checks.d1.status).toBe("ok");
    expect(body.checks.r2.status).toBe("ok");
    expect(body.checks.queues.status).toBe("ok");
  });

  it("incluye las cabeceras de seguridad, no-store y un request id", async () => {
    const response = await request("/api/health");
    expect(response.headers.get("Strict-Transport-Security")).toContain("includeSubDomains");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("ignora el X-Request-Id que envía el cliente", async () => {
    const response = await request("/api/health", { headers: { "X-Request-Id": "inyectado" } });
    expect(response.headers.get("X-Request-Id")).not.toBe("inyectado");
  });
});

describe("runHealthChecks", () => {
  it("marca degradado y registra el componente que falla, sin el error en bruto", async () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({}, (entry) => entries.push(entry));
    const failingDb = {
      prepare: () => ({ first: () => Promise.reject(new Error("token=secreto")) }),
    } as unknown as D1Database;

    const result = await runHealthChecks({ ...env, DB: failingDb }, logger);

    expect(result.status).toBe("degraded");
    expect(result.checks.d1.status).toBe("error");
    expect(result.checks.r2.status).toBe("ok");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ event: "health_check_failed", component: "d1" });
    expect(JSON.stringify(entries)).not.toContain("secreto");
  });

  it("agota el tiempo de espera de una comprobación colgada", async () => {
    vi.useFakeTimers();
    try {
      const hangingQueue = { metrics: () => new Promise(() => undefined) } as unknown as Queue;
      const pending = runHealthChecks(
        { ...env, NOTIFICATIONS: hangingQueue },
        createLogger({}, () => undefined),
      );
      await vi.advanceTimersByTimeAsync(3500);
      const result = await pending;
      expect(result.checks.queues.status).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });
});
