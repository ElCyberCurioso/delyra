package app.delyra.core.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.net.toUri

/**
 * Abre una página de Delyra en una pestaña personalizada (Custom Tab), con el color de la marca.
 * Es para lo poco que solo se hace en la web: conectar Google o Microsoft 365 (el OAuth vuelve al
 * navegador, que es quien tiene la sesión web; ADR-0016). Sin navegador compatible, cualquier app
 * que abra enlaces; sin ninguna, devuelve `false`.
 */
fun openInBrowser(context: Context, url: String): Boolean {
    val uri = url.toUri()
    return try {
        CustomTabsIntent.Builder()
            .setShowTitle(true)
            .setDefaultColorSchemeParams(CustomTabColorSchemeParams.Builder().setToolbarColor(BRAND_GREEN).build())
            .build()
            .launchUrl(context, uri)
        true
    } catch (_: ActivityNotFoundException) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }
}

private const val BRAND_GREEN = 0xFF007145.toInt()
