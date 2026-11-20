import {
  type HealthComponentName,
  type HealthResponse,
  healthResponseSchema,
} from "@delyra/shared";
import { useQuery } from "@tanstack/react-query";
import { cn } from "../lib/utils";

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(new URL("/api/health", window.location.origin), {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    signal,
  });
  // 503 también trae el cuerpo con el detalle de cada componente.
  if (!response.ok && response.status !== 503) {
    throw new Error(`La API respondió HTTP ${String(response.status)}`);
  }
  return healthResponseSchema.parse(await response.json());
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 30_000,
    retry: 1,
  });
}

const COMPONENT_LABELS: Record<HealthComponentName, string> = {
  d1: "Base de datos (D1)",
  r2: "Almacenamiento (R2)",
  queues: "Colas (Queues)",
};

const ENVIRONMENT_LABELS: Record<HealthResponse["environment"], string> = {
  development: "Local",
  staging: "Staging",
  production: "Producción",
};

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2.5 rounded-full", ok ? "bg-success" : "bg-destructive")}
    />
  );
}

/** Tarjeta de estado de la plataforma (página provisional de F0-04). */
export function HealthStatus({ className }: { className?: string }) {
  const { data, isPending, isError } = useHealth();

  let summary: string;
  if (isPending) summary = "Comprobando…";
  else if (isError) summary = "Sin conexión con la API";
  else summary = data.status === "ok" ? "Operativo" : "Degradado";

  return (
    <section
      aria-labelledby="estado-plataforma"
      className={cn("rounded-xl border bg-card p-5 text-card-foreground shadow-xs", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="estado-plataforma" className="text-sm font-semibold">
          Estado de la plataforma
        </h2>
        {data ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {ENVIRONMENT_LABELS[data.environment]}
          </span>
        ) : null}
      </div>
      <p
        role="status"
        aria-live="polite"
        className="mt-3 flex items-center gap-2 text-lg font-medium"
      >
        {isPending ? null : <Dot ok={!isError && data.status === "ok"} />}
        {summary}
      </p>
      {data ? (
        <ul className="mt-4 space-y-2 text-sm">
          {(Object.keys(COMPONENT_LABELS) as HealthComponentName[]).map((name) => {
            const check = data.checks[name];
            return (
              <li key={name} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <Dot ok={check.status === "ok"} />
                  {COMPONENT_LABELS[name]}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {check.status === "ok" ? `${String(check.latencyMs)} ms` : "Error"}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {data?.version ? (
        <p className="mt-4 truncate text-xs text-muted-foreground">
          Versión <code>{data.version.slice(0, 8)}</code>
        </p>
      ) : null}
    </section>
  );
}
