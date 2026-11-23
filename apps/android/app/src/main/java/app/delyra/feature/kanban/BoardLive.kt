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

/**
 * Canal en vivo de un tablero (F7-05), como `live.ts` de la web: el servidor solo avisa de que
 * algo cambió y de quién mira; los datos se vuelven a pedir a la API. Si se corta, se reconecta con
 * espera creciente (hasta 30 s) y, al volver, se refresca por si se perdió algo. El cierre 4403
 * significa que ya no hay acceso: se deja de reconectar.
 */
class BoardLive(
    private val client: OkHttpClient,
    private val boardId: String,
    private val scope: CoroutineScope,
    private val onChanged: (by: String?) -> Unit,
    private val onPresence: (List<LivePerson>) -> Unit,
    private val onRevoked: () -> Unit,
) {
    private var socket: WebSocket? = null
    private var retryJob: Job? = null
    private var pingJob: Job? = null
    private var retries = 0
    private var stopped = true

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
        onPresence(emptyList())
    }

    private fun connect() {
        // URL de producción: el interceptor la lleva al entorno actual y añade `Origin` y la cookie.
        val request = Request.Builder().url("${Environment.API_BASE}boards/$boardId/live").build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                scope.launch {
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
                    when (message.type) {
                        "changed" -> onChanged(message.by)
                        "presence" -> onPresence(message.users)
                        "revoked" -> revoked()
                    }
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, null)
                scope.launch { if (code == REVOKED) revoked() else retry() }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                scope.launch {
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
        if (stopped) return
        retryJob?.cancel()
        val wait = (1_000L shl retries.coerceAtMost(5)).coerceAtMost(MAX_RETRY_MS)
        retries++
        retryJob = scope.launch {
            delay(wait)
            if (!stopped) connect()
        }
    }

    private companion object {
        const val PING_MS = 30_000L
        const val MAX_RETRY_MS = 30_000L
        const val REVOKED = 4403
    }
}
