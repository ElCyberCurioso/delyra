package app.delyra.navigation

import kotlinx.serialization.Serializable

/** Rutas con tipos (Navigation Compose + kotlinx.serialization). */

@Serializable
data object HomeRoute

@Serializable
data class BoardRoute(val boardId: String)

@Serializable
data class CardRoute(val cardId: String)

/**
 * Editor de eventos. Sin [eventId], uno nuevo empezando en [date] (`AAAA-MM-DD`) y, si no es de
 * día completo, a la hora [minutes] desde medianoche. Con [occurrenceStart], la ocurrencia
 * concreta de una serie sobre la que se pregunta el alcance del cambio.
 */
@Serializable
data class EventEditorRoute(
    val eventId: String? = null,
    val occurrenceStart: String? = null,
    /** Inicio y fin reales de la ocurrencia que se abrió (pueden diferir de la serie). */
    val start: String? = null,
    val end: String? = null,
    val recurring: Boolean = false,
    val date: String? = null,
    val minutes: Int? = null,
    val allDay: Boolean = false,
    val birthday: Boolean = false,
    /** Desde el alta rápida («Más opciones»): título, hora de fin y calendario ya elegidos. */
    val title: String? = null,
    val endMinutes: Int? = null,
    val calendarId: String? = null,
)

@Serializable
data object EventSearchRoute

/** Pestañas de la navegación principal. */
enum class HomeTab { Calendar, Tasks, Settings }
