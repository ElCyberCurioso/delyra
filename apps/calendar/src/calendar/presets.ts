import { dateOnlyToUtc } from "@delyra/shared";

/** Repeticiones habituales ↔ RRULE (el editor también admite una regla avanzada). */

export type RepeatPreset =
  "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly" | "custom";

export type RepeatEnd =
  { kind: "never" } | { kind: "until"; date: string } | { kind: "count"; count: number };

export interface RepeatState {
  preset: RepeatPreset;
  end: RepeatEnd;
  custom: string;
}

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function dayInfo(startDate: string) {
  const date = new Date(dateOnlyToUtc(startDate));
  return { weekday: date.getUTCDay(), monthDay: date.getUTCDate() };
}

function baseRule(preset: RepeatPreset, startDate: string): string | null {
  const { weekday, monthDay } = dayInfo(startDate);
  switch (preset) {
    case "daily":
      return "FREQ=DAILY";
    case "weekdays":
      return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "weekly":
      return `FREQ=WEEKLY;BYDAY=${BYDAY[weekday] ?? "MO"}`;
    case "monthly":
      return `FREQ=MONTHLY;BYMONTHDAY=${String(monthDay)}`;
    case "yearly":
      return "FREQ=YEARLY";
    case "none":
    case "custom":
      return null;
  }
}

export function repeatOptions(startDate: string): { value: RepeatPreset; label: string }[] {
  const { weekday, monthDay } = dayInfo(startDate);
  return [
    { value: "none", label: "No se repite" },
    { value: "daily", label: "Cada día" },
    { value: "weekdays", label: "De lunes a viernes" },
    { value: "weekly", label: `Cada semana, el ${WEEKDAY_NAMES[weekday] ?? "lunes"}` },
    { value: "monthly", label: `Cada mes, el día ${String(monthDay)}` },
    { value: "yearly", label: "Cada año" },
    { value: "custom", label: "Personalizada (RRULE)" },
  ];
}

/** Estado del editor → RRULE (o null si no se repite). */
export function toRrule(state: RepeatState, startDate: string): string | null {
  if (state.preset === "none") return null;
  if (state.preset === "custom") return state.custom.trim().toUpperCase() || null;
  const base = baseRule(state.preset, startDate);
  if (!base) return null;
  if (state.end.kind === "until") {
    return `${base};UNTIL=${state.end.date.replaceAll("-", "")}T235959Z`;
  }
  if (state.end.kind === "count") return `${base};COUNT=${String(state.end.count)}`;
  return base;
}

/** RRULE guardada → estado del editor (si no encaja con ningún ajuste, regla avanzada). */
export function fromRrule(rrule: string | null, startDate: string): RepeatState {
  const never: RepeatEnd = { kind: "never" };
  if (!rrule) return { preset: "none", end: never, custom: "" };
  const parts = rrule.split(";");
  const rest: string[] = [];
  let end: RepeatEnd = never;
  for (const part of parts) {
    const [key, value = ""] = part.split("=");
    if (key === "UNTIL" && /^\d{8}/.test(value)) {
      end = {
        kind: "until",
        date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`,
      };
    } else if (key === "COUNT") {
      end = { kind: "count", count: Number(value) };
    } else {
      rest.push(part);
    }
  }
  const base = rest.join(";");
  const presets: RepeatPreset[] = ["daily", "weekdays", "weekly", "monthly", "yearly"];
  const match = presets.find((preset) => baseRule(preset, startDate) === base);
  return match
    ? { preset: match, end, custom: "" }
    : { preset: "custom", end: never, custom: rrule };
}

// ── Alertas ────────────────────────────────────────────────────────────────

export const TIMED_REMINDERS: readonly { value: number; label: string }[] = [
  { value: 0, label: "Al empezar" },
  { value: 5, label: "5 minutos antes" },
  { value: 10, label: "10 minutos antes" },
  { value: 15, label: "15 minutos antes" },
  { value: 30, label: "30 minutos antes" },
  { value: 60, label: "1 hora antes" },
  { value: 120, label: "2 horas antes" },
  { value: 1440, label: "1 día antes" },
  { value: 2880, label: "2 días antes" },
  { value: 10_080, label: "1 semana antes" },
];

export const ALL_DAY_REMINDERS: readonly { value: number; label: string }[] = [
  { value: -540, label: "El mismo día a las 9:00" },
  { value: 900, label: "El día anterior a las 9:00" },
  { value: 2340, label: "2 días antes a las 9:00" },
  { value: 9540, label: "1 semana antes a las 9:00" },
];

export function reminderLabel(offset: number, allDay: boolean): string {
  const list = allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS;
  const known = list.find((option) => option.value === offset);
  if (known) return known.label;
  return offset >= 0 ? `${String(offset)} minutos antes` : `${String(-offset)} minutos después`;
}
