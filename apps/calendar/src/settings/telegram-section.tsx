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
  return (
    <div className="grid gap-3 text-sm">
      <p className="text-muted-foreground">
        Recibe las alertas de tus eventos en Telegram, pospónlas desde el propio mensaje y consulta
        tu agenda con /hoy o /semana.
      </p>
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
          Vincular con Telegram
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
      toast.success("Preferencias de Telegram guardadas");
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
          Resumen diario con la agenda del día
        </label>
        {digest ? (
          <Field
            label="Hora del resumen"
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
          Horas de silencio para el resumen
        </label>
        {quiet ? (
          <div className="grid grid-cols-2 gap-3 sm:max-w-80">
            <Field
              label="Desde"
              type="time"
              value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
            />
            <Field
              label="Hasta"
              type="time"
              value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
            />
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Si el resumen cae en esas horas, llega cuando terminan. Las alertas de tus eventos llegan
          siempre a su hora.
        </p>
      </div>
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          Guardar preferencias
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

  const linkedNow = linkUrl !== null && data?.linked === true;
  useEffect(() => {
    if (linkedNow) toast.success("Telegram vinculado");
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
    <Section id="telegram" title="Telegram" description="Alertas y agenda en tu móvil.">
      {status.isPending ? <p className="text-sm text-muted-foreground">Cargando…</p> : null}
      {status.isError ? <p role="alert">{errorMessage(status.error)}</p> : null}
      {data && !data.available ? (
        <p className="text-sm text-muted-foreground">
          Las alertas por Telegram aún no están disponibles: falta configurar el bot en el servidor.
        </p>
      ) : null}
      {data?.available && !data.linked ? (
        linkUrl ? (
          <div className="grid gap-2 text-sm">
            <p>
              Abre Telegram y pulsa <strong>Iniciar</strong>. Esta página se actualizará sola.
            </p>
            <p>
              <a
                href={linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
              >
                Abrir @{data.botUsername}
                <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
              </a>
              <span className="text-muted-foreground"> · el enlace caduca en 10 minutos.</span>
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
                Cancelar
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
              Vinculado con <strong>@{data.botUsername}</strong>
              {data.linkedAt ? ` desde el ${formatDateTime(data.linkedAt, timeZone)}` : ""}.
            </p>
            {data.mutedUntil ? (
              <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
                <BellOffIcon aria-hidden="true" className="size-4" />
                Alertas silenciadas hasta el {formatDateTime(data.mutedUntil, timeZone)}.
                <Button
                  variant="link"
                  size="sm"
                  className="min-h-0 p-0"
                  onClick={() =>
                    run(
                      () =>
                        apiFetch("/api/me/telegram", { method: "PATCH", body: { muted: false } }),
                      "Alertas reactivadas",
                    )
                  }
                >
                  Reactivar
                </Button>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  run(
                    () => apiFetch("/api/me/telegram/test", { method: "POST" }),
                    "Mensaje de prueba enviado: mira Telegram",
                  )
                }
              >
                Enviar mensaje de prueba
              </Button>
              {confirmUnlink ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setConfirmUnlink(false);
                    run(
                      () => apiFetch("/api/me/telegram", { method: "DELETE" }),
                      "Telegram desvinculado",
                    );
                  }}
                >
                  Sí, desvincular
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmUnlink(true)}>
                  Desvincular
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
