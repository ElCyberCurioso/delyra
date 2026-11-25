package app.delyra.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Importaciones, suscripciones iCal, sincronización con Google, Teams en tableros y panel de
 * administración (`schemas/imports.ts`, `microsoft.ts`, `account.ts`, `backups.ts`).
 */

/** Un calendario encontrado en el fichero o en la cuenta de Google. */
@Serializable
data class ImportCalendarPreview(
    /** Clave dentro de la importación (`0`, `1`…). */
    val key: String,
    val name: String,
    val color: String? = null,
    val timeZone: String? = null,
    val events: Int = 0,
    val recurring: Int = 0,
    val withReminders: Int = 0,
    val birthdays: Int = 0,
    val firstStart: String? = null,
    val lastStart: String? = null,
    /** Un calendario propio con el mismo nombre, si existe. */
    val suggestedCalendarId: String? = null,
    /** Festivos, números de semana… se proponen sin importar. */
    val suggestSkip: Boolean = false,
)

@Serializable
data class ImportReportCalendar(
    val key: String,
    val name: String,
    val calendarId: String? = null,
    val created: Int = 0,
    val updated: Int = 0,
    val unchanged: Int = 0,
    val skipped: Int = 0,
)

@Serializable
data class ImportReport(
    val created: Int = 0,
    val updated: Int = 0,
    val unchanged: Int = 0,
    val skipped: Int = 0,
    val calendars: List<ImportReportCalendar> = emptyList(),
    val warnings: List<String> = emptyList(),
)

@Serializable
data class ImportProgress(val done: Int = 0, val total: Int = 0)

/** `source`: `file` o `google`. `status`: `analyzing`, `ready`, `importing`, `succeeded`, `failed` o `expired`. */
@Serializable
data class ImportInfo(
    val id: String,
    val source: String,
    val status: String,
    val filename: String? = null,
    val calendars: List<ImportCalendarPreview> = emptyList(),
    val warnings: List<String> = emptyList(),
    val progress: ImportProgress = ImportProgress(),
    val report: ImportReport? = null,
    val error: String? = null,
    val createdAt: String,
    val finishedAt: String? = null,
)

@Serializable
data class ImportResponse(@SerialName("import") val item: ImportInfo)

@Serializable
data class ImportsResponse(val imports: List<ImportInfo>)

/** `status`: `pending`, `ok` o `error` (suscripciones, Google y Teams). */
@Serializable
data class SubscriptionInfo(
    val id: String,
    val calendarId: String,
    val name: String,
    val color: String,
    /** Dirección enmascarada: la completa es secreta y no vuelve a salir del servidor. */
    val urlHint: String,
    val status: String,
    val error: String? = null,
    val events: Int = 0,
    val lastSyncedAt: String? = null,
    val nextSyncAt: String? = null,
)

@Serializable
data class SubscriptionResponse(val subscription: SubscriptionInfo)

@Serializable
data class SubscriptionsResponse(val subscriptions: List<SubscriptionInfo>)

@Serializable
data class SubscribeRequest(val url: String)

@Serializable
data class GoogleStatus(val enabled: Boolean = false)

/** `status`: `ok` o `revoked` (Google retiró el permiso o caducó). */
@Serializable
data class GoogleConnection(val email: String? = null, val status: String, val connectedAt: String)

@Serializable
data class GoogleSyncedCalendar(
    val id: String,
    val calendarId: String,
    val name: String,
    val color: String,
    val reminders: Boolean = true,
    val status: String,
    val error: String? = null,
    val events: Int = 0,
    val lastSyncedAt: String? = null,
    val nextSyncAt: String? = null,
)

@Serializable
data class GoogleSyncInfo(
    /** Falso si el servidor no tiene el cliente OAuth configurado. */
    val enabled: Boolean = false,
    val connection: GoogleConnection? = null,
    val calendars: List<GoogleSyncedCalendar> = emptyList(),
)

@Serializable
data class GoogleAccountCalendar(
    val googleCalendarId: String,
    val name: String,
    val color: String? = null,
    val suggestSkip: Boolean = false,
    val synced: Boolean = false,
)

@Serializable
data class GoogleAccountCalendarsResponse(val calendars: List<GoogleAccountCalendar>)

@Serializable
data class AddGoogleSyncRequest(val googleCalendarId: String, val reminders: Boolean)

// ── Teams en tableros ──

@Serializable
data class MicrosoftConnection(val email: String? = null, val status: String)

@Serializable
data class MicrosoftBoardSync(
    /** El volcado lo configuró quien mira (si no, otra persona del tablero). */
    val mine: Boolean,
    val columnId: String,
    val onlyTeams: Boolean = true,
    val daysAhead: Int = 14,
    val status: String,
    val error: String? = null,
    val cards: Int = 0,
    val lastSyncedAt: String? = null,
    val nextSyncAt: String? = null,
)

@Serializable
data class MicrosoftBoardInfo(
    /** Falso si el servidor no tiene la app de Microsoft configurada. */
    val enabled: Boolean = false,
    val connection: MicrosoftConnection? = null,
    val sync: MicrosoftBoardSync? = null,
)

@Serializable
data class MicrosoftBoardSyncRequest(val columnId: String, val onlyTeams: Boolean, val daysAhead: Int)

// ── Administración ──

@Serializable
data class AdminUser(
    val id: String,
    val email: String,
    val name: String,
    /** `admin` o `member`. */
    val role: String,
    /** `active` o `disabled`. */
    val status: String,
    val hasTotp: Boolean = false,
    val createdAt: String,
    val lastLoginAt: String? = null,
)

@Serializable
data class AdminUsersResponse(val users: List<AdminUser>)

@Serializable
data class AdminInvitation(
    val id: String,
    val email: String,
    val role: String,
    val createdAt: String,
    val expiresAt: String,
    val acceptedAt: String? = null,
    val revokedAt: String? = null,
)

@Serializable
data class AdminInvitationsResponse(val invitations: List<AdminInvitation>)

@Serializable
data class CreateInvitationRequest(val email: String, val role: String, val expiresInDays: Int)

/** El enlace solo se ve al crear o reenviar: en la base de datos solo queda su hash. */
@Serializable
data class InvitationDelivery(val email: String? = null, val expiresAt: String, val link: String, val emailed: Boolean)

@Serializable
data class SystemBackupRun(
    val id: String,
    /** `schedule` o `manual`. */
    val trigger: String,
    /** `running`, `succeeded` o `failed`. */
    val status: String,
    val startedAt: String,
    val finishedAt: String? = null,
    val r2Key: String? = null,
    val sizeBytes: Long? = null,
    val error: String? = null,
)

@Serializable
data class SystemBackupObject(val key: String, val tier: String, val sizeBytes: Long, val uploadedAt: String)

@Serializable
data class SystemBackupsResponse(val runs: List<SystemBackupRun>, val objects: List<SystemBackupObject>)
