import {
  type CalendarInfo,
  calendarResponseSchema,
  calendarsResponseSchema,
  type EditScope,
  type EventDetail,
  eventResponseSchema,
  type Occurrence,
  occurrencesResponseSchema,
} from "@delyra/shared";
import { apiFetch } from "@delyra/ui";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";

export const CALENDARS_KEY = ["calendars"] as const;
export const EVENTS_KEY = ["events"] as const;

export function useCalendars() {
  return useQuery({
    queryKey: CALENDARS_KEY,
    queryFn: ({ signal }) =>
      apiFetch("/api/calendars", { schema: calendarsResponseSchema, signal }).then(
        (r) => r.calendars,
      ),
    staleTime: 60_000,
  });
}

export interface Range {
  from: string;
  to: string;
}

export function occurrencesKey(range: Range | null) {
  return [...EVENTS_KEY, range?.from ?? "", range?.to ?? ""] as const;
}

/** Ocurrencias del rango visible; al cambiar de rango se mantienen las anteriores mientras carga. */
export function useOccurrences(range: Range | null) {
  return useQuery<Occurrence[]>({
    queryKey: occurrencesKey(range),
    enabled: range !== null,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ from: range?.from ?? "", to: range?.to ?? "" });
      return apiFetch(`/api/events?${params.toString()}`, {
        schema: occurrencesResponseSchema,
        signal,
      }).then((r) => r.events);
    },
  });
}

export function searchEvents(query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query });
  return apiFetch(`/api/events/search?${params.toString()}`, {
    schema: occurrencesResponseSchema,
    signal,
  }).then((r) => r.events);
}

export function fetchEvent(id: string, signal?: AbortSignal): Promise<EventDetail> {
  return apiFetch(`/api/events/${id}`, { schema: eventResponseSchema, signal }).then(
    (r) => r.event,
  );
}

export function createEvent(body: Record<string, unknown>): Promise<EventDetail> {
  return apiFetch("/api/events", { method: "POST", body, schema: eventResponseSchema }).then(
    (r) => r.event,
  );
}

export function updateEvent(id: string, body: Record<string, unknown>): Promise<EventDetail> {
  return apiFetch(`/api/events/${id}`, { method: "PATCH", body, schema: eventResponseSchema }).then(
    (r) => r.event,
  );
}

export function deleteEvent(id: string, scope: EditScope, occurrence: string | null) {
  const params = new URLSearchParams({ scope });
  if (occurrence) params.set("occurrence", occurrence);
  return apiFetch(`/api/events/${id}?${params.toString()}`, { method: "DELETE" });
}

export function createCalendar(body: { name: string; color: string }): Promise<CalendarInfo> {
  return apiFetch("/api/calendars", { method: "POST", body, schema: calendarResponseSchema }).then(
    (r) => r.calendar,
  );
}

export function updateCalendar(
  id: string,
  body: Partial<Pick<CalendarInfo, "name" | "color" | "visible" | "position">>,
): Promise<CalendarInfo> {
  return apiFetch(`/api/calendars/${id}`, {
    method: "PATCH",
    body,
    schema: calendarResponseSchema,
  }).then((r) => r.calendar);
}

export function deleteCalendar(id: string) {
  return apiFetch(`/api/calendars/${id}`, { method: "DELETE" });
}

/** Tras cualquier cambio en eventos: se vuelven a pedir todos los rangos en pantalla. */
export function useInvalidateEvents() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: EVENTS_KEY });
}
