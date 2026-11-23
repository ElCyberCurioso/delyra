package app.delyra.feature.kanban

import android.content.ContentResolver
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.delyra.AppGraph
import app.delyra.core.model.ArchivedCard
import app.delyra.core.model.BoardColumn
import app.delyra.core.model.BoardDetail
import app.delyra.core.model.BoardMembers
import app.delyra.core.model.CardLabel
import app.delyra.core.model.CardSummary
import app.delyra.core.model.ColumnRequest
import app.delyra.core.model.CreateCardRequest
import app.delyra.core.model.IndexRequest
import app.delyra.core.model.InviteRequest
import app.delyra.core.model.LabelRequest
import app.delyra.core.model.LivePerson
import app.delyra.core.model.RoleRequest
import app.delyra.core.network.ApiError
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * Estado de un tablero (F8-04/05). Los movimientos se aplican al momento (optimista) y después se
 * vuelve a pedir el tablero. Toda lectura que empezó antes de un cambio se descarta al llegar, para
 * que una respuesta vieja no deshaga lo que se acaba de mover (el fallo que corrigió F4-08).
 */
class BoardViewModel(private val graph: AppGraph, val boardId: String) : ViewModel() {
    private val api = graph.kanbanApi
    val userId: String? = graph.session.active?.user?.id

    var detail by mutableStateOf<BoardDetail?>(null)
        private set
    var columns by mutableStateOf<List<BoardColumn>>(emptyList())
        private set
    var cardsByColumn by mutableStateOf<Map<String, List<CardSummary>>>(emptyMap())
        private set
    var loadError by mutableStateOf<ApiError?>(null)
        private set
    var message by mutableStateOf<ApiError?>(null)
    var wipExceeded by mutableStateOf<String?>(null)
    var presence by mutableStateOf<List<LivePerson>>(emptyList())
        private set
    var revoked by mutableStateOf(false)
        private set
    var deleted by mutableStateOf(false)
        private set
    var query by mutableStateOf("")
    var archived by mutableStateOf<List<ArchivedCard>?>(null)
        private set
    var members by mutableStateOf<BoardMembers?>(null)
        private set

    val canWrite: Boolean get() = detail?.board?.canWrite == true
    val isOwner: Boolean get() = detail?.board?.isOwner == true
    val labels: List<CardLabel> get() = detail?.labels.orEmpty()

    private var mutations = 0
    private var pending = 0
    private var reloadJob: Job? = null

    private val live = BoardLive(
        client = graph.network.client,
        boardId = boardId,
        scope = viewModelScope,
        onChanged = { by -> if (by != userId) scheduleReload() },
        onPresence = { people -> presence = people.filter { it.id != userId }.distinctBy { it.id } },
        onRevoked = { revoked = true },
    )

    init {
        load()
        viewModelScope.launch { graph.changes.boards.drop(1).collect { scheduleReload() } }
    }

    fun startLive() = live.start()
    fun stopLive() = live.stop()

    override fun onCleared() {
        live.stop()
    }

    fun load() {
        val started = mutations
        viewModelScope.launch {
            apiCall { api.board(boardId) }
                .onSuccess { if (started == mutations && pending == 0) apply(it) }
                .onFailure {
                    if (detail == null) loadError = it.apiError
                    if (it.apiError.let { e -> e is ApiError.Http && e.status == 404 } && detail != null) revoked = true
                }
        }
    }

    /** Varios avisos seguidos (en vivo, tarjeta editada) se juntan en una sola petición. */
    private fun scheduleReload() {
        reloadJob?.cancel()
        reloadJob = viewModelScope.launch {
            delay(300)
            load()
        }
    }

    private fun apply(board: BoardDetail) {
        detail = board
        loadError = null
        columns = board.columns.sortedBy { it.position }
        val sorted = board.cards.sortedBy { it.position }
        cardsByColumn = columns.associate { column -> column.id to sorted.filter { it.columnId == column.id } }
    }

    /** Cambio en curso: invalida las lecturas en vuelo y, al terminar, vuelve a pedir el tablero. */
    private fun mutate(block: suspend () -> Result<*>, onSuccess: (Any?) -> Unit = {}) {
        mutations++
        pending++
        viewModelScope.launch {
            val result = block()
            pending--
            result.onSuccess {
                onSuccess(it)
                graph.changes.calendarChanged()
            }.onFailure { message = it.apiError }
            if (pending == 0) load()
        }
    }

    fun visibleCards(columnId: String): List<CardSummary> {
        val list = cardsByColumn[columnId].orEmpty()
        val q = query.trim()
        return if (q.isEmpty()) list else list.filter { it.title.contains(q, ignoreCase = true) }
    }

    // ── Tarjetas ──

    fun moveCard(cardId: String, columnId: String, index: Int, assignee: String? = null) {
        val card = cardsByColumn.values.flatten().firstOrNull { it.id == cardId } ?: return
        val target = columns.firstOrNull { it.id == columnId } ?: return
        // Optimista: se quita de su columna y se mete en la nueva en la posición pedida.
        val updated = cardsByColumn.mapValues { (_, list) -> list.filter { it.id != cardId } }.toMutableMap()
        val list = updated[columnId].orEmpty().toMutableList()
        val at = index.coerceIn(0, list.size)
        list.add(at, card.copy(columnId = columnId, assignee = assignee ?: card.assignee, completedAt = if (target.isDone) card.completedAt ?: "now" else null))
        updated[columnId] = list
        cardsByColumn = updated
        mutate({
            apiCall {
                api.moveCard(cardId, buildJsonObject {
                    put("columnId", JsonPrimitive(columnId))
                    put("index", JsonPrimitive(at))
                    if (assignee != null) put("assignee", JsonPrimitive(assignee))
                })
            }
        }) { response ->
            if ((response as? app.delyra.core.model.MoveCardResponse)?.wipExceeded == true) wipExceeded = target.name
        }
    }

    fun addCard(columnId: String, title: String, kind: String) =
        mutate({ apiCall { api.createCard(columnId, CreateCardRequest(title, kind)) } })

    fun archiveCard(cardId: String) = mutate({ apiCall { api.archiveCard(cardId) } })

    fun deleteCard(cardId: String) {
        cardsByColumn = cardsByColumn.mapValues { (_, list) -> list.filter { it.id != cardId } }
        mutate({ apiCall { api.deleteCard(cardId) } })
    }

    fun loadArchived() {
        viewModelScope.launch {
            apiCall { api.archived(boardId) }.onSuccess { archived = it.cards }.onFailure { message = it.apiError }
        }
    }

    fun restoreCard(cardId: String) = mutate({ apiCall { api.restoreCard(cardId) } }) { loadArchived() }

    fun deleteArchived(cardId: String) = mutate({ apiCall { api.deleteCard(cardId) } }) { loadArchived() }

    // ── Columnas ──

    fun addColumn(name: String, wipLimit: Int?, isDone: Boolean, delegated: Boolean) =
        mutate({ apiCall { api.addColumn(boardId, ColumnRequest(name, wipLimit, isDone, delegated)) } })

    fun updateColumn(column: BoardColumn, name: String, wipLimit: Int?, isDone: Boolean, delegated: Boolean) = mutate({
        apiCall {
            api.updateColumn(column.id, buildJsonObject {
                put("name", JsonPrimitive(name))
                put("wipLimit", wipLimit?.let(::JsonPrimitive) ?: JsonNull)
                put("isDone", JsonPrimitive(isDone))
                put("delegated", JsonPrimitive(delegated))
            })
        }
    })

    fun moveColumn(column: BoardColumn, index: Int) {
        val list = columns.toMutableList()
        list.remove(column)
        val at = index.coerceIn(0, list.size)
        list.add(at, column)
        columns = list
        mutate({ apiCall { api.moveColumn(column.id, IndexRequest(at)) } })
    }

    fun deleteColumn(column: BoardColumn) {
        columns = columns.filter { it.id != column.id }
        mutate({ apiCall { api.deleteColumn(column.id) } })
    }

    // ── Etiquetas ──

    fun addLabel(name: String, color: String) = mutate({ apiCall { api.addLabel(boardId, LabelRequest(name, color)) } })
    fun updateLabel(label: CardLabel, name: String, color: String) = mutate({ apiCall { api.updateLabel(label.id, LabelRequest(name, color)) } })
    fun deleteLabel(label: CardLabel) = mutate({ apiCall { api.deleteLabel(label.id) } })

    // ── Tablero ──

    fun updateBoard(name: String, autoarchiveDays: Int) = mutate({
        apiCall {
            api.updateBoard(boardId, buildJsonObject {
                put("name", JsonPrimitive(name))
                put("autoarchiveDays", JsonPrimitive(autoarchiveDays))
            })
        }
    }) { graph.changes.boardsChanged() }

    fun deleteBoard() = mutate({ apiCall { api.deleteBoard(boardId) } }) {
        deleted = true
        graph.changes.boardsChanged()
    }

    /** JSON o CSV (F6-02) en el documento que elija la persona (Storage Access Framework). */
    fun export(format: String, target: Uri, resolver: ContentResolver) {
        viewModelScope.launch {
            apiCall {
                val body = api.exportBoard(boardId, format)
                withContext(Dispatchers.IO) {
                    body.use { input -> resolver.openOutputStream(target)?.use { out -> input.byteStream().copyTo(out) } }
                }
            }.onFailure { message = it.apiError }
        }
    }

    // ── Compartir (F7-04) ──

    fun loadMembers() {
        viewModelScope.launch {
            apiCall { api.members(boardId) }.onSuccess { members = it }.onFailure { message = it.apiError }
        }
    }

    fun invite(email: String, role: String) {
        viewModelScope.launch {
            apiCall { api.invite(boardId, InviteRequest(email.trim().lowercase(), role)) }
                .onSuccess { members = it }.onFailure { message = it.apiError }
        }
    }

    fun setRole(userId: String, role: String) {
        viewModelScope.launch {
            apiCall { api.setMemberRole(boardId, userId, RoleRequest(role)) }.onSuccess { members = it }.onFailure { message = it.apiError }
        }
    }

    fun removeMember(userId: String) {
        viewModelScope.launch {
            apiCall { api.removeMember(boardId, userId) }.onSuccess {
                if (userId == this@BoardViewModel.userId) {
                    deleted = true
                    graph.changes.boardsChanged()
                } else {
                    loadMembers()
                }
            }.onFailure { message = it.apiError }
        }
    }

    fun revokeInvitation(invitationId: String) {
        viewModelScope.launch {
            apiCall { api.revokeInvitation(boardId, invitationId) }.onSuccess { loadMembers() }.onFailure { message = it.apiError }
        }
    }
}
