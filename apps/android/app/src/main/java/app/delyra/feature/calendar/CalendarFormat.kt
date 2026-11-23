package app.delyra.feature.calendar

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.platform.LocalConfiguration
import java.time.LocalDate
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.util.Locale

/** Fechas y horas en el idioma de la app (los textos de la web salen de `Intl` igual). */
@Composable
@ReadOnlyComposable
fun appLocale(): Locale {
    val locales = LocalConfiguration.current.locales
    return if (locales.isEmpty) Locale.ROOT else locales[0]
}

fun String.capitalized(locale: Locale): String = replaceFirstChar { if (it.isLowerCase()) it.titlecase(locale) else it.toString() }

fun timeText(time: ZonedDateTime, locale: Locale): String =
    time.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale))

fun timeRangeText(item: CalendarItem, locale: Locale): String? {
    val s = item.start ?: return null
    val e = item.end ?: return timeText(s, locale)
    return "${timeText(s, locale)}–${timeText(e, locale)}"
}

fun longDate(date: LocalDate, locale: Locale): String =
    date.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(locale)).capitalized(locale)

fun mediumDate(date: LocalDate, locale: Locale): String =
    date.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))

fun monthTitle(date: LocalDate, locale: Locale): String =
    date.format(DateTimeFormatter.ofPattern("LLLL yyyy", locale)).capitalized(locale)

fun monthName(date: LocalDate, locale: Locale): String =
    date.month.getDisplayName(TextStyle.FULL_STANDALONE, locale).capitalized(locale)

fun weekdayShort(date: LocalDate, locale: Locale): String =
    date.dayOfWeek.getDisplayName(TextStyle.SHORT_STANDALONE, locale).trimEnd('.').capitalized(locale)

fun weekdayNarrow(day: java.time.DayOfWeek, locale: Locale): String =
    day.getDisplayName(TextStyle.NARROW_STANDALONE, locale).uppercase(locale)

/** Título de la barra superior según la vista. */
fun periodTitle(view: CalendarView, range: DateRange, anchor: LocalDate, locale: Locale): String = when (view) {
    CalendarView.Day -> longDate(anchor, locale)
    CalendarView.Month -> monthTitle(anchor, locale)
    CalendarView.Year -> anchor.year.toString()
    CalendarView.Agenda -> monthTitle(anchor, locale)
    CalendarView.ThreeDay, CalendarView.Week -> {
        val last = range.end.minusDays(1)
        val day = DateTimeFormatter.ofPattern("d", locale)
        val dayMonth = DateTimeFormatter.ofPattern("d MMM", locale)
        when {
            range.start.month == last.month -> "${range.start.format(day)}–${last.format(dayMonth)} ${last.year}"
            range.start.year == last.year -> "${range.start.format(dayMonth)} – ${last.format(dayMonth)} ${last.year}"
            else -> "${mediumDate(range.start, locale)} – ${mediumDate(last, locale)}"
        }
    }
}
