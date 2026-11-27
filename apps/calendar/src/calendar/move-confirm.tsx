import { dateOnlyToUtc } from "@delyra/shared";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  intlLocale,
} from "@delyra/ui";
import { ArrowDownIcon } from "lucide-react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { calendarMessages } from "./messages";

/**
 * Confirmación al arrastrar o redimensionar un evento con el ratón (o con el dedo): un despiste
 * no cambia nada sin que se vea antes el «antes» y el «después».
 */

const DAY_MS = 86_400_000;

export interface Slot {
  /** Instante ISO o, si es de día completo, fecha `AAAA-MM-DD`. */
  start: string;
  /** Fin exclusivo, con el mismo formato que `start`. */
  end: string;
  allDay: boolean;
}

export interface MoveChange {
  title: string;
  kind: "move" | "resize";
  before: Slot;
  after: Slot;
}

/** «lun 24 nov · 10:00–11:00», «lun 24 nov 22:00 – mar 25 nov 01:00» o «lun 24 nov (todo el día)». */
export function describeSlot(slot: Slot, timeZone: string, locale = intlLocale()): string {
  const t = calendarMessages().move;
  const day = (ms: number, zone: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: zone,
    })
      .format(ms)
      .replaceAll(".", "");
  if (slot.allDay) {
    const first = dateOnlyToUtc(slot.start);
    const last = Math.max(first, dateOnlyToUtc(slot.end) - DAY_MS);
    const range = first === last ? day(first, "UTC") : `${day(first, "UTC")} – ${day(last, "UTC")}`;
    return `${range} (${t.allDay})`;
  }
  const start = Date.parse(slot.start);
  const end = Date.parse(slot.end);
  const time = (ms: number) =>
    new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    }).format(ms);
  const sameDay = day(start, timeZone) === day(end - 1, timeZone);
  return sameDay
    ? `${day(start, timeZone)} · ${time(start)}–${time(end)}`
    : `${day(start, timeZone)} ${time(start)} – ${day(end, timeZone)} ${time(end)}`;
}

/** El «antes» y el «después» de un cambio, para los diálogos de confirmación. */
export function MoveSummary({ change, timeZone }: { change: MoveChange; timeZone: string }) {
  const t = calendarMessages().move;
  return (
    <div className="grid gap-1.5 rounded-2xl border bg-muted/40 p-3 text-sm">
      <p className="font-semibold break-words">{change.title}</p>
      <p className="text-muted-foreground">
        <span className="font-medium">{t.before}:</span>{" "}
        <span className="tabular-nums">{describeSlot(change.before, timeZone)}</span>
      </p>
      <ArrowDownIcon aria-hidden="true" className="size-4 text-muted-foreground" />
      <p>
        <span className="font-medium">{t.after}:</span>{" "}
        <span className="font-semibold tabular-nums">{describeSlot(change.after, timeZone)}</span>
      </p>
    </div>
  );
}

/** `confirm` resuelve `true` si se acepta el cambio y `false` si se cancela. */
export function useMoveConfirm(timeZone: string) {
  const [change, setChange] = useState<MoveChange | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((next: MoveChange) => {
    setChange(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const answer = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setChange(null);
  };

  const t = calendarMessages().move;
  const dialog: ReactNode = (
    <Dialog open={change !== null} onOpenChange={(open) => !open && answer(false)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{change?.kind === "resize" ? t.resizeTitle : t.moveTitle}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        {change ? <MoveSummary change={change} timeZone={timeZone} /> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => answer(false)}>
            {t.cancel}
          </Button>
          <Button autoFocus onClick={() => answer(true)}>
            {change?.kind === "resize" ? t.confirmResize : t.confirmMove}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { confirm, dialog };
}
