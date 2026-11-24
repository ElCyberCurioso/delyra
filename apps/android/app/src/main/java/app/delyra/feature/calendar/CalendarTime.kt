package app.delyra.feature.calendar

import app.delyra.core.model.DueCard
import app.delyra.core.model.Holiday
import app.delyra.core.model.Occurrence
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters

/** Vistas del calendario, como en la web (FullCalendar): la semana solo en anchas y 3 días en estrechas. */
enum class CalendarView(val wideOnly: Boolean = false, val narrowOnly: Boolean = false) {
    Agenda, Day, ThreeDay(narrowOnly = true), Week(wideOnly = true), Month, Year;

    fun allowed(narrow: Boolean) = !(narrow && wideOnly) && !(!narrow && narrowOnly)

    companion object {
        fun default(narrow: Boolean) = if (narrow) ThreeDay else Week

        fun restore(saved: String?, narrow: Boolean): CalendarView {
            val view = entries.firstOrNull { it.name == saved } ?: return default(narrow)
            return if (view.allowed(narrow)) view else default(narrow)
        }
    }
}

/** Intervalo de días `[start, end)` en la zona de la cuenta. */
data class DateRange(val start: LocalDate, val end: LocalDate) {
    val days: List<LocalDate> get() = generateSequence(start) { it.plusDays(1) }.takeWhile { it < end }.toList()

    fun fromInstant(zone: ZoneId): String = start.atStartOfDay(zone).toInstant().toString()
    fun toInstant(zone: ZoneId): String = end.atStartOfDay(zone).toInstant().toString()

    operator fun contains(date: LocalDate) = date >= start && date < end
}

/** Semana que empieza en `weekStart` (0 = domingo … 6 = sábado, como `user_settings.weekStart`). */
fun LocalDate.startOfWeek(weekStart: Int): LocalDate {
    val first = if (weekStart == 0) DayOfWeek.SUNDAY else DayOfWeek.of(weekStart.coerceIn(1, 6))
    return with(TemporalAdjusters.previousOrSame(first))
}

fun weekDays(weekStart: Int): List<DayOfWeek> {
    val first = if (weekStart == 0) DayOfWeek.SUNDAY else DayOfWeek.of(weekStart.coerceIn(1, 6))
    return (0 until 7).map { first.plus(it.toLong()) }
}

/** Días que pinta cada vista para la fecha [anchor]. */
fun CalendarView.range(anchor: LocalDate, weekStart: Int): DateRange = when (this) {
    CalendarView.Day -> DateRange(anchor, anchor.plusDays(1))
    CalendarView.ThreeDay -> DateRange(anchor, anchor.plusDays(3))
    CalendarView.Week -> anchor.startOfWeek(weekStart).let { DateRange(it, it.plusDays(7)) }
    CalendarView.Month -> anchor.withDayOfMonth(1).startOfWeek(weekStart).let { DateRange(it, it.plusDays(42)) }
    CalendarView.Year -> anchor.withDayOfYear(1).let { DateRange(it, it.plusYears(1)) }
    CalendarView.Agenda -> DateRange(anchor, anchor.plusDays(AGENDA_DAYS))
}

/** Fecha de referencia de la página [offset] respecto a [anchor] (deslizar entre periodos). */
fun CalendarView.shift(anchor: LocalDate, offset: Int): LocalDate = when (this) {
    CalendarView.Day -> anchor.plusDays(offset.toLong())
    CalendarView.ThreeDay -> anchor.plusDays(3L * offset)
    CalendarView.Week -> anchor.plusWeeks(offset.toLong())
    CalendarView.Month -> anchor.withDayOfMonth(1).plusMonths(offset.toLong())
    CalendarView.Year -> anchor.withDayOfYear(1).plusYears(offset.toLong())
    CalendarView.Agenda -> anchor.plusDays(AGENDA_DAYS * offset)
}

const val AGENDA_DAYS = 30L

// ── Elementos que se pintan ────────────────────────────────────────────────────

enum class ItemKind { Event, Task, Holiday }

/**
 * Un evento, una tarea con fecha límite o un festivo, ya en la zona de la cuenta. Los de día
 * completo usan [startDate] y [endDate] (exclusivo); los demás, además, [start] y [end].
 */
data class CalendarItem(
    val key: String,
    val kind: ItemKind,
    val title: String,
    val colorHex: String,
    val allDay: Boolean,
    val startDate: LocalDate,
    val endDate: LocalDate,
    val start: ZonedDateTime? = null,
    val end: ZonedDateTime? = null,
    val occurrence: Occurrence? = null,
    val task: DueCard? = null,
    val holiday: Holiday? = null,
    val readOnly: Boolean = false,
) {
    /** Días en los que aparece. */
    fun overlaps(date: LocalDate): Boolean = date >= startDate && date < endDate
}

fun parseInstant(value: String): Instant = runCatching { OffsetDateTime.parse(value).toInstant() }
    .getOrElse { Instant.parse(value) }

fun Occurrence.toItem(zone: ZoneId, color: String, readOnly: Boolean): CalendarItem {
    if (allDay) {
        val s = LocalDate.parse(start.take(10))
        val e = LocalDate.parse(end.take(10)).coerceAtLeast(s.plusDays(1))
        return CalendarItem(id, ItemKind.Event, title, color, true, s, e, occurrence = this, readOnly = readOnly)
    }
    val s = parseInstant(start).atZone(zone)
    val e = parseInstant(end).atZone(zone)
    // Termina a medianoche: no ocupa el día siguiente.
    val lastDay = if (e.toLocalTime() == LocalTime.MIDNIGHT && e.toLocalDate() > s.toLocalDate()) e.toLocalDate() else e.toLocalDate().plusDays(1)
    return CalendarItem(id, ItemKind.Event, title, color, false, s.toLocalDate(), lastDay, s, e, occurrence = this, readOnly = readOnly)
}

/** Tareas: las de todo el día van arriba; las de hora, como un bloque de 30 minutos. */
fun DueCard.toItem(zone: ZoneId, color: String): CalendarItem {
    if (due.allDay) {
        val date = LocalDate.parse(due.at.take(10))
        return CalendarItem("task:$id", ItemKind.Task, title, color, true, date, date.plusDays(1), task = this, readOnly = true)
    }
    val s = parseInstant(due.at).atZone(zone)
    return CalendarItem(
        "task:$id", ItemKind.Task, title, color, false, s.toLocalDate(), s.toLocalDate().plusDays(1),
        s, s.plusMinutes(30), task = this, readOnly = true,
    )
}

fun Holiday.toItem(color: String): CalendarItem {
    val date = LocalDate.parse(date)
    return CalendarItem("holiday:${this.date}:$name", ItemKind.Holiday, name, color, true, date, date.plusDays(1), holiday = this, readOnly = true)
}

/** Orden dentro de un día: de día completo primero, luego por hora y los largos antes. */
val ItemOrder: Comparator<CalendarItem> = compareBy<CalendarItem>(
    { !it.allDay },
    { it.kind != ItemKind.Holiday },
    { it.start?.toInstant() ?: Instant.MIN },
    { -(it.end?.toEpochSecond() ?: 0) },
    { it.title },
)

// ── Rejilla horaria ────────────────────────────────────────────────────────────

/** Tramo de un elemento con hora dentro de un día: minutos desde las 00:00 (hora local). */
data class DaySegment(val item: CalendarItem, val startMinute: Int, val endMinute: Int, val column: Int = 0, val columns: Int = 1)

fun segmentFor(item: CalendarItem, date: LocalDate): DaySegment? {
    val s = item.start ?: return null
    val e = item.end ?: return null
    if (item.allDay || !item.overlaps(date)) return null
    val startMinute = if (s.toLocalDate() < date) 0 else s.toLocalTime().toSecondOfDay() / 60
    val endMinute = if (e.toLocalDate() > date) MINUTES_PER_DAY else e.toLocalTime().toSecondOfDay() / 60
    if (endMinute <= startMinute && e.toLocalDate() == date) return DaySegment(item, startMinute, startMinute + 15)
    return DaySegment(item, startMinute, endMinute.coerceAtLeast(startMinute + 15))
}

/**
 * Reparte en columnas los elementos que se solapan (como FullCalendar): cada grupo de solapes
 * comparte el ancho a partes iguales y cada elemento va en la primera columna libre.
 */
fun layoutDay(segments: List<DaySegment>): List<DaySegment> {
    val sorted = segments.sortedWith(compareBy({ it.startMinute }, { -(it.endMinute - it.startMinute) }))
    val result = mutableListOf<DaySegment>()
    var cluster = mutableListOf<DaySegment>()
    var columnsEnd = mutableListOf<Int>()
    var clusterEnd = -1

    fun flush() {
        val count = columnsEnd.size.coerceAtLeast(1)
        cluster.forEach { result += it.copy(columns = count) }
        cluster = mutableListOf()
        columnsEnd = mutableListOf()
    }

    for (segment in sorted) {
        if (segment.startMinute >= clusterEnd && cluster.isNotEmpty()) flush()
        val free = columnsEnd.indexOfFirst { it <= segment.startMinute }
        val column = if (free >= 0) free else columnsEnd.size
        if (free >= 0) columnsEnd[free] = segment.endMinute else columnsEnd += segment.endMinute
        cluster += segment.copy(column = column)
        clusterEnd = maxOf(clusterEnd, segment.endMinute)
    }
    if (cluster.isNotEmpty()) flush()
    return result
}

const val MINUTES_PER_DAY = 24 * 60

/** Hora redondeada a la media hora siguiente (para crear un evento «ahora»). */
fun nextHalfHour(now: ZonedDateTime): ZonedDateTime {
    val base = now.truncatedTo(ChronoUnit.HOURS)
    return if (now.minute < 30) base.plusMinutes(30) else base.plusHours(1)
}
