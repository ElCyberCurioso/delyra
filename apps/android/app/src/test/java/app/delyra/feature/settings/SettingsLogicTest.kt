package app.delyra.feature.settings

import app.delyra.core.i18n.ServerMessages
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/** Traducción de los mensajes de la API (F7-06) y formato de Ajustes (F8-06). */
class SettingsLogicTest {
    // Las pruebas de JVM se ejecutan desde la carpeta del módulo (`app/`).
    private val messages = ServerMessages(File("src/main/assets/server-messages.en.json").readText())

    @Test
    fun `traduce los mensajes exactos y deja igual los desconocidos`() {
        assertEquals("Not found", messages.translate("Recurso no encontrado"))
        assertEquals("Algo que la API aún no traduce", messages.translate("Algo que la API aún no traduce"))
    }

    @Test
    fun `los patrones rellenan la plantilla con los grupos`() {
        assertEquals("At most 60 characters", messages.translate("Máximo 60 caracteres"))
        assertEquals("“foto.png” is too large", messages.translate("«foto.png» es demasiado grande"))
    }

    @Test
    fun `las piezas de las copias se traducen dentro del patrón`() {
        assertEquals("The backup has calendars with the same id", messages.translate("La copia tiene calendarios con el mismo id"))
        // Un nombre de fichero no es una pieza: va tal cual aunque coincida con una.
        assertEquals("“calendarios” is too large", messages.translate("«calendarios» es demasiado grande"))
    }

    @Test
    fun `todas las expresiones de la web compilan en Java`() {
        // El constructor ya compila cada una; además, ninguna casa con un texto vacío.
        assertEquals("", messages.translate(""))
    }

    @Test
    fun `reconoce la app de Android y los navegadores`() {
        assertEquals(DeviceKind.App("Google Pixel 9"), deviceKind("Delyra-Android/1.0 (Android 16; Google Pixel 9)"))
        assertEquals(
            DeviceKind.Browser("Edge", "Windows"),
            deviceKind("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0"),
        )
        assertEquals(
            DeviceKind.Browser("Safari", "iOS"),
            deviceKind("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"),
        )
        assertEquals(DeviceKind.Browser(null, null), deviceKind("curl/8.0"))
        assertEquals(DeviceKind.Unknown, deviceKind(null))
    }

    @Test
    fun `horas del resumen de Telegram`() {
        assertEquals(8 * 60 + 5, minutesOf("08:05"))
        assertEquals("22:30", hhmm(22 * 60 + 30))
        assertEquals(8 * 60, minutesOf("no es una hora"))
    }

    @Test
    fun `tamaños de las copias`() {
        assertEquals("512 B", formatSize(512))
        assertEquals("2 KB", formatSize(2048))
        assertEquals("1.5 MB", formatSize(1_572_864))
        assertEquals("", formatSize(null))
    }
}
