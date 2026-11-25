package app.delyra.feature.imports

import app.delyra.core.model.AdminInvitation
import app.delyra.core.model.CalendarInfo
import app.delyra.core.model.ImportCalendarPreview
import app.delyra.core.model.ImportResponse
import app.delyra.core.network.ApiJson
import app.delyra.feature.admin.invitationStatus
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

/** Asistente de importación y panel de administración (F8-08): la lógica que no es interfaz. */
class ImportPlanTest {
    private val own = listOf(CalendarInfo("cal-1", "Trabajo", "#2f80ed", "work", true, 0))
    private val palette = listOf("#7c5cff", "#5b5bd6")

    private fun preview(key: String, name: String, color: String? = null, suggested: String? = null, skip: Boolean = false) =
        ImportCalendarPreview(key = key, name = name, color = color, suggestedCalendarId = suggested, suggestSkip = skip)

    @Test
    fun `destino propuesto como en la web`() {
        assertEquals(ImportChoice.Skip, initialChoice(preview("0", "Festivos", skip = true), 0, own, palette))
        assertEquals(ImportChoice.Existing("cal-1"), initialChoice(preview("1", "Trabajo", suggested = "cal-1"), 1, own, palette))
        // Una sugerencia que ya no existe (o de solo lectura) acaba en un calendario nuevo.
        assertEquals(ImportChoice.New("Otro", "#5b5bd6"), initialChoice(preview("2", "Otro", suggested = "ya-no"), 1, own, palette))
        assertEquals(ImportChoice.New("Con color", "#123456"), initialChoice(preview("3", "Con color", color = "#123456"), 0, own, palette))
        assertEquals(60, (initialChoice(preview("4", "x".repeat(80)), 0, own, palette) as ImportChoice.New).name.length)
    }

    @Test
    fun `no se empieza sin nada elegido ni con nombres vacíos`() {
        assertEquals(PlanProblem.NothingChosen, planProblem(listOf(ImportChoice.Skip, ImportChoice.Skip)))
        assertEquals(PlanProblem.NameMissing, planProblem(listOf(ImportChoice.New("  ", "#7c5cff"))))
        assertNull(planProblem(listOf(ImportChoice.Skip, ImportChoice.Existing("cal-1"))))
    }

    @Test
    fun `cuerpo de start con cada destino`() {
        val body = startImportBody(
            listOf(preview("0", "A"), preview("1", "B"), preview("2", "C")),
            listOf(ImportChoice.New(" Nuevo ", "#7c5cff"), ImportChoice.Existing("cal-1"), ImportChoice.Skip),
            reminders = false,
        )
        assertEquals("false", body["reminders"]!!.jsonPrimitive.content)
        val calendars = body["calendars"] as JsonArray
        val first = calendars[0] as JsonObject
        assertEquals("new", first["target"]!!.jsonPrimitive.content)
        assertEquals("Nuevo", first["name"]!!.jsonPrimitive.content)
        assertEquals("cal-1", (calendars[1] as JsonObject)["calendarId"]!!.jsonPrimitive.content)
        assertEquals(setOf("key", "target"), (calendars[2] as JsonObject).keys)
    }

    @Test
    fun `la respuesta usa la clave import`() {
        val json = """{"import":{"id":"i1","source":"file","status":"ready","filename":"a.ics","calendars":[],"warnings":[],"progress":{"done":0,"total":0},"report":null,"error":null,"createdAt":"2026-11-25T10:00:00.000Z","finishedAt":null}}"""
        assertEquals("i1", ApiJson.decodeFromString<ImportResponse>(json).item.id)
    }

    @Test
    fun `estado de las invitaciones`() {
        val now = Instant.parse("2026-11-25T10:00:00Z")
        val base = AdminInvitation("i", "a@b.c", "member", "2026-11-20T10:00:00.000Z", "2026-11-27T10:00:00.000Z")
        assertEquals("pending", invitationStatus(base, now))
        assertEquals("expired", invitationStatus(base.copy(expiresAt = "2026-11-24T10:00:00.000Z"), now))
        assertEquals("accepted", invitationStatus(base.copy(acceptedAt = "2026-11-21T10:00:00.000Z"), now))
        assertEquals("revoked", invitationStatus(base.copy(revokedAt = "2026-11-21T10:00:00.000Z"), now))
    }
}
