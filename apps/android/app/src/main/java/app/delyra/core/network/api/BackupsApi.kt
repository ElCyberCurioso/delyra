package app.delyra.core.network.api

import app.delyra.core.model.BackupResponse
import app.delyra.core.model.BackupSettings
import app.delyra.core.model.BackupSettingsResponse
import app.delyra.core.model.BackupsResponse
import app.delyra.core.model.RestoreFromBackupRequest
import app.delyra.core.model.RestoreResponse
import app.delyra.core.model.StartRestoreRequest
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Streaming

/** Copias de seguridad de usuario y restauraciones (apps/api/src/routes/backups.ts). */
interface BackupsApi {
    @GET("backups")
    suspend fun backups(): BackupsResponse

    @POST("backups")
    suspend fun createBackup(): BackupResponse

    @PUT("backups/settings")
    suspend fun updateSettings(@Body body: BackupSettings): BackupSettingsResponse

    @Streaming
    @GET("backups/{id}/download")
    suspend fun download(@Path("id") id: String): ResponseBody

    @DELETE("backups/{id}")
    suspend fun deleteBackup(@Path("id") id: String)

    /** Fichero (zip o json) en streaming: `Content-Length` exacto y `X-Filename` codificado. */
    @POST("restores/upload")
    suspend fun upload(@Header("X-Filename") filename: String, @Body body: RequestBody): RestoreResponse

    @POST("restores")
    suspend fun restoreBackup(@Body body: RestoreFromBackupRequest): RestoreResponse

    @POST("restores/{id}/start")
    suspend fun start(@Path("id") id: String, @Body body: StartRestoreRequest): RestoreResponse

    @POST("restores/{id}/undo")
    suspend fun undo(@Path("id") id: String): RestoreResponse

    @DELETE("restores/{id}")
    suspend fun discard(@Path("id") id: String)
}
