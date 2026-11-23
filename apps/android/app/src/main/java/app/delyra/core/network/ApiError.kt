package app.delyra.core.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

/** Error de la API en RFC 9457 (`application/problem+json`, `packages/shared/src/problem.ts`). */
@Serializable
data class ProblemDetails(
    val type: String = "",
    val title: String = "",
    val status: Int = 0,
    val detail: String? = null,
    val requestId: String? = null,
    val errors: List<InvalidParam> = emptyList(),
)

@Serializable
data class InvalidParam(val path: String, val message: String)

/** Lo que la interfaz necesita saber de un fallo. */
sealed interface ApiError {
    /** Sin conexión o la conexión se cortó. */
    data object Network : ApiError

    /** La sesión ya no vale (caducada, revocada o pendiente del segundo factor). */
    data class Unauthorized(val detail: String?) : ApiError

    /** Demasiados intentos (429), con la espera que indica `Retry-After`. */
    data class RateLimited(val retryAfterSeconds: Int?, val detail: String?) : ApiError

    /** 422: errores por campo, con la ruta del esquema Zod (`title`, `due.at`…). */
    data class Validation(val fields: Map<String, String>, val detail: String?) : ApiError

    /** Cualquier otro estado HTTP (400, 403, 404, 409, 413, 415, 5xx). */
    data class Http(val status: Int, val detail: String?, val requestId: String?) : ApiError

    data class Unexpected(val message: String?) : ApiError
}

class ApiException(val error: ApiError) : Exception(error.toString())

private val problemJson = Json { ignoreUnknownKeys = true; isLenient = true }

fun Throwable.toApiError(): ApiError = when (this) {
    is ApiException -> error
    is HttpException -> {
        val response = response()
        val raw = runCatching { response?.errorBody()?.string() }.getOrNull()
        val problem = raw?.let { runCatching { problemJson.decodeFromString<ProblemDetails>(it) }.getOrNull() }
        val detail = problem?.detail
        when (val status = code()) {
            401 -> ApiError.Unauthorized(detail)
            429 -> ApiError.RateLimited(response?.headers()?.get("Retry-After")?.toIntOrNull(), detail)
            422 -> ApiError.Validation(problem?.errors.orEmpty().associate { it.path to it.message }, detail)
            else -> ApiError.Http(status, detail, problem?.requestId)
        }
    }
    is IOException -> ApiError.Network
    else -> ApiError.Unexpected(message)
}

/**
 * Ejecuta una llamada a la API y la convierte en [Result]. La cancelación de corrutinas se propaga
 * (no es un error de la API).
 */
suspend inline fun <T> apiCall(crossinline block: suspend () -> T): Result<T> = try {
    Result.success(block())
} catch (e: CancellationException) {
    throw e
} catch (e: Throwable) {
    Result.failure(ApiException(e.toApiError()))
}

val Throwable.apiError: ApiError get() = toApiError()
