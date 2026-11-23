package app.delyra.core.network

import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor

/** Solo en debug: log de cabeceras (sin cuerpos) y con la cookie de sesión redactada. */
fun OkHttpClient.Builder.addDebugInterceptors(): OkHttpClient.Builder = addNetworkInterceptor(
    HttpLoggingInterceptor().apply {
        level = HttpLoggingInterceptor.Level.HEADERS
        redactHeader("Cookie")
        redactHeader("Set-Cookie")
    },
)
