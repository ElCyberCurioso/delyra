package app.delyra.feature.calendar

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.delyra.AppGraph
import app.delyra.core.model.CalendarInfo
import app.delyra.core.model.EventDetail
import app.delyra.core.network.ApiError
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import app.delyra.navigation.EventEditorRoute
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/** Horas del formulario: fechas y minutos desde las 00:00 (fin inclusivo en día completo). */
data class FormTimes(val allDay: Boolean, val startDate: LocalDate, val startMinutes: Int, val endDate: LocalDate, val endMinutes: Int) {
    fun startDateTime(): LocalDateTime = startDate.atTime(LocalTime.ofSecondOfDay(startMinutes * 60L))
    fun endDateTime(): LocalDateTime = endDate.atTime(LocalTime.ofSecondOfDay(endMinutes.coerceAtMost(MINUTES_PER_DAY - 1) * 60L))
}

/** Lo que espera la API: `AAAA-MM-DD` (fin exclusivo) o instantes ISO. */
data class ApiTimes(val allDay: Boolean, val start: String, val end: String)

fun FormTimes.toApi(zone: ZoneId): ApiTimes = if (allDay) {
    ApiTimes(true, startDate.toString(), endDate.plusDays(1).toString())
} else {
    ApiTimes(
        false,
        startDateTime().atZone(zone).toInstant().truncatedTo(ChronoUnit.SECONDS).toString(),
        endDateTime().atZone(zone).toInstant().truncatedTo(ChronoUnit.SECONDS).toString(),
    )
}

fun formTimesOf(allDay: Boolean, start: String, end: String, zone: ZoneId): FormTimes = if (allDay) {
    val s = LocalDate.parse(start.take(10))
    val e = LocalDate.parse(end.take(10)).minusDays(1).coerceAtLeast(s)
    FormTimes(true, s, 9 * 60, e, 10 * 60)
} else {
    val s = parseInstant(start).atZone(zone)
    val e = parseInstant(end).atZone(zone)
    FormTimes(false, s.toLocalDate(), s.toLocalTime().toSecondOfDay() / 60, e.toLocalDate(), e.toLocalTime().toSecondOfDay() / 60)
}

/**
 * Editor de eventos (F8-03): mismo comportamiento que `event-editor.tsx` de la web, incluidos los
 * cumpleaños y el alcance «este / este y los siguientes / todos» de las series.
 */
class EventEditorViewModel(private val graph: AppGraph, private val route: EventEditorRoute) : ViewModel() {
    private val api = graph.calendarApi
    val zone: ZoneId = graph.session.active?.zone ?: ZoneId.systemDefault()
    val editing: Boolean = route.eventId != null
    val recurringOccurrence: Boolean = route.recurring

    var loading by mutableStateOf(editing)
        private set
    var loadError by mutableStateOf<ApiError?>(null)
        private set
    var calendars by mutableStateOf<List<CalendarInfo>>(emptyList())
        private set
    var detail by mutableStateOf<EventDetail?>(null)
        private set

    var birthday by mutableStateOf(route.birthday)
    var title by mutableStateOf("")
    var calendarId by mutableStateOf<String?>(null)
    var times by mutableStateOf(defaultTimes())
    var repeat by mutableStateOf(RepeatState())
    val reminders = mutableStateListOf<Int>()
    var location by mutableStateOf("")
    var url by mutableStateOf("")
    var notes by mutableStateOf("")
    var birthYear by mutableStateOf("")
    var feb29Rule by mutableStateOf("feb28")

    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<ApiError?>(null)
    var localError by mutableStateOf<Int?>(null)
    var done by mutableStateOf(false)
        private set

    private var initialTimes: FormTimes? = null

    init {
        viewModelScope.launch {
            apiCall { api.calendars() }.onSuccess { response ->
                calendars = response.calendars.sortedBy { it.position }
                if (calendarId == null) calendarId = defaultCalendar(birthday)?.id
            }.onFailure { loadError = it.apiError }
            if (route.eventId != null) load(route.eventId)
        }
        if (!editing && birthday) reminders.addAll(BIRTHDAY_REMINDERS)
    }

    private fun defaultTimes(): FormTimes {
        val date = route.date?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: LocalDate.now(zone)
        val start = route.minutes ?: 9 * 60
        val end = (start + 60).coerceAtMost(MINUTES_PER_DAY - 1)
        return FormTimes(route.allDay || route.birthday, date, start, date, end)
    }

    fun defaultCalendar(birthday: Boolean): CalendarInfo? {
        val writable = calendars.filter { !it.readOnly }
        return if (birthday) writable.firstOrNull { it.kind == "birthdays" } ?: writable.firstOrNull() else writable.firstOrNull { it.kind == "personal" } ?: writable.firstOrNull()
    }

    private suspend fun load(id: String) {
        loading = true
        apiCall { api.event(id) }.onSuccess { response ->
            val event = response.event
            detail = event
            birthday = event.type == "birthday"
            title = event.title
            calendarId = event.calendarId
            val start = route.start ?: event.start
            val end = route.end ?: event.end
            val form = formTimesOf(event.allDay, start, end, zone)
            times = form
            initialTimes = form
            repeat = repeatStateOf(event.rrule, form.startDate)
            reminders.clear()
            reminders.addAll(event.reminders.map { it.offsetMinutes })
            location = event.location.orEmpty()
            url = event.url.orEmpty()
            notes = event.notes.orEmpty()
            birthYear = event.birthYear?.toString().orEmpty()
            feb29Rule = event.feb29Rule ?: "feb28"
        }.onFailure { loadError = it.apiError }
        loading = false
    }

    fun switchType(toBirthday: Boolean) {
        if (editing || birthday == toBirthday) return
        birthday = toBirthday
        calendarId = defaultCalendar(toBirthday)?.id
        reminders.clear()
        if (toBirthday) {
            reminders.addAll(BIRTHDAY_REMINDERS)
            times = times.copy(allDay = true, endDate = times.startDate)
            repeat = RepeatState()
        }
    }

    fun setAllDay(allDay: Boolean) {
        times = times.copy(allDay = allDay)
        reminders.clear()
    }

    /** Cambiar el inicio mueve el fin para conservar la duración, como en la web. */
    fun setStart(date: LocalDate = times.startDate, minutes: Int = times.startMinutes) {
        val old = times
        val duration = Duration.between(old.startDateTime(), old.endDateTime())
        val newStart = date.atTime(LocalTime.ofSecondOfDay(minutes * 60L))
        val newEnd = newStart.plus(duration)
        times = old.copy(
            startDate = date,
            startMinutes = minutes,
            endDate = if (birthday) date else newEnd.toLocalDate(),
            endMinutes = newEnd.toLocalTime().toSecondOfDay() / 60,
        )
    }

    fun setEnd(date: LocalDate = times.endDate, minutes: Int = times.endMinutes) {
        times = times.copy(endDate = date, endMinutes = minutes)
    }

    fun validate(): Int? {
        if (title.isBlank()) return app.delyra.R.string.event_error_title
        if (calendarId == null) return app.delyra.R.string.event_error_calendar
        val t = times
        if (t.allDay) {
            if (t.endDate < t.startDate) return app.delyra.R.string.event_error_end
        } else if (!t.endDateTime().isAfter(t.startDateTime())) {
            return app.delyra.R.string.event_error_end
        }
        if (url.isNotBlank() && !Regex("^https?://\\S+$", RegexOption.IGNORE_CASE).matches(url.trim())) {
            return app.delyra.R.string.event_error_url
        }
        if (repeat.preset == RepeatPreset.Custom && repeat.custom.isNotBlank() && !Regex("^[A-Za-z0-9=;,+-]+$").matches(repeat.custom.trim())) {
            return app.delyra.R.string.event_error_rrule
        }
        return null
    }

    /** ¿Hace falta preguntar el alcance? Solo al cambiar una ocurrencia de una serie. */
    val needsScope: Boolean get() = editing && recurringOccurrence && !birthday

    fun save(scope: String = "all") {
        val problem = validate()
        localError = problem
        if (problem != null || busy) return
        busy = true
        error = null
        val api = this.api
        viewModelScope.launch {
            val times = this@EventEditorViewModel.times.let { if (birthday) it.copy(allDay = true, endDate = it.startDate) else it }.toApi(zone)
            val rrule = if (birthday) null else repeat.toRrule(this@EventEditorViewModel.times.startDate)
            val result = if (!editing) {
                apiCall {
                    api.createEvent(buildJsonObject {
                        put("type", JsonPrimitive(if (birthday) "birthday" else "event"))
                        common(this)
                        putTimes(this, times)
                        put("tz", JsonPrimitive(zone.id))
                        if (rrule != null) put("rrule", JsonPrimitive(rrule))
                        put("reminders", reminderArray())
                    })
                }
            } else {
                val id = route.eventId!!
                val body = buildJsonObject {
                    put("scope", JsonPrimitive(scope))
                    if (needsScope && scope != "all") route.occurrenceStart?.let { put("occurrenceStart", JsonPrimitive(it)) }
                    common(this)
                    when {
                        !needsScope || scope == "following" -> {
                            putTimes(this, times)
                            if (!birthday) put("rrule", rrule?.let(::JsonPrimitive) ?: JsonNull)
                            put("reminders", reminderArray())
                        }
                        scope == "this" -> putTimes(this, times)
                        else -> {
                            seriesTimes(times)?.let { putTimes(this, it) }
                            if (rrule != detail?.rrule) put("rrule", rrule?.let(::JsonPrimitive) ?: JsonNull)
                            put("reminders", reminderArray())
                        }
                    }
                }
                apiCall { api.updateEvent(id, body) }
            }
            result.onSuccess {
                graph.changes.calendarChanged()
                done = true
            }.onFailure { error = it.apiError }
            busy = false
        }
    }

    fun delete(scope: String) {
        val id = route.eventId ?: return
        busy = true
        viewModelScope.launch {
            apiCall { api.deleteEvent(id, scope, route.occurrenceStart.takeIf { scope != "all" && recurringOccurrence }) }
                .onSuccess {
                    graph.changes.calendarChanged()
                    done = true
                }.onFailure { error = it.apiError }
            busy = false
        }
    }

    private fun common(builder: kotlinx.serialization.json.JsonObjectBuilder) = with(builder) {
        put("calendarId", JsonPrimitive(calendarId))
        put("title", JsonPrimitive(title.trim()))
        put("notes", JsonPrimitive(notes))
        put("location", JsonPrimitive(location))
        put("url", JsonPrimitive(url.trim()))
        if (birthday) {
            put("birthYear", birthYear.toIntOrNull()?.let(::JsonPrimitive) ?: JsonNull)
            val feb29 = times.startDate.monthValue == 2 && times.startDate.dayOfMonth == 29
            put("feb29Rule", if (feb29) JsonPrimitive(feb29Rule) else JsonNull)
        }
    }

    private fun putTimes(builder: kotlinx.serialization.json.JsonObjectBuilder, t: ApiTimes) = with(builder) {
        put("allDay", JsonPrimitive(t.allDay))
        put("start", JsonPrimitive(t.start))
        put("end", JsonPrimitive(t.end))
    }

    private fun reminderArray() = JsonArray(reminders.distinct().map { JsonObject(mapOf("offsetMinutes" to JsonPrimitive(it))) })

    /**
     * «Todos» desde una ocurrencia: si se cambió su fecha u hora, se desplaza toda la serie lo mismo
     * (en hora local, para respetar el cambio de horario) con la duración nueva.
     */
    private fun seriesTimes(times: ApiTimes): ApiTimes? {
        val before = initialTimes ?: return null
        val master = detail ?: return null
        if (before.toApi(zone) == times) return null
        val now = this.times
        val masterForm = formTimesOf(master.allDay, master.start, master.end, zone)
        return if (now.allDay) {
            val shift = ChronoUnit.DAYS.between(before.startDate, now.startDate)
            val length = ChronoUnit.DAYS.between(now.startDate, now.endDate)
            val start = masterForm.startDate.plusDays(shift)
            FormTimes(true, start, 0, start.plusDays(length), 0).toApi(zone)
        } else {
            val delta = Duration.between(before.startDateTime(), now.startDateTime())
            val duration = Duration.between(now.startDateTime(), now.endDateTime())
            val start = masterForm.startDateTime().plus(delta)
            val end = start.plus(duration)
            ApiTimes(
                false,
                start.atZone(zone).toInstant().truncatedTo(ChronoUnit.SECONDS).toString(),
                end.atZone(zone).toInstant().truncatedTo(ChronoUnit.SECONDS).toString(),
            )
        }
    }
}
