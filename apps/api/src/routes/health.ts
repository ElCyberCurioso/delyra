import { Hono } from "hono";
import { runHealthChecks } from "../services/health";
import type { AppEnv } from "../types";

export const healthRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const result = await runHealthChecks(c.env, c.get("logger"));
  return c.json(result, result.status === "ok" ? 200 : 503);
});
