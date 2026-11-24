package app.delyra.core.network

import app.delyra.core.config.Environment
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Las cabeceras que exige el CSRF de la API (F1-05) salen en cada petición. */
class DelyraInterceptorTest {
    private lateinit var server: MockWebServer
    private lateinit var client: OkHttpClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = OkHttpClient.Builder()
            .addInterceptor(DelyraInterceptor({ Environment.PRODUCTION }, "Delyra-Android/test", { "en" }))
            .build()
    }

    @After
    fun tearDown() {
        server.close()
    }

    @Test
    fun `toda peticion lleva Origin, User-Agent y Accept-Language`() {
        server.enqueue(MockResponse(code = 200, body = "{}"))
        client.newCall(Request.Builder().url(server.url("/api/auth/me")).build()).execute().close()
        val recorded = server.takeRequest()
        assertEquals("https://delyra.app", recorded.headers["Origin"])
        assertEquals("Delyra-Android/test", recorded.headers["User-Agent"])
        assertEquals("en", recorded.headers["Accept-Language"])
    }

    @Test
    fun `una mutacion sin cuerpo se envia como JSON vacio`() {
        server.enqueue(MockResponse(code = 204))
        server.enqueue(MockResponse(code = 204))
        client.newCall(Request.Builder().url(server.url("/api/cards/x/archive")).post(ByteArray(0).toRequestBody(null)).build()).execute().close()
        client.newCall(Request.Builder().url(server.url("/api/cards/x")).delete().build()).execute().close()
        assertTrue(server.takeRequest().headers["Content-Type"]!!.startsWith("application/json"))
        val delete = server.takeRequest()
        assertEquals("DELETE", delete.method)
        assertTrue(delete.headers["Content-Type"]!!.startsWith("application/json"))
    }

    @Test
    fun `una subida conserva su tipo`() {
        server.enqueue(MockResponse(code = 201, body = "{}"))
        val body = "hola".toRequestBody("text/plain".toMediaType())
        client.newCall(
            Request.Builder().url(server.url("/api/cards/x/attachments")).header("X-Filename", "nota.txt").post(body).build(),
        ).execute().close()
        val recorded = server.takeRequest()
        assertTrue(recorded.headers["Content-Type"]!!.startsWith("text/plain"))
        assertEquals("4", recorded.headers["Content-Length"])
    }
}
