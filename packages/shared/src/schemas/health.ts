import { z } from "zod";
import { appEnvironmentSchema } from "../environments";

const healthComponentSchema = z.object({
  status: z.enum(["ok", "error"]),
  latencyMs: z.number().nonnegative(),
});

export type HealthComponent = z.infer<typeof healthComponentSchema>;

export const HEALTH_COMPONENTS = ["d1", "r2", "queues"] as const;
export type HealthComponentName = (typeof HEALTH_COMPONENTS)[number];

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  environment: appEnvironmentSchema,
  version: z.string().nullable(),
  time: z.iso.datetime(),
  checks: z.object({
    d1: healthComponentSchema,
    r2: healthComponentSchema,
    queues: healthComponentSchema,
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
