package app.delyra.core.model

import kotlinx.serialization.Serializable

/** Identidad y sesión (`packages/shared/src/schemas/auth.ts` y `account.ts`). */

@Serializable
data class User(val id: String, val email: String, val name: String, val role: String) {
    val isAdmin: Boolean get() = role == "admin"
}

@Serializable
data class UserSettings(val timeZone: String, val locale: String, val weekStart: Int)

@Serializable
data class MeResponse(
    val state: String,
    val passkey: Boolean? = null,
    val user: User? = null,
    val settings: UserSettings? = null,
)

@Serializable
data class AuthConfigResponse(val turnstileSiteKey: String? = null)

@Serializable
data class LoginRequest(val email: String, val password: String, val turnstileToken: String)

/** `next`: `2fa`, `totp-setup` o `done`. */
@Serializable
data class AuthStepResponse(val next: String, val remainingRecoveryCodes: Int? = null)

@Serializable
data class CodeRequest(val code: String)

/** Opciones de una ceremonia WebAuthn tal cual las genera la API (se pasan sin tocar a Android). */
@Serializable
data class WebAuthnOptions(val options: kotlinx.serialization.json.JsonObject)

/** Respuesta de Credential Manager, sin tocar (la API la valida con @simplewebauthn/server). */
@Serializable
data class PasskeyLoginRequest(val response: kotlinx.serialization.json.JsonElement)

@Serializable
data class AddPasskeyRequest(val name: String, val response: kotlinx.serialization.json.JsonElement)

@Serializable
data class TotpSetupResponse(val secret: String, val otpauthUri: String)

@Serializable
data class RecoveryCodesResponse(val recoveryCodes: List<String>)

@Serializable
data class TokenRequest(val token: String)

@Serializable
data class InvitationInfo(val email: String, val role: String, val expiresAt: String)

@Serializable
data class RegisterRequest(val token: String, val name: String, val password: String, val turnstileToken: String)

@Serializable
data class ForgotPasswordRequest(val email: String, val turnstileToken: String)

@Serializable
data class ResetPasswordRequest(val token: String, val password: String)

// ── Ajustes de cuenta ──────────────────────────────────────────────────────────

@Serializable
data class ProfileRequest(val name: String)

@Serializable
data class ProfileResponse(val user: User? = null)

@Serializable
data class SettingsResponse(val settings: UserSettings? = null)

@Serializable
data class ChangePasswordRequest(val currentPassword: String, val newPassword: String)

@Serializable
data class ReauthRequest(val password: String, val code: String)

@Serializable
data class SecurityOverview(
    val totpConfirmedAt: String? = null,
    val remainingRecoveryCodes: Int = 0,
    val passwordChangedAt: String? = null,
    val passkeys: Int = 0,
)

@Serializable
data class ActiveSession(
    val id: String,
    val createdAt: String,
    val lastSeenAt: String,
    val userAgent: String? = null,
    val country: String? = null,
    val current: Boolean = false,
)

@Serializable
data class SessionsResponse(val sessions: List<ActiveSession>)

@Serializable
data class AuditEntry(
    val id: String,
    val event: String,
    val country: String? = null,
    val userAgent: String? = null,
    val createdAt: String,
)

@Serializable
data class AuditResponse(val events: List<AuditEntry>)
