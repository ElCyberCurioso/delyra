import type { DayHeaderContentArg, EventContentArg } from "@fullcalendar/core";
import { intlLocale } from "@delyra/ui";
import type { ReactNode } from "react";

/**
 * Cómo se pinta cada evento y cada cabecera de día en FullCalendar.
 *
 * - En las vistas por horas: título arriba (hasta tres líneas) y, abajo, el horario a la
 *   izquierda y la categoría (el calendario) en una etiqueta a la derecha.
 * - En el mes y el año: una sola línea con la hora, el título y la etiqueta.
 * - En la lista: título y etiqueta (la hora tiene su propia columna).
 */

export interface EventCategory {
  name: string;
  /** Color de fondo del evento (ya legible con su texto). */
  background: string;
  text: string;
  /** El color oscurecido para leerse sobre blanco (`inkOnWhite`). */
  ink: string;
}

function CategoryChip({ category, inverted }: { category: EventCategory; inverted: boolean }) {
  // Sobre el color del evento, la etiqueta va en blanco con el color del calendario; en la lista
  // (fondo neutro) va al revés. En los dos casos el contraste es ≥ 4,5:1.
  const style = inverted
    ? { backgroundColor: category.background, color: category.text }
    : { backgroundColor: "#ffffff", color: category.ink };
  return (
    <span className="delyra-chip" style={style}>
      {category.name}
    </span>
  );
}

/** «09:30» a partir de una fecha de FullCalendar («UTC flotante»). */
function hhmm(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

export function renderEventContent(arg: EventContentArg): ReactNode {
  const category = arg.event.extendedProps.category as EventCategory | undefined;
  const title = arg.event.title;
  const type = arg.view.type;
  const { start, end } = arg.event;
  // Horario compacto («09:30–11:00»): cabe mejor junto a la etiqueta.
  const range = start ? (end ? `${hhmm(start)}–${hhmm(end)}` : hhmm(start)) : arg.timeText;
  const chip = category ? (
    <CategoryChip category={category} inverted={type.startsWith("list")} />
  ) : null;

  if (type.startsWith("list")) {
    return (
      <span className="delyra-ev delyra-ev-list">
        <span className="delyra-ev-title">{title}</span>
        {chip}
      </span>
    );
  }
  if (type.startsWith("timeGrid") && !arg.event.allDay) {
    return (
      <div className="delyra-ev delyra-ev-stack">
        <p className="delyra-ev-title">{title}</p>
        <div className="delyra-ev-meta">
          <span className="delyra-ev-time">{range}</span>
          {chip}
        </div>
      </div>
    );
  }
  return (
    <div className="delyra-ev delyra-ev-row">
      {start && !arg.event.allDay ? <span className="delyra-ev-time">{hhmm(start)}</span> : null}
      <span className="delyra-ev-title">{title}</span>
      {chip}
    </div>
  );
}

/**
 * Cabecera de cada día: en las vistas por horas, el día de la semana en pequeño y el número
 * grande (hoy, resaltado); en el mes, solo el día de la semana.
 */
export function renderDayHeader(arg: DayHeaderContentArg): ReactNode {
  const type = arg.view.type;
  // FullCalendar trabaja en «UTC flotante»: la fecha ya es la del día que se pinta.
  const weekday = new Intl.DateTimeFormat(intlLocale(), {
    weekday: "short",
    timeZone: "UTC",
  })
    .format(arg.date)
    .replace(".", "");
  if (!type.startsWith("timeGrid")) {
    return <span className="delyra-dayhead-weekday">{weekday}</span>;
  }
  const day = arg.date.getUTCDate();
  return (
    <span className="delyra-dayhead">
      <span className="sr-only">{arg.text}</span>
      <span className="delyra-dayhead-weekday" aria-hidden="true">
        {weekday}
      </span>
      <span
        className={arg.isToday ? "delyra-dayhead-day delyra-dayhead-today" : "delyra-dayhead-day"}
        aria-hidden="true"
      >
        {day}
      </span>
    </span>
  );
}
