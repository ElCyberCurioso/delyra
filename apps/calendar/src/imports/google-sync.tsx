import type { GoogleSyncedCalendar } from "@delyra/shared";
import {
  Button,
  errorMessage,
  formatShortDateTime,
  FormError,
  SelectField,
  toast,
  translateServer,
} from "@delyra/ui";
import { useQueryClient } from "@tanstack/react-query";
import {
  CloudIcon,
  Loader2Icon,
  LogInIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UnplugIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { CALENDARS_KEY, useInvalidateEvents } from "../calendar/api";
import { Section } from "../settings/section";
import {
  addGoogleSync,
  authorizeGoogleSync,
  disconnectGoogleSync,
  GOOGLE_SYNC_KEY,
  removeGoogleSync,
  syncGoogleNow,
  useGoogleAccountCalendars,
  useGoogleSync,
} from "./api";
import { importMessages } from "./messages";

/**
 * Sincronización continua de Google a Delyra (F7-09): conectar la cuenta (permiso permanente
 * de solo lectura), elegir calendarios y ver su estado. Cada calendario se refleja en uno de solo
 * lectura que se pone al día cada 15 minutos.
 */

function useRefreshAll() {
  const queryClient = useQueryClient();
  const invalidateEvents = useInvalidateEvents();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: GOOGLE_SYNC_KEY });
    await queryClient.invalidateQueries({ queryKey: CALENDARS_KEY });
    await invalidateEvents();
  };
}

function ConnectButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      disabled={pending}
      onClick={() => {
        setPending(true);
        authorizeGoogleSync()
          .then(({ url }) => window.location.assign(url))
          .catch((error: unknown) => {
            toast.error(errorMessage(error));
            setPending(false);
          });
      }}
    >
      <LogInIcon aria-hidden="true" />
      {label}
    </Button>
  );
}

function SyncedRow({ calendar }: { calendar: GoogleSyncedCalendar }) {
  const refresh = useRefreshAll();
  const [pending, setPending] = useState(false);
  const t = importMessages();
  const status =
    calendar.status === "pending"
      ? t.sync.syncing
      : calendar.status === "error"
        ? translateServer(calendar.error ?? "")
        : `${t.counts.events(calendar.events)}${
            calendar.lastSyncedAt
              ? t.subscriptions.updated(formatShortDateTime(calendar.lastSyncedAt))
              : ""
          }`;
  return (
    <li className="grid gap-2 rounded-2xl border bg-card p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium">
          <span
            aria-hidden="true"
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: calendar.color }}
          />
          <span className="truncate">{calendar.name}</span>
        </p>
        <p
          className={
            calendar.status === "error"
              ? "flex items-center gap-1 text-xs text-destructive"
              : "flex items-center gap-1 text-xs text-muted-foreground"
          }
        >
          {calendar.status === "pending" ? (
            <Loader2Icon aria-hidden="true" className="size-3 animate-spin" />
          ) : null}
          {status}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pending || calendar.status === "pending"}
          onClick={() => {
            setPending(true);
            syncGoogleNow(calendar.id)
              .then(refresh)
              .catch((error: unknown) => toast.error(errorMessage(error)))
              .finally(() => setPending(false));
          }}
        >
          <RefreshCwIcon aria-hidden="true" className={pending ? "animate-spin" : undefined} />
          {t.subscriptions.sync}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t.sync.remove(calendar.name)}
          disabled={pending}
          onClick={() => {
            if (!window.confirm(t.sync.confirmRemove(calendar.name))) return;
            setPending(true);
            removeGoogleSync(calendar.id)
              .then(refresh)
              .catch((error: unknown) => toast.error(errorMessage(error)))
              .finally(() => setPending(false));
          }}
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

function AddCalendar() {
  const available = useGoogleAccountCalendars(true);
  const refresh = useRefreshAll();
  const [choice, setChoice] = useState("");
  const [reminders, setReminders] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const t = importMessages().sync;

  if (available.isPending) {
    return <p className="text-sm text-muted-foreground">{t.loadingCalendars}</p>;
  }
  if (available.isError) return <FormError>{errorMessage(available.error)}</FormError>;
  const options = available.data.filter((c) => !c.synced);
  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.allSynced}</p>;
  }
  const selected = options.some((c) => c.googleCalendarId === choice)
    ? choice
    : ((options.find((c) => !c.suggestSkip) ?? options[0])?.googleCalendarId ?? "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await addGoogleSync(selected, reminders);
      toast.success(t.added);
      await refresh();
      await available.refetch();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-3">
      <FormError>{error}</FormError>
      <SelectField
        label={t.calendar}
        value={selected}
        onChange={(e) => setChoice(e.target.value)}
        options={options.map((c) => ({
          value: c.googleCalendarId,
          label: c.suggestSkip ? t.notRecommended(c.name) : c.name,
        }))}
      />
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 pointer-coarse:size-5"
          checked={reminders}
          onChange={(e) => setReminders(e.target.checked)}
        />
        <span>{t.reminders}</span>
      </label>
      <div>
        <Button type="submit" disabled={pending || selected === ""}>
          {pending ? (
            <Loader2Icon aria-hidden="true" className="animate-spin" />
          ) : (
            <CloudIcon aria-hidden="true" />
          )}
          {t.add}
        </Button>
      </div>
    </form>
  );
}

export function GoogleSync() {
  const sync = useGoogleSync();
  const refresh = useRefreshAll();
  const invalidateEvents = useInvalidateEvents();
  const queryClient = useQueryClient();
  const [disconnecting, setDisconnecting] = useState(false);
  const t = importMessages().sync;

  // Cuando termina una sincronización en segundo plano, se ven sus eventos en el calendario.
  const progress = sync.data?.calendars.map((c) => `${c.status}:${c.lastSyncedAt ?? ""}`).join();
  useEffect(() => {
    if (progress === undefined) return;
    void queryClient.invalidateQueries({ queryKey: CALENDARS_KEY });
    void invalidateEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar el estado
  }, [progress]);

  if (sync.isPending || !sync.data?.enabled) return null;
  const { connection, calendars } = sync.data;

  return (
    <Section id="sincronizar" title={t.title} description={t.description}>
      <div className="grid gap-4">
        {!connection ? (
          <div>
            <ConnectButton label={t.connect} />
            <p className="mt-3 text-xs text-muted-foreground">{t.permanentNote}</p>
          </div>
        ) : (
          <>
            {connection.status === "revoked" ? (
              <div
                role="alert"
                className="grid gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-sm"
              >
                <p className="flex items-start gap-2">
                  <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {t.revoked}
                </p>
                <div>
                  <ConnectButton label={t.reconnect} />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t.connectedAs(connection.email ?? t.yourAccount)}
              </p>
            )}
            {calendars.length > 0 ? (
              <ul className="grid gap-2" aria-label={t.listLabel}>
                {calendars.map((calendar) => (
                  <SyncedRow key={calendar.id} calendar={calendar} />
                ))}
              </ul>
            ) : null}
            {connection.status === "ok" ? <AddCalendar /> : null}
            <div className="border-t pt-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={disconnecting}
                onClick={() => {
                  if (!window.confirm(t.confirmDisconnect(calendars.length))) return;
                  setDisconnecting(true);
                  disconnectGoogleSync()
                    .then(async () => {
                      toast.success(t.disconnected);
                      await refresh();
                    })
                    .catch((error: unknown) => toast.error(errorMessage(error)))
                    .finally(() => setDisconnecting(false));
                }}
              >
                <UnplugIcon aria-hidden="true" />
                {t.disconnect}
              </Button>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
