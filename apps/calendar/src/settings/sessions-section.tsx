import { auditResponseSchema, sessionsResponseSchema } from "@delyra/shared";
import { type ActiveSession, apiFetch, Button, cn, errorMessage, toast } from "@delyra/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorSmartphoneIcon, TriangleAlertIcon } from "lucide-react";
import {
  auditLabel,
  countryName,
  describeUserAgent,
  formatDateTime,
  SUSPICIOUS_EVENTS,
} from "./format";
import { settingsMessages } from "./messages";
import { Section } from "./section";

const SESSIONS_QUERY_KEY = ["account", "sessions"] as const;

/** Sesiones activas en otros dispositivos, con la opción de cerrarlas. */
export function SessionsSection({ session }: { session: ActiveSession }) {
  const queryClient = useQueryClient();
  const timeZone = session.settings.timeZone;
  const t = settingsMessages().sessions;
  const sessions = useQuery({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: ({ signal }) =>
      apiFetch("/api/me/sessions", { schema: sessionsResponseSchema, signal }),
  });

  const onDone = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      void queryClient.invalidateQueries({ queryKey: ["account"] });
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/me/sessions/${id}`, { method: "DELETE" }),
    ...onDone(t.closed),
  });
  const revokeOthers = useMutation({
    mutationFn: () => apiFetch("/api/me/sessions/revoke-others", { method: "POST" }),
    ...onDone(t.othersClosed),
  });

  const list = sessions.data?.sessions ?? [];
  const others = list.filter((item) => !item.current).length;

  return (
    <Section
      id="sesiones"
      title={t.title}
      description={t.description}
      actions={
        others > 0 ? (
          <Button
            variant="outline"
            size="sm"
            disabled={revokeOthers.isPending}
            onClick={() => revokeOthers.mutate()}
          >
            {t.closeOthers}
          </Button>
        ) : null
      }
    >
      {sessions.isError ? <p role="alert">{errorMessage(sessions.error)}</p> : null}
      <ul className="divide-y rounded-md border">
        {list.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-3 p-3">
            <MonitorSmartphoneIcon aria-hidden="true" className="size-5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {describeUserAgent(item.userAgent)}
                {item.current ? (
                  <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {t.thisOne}
                  </span>
                ) : null}
              </p>
              <p className="text-sm text-muted-foreground">
                {[countryName(item.country), t.lastSeen(formatDateTime(item.lastSeenAt, timeZone))]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {item.current ? null : (
              <Button
                variant="ghost"
                size="sm"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(item.id)}
                aria-label={t.closeLabel(describeUserAgent(item.userAgent))}
              >
                {t.close}
              </Button>
            )}
          </li>
        ))}
        {sessions.isPending ? (
          <li className="p-3 text-sm text-muted-foreground">{settingsMessages().common.loading}</li>
        ) : null}
      </ul>
    </Section>
  );
}

/** Historial de seguridad propio (F1-16): los últimos 50 eventos. */
export function ActivitySection({ session }: { session: ActiveSession }) {
  const timeZone = session.settings.timeZone;
  const audit = useQuery({
    queryKey: ["account", "audit"],
    queryFn: ({ signal }) => apiFetch("/api/me/audit", { schema: auditResponseSchema, signal }),
  });

  return (
    <Section
      id="actividad"
      title={settingsMessages().activity.title}
      description={settingsMessages().activity.description}
    >
      {audit.isError ? <p role="alert">{errorMessage(audit.error)}</p> : null}
      <ol className="divide-y rounded-md border text-sm">
        {(audit.data?.events ?? []).map((entry) => {
          const suspicious = SUSPICIOUS_EVENTS.has(entry.event);
          return (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3">
              <span
                className={cn(
                  "flex items-center gap-1.5 font-medium",
                  suspicious && "text-destructive",
                )}
              >
                {suspicious ? <TriangleAlertIcon aria-hidden="true" className="size-4" /> : null}
                {auditLabel(entry.event)}
              </span>
              <span className="text-muted-foreground">
                {[
                  formatDateTime(entry.createdAt, timeZone),
                  countryName(entry.country),
                  entry.userAgent ? describeUserAgent(entry.userAgent) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          );
        })}
        {audit.isPending ? (
          <li className="p-3 text-muted-foreground">{settingsMessages().common.loading}</li>
        ) : null}
      </ol>
    </Section>
  );
}
