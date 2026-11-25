package app.delyra.feature.kanban

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.viewModelScope
import app.delyra.AppGraph
import app.delyra.R
import app.delyra.core.i18n.serverText
import app.delyra.core.model.BoardColumn
import app.delyra.core.model.MicrosoftBoardInfo
import app.delyra.core.model.MicrosoftBoardSyncRequest
import app.delyra.core.network.ApiError
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import app.delyra.core.ui.ConfirmDialog
import app.delyra.core.ui.ErrorText
import app.delyra.core.ui.LocalAppGraph
import app.delyra.core.ui.appViewModel
import app.delyra.core.ui.openInBrowser
import app.delyra.feature.settings.Hint
import app.delyra.feature.settings.accountDateTime
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val DAYS_AHEAD = listOf(7, 14, 30)

/**
 * Reuniones de Teams en un tablero (`teams-section.tsx`, docs/plan-teams.md): ver el estado,
 * elegir columna y opciones, actualizar, dejar de volcar y desconectar. Conectar Microsoft 365 (el
 * OAuth) se hace en la web de tareas; al volver a la app se pregunta de nuevo.
 */
class TeamsViewModel(private val graph: AppGraph, private val boardId: String) : ViewModel() {
    private val api = graph.integrationsApi
    var info by mutableStateOf<MicrosoftBoardInfo?>(null)
        private set
    var loadError by mutableStateOf<ApiError?>(null)
        private set
    var error by mutableStateOf<ApiError?>(null)
        private set
    var notice by mutableStateOf<Int?>(null)
    var busy by mutableStateOf(false)
        private set
    private var polling: Job? = null

    fun load() {
        viewModelScope.launch {
            apiCall { api.teams(boardId) }.onSuccess { apply(it) }.onFailure { loadError = it.apiError }
        }
    }

    private fun apply(next: MicrosoftBoardInfo) {
        info = next
        loadError = null
        if (next.sync?.status == "pending" && polling?.isActive != true) {
            polling = viewModelScope.launch {
                repeat(60) {
                    delay(2_000)
                    val again = apiCall { api.teams(boardId) }.getOrNull() ?: return@repeat
                    info = again
                    if (again.sync?.status != "pending") {
                        graph.changes.remoteBoardChanged(boardId)
                        return@launch
                    }
                }
            }
        }
    }

    fun save(columnId: String, onlyTeams: Boolean, daysAhead: Int) {
        val first = info?.sync == null
        act(if (first) R.string.teams_started else R.string.teams_updated) {
            apply(api.saveTeams(boardId, MicrosoftBoardSyncRequest(columnId, onlyTeams, daysAhead)))
        }
    }

    fun syncNow() = act { apply(api.syncTeams(boardId)) }

    fun stop() = act(R.string.teams_stopped) {
        api.stopTeams(boardId)
        apply(api.teams(boardId))
    }

    fun disconnect() = act(R.string.teams_disconnected) {
        api.disconnectMicrosoft()
        apply(api.teams(boardId))
    }

    private fun act(success: Int? = null, block: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            apiCall { block() }
                .onSuccess {
                    success?.let { notice = it }
                    graph.changes.remoteBoardChanged(boardId)
                }
                .onFailure { error = it.apiError }
            busy = false
        }
    }

    override fun onCleared() {
        polling?.cancel()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamsSheet(boardId: String, columns: List<BoardColumn>, isOwner: Boolean, onMessage: (String) -> Unit, onDismiss: () -> Unit) {
    val vm = appViewModel(key = "teams-$boardId") { TeamsViewModel(it, boardId) }
    val context = LocalContext.current
    val graph = LocalAppGraph.current
    var confirmStop by remember { mutableStateOf(false) }
    var confirmDisconnect by remember { mutableStateOf(false) }
    val noticeText = vm.notice?.let { stringResource(it) }
    androidx.compose.runtime.LaunchedEffect(vm.notice) {
        noticeText?.let(onMessage)
        vm.notice = null
    }
    // Al volver de la web (conectar Microsoft 365) se pregunta de nuevo.
    LifecycleResumeEffect(boardId) {
        vm.load()
        onPauseOrDispose { }
    }
    val openWeb = { openInBrowser(context, "${graph.environment.workOrigin}/tableros/$boardId") }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(stringResource(R.string.teams_title), style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            Hint(stringResource(R.string.teams_intro))
            val info = vm.info
            when {
                info == null && vm.loadError != null -> ErrorText(vm.loadError)
                info == null -> CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                !info.enabled -> Text(stringResource(R.string.teams_unavailable), style = MaterialTheme.typography.bodyMedium)
                else -> TeamsContent(
                    vm = vm,
                    info = info,
                    columns = columns,
                    canStop = info.sync != null && (info.sync.mine || isOwner),
                    onConnect = { openWeb() },
                    onStop = { confirmStop = true },
                    onDisconnect = { confirmDisconnect = true },
                )
            }
            ErrorText(vm.error)
        }
    }
    if (confirmStop) {
        ConfirmDialog(
            title = stringResource(R.string.teams_stop),
            text = stringResource(R.string.teams_stop_body),
            confirmLabel = stringResource(R.string.teams_stop),
            destructive = true,
            onConfirm = vm::stop,
            onDismiss = { confirmStop = false },
        )
    }
    if (confirmDisconnect) {
        ConfirmDialog(
            title = stringResource(R.string.teams_disconnect),
            text = stringResource(R.string.teams_disconnect_body),
            confirmLabel = stringResource(R.string.teams_disconnect),
            destructive = true,
            onConfirm = vm::disconnect,
            onDismiss = { confirmDisconnect = false },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TeamsContent(
    vm: TeamsViewModel,
    info: MicrosoftBoardInfo,
    columns: List<BoardColumn>,
    canStop: Boolean,
    onConnect: () -> Unit,
    onStop: () -> Unit,
    onDisconnect: () -> Unit,
) {
    val connection = info.connection
    val sync = info.sync
    if (sync?.mine == true) {
        Text(
            when (sync.status) {
                "pending" -> stringResource(R.string.teams_syncing)
                "error" -> sync.error?.let { serverText(it) }.orEmpty()
                else -> listOfNotNull(
                    pluralStringResource(R.plurals.teams_status, sync.cards, sync.cards),
                    sync.lastSyncedAt?.let { stringResource(R.string.imports_updated, accountDateTime(it)) },
                ).joinToString(" · ")
            },
            style = MaterialTheme.typography.bodyMedium,
            color = if (sync.status == "error") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    when {
        connection == null -> if (sync == null || sync.mine) {
            Hint(stringResource(R.string.teams_permission))
            Hint(stringResource(R.string.teams_web_note))
            Button(onClick = onConnect) {
                Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, Modifier.padding(end = 8.dp).size(18.dp))
                Text(stringResource(R.string.teams_connect))
            }
        } else {
            Hint(stringResource(R.string.teams_someone_else))
        }
        connection.status == "revoked" -> {
            Text(stringResource(R.string.teams_revoked), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(onClick = onConnect) { Text(stringResource(R.string.teams_reconnect)) }
        }
        sync == null || sync.mine -> {
            Text(
                stringResource(R.string.teams_connected_as, connection.email ?: stringResource(R.string.teams_your_account)),
                style = MaterialTheme.typography.bodyMedium,
            )
            SyncForm(vm, columns, info)
        }
        else -> Hint(stringResource(R.string.teams_someone_else))
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (sync?.mine == true && connection?.status == "ok") {
            OutlinedButton(onClick = vm::syncNow, enabled = !vm.busy && sync.status != "pending") {
                Icon(Icons.Outlined.Refresh, null, Modifier.padding(end = 8.dp).size(18.dp))
                Text(stringResource(R.string.teams_sync_now))
            }
        }
        if (canStop) TextButton(onClick = onStop, enabled = !vm.busy) { Text(stringResource(R.string.teams_stop)) }
        if (connection != null) {
            TextButton(onClick = onDisconnect, enabled = !vm.busy) { Text(stringResource(R.string.teams_disconnect), color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun SyncForm(vm: TeamsViewModel, columns: List<BoardColumn>, info: MicrosoftBoardInfo) {
    if (columns.isEmpty()) {
        Hint(stringResource(R.string.teams_no_columns))
        return
    }
    val current = info.sync
    var columnId by rememberSaveable(current?.columnId) { mutableStateOf(current?.columnId ?: columns.first().id) }
    var onlyTeams by rememberSaveable(current?.onlyTeams) { mutableStateOf(current?.onlyTeams ?: true) }
    var days by rememberSaveable(current?.daysAhead) { mutableIntStateOf(current?.daysAhead ?: 14) }
    var columnMenu by remember { mutableStateOf(false) }
    var daysMenu by remember { mutableStateOf(false) }
    HorizontalDivider(Modifier.padding(vertical = 4.dp))
    Text(stringResource(R.string.teams_column), style = MaterialTheme.typography.labelLarge)
    Box {
        TextButton(onClick = { columnMenu = true }) { Text(columns.firstOrNull { it.id == columnId }?.name ?: columns.first().name) }
        DropdownMenu(expanded = columnMenu, onDismissRequest = { columnMenu = false }) {
            columns.forEach { column ->
                DropdownMenuItem(text = { Text(column.name) }, onClick = { columnMenu = false; columnId = column.id })
            }
        }
    }
    Text(stringResource(R.string.teams_days_ahead), style = MaterialTheme.typography.labelLarge)
    Box {
        TextButton(onClick = { daysMenu = true }) { Text(pluralStringResource(R.plurals.teams_days, days, days)) }
        DropdownMenu(expanded = daysMenu, onDismissRequest = { daysMenu = false }) {
            DAYS_AHEAD.forEach { n ->
                DropdownMenuItem(text = { Text(pluralStringResource(R.plurals.teams_days, n, n)) }, onClick = { daysMenu = false; days = n })
            }
        }
    }
    Row(
        Modifier.fillMaxWidth().toggleable(onlyTeams, role = Role.Switch) { onlyTeams = it },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.teams_only_teams), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Switch(checked = onlyTeams, onCheckedChange = null)
    }
    if (current == null) {
        Button(onClick = { vm.save(columnId, onlyTeams, days) }, enabled = !vm.busy) { Text(stringResource(R.string.teams_start)) }
    } else {
        OutlinedButton(onClick = { vm.save(columnId, onlyTeams, days) }, enabled = !vm.busy) { Text(stringResource(R.string.teams_save)) }
    }
}
