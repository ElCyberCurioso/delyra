package app.delyra.navigation

import java.net.URI

/**
 * Enlaces de delyra.app que abre la app (App Links, F8-10; verificados con
 * `https://delyra.app/.well-known/assetlinks.json`): los de los correos de invitación y de
 * recuperación de contraseña. El token va en el fragmento (`#token=…`) y no sale de la memoria.
 */
object AppLinks {
    enum class Kind { Invitation, PasswordReset }

    private const val HOST = "delyra.app"

    fun kind(link: String?): Kind? {
        val uri = link?.let { runCatching { URI(it) }.getOrNull() } ?: return null
        if (uri.scheme != "https" || uri.host != HOST) return null
        return when (uri.path) {
            "/registro" -> Kind.Invitation
            "/restablecer" -> Kind.PasswordReset
            else -> null
        }
    }
}
