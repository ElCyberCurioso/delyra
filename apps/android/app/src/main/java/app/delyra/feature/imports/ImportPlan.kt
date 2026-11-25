package app.delyra.feature.imports

import app.delyra.core.model.CalendarInfo
import app.delyra.core.model.ImportCalendarPreview
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/** Qué hacer con cada calendario de la vista previa (`startImportRequestSchema`). */
sealed interface ImportChoice {
    data object Skip : ImportChoice
    data class New(val name: String, val color: String) : ImportChoice
    data class Existing(val calendarId: String) : ImportChoice
}

/** Por qué no se puede empezar la importación todavía. */
enum class PlanProblem { NothingChosen, NameMissing }

/**
 * Como `initialChoice` de la web: lo que Google marca como prescindible (festivos, números de
 * semana) no se importa; si hay un calendario propio con el mismo nombre, se añade a él; si no, a
 * uno nuevo con su nombre y su color (o uno de la paleta).
 */
fun initialChoice(calendar: ImportCalendarPreview, index: Int, own: List<CalendarInfo>, palette: List<String>): ImportChoice = when {
    calendar.suggestSkip -> ImportChoice.Skip
    calendar.suggestedCalendarId != null && own.any { it.id == calendar.suggestedCalendarId } ->
        ImportChoice.Existing(calendar.suggestedCalendarId)
    else -> ImportChoice.New(calendar.name.take(60), calendar.color ?: palette.getOrElse(index % palette.size.coerceAtLeast(1)) { "#7c5cff" })
}

fun planProblem(choices: List<ImportChoice>): PlanProblem? = when {
    choices.all { it is ImportChoice.Skip } -> PlanProblem.NothingChosen
    choices.any { it is ImportChoice.New && it.name.isBlank() } -> PlanProblem.NameMissing
    else -> null
}

/** Cuerpo de `POST /api/imports/:id/start`, en el orden de la vista previa. */
fun startImportBody(calendars: List<ImportCalendarPreview>, choices: List<ImportChoice>, reminders: Boolean): JsonObject = buildJsonObject {
    put("reminders", JsonPrimitive(reminders))
    put(
        "calendars",
        JsonArray(
            calendars.zip(choices).map { (calendar, choice) ->
                buildJsonObject {
                    put("key", JsonPrimitive(calendar.key))
                    when (choice) {
                        ImportChoice.Skip -> put("target", JsonPrimitive("skip"))
                        is ImportChoice.New -> {
                            put("target", JsonPrimitive("new"))
                            put("name", JsonPrimitive(choice.name.trim()))
                            put("color", JsonPrimitive(choice.color))
                        }
                        is ImportChoice.Existing -> {
                            put("target", JsonPrimitive("existing"))
                            put("calendarId", JsonPrimitive(choice.calendarId))
                        }
                    }
                }
            },
        ),
    )
}
