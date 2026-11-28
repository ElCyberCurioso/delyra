package app.delyra.feature.kanban

import app.delyra.core.model.CardDetail
import app.delyra.core.model.CardReminder
import app.delyra.core.model.DueInfo
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** El borrador del detalle de tarjeta: «Guardar cambios» manda solo lo que cambia, una vez. */
class CardDraftTest {
    private val tz = "Europe/Madrid"
    private val card = CardDetail(
        id = "k",
        boardId = "b",
        columnId = "c",
        title = "Factura",
        position = "a0",
        color = "#2f80ed",
        labelIds = listOf("l1", "l2"),
        due = DueInfo(allDay = false, at = "2027-05-10T15:00:00.000Z", tz = tz),
        reminders = listOf(CardReminder(id = "r", offsetMinutes = 60)),
    )

    @Test
    fun `sin cambios de verdad no manda nada`() {
        assertTrue(CardDraft().patch(card, canRemind = true).isEmpty())
        val same = CardDraft(
            title = "  Factura ",
            color = Chosen("#2F80ED"),
            assignee = Chosen("  "),
            labelIds = setOf("l2", "l1"),
            // El mismo instante escrito de otra forma.
            due = Chosen(DueInfo(false, "2027-05-10T17:00:00+02:00", tz)),
            reminders = listOf(60),
        )
        assertEquals(JsonObject(emptyMap()), same.patch(card, canRemind = true))
    }

    @Test
    fun `elegir fecha y hora varias veces manda una sola fecha, junto con lo demas`() {
        var draft = CardDraft()
        for (at in listOf("2027-05-11T07:00:00Z", "2027-05-12T07:00:00Z", "2027-05-12T15:30:00Z")) {
            draft = draft.copy(due = Chosen(DueInfo(false, at, tz)))
        }
        draft = draft.copy(priority = "high", title = " Pagar factura ", labelIds = setOf("l1"))
        val patch = draft.patch(card, canRemind = true)
        assertEquals(setOf("due", "priority", "title", "labelIds"), patch.keys)
        assertEquals(JsonPrimitive("2027-05-12T15:30:00Z"), patch.getValue("due").jsonObject["at"])
        assertEquals(JsonPrimitive("Pagar factura"), patch["title"])
        assertEquals(JsonArray(listOf(JsonPrimitive("l1"))), patch["labelIds"])
    }

    @Test
    fun `quitar color, persona y fecha se manda como vacio`() {
        val withAssignee = card.copy(assignee = "Gestoría")
        val patch = CardDraft(color = Chosen(null), assignee = Chosen(null), due = Chosen(null), reminders = emptyList())
            .patch(withAssignee, canRemind = true)
        assertEquals(JsonNull, patch["color"])
        assertEquals(JsonPrimitive(""), patch["assignee"])
        assertEquals(JsonNull, patch["due"])
        // Sin fecha no hay avisos que mandar: la API los quita sola.
        assertFalse("reminders" in patch)
    }

    @Test
    fun `los avisos solo los manda quien creo el tablero, y el de por defecto no hace falta`() {
        assertEquals(JsonArray(emptyList()), CardDraft(reminders = emptyList()).patch(card, canRemind = true)["reminders"])
        assertEquals(2, CardDraft(reminders = listOf(60, 15)).patch(card, canRemind = true).getValue("reminders").jsonArray.size)
        assertTrue(CardDraft(reminders = listOf(15)).patch(card, canRemind = false).isEmpty())

        val undated = card.copy(due = null, reminders = emptyList())
        val first = CardDraft(due = Chosen(DueInfo(true, "2027-05-12", tz)))
        // Sin tocar el aviso se ve el que pondrá la API (el día a las 9:00) y no se manda.
        assertEquals(listOf(-540), first.reminders(undated))
        assertEquals(setOf("due"), first.patch(undated, canRemind = true).keys)
        assertEquals(setOf("due", "reminders"), first.copy(reminders = emptyList()).patch(undated, canRemind = true).keys)
    }

    @Test
    fun `tras guardar queda solo lo que se toco mientras tanto`() {
        val sent = CardDraft(title = "Uno", priority = "high")
        assertEquals(CardDraft(), sent.afterSave(sent))
        assertEquals(CardDraft(title = "Dos"), sent.copy(title = "Dos").afterSave(sent))
    }
}
