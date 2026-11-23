package app.delyra.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/** Planificador de tareas (`packages/shared/src/schemas/kanban.ts`). */

@Serializable
data class BoardSummary(
    val id: String,
    val name: String,
    val template: String,
    val autoarchiveDays: Int = 0,
    val openCards: Int = 0,
    val createdAt: String = "",
    val role: String = "owner",
    val ownerName: String? = null,
    val members: Int = 0,
) {
    val canWrite: Boolean get() = role != "reader"
    val isOwner: Boolean get() = role == "owner"
}

@Serializable
data class BoardsResponse(val boards: List<BoardSummary>)

@Serializable
data class BoardColumn(
    val id: String,
    val name: String,
    val position: String,
    val wipLimit: Int? = null,
    val isDone: Boolean = false,
    val delegated: Boolean = false,
)

@Serializable
data class CardLabel(val id: String, val name: String, val color: String)

@Serializable
data class LabelResponse(val label: CardLabel)

@Serializable
data class ChecklistProgress(val done: Int = 0, val total: Int = 0)

@Serializable
data class CardSummary(
    val id: String,
    val columnId: String,
    val title: String,
    val position: String,
    val priority: String = "none",
    val kind: String = "task",
    val assignee: String? = null,
    val color: String? = null,
    val due: DueInfo? = null,
    val completedAt: String? = null,
    val archivedAt: String? = null,
    val labelIds: List<String> = emptyList(),
    val checklist: ChecklistProgress = ChecklistProgress(),
    val comments: Int = 0,
    val attachments: Int = 0,
    val hasDescription: Boolean = false,
)

@Serializable
data class BoardDetail(
    val board: BoardSummary,
    val columns: List<BoardColumn>,
    val cards: List<CardSummary>,
    val labels: List<CardLabel>,
)

@Serializable
data class ChecklistItem(val id: String, val text: String, val done: Boolean)

@Serializable
data class CardComment(
    val id: String,
    val body: String,
    val createdAt: String,
    val updatedAt: String,
    val authorName: String? = null,
    val mine: Boolean = false,
)

@Serializable
data class CardAttachment(
    val id: String,
    val filename: String,
    val contentType: String,
    val size: Long,
    val createdAt: String,
)

@Serializable
data class CardActivity(
    val id: String,
    val kind: String,
    val data: JsonObject = JsonObject(emptyMap()),
    val createdAt: String,
    val actorName: String? = null,
)

@Serializable
data class CardReminder(val id: String, val offsetMinutes: Int, val nextFireAt: String? = null)

@Serializable
data class CardDetail(
    val id: String,
    val boardId: String,
    val columnId: String,
    val title: String,
    val position: String,
    val priority: String = "none",
    val kind: String = "task",
    val assignee: String? = null,
    val color: String? = null,
    val due: DueInfo? = null,
    val completedAt: String? = null,
    val archivedAt: String? = null,
    val labelIds: List<String> = emptyList(),
    val description: String = "",
    val checklistItems: List<ChecklistItem> = emptyList(),
    val commentList: List<CardComment> = emptyList(),
    val attachmentList: List<CardAttachment> = emptyList(),
    val activity: List<CardActivity> = emptyList(),
    val reminders: List<CardReminder> = emptyList(),
)

@Serializable
data class CardResponse(val card: CardDetail)

@Serializable
data class MoveCardResponse(val card: CardDetail, val wipExceeded: Boolean = false)

@Serializable
data class ArchivedCard(
    val id: String,
    val title: String,
    val columnId: String,
    val archivedAt: String? = null,
    val completedAt: String? = null,
)

@Serializable
data class ArchivedCardsResponse(val cards: List<ArchivedCard>)

@Serializable
data class CreateBoardRequest(val name: String, val template: String)

@Serializable
data class ColumnRequest(val name: String, val wipLimit: Int?, val isDone: Boolean, val delegated: Boolean)

@Serializable
data class IndexRequest(val index: Int)

@Serializable
data class CreateCardRequest(val title: String, val kind: String)

@Serializable
data class TextRequest(val text: String)

@Serializable
data class CommentRequest(val body: String)

@Serializable
data class LabelRequest(val name: String, val color: String)

// ── Compartir y en vivo (F7-04, F7-05) ─────────────────────────────────────────

@Serializable
data class BoardMember(
    val userId: String,
    val name: String,
    val role: String,
    val email: String? = null,
    val you: Boolean = false,
)

@Serializable
data class BoardInvitation(
    val id: String,
    val email: String,
    val role: String,
    val createdAt: String,
    val expiresAt: String,
)

@Serializable
data class BoardMembers(
    val role: String,
    val members: List<BoardMember>,
    val invitations: List<BoardInvitation> = emptyList(),
)

@Serializable
data class InviteRequest(val email: String, val role: String)

@Serializable
data class RoleRequest(val role: String)

@Serializable
data class PendingBoardInvitation(
    val id: String,
    val boardName: String,
    val invitedBy: String? = null,
    val role: String,
    val expiresAt: String,
)

@Serializable
data class PendingInvitationsResponse(val invitations: List<PendingBoardInvitation>)

@Serializable
data class AcceptedInvitation(val boardId: String)

@Serializable
data class LivePerson(val id: String, val name: String)

@Serializable
data class LiveMessage(val type: String, val by: String? = null, val users: List<LivePerson> = emptyList())
