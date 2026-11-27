import {
  type CalendarInfo,
  draftTimes,
  type Occurrence,
  parseQuickAdd,
  type QuickAddParser,
  quickAddReference,
} from "@delyra/shared";
import { Button, errorMessage, getLocale, Input, toast } from "@delyra/ui";
import { useQuery } from "@tanstack/react-query";
import { MicIcon, SearchIcon, SparklesIcon, SquareIcon } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { createEvent, searchEvents, useInvalidateEvents } from "./api";
import type { EditorTarget } from "./event-editor";
import { calendarMessages } from "./messages";
import { describeWhen } from "./time";
import { useDictation } from "./use-dictation";

let englishParser: QuickAddParser | null = null;

/** En inglés, el analizador de chrono-node/en se descarga la primera vez (F7-06). */
function useQuickAddParser(): QuickAddParser | undefined {
  const english = getLocale() === "en";
  const [parser, setParser] = useState(() => (english ? englishParser : null));
  useEffect(() => {
    if (!english || englishParser) return;
    void import("@delyra/shared/quick-add-en").then(({ parseEnglish }) => {
      englishParser = parseEnglish;
      setParser(() => parseEnglish);
    });
  }, [english]);
  return english ? (parser ?? undefined) : undefined;
}

/** «Ahora» en la zona del usuario, como fecha local (lo que espera chrono-node). */
const reference = (timeZone: string) => quickAddReference(Date.now(), timeZone);

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
  const parser = useQuickAddParser();
  const draft = useMemo(
    () =>
      parseQuickAdd(text, reference(timeZone), {
        locale: getLocale(),
        parse: parser,
      }),
    [text, timeZone, parser],
  );
  const t = calendarMessages().quickAdd;
  const times = draft ? draftTimes(draft, timeZone) : null;
  const dictation = useDictation({
    onText: (spoken) => setText(spoken.slice(0, 200)),
    onError: (error) =>
      toast.error(
        error === "denied" ? t.micDenied : error === "no-speech" ? t.noSpeech : t.dictationFailed,
      ),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || !times || !calendar) return;
    setPending(true);
    try {
      await createEvent({ calendarId: calendar.id, title: draft.title, tz: timeZone, ...times });
      toast.success(t.added(draft.title));
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
        aria-label={t.label}
        placeholder={t.placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className={dictation.supported ? "pr-11 pl-8" : "pl-8"}
        maxLength={200}
        aria-describedby="alta-rapida-vista-previa"
      />
      {dictation.supported ? (
        <Button
          type="button"
          variant={dictation.listening ? "destructive" : "ghost"}
          size="icon"
          className="absolute top-1/2 right-1 size-8 -translate-y-1/2 rounded-full"
          aria-label={dictation.listening ? t.stopDictation : t.dictate}
          aria-pressed={dictation.listening}
          onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
        >
          {dictation.listening ? (
            <>
              <span
                aria-hidden="true"
                className="absolute inset-0 animate-ping rounded-full bg-destructive/40 motion-reduce:hidden"
              />
              <SquareIcon aria-hidden="true" className="relative size-3.5 fill-current" />
            </>
          ) : (
            <MicIcon aria-hidden="true" />
          )}
        </Button>
      ) : null}
      <div
        id="alta-rapida-vista-previa"
        aria-live="polite"
        className="absolute top-full right-0 left-0 z-30 mt-1"
      >
        {dictation.listening ? (
          <p
            role="status"
            className="rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md"
          >
            {t.listening}
          </p>
        ) : text.trim() && draft && times && calendar ? (
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
              {t.moreOptions}
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {t.add}
            </Button>
          </div>
        ) : text.trim().length > 3 ? (
          <p className="rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
            {t.hint}
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
  const t = calendarMessages().search;

  return (
    <div className="relative w-full" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
      />
      <Input
        type="search"
        data-search="events"
        aria-label={t.label}
        placeholder={t.placeholder}
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
          aria-label={t.results}
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-80 overflow-y-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md sm:w-96"
        >
          {results.isPending ? <p className="p-2 text-muted-foreground">{t.searching}</p> : null}
          {results.isError ? <p className="p-2">{errorMessage(results.error)}</p> : null}
          {results.data?.length === 0 ? (
            <p className="p-2 text-muted-foreground">{t.none}</p>
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
