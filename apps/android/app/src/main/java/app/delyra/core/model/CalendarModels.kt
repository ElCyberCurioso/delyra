package app.delyra.core.model

import kotlinx.serialization.Serializable

/** Calendario, eventos, festivos y tareas con fecha (`schemas/calendar.ts`, `holidays.ts`). */

@Serializable
data class CalendarInfo(
    val id: String,
    val name: String,
    val color: String,
    val kind: String,
    val visible: Boolean,
    val position: Int,
    val readOnly: Boolean = false,
)

@Serializable
data class CalendarsResponse(val calendars: List<CalendarInfo>)

@Serializable
data class CalendarResponse(val calendar: CalendarInfo)

@Serializable
data class CreateCalendarRequest(val name: String, val color: String)

/** Una ocurrencia ya expandida por el servidor (las series se expanden allí). */
@Serializable
data class Occurrence(
    val id: String,
    val eventId: String,
    val calendarId: String,
    val type: String,
    val title: String,
    val notes: String? = null,
    val location: String? = null,
    val url: String? = null,
    val allDay: Boolean,
    /** `AAAA-MM-DD` si es de día completo; instante ISO si no. */
    val start: String,
    /** Exclusivo en día completo. */
    val end: String,
    val tz: String,
    val recurring: Boolean = false,
    val originalStart: String? = null,
    val age: Int? = null,
) {
    val isBirthday: Boolean get() = type == "birthday"
}

@Serializable
data class OccurrencesResponse(val events: List<Occurrence>)

@Serializable
data class EventReminder(
    val id: String = "",
    val offsetMinutes: Int,
    val channel: String = "telegram",
    val nextFireAt: String? = null,
)

@Serializable
data class EventDetail(
    val id: String,
    val calendarId: String,
    val type: String,
    val title: String,
    val notes: String? = null,
    val location: String? = null,
    val url: String? = null,
    val allDay: Boolean,
    val start: String,
    val end: String,
    val tz: String,
    val rrule: String? = null,
    val recurringEventId: String? = null,
    val birthYear: Int? = null,
    val feb29Rule: String? = null,
    val reminders: List<EventReminder> = emptyList(),
)

@Serializable
data class EventResponse(val event: EventDetail)

@Serializable
data class Holiday(val date: String, val name: String, val regional: Boolean = false)

@Serializable
data class HolidaysResponse(val region: String, val holidays: List<Holiday>)

@Serializable
data class HolidayRegionRequest(val region: String)

@Serializable
data class DueInfo(val allDay: Boolean, val at: String, val tz: String)

@Serializable
data class DueCard(
    val id: String,
    val boardId: String,
    val boardName: String,
    val title: String,
    val priority: String,
    val due: DueInfo,
    val completed: Boolean,
)

@Serializable
data class DueCardsResponse(val cards: List<DueCard>)

@Serializable
data class CalendarFeed(val url: String, val createdAt: String)

@Serializable
data class CalendarFeedResponse(val feed: CalendarFeed? = null)
