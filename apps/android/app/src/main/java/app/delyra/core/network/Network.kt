package app.delyra.core.network

import android.os.Build
import app.delyra.BuildConfig
import app.delyra.core.config.Environment
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

/** JSON de la API: tolerante con campos nuevos para que un cambio de la API no rompa la app. */
val ApiJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    encodeDefaults = true
}

/**
 * Cliente HTTP compartido. Un 401 fuera de `/api/auth/…` significa que la sesión caducó o se
 * revocó en otro dispositivo: se avisa para volver al login.
 */
class Network(
    val cookieJar: SessionCookieJar,
    environment: () -> Environment,
    language: () -> String,
) {
    private val _sessionExpired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val sessionExpired: SharedFlow<Unit> = _sessionExpired

    private val expiryWatcher = Interceptor { chain ->
        val response = chain.proceed(chain.request())
        if (response.code == 401 && !chain.request().url.encodedPath.startsWith("/api/auth/")) {
            _sessionExpired.tryEmit(Unit)
        }
        response
    }

    val userAgent: String =
        "Delyra-Android/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE}; ${Build.MANUFACTURER} ${Build.MODEL})"

    val client: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .addInterceptor(DelyraInterceptor(environment, userAgent, language))
        .addInterceptor(expiryWatcher)
        .addDebugInterceptors()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    val retrofit: Retrofit = Retrofit.Builder()
        .baseUrl(Environment.API_BASE)
        .client(client)
        .addConverterFactory(ApiJson.asConverterFactory("application/json".toMediaType()))
        .build()

    inline fun <reified T> create(): T = retrofit.create(T::class.java)
}
