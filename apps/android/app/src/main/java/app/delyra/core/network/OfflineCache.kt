package app.delyra.core.network

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.Cache
import okhttp3.CacheControl
import okhttp3.HttpUrl
import okhttp3.Interceptor
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Lecturas sin conexión (F8-09), con el mismo alcance que la PWA (F7-01, `pwa-options.ts`): lo
 * necesario para ver la agenda y los tableros (sesión, calendarios, eventos, festivos, tareas con
 * fecha, tableros y tarjetas). Primero la red; si no hay (o no contesta en [NETWORK_TIMEOUT_S]
 * segundos), la última respuesta guardada, de como mucho [MAX_AGE_MS]. Nada más se guarda.
 *
 * Es la caché HTTP de OkHttp en una carpeta privada de la app, fuera de las copias:
 * - [storeInterceptor] (de red): la API manda `Cache-Control: no-store`; para estas lecturas se
 *   cambia por `private, max-age=0`, que se guarda pero se vuelve a pedir siempre a la red.
 * - [interceptor] (de aplicación): si la red falla, se pide `only-if-cached` y se marca
 *   [offline] para que la interfaz lo diga.
 * Se vacía al cerrar sesión y cuando entra otra cuenta ([clear]), para que nadie vea sin conexión
 * los datos de otra persona.
 */
class OfflineCache(directory: File, private val now: () -> Long = System::currentTimeMillis) {
    val cache = Cache(directory, MAX_BYTES)

    private val _offline = MutableStateFlow(false)
    /** La última respuesta salió de la caché porque no había red. */
    val offline: StateFlow<Boolean> = _offline.asStateFlow()

    val storeInterceptor = Interceptor { chain ->
        val request = chain.request()
        val response = chain.proceed(request)
        if (request.method == "GET" && response.code == 200 && isOfflineReadable(request.url)) {
            response.newBuilder().header("Cache-Control", "private, max-age=0").removeHeader("Pragma").build()
        } else {
            response
        }
    }

    val interceptor = Interceptor { chain ->
        val request = chain.request()
        if (request.method != "GET" || !isOfflineReadable(request.url)) {
            return@Interceptor chain.proceed(request).also { _offline.value = false }
        }
        try {
            chain.withConnectTimeout(NETWORK_TIMEOUT_S, TimeUnit.SECONDS).proceed(request).also { _offline.value = false }
        } catch (failure: IOException) {
            val cached = try {
                chain.proceed(request.newBuilder().cacheControl(CacheControl.FORCE_CACHE).build())
            } catch (_: IOException) {
                throw failure
            }
            if (cached.code != 200 || now() - cached.receivedResponseAtMillis > MAX_AGE_MS) {
                cached.close()
                throw failure
            }
            _offline.value = true
            cached.newBuilder().header(OFFLINE_HEADER, "1").build()
        }
    }

    /** Borra todo lo guardado (al cerrar sesión o al entrar otra cuenta). */
    fun clear() {
        runCatching { cache.evictAll() }
        _offline.value = false
    }

    companion object {
        const val MAX_BYTES = 20L * 1024 * 1024
        const val MAX_AGE_MS = 14L * 24 * 60 * 60 * 1000
        const val NETWORK_TIMEOUT_S = 4
        /** Marca las respuestas servidas sin conexión (para pruebas y depuración). */
        const val OFFLINE_HEADER = "X-Delyra-Offline"

        /** Las mismas rutas que la PWA, más el detalle del tablero (para abrirlo sin conexión). */
        private val READABLE = Regex("""^/api/(auth/me|calendars|events|cards/due|holidays|boards|boards/[^/]+|cards/[^/]+)$""")

        fun isOfflineReadable(url: HttpUrl): Boolean = READABLE.matches(url.encodedPath)
    }
}
