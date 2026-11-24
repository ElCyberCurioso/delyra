package app.delyra.core.network.api

import app.delyra.core.model.CalendarFeedResponse
import app.delyra.core.model.CalendarResponse
import app.delyra.core.model.CalendarsResponse
import app.delyra.core.model.CreateCalendarRequest
import app.delyra.core.model.DueCardsResponse
import app.delyra.core.model.EventResponse
import app.delyra.core.model.HolidayRegionRequest
import app.delyra.core.model.HolidaysResponse
import app.delyra.core.model.OccurrencesResponse
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/** Calendarios, eventos, festivos y capa de tareas (F2, F4-11, F7-02, F7-03). */
interface CalendarApi {
    @GET("calendars")
    suspend fun calendars(): CalendarsResponse

    @POST("calendars")
    suspend fun createCalendar(@Body body: CreateCalendarRequest): CalendarResponse

    @PATCH("calendars/{id}")
    suspend fun updateCalendar(@Path("id") id: String, @Body body: JsonObject): CalendarResponse

    @DELETE("calendars/{id}")
    suspend fun deleteCalendar(@Path("id") id: String)

    @GET("calendars/{id}/feed")
    suspend fun feed(@Path("id") id: String): CalendarFeedResponse

    @POST("calendars/{id}/feed")
    suspend fun rotateFeed(@Path("id") id: String): CalendarFeedResponse

    @DELETE("calendars/{id}/feed")
    suspend fun revokeFeed(@Path("id") id: String)

    /** Ocurrencias ya expandidas entre `from` y `to` (instantes ISO; máximo 400 días). */
    @GET("events")
    suspend fun events(
        @Query("from") from: String,
        @Query("to") to: String,
        @Query("calendars") calendars: String? = null,
    ): OccurrencesResponse

    @GET("events/search")
    suspend fun search(@Query("q") query: String): OccurrencesResponse

    @GET("events/{id}")
    suspend fun event(@Path("id") id: String): EventResponse

    @POST("events")
    suspend fun createEvent(@Body body: JsonObject): EventResponse

    @PATCH("events/{id}")
    suspend fun updateEvent(@Path("id") id: String, @Body body: JsonObject): EventResponse

    @DELETE("events/{id}")
    suspend fun deleteEvent(
        @Path("id") id: String,
        @Query("scope") scope: String,
        @Query("occurrence") occurrence: String? = null,
    )

    /** Festivos de la región elegida (`AAAA-MM-DD`). */
    @GET("holidays")
    suspend fun holidays(@Query("from") from: String, @Query("to") to: String): HolidaysResponse

    @PUT("holidays/region")
    suspend fun setHolidayRegion(@Body body: HolidayRegionRequest): HolidayRegionRequest

    /** Tarjetas con fecha límite en el rango (capa «Tareas» del calendario). */
    @GET("cards/due")
    suspend fun dueCards(@Query("from") from: String, @Query("to") to: String): DueCardsResponse
}
