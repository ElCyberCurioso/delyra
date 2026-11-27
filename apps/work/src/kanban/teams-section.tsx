import {
  type BoardDetail,
  googleAuthorizeResponseSchema,
  MICROSOFT_DAYS_AHEAD,
  type MicrosoftBoardInfo,
  microsoftBoardInfoSchema,
} from "@delyra/shared";
import {
  apiFetch,
  Button,
  errorMessage,
  formatShortDateTime,
  FormError,
  SelectField,
  toast,
  translateServer,
} from "@delyra/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClockIcon,
  Loader2Icon,
  LogInIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  UnplugIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { boardKey } from "./api";
import { workMessages } from "./messages";

/**
 * Reuniones de Teams en el tablero (docs/plan-teams.md): conectar Microsoft 365, elegir columna y
 * opciones, y ver el estado del volcado. Las reuniones llegan como tarjetas cada 15 minutos.
 */

const teamsKey = (boardId: string) => ["board", boardId, "microsoft"] as const;

function useTeamsInfo(boardId: string) {
  return useQuery({
    queryKey: teamsKey(boardId),
    queryFn: ({ signal }) =>
      apiFetch(`/api/microsoft/boards/${boardId}`, { schema: microsoftBoardInfoSchema, signal }),
    refetchInterval: (query) => (query.state.data?.sync?.status === "pending" ? 2000 : false),
  });
}

function ConnectButton({ boardId, label }: { boardId: string; label: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() => {
        setPending(true);
        apiFetch("/api/microsoft/authorize", {
          method: "POST",
          body: { boardId },
          schema: googleAuthorizeResponseSchema,
        })
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

function SyncForm({
  board,
  current,
  onSaved,
}: {
  board: BoardDetail;
  current: NonNullable<MicrosoftBoardInfo["sync"]> | null;
  onSaved: (info: MicrosoftBoardInfo) => void;
}) {
  const t = workMessages().teams;
  const [columnId, setColumnId] = useState(current?.columnId ?? board.columns[0]?.id ?? "");
  const [onlyTeams, setOnlyTeams] = useState(current?.onlyTeams ?? true);
  const [days, setDays] = useState(String(current?.daysAhead ?? 14));
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/api/microsoft/boards/${board.board.id}`, {
        method: "PUT",
        body: { columnId, onlyTeams, daysAhead: Number(days) },
        schema: microsoftBoardInfoSchema,
      }),
    onSuccess: (info) => {
      toast.success(current ? t.updated : t.started);
      onSaved(info);
    },
  });
  if (board.columns.length === 0)
    return <p className="text-sm text-muted-foreground">{t.noColumns}</p>;
  return (
    <form
      className="grid gap-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <FormError>{save.isError ? errorMessage(save.error) : null}</FormError>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label={t.column}
          value={columnId}
          onChange={(e) => setColumnId(e.target.value)}
          options={board.columns.map((c) => ({ value: c.id, label: c.name }))}
        />
        <SelectField
          label={t.daysAhead}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          options={MICROSOFT_DAYS_AHEAD.map((n) => ({ value: String(n), label: t.days(n) }))}
        />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 pointer-coarse:size-5"
          checked={onlyTeams}
          onChange={(e) => setOnlyTeams(e.target.checked)}
        />
        <span>{t.onlyTeams}</span>
      </label>
      <div>
        <Button type="submit" variant={current ? "outline" : "default"} disabled={save.isPending}>
          {save.isPending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
          {current ? t.saveChanges : t.start}
        </Button>
      </div>
    </form>
  );
}

export function TeamsSection({ board }: { board: BoardDetail }) {
  const boardId = board.board.id;
  const queryClient = useQueryClient();
  const info = useTeamsInfo(boardId);
  const t = workMessages().teams;
  const refresh = (next?: MicrosoftBoardInfo) => {
    if (next) queryClient.setQueryData(teamsKey(boardId), next);
    else void queryClient.invalidateQueries({ queryKey: teamsKey(boardId) });
    void queryClient.invalidateQueries({ queryKey: boardKey(boardId) });
  };
  const syncNow = useMutation({
    mutationFn: () =>
      apiFetch(`/api/microsoft/boards/${boardId}/sync`, {
        method: "POST",
        schema: microsoftBoardInfoSchema,
      }),
    onSuccess: (next) => refresh(next),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const stop = useMutation({
    mutationFn: () => apiFetch(`/api/microsoft/boards/${boardId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t.stopped);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const disconnect = useMutation({
    mutationFn: () => apiFetch("/api/microsoft/connection", { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t.disconnected);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (info.isPending || info.isError || !info.data.enabled) return null;
  const { connection, sync } = info.data;
  const canStop = sync && (sync.mine || board.board.role === "owner");

  return (
    <section className="grid gap-3 border-t pt-4" aria-labelledby="teams-titulo">
      <div>
        <h3 id="teams-titulo" className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClockIcon aria-hidden="true" className="size-4" />
          {t.title}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{t.intro}</p>
      </div>

      {sync && !sync.mine ? <p className="text-sm text-muted-foreground">{t.someoneElse}</p> : null}

      {sync?.mine ? (
        <p
          className={
            sync.status === "error"
              ? "flex items-start gap-1.5 text-sm text-destructive"
              : "flex items-center gap-1.5 text-sm text-muted-foreground"
          }
        >
          {sync.status === "pending" ? (
            <Loader2Icon aria-hidden="true" className="size-3.5 animate-spin" />
          ) : sync.status === "error" ? (
            <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          ) : null}
          {sync.status === "pending"
            ? t.syncing
            : sync.status === "error"
              ? translateServer(sync.error ?? "")
              : t.status(
                  sync.cards,
                  sync.lastSyncedAt ? formatShortDateTime(sync.lastSyncedAt) : null,
                )}
        </p>
      ) : null}

      {!connection ? (
        !sync || sync.mine ? (
          <div className="grid gap-2">
            <div>
              <ConnectButton boardId={boardId} label={t.connect} />
            </div>
            <p className="text-xs text-muted-foreground">{t.permission}</p>
          </div>
        ) : null
      ) : connection.status === "revoked" ? (
        <div
          role="alert"
          className="grid gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <p>{t.revoked}</p>
          <div>
            <ConnectButton boardId={boardId} label={t.reconnect} />
          </div>
        </div>
      ) : !sync || sync.mine ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t.connectedAs(connection.email ?? t.yourAccount)}
          </p>
          <SyncForm board={board} current={sync} onSaved={refresh} />
        </>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {sync?.mine && connection?.status === "ok" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={syncNow.isPending || sync.status === "pending"}
            onClick={() => syncNow.mutate()}
          >
            <RefreshCwIcon
              aria-hidden="true"
              className={syncNow.isPending ? "animate-spin" : undefined}
            />
            {t.syncNow}
          </Button>
        ) : null}
        {canStop ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={stop.isPending}
            onClick={() => {
              if (window.confirm(t.confirmStop)) stop.mutate();
            }}
          >
            {t.stop}
          </Button>
        ) : null}
        {connection ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disconnect.isPending}
            onClick={() => {
              if (window.confirm(t.confirmDisconnect)) disconnect.mutate();
            }}
          >
            <UnplugIcon aria-hidden="true" />
            {t.disconnect}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
