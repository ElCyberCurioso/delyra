package app.delyra.core.network

import app.delyra.core.config.Environment
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/**
 * Cabeceras que la API espera de cualquier cliente:
 *
 * - `Origin` del entorno: el middleware CSRF rechaza (403) toda mutación sin un origen de la lista
 *   blanca (`isAllowedOrigin`, F1-05).
 * - `Content-Type: application/json` también en las mutaciones sin cuerpo (cerrar sesión, archivar,
 *   borrar…): el CSRF lo exige a todo lo que no sea GET/HEAD/OPTIONS (415 si falta). Las subidas
 *   llevan su propio tipo y `X-Filename`, y no se tocan.
 * - `User-Agent` legible para el historial de sesiones de Ajustes y `Accept-Language` para los
 *   nombres que localiza la API (calendarios por defecto, festivos).
 *
 * En debug, además, reescribe el host de producción al `pnpm dev` local si ese es el entorno.
 */
class DelyraInterceptor(
    private val environment: () -> Environment,
    private val userAgent: String,
    private val language: () -> String,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val env = environment()
        val original = chain.request()
        val origin = env.originUrl
        val url = if (env == Environment.PRODUCTION) {
            original.url
        } else {
            original.url.newBuilder().scheme(origin.scheme).host(origin.host).port(origin.port).build()
        }
        val builder = original.newBuilder()
            .url(url)
            .header("Origin", env.origin)
            .header("User-Agent", userAgent)
            .header("Accept-Language", language())
        if (original.header("Accept") == null) builder.header("Accept", "application/json")

        val mutating = original.method !in SAFE_METHODS
        val body = original.body
        if (mutating && original.header("X-Filename") == null && (body == null || body.contentType() == null)) {
            builder.method(original.method, EMPTY_JSON)
        }
        return chain.proceed(builder.build())
    }

    private companion object {
        val SAFE_METHODS = setOf("GET", "HEAD", "OPTIONS")
        val EMPTY_JSON = ByteArray(0).toRequestBody("application/json".toMediaType())
    }
}
