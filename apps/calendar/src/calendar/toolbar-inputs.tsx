import { type CalendarInfo, dateOnlyToUtc, instantToWall, type Occurrence } from "@delyra/shared";
import { Button, errorMessage, Input, toast } from "@delyra/ui";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon, SparklesIcon } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { createEvent, searchEvents, useInvalidateEvents } from "./api";
import type { EditorTarget } from "./event-editor";
import { parseQuickAdd, type QuickDraft } from "./quick-add";
import { describeWhen, joinInstant } from "./time";

const DAY_MS = 86_400_000;

/** «Ahora» en la zona del usuario, como fecha local (lo que espera chrono-node). */
function reference(timeZone: string): Date {
  const w = instantToWall(Date.now(), timeZone);
  return new Date(w.year, w.month - 1, w.day, w.hour, w.minute);
}

function draftTimes(draft: QuickDraft, timeZone: string) {
  if (draft.allDay) {
    const end = new Date(dateOnlyToUtc(draft.date) + DAY_MS).toISOString().slice(0, 10);
    return { allDay: true, start: draft.date, end };
  }
  return {
    allDay: false,
    start: joinInstant(draft.date, draft.startTime ?? "09:00", timeZone),
    end: joinInstant(draft.date, draft.endTime ?? "10:00", timeZone),
  };
}

/** Alta rápida en lenguaje natural con vista previa antes de guardar (F2-12). */
export function QuickAdd({
  calendars,
  timeZone,
  onMoreOptions,
}: {
  calendars: readonly CalendarInfo[];
  timeZone: string;
  onMoreOptions: (target: EditorTarget) => void;
}) {
  const invalidate = useInvalidateEvents();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const calendar = calendars.find((c) => c.kind === "personal") ?? calendars[0];
  const draft = useMemo(() => parseQuickAdd(text, reference(timeZone)), [text, timeZone]);
  const times = draft ? draftTimes(draft, timeZone) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || !times || !calendar) return;
    setPending(true);
    try {
      await createEvent({ calendarId: calendar.id, title: draft.title, tz: timeZone, ...times });
      toast.success(`«${draft.title}» añadido`);
      setText("");
      await invalidate();
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="relative w-full">
      <SparklesIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
      />
      <Input
        aria-label="Alta rápida"
        placeholder="Alta rápida: «Dentista mañana 17:30»"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="pl-8"
        maxLength={200}
        aria-describedby="alta-rapida-vista-previa"
      />
      <div
        id="alta-rapida-vista-previa"
        aria-live="polite"
        className="absolute top-full right-0 left-0 z-30 mt-1"
      >
        {text.trim() && draft && times && calendar ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-popover p-2 text-sm text-popover-foreground shadow-md">
            <span className="min-w-0 flex-1 truncate">
              <strong>{draft.title}</strong> · {describeWhen(times, timeZone)} · {calendar.name}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onMoreOptions({
                  kind: "create",
                  ...times,
                  title: draft.title,
                  calendarId: calendar.id,
                });
                setText("");
              }}
            >
              Más opciones
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              Añadir
            </Button>
          </div>
        ) : text.trim().length > 3 ? (
          <p className="rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
            Añade cuándo: «mañana 17:30», «el viernes de 10 a 11», «3 de diciembre»…
          </p>
        ) : null}
      </div>
    </form>
  );
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** Búsqueda por título, notas y ubicación (F2-13). */
export function SearchBox({
  calendars,
  timeZone,
  onOpen,
}: {
  calendars: readonly CalendarInfo[];
  timeZone: string;
  onOpen: (occurrence: Occurrence) => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const query = useDebounced(text.trim(), 300);
  const results = useQuery({
    queryKey: ["search", query],
    enabled: query.length >= 2,
    queryFn: ({ signal }) => searchEvents(query, signal),
  });
  const colors = new Map(calendars.map((c) => [c.id, c.color]));

  return (
    <div className="relative w-full" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label="Buscar eventos"
        placeholder="Buscar"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="pl-8"
        maxLength={100}
      />
      {open && query.length >= 2 ? (
        <div
          role="region"
          aria-label="Resultados de la búsqueda"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-80 overflow-y-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md sm:w-96"
        >
          {results.isPending ? <p className="p-2 text-muted-foreground">Buscando…</p> : null}
          {results.isError ? <p className="p-2">{errorMessage(results.error)}</p> : null}
          {results.data?.length === 0 ? (
            <p className="p-2 text-muted-foreground">Sin resultados.</p>
          ) : null}
          <ul>
            {results.data?.map((occurrence) => (
              <li key={occurrence.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                  onClick={() => {
                    setOpen(false);
                    onOpen(occurrence);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: colors.get(occurrence.calendarId) }}
                  />
                  <span className="min-w-0 flex-1 truncate">{occurrence.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {describeWhen(occurrence, timeZone)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
