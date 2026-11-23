import { systemBackupsResponseSchema } from "@delyra/shared";
import { apiFetch, Button, errorMessage, toast, translateServer } from "@delyra/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { formatDateTime } from "../settings/format";
import { settingsMessages } from "../settings/messages";
import { Section } from "../settings/section";

/** Backups del sistema (F6-06): estado del último, copias en R2 por nivel y copia manual. */

const KEY = ["admin", "backups"] as const;

function formatSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function SystemBackupsSection({ timeZone }: { timeZone: string }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const query = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      apiFetch("/api/admin/backups", { schema: systemBackupsResponseSchema, signal }),
    refetchInterval: (q) => (q.state.data?.runs[0]?.status === "running" ? 5000 : false),
  });
  const last = query.data?.runs[0];
  const objects = query.data?.objects ?? [];
  const t = settingsMessages().system;

  return (
    <Section
      id="backups"
      title={t.title}
      description={t.description}
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={pending || last?.status === "running"}
          onClick={() => {
            setPending(true);
            apiFetch("/api/admin/backups", { method: "POST" })
              .then(async () => {
                toast.success(t.launched);
                await queryClient.invalidateQueries({ queryKey: KEY });
              })
              .catch((error: unknown) => toast.error(errorMessage(error)))
              .finally(() => setPending(false));
          }}
        >
          {t.runNow}
        </Button>
      }
    >
      {query.isError ? (
        <p className="text-sm text-destructive">{errorMessage(query.error)}</p>
      ) : null}
      {last ? (
        <p className="mb-4 flex items-start gap-2 text-sm">
          {last.status === "succeeded" ? (
            <CheckCircle2Icon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-green-600"
            />
          ) : last.status === "running" ? (
            <Loader2Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin" />
          ) : (
            <TriangleAlertIcon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-destructive"
            />
          )}
          <span>
            {t.last(formatDateTime(last.startedAt, timeZone))} ·{" "}
            {last.status === "succeeded"
              ? t.ok(formatSize(last.sizeBytes))
              : last.status === "running"
                ? t.running
                : t.failed(last.error ? translateServer(last.error) : t.noDetail)}
            {last.trigger === "manual" ? t.manual : ""}
          </span>
        </p>
      ) : query.data ? (
        <p className="mb-4 text-sm text-muted-foreground">{t.none}</p>
      ) : null}
      {(["daily", "weekly", "monthly"] as const).map((tier) => {
        const list = objects.filter((o) => o.tier === tier);
        return (
          <details key={tier} className="border-t py-2 text-sm" open={tier === "daily"}>
            <summary className="cursor-pointer font-medium">
              {t.tiers[tier]} · {list.length}
            </summary>
            {list.length === 0 ? (
              <p className="mt-2 text-muted-foreground">{t.noneYet}</p>
            ) : (
              <ul className="mt-2 grid gap-1">
                {list.slice(0, 40).map((object) => (
                  <li key={object.key} className="flex flex-wrap justify-between gap-x-4">
                    <code className="text-xs break-all">{object.key}</code>
                    <span className="text-muted-foreground">{formatSize(object.sizeBytes)}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        );
      })}
    </Section>
  );
}
