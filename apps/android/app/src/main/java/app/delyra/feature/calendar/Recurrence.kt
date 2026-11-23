package app.delyra.feature.calendar

import java.time.DayOfWeek
import java.time.LocalDate

/** Repeticiones habituales ↔ RRULE (`apps/calendar/src/calendar/presets.ts`). */
enum class RepeatPreset { None, Daily, Weekdays, Weekly, Monthly, Yearly, Custom }

sealed interface RepeatEnd {
    data object Never : RepeatEnd
    data class Until(val date: LocalDate) : RepeatEnd
    data class Count(val count: Int) : RepeatEnd
}

data class RepeatState(val preset: RepeatPreset = RepeatPreset.None, val end: RepeatEnd = RepeatEnd.Never, val custom: String = "")

private val BYDAY = mapOf(
    DayOfWeek.SUNDAY to "SU", DayOfWeek.MONDAY to "MO", DayOfWeek.TUESDAY to "TU", DayOfWeek.WEDNESDAY to "WE",
    DayOfWeek.THURSDAY to "TH", DayOfWeek.FRIDAY to "FR", DayOfWeek.SATURDAY to "SA",
)

private fun baseRule(preset: RepeatPreset, start: LocalDate): String? = when (preset) {
    RepeatPreset.Daily -> "FREQ=DAILY"
    RepeatPreset.Weekdays -> "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
    RepeatPreset.Weekly -> "FREQ=WEEKLY;BYDAY=${BYDAY.getValue(start.dayOfWeek)}"
    RepeatPreset.Monthly -> "FREQ=MONTHLY;BYMONTHDAY=${start.dayOfMonth}"
    RepeatPreset.Yearly -> "FREQ=YEARLY"
    RepeatPreset.None, RepeatPreset.Custom -> null
}

/** Estado del editor → RRULE (o null si no se repite). */
fun RepeatState.toRrule(start: LocalDate): String? {
    if (preset == RepeatPreset.None) return null
    if (preset == RepeatPreset.Custom) return custom.trim().uppercase().ifEmpty { null }
    val base = baseRule(preset, start) ?: return null
    return when (val e = end) {
        RepeatEnd.Never -> base
        is RepeatEnd.Until -> "$base;UNTIL=${e.date.toString().replace("-", "")}T235959Z"
        is RepeatEnd.Count -> "$base;COUNT=${e.count}"
    }
}

/** RRULE guardada → estado del editor (si no encaja con ningún ajuste, regla avanzada). */
fun repeatStateOf(rrule: String?, start: LocalDate): RepeatState {
    if (rrule.isNullOrBlank()) return RepeatState()
    var end: RepeatEnd = RepeatEnd.Never
    val rest = mutableListOf<String>()
    for (part in rrule.split(";")) {
        val key = part.substringBefore("=")
        val value = part.substringAfter("=", "")
        when {
            key == "UNTIL" && Regex("^\\d{8}").containsMatchIn(value) ->
                end = RepeatEnd.Until(LocalDate.of(value.take(4).toInt(), value.substring(4, 6).toInt(), value.substring(6, 8).toInt()))
            key == "COUNT" && value.toIntOrNull() != null -> end = RepeatEnd.Count(value.toInt())
            else -> rest += part
        }
    }
    val base = rest.joinToString(";")
    val match = listOf(RepeatPreset.Daily, RepeatPreset.Weekdays, RepeatPreset.Weekly, RepeatPreset.Monthly, RepeatPreset.Yearly)
        .firstOrNull { baseRule(it, start) == base }
    return if (match != null) RepeatState(match, end) else RepeatState(RepeatPreset.Custom, RepeatEnd.Never, rrule)
}

/** Alertas (minutos antes del inicio; en día completo, respecto a las 00:00, negativo = ese día). */
val TIMED_REMINDERS = listOf(0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10_080)
val ALL_DAY_REMINDERS = listOf(-540, 900, 2340, 9540)

/** Por defecto en un cumpleaños: el día anterior y el mismo día, a las 9:00. */
val BIRTHDAY_REMINDERS = listOf(900, -540)
