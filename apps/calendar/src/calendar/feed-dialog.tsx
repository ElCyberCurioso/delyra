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
import { calendarMessages } from "./messages";

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
  const t = calendarMessages().feed;

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
          <DialogTitle>{t.title(calendar?.name ?? "")}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <FormError>{error}</FormError>
        {feed.isPending ? (
          <p className="text-sm text-muted-foreground">{t.loading}</p>
        ) : url ? (
          <div className="grid gap-4 text-sm">
            <div className="flex gap-2">
              <Input
                readOnly
                value={url}
                aria-label={t.address}
                onFocus={(e) => e.target.select()}
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                aria-label={t.copy}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(url)
                    .then(() => toast.success(t.copied))
                    .catch(() => toast.error(t.copyFailed))
                }
              >
                <CopyIcon aria-hidden="true" />
              </Button>
            </div>
            <p className="rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {t.warning}
            </p>
            <details>
              <summary className="cursor-pointer font-medium">{t.how}</summary>
              <ul className="mt-2 grid list-disc gap-1 pl-5 text-muted-foreground">
                <li>
                  <strong>Google Calendar</strong> {t.google}
                </li>
                <li>
                  <strong>{t.iphone}</strong>
                  {t.iphoneSteps}
                </li>
                <li>
                  <strong>Outlook</strong>
                  {t.outlookSteps}
                </li>
              </ul>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={pending} onClick={() => void rotate()}>
                <RefreshCwIcon aria-hidden="true" />
                {t.regenerate}
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
                {t.disable}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button disabled={pending} onClick={() => void rotate()}>
              {t.create}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
