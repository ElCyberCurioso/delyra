import { dateOnlyToUtc, utcToDateOnly } from "@delyra/shared";
import { Button, cn, intlLocale } from "@delyra/ui";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { calendarMessages } from "./messages";

const DAY_MS = 86_400_000;

/** Minicalendario de la barra lateral (F2-11): navega la vista principal a un día. */
export function MiniMonth({
  today,
  selected,
  weekStart,
  onSelect,
}: {
  /** `AAAA-MM-DD` en la zona del usuario. */
  today: string;
  selected: string;
  weekStart: number;
  onSelect: (date: string) => void;
}) {
  const [month, setMonth] = useState(() => selected.slice(0, 7));
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const first = Date.UTC(year, monthNumber - 1, 1);
  const offset = (new Date(first).getUTCDay() - weekStart + 7) % 7;
  const gridStart = first - offset * DAY_MS;
  const days = Array.from({ length: 42 }, (_, i) => utcToDateOnly(gridStart + i * DAY_MS));

  const shiftMonth = (delta: number) => {
    const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
    setMonth(utcToDateOnly(date.getTime()).slice(0, 7));
  };
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(intlLocale(), { weekday: "narrow", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, 7 + ((weekStart + i) % 7))),
    ),
  );
  const t = calendarMessages().miniMonth;
  const label = new Intl.DateTimeFormat(intlLocale(), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(first));

  return (
    <div className="select-none">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium first-letter:uppercase">{label}</span>
        <div className="flex">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t.previous}
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t.next}
            onClick={() => shiftMonth(1)}
          >
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div role="group" aria-label={label} className="grid grid-cols-7 text-center text-xs">
        {weekdays.map((day, i) => (
          <span key={i} aria-hidden="true" className="py-1 text-muted-foreground uppercase">
            {day}
          </span>
        ))}
        {days.map((day) => {
          const inMonth = day.startsWith(month);
          return (
            <button
              key={day}
              type="button"
              aria-label={new Intl.DateTimeFormat(intlLocale(), {
                dateStyle: "full",
                timeZone: "UTC",
              }).format(new Date(dateOnlyToUtc(day)))}
              aria-current={day === today ? "date" : undefined}
              onClick={() => onSelect(day)}
              className={cn(
                "mx-auto flex size-7 items-center justify-center rounded-full hover:bg-accent",
                !inMonth && "text-muted-foreground",
                day === selected && "bg-primary/15 font-semibold text-primary",
                day === today &&
                  "bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
              )}
            >
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
