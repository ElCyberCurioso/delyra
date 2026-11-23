package app.delyra.feature.auth

import android.annotation.SuppressLint
import android.graphics.Color
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.key
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.net.toUri
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import app.delyra.R
import app.delyra.core.ui.LocalAppGraph
import app.delyra.core.ui.isDark

/**
 * Comprobación anti-bots (Turnstile) para login, registro y recuperación.
 *
 * El widget solo funciona en un origen de Delyra (la API comprueba el `hostname` de `siteverify`),
 * así que se carga `/{origen}/mobile/turnstile.html` en un WebView. El token vuelve por un
 * `WebMessageListener` que solo acepta mensajes del marco principal de ese origen exacto: ninguna
 * otra página podría hablar con la app. Cada token sirve una vez: cambiar [resetKey] pide otro.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun TurnstileWidget(
    action: String,
    resetKey: Int,
    onToken: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val graph = LocalAppGraph.current
    val environment by graph.environmentFlow.collectAsState()
    val origin = environment.origin
    val dark = MaterialTheme.colorScheme.isDark
    val language = graph.languageTag()
    val currentOnToken by rememberUpdatedState(onToken)
    var reply by remember { mutableStateOf<JavaScriptReplyProxy?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    val supported = remember { WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) }

    LaunchedEffect(resetKey) {
        if (resetKey > 0) {
            currentOnToken(null)
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) reply?.postMessage("reset")
        }
    }

    Column(modifier.fillMaxWidth()) {
        if (!supported) {
            Text(stringResource(R.string.turnstile_unsupported), color = MaterialTheme.colorScheme.error)
            return@Column
        }
        val url = remember(origin, dark, language, action) {
            "$origin/mobile/turnstile.html".toUri().buildUpon()
                .appendQueryParameter("theme", if (dark) "dark" else "light")
                .appendQueryParameter("lang", language)
                .appendQueryParameter("action", action)
                .build().toString()
        }
        key(origin) {
        AndroidView(
            modifier = Modifier.fillMaxWidth().height(72.dp),
            factory = { context ->
                WebView(context).apply {
                    setBackgroundColor(Color.TRANSPARENT)
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    CookieManager.getInstance().setAcceptCookie(true)
                    CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                    webViewClient = object : WebViewClient() {
                        // La página no navega a ningún sitio: cualquier intento se bloquea.
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                            request.isForMainFrame

                        // Si el proceso del WebView muere, no se arrastra a la app: se pide reintentar.
                        override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                            failure = "render"
                            currentOnToken(null)
                            return true
                        }
                    }
                    if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.addWebMessageListener(this, "delyraTurnstile", setOf(origin)) { _, message, sourceOrigin, isMainFrame, proxy ->
                        if (!isMainFrame || sourceOrigin.toString().trimEnd('/') != origin) return@addWebMessageListener
                        reply = proxy
                        val data = message.data ?: return@addWebMessageListener
                        when {
                            data.startsWith("token:") -> {
                                failure = null
                                currentOnToken(data.removePrefix("token:"))
                            }
                            data == "expired" -> currentOnToken(null)
                            data.startsWith("error:") -> {
                                failure = data.removePrefix("error:")
                                currentOnToken(null)
                            }
                        }
                    }
                    loadUrl(url)
                }
            },
            onRelease = { it.destroy() },
        )
        }
        if (failure != null) {
            Text(
                stringResource(R.string.turnstile_failed),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
    DisposableEffect(Unit) { onDispose { reply = null } }
}
