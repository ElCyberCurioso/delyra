package app.delyra.feature.kanban

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.runtime.getValue
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
import app.delyra.core.model.DueInfo
import app.delyra.core.model.TextRequest
import app.delyra.core.network.ApiError
import app.delyra.core.network.ApiException
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
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

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            apiCall { api.card(cardId) }.onSuccess { response ->
                card = response.card
                loadError = null
                if (board?.board?.id != response.card.boardId) {
                    apiCall { api.board(response.card.boardId) }.onSuccess { board = it }
                }
            }.onFailure { loadError = it.apiError }
        }
    }

    private fun run(block: suspend () -> CardResponse) {
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

    private fun patch(vararg fields: Pair<String, JsonElement>) = run { api.updateCard(cardId, JsonObject(fields.toMap())) }

    fun setTitle(title: String) = patch("title" to JsonPrimitive(title.trim()))
    fun setDescription(text: String) = patch("description" to JsonPrimitive(text))
    fun setPriority(priority: String) = patch("priority" to JsonPrimitive(priority))
    fun setKind(kind: String) = patch("kind" to JsonPrimitive(kind))
    fun setColor(color: String?) = patch("color" to (color?.let(::JsonPrimitive) ?: JsonNull))
    fun setAssignee(name: String?) = patch("assignee" to JsonPrimitive(name?.trim().orEmpty()))
    fun setLabels(ids: List<String>) = patch("labelIds" to JsonArray(ids.map(::JsonPrimitive)))

    fun setDue(due: DueInfo?) {
        val value = due?.let {
            buildJsonObject {
                put("allDay", JsonPrimitive(it.allDay))
                put("at", JsonPrimitive(it.at))
                put("tz", JsonPrimitive(it.tz))
            }
        } ?: JsonNull
        // Sin fecha no hay alertas: la API las quita, y la vista también.
        patch("due" to value)
    }

    fun setReminders(offsets: List<Int>) = patch(
        "reminders" to JsonArray(offsets.distinct().map { JsonObject(mapOf("offsetMinutes" to JsonPrimitive(it), "channel" to JsonPrimitive("telegram"))) }),
    )

    fun move(columnId: String, assignee: String? = null) {
        val target = board?.cards?.count { it.columnId == columnId && it.id != cardId } ?: 0
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
