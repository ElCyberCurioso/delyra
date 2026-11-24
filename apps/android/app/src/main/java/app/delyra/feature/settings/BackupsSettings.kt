package app.delyra.feature.settings

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Restore
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.delyra.AppGraph
import app.delyra.R
import app.delyra.core.i18n.serverText
import app.delyra.core.model.BackupSettings
import app.delyra.core.model.BackupsResponse
import app.delyra.core.model.RestoreFromBackupRequest
import app.delyra.core.model.RestoreInfo
import app.delyra.core.model.StartRestoreRequest
import app.delyra.core.model.UserBackup
import app.delyra.core.network.ApiError
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import app.delyra.core.ui.ConfirmDialog
import app.delyra.core.ui.ErrorText
import app.delyra.core.ui.Tile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import java.io.IOException

/** `BACKUP_LIMITS.uploadBytes` de `packages/shared/src/schemas/backups.ts`. */
private const val MAX_UPLOAD_BYTES = 200L * 1024 * 1024
private const val KEEP_AUTO_MAX = 12
private val FREQUENCIES = listOf("off", "daily", "weekly", "monthly")

/**
 * Copias de seguridad de usuario (F6-03 a F6-05 en la web): crear, descargar al documento que se
 * elija (Storage Access Framework), borrar, copias automáticas, restaurar (de una copia guardada o
 * de un fichero), fusionar o reemplazar y deshacer. Mientras una copia o una restauración están en
 * marcha se pregunta cada 1,5 s, como la web.
 */
class BackupsViewModel(private val graph: AppGraph) : ViewModel() {
    private val api = graph.backupsApi
    var data by mutableStateOf<BackupsResponse?>(null)
        private set
    var loadError by mutableStateOf<ApiError?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var restoreBusy by mutableStateOf(false)
        private set
    var restoreError by mutableStateOf<ApiError?>(null)
        private set
    var message by mutableStateOf<ApiError?>(null)
    var notice by mutableStateOf<Int?>(null)
    private var polling: Job? = null

    /** Una lista pedida antes de un cambio no pisa la que llega después del cambio. */
    private var version = 0

    /** Sube al empezar o deshacer una restauración (queda en el historial de seguridad). */
    var revision by mutableIntStateOf(0)
        private set

    /** La restauración que se enseña: la última, si no se deshizo. */
    val restore: RestoreInfo? get() = data?.restores?.firstOrNull { it.status != "undone" }

    fun refresh() {
        val requested = ++version
        viewModelScope.launch {
            apiCall { api.backups() }
                .onSuccess { if (requested == version) apply(it) }
                .onFailure { if (data == null) loadError = it.apiError }
        }
    }

    private fun apply(next: BackupsResponse) {
        val before = data?.restores.orEmpty().associate { it.id to it.status }
        loadError = null
        data = next
        // Una restauración que acaba de terminar cambia calendarios y tableros: se vuelven a pedir.
        if (next.restores.any { it.status == "succeeded" && before[it.id] in setOf("restoring", "validating", "ready") }) {
            graph.changes.calendarChanged()
            graph.changes.boardsChanged()
        }
        if (next.isBusy()) startPolling()
    }

    private fun BackupsResponse.isBusy() =
        backups.any { it.status == "running" } || restores.any { it.status == "validating" || it.status == "restoring" }

    private fun startPolling() {
        if (polling?.isActive == true) return
        polling = viewModelScope.launch {
            while (isActive) {
                delay(1_500)
                val requested = ++version
                val next = apiCall { api.backups() }.getOrNull() ?: continue
                if (requested == version) apply(next)
                if (!next.isBusy()) break
            }
        }
    }

    fun create() = act(R.string.backups_creating) { api.createBackup() }

    fun setFrequency(frequency: String) {
        val current = data?.settings ?: return
        updateSettings(current.copy(frequency = frequency))
    }

    fun setKeep(keep: Int) {
        val current = data?.settings ?: return
        updateSettings(current.copy(keep = keep))
    }

    private fun updateSettings(settings: BackupSettings) {
        val previous = data ?: return
        data = previous.copy(settings = settings)
        version++
        viewModelScope.launch {
            apiCall { api.updateSettings(settings) }
                .onSuccess { r -> data = data?.copy(settings = r.settings) }
                .onFailure { data = data?.copy(settings = previous.settings); message = it.apiError }
        }
    }

    /** Copia el `.zip` en el documento elegido; no pasa por la caché de la app. */
    fun download(backup: UserBackup, target: Uri, resolver: ContentResolver) {
        viewModelScope.launch {
            apiCall {
                val body = api.download(backup.id)
                withContext(Dispatchers.IO) {
                    body.use { input ->
                        resolver.openOutputStream(target)?.use { out -> input.byteStream().copyTo(out) } ?: throw IOException("Sin acceso al documento")
                    }
                }
            }.onSuccess { notice = R.string.backups_downloaded }.onFailure { message = it.apiError }
        }
    }

    fun delete(backup: UserBackup) = act(R.string.backups_deleted) { api.deleteBackup(backup.id) }

    fun restoreFrom(backup: UserBackup) = act { api.restoreBackup(RestoreFromBackupRequest(backup.id)) }

    /** Sube el fichero en streaming con su tamaño exacto (la API lo exige), como los adjuntos. */
    fun upload(resolver: ContentResolver, uri: Uri) {
        val (name, size) = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) to cursor.getLong(1) else null
        } ?: return
        if (size <= 0) return
        if (size > MAX_UPLOAD_BYTES) {
            notice = R.string.backups_too_large
            return
        }
        val type = resolver.getType(uri) ?: "application/octet-stream"
        val body = object : RequestBody() {
            override fun contentType(): MediaType? = type.toMediaTypeOrNull()
            override fun contentLength(): Long = size
            override fun writeTo(sink: BufferedSink) {
                resolver.openInputStream(uri)?.use { sink.writeAll(it.source()) } ?: throw IOException("Sin acceso al fichero")
            }
        }
        act { api.upload(Uri.encode(name ?: "copia.zip"), body) }
    }

    fun start(restore: RestoreInfo, mode: String) = restoreAction(audited = true) { api.start(restore.id, StartRestoreRequest(mode)) }

    fun undo(restore: RestoreInfo) = restoreAction(audited = true) { api.undo(restore.id) }

    fun discard(restore: RestoreInfo) = restoreAction { api.discard(restore.id) }

    private fun act(success: Int? = null, call: suspend () -> Any) {
        if (busy) return
        busy = true
        version++
        viewModelScope.launch {
            apiCall { call() }
                .onSuccess { success?.let { notice = it } }
                .onFailure { message = it.apiError }
            busy = false
            refresh()
        }
    }

    private fun restoreAction(audited: Boolean = false, call: suspend () -> Any) {
        if (restoreBusy) return
        restoreBusy = true
        restoreError = null
        version++
        viewModelScope.launch {
            apiCall { call() }.onSuccess { if (audited) revision++ }.onFailure { restoreError = it.apiError }
            restoreBusy = false
            refresh()
        }
    }

    override fun onCleared() {
        polling?.cancel()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun BackupsTile(vm: BackupsViewModel) {
    val context = LocalContext.current
    var downloading by remember { mutableStateOf<UserBackup?>(null) }
    var deleting by remember { mutableStateOf<UserBackup?>(null) }
    val saveZip = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
        val backup = downloading
        downloading = null
        if (uri != null && backup != null) vm.download(backup, uri, context.contentResolver)
    }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.upload(context.contentResolver, uri)
    }
    val data = vm.data
    val running = data?.backups?.any { it.status == "running" } == true
    Tile(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) { TileTitle(stringResource(R.string.backups_title)) }
                Button(onClick = vm::create, enabled = data != null && !vm.busy && !running) {
                    if (running) CircularProgressIndicator(Modifier.padding(end = 8.dp).size(16.dp), strokeWidth = 2.dp)
                    Text(stringResource(R.string.backups_create))
                }
            }
            Hint(stringResource(R.string.backups_intro))
            if (data == null) {
                if (vm.loadError != null) {
                    ErrorText(vm.loadError)
                    OutlinedButton(onClick = vm::refresh) { Text(stringResource(R.string.action_retry)) }
                } else {
                    CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                }
                return@Column
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                LabeledMenu(
                    label = stringResource(R.string.backups_auto),
                    value = frequencyLabel(data.settings.frequency),
                    options = FREQUENCIES.map { it to frequencyLabel(it) },
                    onPick = vm::setFrequency,
                )
                LabeledMenu(
                    label = stringResource(R.string.backups_keep),
                    value = data.settings.keep.toString(),
                    options = (1..KEEP_AUTO_MAX).map { it.toString() to it.toString() },
                    enabled = data.settings.frequency != "off",
                    onPick = { vm.setKeep(it.toInt()) },
                )
            }
            vm.restore?.let { RestorePanel(vm, it) }
            OutlinedButton(
                onClick = { pickFile.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/json", "application/octet-stream")) },
                enabled = !vm.busy,
            ) {
                Icon(Icons.Outlined.UploadFile, null, Modifier.padding(end = 8.dp).size(18.dp))
                Text(stringResource(R.string.backups_from_file))
            }
            HorizontalDivider(Modifier.padding(vertical = 4.dp))
            if (data.backups.isEmpty()) Hint(stringResource(R.string.backups_none))
            data.backups.forEach { backup ->
                BackupRow(
                    backup,
                    enabled = !vm.busy,
                    onDownload = { downloading = backup; saveZip.launch("delyra-copia-${backup.createdAt.take(10)}.zip") },
                    onRestore = { vm.restoreFrom(backup) },
                    onDelete = { deleting = backup },
                )
            }
        }
    }
    deleting?.let { backup ->
        ConfirmDialog(
            title = stringResource(R.string.backups_delete),
            text = stringResource(R.string.backups_delete_body),
            confirmLabel = stringResource(R.string.action_delete),
            destructive = true,
            onConfirm = { vm.delete(backup) },
            onDismiss = { deleting = null },
        )
    }
}

@Composable
private fun frequencyLabel(frequency: String): String = stringResource(
    when (frequency) {
        "daily" -> R.string.backups_freq_daily
        "weekly" -> R.string.backups_freq_weekly
        "monthly" -> R.string.backups_freq_monthly
        else -> R.string.backups_freq_off
    },
)

@Composable
private fun kindLabel(kind: String): String = stringResource(
    when (kind) {
        "auto" -> R.string.backups_kind_auto
        "pre_restore" -> R.string.backups_kind_pre_restore
        else -> R.string.backups_kind_manual
    },
)

@Composable
private fun LabeledMenu(label: String, value: String, options: List<Pair<String, String>>, onPick: (String) -> Unit, enabled: Boolean = true) {
    var open by remember { mutableStateOf(false) }
    Column {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Box {
            TextButton(onClick = { open = true }, enabled = enabled) { Text(value) }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                options.forEach { (key, text) ->
                    DropdownMenuItem(text = { Text(text) }, onClick = { open = false; onPick(key) })
                }
            }
        }
    }
}

@Composable
private fun BackupRow(backup: UserBackup, enabled: Boolean, onDownload: () -> Unit, onRestore: () -> Unit, onDelete: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("${kindLabel(backup.kind)} · ${accountDateTime(backup.createdAt)}", style = MaterialTheme.typography.bodyMedium)
            val detail = when (backup.status) {
                "running" -> stringResource(R.string.backups_creating)
                "failed" -> backup.error?.let { serverText(it) } ?: stringResource(R.string.backups_failed)
                else -> listOf(formatSize(backup.sizeBytes), describeCounts(backup.counts)).filter { it.isNotEmpty() }.joinToString(" · ")
            }
            Text(
                detail,
                style = MaterialTheme.typography.bodySmall,
                color = if (backup.status == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (backup.status == "ready") {
            IconButton(onClick = onDownload) { Icon(Icons.Outlined.Download, stringResource(R.string.backups_download)) }
            IconButton(onClick = onRestore, enabled = enabled) { Icon(Icons.Outlined.Restore, stringResource(R.string.backups_restore)) }
        }
        if (backup.status != "running") {
            IconButton(onClick = onDelete, enabled = enabled) { Icon(Icons.Outlined.Delete, stringResource(R.string.backups_delete)) }
        }
    }
}

@Composable
private fun RestorePanel(vm: BackupsViewModel, restore: RestoreInfo) {
    var mode by rememberSaveable(restore.id) { mutableStateOf("merge") }
    var confirming by remember { mutableStateOf(false) }
    val canUndo = restore.preBackupId != null && restore.undoOf == null && (restore.status == "succeeded" || restore.status == "failed")
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                if (restore.undoOf != null) stringResource(R.string.restore_undoing)
                else stringResource(R.string.restore_named, restore.filename ?: stringResource(R.string.restore_saved_copy)),
                style = MaterialTheme.typography.titleSmall,
            )
            ErrorText(vm.restoreError)
            when (restore.status) {
                "validating" -> Working(stringResource(R.string.restore_validating))
                "ready" -> {
                    Text(
                        stringResource(
                            R.string.restore_copy_of,
                            restore.exportedAt?.let { accountDateTime(it) } ?: stringResource(R.string.restore_no_date),
                            describeCounts(restore.counts),
                        ),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    restore.warnings.forEach { warning ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(Icons.Outlined.WarningAmber, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.tertiary)
                            Text(serverText(warning), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    Text(stringResource(R.string.restore_how), style = MaterialTheme.typography.labelLarge)
                    Column(Modifier.selectableGroup()) {
                        ModeOption("merge", stringResource(R.string.restore_merge), stringResource(R.string.restore_merge_detail), mode) { mode = it }
                        ModeOption("replace", stringResource(R.string.restore_replace), stringResource(R.string.restore_replace_detail), mode) { mode = it }
                    }
                    Hint(stringResource(R.string.restore_safety))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { if (mode == "replace") confirming = true else vm.start(restore, mode) }, enabled = !vm.restoreBusy) {
                            Text(stringResource(R.string.backups_restore))
                        }
                        OutlinedButton(onClick = { vm.discard(restore) }, enabled = !vm.restoreBusy) { Text(stringResource(R.string.restore_discard)) }
                    }
                }
                "restoring" -> {
                    Working(stringResource(R.string.restore_restoring))
                    val total = restore.progress.total
                    if (total > 0) {
                        LinearProgressIndicator(progress = { restore.progress.done.toFloat() / total }, modifier = Modifier.fillMaxWidth())
                    } else {
                        LinearProgressIndicator(Modifier.fillMaxWidth())
                    }
                }
                "succeeded" -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.CheckCircle, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                    Text(stringResource(if (restore.undoOf != null) R.string.restore_undone else R.string.restore_restored), style = MaterialTheme.typography.bodyMedium)
                }
                "failed", "expired" -> Text(
                    when {
                        restore.status == "expired" -> stringResource(R.string.restore_expired)
                        restore.error != null -> serverText(restore.error)
                        else -> stringResource(R.string.restore_failed)
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            if (canUndo) {
                OutlinedButton(onClick = { vm.undo(restore) }, enabled = !vm.restoreBusy) {
                    Icon(Icons.Outlined.Restore, null, Modifier.padding(end = 8.dp).size(18.dp))
                    Text(stringResource(R.string.restore_undo))
                }
            }
        }
    }
    if (confirming) {
        ConfirmDialog(
            title = stringResource(R.string.restore_confirm_title),
            text = stringResource(R.string.restore_confirm_body),
            confirmLabel = stringResource(R.string.restore_replace),
            destructive = true,
            onConfirm = { vm.start(restore, "replace") },
            onDismiss = { confirming = false },
        )
    }
}

@Composable
private fun Working(text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ModeOption(value: String, title: String, detail: String, selected: String, onSelect: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().selectable(selected == value, role = Role.RadioButton) { onSelect(value) }.padding(vertical = 4.dp),
        verticalAlignment = Alignment.Top,
    ) {
        RadioButton(selected = selected == value, onClick = null, modifier = Modifier.padding(end = 8.dp, top = 2.dp))
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(title) }
                append(" ")
                append(detail)
            },
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}
