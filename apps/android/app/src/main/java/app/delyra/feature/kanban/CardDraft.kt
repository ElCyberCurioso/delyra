package app.delyra.feature.kanban

import app.delyra.core.model.CardDetail
import app.delyra.core.model.DueInfo
import app.delyra.feature.calendar.parseInstant
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/** Un valor elegido en el borrador: distingue «sin tocar» (`null`) de «quitado» (`Chosen(null)`). */
data class Chosen<out T>(val value: T)

/**
 * Lo que el detalle de una tarjeta guarda con su botón «Guardar cambios», como en la web. Mover,
 * la checklist, los comentarios, los adjuntos y archivar son de un solo gesto y van al momento.
 * Cada campo es `null` mientras no se toca; lo que se ve es lo guardado con el borrador encima.
 */
data class CardDraft(
    val title: String? = null,
    val description: String? = null,
    val kind: String? = null,
    val priority: String? = null,
    val color: Chosen<String?>? = null,
    val assignee: Chosen<String?>? = null,
    val labelIds: Set<String>? = null,
    val due: Chosen<DueInfo?>? = null,
    val reminders: List<Int>? = null,
) {
    fun title(card: CardDetail): String = title ?: card.title
    fun description(card: CardDetail): String = description ?: card.description
    fun kind(card: CardDetail): String = kind ?: card.kind
    fun priority(card: CardDetail): String = priority ?: card.priority
    fun color(card: CardDetail): String? = if (color != null) color.value else card.color
    fun assignee(card: CardDetail): String? = if (assignee != null) assignee.value else card.assignee
    fun labelIds(card: CardDetail): Set<String> = labelIds ?: card.labelIds.toSet()
    fun due(card: CardDetail): DueInfo? = if (due != null) due.value else card.due

    /** Los avisos que se ven; sin fecha guardada todavía, los que pondrá la API con la nueva. */
    fun reminders(card: CardDetail): List<Int> = reminders ?: savedReminders(card, due(card)?.allDay ?: false)

    /**
     * Lo que manda «Guardar cambios»: solo lo que cambia de verdad (vacío si nada cambia), así que
     * elegir fecha y hora deja una sola fila en la actividad. Los avisos solo los elige quien creó
     * el tablero (`canRemind`).
     */
    fun patch(card: CardDetail, canRemind: Boolean): JsonObject = buildJsonObject {
        val title = title(card).trim()
        if (title != card.title) put("title", JsonPrimitive(title))
        if (description(card) != card.description) put("description", JsonPrimitive(description(card)))
        if (kind(card) != card.kind) put("kind", JsonPrimitive(kind(card)))
        if (priority(card) != card.priority) put("priority", JsonPrimitive(priority(card)))
        val color = color(card)
        if (color?.lowercase() != card.color?.lowercase()) put("color", color?.let(::JsonPrimitive) ?: JsonNull)
        val assignee = assignee(card)?.trim()?.ifEmpty { null }
        // Vacío es «nadie» para la API.
        if (assignee != card.assignee) put("assignee", JsonPrimitive(assignee.orEmpty()))
        val labels = labelIds(card)
        if (labels != card.labelIds.toSet()) put("labelIds", JsonArray(labels.map(::JsonPrimitive)))
        val due = due(card)
        if (!sameDue(due, card.due)) {
            put(
                "due",
                due?.let {
                    buildJsonObject {
                        put("allDay", JsonPrimitive(it.allDay))
                        put("at", JsonPrimitive(it.at))
                        put("tz", JsonPrimitive(it.tz))
                    }
                } ?: JsonNull,
            )
        }
        // Sin fecha no hay avisos: la API los quita sola.
        if (canRemind && due != null) {
            val offsets = reminders(card).distinct().sorted()
            if (offsets != savedReminders(card, due.allDay).distinct().sorted()) {
                put(
                    "reminders",
                    JsonArray(offsets.map { JsonObject(mapOf("offsetMinutes" to JsonPrimitive(it), "channel" to JsonPrimitive("telegram"))) }),
                )
            }
        }
    }

    /** Tras guardar `sent`, queda solo lo que se tocó mientras se guardaba. */
    fun afterSave(sent: CardDraft) = CardDraft(
        title = title.takeIf { it != sent.title },
        description = description.takeIf { it != sent.description },
        kind = kind.takeIf { it != sent.kind },
        priority = priority.takeIf { it != sent.priority },
        color = color.takeIf { it != sent.color },
        assignee = assignee.takeIf { it != sent.assignee },
        labelIds = labelIds.takeIf { it != sent.labelIds },
        due = due.takeIf { it != sent.due },
        reminders = reminders.takeIf { it != sent.reminders },
    )
}

/** El aviso que pone la API al dar fecha a una tarjeta sin elegir ninguno. */
fun defaultReminders(allDay: Boolean): List<Int> = listOf(if (allDay) -540 else 60)

private fun savedReminders(card: CardDetail, allDay: Boolean): List<Int> =
    if (card.due == null) defaultReminders(allDay) else card.reminders.map { it.offsetMinutes }

/** La misma fecha límite aunque el instante venga escrito de otra forma. */
private fun sameDue(a: DueInfo?, b: DueInfo?): Boolean = when {
    a == null || b == null -> a == b
    a.allDay != b.allDay -> false
    a.allDay -> a.at.take(10) == b.at.take(10)
    else -> runCatching { parseInstant(a.at) == parseInstant(b.at) }.getOrDefault(a.at == b.at)
}
