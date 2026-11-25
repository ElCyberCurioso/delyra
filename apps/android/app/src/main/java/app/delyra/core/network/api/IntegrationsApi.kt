package app.delyra.core.network.api

import app.delyra.core.model.AddGoogleSyncRequest
import app.delyra.core.model.AdminInvitationsResponse
import app.delyra.core.model.AdminUsersResponse
import app.delyra.core.model.CreateInvitationRequest
import app.delyra.core.model.GoogleAccountCalendarsResponse
import app.delyra.core.model.GoogleStatus
import app.delyra.core.model.GoogleSyncInfo
import app.delyra.core.model.ImportResponse
import app.delyra.core.model.ImportsResponse
import app.delyra.core.model.InvitationDelivery
import app.delyra.core.model.MicrosoftBoardInfo
import app.delyra.core.model.MicrosoftBoardSyncRequest
import app.delyra.core.model.SubscribeRequest
import app.delyra.core.model.SubscriptionResponse
import app.delyra.core.model.SubscriptionsResponse
import app.delyra.core.model.SystemBackupsResponse
import kotlinx.serialization.json.JsonObject
import okhttp3.RequestBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path

/**
 * Importaciones (F5), suscripciones iCal, sincronización con Google (F7-09) y Teams en tableros
 * (apps/api/src/routes/imports.ts, subscriptions.ts, google.ts y microsoft.ts). Conectar con
 * Google o Microsoft (el OAuth) se hace en la web: ver [app.delyra.core.ui.openInBrowser].
 */
interface IntegrationsApi {
    @GET("imports")
    suspend fun imports(): ImportsResponse

    @GET("imports/{id}")
    suspend fun import(@Path("id") id: String): ImportResponse

    /** Fichero (.zip o .ics) en streaming: `Content-Length` exacto y `X-Filename` codificado. */
    @POST("imports")
    suspend fun upload(@Header("X-Filename") filename: String, @Body body: RequestBody): ImportResponse

    @POST("imports/{id}/start")
    suspend fun start(@Path("id") id: String, @Body body: JsonObject): ImportResponse

    @DELETE("imports/{id}")
    suspend fun discard(@Path("id") id: String)

    @GET("subscriptions")
    suspend fun subscriptions(): SubscriptionsResponse

    @POST("subscriptions")
    suspend fun subscribe(@Body body: SubscribeRequest): SubscriptionResponse

    @POST("subscriptions/{id}/sync")
    suspend fun syncSubscription(@Path("id") id: String): SubscriptionResponse

    @DELETE("subscriptions/{id}")
    suspend fun unsubscribe(@Path("id") id: String)

    @GET("google/status")
    suspend fun googleStatus(): GoogleStatus

    @GET("google/sync")
    suspend fun googleSync(): GoogleSyncInfo

    @GET("google/sync/available")
    suspend fun googleAvailable(): GoogleAccountCalendarsResponse

    @POST("google/sync/calendars")
    suspend fun addGoogleSync(@Body body: AddGoogleSyncRequest): GoogleSyncInfo

    @POST("google/sync/calendars/{id}/sync")
    suspend fun syncGoogleNow(@Path("id") id: String): GoogleSyncInfo

    @DELETE("google/sync/calendars/{id}")
    suspend fun removeGoogleSync(@Path("id") id: String)

    @DELETE("google/sync")
    suspend fun disconnectGoogle()

    @GET("microsoft/boards/{boardId}")
    suspend fun teams(@Path("boardId") boardId: String): MicrosoftBoardInfo

    @PUT("microsoft/boards/{boardId}")
    suspend fun saveTeams(@Path("boardId") boardId: String, @Body body: MicrosoftBoardSyncRequest): MicrosoftBoardInfo

    @POST("microsoft/boards/{boardId}/sync")
    suspend fun syncTeams(@Path("boardId") boardId: String): MicrosoftBoardInfo

    @DELETE("microsoft/boards/{boardId}")
    suspend fun stopTeams(@Path("boardId") boardId: String)

    @DELETE("microsoft/connection")
    suspend fun disconnectMicrosoft()
}

/** Panel de administración, solo para el rol `admin` (apps/api/src/routes/admin.ts). */
interface AdminApi {
    @GET("admin/users")
    suspend fun users(): AdminUsersResponse

    /** `action`: `disable`, `enable` o `reset-2fa`. */
    @POST("admin/users/{id}/{action}")
    suspend fun userAction(@Path("id") id: String, @Path("action") action: String)

    @GET("admin/invitations")
    suspend fun invitations(): AdminInvitationsResponse

    @POST("admin/invitations")
    suspend fun invite(@Body body: CreateInvitationRequest): InvitationDelivery

    @POST("admin/invitations/{id}/resend")
    suspend fun resend(@Path("id") id: String): InvitationDelivery

    @DELETE("admin/invitations/{id}")
    suspend fun revoke(@Path("id") id: String)

    @GET("admin/backups")
    suspend fun systemBackups(): SystemBackupsResponse

    @POST("admin/backups")
    suspend fun runSystemBackup(): JsonObject
}
