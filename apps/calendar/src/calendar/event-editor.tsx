import {
  type CalendarInfo,
  dateOnlyToUtc,
  type EventDetail,
  type EventType,
  type Feb29Rule,
  type Occurrence,
  utcToDateOnly,
} from "@delyra/shared";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  errorMessage,
  Field,
  FormError,
  SelectField,
  toast,
} from "@delyra/ui";
import { useQuery } from "@tanstack/react-query";
import { BellIcon, Trash2Icon, XIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { createEvent, deleteEvent, fetchEvent, updateEvent, useInvalidateEvents } from "./api";
import {
  ALL_DAY_REMINDERS,
  fromRrule,
  reminderLabel,
  type RepeatState,
  repeatOptions,
  TIMED_REMINDERS,
  toRrule,
} from "./presets";
import { useScopeDialog } from "./scope-dialog";
import { describeWhen, joinInstant, shiftSeries, splitInstant, wallDelta } from "./time";

const DAY_MS = 86_400_000;

export type EditorTarget =
  | {
      kind: "create";
      allDay: boolean;
      /** Formato de la API: `AAAA-MM-DD` o instante ISO. */
      start: string;
      end: string;
      title?: string;
      calendarId?: string;
      type?: EventType;
    }
  | { kind: "edit"; occurrence: Occurrence };

interface FormState {
  type: EventType;
  calendarId: string;
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  /** En día completo, último día incluido (la API usa fin exclusivo). */
  endDate: string;
  endTime: string;
  repeat: RepeatState;
  reminders: number[];
  location: string;
  url: string;
  notes: string;
  birthYear: string;
  feb29Rule: Feb29Rule;
}

const addDays = (date: string, days: number) => utcToDateOnly(dateOnlyToUtc(date) + days * DAY_MS);

function timesFrom(start: string, end: string, allDay: boolean, timeZone: string) {
  if (allDay) {
    return { startDate: start, startTime: "09:00", endDate: addDays(end, -1), endTime: "10:00" };
  }
  const s = splitInstant(start, timeZone);
  const e = splitInstant(end, timeZone);
  return { startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time };
}

/** Inicio y fin en formato de la API a partir del formulario. */
function apiTimes(form: FormState, timeZone: string) {
  if (form.allDay || form.type === "birthday") {
    const endDate = form.type === "birthday" ? form.startDate : form.endDate;
    return { allDay: true, start: form.startDate, end: addDays(endDate, 1) };
  }
  return {
    allDay: false,
    start: joinInstant(form.startDate, form.startTime, timeZone),
    end: joinInstant(form.endDate, form.endTime, timeZone),
  };
}

function initialForm(
  target: EditorTarget,
  detail: EventDetail | undefined,
  calendars: readonly CalendarInfo[],
  timeZone: string,
): FormState {
  if (target.kind === "create") {
    const type = target.type ?? "event";
    const fallback =
      calendars.find((c) => c.kind === (type === "birthday" ? "birthdays" : "personal")) ??
      calendars[0];
    return {
      type,
      calendarId: target.calendarId ?? fallback?.id ?? "",
      title: target.title ?? "",
      allDay: target.allDay,
      ...timesFrom(target.start, target.end, target.allDay, timeZone),
      repeat: { preset: "none", end: { kind: "never" }, custom: "" },
      reminders: type === "birthday" ? [900, -540] : [],
      location: "",
      url: "",
      notes: "",
      birthYear: "",
      feb29Rule: "feb28",
    };
  }
  const { occurrence } = target;
  // Un cumpleaños se edita entero (fecha de nacimiento); un evento, desde la ocurrencia pulsada.
  const source = occurrence.type === "birthday" && detail ? detail : occurrence;
  const times = timesFrom(source.start, source.end, source.allDay, timeZone);
  return {
    type: occurrence.type,
    calendarId: occurrence.calendarId,
    title: occurrence.title,
    allDay: occurrence.allDay,
    ...times,
    repeat: fromRrule(detail?.rrule ?? null, times.startDate),
    reminders: detail?.reminders.map((r) => r.offsetMinutes) ?? [],
    location: occurrence.location ?? "",
    url: occurrence.url ?? "",
    notes: occurrence.notes ?? "",
    birthYear: detail?.birthYear ? String(detail.birthYear) : "",
    feb29Rule: detail?.feb29Rule ?? "feb28",
  };
}

function Textarea(props: React.ComponentProps<"textarea"> & { label: string }) {
  const { label, className, ...rest } = props;
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <textarea
        className={cn(
          "min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base font-normal shadow-xs outline-none md:text-sm",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          className,
        )}
        {...rest}
      />
    </label>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function RemindersField({
  value,
  allDay,
  onChange,
}: {
  value: number[];
  allDay: boolean;
  onChange: (next: number[]) => void;
}) {
  const options = (allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS).filter(
    (option) => !value.includes(option.value),
  );
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-sm font-medium">Alertas</legend>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((offset) => (
            <li
              key={offset}
              className="flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-2.5 text-sm"
            >
              <BellIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
              {reminderLabel(offset, allDay)}
              <button
                type="button"
                aria-label={`Quitar alerta: ${reminderLabel(offset, allDay)}`}
                className="rounded-full p-0.5 hover:bg-accent"
                onClick={() => onChange(value.filter((v) => v !== offset))}
              >
                <XIcon aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {options.length > 0 && value.length < 10 ? (
        <select
          aria-label="Añadir alerta"
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-base sm:w-64 sm:text-sm"
          value=""
          onChange={(event) => {
            const offset = Number(event.target.value);
            if (event.target.value !== "") onChange([...value, offset].sort((a, b) => b - a));
          }}
        >
          <option value="">Añadir alerta…</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Los avisos se enviarán por Telegram cuando lo conectes.
      </p>
    </fieldset>
  );
}

function EditorForm({
  target,
  detail,
  calendars,
  timeZone,
  onClose,
}: {
  target: EditorTarget;
  detail: EventDetail | undefined;
  calendars: readonly CalendarInfo[];
  timeZone: string;
  onClose: () => void;
}) {
  const [form, setForm] = useState(() => initialForm(target, detail, calendars, timeZone));
  const [initial] = useState(form);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { ask, dialog } = useScopeDialog();
  const invalidate = useInvalidateEvents();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const editing = target.kind === "edit" ? target.occurrence : null;
  const birthday = form.type === "birthday";
  const isFeb29 = form.startDate.slice(5) === "02-29";

  function validate(): string | null {
    if (!form.title.trim()) return "Ponle un título.";
    if (!form.calendarId) return "Elige un calendario.";
    if (!form.startDate) return "Indica la fecha.";
    const times = apiTimes(form, timeZone);
    const start = times.allDay ? dateOnlyToUtc(times.start) : Date.parse(times.start);
    const end = times.allDay ? dateOnlyToUtc(times.end) : Date.parse(times.end);
    if (!(end > start)) return "El fin debe ser posterior al inicio.";
    if (form.repeat.preset === "custom" && !form.repeat.custom.trim()) {
      return "Escribe la regla de repetición o elige otra opción.";
    }
    return null;
  }

  function body() {
    const birthYear = form.birthYear.trim() ? Number(form.birthYear) : null;
    return {
      calendarId: form.calendarId,
      title: form.title.trim(),
      notes: form.notes,
      location: form.location,
      url: form.url,
      ...(birthday ? { birthYear, feb29Rule: isFeb29 ? form.feb29Rule : null } : {}),
    };
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    const times = apiTimes(form, timeZone);
    const rrule = birthday ? undefined : toRrule(form.repeat, form.startDate);
    const reminders = form.reminders.map((offsetMinutes) => ({ offsetMinutes }));
    setPending(true);
    try {
      if (!editing) {
        await createEvent({ type: form.type, ...body(), ...times, tz: timeZone, rrule, reminders });
        toast.success(birthday ? "Cumpleaños guardado" : "Evento creado");
      } else if (birthday || !editing.recurring) {
        await updateEvent(editing.eventId, { ...body(), ...times, rrule, reminders, scope: "all" });
        toast.success("Cambios guardados");
      } else {
        const scope = await ask("edit");
        if (!scope) return;
        const occurrenceStart = editing.originalStart ?? undefined;
        if (scope === "this") {
          await updateEvent(editing.eventId, { scope, occurrenceStart, ...body(), ...times });
        } else if (scope === "following") {
          await updateEvent(editing.eventId, {
            scope,
            occurrenceStart,
            ...body(),
            ...times,
            rrule,
            reminders,
          });
        } else {
          await updateEvent(editing.eventId, {
            scope,
            ...body(),
            ...seriesTimes(times),
            ...(rrule !== (detail?.rrule ?? null) ? { rrule } : {}),
            reminders,
          });
        }
        toast.success("Cambios guardados");
      }
      await invalidate();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  /** «Todos»: el cambio de fecha u hora hecho en esta ocurrencia se aplica a toda la serie. */
  function seriesTimes(times: ReturnType<typeof apiTimes>) {
    const before = apiTimes(initial, timeZone);
    const unchanged = times.start === before.start && times.end === before.end;
    if (unchanged || !editing || !detail) return {};
    if (times.allDay !== editing.allDay) {
      // Cambia el tipo de horario: se mantiene el día de la serie y se toman las horas nuevas.
      const masterDate = detail.allDay ? detail.start : splitInstant(detail.start, detail.tz).date;
      const shiftDays = Math.round(
        wallDelta(initial.startDate, form.startDate, true, timeZone) / DAY_MS,
      );
      const date = addDays(masterDate, shiftDays);
      const length = Math.round(wallDelta(form.startDate, form.endDate, true, timeZone) / DAY_MS);
      return apiTimes({ ...form, startDate: date, endDate: addDays(date, length) }, timeZone);
    }
    const delta = wallDelta(editing.start, times.start, times.allDay, timeZone);
    const shifted = shiftSeries(detail, delta);
    if (times.allDay) {
      const days = (dateOnlyToUtc(times.end) - dateOnlyToUtc(times.start)) / DAY_MS;
      return { allDay: true, start: shifted.start, end: addDays(shifted.start, days) };
    }
    const duration = Date.parse(times.end) - Date.parse(times.start);
    return {
      allDay: false,
      start: shifted.start,
      end: new Date(Date.parse(shifted.start) + duration).toISOString(),
    };
  }

  async function remove() {
    if (!editing) return;
    setPending(true);
    try {
      if (editing.recurring) {
        const scope = await ask(
          "delete",
          birthday ? ["this", "all"] : ["this", "following", "all"],
        );
        if (!scope) return;
        await deleteEvent(editing.eventId, scope, editing.originalStart);
      } else {
        await deleteEvent(editing.eventId, "all", null);
      }
      toast.success("Evento borrado");
      await invalidate();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  const calendarOptions = calendars.map((c) => ({ value: c.id, label: c.name }));

  return (
    <form noValidate onSubmit={(event) => void save(event)} className="grid gap-4">
      <FormError>{error}</FormError>
      {!editing ? (
        <div role="radiogroup" aria-label="Tipo" className="flex gap-2">
          {(["event", "birthday"] as const).map((type) => (
            <Button
              key={type}
              type="button"
              role="radio"
              aria-checked={form.type === type}
              variant={form.type === type ? "default" : "outline"}
              size="sm"
              onClick={() => {
                const target = calendars.find(
                  (c) => c.kind === (type === "birthday" ? "birthdays" : "personal"),
                );
                setForm((current) => ({
                  ...current,
                  type,
                  allDay: type === "birthday" ? true : current.allDay,
                  calendarId: target?.id ?? current.calendarId,
                  reminders: type === "birthday" ? [900, -540] : [],
                }));
              }}
            >
              {type === "event" ? "Evento" : "Cumpleaños"}
            </Button>
          ))}
        </div>
      ) : null}

      <Field
        label="Título"
        value={form.title}
        onChange={(e) => set("title", e.target.value)}
        placeholder={birthday ? "Cumpleaños de…" : "Añade un título"}
        maxLength={200}
        autoFocus={!editing}
        required
      />
      <SelectField
        label="Calendario"
        value={form.calendarId}
        onChange={(e) => set("calendarId", e.target.value)}
        options={calendarOptions}
      />

      {birthday ? (
        <>
          <Row>
            <Field
              label="Fecha"
              type="date"
              value={form.startDate}
              onChange={(e) => set("startDate", e.target.value)}
              required
            />
            <Field
              label="Año de nacimiento (opcional)"
              type="number"
              inputMode="numeric"
              min={1900}
              max={2200}
              value={form.birthYear}
              onChange={(e) => set("birthYear", e.target.value)}
              hint="Para mostrar la edad que cumple."
            />
          </Row>
          {isFeb29 ? (
            <SelectField
              label="En los años no bisiestos se celebra"
              value={form.feb29Rule}
              onChange={(e) => set("feb29Rule", e.target.value as Feb29Rule)}
              options={[
                { value: "feb28", label: "El 28 de febrero" },
                { value: "mar1", label: "El 1 de marzo" },
              ]}
            />
          ) : null}
        </>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={form.allDay}
              onChange={(e) => set("allDay", e.target.checked)}
            />
            Todo el día
          </label>
          <Row>
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <Field
                label="Empieza"
                type="date"
                value={form.startDate}
                onChange={(e) => {
                  const value = e.target.value;
                  setForm((current) => ({
                    ...current,
                    startDate: value,
                    endDate: current.endDate < value ? value : current.endDate,
                  }));
                }}
                required
              />
              {!form.allDay ? (
                <Field
                  label="Hora de inicio"
                  className="[&_label]:sr-only"
                  type="time"
                  value={form.startTime}
                  onChange={(e) => set("startTime", e.target.value)}
                />
              ) : null}
            </div>
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <Field
                label="Termina"
                type="date"
                value={form.endDate}
                min={form.startDate}
                onChange={(e) => set("endDate", e.target.value)}
                required
              />
              {!form.allDay ? (
                <Field
                  label="Hora de fin"
                  className="[&_label]:sr-only"
                  type="time"
                  value={form.endTime}
                  onChange={(e) => set("endTime", e.target.value)}
                />
              ) : null}
            </div>
          </Row>
          <Row>
            <SelectField
              label="Repetición"
              value={form.repeat.preset}
              onChange={(e) =>
                set("repeat", { ...form.repeat, preset: e.target.value as RepeatState["preset"] })
              }
              options={repeatOptions(form.startDate)}
            />
            {form.repeat.preset !== "none" && form.repeat.preset !== "custom" ? (
              <SelectField
                label="Fin de la repetición"
                value={form.repeat.end.kind}
                onChange={(e) => {
                  const kind = e.target.value;
                  set("repeat", {
                    ...form.repeat,
                    end:
                      kind === "until"
                        ? { kind, date: addDays(form.startDate, 30) }
                        : kind === "count"
                          ? { kind, count: 10 }
                          : { kind: "never" },
                  });
                }}
                options={[
                  { value: "never", label: "Nunca" },
                  { value: "until", label: "Un día concreto" },
                  { value: "count", label: "Tras unas veces" },
                ]}
              />
            ) : null}
          </Row>
          {form.repeat.preset === "custom" ? (
            <Field
              label="Regla RRULE"
              value={form.repeat.custom}
              onChange={(e) => set("repeat", { ...form.repeat, custom: e.target.value })}
              placeholder="FREQ=MONTHLY;BYDAY=-1FR"
              hint="RFC 5545, sin DTSTART. Diaria, semanal, mensual o anual."
            />
          ) : null}
          {form.repeat.end.kind === "until" && form.repeat.preset !== "custom" ? (
            <Field
              label="Último día"
              type="date"
              value={form.repeat.end.date}
              min={form.startDate}
              onChange={(e) =>
                set("repeat", { ...form.repeat, end: { kind: "until", date: e.target.value } })
              }
            />
          ) : null}
          {form.repeat.end.kind === "count" && form.repeat.preset !== "custom" ? (
            <Field
              label="Número de veces"
              type="number"
              min={1}
              max={1000}
              value={form.repeat.end.count}
              onChange={(e) =>
                set("repeat", {
                  ...form.repeat,
                  end: { kind: "count", count: Math.max(1, Number(e.target.value)) },
                })
              }
            />
          ) : null}
        </>
      )}

      <RemindersField
        value={form.reminders}
        allDay={form.allDay || birthday}
        onChange={(value) => set("reminders", value)}
      />

      {!birthday ? (
        <>
          <Field
            label="Ubicación"
            value={form.location}
            onChange={(e) => set("location", e.target.value)}
            maxLength={300}
          />
          <Field
            label="Enlace"
            type="url"
            value={form.url}
            onChange={(e) => set("url", e.target.value)}
            placeholder="https://…"
            maxLength={2000}
          />
        </>
      ) : null}
      <Textarea
        label="Notas"
        value={form.notes}
        onChange={(e) => set("notes", e.target.value)}
        maxLength={10_000}
        rows={3}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        {editing ? (
          confirmDelete || editing.recurring ? (
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => void remove()}
            >
              <Trash2Icon aria-hidden="true" />
              {editing.recurring ? "Borrar…" : "Sí, borrar"}
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2Icon aria-hidden="true" />
              Borrar
            </Button>
          )
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
      {dialog}
    </form>
  );
}

/** Detalle de un evento de una suscripción: se lee aquí y se cambia en Google Calendar. */
function ReadOnlyEvent({
  occurrence,
  calendar,
  timeZone,
  onClose,
}: {
  occurrence: Occurrence;
  calendar: CalendarInfo | undefined;
  timeZone: string;
  onClose: () => void;
}) {
  return (
    <div className="grid gap-4 text-sm">
      <div>
        <p className="text-base font-semibold break-words">{occurrence.title}</p>
        <p className="text-muted-foreground">{describeWhen(occurrence, timeZone)}</p>
      </div>
      <dl className="grid gap-2">
        {calendar ? (
          <div className="flex items-center gap-2">
            <dt className="sr-only">Calendario</dt>
            <span
              aria-hidden="true"
              className="size-3 rounded-full"
              style={{ backgroundColor: calendar.color }}
            />
            <dd>{calendar.name}</dd>
          </div>
        ) : null}
        {occurrence.location ? (
          <div>
            <dt className="font-medium">Ubicación</dt>
            <dd className="break-words">{occurrence.location}</dd>
          </div>
        ) : null}
        {occurrence.notes ? (
          <div>
            <dt className="font-medium">Notas</dt>
            <dd className="break-words whitespace-pre-wrap">{occurrence.notes}</dd>
          </div>
        ) : null}
      </dl>
      <p className="rounded-md bg-muted p-3 text-muted-foreground">
        Viene de una suscripción de Google Calendar y se actualiza sola cada hora. Para cambiarlo,
        hazlo en Google Calendar.
      </p>
      <DialogFooter>
        <Button onClick={onClose}>Cerrar</Button>
      </DialogFooter>
    </div>
  );
}

/** Panel de creación y edición de eventos y cumpleaños (F2-09). */
export function EventEditor({
  target,
  calendars,
  timeZone,
  onClose,
}: {
  target: EditorTarget | null;
  calendars: readonly CalendarInfo[];
  timeZone: string;
  onClose: () => void;
}) {
  const eventId = target?.kind === "edit" ? target.occurrence.eventId : null;
  // Los eventos de una suscripción iCal (F5-06) solo se consultan.
  const readOnly =
    target?.kind === "edit" &&
    calendars.find((c) => c.id === target.occurrence.calendarId)?.readOnly === true;
  const writable = calendars.filter((c) => !c.readOnly);
  const detail = useQuery({
    queryKey: ["event", eventId],
    enabled: eventId !== null,
    queryFn: ({ signal }) => fetchEvent(eventId ?? "", signal),
    staleTime: 0,
  });
  // Sin calendarios aún (primera carga) el formulario no tendría uno por defecto.
  const ready = target !== null && writable.length > 0 && (eventId === null || detail.isSuccess);
  const title = readOnly
    ? "Evento de una suscripción"
    : target?.kind === "edit"
      ? target.occurrence.type === "birthday"
        ? "Editar cumpleaños"
        : "Editar evento"
      : "Nuevo evento";

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Título, fechas, repetición, alertas y detalles del evento.
          </DialogDescription>
        </DialogHeader>
        {detail.isError ? <p role="alert">{errorMessage(detail.error)}</p> : null}
        {readOnly && target.kind === "edit" ? (
          <ReadOnlyEvent
            occurrence={target.occurrence}
            calendar={calendars.find((c) => c.id === target.occurrence.calendarId)}
            timeZone={timeZone}
            onClose={onClose}
          />
        ) : ready ? (
          <EditorForm
            key={target.kind === "edit" ? target.occurrence.id : `${target.start}-${target.end}`}
            target={target}
            detail={detail.data}
            calendars={writable}
            timeZone={timeZone}
            onClose={onClose}
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
