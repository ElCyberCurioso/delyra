package app.delyra.core.network.api

import app.delyra.core.model.AuditResponse
import app.delyra.core.model.AuthConfigResponse
import app.delyra.core.model.AuthStepResponse
import app.delyra.core.model.ChangePasswordRequest
import app.delyra.core.model.CodeRequest
import app.delyra.core.model.ForgotPasswordRequest
import app.delyra.core.model.InvitationInfo
import app.delyra.core.model.LoginRequest
import app.delyra.core.model.MeResponse
import app.delyra.core.model.ProfileRequest
import app.delyra.core.model.ProfileResponse
import app.delyra.core.model.ReauthRequest
import app.delyra.core.model.RecoveryCodesResponse
import app.delyra.core.model.RegisterRequest
import app.delyra.core.model.ResetPasswordRequest
import app.delyra.core.model.SecurityOverview
import app.delyra.core.model.SessionsResponse
import app.delyra.core.model.SettingsResponse
import app.delyra.core.model.TokenRequest
import app.delyra.core.model.TotpSetupResponse
import app.delyra.core.model.UserSettings
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path

/** `/api/auth/…` (apps/api/src/routes/auth.ts). */
interface AuthApi {
    @GET("auth/config")
    suspend fun config(): AuthConfigResponse

    @GET("auth/me")
    suspend fun me(): MeResponse

    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): AuthStepResponse

    @POST("auth/login/second-factor")
    suspend fun secondFactor(@Body body: CodeRequest): AuthStepResponse

    @POST("auth/totp/setup")
    suspend fun totpSetup(): TotpSetupResponse

    @POST("auth/totp/confirm")
    suspend fun totpConfirm(@Body body: CodeRequest): RecoveryCodesResponse

    @POST("auth/invitation")
    suspend fun invitation(@Body body: TokenRequest): InvitationInfo

    @POST("auth/register")
    suspend fun register(@Body body: RegisterRequest): AuthStepResponse

    @POST("auth/password/forgot")
    suspend fun forgotPassword(@Body body: ForgotPasswordRequest)

    @POST("auth/password/reset")
    suspend fun resetPassword(@Body body: ResetPasswordRequest)

    @POST("auth/logout")
    suspend fun logout()
}

/** `/api/me/…` (apps/api/src/routes/account.ts). */
interface AccountApi {
    @PATCH("me/profile")
    suspend fun updateProfile(@Body body: ProfileRequest): ProfileResponse

    @PATCH("me/settings")
    suspend fun updateSettings(@Body body: UserSettings): SettingsResponse

    @GET("me/security")
    suspend fun security(): SecurityOverview

    @POST("me/password")
    suspend fun changePassword(@Body body: ChangePasswordRequest): JsonObject

    @POST("me/recovery-codes")
    suspend fun regenerateRecoveryCodes(@Body body: ReauthRequest): RecoveryCodesResponse

    @POST("me/totp/reconfigure")
    suspend fun reconfigureTotp(@Body body: ReauthRequest): TotpSetupResponse

    @POST("me/totp/reconfigure/confirm")
    suspend fun confirmTotpReconfigure(@Body body: CodeRequest): JsonObject

    @GET("me/sessions")
    suspend fun sessions(): SessionsResponse

    @DELETE("me/sessions/{id}")
    suspend fun revokeSession(@Path("id") id: String)

    @POST("me/sessions/revoke-others")
    suspend fun revokeOtherSessions(): JsonObject

    @GET("me/audit")
    suspend fun audit(): AuditResponse
}
