package app.delyra.feature.kanban

import app.delyra.core.model.LivePerson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Canal en vivo del tablero contra un WebSocket de verdad (MockWebServer). */
class BoardLiveTest {
    private lateinit var server: MockWebServer
    private val client = OkHttpClient()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)

    private val presence = LinkedBlockingQueue<List<LivePerson>>()
    private val changed = LinkedBlockingQueue<String>()
    private val revoked = CountDownLatch(1)

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        scope.cancel()
        server.close()
    }

    /** El servidor acepta el WebSocket y entrega su extremo para mandar mensajes. */
    private fun acceptSocket(): LinkedBlockingQueue<WebSocket> {
        val sockets = LinkedBlockingQueue<WebSocket>()
        server.enqueue(
            MockResponse.Builder().webSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    sockets.add(webSocket)
                }

                // Completa el cierre que pide la app (si no, el servidor de pruebas no se apaga).
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(code, null)
                }
            }).build(),
        )
        return sockets
    }

    private fun live() = BoardLive(
        client = client,
        url = server.url("/api/boards/b1/live").toString(),
        scope = scope,
        onChanged = { changed.add(it ?: "(refresco)") },
        onPresence = { if (it.isNotEmpty()) presence.add(it) },
        onRevoked = { revoked.countDown() },
        retryDelay = { 20 },
    )

    @Test
    fun `presencia y cambios, pong y mensajes raros se ignoran`() {
        val sockets = acceptSocket()
        val live = live()
        live.start()
        val ws = sockets.poll(5, TimeUnit.SECONDS)!!
        ws.send("""{"type":"presence","users":[{"id":"u2","name":"Ana"}]}""")
        assertEquals(listOf(LivePerson("u2", "Ana")), presence.poll(5, TimeUnit.SECONDS))
        ws.send("pong")
        ws.send("no es json")
        ws.send("""{"type":"changed","by":"u2"}""")
        assertEquals("u2", changed.poll(5, TimeUnit.SECONDS))
        assertTrue(live.online)
        live.stop()
    }

    @Test
    fun `cierre 4403 = acceso retirado y no se reconecta`() {
        val sockets = acceptSocket()
        live().start()
        sockets.poll(5, TimeUnit.SECONDS)!!.close(4403, "revoked")
        assertTrue(revoked.await(5, TimeUnit.SECONDS))
        Thread.sleep(300)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `un 403 en el saludo tambien es acceso retirado`() {
        server.enqueue(MockResponse(code = 403))
        live().start()
        assertTrue(revoked.await(5, TimeUnit.SECONDS))
    }

    @Test
    fun `tras un corte reconecta y pide refrescar`() {
        val first = acceptSocket()
        val second = acceptSocket()
        val live = live()
        live.start()
        first.poll(5, TimeUnit.SECONDS)!!.close(1001, "reinicio")
        assertTrue(second.poll(5, TimeUnit.SECONDS) != null)
        // Al volver se refresca por si se perdió algún aviso mientras estaba cortado.
        assertEquals("(refresco)", changed.poll(5, TimeUnit.SECONDS))
        assertEquals(2, server.requestCount)
        live.stop()
    }

    @Test
    fun `parado no avisa de nada`() {
        val sockets = acceptSocket()
        val live = live()
        live.start()
        val ws = sockets.poll(5, TimeUnit.SECONDS)!!
        live.stop()
        ws.send("""{"type":"changed","by":"u2"}""")
        assertNull(changed.poll(300, TimeUnit.MILLISECONDS))
    }

    @Test
    fun `espera creciente con tope de 30 s`() {
        assertEquals(1_000L, liveRetryDelay(0, jitterMs = 0))
        assertEquals(8_000L, liveRetryDelay(3, jitterMs = 0))
        assertEquals(30_000L, liveRetryDelay(9, jitterMs = 0))
        assertEquals(4_499L, liveRetryDelay(2, jitterMs = 499))
        assertTrue(liveRetryDelay(0) in 1_000L until 1_500L)
    }
}
