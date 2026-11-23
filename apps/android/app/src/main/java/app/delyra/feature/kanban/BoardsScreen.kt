package app.delyra.feature.kanban

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.delyra.AppGraph
import app.delyra.R
import app.delyra.core.model.BoardSummary
import app.delyra.core.model.CreateBoardRequest
import app.delyra.core.model.PendingBoardInvitation
import app.delyra.core.network.ApiError
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import app.delyra.core.ui.EmptyState
import app.delyra.core.ui.ErrorState
import app.delyra.core.ui.LoadingBox
import app.delyra.core.ui.Tile
import app.delyra.core.ui.appViewModel
import app.delyra.core.ui.message
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch

class BoardsViewModel(private val graph: AppGraph) : ViewModel() {
    private val api = graph.kanbanApi
    var boards by mutableStateOf<List<BoardSummary>?>(null)
        private set
    var invitations by mutableStateOf<List<PendingBoardInvitation>>(emptyList())
        private set
    var error by mutableStateOf<ApiError?>(null)
        private set
    var refreshing by mutableStateOf(false)
        private set
    var message by mutableStateOf<ApiError?>(null)
    var created by mutableStateOf<String?>(null)

    init {
        load()
        viewModelScope.launch { graph.changes.boards.drop(1).collect { load() } }
    }

    fun load() {
        refreshing = true
        viewModelScope.launch {
            apiCall { api.boards() }.onSuccess { boards = it.boards; error = null }.onFailure { error = it.apiError }
            apiCall { api.pendingInvitations() }.onSuccess { invitations = it.invitations }
            refreshing = false
        }
    }

    fun create(name: String, template: String) {
        viewModelScope.launch {
            apiCall { api.createBoard(CreateBoardRequest(name, template)) }
                .onSuccess { created = it.board.id; load() }
                .onFailure { message = it.apiError }
        }
    }

    fun answer(invitation: PendingBoardInvitation, accept: Boolean) {
        viewModelScope.launch {
            val result = if (accept) apiCall { api.acceptInvitation(invitation.id).boardId } else apiCall { api.declineInvitation(invitation.id); null }
            result.onSuccess { boardId -> if (boardId != null) created = boardId; load() }.onFailure { message = it.apiError }
        }
    }
}

/** Tableros (F8-04): rejilla de mosaicos con tantas columnas como quepan. */
@Composable
fun BoardsScreen(onOpenBoard: (String) -> Unit) {
    val vm = appViewModel { BoardsViewModel(it) }
    var creating by rememberSaveable { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val messageText = vm.message?.message()
    LaunchedEffect(vm.message) {
        if (messageText != null) {
            snackbar.showSnackbar(messageText)
            vm.message = null
        }
    }
    LaunchedEffect(vm.created) {
        vm.created?.let { onOpenBoard(it); vm.created = null }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.boards_title)) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(onClick = { creating = true }, icon = { Icon(Icons.Default.Add, null) }, text = { Text(stringResource(R.string.boards_new)) })
        },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        val boards = vm.boards
        when {
            boards == null && vm.error != null -> ErrorState(vm.error!!, onRetry = vm::load, modifier = Modifier.padding(padding))
            boards == null -> LoadingBox(Modifier.padding(padding))
            else -> PullToRefreshBox(isRefreshing = vm.refreshing, onRefresh = vm::load, modifier = Modifier.fillMaxSize().padding(padding)) {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(280.dp),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    vm.invitations.forEach { invitation ->
                        item(key = "inv:${invitation.id}", span = { GridItemSpan(maxLineSpan) }) { InvitationTile(invitation, vm::answer) }
                    }
                    item(key = "stats", span = { GridItemSpan(maxLineSpan) }) { StatsRow(boards) }
                    if (boards.isEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            EmptyState(stringResource(R.string.boards_empty_title), stringResource(R.string.boards_empty_body)) {
                                Button(onClick = { creating = true }) { Text(stringResource(R.string.boards_create_first)) }
                            }
                        }
                    }
                    items(boards, key = { it.id }) { board -> BoardTile(board) { onOpenBoard(board.id) } }
                }
            }
        }
    }
    if (creating) CreateBoardDialog(onDismiss = { creating = false }, onCreate = vm::create)
}

@Composable
private fun StatsRow(boards: List<BoardSummary>) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Stat(stringResource(R.string.boards_stat_boards), boards.size, Modifier.weight(1f))
        Stat(stringResource(R.string.boards_stat_open), boards.sumOf { it.openCards }, Modifier.weight(1f))
        Stat(stringResource(R.string.boards_stat_shared), boards.count { it.members > 0 || it.ownerName != null }, Modifier.weight(1f))
    }
}

@Composable
private fun Stat(label: String, value: Int, modifier: Modifier) {
    Tile(modifier) {
        Column(Modifier.padding(12.dp)) {
            Text(value.toString(), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
        }
    }
}

@Composable
private fun BoardTile(board: BoardSummary, onClick: () -> Unit) {
    Tile(Modifier.fillMaxWidth().heightIn(min = 120.dp), onClick = onClick) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(templateIcon(board.template), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
                Text(board.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), maxLines = 2)
                if (board.members > 0 || board.ownerName != null) Icon(Icons.Outlined.Group, stringResource(R.string.boards_stat_shared), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(
                androidx.compose.ui.res.pluralStringResource(R.plurals.boards_open_cards, board.openCards, board.openCards),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            board.ownerName?.let {
                Text(stringResource(R.string.boards_owned_by, it, roleLabel(board.role)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun InvitationTile(invitation: PendingBoardInvitation, onAnswer: (PendingBoardInvitation, Boolean) -> Unit) {
    Tile(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                stringResource(R.string.invitation_title, invitation.invitedBy ?: stringResource(R.string.invitation_someone), invitation.boardName),
                style = MaterialTheme.typography.titleSmall,
            )
            Text(roleLabel(invitation.role), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onAnswer(invitation, true) }) { Text(stringResource(R.string.invitation_accept)) }
                OutlinedButton(onClick = { onAnswer(invitation, false) }) { Text(stringResource(R.string.invitation_decline)) }
            }
        }
    }
}

@Composable
private fun CreateBoardDialog(onDismiss: () -> Unit, onCreate: (String, String) -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var template by rememberSaveable { mutableStateOf("personal") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.boards_new)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(80) },
                    label = { Text(stringResource(R.string.field_name)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                BOARD_TEMPLATES.forEach { option ->
                    Row(
                        Modifier.fillMaxWidth().selectable(template == option, role = Role.RadioButton) { template = option }.padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = template == option, onClick = null)
                        Column(Modifier.padding(start = 12.dp)) {
                            Text(templateName(option), style = MaterialTheme.typography.bodyLarge)
                            Text(templateDescription(option), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onCreate(name.trim(), template); onDismiss() }, enabled = name.isNotBlank()) { Text(stringResource(R.string.action_create)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
