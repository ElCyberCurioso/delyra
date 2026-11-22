import { type CalendarInfo, calendarFeedResponseSchema } from "@delyra/shared";
import {
  apiFetch,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  errorMessage,
  FormError,
  Input,
  toast,
} from "@delyra/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

/** Feed ICS privado de un calendario (F7-02): dirección secreta para otras apps. */

const feedResponseSchema = calendarFeedResponseSchema;

export function FeedDialog({
  calendar,
  onClose,
}: {
  calendar: CalendarInfo | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const key = ["feed", calendar?.id ?? ""] as const;
  const feed = useQuery({
    queryKey: key,
    enabled: calendar !== null,
    queryFn: ({ signal }) =>
      apiFetch(`/api/calendars/${calendar?.id ?? ""}/feed`, { schema: feedResponseSchema, signal }),
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = feed.data?.feed?.url ?? null;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setPending(true);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }
  const rotate = () =>
    run(() =>
      apiFetch(`/api/calendars/${calendar?.id ?? ""}/feed`, {
        method: "POST",
        schema: feedResponseSchema,
      }),
    );

  return (
    <Dialog open={calendar !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ver «{calendar?.name}» en otras apps</DialogTitle>
          <DialogDescription>
            Una dirección privada en formato iCal para suscribirte desde Google Calendar, el iPhone
            u Outlook. Se actualiza sola; es de solo lectura.
          </DialogDescription>
        </DialogHeader>
        <FormError>{error}</FormError>
        {feed.isPending ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : url ? (
          <div className="grid gap-4 text-sm">
            <div className="flex gap-2">
              <Input
                readOnly
                value={url}
                aria-label="Dirección privada del calendario"
                onFocus={(e) => e.target.select()}
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Copiar la dirección"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(url)
                    .then(() => toast.success("Dirección copiada"))
                    .catch(() => toast.error("No se ha podido copiar"))
                }
              >
                <CopyIcon aria-hidden="true" />
              </Button>
            </div>
            <p className="rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Quien tenga esta dirección puede ver este calendario. Si la compartes por error,
              regénerala.
            </p>
            <details>
              <summary className="cursor-pointer font-medium">Cómo añadirla</summary>
              <ul className="mt-2 grid list-disc gap-1 pl-5 text-muted-foreground">
                <li>
                  <strong>Google Calendar</strong> (y Android): en calendar.google.com, «Otros
                  calendarios» → «+» → «Desde URL».
                </li>
                <li>
                  <strong>iPhone o iPad</strong>: Ajustes → Calendario → Cuentas → Añadir cuenta →
                  Otra → Añadir calendario suscrito.
                </li>
                <li>
                  <strong>Outlook</strong>: Añadir calendario → Suscribirse desde la web.
                </li>
              </ul>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={pending} onClick={() => void rotate()}>
                <RefreshCwIcon aria-hidden="true" />
                Regenerar
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  void run(() =>
                    apiFetch(`/api/calendars/${calendar?.id ?? ""}/feed`, { method: "DELETE" }),
                  )
                }
              >
                Desactivar
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button disabled={pending} onClick={() => void rotate()}>
              Crear dirección privada
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
