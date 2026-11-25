package app.delyra.feature.calendar

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime

/**
 * El alta rápida da lo mismo que la web (chrono-node + normalización del español) en el corpus que
 * genera `packages/shared/src/quick-add.android.test.ts` (`quick-add-cases.json`).
 */
class QuickAddTest {
    @Serializable
    private data class Draft(val title: String, val allDay: Boolean, val date: String, val startTime: String?, val endTime: String?)

    @Serializable
    private data class Case(val text: String, val draft: Draft?)

    @Serializable
    private data class Corpus(val reference: String, val es: List<Case>, val en: List<Case>)

    private val corpus: Corpus = Json.decodeFromString(
        javaClass.classLoader!!.getResource("quick-add-cases.json")!!.readText(),
    )
    private val reference = LocalDateTime.parse(corpus.reference)

    private fun QuickDraft.toCase() = Draft(title, allDay, date.toString(), startTime?.toString(), endTime?.toString())

    private fun check(cases: List<Case>, english: Boolean) {
        val wrong = cases.mapNotNull { case ->
            val got = QuickAdd.parse(case.text, reference, english)?.toCase()
            if (got == case.draft) null else "«${case.text}»\n  web:     ${case.draft}\n  android: $got"
        }
        assertEquals("Distinto de la web:\n" + wrong.joinToString("\n"), 0, wrong.size)
    }

    @Test
    fun `español igual que la web`() = check(corpus.es, english = false)

    @Test
    fun `inglés igual que la web`() = check(corpus.en, english = true)

    @Test
    fun `el 29 de febrero sin año va al siguiente bisiesto`() {
        val draft = QuickAdd.parse("Algo el 29 de febrero", reference, english = false)
        assertEquals(LocalDate.of(2028, 2, 29), draft?.date)
    }

    @Test
    fun `texto vacío o sin fecha no propone nada`() {
        assertNull(QuickAdd.parse("   ", reference, english = false))
        assertNull(QuickAdd.parse("Comprar pan", reference, english = false))
    }
}
