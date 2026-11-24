package app.delyra.feature.settings

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import app.delyra.R
import app.delyra.core.model.BackupCounts
import app.delyra.core.ui.LocalAppGraph
import app.delyra.feature.calendar.appLocale
import app.delyra.feature.kanban.shortDateTime
import java.time.ZoneId
import java.util.Locale

/** Formato común de Ajustes (como `apps/calendar/src/settings/format.ts`). */

/** De dónde viene una sesión según su `User-Agent`: la app de Android o un navegador. */
sealed interface DeviceKind {
    data object Unknown : DeviceKind
    /** `Delyra-Android/1.0 (Android 16; Google Pixel 9)`: el modelo. */
    data class App(val model: String) : DeviceKind
    data class Browser(val browser: String?, val system: String?) : DeviceKind
}

// El orden importa: Edge y Opera también dicen «Chrome», y Chrome dice «Safari».
private val BROWSERS = listOf("Edg/" to "Edge", "OPR/" to "Opera", "Firefox/" to "Firefox", "Chrome/" to "Chrome", "Safari/" to "Safari")
private val SYSTEMS = listOf("iPhone" to "iOS", "iPad" to "iOS", "Android" to "Android", "Windows" to "Windows", "Mac OS X" to "macOS", "Linux" to "Linux")
private val APP_AGENT = Regex("""^Delyra-Android/\S+ \(Android [^;]*; ([^)]+)\)""")

/** Sin librerías y sin pretender exactitud, igual que la web. */
fun deviceKind(userAgent: String?): DeviceKind {
    if (userAgent.isNullOrBlank()) return DeviceKind.Unknown
    APP_AGENT.find(userAgent)?.let { return DeviceKind.App(it.groupValues[1].trim()) }
    return DeviceKind.Browser(
        browser = BROWSERS.firstOrNull { userAgent.contains(it.first) }?.second,
        system = SYSTEMS.firstOrNull { userAgent.contains(it.first) }?.second,
    )
}

@Composable
fun describeDevice(userAgent: String?): String = when (val kind = deviceKind(userAgent)) {
    DeviceKind.Unknown -> stringResource(R.string.settings_unknown_device)
    is DeviceKind.App -> stringResource(R.string.settings_device_app, kind.model)
    is DeviceKind.Browser -> {
        val browser = kind.browser ?: stringResource(R.string.settings_device_browser)
        if (kind.system != null) stringResource(R.string.settings_device_on, browser, kind.system) else browser
    }
}

/** Nombre del país (código ISO) en el idioma de la app. */
fun countryName(code: String?, locale: Locale): String? {
    if (code.isNullOrBlank()) return null
    return Locale.Builder().setRegion(code).build().getDisplayCountry(locale).ifBlank { code }
}

/** Fecha y hora corta en la zona de la cuenta. */
@Composable
fun accountDateTime(iso: String): String {
    val zone = LocalAppGraph.current.session.active?.zone ?: ZoneId.systemDefault()
    return shortDateTime(iso, zone, appLocale())
}

fun formatSize(bytes: Long?): String = when {
    bytes == null -> ""
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "${bytes / 1024} KB"
    else -> String.format(Locale.ROOT, "%.1f MB", bytes / 1024.0 / 1024.0)
}

@Composable
fun describeCounts(counts: BackupCounts?): String {
    if (counts == null) return ""
    return listOfNotNull(
        pluralStringResource(R.plurals.backups_count_calendars, counts.calendars, counts.calendars),
        pluralStringResource(R.plurals.backups_count_events, counts.events, counts.events),
        pluralStringResource(R.plurals.backups_count_boards, counts.boards, counts.boards),
        pluralStringResource(R.plurals.backups_count_cards, counts.cards, counts.cards),
        if (counts.attachments > 0) pluralStringResource(R.plurals.backups_count_attachments, counts.attachments, counts.attachments) else null,
    ).joinToString(" · ")
}

/** Eventos del historial de seguridad que conviene destacar: pueden indicar que alguien intenta entrar. */
val SUSPICIOUS_EVENTS = setOf("login.failure", "login.locked", "second_factor.failure", "reauth.failure")

private val AUDIT_LABELS = mapOf(
    "user.registered" to R.string.audit_user_registered,
    "login.success" to R.string.audit_login_success,
    "login.failure" to R.string.audit_login_failure,
    "login.locked" to R.string.audit_login_locked,
    "second_factor.success" to R.string.audit_second_factor_success,
    "second_factor.failure" to R.string.audit_second_factor_failure,
    "second_factor.recovery_code_used" to R.string.audit_second_factor_recovery_code_used,
    "totp.enrolled" to R.string.audit_totp_enrolled,
    "totp.reconfigured" to R.string.audit_totp_reconfigured,
    "passkey.added" to R.string.audit_passkey_added,
    "passkey.removed" to R.string.audit_passkey_removed,
    "recovery_codes.regenerated" to R.string.audit_recovery_codes_regenerated,
    "password.reset_requested" to R.string.audit_password_reset_requested,
    "password.reset" to R.string.audit_password_reset,
    "password.changed" to R.string.audit_password_changed,
    "profile.updated" to R.string.audit_profile_updated,
    "settings.updated" to R.string.audit_settings_updated,
    "reauth.failure" to R.string.audit_reauth_failure,
    "telegram.linked" to R.string.audit_telegram_linked,
    "telegram.unlinked" to R.string.audit_telegram_unlinked,
    "session.logout" to R.string.audit_session_logout,
    "session.revoked" to R.string.audit_session_revoked,
    "admin.user_disabled" to R.string.audit_admin_user_disabled,
    "admin.user_enabled" to R.string.audit_admin_user_enabled,
    "admin.totp_reset" to R.string.audit_admin_totp_reset,
    "admin.system_backup" to R.string.audit_admin_system_backup,
    "backup.restore_started" to R.string.audit_backup_restore_started,
    "backup.restore_undone" to R.string.audit_backup_restore_undone,
    "board.invitation_created" to R.string.audit_board_invitation_created,
    "board.invitation_accepted" to R.string.audit_board_invitation_accepted,
)

/** Un evento sin traducir (uno nuevo de la API) se muestra tal cual, como en la web. */
@Composable
fun auditLabel(event: String): String = AUDIT_LABELS[event]?.let { stringResource(it) } ?: event
