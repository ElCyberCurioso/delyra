import {
  type TelegramStatus,
  telegramLinkResponseSchema,
  telegramStatusSchema,
} from "@delyra/shared";
import {
  type ActiveSession,
  apiFetch,
  Button,
  errorMessage,
  Field,
  FormError,
  toast,
} from "@delyra/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOffIcon, ExternalLinkIcon, SendIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { formatDateTime } from "./format";
import { Section } from "./section";
import { settingsMessages } from "./messages";

const TELEGRAM_KEY = ["account", "telegram"] as const;

function useTelegramStatus(polling: boolean) {
  return useQuery({
    queryKey: TELEGRAM_KEY,
    queryFn: ({ signal }) => apiFetch("/api/me/telegram", { schema: telegramStatusSchema, signal }),
    // Mientras se espera a que el usuario pulse «Iniciar» en Telegram.
    refetchInterval: (query) => (polling && !query.state.data?.linked ? 3000 : false),
  });
}

function LinkPanel({ onLinking }: { onLinking: (url: string | null) => void }) {
  const [pending, setPending] = useState(false);
  const t = settingsMessages().telegram;
  return (
    <div className="grid gap-3 text-sm">
      <p className="text-muted-foreground">{t.intro}</p>
      <div>
        <Button
          disabled={pending}
          onClick={() => {
            setPending(true);
            apiFetch("/api/me/telegram/link", {
              method: "POST",
              schema: telegramLinkResponseSchema,
            })
              .then((link) => {
                onLinking(link.url);
                window.open(link.url, "_blank", "noopener,noreferrer");
              })
              .catch((error: unknown) => toast.error(errorMessage(error)))
              .finally(() => setPending(false));
          }}
        >
          <SendIcon aria-hidden="true" />
          {t.link}
        </Button>
      </div>
    </div>
  );
}

function PreferencesForm({ status }: { status: TelegramStatus }) {
  const queryClient = useQueryClient();
  const [digest, setDigest] = useState(status.digestTime !== null);
  const [digestTime, setDigestTime] = useState(status.digestTime ?? "08:00");
  const [quiet, setQuiet] = useState(status.quietStart !== null);
  const [quietStart, setQuietStart] = useState(status.quietStart ?? "22:00");
  const [quietEnd, setQuietEnd] = useState(status.quietEnd ?? "08:00");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const t = settingsMessages().telegram;

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const updated = await apiFetch("/api/me/telegram", {
        method: "PATCH",
        body: {
          digestTime: digest ? digestTime : null,
          quietStart: quiet ? quietStart : null,
          quietEnd: quiet ? quietEnd : null,
        },
        schema: telegramStatusSchema,
      });
      queryClient.setQueryData(TELEGRAM_KEY, updated);
      toast.success(t.prefsSaved);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(event) => void save(event)} className="grid max-w-md gap-4">
      <FormError>{error}</FormError>
      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4"
            checked={digest}
            onChange={(e) => setDigest(e.target.checked)}
          />
          {t.digest}
        </label>
        {digest ? (
          <Field
            label={t.digestTime}
            type="time"
            value={digestTime}
            onChange={(e) => setDigestTime(e.target.value)}
            className="max-w-40"
          />
        ) : null}
      </div>
      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4"
            checked={quiet}
            onChange={(e) => setQuiet(e.target.checked)}
          />
          {t.quiet}
        </label>
        {quiet ? (
          <div className="grid grid-cols-2 gap-3 sm:max-w-80">
            <Field
              label={t.from}
              type="time"
              value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
            />
            <Field
              label={t.to}
              type="time"
              value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
            />
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">{t.quietHint}</p>
      </div>
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {t.savePrefs}
        </Button>
      </div>
    </form>
  );
}

/** Telegram (F3-04, F3-09): vinculación, mensaje de prueba, resumen y horas de silencio. */
export function TelegramSection({ session }: { session: ActiveSession }) {
  const queryClient = useQueryClient();
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [polling, setPolling] = useState(false);
  const status = useTelegramStatus(polling);
  const timeZone = session.settings.timeZone;
  const data = status.data;
  const t = settingsMessages().telegram;

  const linkedNow = linkUrl !== null && data?.linked === true;
  useEffect(() => {
    if (linkedNow) toast.success(settingsMessages().telegram.linked);
  }, [linkedNow]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: TELEGRAM_KEY });
  const run = (action: () => Promise<unknown>, success: string) => {
    action()
      .then(() => {
        toast.success(success);
        return refresh();
      })
      .catch((error: unknown) => toast.error(errorMessage(error)));
  };

  return (
    <Section id="telegram" title={t.title} description={t.description}>
      {status.isPending ? (
        <p className="text-sm text-muted-foreground">{settingsMessages().common.loading}</p>
      ) : null}
      {status.isError ? <p role="alert">{errorMessage(status.error)}</p> : null}
      {data && !data.available ? (
        <p className="text-sm text-muted-foreground">{t.unavailable}</p>
      ) : null}
      {data?.available && !data.linked ? (
        linkUrl ? (
          <div className="grid gap-2 text-sm">
            <p>
              {t.openAndStart} <strong>{t.start}</strong>. {t.pageUpdates}
            </p>
            <p>
              <a
                href={linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
              >
                {t.open(data.botUsername ?? "")}
                <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
              </a>
              <span className="text-muted-foreground">{t.linkExpires}</span>
            </p>
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setLinkUrl(null);
                  setPolling(false);
                }}
              >
                {settingsMessages().common.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <LinkPanel
            onLinking={(url) => {
              setLinkUrl(url);
              setPolling(url !== null);
            }}
          />
        )
      ) : null}
      {data?.linked ? (
        <div className="grid gap-5">
          <div className="grid gap-2 text-sm">
            <p>
              {t.linkedWith} <strong>@{data.botUsername}</strong>
              {data.linkedAt ? t.since(formatDateTime(data.linkedAt, timeZone)) : ""}.
            </p>
            {data.mutedUntil ? (
              <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
                <BellOffIcon aria-hidden="true" className="size-4" />
                {t.mutedUntil(formatDateTime(data.mutedUntil, timeZone))}
                <Button
                  variant="link"
                  size="sm"
                  className="min-h-0 p-0"
                  onClick={() =>
                    run(
                      () =>
                        apiFetch("/api/me/telegram", { method: "PATCH", body: { muted: false } }),
                      t.unmuted,
                    )
                  }
                >
                  {t.unmute}
                </Button>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  run(() => apiFetch("/api/me/telegram/test", { method: "POST" }), t.testSent)
                }
              >
                {t.sendTest}
              </Button>
              {confirmUnlink ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setConfirmUnlink(false);
                    run(() => apiFetch("/api/me/telegram", { method: "DELETE" }), t.unlinked);
                  }}
                >
                  {t.confirmUnlink}
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmUnlink(true)}>
                  {t.unlink}
                </Button>
              )}
            </div>
          </div>
          <PreferencesForm
            key={`${data.digestTime ?? ""}-${data.quietStart ?? ""}`}
            status={data}
          />
        </div>
      ) : null}
    </Section>
  );
}
