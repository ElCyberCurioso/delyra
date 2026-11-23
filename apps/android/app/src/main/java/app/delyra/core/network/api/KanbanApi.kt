package app.delyra.core.network.api

import app.delyra.core.model.AcceptedInvitation
import app.delyra.core.model.ArchivedCardsResponse
import app.delyra.core.model.BoardDetail
import app.delyra.core.model.BoardMembers
import app.delyra.core.model.BoardsResponse
import app.delyra.core.model.CardResponse
import app.delyra.core.model.ColumnRequest
import app.delyra.core.model.CommentRequest
import app.delyra.core.model.CreateBoardRequest
import app.delyra.core.model.CreateCardRequest
import app.delyra.core.model.IndexRequest
import app.delyra.core.model.InviteRequest
import app.delyra.core.model.LabelRequest
import app.delyra.core.model.LabelResponse
import app.delyra.core.model.MoveCardResponse
import app.delyra.core.model.PendingInvitationsResponse
import app.delyra.core.model.RoleRequest
import app.delyra.core.model.TextRequest
import kotlinx.serialization.json.JsonObject
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Streaming

/** Planificador de tareas (apps/api/src/routes/kanban.ts y board-invitations.ts). */
interface KanbanApi {
    // ── Tableros ──
    @GET("boards")
    suspend fun boards(): BoardsResponse

    @POST("boards")
    suspend fun createBoard(@Body body: CreateBoardRequest): BoardDetail

    @GET("boards/{id}")
    suspend fun board(@Path("id") id: String): BoardDetail

    @PATCH("boards/{id}")
    suspend fun updateBoard(@Path("id") id: String, @Body body: JsonObject): BoardDetail

    @DELETE("boards/{id}")
    suspend fun deleteBoard(@Path("id") id: String)

    @POST("boards/{id}/columns")
    suspend fun addColumn(@Path("id") boardId: String, @Body body: ColumnRequest): BoardDetail

    @POST("boards/{id}/labels")
    suspend fun addLabel(@Path("id") boardId: String, @Body body: LabelRequest): LabelResponse

    @GET("boards/{id}/archived")
    suspend fun archived(@Path("id") boardId: String): ArchivedCardsResponse

    @Streaming
    @GET("boards/{id}/export")
    suspend fun exportBoard(@Path("id") boardId: String, @retrofit2.http.Query("format") format: String): ResponseBody

    // ── Compartir ──
    @GET("boards/{id}/members")
    suspend fun members(@Path("id") boardId: String): BoardMembers

    @POST("boards/{id}/invitations")
    suspend fun invite(@Path("id") boardId: String, @Body body: InviteRequest): BoardMembers

    @DELETE("boards/{id}/invitations/{invitationId}")
    suspend fun revokeInvitation(@Path("id") boardId: String, @Path("invitationId") invitationId: String)

    @PATCH("boards/{id}/members/{userId}")
    suspend fun setMemberRole(
        @Path("id") boardId: String,
        @Path("userId") userId: String,
        @Body body: RoleRequest,
    ): BoardMembers

    /** Con el id propio: salir del tablero. */
    @DELETE("boards/{id}/members/{userId}")
    suspend fun removeMember(@Path("id") boardId: String, @Path("userId") userId: String)

    @GET("board-invitations")
    suspend fun pendingInvitations(): PendingInvitationsResponse

    @POST("board-invitations/{id}/accept")
    suspend fun acceptInvitation(@Path("id") id: String): AcceptedInvitation

    @POST("board-invitations/{id}/decline")
    suspend fun declineInvitation(@Path("id") id: String)

    // ── Columnas y etiquetas ──
    @PATCH("columns/{id}")
    suspend fun updateColumn(@Path("id") id: String, @Body body: JsonObject): BoardDetail

    @POST("columns/{id}/move")
    suspend fun moveColumn(@Path("id") id: String, @Body body: IndexRequest): BoardDetail

    @DELETE("columns/{id}")
    suspend fun deleteColumn(@Path("id") id: String)

    @POST("columns/{id}/cards")
    suspend fun createCard(@Path("id") columnId: String, @Body body: CreateCardRequest): CardResponse

    @PATCH("labels/{id}")
    suspend fun updateLabel(@Path("id") id: String, @Body body: LabelRequest): LabelResponse

    @DELETE("labels/{id}")
    suspend fun deleteLabel(@Path("id") id: String)

    // ── Tarjetas ──
    @GET("cards/{id}")
    suspend fun card(@Path("id") id: String): CardResponse

    @PATCH("cards/{id}")
    suspend fun updateCard(@Path("id") id: String, @Body body: JsonObject): CardResponse

    @POST("cards/{id}/move")
    suspend fun moveCard(@Path("id") id: String, @Body body: JsonObject): MoveCardResponse

    @POST("cards/{id}/archive")
    suspend fun archiveCard(@Path("id") id: String): CardResponse

    @POST("cards/{id}/restore")
    suspend fun restoreCard(@Path("id") id: String): CardResponse

    @DELETE("cards/{id}")
    suspend fun deleteCard(@Path("id") id: String)

    @POST("cards/{id}/checklist")
    suspend fun addChecklistItem(@Path("id") cardId: String, @Body body: TextRequest): CardResponse

    @POST("cards/{id}/comments")
    suspend fun addComment(@Path("id") cardId: String, @Body body: CommentRequest): CardResponse

    /** Subida en streaming: `Content-Length` exacto, tipo real y `X-Filename` codificado. */
    @POST("cards/{id}/attachments")
    suspend fun uploadAttachment(
        @Path("id") cardId: String,
        @Header("X-Filename") filename: String,
        @Body body: RequestBody,
    ): CardResponse

    @PATCH("checklist/{id}")
    suspend fun updateChecklistItem(@Path("id") id: String, @Body body: JsonObject): CardResponse

    @DELETE("checklist/{id}")
    suspend fun deleteChecklistItem(@Path("id") id: String): CardResponse

    @PATCH("comments/{id}")
    suspend fun updateComment(@Path("id") id: String, @Body body: CommentRequest): CardResponse

    @DELETE("comments/{id}")
    suspend fun deleteComment(@Path("id") id: String): CardResponse

    @Streaming
    @GET("attachments/{id}")
    suspend fun downloadAttachment(@Path("id") id: String): ResponseBody

    @DELETE("attachments/{id}")
    suspend fun deleteAttachment(@Path("id") id: String): CardResponse
}
