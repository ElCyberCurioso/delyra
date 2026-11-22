import {
  dateOnlyToUtc,
  type DueCard,
  type EditScope,
  type EventType,
  instantToWall,
  type Occurrence,
  utcToDateOnly,
} from "@delyra/shared";
import {
  type ActiveSession,
  AppShell,
  Button,
  cn,
  currentAppOrigins,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  errorMessage,
  RequireSession,
  toast,
  useLogout,
  useMediaQuery,
} from "@delyra/ui";
import type {
  DateSelectArg,
  DatesSetArg,
  EventClickArg,
  EventDropArg,
  EventInput,
} from "@fullcalendar/core";
import esLocale from "@fullcalendar/core/locales/es";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { type EventResizeDoneArg } from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import multiMonthPlugin from "@fullcalendar/multimonth";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useRouter } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon, PanelLeftIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchEvent,
  occurrencesKey,
  type Range,
  updateEvent,
  useCalendars,
  useInvalidateEvents,
  useDueCards,
  useOccurrences,
} from "./api";
import { CalendarList } from "./calendar-list";
import { type EditorTarget, EventEditor } from "./event-editor";
import { MiniMonth } from "./mini-month";
import { useScopeDialog } from "./scope-dialog";
import {
  floatingNow,
  fromCalendarDate,
  joinInstant,
  rangeEdge,
  shiftSeries,
  toCalendarTime,
  wallDelta,
} from "./time";
import { QuickAdd, SearchBox } from "./toolbar-inputs";

/** `narrow`: solo en pantallas estrechas; `wide`: solo en anchas. La semana no cabe en un móvil. */
const VIEWS = [
  { id: "dayGridMonth", label: "Mes", only: null },
  { id: "timeGridWeek", label: "Semana", only: "wide" },
  { id: "timeGridThreeDay", label: "3 días", only: "narrow" },
  { id: "timeGridDay", label: "Día", only: null },
  { id: "listWeek", label: "Lista", only: null },
  { id: "multiMonthYear", label: "Año", only: null },
] as const;
type ViewId = (typeof VIEWS)[number]["id"];

/** Por debajo de este ancho se usa la disposición de móvil (FullCalendar y vistas). */
const NARROW_QUERY = "(max-width: 639px)";

const VIEW_KEY = "delyra.calendar.view";
const TASKS_KEY = "delyra.calendar.tasks";
const TASK_COLOR = "#64748b";
const DAY_MS = 86_400_000;

function savedView(): ViewId {
  const narrow = typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;
  const fallback: ViewId = narrow ? "timeGridThreeDay" : "timeGridWeek";
  try {
    const value = localStorage.getItem(VIEW_KEY);
    const view = VIEWS.find((v) => v.id === value);
    if (!view) return fallback;
    // La semana no cabe en un móvil y «3 días» solo existe en él: se cambia una por otra.
    if (view.only === (narrow ? "wide" : "narrow")) return fallback;
    return view.id;
  } catch {
    return fallback;
  }
}

function savedTasksLayer(): boolean {
  try {
    return localStorage.getItem(TASKS_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Tarjeta del kanban como evento de solo lectura; al pulsarla se abre en Trabajo. */
function taskEvent(card: DueCard, timeZone: string): EventInput {
  return {
    id: `tarea:${card.id}`,
    title: `${card.completed ? "✓" : "📌"} ${card.title}`,
    start: toCalendarTime(card.due.at, card.due.allDay, timeZone),
    allDay: card.due.allDay,
    editable: false,
    backgroundColor: TASK_COLOR,
    borderColor: TASK_COLOR,
    textColor: "#ffffff",
    classNames: card.completed ? ["opacity-60", "line-through"] : [],
    extendedProps: { task: card },
  };
}

function todayIn(timeZone: string): string {
  const w = instantToWall(Date.now(), timeZone);
  return `${String(w.year)}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

type TypeFilter = "all" | EventType;
type MoveArg = EventDropArg | EventResizeDoneArg;

function Workspace({ session }: { session: ActiveSession }) {
  const { timeZone, weekStart } = session.settings;
  const calendarRef = useRef<FullCalendar>(null);
  const queryClient = useQueryClient();
  const invalidate = useInvalidateEvents();
  const calendars = useCalendars();
  const [range, setRange] = useState<Range | null>(null);
  const occurrences = useOccurrences(range);
  const [title, setTitle] = useState("");
  const [view, setView] = useState<ViewId>(savedView);
  const [selected, setSelected] = useState(() => todayIn(timeZone));
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [showTasks, setShowTasks] = useState(savedTasksLayer);
  const narrow = useMediaQuery(NARROW_QUERY);
  // Con barra lateral (escritorio) sobran el botón de la hoja y el botón flotante.
  const desktop = useMediaQuery("(min-width: 1024px)", true);
  const [panelOpen, setPanelOpen] = useState(false);
  const views = VIEWS.filter((v) => v.only !== (narrow ? "wide" : "narrow"));
  const dueCards = useDueCards(range, showTasks);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const { ask, dialog: scopeDialog } = useScopeDialog();

  const calendarList = useMemo(() => calendars.data ?? [], [calendars.data]);
  const router = useRouter();
  const { searchStr } = useLocation();

  // «Abrir» desde una alerta de Telegram: /?evento=<id> abre el evento en su fecha (F3-06).
  useEffect(() => {
    const eventId = new URLSearchParams(searchStr).get("evento");
    if (!eventId) return;
    router.history.replace("/");
    fetchEvent(eventId)
      .then((detail) => {
        const occurrence: Occurrence = {
          id: detail.id,
          eventId: detail.recurringEventId ?? detail.id,
          calendarId: detail.calendarId,
          type: detail.type,
          title: detail.title,
          notes: detail.notes,
          location: detail.location,
          url: detail.url,
          allDay: detail.allDay,
          start: detail.start,
          end: detail.end,
          tz: detail.tz,
          recurring: false,
          originalStart: null,
          age: null,
        };
        const date = detail.allDay ? detail.start : todayFrom(detail.start, timeZone);
        calendarRef.current?.getApi().gotoDate(date);
        setEditor({ kind: "edit", occurrence });
      })
      .catch(() => toast.error("No se ha encontrado el evento"));
  }, [searchStr, router, timeZone]);
  const events = useMemo<EventInput[]>(() => {
    const byId = new Map(calendarList.map((c) => [c.id, c]));
    const list: EventInput[] = (occurrences.data ?? [])
      .filter((o) => byId.get(o.calendarId)?.visible !== false)
      .filter((o) => typeFilter === "all" || o.type === typeFilter)
      .map((o) => {
        const calendar = byId.get(o.calendarId);
        const color = calendar?.color ?? "#7c5cff";
        return {
          // Suscripción iCal (F5-06): se ve, pero no se arrastra ni se redimensiona.
          ...(calendar?.readOnly ? { editable: false } : {}),
          id: o.id,
          title: o.age !== null ? `${o.title} (${String(o.age)})` : o.title,
          start: toCalendarTime(o.start, o.allDay, timeZone),
          end: toCalendarTime(o.end, o.allDay, timeZone),
          allDay: o.allDay,
          backgroundColor: color,
          borderColor: color,
          textColor: "#ffffff",
          extendedProps: { occurrence: o },
        };
      });
    const tasks = showTasks ? (dueCards.data ?? []).map((card) => taskEvent(card, timeZone)) : [];
    return [...list, ...tasks];
  }, [occurrences.data, dueCards.data, showTasks, calendarList, typeFilter, timeZone]);

  const api = () => calendarRef.current?.getApi();

  function onDatesSet(arg: DatesSetArg) {
    setRange({ from: rangeEdge(arg.start, timeZone), to: rangeEdge(arg.end, timeZone) });
    setTitle(arg.view.title);
    setView(arg.view.type as ViewId);
    setSelected(utcToDateOnly(arg.view.currentStart.getTime()));
    try {
      localStorage.setItem(VIEW_KEY, arg.view.type);
    } catch {
      // Sin almacenamiento: se recuerda solo durante la visita.
    }
  }

  function onSelect(arg: DateSelectArg) {
    api()?.unselect();
    setEditor({
      kind: "create",
      allDay: arg.allDay,
      start: fromCalendarDate(arg.start, arg.allDay, timeZone),
      end: fromCalendarDate(arg.end, arg.allDay, timeZone),
    });
  }

  function onEventClick(arg: EventClickArg) {
    arg.jsEvent.preventDefault();
    const task = arg.event.extendedProps.task as DueCard | undefined;
    if (task) {
      const url = new URL(`/tableros/${task.boardId}`, currentAppOrigins().work);
      url.searchParams.set("tarjeta", task.id);
      window.location.assign(url.href);
      return;
    }
    setEditor({ kind: "edit", occurrence: arg.event.extendedProps.occurrence as Occurrence });
  }

  /** Arrastrar o redimensionar (F2-10): actualización optimista y vuelta atrás si falla. */
  async function onMove(arg: MoveArg) {
    const occurrence = arg.event.extendedProps.occurrence as Occurrence;
    const allDay = arg.event.allDay;
    const startDate = arg.event.start;
    if (!startDate) return arg.revert();
    const start = fromCalendarDate(startDate, allDay, timeZone);
    const end = arg.event.end
      ? fromCalendarDate(arg.event.end, allDay, timeZone)
      : allDay
        ? utcToDateOnly(dateOnlyToUtc(start) + DAY_MS)
        : new Date(Date.parse(start) + 3_600_000).toISOString();

    let scope: EditScope = "all";
    if (occurrence.recurring && occurrence.type !== "birthday") {
      const answer = await ask("move");
      if (!answer) return arg.revert();
      scope = answer;
    }
    if (scope === "all" && occurrence.recurring && allDay !== occurrence.allDay) {
      arg.revert();
      toast.info("Para pasar toda la serie a día completo (o al revés), usa el editor.");
      return;
    }

    const key = occurrencesKey(range);
    const previous = queryClient.getQueryData<Occurrence[]>(key);
    queryClient.setQueryData<Occurrence[]>(key, (old) =>
      old?.map((o) => (o.id === occurrence.id ? { ...o, start, end, allDay } : o)),
    );
    try {
      if (!occurrence.recurring) {
        await updateEvent(occurrence.eventId, { allDay, start, end });
      } else if (scope === "all") {
        // Se desplaza toda la serie lo mismo que esta ocurrencia.
        const detail = await fetchEvent(occurrence.eventId);
        const shifted = shiftSeries(detail, wallDelta(occurrence.start, start, allDay, timeZone));
        const length = allDay
          ? dateOnlyToUtc(end) - dateOnlyToUtc(start)
          : Date.parse(end) - Date.parse(start);
        await updateEvent(occurrence.eventId, {
          scope,
          allDay,
          start: shifted.start,
          end: allDay
            ? utcToDateOnly(dateOnlyToUtc(shifted.start) + length)
            : new Date(Date.parse(shifted.start) + length).toISOString(),
        });
      } else {
        await updateEvent(occurrence.eventId, {
          scope,
          occurrenceStart: occurrence.originalStart ?? undefined,
          allDay,
          start,
          end,
        });
      }
    } catch (caught) {
      arg.revert();
      queryClient.setQueryData(key, previous);
      toast.error(errorMessage(caught));
    } finally {
      await invalidate();
    }
  }

  function goToDate(date: string) {
    setSelected(date);
    api()?.gotoDate(date);
  }

  function openFromSearch(occurrence: Occurrence) {
    const date = occurrence.allDay ? occurrence.start : todayFrom(occurrence.start, timeZone);
    goToDate(date);
    setEditor({ kind: "edit", occurrence });
  }

  /** Mini mes, calendarios y filtros: en la barra lateral (escritorio) o en una hoja (móvil). */
  const panel = (place: string) => (
    <>
      <MiniMonth
        key={selected.slice(0, 7)}
        today={todayIn(timeZone)}
        selected={selected}
        weekStart={weekStart}
        onSelect={(date) => {
          goToDate(date);
          setPanelOpen(false);
        }}
      />
      <CalendarList calendars={calendarList} />
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Mostrar</legend>
        {(
          [
            ["all", "Todo"],
            ["event", "Eventos"],
            ["birthday", "Cumpleaños"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 py-1 text-sm">
            <input
              type="radio"
              name={`tipo-${place}`}
              checked={typeFilter === value}
              onChange={() => setTypeFilter(value)}
            />
            {label}
          </label>
        ))}
        <label className="flex items-center gap-2 py-1 text-sm">
          <input
            type="checkbox"
            checked={showTasks}
            onChange={(e) => {
              setShowTasks(e.target.checked);
              try {
                localStorage.setItem(TASKS_KEY, e.target.checked ? "on" : "off");
              } catch {
                // Sin almacenamiento: se recuerda solo durante la visita.
              }
            }}
          />
          <span
            aria-hidden="true"
            className="size-2.5 rounded-sm"
            style={{ backgroundColor: TASK_COLOR }}
          />
          Tareas con fecha límite
        </label>
      </fieldset>
    </>
  );

  return (
    <div className="grid h-[calc(100dvh-7rem)] min-h-[36rem] gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside
        aria-label="Navegación del calendario"
        className="hidden flex-col gap-6 overflow-y-auto lg:flex"
      >
        <Button
          onClick={() => setEditor({ kind: "create", allDay: false, ...nextHourSlot(timeZone) })}
        >
          <PlusIcon aria-hidden="true" />
          Nuevo evento
        </Button>
        {panel("lateral")}
      </aside>

      <section aria-label="Calendario" className="flex min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => api()?.today()}>
              Hoy
            </Button>
            <Button variant="ghost" size="icon" aria-label="Anterior" onClick={() => api()?.prev()}>
              <ChevronLeftIcon aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Siguiente"
              onClick={() => api()?.next()}
            >
              <ChevronRightIcon aria-hidden="true" />
            </Button>
          </div>
          <h1 className="mr-auto text-lg font-semibold tracking-tight first-letter:uppercase">
            {title}
          </h1>
          {desktop ? null : (
            <Button
              variant="outline"
              size="icon"
              aria-label="Calendarios y filtros"
              onClick={() => setPanelOpen(true)}
            >
              <PanelLeftIcon aria-hidden="true" />
            </Button>
          )}
          <div role="radiogroup" aria-label="Vista" className="flex rounded-md border p-0.5">
            {views.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={view === option.id}
                onClick={() => api()?.changeView(option.id)}
                className={cn(
                  "rounded px-2 py-1.5 text-sm whitespace-nowrap sm:px-2.5 sm:py-1",
                  view === option.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <QuickAdd
            calendars={calendarList.filter((c) => !c.readOnly)}
            timeZone={timeZone}
            onMoreOptions={setEditor}
          />
          <SearchBox calendars={calendarList} timeZone={timeZone} onOpen={openFromSearch} />
        </div>
        {occurrences.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(occurrences.error)}
          </p>
        ) : null}
        <div className="min-h-0 flex-1 rounded-xl border bg-card p-2">
          <FullCalendar
            ref={calendarRef}
            plugins={[
              dayGridPlugin,
              timeGridPlugin,
              listPlugin,
              multiMonthPlugin,
              interactionPlugin,
            ]}
            initialView={view}
            headerToolbar={false}
            locale={esLocale}
            firstDay={weekStart}
            weekNumbers={!narrow}
            dayHeaderFormat={narrow ? { weekday: "short", day: "numeric" } : undefined}
            longPressDelay={350}
            timeZone="UTC"
            now={() => floatingNow(timeZone)}
            nowIndicator
            height="100%"
            events={events}
            editable
            selectable
            selectMirror
            dayMaxEvents
            scrollTime="08:00:00"
            eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
            slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
            views={{
              multiMonthYear: { multiMonthMaxColumns: 3 },
              timeGridThreeDay: { type: "timeGrid", duration: { days: 3 } },
            }}
            datesSet={onDatesSet}
            select={onSelect}
            eventClick={onEventClick}
            eventDrop={(arg) => void onMove(arg)}
            eventResize={(arg) => void onMove(arg)}
          />
        </div>
      </section>

      <Dialog open={panelOpen} onOpenChange={setPanelOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Calendarios y filtros</DialogTitle>
            <DialogDescription className="sr-only">
              Elige el día, qué calendarios se ven y qué tipo de entradas se muestran.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-6">{panel("hoja")}</div>
        </DialogContent>
      </Dialog>
      {desktop ? null : (
        <Button
          aria-label="Nuevo evento"
          className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 size-14 rounded-full shadow-lg"
          onClick={() => setEditor({ kind: "create", allDay: false, ...nextHourSlot(timeZone) })}
        >
          <PlusIcon aria-hidden="true" className="size-6" />
        </Button>
      )}
      <EventEditor
        target={editor}
        calendars={calendarList}
        timeZone={timeZone}
        onClose={() => setEditor(null)}
      />
      {scopeDialog}
    </div>
  );
}

/** Próxima hora en punto en la zona del usuario (hasta las 23:00), de una hora de duración. */
function nextHourSlot(timeZone: string): { start: string; end: string } {
  const wall = instantToWall(Date.now(), timeZone);
  const date = todayIn(timeZone);
  const hour = Math.min(wall.hour + 1, 22);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    start: joinInstant(date, `${pad(hour)}:00`, timeZone),
    end: joinInstant(date, `${pad(hour + 1)}:00`, timeZone),
  };
}

function todayFrom(iso: string, timeZone: string): string {
  const w = instantToWall(Date.parse(iso), timeZone);
  return `${String(w.year)}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** Calendario (F2-08): vistas de mes, semana, día, lista y año en la zona del usuario. */
export function CalendarPage() {
  const router = useRouter();
  const logout = useLogout();
  return (
    <RequireSession navigate={(path) => router.history.replace(path)}>
      {(session) => (
        <AppShell app="calendar" user={session.user} onSignOut={() => logout.mutate()}>
          <Workspace session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}
