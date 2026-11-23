import {
  type HealthComponentName,
  type HealthResponse,
  healthResponseSchema,
} from "@delyra/shared";
import { useQuery } from "@tanstack/react-query";
import { ui } from "../i18n";
import { cn } from "../lib/utils";

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(new URL("/api/health", window.location.origin), {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    signal,
  });
  // 503 también trae el cuerpo con el detalle de cada componente.
  if (!response.ok && response.status !== 503) {
    throw new Error(ui().errors.apiStatus(response.status));
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

const COMPONENTS: readonly HealthComponentName[] = ["d1", "r2", "queues"];

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
  const t = ui().health;

  let summary: string;
  if (isPending) summary = t.checking;
  else if (isError) summary = t.noApi;
  else summary = data.status === "ok" ? t.ok : t.degraded;

  return (
    <section
      aria-labelledby="estado-plataforma"
      className={cn("tile animate-rise p-5 sm:p-6", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="estado-plataforma" className="text-sm font-semibold">
          {t.title}
        </h2>
        {data ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {t[data.environment]}
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
          {COMPONENTS.map((name) => {
            const check = data.checks[name];
            return (
              <li key={name} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <Dot ok={check.status === "ok"} />
                  {t[name]}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {check.status === "ok" ? `${String(check.latencyMs)} ms` : t.error}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {data?.version ? (
        <p className="mt-4 truncate text-xs text-muted-foreground">
          {t.version} <code>{data.version.slice(0, 8)}</code>
        </p>
      ) : null}
    </section>
  );
}
