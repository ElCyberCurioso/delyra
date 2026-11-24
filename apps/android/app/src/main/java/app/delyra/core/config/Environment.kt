package app.delyra.core.config

import app.delyra.BuildConfig
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl

/**
 * Entornos de Delyra (ADR-0003: solo local y producción). La API no tiene dominio propio: se llega
 * a ella a través del origen de la SPA del calendario, que reenvía `/api/…` por Service Binding.
 */
enum class Environment(val origin: String) {
    PRODUCTION(BuildConfig.PRODUCTION_ORIGIN),
    LOCAL(BuildConfig.LOCAL_ORIGIN);

    val originUrl: HttpUrl get() = origin.toHttpUrl()

    /** URL del canal en vivo de un tablero (`wss://…/api/boards/:id/live`). */
    fun liveUrl(boardId: String): String {
        val scheme = if (originUrl.isHttps) "wss" else "ws"
        val port = if (originUrl.port == HttpUrl.defaultPort(originUrl.scheme)) "" else ":${originUrl.port}"
        return "$scheme://${originUrl.host}$port/api/boards/$boardId/live"
    }

    companion object {
        /** Retrofit se construye siempre con producción; un interceptor reescribe a local en debug. */
        const val API_BASE = BuildConfig.PRODUCTION_ORIGIN + "/api/"

        fun parse(value: String?): Environment =
            if (BuildConfig.ALLOW_LOCAL && value == LOCAL.name) LOCAL else PRODUCTION
    }
}
