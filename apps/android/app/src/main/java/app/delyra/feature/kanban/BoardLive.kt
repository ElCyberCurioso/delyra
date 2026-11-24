package app.delyra.feature.kanban

import app.delyra.core.config.Environment
import app.delyra.core.model.LiveMessage
import app.delyra.core.model.LivePerson
import app.delyra.core.network.ApiJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import kotlin.random.Random

/** URL del canal en vivo (producción; el interceptor la lleva al entorno actual con `Origin`). */
fun liveUrl(boardId: String): String = "${Environment.API_BASE}boards/$boardId/live"

/**
 * Espera antes de reconectar, como `live.ts`: 1 s, 2 s, 4 s… hasta 30 s, más hasta medio segundo
 * al azar para que no reconecten todos los dispositivos a la vez.
 */
fun liveRetryDelay(retries: Int, jitterMs: Long = Random.nextLong(500)): Long =
    (1_000L shl retries.coerceIn(0, 5)).coerceAtMost(30_000L) + jitterMs

/**
 * Canal en vivo de un tablero (F7-05), como `live.ts` de la web: el servidor solo avisa de que
 * algo cambió y de quién mira; los datos se vuelven a pedir a la API. Si se corta, se reconecta
 * con espera creciente y, al volver, se refresca por si se perdió algo. El cierre 4403 (o un 403/404
 * en el saludo) significa que ya no hay acceso: se deja de reconectar.
 *
 * Los avisos se entregan en [scope] (el hilo principal en los ViewModel).
 */
class BoardLive(
    private val client: OkHttpClient,
    private val url: String,
    private val scope: CoroutineScope,
    private val onChanged: (by: String?) -> Unit,
    private val onPresence: (List<LivePerson>) -> Unit,
    private val onRevoked: () -> Unit,
    private val retryDelay: (Int) -> Long = { liveRetryDelay(it) },
) {
    private var socket: WebSocket? = null
    private var retryJob: Job? = null
    private var pingJob: Job? = null
    private var retries = 0
    private var stopped = true

    /** Hay conexión abierta ahora mismo. */
    var online: Boolean = false
        private set

    fun start() {
        if (!stopped) return
        stopped = false
        connect()
    }

    fun stop() {
        stopped = true
        retryJob?.cancel()
        pingJob?.cancel()
        socket?.close(1000, null)
        socket = null
        online = false
        onPresence(emptyList())
    }

    private fun connect() {
        val request = Request.Builder().url(url).build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                scope.launch {
                    if (stopped || webSocket !== socket) return@launch
                    online = true
                    // Tras un corte puede haberse perdido algún aviso: se refresca todo.
                    if (retries > 0) onChanged(null)
                    retries = 0
                    pingJob?.cancel()
                    pingJob = scope.launch {
                        while (isActive) {
                            delay(PING_MS)
                            webSocket.send("ping")
                        }
                    }
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text == "pong") return
                val message = runCatching { ApiJson.decodeFromString<LiveMessage>(text) }.getOrNull() ?: return
                scope.launch {
                    if (stopped || webSocket !== socket) return@launch
                    when (message.type) {
                        "changed" -> onChanged(message.by)
                        "presence" -> onPresence(message.users)
                        "revoked" -> revoked()
                    }
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, null)
                scope.launch {
                    if (webSocket !== socket) return@launch
                    if (code == REVOKED) revoked() else retry()
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                scope.launch {
                    if (webSocket !== socket) return@launch
                    // 403/404 en el saludo: sin acceso al tablero.
                    if (response?.code == 403 || response?.code == 404) revoked() else retry()
                }
            }
        })
    }

    private fun revoked() {
        if (stopped) return
        stop()
        onRevoked()
    }

    private fun retry() {
        pingJob?.cancel()
        online = false
        onPresence(emptyList())
        if (stopped) return
        retryJob?.cancel()
        val wait = retryDelay(retries)
        retries++
        retryJob = scope.launch {
            delay(wait)
            if (!stopped) connect()
        }
    }

    private companion object {
        const val PING_MS = 30_000L
        const val REVOKED = 4403
    }
}
