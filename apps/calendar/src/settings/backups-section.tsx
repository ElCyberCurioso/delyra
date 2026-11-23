import {
  BACKUP_FREQUENCIES,
  BACKUP_LIMITS,
  type BackupCounts,
  backupResponseSchema,
  backupSettingsSchema,
  backupsResponseSchema,
  problemDetailsSchema,
  type RestoreInfo,
  type RestoreMode,
  restoreResponseSchema,
} from "@delyra/shared";
import {
  type ActiveSession,
  ApiError,
  apiFetch,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  errorMessage,
  FormError,
  SelectField,
  toast,
  translateServer,
} from "@delyra/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  DownloadIcon,
  Loader2Icon,
  RotateCcwIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react";
import { useState } from "react";
import { formatDateTime } from "./format";
import { settingsMessages } from "./messages";
import { Section } from "./section";

/** Copias de seguridad en Ajustes (F6-05): crear, descargar, restaurar y deshacer. */

const BACKUPS_KEY = ["account", "backups"] as const;

function formatSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function describeCounts(counts: BackupCounts | null): string {
  if (!counts) return "";
  const t = settingsMessages().backups.counts;
  return [
    t.calendars(counts.calendars),
    t.events(counts.events),
    t.boards(counts.boards),
    t.cards(counts.cards),
    counts.attachments > 0 ? t.attachments(counts.attachments) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function useBackups() {
  return useQuery({
    queryKey: BACKUPS_KEY,
    queryFn: ({ signal }) => apiFetch("/api/backups", { schema: backupsResponseSchema, signal }),
    // Mientras se hace una copia o una restauración, se sigue el progreso.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const busy =
        data.backups.some((b) => b.status === "running") ||
        data.restores.some((r) => r.status === "validating" || r.status === "restoring");
      return busy ? 1500 : false;
    },
  });
}

/** Sube la copia como cuerpo binario (zip o json), igual que los adjuntos. */
async function uploadBackup(file: File): Promise<RestoreInfo> {
  const response = await fetch(new URL("/api/restores/upload", window.location.origin), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": file.type || "application/octet-stream",
      "X-Filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!response.ok) {
    let problem = null;
    try {
      problem = problemDetailsSchema.parse(await response.json());
    } catch {
      // Sin problem+json: basta con el código.
    }
    throw new ApiError(response.status, problem);
  }
  return restoreResponseSchema.parse(await response.json()).restore;
}

function RestorePanel({
  restore,
  timeZone,
  onChange,
}: {
  restore: RestoreInfo;
  timeZone: string;
  onChange: () => Promise<void>;
}) {
  const [mode, setMode] = useState<RestoreMode>("merge");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = settingsMessages().backups;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setPending(true);
    try {
      await action();
      await onChange();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }
  const start = () =>
    run(() =>
      apiFetch(`/api/restores/${restore.id}/start`, {
        method: "POST",
        body: { mode },
        schema: restoreResponseSchema,
      }),
    );
  const undo = () =>
    run(() =>
      apiFetch(`/api/restores/${restore.id}/undo`, {
        method: "POST",
        schema: restoreResponseSchema,
      }),
    );
  const discard = () => run(() => apiFetch(`/api/restores/${restore.id}`, { method: "DELETE" }));
  const canUndo =
    restore.preBackupId !== null &&
    restore.undoOf === null &&
    (restore.status === "succeeded" || restore.status === "failed");
  const percent =
    restore.progress.total > 0
      ? Math.round((restore.progress.done / restore.progress.total) * 100)
      : 0;
  const title = restore.undoOf ? t.undoing : t.restoreNamed(restore.filename ?? t.savedCopy);

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 text-sm" aria-live="polite">
      <p className="font-medium">{title}</p>
      <FormError>{error}</FormError>
      {restore.status === "validating" ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
          {t.validating}
        </p>
      ) : null}
      {restore.status === "ready" ? (
        <>
          <p className="text-muted-foreground">
            {t.copyOf(restore.exportedAt ? formatDateTime(restore.exportedAt, timeZone) : t.noDate)}
            : {describeCounts(restore.counts)}.
          </p>
          {restore.warnings.map((w) => (
            <p key={w} className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
              <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {translateServer(w)}
            </p>
          ))}
          <fieldset className="grid gap-2">
            <legend className="mb-1 font-medium">{t.how}</legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name={`modo-${restore.id}`}
                className="mt-1 pointer-coarse:size-5"
                checked={mode === "merge"}
                onChange={() => setMode("merge")}
              />
              <span>
                <strong>{t.merge}</strong> {t.mergeDetail}
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name={`modo-${restore.id}`}
                className="mt-1 pointer-coarse:size-5"
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
              />
              <span>
                <strong>{t.replace}</strong> {t.replaceDetail}
              </span>
            </label>
          </fieldset>
          <p className="text-muted-foreground">{t.safety}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending}
              onClick={() => (mode === "replace" ? setConfirming(true) : void start())}
            >
              {settingsMessages().common.restore}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => void discard()}>
              {t.discard}
            </Button>
          </div>
        </>
      ) : null}
      {restore.status === "restoring" ? (
        <div className="grid gap-2">
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
            {t.restoring}
          </p>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={t.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${String(percent)}%` }}
            />
          </div>
        </div>
      ) : null}
      {restore.status === "succeeded" ? (
        <p className="flex items-center gap-2">
          <CheckCircle2Icon aria-hidden="true" className="size-4 text-green-600" />
          {restore.undoOf ? t.undone : t.restored}
        </p>
      ) : null}
      {restore.status === "undone" ? <p className="text-muted-foreground">{t.wasUndone}</p> : null}
      {restore.status === "failed" || restore.status === "expired" ? (
        <p role="alert" className="flex items-start gap-2 text-destructive">
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {restore.status === "expired"
            ? t.expired
            : restore.error
              ? translateServer(restore.error)
              : t.failed}
        </p>
      ) : null}
      {canUndo ? (
        <div>
          <Button variant="outline" disabled={pending} onClick={() => void undo()}>
            <RotateCcwIcon aria-hidden="true" />
            {t.undo}
          </Button>
        </div>
      ) : null}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.confirmTitle}</DialogTitle>
            <DialogDescription>{t.confirmBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{settingsMessages().common.cancel}</Button>
            </DialogClose>
            <Button variant="destructive" disabled={pending} onClick={() => void start()}>
              {t.replace}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function BackupsSection({ session }: { session: ActiveSession }) {
  const queryClient = useQueryClient();
  const timeZone = session.settings.timeZone;
  const backups = useBackups();
  const [pending, setPending] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: BACKUPS_KEY });
  const t = settingsMessages().backups;

  async function act(action: () => Promise<unknown>, success?: string) {
    setPending(true);
    try {
      await action();
      if (success) toast.success(success);
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  const data = backups.data;
  const list = data?.backups ?? [];
  const busy = list.some((b) => b.status === "running");
  // La restauración que se muestra: la última, si no se ha cerrado.
  const restore = data?.restores.find((r) => r.status !== "undone") ?? null;

  return (
    <Section
      id="copias"
      title={t.title}
      description={t.description}
      actions={
        <Button
          size="sm"
          disabled={pending || busy}
          onClick={() =>
            void act(
              () => apiFetch("/api/backups", { method: "POST", schema: backupResponseSchema }),
              t.creating,
            )
          }
        >
          {busy ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
          {t.create}
        </Button>
      }
    >
      <div className="grid gap-5">
        {data ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label={t.auto}
              value={data.settings.frequency}
              options={BACKUP_FREQUENCIES.map((f) => ({ value: f, label: t.frequencies[f] }))}
              onChange={(e) => {
                const settings = backupSettingsSchema.parse({
                  ...data.settings,
                  frequency: e.target.value,
                });
                void act(() =>
                  apiFetch("/api/backups/settings", { method: "PUT", body: settings }),
                );
              }}
            />
            <SelectField
              label={t.keep}
              value={String(data.settings.keep)}
              disabled={data.settings.frequency === "off"}
              options={Array.from({ length: BACKUP_LIMITS.keepAutoMax }, (_, i) => ({
                value: String(i + 1),
                label: String(i + 1),
              }))}
              onChange={(e) =>
                void act(() =>
                  apiFetch("/api/backups/settings", {
                    method: "PUT",
                    body: { ...data.settings, keep: Number(e.target.value) },
                  }),
                )
              }
            />
          </div>
        ) : null}

        {restore ? <RestorePanel restore={restore} timeZone={timeZone} onChange={refresh} /> : null}

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">{t.fromFile}</span>
          <span className="flex items-center gap-2">
            <UploadIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <input
              type="file"
              accept=".zip,.json,application/zip,application/json"
              disabled={pending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void act(() => uploadBackup(file));
              }}
              className="block w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground"
            />
          </span>
        </label>

        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.none}</p>
        ) : (
          <ul className="grid gap-2">
            {list.map((backup) => (
              <li
                key={backup.id}
                className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {t.kinds[backup.kind]} · {formatDateTime(backup.createdAt, timeZone)}
                  </p>
                  <p
                    className={
                      backup.status === "failed"
                        ? "text-destructive"
                        : "truncate text-muted-foreground"
                    }
                  >
                    {backup.status === "running"
                      ? t.creating
                      : backup.status === "failed"
                        ? backup.error
                          ? translateServer(backup.error)
                          : t.backupFailed
                        : `${formatSize(backup.sizeBytes)} · ${describeCounts(backup.counts)}`}
                  </p>
                </div>
                {backup.status === "ready" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <a href={`/api/backups/${backup.id}/download`} download>
                        <DownloadIcon aria-hidden="true" />
                        {settingsMessages().common.download}
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        void act(() =>
                          apiFetch("/api/restores", {
                            method: "POST",
                            body: { backupId: backup.id },
                            schema: restoreResponseSchema,
                          }),
                        )
                      }
                    >
                      <RotateCcwIcon aria-hidden="true" />
                      {settingsMessages().common.restore}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t.delete}
                      disabled={pending}
                      onClick={() =>
                        void act(
                          () => apiFetch(`/api/backups/${backup.id}`, { method: "DELETE" }),
                          t.deleted,
                        )
                      }
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
