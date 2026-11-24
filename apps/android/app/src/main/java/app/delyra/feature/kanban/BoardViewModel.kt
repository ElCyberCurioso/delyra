package app.delyra.feature.kanban

import android.content.ContentResolver
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
    val zone: java.time.ZoneId = graph.session.active?.zone ?: java.time.ZoneId.systemDefault()

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
        url = liveUrl(boardId),
        scope = viewModelScope,
        // Los cambios propios ya los aplica la mutación que los hizo. Los ajenos refrescan el
        // tablero (por `boards`), la tarjeta abierta, la lista de tableros y el calendario.
        onChanged = { by -> if (by != userId) graph.changes.remoteBoardChanged(boardId) },
        onPresence = { people -> presence = people.filter { it.id != userId }.distinctBy { it.id } },
        onRevoked = {
            revoked = true
            graph.changes.boardsChanged()
        },
    )
    private var liveStarts = 0

    init {
        load()
        viewModelScope.launch { graph.changes.boards.drop(1).collect { scheduleReload() } }
    }

    /**
     * El canal solo está abierto con el tablero en pantalla. Al volver (de una tarjeta, de otra app)
     * se pide el tablero: mientras estaba cerrado pudo cambiar algo.
     */
    fun startLive() {
        if (liveStarts++ > 0) scheduleReload()
        live.start()
    }

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
                    // 404 con el tablero ya cargado: lo borraron o te quitaron el acceso. La lista se refresca.
                    if (it.apiError.let { e -> e is ApiError.Http && e.status == 404 } && detail != null && !revoked) {
                        revoked = true
                        graph.changes.boardsChanged()
                    }
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

    var membersError by mutableStateOf<ApiError?>(null)
        private set
    var sharing by mutableStateOf(false)
        private set
    /** Error del formulario de invitar (email no válido, sin cuenta, límite de personas…). */
    var inviteError by mutableStateOf<ApiError?>(null)
    /** Sube con cada invitación creada: el formulario se vacía y se avisa. */
    var invitedCount by mutableIntStateOf(0)
        private set

    /** Lista de la hoja; una petición anterior a un cambio no pisa el resultado del cambio. */
    private var membersVersion = 0

    fun loadMembers() {
        val version = ++membersVersion
        membersError = null
        viewModelScope.launch {
            apiCall { api.members(boardId) }
                .onSuccess { if (version == membersVersion) members = it }
                .onFailure { if (version == membersVersion) membersError = it.apiError }
        }
    }

    /** Tras cualquier cambio: la hoja, el contador del tablero y la lista de tableros. */
    private fun share(block: suspend () -> BoardMembers?, onError: (ApiError) -> Unit = { message = it }, onDone: () -> Unit = {}) {
        if (sharing) return
        sharing = true
        val version = ++membersVersion
        viewModelScope.launch {
            apiCall { block() }
                .onSuccess { result ->
                    if (result != null && version == membersVersion) members = result else loadMembers()
                    onDone()
                    graph.changes.boardsChanged()
                }
                .onFailure { onError(it.apiError) }
            sharing = false
        }
    }

    fun invite(email: String, role: String) {
        inviteError = null
        share(
            block = { api.invite(boardId, InviteRequest(email.trim().lowercase(), role)) },
            onError = { inviteError = it },
            onDone = { invitedCount++ },
        )
    }

    fun setRole(userId: String, role: String) = share({ api.setMemberRole(boardId, userId, RoleRequest(role)) })

    fun removeMember(userId: String) = share({ api.removeMember(boardId, userId); null })

    fun revokeInvitation(invitationId: String) = share({ api.revokeInvitation(boardId, invitationId); null })

    /** Salir de un tablero compartido contigo: se vuelve a la lista. */
    fun leave() {
        val me = userId ?: return
        share({ api.removeMember(boardId, me); null }, onDone = { deleted = true })
    }
}
