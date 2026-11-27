import { dateOnlyToUtc } from "@delyra/shared";
import { intlLocale } from "@delyra/ui";
import { calendarMessages } from "./messages";

/** Repeticiones habituales ↔ RRULE (el editor también admite una regla avanzada). */

export type RepeatPreset =
  "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly" | "custom";

type RepeatEnd =
  { kind: "never" } | { kind: "until"; date: string } | { kind: "count"; count: number };

export interface RepeatState {
  preset: RepeatPreset;
  end: RepeatEnd;
  custom: string;
}

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

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
  const { monthDay } = dayInfo(startDate);
  const t = calendarMessages().repeat;
  const weekdayName = new Intl.DateTimeFormat(intlLocale(), {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(dateOnlyToUtc(startDate)));
  return [
    { value: "none", label: t.none },
    { value: "daily", label: t.daily },
    { value: "weekdays", label: t.weekdays },
    { value: "weekly", label: t.weekly(weekdayName) },
    { value: "monthly", label: t.monthly(monthDay) },
    { value: "yearly", label: t.yearly },
    { value: "custom", label: t.custom },
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

const TIMED_OFFSETS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10_080] as const;
const ALL_DAY_OFFSETS = [-540, 900, 2340, 9540] as const;

function timedLabel(offset: number): string {
  const t = calendarMessages().reminders;
  if (offset === 0) return t.atStart;
  if (offset === 10_080) return t.weekBefore;
  if (offset % 1440 === 0) return t.daysBefore(offset / 1440);
  if (offset % 60 === 0) return t.hoursBefore(offset / 60);
  return t.minutesBefore(offset);
}

const ALL_DAY_LABELS = {
  [-540]: "sameDay9",
  900: "dayBefore9",
  2340: "twoDaysBefore9",
  9540: "weekBefore9",
} as const;

export function timedReminders(): { value: number; label: string }[] {
  return TIMED_OFFSETS.map((value) => ({ value, label: timedLabel(value) }));
}

export function allDayReminders(): { value: number; label: string }[] {
  const t = calendarMessages().reminders;
  return ALL_DAY_OFFSETS.map((value) => ({ value, label: t[ALL_DAY_LABELS[value]] }));
}

export function reminderLabel(offset: number, allDay: boolean): string {
  const list = allDay ? allDayReminders() : timedReminders();
  const known = list.find((option) => option.value === offset);
  if (known) return known.label;
  const t = calendarMessages().reminders;
  return offset >= 0 ? t.minutesBefore(offset) : t.minutesAfter(-offset);
}
