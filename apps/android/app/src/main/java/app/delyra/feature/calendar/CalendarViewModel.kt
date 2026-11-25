package app.delyra.feature.calendar

import android.content.ContentResolver
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.delyra.AppGraph
import app.delyra.R
import app.delyra.core.model.CalendarFeed
import app.delyra.core.model.CalendarInfo
import app.delyra.core.model.CreateCalendarRequest
import app.delyra.core.model.DueCard
import app.delyra.core.model.Holiday
import app.delyra.core.model.HolidayRegionRequest
import app.delyra.core.model.Occurrence
import app.delyra.core.network.ApiError
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.io.IOException
import java.time.LocalDate
import java.time.ZoneId

/** Lo que la API devolvió para un rango (sin filtrar: los filtros se aplican al pintar). */
data class RawRange(
    val occurrences: List<Occurrence> = emptyList(),
    val holidays: List<Holiday> = emptyList(),
    val tasks: List<DueCard> = emptyList(),
    val loading: Boolean = true,
    val error: ApiError? = null,
    /** Versión de los datos que contiene y de la última petición lanzada. */
    val version: Int = -1,
    val requested: Int = -1,
)

data class RangeData(val items: List<CalendarItem>, val loading: Boolean, val error: ApiError?)

/** Color de la capa de tareas y de los festivos (como en la web). */
const val TASK_COLOR = "#f59e0b"
const val HOLIDAY_COLOR = "#eb5757"

/**
 * Estado del calendario (F8-03). Cada página del deslizador pide su rango con [ensure]; las
 * respuestas se guardan por rango y se descartan si llegan después de un cambio ([invalidate]):
 * así una respuesta vieja nunca pisa a una nueva.
 */
class CalendarViewModel(private val graph: AppGraph) : ViewModel() {
    private val api = graph.calendarApi

    val zone: ZoneId get() = graph.session.active?.zone ?: ZoneId.systemDefault()
    val weekStart: Int get() = graph.session.active?.settings?.weekStart ?: 1
    val today: LocalDate get() = LocalDate.now(zone)

    var calendars by mutableStateOf<List<CalendarInfo>>(emptyList())
        private set
    var calendarsError by mutableStateOf<ApiError?>(null)
        private set
    var view by mutableStateOf<CalendarView?>(null)
        private set
    var anchor by mutableStateOf(LocalDate.now(zone))
    var showHolidays by mutableStateOf(true)
        private set
    var showTasks by mutableStateOf(true)
        private set
    var selected by mutableStateOf<CalendarItem?>(null)
    var message by mutableStateOf<ApiError?>(null)
    /** Aviso breve (texto de recursos), p. ej. tras exportar. */
    var notice by mutableStateOf<Int?>(null)
    /** Región de los festivos (`off`, `ES`, `ES-MD`…), la que devuelve la API con los festivos. */
    var holidayRegion by mutableStateOf<String?>(null)
        private set

    /** Sube con cada cambio: las páginas vuelven a pedir su rango. */
    var dataVersion by mutableIntStateOf(0)
        private set

    private val raw = mutableStateMapOf<DateRange, RawRange>()
    private var savedView: String? = null

    init {
        loadCalendars()
        viewModelScope.launch { graph.preferences.layers.collect { (h, t) -> showHolidays = h; showTasks = t } }
        // Un cambio de otra pantalla (eventos, importaciones, suscripciones) puede traer calendarios nuevos.
        viewModelScope.launch { graph.changes.calendar.drop(1).collect { refresh() } }
        viewModelScope.launch { graph.preferences.calendarView.collect { savedView = it } }
    }

    /** Elige la vista guardada si cabe en el ancho actual (la semana no cabe en un teléfono). */
    fun resolveView(narrow: Boolean) {
        val current = view
        if (current == null || !current.allowed(narrow)) view = CalendarView.restore(savedView, narrow)
    }

    fun selectView(target: CalendarView) {
        view = target
        viewModelScope.launch { graph.preferences.setCalendarView(target.name) }
    }

    fun goToday() {
        anchor = today
    }

    fun toggleLayer(holidays: Boolean = showHolidays, tasks: Boolean = showTasks) {
        showHolidays = holidays
        showTasks = tasks
        viewModelScope.launch { graph.preferences.setLayers(holidays, tasks) }
    }

    // ── Datos por rango ──

    fun data(range: DateRange): RangeData {
        val entry = raw[range] ?: return RangeData(emptyList(), true, null)
        val byId = calendars.associateBy { it.id }
        val zone = zone
        val items = buildList {
            entry.occurrences.forEach { occ ->
                val calendar = byId[occ.calendarId]
                if (calendar == null || calendar.visible) {
                    add(occ.toItem(zone, calendar?.color ?: "#7c5cff", calendar?.readOnly == true))
                }
            }
            if (showTasks) entry.tasks.forEach { add(it.toItem(zone, TASK_COLOR)) }
            if (showHolidays) entry.holidays.forEach { add(it.toItem(HOLIDAY_COLOR)) }
        }.sortedWith(ItemOrder)
        return RangeData(items, entry.loading, entry.error)
    }

    fun ensure(range: DateRange) {
        val entry = raw[range]
        val version = dataVersion
        if (entry != null) {
            if (entry.loading && entry.requested == version) return
            if (!entry.loading && entry.version == version && entry.error == null) return
        }
        raw[range] = (entry ?: RawRange()).copy(loading = true, error = null, requested = version)
        trimCache(range)
        viewModelScope.launch {
            val zone = zone
            val from = range.fromInstant(zone)
            val to = range.toInstant(zone)
            val events = async { apiCall { api.events(from, to) } }
            val holidays = async { apiCall { api.holidays(range.start.toString(), range.end.minusDays(1).toString()) } }
            val tasks = async { apiCall { api.dueCards(from, to) } }
            val eventsResult = events.await()
            val holidaysResult = holidays.await()
            val tasksResult = tasks.await()
            // Llegó tarde (hubo un cambio mientras tanto): ya hay otra petición con la versión nueva.
            if (raw[range]?.requested != version) return@launch
            holidaysResult.getOrNull()?.region?.let { holidayRegion = it }
            raw[range] = RawRange(
                occurrences = eventsResult.getOrNull()?.events ?: entry?.occurrences.orEmpty(),
                holidays = holidaysResult.getOrNull()?.holidays.orEmpty(),
                tasks = tasksResult.getOrNull()?.cards.orEmpty(),
                loading = false,
                error = eventsResult.exceptionOrNull()?.apiError,
                version = version,
                requested = version,
            )
        }
    }

    fun invalidate() {
        dataVersion++
    }

    fun refresh() {
        loadCalendars()
        invalidate()
    }

    private fun trimCache(keep: DateRange) {
        if (raw.size <= 16) return
        raw.keys.filter { it != keep }
            .sortedByDescending { kotlin.math.abs(it.start.toEpochDay() - anchor.toEpochDay()) }
            .take(raw.size - 12)
            .forEach { raw.remove(it) }
    }

    // ── Calendarios ──

    fun loadCalendars() {
        viewModelScope.launch {
            apiCall { api.calendars() }
                .onSuccess { calendars = it.calendars.sortedBy(CalendarInfo::position); calendarsError = null }
                .onFailure { calendarsError = it.apiError }
        }
    }

    fun toggleCalendar(calendar: CalendarInfo) {
        val visible = !calendar.visible
        calendars = calendars.map { if (it.id == calendar.id) it.copy(visible = visible) else it }
        viewModelScope.launch {
            apiCall { api.updateCalendar(calendar.id, buildJsonObject { put("visible", JsonPrimitive(visible)) }) }
                .onFailure {
                    calendars = calendars.map { c -> if (c.id == calendar.id) c.copy(visible = !visible) else c }
                    message = it.apiError
                }
        }
    }

    fun createCalendar(name: String, color: String) {
        viewModelScope.launch {
            apiCall { api.createCalendar(CreateCalendarRequest(name, color)) }
                .onSuccess { loadCalendars() }
                .onFailure { message = it.apiError }
        }
    }

    fun updateCalendar(calendar: CalendarInfo, name: String, color: String) {
        viewModelScope.launch {
            apiCall {
                api.updateCalendar(calendar.id, buildJsonObject {
                    put("name", JsonPrimitive(name))
                    put("color", JsonPrimitive(color))
                })
            }.onSuccess { loadCalendars() }.onFailure { message = it.apiError }
        }
    }

    fun deleteCalendar(calendar: CalendarInfo) {
        viewModelScope.launch {
            apiCall { api.deleteCalendar(calendar.id) }
                .onSuccess { loadCalendars(); invalidate() }
                .onFailure { message = it.apiError }
        }
    }

    // ── Alta rápida (F8-07) ──

    /** Título del último evento creado con el alta rápida, para avisar. */
    var quickAdded by mutableStateOf<String?>(null)
    var quickBusy by mutableStateOf(false)
        private set
    /** Error al añadir desde la hoja (sin conexión, validación): se ve en la propia hoja. */
    var quickError by mutableStateOf<ApiError?>(null)

    /** Donde va el alta rápida: el calendario personal (o el primero en el que se puede escribir). */
    val quickCalendar: CalendarInfo?
        get() = calendars.filter { !it.readOnly }.let { writable -> writable.firstOrNull { it.kind == "personal" } ?: writable.firstOrNull() }

    fun quickAdd(draft: QuickDraft, calendar: CalendarInfo, onDone: () -> Unit) {
        if (quickBusy) return
        quickBusy = true
        val zone = zone
        val times = draft.formTimes().toApi(zone)
        viewModelScope.launch {
            apiCall {
                api.createEvent(buildJsonObject {
                    put("type", JsonPrimitive("event"))
                    put("calendarId", JsonPrimitive(calendar.id))
                    put("title", JsonPrimitive(draft.title))
                    put("tz", JsonPrimitive(zone.id))
                    put("allDay", JsonPrimitive(times.allDay))
                    put("start", JsonPrimitive(times.start))
                    put("end", JsonPrimitive(times.end))
                })
            }.onSuccess {
                quickAdded = draft.title
                graph.changes.calendarChanged()
                onDone()
            }.onFailure { quickError = it.apiError }
            quickBusy = false
        }
    }

    // ── Festivos y exportación (F7-03, F6-02) ──

    fun chooseHolidayRegion(region: String) {
        val previous = holidayRegion
        if (region == previous) return
        holidayRegion = region
        viewModelScope.launch {
            apiCall { api.setHolidayRegion(HolidayRegionRequest(region)) }
                .onSuccess { invalidate() }
                .onFailure { holidayRegion = previous; message = it.apiError }
        }
    }

    /** El calendario en ICS en el documento que elija la persona (Storage Access Framework). */
    fun exportCalendar(calendar: CalendarInfo, target: Uri, resolver: ContentResolver) {
        viewModelScope.launch {
            apiCall {
                val body = api.exportCalendar(calendar.id)
                withContext(Dispatchers.IO) {
                    body.use { input ->
                        resolver.openOutputStream(target)?.use { out -> input.byteStream().copyTo(out) } ?: throw IOException("Sin acceso al documento")
                    }
                }
            }.onSuccess { notice = R.string.calendar_exported }.onFailure { message = it.apiError }
        }
    }

    // ── Feed ICS privado (F7-02) ──

    var feed by mutableStateOf<CalendarFeed?>(null)
        private set
    var feedBusy by mutableStateOf(false)
        private set

    fun loadFeed(calendar: CalendarInfo) = feedCall { api.feed(calendar.id).feed }
    fun rotateFeed(calendar: CalendarInfo) = feedCall { api.rotateFeed(calendar.id).feed }
    fun revokeFeed(calendar: CalendarInfo) = feedCall { api.revokeFeed(calendar.id); null }

    private fun feedCall(block: suspend () -> CalendarFeed?) {
        feedBusy = true
        viewModelScope.launch {
            apiCall { block() }.onSuccess { feed = it }.onFailure { message = it.apiError }
            feedBusy = false
        }
    }

    fun clearFeed() {
        feed = null
    }

    // ── Borrar desde el detalle ──

    fun deleteOccurrence(occurrence: Occurrence, scope: String) {
        viewModelScope.launch {
            apiCall {
                api.deleteEvent(occurrence.eventId, scope, occurrence.originalStart.takeIf { scope != "all" })
            }.onSuccess {
                selected = null
                graph.changes.calendarChanged()
            }.onFailure { message = it.apiError }
        }
    }
}
