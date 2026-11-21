import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors";
import { rateLimit } from "../src/middleware/rate-limit";
import type { AppEnv } from "../src/types";

function appWith(limit: RateLimit["limit"]) {
  const warn = vi.fn();
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    c.set("logger", { warn } as unknown as AppEnv["Variables"]["logger"]);
    c.set("meta", { ip: "203.0.113.7", country: null, userAgent: null });
    c.set("auth", null);
    await next();
  });
  app.use(rateLimit("API_RATE_LIMITER"));
  app.get("/", (c) => c.text("ok"));
  app.onError((error, c) => c.text("error", error instanceof AppError ? error.status : 500));
  const env = { API_RATE_LIMITER: { limit } } as unknown as Env;
  return { request: () => app.request("/", {}, env), warn };
}

describe("límite de peticiones", () => {
  it("responde 429 con Retry-After al superar el límite, con la IP como clave", async () => {
    const limit = vi.fn<RateLimit["limit"]>(() => Promise.resolve({ success: false }));
    const response = await appWith(limit).request();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(limit).toHaveBeenCalledWith({ key: "API_RATE_LIMITER:ip:203.0.113.7" });
  });

  it("si el binding falla, deja pasar la petición y lo registra", async () => {
    const { request, warn } = appWith(() => Promise.reject(new Error("database is locked")));
    const response = await request();
    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalledWith("rate_limiter_unavailable", expect.anything());
  });
});
