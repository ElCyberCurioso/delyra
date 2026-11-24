package app.delyra.core.model

import kotlinx.serialization.Serializable

/** Llaves de acceso, Telegram y copias de seguridad (`schemas/passkeys.ts`, `telegram.ts`, `backups.ts`). */

@Serializable
data class Passkey(
    val id: String,
    val name: String,
    val createdAt: String,
    val lastUsedAt: String? = null,
    val backedUp: Boolean = false,
)

@Serializable
data class PasskeysResponse(val passkeys: List<Passkey>)

@Serializable
data class TelegramStatus(
    /** El bot está configurado en el servidor. */
    val available: Boolean = false,
    val botUsername: String? = null,
    val linked: Boolean = false,
    val linkedAt: String? = null,
    val mutedUntil: String? = null,
    val digestTime: String? = null,
    val quietStart: String? = null,
    val quietEnd: String? = null,
)

@Serializable
data class TelegramLinkResponse(val url: String, val expiresAt: String)

@Serializable
data class BackupCounts(
    val calendars: Int = 0,
    val events: Int = 0,
    val boards: Int = 0,
    val cards: Int = 0,
    val attachments: Int = 0,
)

/** `kind`: `manual`, `auto` o `pre_restore`. `status`: `running`, `ready` o `failed`. */
@Serializable
data class UserBackup(
    val id: String,
    val kind: String,
    val status: String,
    val sizeBytes: Long? = null,
    val counts: BackupCounts? = null,
    val error: String? = null,
    val createdAt: String,
    val finishedAt: String? = null,
)

/** `frequency`: `off`, `daily`, `weekly` o `monthly`; `keep`: copias automáticas (1-12). */
@Serializable
data class BackupSettings(val frequency: String, val keep: Int)

@Serializable
data class RestoreProgress(val done: Int = 0, val total: Int = 0)

/**
 * `status`: `validating` → `ready` → `restoring` → `succeeded` | `failed`; `undone` si se deshizo
 * y `expired` si no se empezó a tiempo. `mode`: `merge` o `replace`.
 */
@Serializable
data class RestoreInfo(
    val id: String,
    val status: String,
    val mode: String? = null,
    val filename: String? = null,
    val backupId: String? = null,
    /** Copia hecha justo antes de restaurar: la que usa «Deshacer». */
    val preBackupId: String? = null,
    /** Restauración que deshace a otra. */
    val undoOf: String? = null,
    val exportedAt: String? = null,
    val counts: BackupCounts? = null,
    val warnings: List<String> = emptyList(),
    val progress: RestoreProgress = RestoreProgress(),
    val error: String? = null,
    val createdAt: String,
    val finishedAt: String? = null,
)

@Serializable
data class BackupsResponse(val backups: List<UserBackup>, val settings: BackupSettings, val restores: List<RestoreInfo>)

@Serializable
data class BackupResponse(val backup: UserBackup)

@Serializable
data class BackupSettingsResponse(val settings: BackupSettings)

@Serializable
data class RestoreResponse(val restore: RestoreInfo)

@Serializable
data class RestoreFromBackupRequest(val backupId: String)

@Serializable
data class StartRestoreRequest(val mode: String)
