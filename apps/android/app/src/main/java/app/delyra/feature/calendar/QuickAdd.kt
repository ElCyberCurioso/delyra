package app.delyra.feature.calendar

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.temporal.TemporalAdjusters

/** Borrador del alta rápida: como `QuickDraft` de `packages/shared/src/quick-add.ts`. */
data class QuickDraft(
    val title: String,
    val allDay: Boolean,
    val date: LocalDate,
    val startTime: LocalTime?,
    val endTime: LocalTime?,
)

/** Horas del formulario del editor (día completo: el mismo día). */
fun QuickDraft.formTimes(): FormTimes {
    val start = startTime?.let { it.hour * 60 + it.minute } ?: 0
    val end = endTime?.let { it.hour * 60 + it.minute } ?: start
    return FormTimes(allDay, date, start, date, end)
}

/**
 * Alta rápida en lenguaje natural (F2-12 en la web, F8-07 aquí): «Dentista mañana 17:30», «Yoga
 * hoy de 18 a 19», «Dinner on Friday at 9pm». La web usa chrono-node; aquí hay un analizador propio
 * con las mismas reglas para lo que se escribe o se dicta a diario, y la prueba `QuickAddTest`
 * comprueba que da lo mismo que la web en el corpus `quick-add-cases.json` (generado por la web).
 *
 * Reglas de chrono que se respetan: «el 12/12» es día/mes en español y mes/día en inglés; lo que
 * no tiene fecha explícita (día de la semana, día y mes sin año, solo hora) se pasa al futuro si ya
 * ha pasado, contando como hora el mediodía si no la lleva; «hoy» y «mañana» no se mueven.
 */
object QuickAdd {
    private const val MAX_LENGTH = 200
    private const val L = """(?<![\p{L}\d])"""
    private const val R = """(?![\p{L}\d])"""
    private val I = setOf(RegexOption.IGNORE_CASE)

    /**
     * @param reference «ahora» en la zona de la cuenta.
     * @param english frases en inglés (la app en inglés); si no, en español.
     */
    fun parse(text: String, reference: LocalDateTime, english: Boolean): QuickDraft? {
        var rest = text.take(MAX_LENGTH).trim()
        if (rest.isEmpty()) return null
        if (!english) rest = normalizeSpanish(rest, reference.toLocalDate())

        var start: LocalTime? = null
        var end: LocalTime? = null
        (if (english) RANGE_EN else RANGE_ES).find(rest)?.let { m ->
            val s = time(m.groupValues[1], m.groupValues[2])
            val e = time(m.groupValues[3], m.groupValues[4])
            if (s != null && e != null) {
                start = s
                end = e
                rest = rest.replaceRange(m.range, " ")
            }
        }

        val date = findDate(rest, reference.toLocalDate(), english)
        if (date != null) rest = rest.replaceRange(date.range, " ")
        val clock = if (start == null) findTime(rest, english) else null
        if (clock != null) {
            start = clock.start
            end = clock.end
            rest = rest.replaceRange(clock.range, " ")
        }
        if (date == null && clock == null && start == null) return null

        val day = when {
            date != null -> date.resolve(reference, clock?.start ?: LocalTime.NOON)
            clock != null -> reference.toLocalDate().let { if (it.atTime(clock.start).isBefore(reference)) it.plusDays(1) else it }
            else -> reference.toLocalDate()
        }
        val from = start
        if (from != null && end == null) {
            end = if (from.hour + 1 > 23) LocalTime.of(23, 59) else LocalTime.of(from.hour + 1, from.minute)
        }
        return QuickDraft(
            title = cleanTitle(rest, english).ifEmpty { if (english) "New event" else "Nuevo evento" },
            allDay = from == null,
            date = day,
            startTime = from,
            endTime = if (from == null) null else end,
        )
    }

    // ── Rangos («de 10 a 11:30», «from 18 to 19»): los mismos que la web ──

    private val RANGE_ES = Regex(
        """(?:\bde\s+)?(?:las\s+)?(?<![\d/:.])\b(\d{1,2})(?:[:.](\d{2}))?(?:\s*h)?\s*(?:a|hasta|-|–)\s*(?:las\s+)?(\d{1,2})(?:[:.](\d{2}))?(?:\s*h)?\b""",
        I,
    )
    private val RANGE_EN = Regex(
        """(?:\bfrom\s+)?(?<![\d/:.])\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:to|until|till|-|–)\s*(\d{1,2})(?:[:.](\d{2}))?\b(?!\s*(?:am|pm))""",
        I,
    )

    private fun time(hour: String, minute: String, meridiem: String? = null): LocalTime? {
        var h = hour.toIntOrNull() ?: return null
        val m = minute.ifEmpty { "0" }.toIntOrNull() ?: return null
        val mer = meridiem?.lowercase()?.filter { it == 'a' || it == 'p' }?.takeIf { it.isNotEmpty() }
        if (mer != null) {
            if (h !in 1..12) return null
            h = when {
                mer == "p" && h < 12 -> h + 12
                mer == "a" && h == 12 -> 0
                else -> h
            }
        }
        return if (h in 0..23 && m in 0..59) LocalTime.of(h, m) else null
    }

    // ── Español hablado: lo mismo que `normalizeSpanish` de la web ──

    private val HOUR_WORDS = mapOf(
        "una" to 1, "dos" to 2, "tres" to 3, "cuatro" to 4, "cinco" to 5, "seis" to 6,
        "siete" to 7, "ocho" to 8, "nueve" to 9, "diez" to 10, "once" to 11, "doce" to 12,
    )
    private val WORD = HOUR_WORDS.keys.joinToString("|")
    private const val PART = "(mañana|madrugada|tarde|noche)"
    private val N_WORDS_AT = Regex("""\b(a\s+las?)\s+($WORD)\b""", I)
    private val N_WORDS_RANGE = Regex("""\bde\s+($WORD)\s+a\s+($WORD)\b""", I)
    private val N_H_MIN = Regex("""(?<![\d:.])(\d{1,2})h(\d{2})\b""", I)
    private val N_HHMM_H = Regex("""(?<![\d:.])(\d{1,2}[:.]\d{2})\s?h\b""", I)
    private val N_H = Regex("""(?<![\d:.])(\d{1,2})\s?h\b""", I)
    private val N_HALF = Regex("""(?<![\d:.])(\d{1,2})(?:[:.]00)?\s+y\s+media\b""", I)
    private val N_QUARTER = Regex("""(?<![\d:.])(\d{1,2})(?:[:.]00)?\s+y\s+cuarto\b""", I)
    private val N_TO_QUARTER = Regex("""(?<![\d:.])(\d{1,2})(?:[:.]00)?\s+menos\s+cuarto\b""", I)
    private val N_PART_RANGE = Regex("""(?<![\d:.])(\d{1,2})(?:[:.](\d{2}))?\s+a\s+(\d{1,2})(?:[:.](\d{2}))?\s+de\s+la\s+$PART""", I)
    private val N_PART = Regex("""(?<![\d:.])(\d{1,2})(?:[:.](\d{2}))?\s+de\s+la\s+$PART""", I)
    private val N_NOON = Regex("""\b(?:al|a)\s+mediod[ií]a\b""", I)
    private val N_MIDNIGHT = Regex("""\b(?:a\s+)?(?:la\s+)?medianoche\b""", I)
    private val N_COMING = Regex("""\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+que\s+viene\b""", I)
    private val N_AFTER_TOMORROW = Regex("""\bpasado\s+mañana\b""", I)
    private val N_SEPT = Regex("""\bsept\b\.?""", I)

    private fun hourWord(word: String) = (HOUR_WORDS[word.lowercase()] ?: word).toString()

    private fun dayPartHour(hour: Int, part: String): Int = when (part.lowercase()) {
        "tarde", "noche" -> if (hour == 12) (if (part.lowercase() == "noche") 0 else 12) else if (hour < 12) hour + 12 else hour
        else -> if (hour == 12 && part.lowercase() == "madrugada") 0 else hour
    }

    private fun hhmm(hour: Int, minute: Int) = "$hour:${minute.toString().padStart(2, '0')}"

    internal fun normalizeSpanish(text: String, today: LocalDate): String {
        var s = text
        s = N_WORDS_AT.replace(s) { "${it.groupValues[1]} ${hourWord(it.groupValues[2])}" }
        s = N_WORDS_RANGE.replace(s) { "de ${hourWord(it.groupValues[1])} a ${hourWord(it.groupValues[2])}" }
        s = N_H_MIN.replace(s) { "${it.groupValues[1]}:${it.groupValues[2]}" }
        s = N_HHMM_H.replace(s) { it.groupValues[1] }
        s = N_H.replace(s) { "${it.groupValues[1]}:00" }
        s = N_HALF.replace(s) { hhmm(it.groupValues[1].toInt(), 30) }
        s = N_QUARTER.replace(s) { hhmm(it.groupValues[1].toInt(), 15) }
        s = N_TO_QUARTER.replace(s) { m -> m.groupValues[1].toInt().let { hhmm(if (it <= 1) 12 else it - 1, 45) } }
        s = N_PART_RANGE.replace(s) { m ->
            val g = m.groupValues
            val minute = { v: String -> v.ifEmpty { "0" }.toInt() }
            "${hhmm(dayPartHour(g[1].toInt(), g[5]), minute(g[2]))} a ${hhmm(dayPartHour(g[3].toInt(), g[5]), minute(g[4]))}"
        }
        s = N_PART.replace(s) { m -> hhmm(dayPartHour(m.groupValues[1].toInt(), m.groupValues[3]), m.groupValues[2].ifEmpty { "0" }.toInt()) }
        s = N_NOON.replace(s, "a las 12:00")
        s = N_MIDNIGHT.replace(s, "a las 0:00")
        s = N_COMING.replace(s) { it.groupValues[1] }
        s = N_AFTER_TOMORROW.replace(s) {
            val day = today.plusDays(2)
            "el ${day.dayOfMonth}/${day.monthValue}/${day.year}"
        }
        s = N_SEPT.replace(s, "sep")
        return s
    }

    // ── Fechas ──

    private sealed interface Kind {
        /** «hoy», «mañana», «in 2 days»: no se mueve. */
        data class Relative(val days: Long) : Kind
        data class Weekday(val day: DayOfWeek) : Kind
        /** Día y mes; sin año, se pasa al año siguiente si ya pasó. */
        data class Calendar(val month: Int, val day: Int, val year: Int?) : Kind
    }

    private class DateMatch(val range: IntRange, val kind: Kind) {
        fun resolve(reference: LocalDateTime, at: LocalTime): LocalDate {
            val today = reference.toLocalDate()
            return when (kind) {
                is Kind.Relative -> today.plusDays(kind.days)
                is Kind.Weekday -> today.with(TemporalAdjusters.nextOrSame(kind.day)).let { if (it.atTime(at).isBefore(reference)) it.plusWeeks(1) else it }
                is Kind.Calendar -> {
                    val date = dateIn(kind.year ?: today.year, kind.month, kind.day)
                    if (kind.year == null && date.atTime(at).isBefore(reference)) dateIn(date.year + 1, kind.month, kind.day) else date
                }
            }
        }
    }

    /** El primer año desde [year] en que existe la fecha (el 29 de febrero, el siguiente bisiesto). */
    private fun dateIn(year: Int, month: Int, day: Int): LocalDate =
        generateSequence(year) { it + 1 }.take(8).firstNotNullOfOrNull { runCatching { LocalDate.of(it, month, day) }.getOrNull() }
            ?: LocalDate.of(year, month, 1)

    private val MONTHS_ES = listOf(
        "enero|ene", "febrero|feb", "marzo|mar", "abril|abr", "mayo|may", "junio|jun",
        "julio|jul", "agosto|ago", "septiembre|setiembre|sep", "octubre|oct", "noviembre|nov", "diciembre|dic",
    )
    private val MONTHS_EN = listOf(
        "january|jan", "february|feb", "march|mar", "april|apr", "may", "june|jun",
        "july|jul", "august|aug", "september|sept|sep", "october|oct", "november|nov", "december|dec",
    )
    private val WEEKDAYS_ES = listOf("lunes", "martes", "mi[eé]rcoles", "jueves", "viernes", "s[aá]bado", "domingo")
    private val WEEKDAYS_EN = listOf("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
    private val WEEKDAYS_EN_SHORT = listOf("mon", "tue|tues", "wed", "thu|thur|thurs", "fri", "sat", "sun")

    private fun monthAlternatives(months: List<String>) = months.joinToString("|") { "(?:$it)" }
    private fun monthOf(name: String, months: List<String>): Int? {
        val lower = name.lowercase().trimEnd('.')
        return months.indexOfFirst { group -> group.split('|').any { it == lower } }.takeIf { it >= 0 }?.plus(1)
    }
    private fun weekdayOf(name: String, patterns: List<String>): DayOfWeek? =
        patterns.indexOfFirst { Regex("^(?:$it)$", I).matches(name) }.takeIf { it >= 0 }?.let { DayOfWeek.of(it + 1) }

    private val MONTH_ES = monthAlternatives(MONTHS_ES)
    private val MONTH_EN = monthAlternatives(MONTHS_EN)
    private val WEEKDAY_ES = WEEKDAYS_ES.joinToString("|")
    private val WEEKDAY_EN = WEEKDAYS_EN.joinToString("|")
    private val WEEKDAY_EN_SHORT = WEEKDAYS_EN_SHORT.joinToString("|")

    private val ES_CALENDAR = Regex(
        """$L(?:(?:el|este|pr[oó]ximo)\s+)?(?:(?:$WEEKDAY_ES)\s+)?(?:(?:el|d[ií]a)\s+)*(\d{1,2})\s+(?:de\s+)?($MONTH_ES)\.?(?:\s+(?:de\s+|del\s+)?(\d{4}))?$R""",
        I,
    )
    private val ES_NUMERIC = Regex("""$L(?:el\s+)?(?:d[ií]a\s+)?(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2}))?$R""", I)
    private val ES_RELATIVE = Regex("""$L(mañana|hoy)$R""", I)
    private val ES_WEEKDAY = Regex("""$L(?:(?:el|este|pr[oó]ximo)\s+)*($WEEKDAY_ES)$R""", I)

    private val EN_MONTH_DAY = Regex(
        """$L(?:on\s+)?(?:(?:$WEEKDAY_EN),?\s+)?($MONTH_EN)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$R""",
        I,
    )
    private val EN_DAY_MONTH = Regex(
        """$L(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?($MONTH_EN)\.?(?:,?\s+(\d{4}))?$R""",
        I,
    )
    private val EN_NUMERIC = Regex("""$L(?:on\s+)?(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2}))?$R""", I)
    private val EN_RELATIVE = Regex(
        """$L(?:(?:the\s+)?day\s+after\s+tomorrow|tomorrow|today|tonight)(?:\s+(?:morning|afternoon|evening|night))?$R""",
        I,
    )
    private val EN_IN_DAYS = Regex("""${L}in\s+(\d{1,2})\s+(days?|weeks?)$R""", I)
    private val EN_WEEKDAY = Regex("""$L(?:(?:on|next|this)\s+)*($WEEKDAY_EN)$R""", I)
    private val EN_WEEKDAY_SHORT = Regex("""$L(?:on|next|this)\s+($WEEKDAY_EN_SHORT)$R""", I)

    private fun year(text: String?): Int? = text?.takeIf { it.isNotEmpty() }?.toInt()?.let { if (it < 100) 2000 + it else it }

    private fun calendar(range: IntRange, month: Int?, day: Int?, year: Int?): DateMatch? {
        if (month == null || day == null) return null
        // Fechas imposibles («31/2») no cuentan, como en chrono.
        val valid = runCatching { LocalDate.of(year ?: 2024, month, day) }.isSuccess
        return if (valid) DateMatch(range, Kind.Calendar(month, day, year)) else null
    }

    private fun findDate(text: String, today: LocalDate, english: Boolean): DateMatch? {
        val found = mutableListOf<DateMatch>()
        if (english) {
            EN_MONTH_DAY.findAll(text).forEach { m ->
                calendar(m.range, monthOf(m.groupValues[1], MONTHS_EN), m.groupValues[2].toInt(), year(m.groupValues[3]))?.let(found::add)
            }
            EN_DAY_MONTH.findAll(text).forEach { m ->
                calendar(m.range, monthOf(m.groupValues[2], MONTHS_EN), m.groupValues[1].toInt(), year(m.groupValues[3]))?.let(found::add)
            }
            EN_NUMERIC.findAll(text).forEach { m ->
                calendar(m.range, m.groupValues[1].toInt(), m.groupValues[2].toInt(), year(m.groupValues[3]))?.let(found::add)
            }
            EN_RELATIVE.findAll(text).forEach { m ->
                val lower = m.value.lowercase()
                val days = when {
                    "after" in lower -> 2L
                    "tomorrow" in lower -> 1L
                    else -> 0L
                }
                found += DateMatch(m.range, Kind.Relative(days))
            }
            EN_IN_DAYS.findAll(text).forEach { m ->
                val n = m.groupValues[1].toLong()
                found += DateMatch(m.range, Kind.Relative(if (m.groupValues[2].startsWith("week", ignoreCase = true)) n * 7 else n))
            }
            EN_WEEKDAY.findAll(text).forEach { m -> weekdayOf(m.groupValues[1], WEEKDAYS_EN)?.let { found += DateMatch(m.range, Kind.Weekday(it)) } }
            EN_WEEKDAY_SHORT.findAll(text).forEach { m -> weekdayOf(m.groupValues[1], WEEKDAYS_EN_SHORT)?.let { found += DateMatch(m.range, Kind.Weekday(it)) } }
        } else {
            ES_CALENDAR.findAll(text).forEach { m ->
                calendar(m.range, monthOf(m.groupValues[2], MONTHS_ES), m.groupValues[1].toInt(), year(m.groupValues[3]))?.let(found::add)
            }
            ES_NUMERIC.findAll(text).forEach { m ->
                calendar(m.range, m.groupValues[2].toInt(), m.groupValues[1].toInt(), year(m.groupValues[3]))?.let(found::add)
            }
            ES_RELATIVE.findAll(text).forEach { m ->
                found += DateMatch(m.range, Kind.Relative(if (m.groupValues[1].equals("hoy", ignoreCase = true)) 0 else 1))
            }
            ES_WEEKDAY.findAll(text).forEach { m -> weekdayOf(m.groupValues[1], WEEKDAYS_ES)?.let { found += DateMatch(m.range, Kind.Weekday(it)) } }
        }
        // La primera del texto; si empiezan igual («el lunes 17 de mayo»), la más larga.
        return found.minWithOrNull(compareBy<DateMatch> { it.range.first }.thenByDescending { it.range.last })
    }

    // ── Horas ──

    private class TimeMatch(val range: IntRange, val start: LocalTime, val end: LocalTime?)

    private const val MERIDIEM = """(am|pm|a\.\s?m\.|p\.\s?m\.)"""
    private val ES_HHMM = Regex("""$L(?:a\s+las?\s+)?(\d{1,2})[:.](\d{2})(?:\s*$MERIDIEM)?(?![\d])""", I)
    private val ES_HOUR = Regex("""${L}a\s+las?\s+(\d{1,2})(?:\s*$MERIDIEM)?(?![\p{L}\d:.])""", I)
    private val ES_MERIDIEM = Regex("""$L(\d{1,2})\s*$MERIDIEM""", I)
    private val EN_MERIDIEM_RANGE = Regex(
        """$L(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*$MERIDIEM?\s*(?:to|until|till|-|–)\s*(\d{1,2})(?::(\d{2}))?\s*$MERIDIEM?(?![\p{L}\d])""",
        I,
    )
    private val EN_MERIDIEM = Regex("""$L(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*$MERIDIEM""", I)
    private val EN_HHMM = Regex("""$L(?:at\s+)?(\d{1,2}):(\d{2})$R""", I)
    private val EN_HOUR = Regex("""${L}at\s+(\d{1,2})(?![\p{L}\d:])""", I)
    private val EN_NOON = Regex("""$L(?:at\s+)?(noon|midday|midnight)$R""", I)

    private fun findTime(text: String, english: Boolean): TimeMatch? {
        val found = mutableListOf<TimeMatch>()
        fun add(range: IntRange, start: LocalTime?, end: LocalTime? = null) {
            if (start != null) found += TimeMatch(range, start, end)
        }
        if (english) {
            EN_MERIDIEM_RANGE.findAll(text).forEach { m ->
                val g = m.groupValues
                val m1 = g[3].ifEmpty { null }
                val m2 = g[6].ifEmpty { null }
                if (m1 == null && m2 == null) return@forEach
                // «from 2 to 3pm»: la primera hora toma la marca de la segunda si no lleva.
                val startMer = m1 ?: m2?.takeIf { (g[1].toIntOrNull() ?: 99) <= (g[4].toIntOrNull() ?: 0) }
                add(m.range, time(g[1], g[2], startMer), time(g[4], g[5], m2 ?: m1))
            }
            EN_MERIDIEM.findAll(text).forEach { m -> add(m.range, time(m.groupValues[1], m.groupValues[2], m.groupValues[3])) }
            EN_HHMM.findAll(text).forEach { m -> add(m.range, time(m.groupValues[1], m.groupValues[2])) }
            EN_HOUR.findAll(text).forEach { m -> add(m.range, time(m.groupValues[1], "")) }
            EN_NOON.findAll(text).forEach { m ->
                add(m.range, if (m.groupValues[1].equals("midnight", ignoreCase = true)) LocalTime.MIDNIGHT else LocalTime.NOON)
            }
        } else {
            ES_HHMM.findAll(text).forEach { m -> add(m.range, time(m.groupValues[1], m.groupValues[2], m.groupValues[3].ifEmpty { null })) }
            ES_HOUR.findAll(text).forEach { m -> add(m.range, time(m.groupValues[1], "", m.groupValues[2].ifEmpty { null })) }
            ES_MERIDIEM.findAll(text).forEach { m -> add(m.range, time(m.groupValues[1], "", m.groupValues[2])) }
        }
        // Una hora de rango gana a las sueltas que contiene; si no, la primera y la más larga.
        return found.minWithOrNull(compareBy<TimeMatch> { it.range.first }.thenByDescending { it.range.last })
    }

    // ── Título ──

    private val CONNECTORS_ES = Regex("^(?:el|la|los|las|de|del|a|al|en|para|desde|hasta|y)$", I)
    private val CONNECTORS_EN = Regex("^(?:the|on|at|in|from|to|for|until|and|by)$", I)
    private val TRAILING = Regex("""[,;:\s]+$""")

    private fun cleanTitle(text: String, english: Boolean): String {
        val connectors = if (english) CONNECTORS_EN else CONNECTORS_ES
        val words = text.split(Regex("""\s+""")).filter { it.isNotEmpty() }.toMutableList()
        while (words.isNotEmpty() && connectors.matches(words.last())) words.removeAt(words.lastIndex)
        while (words.isNotEmpty() && connectors.matches(words.first())) words.removeAt(0)
        return words.joinToString(" ").replace(TRAILING, "")
    }
}
