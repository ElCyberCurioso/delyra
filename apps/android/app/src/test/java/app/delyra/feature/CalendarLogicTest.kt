package app.delyra.feature

import app.delyra.core.model.Occurrence
import app.delyra.feature.auth.AuthViewModel
import app.delyra.feature.calendar.CalendarView
import app.delyra.feature.calendar.DaySegment
import app.delyra.feature.calendar.FormTimes
import app.delyra.feature.calendar.RepeatEnd
import app.delyra.feature.calendar.RepeatPreset
import app.delyra.feature.calendar.RepeatState
import app.delyra.feature.calendar.formTimesOf
import app.delyra.feature.calendar.layoutDay
import app.delyra.feature.calendar.range
import app.delyra.feature.calendar.repeatStateOf
import app.delyra.feature.calendar.segmentFor
import app.delyra.feature.calendar.startOfWeek
import app.delyra.feature.calendar.toApi
import app.delyra.feature.calendar.toItem
import app.delyra.feature.calendar.toRrule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class CalendarLogicTest {
    private val madrid = ZoneId.of("Europe/Madrid")

    @Test
    fun `token de invitacion o de recuperacion desde el enlace`() {
        val token = "a".repeat(43)
        assertEquals(token, AuthViewModel.extractToken("https://delyra.app/registro#token=$token"))
        assertEquals(token, AuthViewModel.extractToken("  $token "))
        assertNull(AuthViewModel.extractToken("https://delyra.app/registro?token=$token"))
        assertNull(AuthViewModel.extractToken("https://delyra.app/registro#token=corto"))
    }

    @Test
    fun `semana segun el dia de inicio de la cuenta`() {
        val sunday = LocalDate.of(2026, 11, 29)
        assertEquals(LocalDate.of(2026, 11, 23), sunday.startOfWeek(1))
        assertEquals(sunday, sunday.startOfWeek(0))
        val month = CalendarView.Month.range(LocalDate.of(2026, 11, 23), 1)
        assertEquals(LocalDate.of(2026, 10, 26), month.start)
        assertEquals(42, month.days.size)
    }

    @Test
    fun `vistas segun el ancho, como la web`() {
        assertEquals(CalendarView.ThreeDay, CalendarView.restore("Week", narrow = true))
        assertEquals(CalendarView.Week, CalendarView.restore("ThreeDay", narrow = false))
        assertEquals(CalendarView.Month, CalendarView.restore("Month", narrow = true))
    }

    @Test
    fun `presets de repeticion ida y vuelta`() {
        val monday = LocalDate.of(2026, 11, 23)
        val weekly = RepeatState(RepeatPreset.Weekly, RepeatEnd.Count(5))
        assertEquals("FREQ=WEEKLY;BYDAY=MO;COUNT=5", weekly.toRrule(monday))
        assertEquals(weekly, repeatStateOf("FREQ=WEEKLY;BYDAY=MO;COUNT=5", monday))
        val until = RepeatState(RepeatPreset.Monthly, RepeatEnd.Until(LocalDate.of(2027, 3, 1)))
        assertEquals("FREQ=MONTHLY;BYMONTHDAY=23;UNTIL=20270301T235959Z", until.toRrule(monday))
        assertEquals(RepeatPreset.Custom, repeatStateOf("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", monday).preset)
        assertNull(RepeatState().toRrule(monday))
    }

    @Test
    fun `los solapes se reparten en columnas`() {
        val item = Occurrence("a", "a", "c", "event", "A", allDay = false, start = "2026-11-23T09:00:00Z", end = "2026-11-23T10:00:00Z", tz = "UTC")
            .toItem(ZoneId.of("UTC"), "#000000", false)
        fun seg(start: Int, end: Int) = DaySegment(item, start, end)
        val placed = layoutDay(listOf(seg(540, 600), seg(570, 630), seg(600, 660), seg(720, 780)))
        // Los tres primeros forman un grupo de dos columnas; el último va solo.
        assertEquals(listOf(2, 2, 2, 1), placed.map { it.columns })
        assertEquals(listOf(0, 1, 0, 0), placed.map { it.column })
    }

    @Test
    fun `un evento que cruza la medianoche se parte por dias`() {
        val occ = Occurrence("a", "a", "c", "event", "Noche", allDay = false, start = "2026-11-23T22:00:00Z", end = "2026-11-24T01:00:00Z", tz = "UTC")
        val item = occ.toItem(ZoneId.of("UTC"), "#000000", false)
        assertEquals(22 * 60 to 24 * 60, segmentFor(item, LocalDate.of(2026, 11, 23))!!.let { it.startMinute to it.endMinute })
        assertEquals(0 to 60, segmentFor(item, LocalDate.of(2026, 11, 24))!!.let { it.startMinute to it.endMinute })
    }

    @Test
    fun `horas del editor en la zona de la cuenta, tambien en el cambio de hora`() {
        // 25 de octubre de 2026: en Madrid se pasa de +02:00 a +01:00.
        val form = FormTimes(false, LocalDate.of(2026, 10, 25), 9 * 60, LocalDate.of(2026, 10, 25), 10 * 60)
        val api = form.toApi(madrid)
        assertEquals("2026-10-25T08:00:00Z", api.start)
        assertEquals(form, formTimesOf(false, api.start, api.end, madrid))
        // Día completo: fin exclusivo en la API, inclusivo en el formulario.
        val allDay = FormTimes(true, LocalDate.of(2026, 11, 23), 0, LocalDate.of(2026, 11, 24), 0).toApi(madrid)
        assertEquals("2026-11-25", allDay.end)
    }
}
