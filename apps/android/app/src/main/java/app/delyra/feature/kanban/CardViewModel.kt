package app.delyra.feature.kanban

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.FileProvider
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.delyra.AppGraph
import app.delyra.core.model.BoardDetail
import app.delyra.core.model.CardAttachment
import app.delyra.core.model.CardDetail
import app.delyra.core.model.CardResponse
import app.delyra.core.model.CommentRequest
import app.delyra.core.model.TextRequest
import app.delyra.core.network.ApiError
import app.delyra.core.network.ApiException
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import java.io.File
import java.time.ZoneId

/** Tamaño máximo de un adjunto (`KANBAN_LIMITS.attachmentBytes`). */
const val MAX_ATTACHMENT_BYTES = 10L * 1024 * 1024

/**
 * Detalle de una tarjeta (F8-04): todos sus cambios devuelven la tarjeta entera, que se pinta tal
 * cual, y avisan al tablero (y a la capa de tareas del calendario) de que algo cambió.
 */
class CardViewModel(private val graph: AppGraph, val cardId: String) : ViewModel() {
    private val api = graph.kanbanApi
    val zone: ZoneId = graph.session.active?.zone ?: ZoneId.systemDefault()

    var card by mutableStateOf<CardDetail?>(null)
        private set
    /** Columnas, etiquetas y papel: del tablero de la tarjeta. */
    var board by mutableStateOf<BoardDetail?>(null)
        private set
    var loadError by mutableStateOf<ApiError?>(null)
        private set
    var message by mutableStateOf<ApiError?>(null)
    var busy by mutableStateOf(false)
        private set
    var deleted by mutableStateOf(false)
        private set
    var uploading by mutableStateOf(false)
        private set
    var tooLarge by mutableStateOf(false)

    val canWrite: Boolean get() = board?.board?.canWrite == true

    /** Otra persona borró la tarjeta o te quitó el acceso al tablero mientras la mirabas. */
    var gone by mutableStateOf(false)
        private set

    private val userId: String? = graph.session.active?.user?.id
    private var mutations = 0
    private var refreshJob: Job? = null
    private var live: BoardLive? = null
    private var liveWanted = false
    private var liveStarts = 0

    init {
        load()
        // Cambios de otras personas en su tablero (los avisa el canal en vivo del tablero abierto).
        viewModelScope.launch {
            graph.changes.remoteBoard.collect { boardId -> if (boardId == card?.boardId) scheduleRefresh() }
        }
    }

    /**
     * Carga la tarjeta y su tablero (columnas, etiquetas y papel, que también pueden cambiar). Una
     * lectura que empezó antes de un cambio propio se descarta: no deshace lo que se acaba de hacer.
     */
    fun load(refreshBoard: Boolean = false) {
        val started = mutations
        viewModelScope.launch {
            apiCall { api.card(cardId) }.onSuccess { response ->
                if (started != mutations) return@onSuccess
                card = response.card
                loadError = null
                if (refreshBoard || board?.board?.id != response.card.boardId) {
                    apiCall { api.board(response.card.boardId) }.onSuccess { board = it }
                }
                if (liveWanted) ensureLive()
            }.onFailure {
                val error = it.apiError
                if (card != null && error is ApiError.Http && error.status == 404) {
                    gone = true
                    graph.changes.boardsChanged()
                }
                else if (card == null) loadError = error
            }
        }
    }

    private fun scheduleRefresh() {
        refreshJob?.cancel()
        refreshJob = viewModelScope.launch {
            delay(300)
            load(refreshBoard = true)
        }
    }

    /**
     * Pantalla completa de la tarjeta (teléfono): el tablero queda detrás con su canal cerrado, así
     * que la tarjeta abre el suyo. En el panel del tablero (tablet) no hace falta: ya lo tiene él.
     */
    fun startLive() {
        liveWanted = true
        if (liveStarts++ > 0) scheduleRefresh()
        ensureLive()
    }

    fun stopLive() {
        liveWanted = false
        live?.stop()
    }

    private fun ensureLive() {
        val boardId = card?.boardId ?: return
        val channel = live ?: BoardLive(
            client = graph.network.client,
            url = liveUrl(boardId),
            scope = viewModelScope,
            onChanged = { by ->
                if (by != userId) {
                    scheduleRefresh()
                    graph.changes.boardsChanged()
                }
            },
            onPresence = {},
            onRevoked = {
                gone = true
                graph.changes.boardsChanged()
            },
        ).also { live = it }
        channel.start()
    }

    override fun onCleared() {
        live?.stop()
    }

    private fun run(block: suspend () -> CardResponse) {
        mutations++
        busy = true
        viewModelScope.launch {
            apiCall { block() }
                .onSuccess {
                    card = it.card
                    graph.changes.boardsChanged()
                }
                .onFailure { message = it.apiError }
            busy = false
        }
    }

    // ── Borrador: lo que se edita en el detalle y manda «Guardar cambios» ──

    /** Los avisos por Telegram le llegan a quien creó el tablero: solo esa persona los elige. */
    val isOwner: Boolean get() = board?.board?.isOwner == true

    var draft by mutableStateOf(CardDraft())
        private set
    var saving by mutableStateOf(false)
        private set
    /** Borradores guardados o descartados (el editor de la descripción se cierra con ellos). */
    var settled by mutableIntStateOf(0)
        private set
    var savedNotice by mutableStateOf(false)

    /** Hay cambios sin guardar (comparados con la tarjeta: volver al valor de antes no cuenta). */
    val dirty: Boolean get() = canWrite && card?.let { draft.patch(it, isOwner).isNotEmpty() } == true

    fun edit(change: (CardDraft) -> CardDraft) {
        draft = change(draft)
    }

    fun discard() {
        draft = CardDraft()
        settled++
    }

    /** Manda de una vez todo lo cambiado (una fila de actividad por campo) y llama a [onSaved]. */
    fun save(onSaved: () -> Unit = {}) {
        val current = card ?: return
        val body = draft.patch(current, isOwner)
        if (saving || body.isEmpty() || draft.title(current).isBlank()) return
        val sent = draft
        mutations++
        saving = true
        busy = true
        viewModelScope.launch {
            apiCall { api.updateCard(cardId, body) }
                .onSuccess {
                    card = it.card
                    draft = draft.afterSave(sent)
                    settled++
                    savedNotice = true
                    graph.changes.boardsChanged()
                    onSaved()
                }
                .onFailure { message = it.apiError }
            saving = false
            busy = false
        }
    }

    fun move(columnId: String, assignee: String? = null) {
        val target = board?.cards?.count { it.columnId == columnId && it.id != cardId } ?: 0
        mutations++
        busy = true
        viewModelScope.launch {
            apiCall {
                api.moveCard(cardId, buildJsonObject {
                    put("columnId", JsonPrimitive(columnId))
                    put("index", JsonPrimitive(target))
                    if (assignee != null) put("assignee", JsonPrimitive(assignee))
                })
            }.onSuccess {
                card = it.card
                graph.changes.boardsChanged()
            }.onFailure { message = it.apiError }
            busy = false
        }
    }

    fun addChecklistItem(text: String) = run { api.addChecklistItem(cardId, TextRequest(text.trim())) }
    fun toggleChecklistItem(id: String, done: Boolean) = run { api.updateChecklistItem(id, JsonObject(mapOf("done" to JsonPrimitive(done)))) }
    fun renameChecklistItem(id: String, text: String) = run { api.updateChecklistItem(id, JsonObject(mapOf("text" to JsonPrimitive(text.trim())))) }
    fun deleteChecklistItem(id: String) = run { api.deleteChecklistItem(id) }

    fun addComment(body: String) = run { api.addComment(cardId, CommentRequest(body.trim())) }
    fun editComment(id: String, body: String) = run { api.updateComment(id, CommentRequest(body.trim())) }
    fun deleteComment(id: String) = run { api.deleteComment(id) }

    fun archive(archived: Boolean) = run { if (archived) api.archiveCard(cardId) else api.restoreCard(cardId) }

    fun delete() {
        mutations++
        busy = true
        viewModelScope.launch {
            apiCall { api.deleteCard(cardId) }.onSuccess {
                deleted = true
                graph.changes.boardsChanged()
            }.onFailure { message = it.apiError }
            busy = false
        }
    }

    // ── Adjuntos (F4-06) ──

    /** Sube el documento elegido en streaming, con su tamaño exacto (la API lo exige). */
    fun upload(context: Context, uri: Uri) {
        val resolver = context.contentResolver
        val (name, size) = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) to cursor.getLong(1) else null
        } ?: return
        if (size <= 0) return
        if (size > MAX_ATTACHMENT_BYTES) {
            tooLarge = true
            return
        }
        val type = resolver.getType(uri) ?: "application/octet-stream"
        val body = object : RequestBody() {
            override fun contentType(): MediaType? = type.toMediaTypeOrNull()
            override fun contentLength(): Long = size
            override fun writeTo(sink: BufferedSink) {
                resolver.openInputStream(uri)?.use { sink.writeAll(it.source()) } ?: throw java.io.IOException("Sin acceso al fichero")
            }
        }
        mutations++
        uploading = true
        viewModelScope.launch {
            apiCall { api.uploadAttachment(cardId, Uri.encode(name ?: "fichero"), body) }
                .onSuccess {
                    card = it.card
                    graph.changes.boardsChanged()
                }.onFailure { message = it.apiError }
            uploading = false
        }
    }

    /** Descarga el adjunto a la caché (se borra al cerrar sesión) y lo abre con otra app. */
    fun open(context: Context, attachment: CardAttachment) {
        viewModelScope.launch {
            val result = apiCall {
                val body = api.downloadAttachment(attachment.id)
                withContext(Dispatchers.IO) {
                    val dir = File(context.cacheDir, "downloads/${attachment.id}").apply { mkdirs() }
                    val safe = attachment.filename.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "fichero" }
                    val file = File(dir, safe)
                    body.use { input -> file.outputStream().use { input.byteStream().copyTo(it) } }
                    file
                }
            }
            result.onSuccess { file ->
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, attachment.contentType).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                try {
                    context.startActivity(Intent.createChooser(view, attachment.filename))
                } catch (_: Exception) {
                    message = ApiError.Unexpected(null)
                }
            }.onFailure { message = (it as? ApiException)?.error ?: it.apiError }
        }
    }

    fun deleteAttachment(id: String) = run { api.deleteAttachment(id) }
}
