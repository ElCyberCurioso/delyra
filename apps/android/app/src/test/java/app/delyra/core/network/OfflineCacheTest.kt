package app.delyra.core.network

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.Headers.Companion.headersOf
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.IOException

/** Lecturas sin conexión (F8-09): red primero, si no lo guardado; solo lo de la PWA. */
class OfflineCacheTest {
    @get:Rule
    val folder = TemporaryFolder()

    private lateinit var server: MockWebServer
    private lateinit var cache: OfflineCache
    private lateinit var client: OkHttpClient
    private var clock = 1_000_000L

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        cache = OfflineCache(folder.newFolder("api")) { clock }
        client = OkHttpClient.Builder()
            .cache(cache.cache)
            .addInterceptor(cache.interceptor)
            .addNetworkInterceptor(cache.storeInterceptor)
            .build()
    }

    @After
    fun tearDown() {
        server.close()
        cache.cache.close()
    }

    /** Como la API: todo con `no-store`. */
    private fun api(body: String) = MockResponse(code = 200, headers = headersOf("Cache-Control", "no-store", "Content-Type", "application/json"), body = body)

    private fun get(path: String): String = client.newCall(Request.Builder().url(server.url(path)).build()).execute().use { it.body.string() }

    private fun getResponse(path: String) = client.newCall(Request.Builder().url(server.url(path)).build()).execute()

    @Test
    fun `sin red sirve la última lectura guardada y lo dice`() {
        server.enqueue(api("""{"events":[1]}"""))
        assertEquals("""{"events":[1]}""", get("/api/events?from=a&to=b"))
        assertFalse(cache.offline.value)

        server.close()
        getResponse("/api/events?from=a&to=b").use { response ->
            assertEquals("""{"events":[1]}""", response.body.string())
            assertEquals("1", response.header(OfflineCache.OFFLINE_HEADER))
        }
        assertTrue(cache.offline.value)
    }

    @Test
    fun `con red siempre pregunta al servidor`() {
        server.enqueue(api("""{"v":1}"""))
        server.enqueue(api("""{"v":2}"""))
        assertEquals("""{"v":1}""", get("/api/boards"))
        assertEquals("""{"v":2}""", get("/api/boards"))
        assertEquals(2, server.requestCount)
    }

    @Test(expected = IOException::class)
    fun `otro rango de fechas no está guardado`() {
        server.enqueue(api("""{"events":[]}"""))
        get("/api/events?from=a&to=b")
        server.close()
        get("/api/events?from=c&to=d")
    }

    @Test(expected = IOException::class)
    fun `lo que no es de la PWA no se guarda`() {
        server.enqueue(api("""{"sessions":[]}"""))
        get("/api/me/sessions")
        server.close()
        get("/api/me/sessions")
    }

    @Test(expected = IOException::class)
    fun `las escrituras nunca salen de la caché`() {
        server.enqueue(api("""{"board":{}}"""))
        val post = Request.Builder().url(server.url("/api/boards")).post("{}".toRequestBody("application/json".toMediaType())).build()
        client.newCall(post).execute().close()
        server.close()
        get("/api/boards")
    }

    @Test(expected = IOException::class)
    fun `pasados 14 días ya no vale`() {
        server.enqueue(api("""{"boards":[]}"""))
        get("/api/boards")
        server.close()
        clock = System.currentTimeMillis() + OfflineCache.MAX_AGE_MS + 60_000
        get("/api/boards")
    }

    @Test(expected = IOException::class)
    fun `al cerrar sesión se borra todo`() {
        server.enqueue(api("""{"user":{}}"""))
        get("/api/auth/me")
        cache.clear()
        server.close()
        get("/api/auth/me")
    }

    @Test
    fun `tableros y tarjetas por su id, sí`() {
        assertTrue(OfflineCache.isOfflineReadable(server.url("/api/boards/b1")))
        assertTrue(OfflineCache.isOfflineReadable(server.url("/api/cards/c1")))
        assertFalse(OfflineCache.isOfflineReadable(server.url("/api/boards/b1/members")))
        assertFalse(OfflineCache.isOfflineReadable(server.url("/api/backups")))
    }
}
