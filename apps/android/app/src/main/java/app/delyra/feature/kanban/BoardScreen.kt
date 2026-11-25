package app.delyra.feature.kanban

import android.content.ClipData
import android.content.ClipDescription
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.draganddrop.dragAndDropSource
import androidx.compose.foundation.draganddrop.dragAndDropTarget
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draganddrop.DragAndDropEvent
import androidx.compose.ui.draganddrop.DragAndDropTarget
import androidx.compose.ui.draganddrop.DragAndDropTransferData
import androidx.compose.ui.draganddrop.mimeTypes
import androidx.compose.ui.draganddrop.toAndroidDragEvent
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleStartEffect
import app.delyra.R
import app.delyra.core.model.BoardColumn
import app.delyra.core.model.CardSummary
import app.delyra.core.ui.ErrorState
import app.delyra.core.ui.LoadingBox
import app.delyra.core.ui.appViewModel
import app.delyra.core.ui.message
import app.delyra.core.ui.rememberWindowLayout
import app.delyra.feature.calendar.appLocale
import kotlinx.coroutines.launch

/** Diálogos y hojas del tablero (un solo lugar para que no se abran dos a la vez). */
class BoardDialogs {
    var addCardTo by mutableStateOf<String?>(null)
    var editColumn by mutableStateOf<BoardColumn?>(null)
    var newColumn by mutableStateOf(false)
    var deleteColumn by mutableStateOf<BoardColumn?>(null)
    var moveCard by mutableStateOf<CardSummary?>(null)
    /** Mover a una columna delegada: tarjeta, columna e índice, a la espera de a quién se pasa. */
    var delegate by mutableStateOf<Triple<String, String, Int>?>(null)
    var labels by mutableStateOf(false)
    var archived by mutableStateOf(false)
    var members by mutableStateOf(false)
    var settings by mutableStateOf(false)
    var teams by mutableStateOf(false)
    var deleteBoard by mutableStateOf(false)
}

@Composable
fun BoardScreen(boardId: String, onBack: () -> Unit, onOpenCard: (String) -> Unit) {
    val vm = appViewModel(key = "board:$boardId") { BoardViewModel(it, boardId) }
    val layout = rememberWindowLayout()
    val dialogs = remember { BoardDialogs() }
    var openCard by rememberSaveable { mutableStateOf<String?>(null) }
    var searching by rememberSaveable { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val open: (String) -> Unit = { id -> if (layout.isExpanded) openCard = id else onOpenCard(id) }

    LifecycleStartEffect(boardId) {
        vm.startLive()
        onStopOrDispose { vm.stopLive() }
    }
    LaunchedEffect(vm.deleted) { if (vm.deleted) onBack() }
    val revokedText = stringResource(R.string.board_revoked)
    LaunchedEffect(vm.revoked) {
        if (vm.revoked) {
            snackbar.showSnackbar(revokedText)
            onBack()
        }
    }
    val messageText = vm.message?.message()
    LaunchedEffect(vm.message) {
        if (messageText != null) {
            snackbar.showSnackbar(messageText)
            vm.message = null
        }
    }
    val wipText = vm.wipExceeded?.let { stringResource(R.string.board_wip_exceeded, it) }
    LaunchedEffect(vm.wipExceeded) {
        if (wipText != null) {
            snackbar.showSnackbar(wipText)
            vm.wipExceeded = null
        }
    }

    Scaffold(
        topBar = { BoardTopBar(vm, dialogs, onBack, searching = searching, onSearch = { searching = !searching; if (!searching) vm.query = "" }) },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        val detail = vm.detail
        when {
            detail == null && vm.loadError != null -> ErrorState(vm.loadError!!, onRetry = vm::load, modifier = Modifier.padding(padding))
            detail == null -> LoadingBox(Modifier.padding(padding))
            else -> Column(Modifier.fillMaxSize().padding(padding)) {
                if (searching) {
                    OutlinedTextField(
                        value = vm.query,
                        onValueChange = { vm.query = it.take(100) },
                        placeholder = { Text(stringResource(R.string.board_search)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    )
                }
                Row(Modifier.fillMaxSize()) {
                    Box(Modifier.weight(1f).fillMaxHeight()) {
                        if (vm.columns.isEmpty()) {
                            EmptyBoard(vm.canWrite) { dialogs.newColumn = true }
                        } else if (layout.isCompact) {
                            CompactBoard(vm, dialogs, open)
                        } else {
                            WideBoard(vm, dialogs, open, laneWidth = if (layout.isExpanded) 320.dp else 296.dp)
                        }
                    }
                    val cardId = openCard
                    if (layout.isExpanded && cardId != null) {
                        VerticalDivider()
                        Surface(Modifier.width(420.dp).fillMaxHeight(), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                            CardPane(cardId, onClose = { openCard = null })
                        }
                    }
                }
            }
        }
    }
    BoardDialogsHost(vm, dialogs, onMessage = { text -> scope.launch { snackbar.showSnackbar(text) } })
}

@Composable
private fun BoardTopBar(vm: BoardViewModel, dialogs: BoardDialogs, onBack: () -> Unit, searching: Boolean, onSearch: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val board = vm.detail?.board
    val exportJson = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) vm.export("json", uri, context.contentResolver)
    }
    val exportCsv = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri ->
        if (uri != null) vm.export("csv", uri, context.contentResolver)
    }
    TopAppBar(
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.action_back)) } },
        title = {
            Column {
                Text(board?.name.orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis)
                // Tablero compartido contigo: tu papel y de quién es; y quién más lo tiene abierto ahora.
                val role = if (board != null && !board.isOwner) {
                    roleLabel(board.role) + (board.ownerName?.let { " · " + stringResource(R.string.board_owned_by, it) } ?: "")
                } else {
                    null
                }
                val here = vm.presence.takeIf { it.isNotEmpty() }?.let { people ->
                    stringResource(R.string.board_presence, people.joinToString { it.name })
                }
                if (role != null || here != null) {
                    Text(
                        listOfNotNull(role, here).joinToString(" · "),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (here != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        },
        actions = {
            IconButton(onClick = onSearch) {
                Icon(if (searching) Icons.Outlined.Close else Icons.Outlined.Search, stringResource(R.string.action_search))
            }
            // El dueño comparte; el resto ve quién tiene acceso. Con el número de personas, si hay más.
            val peopleLabel = stringResource(if (board?.isOwner != false) R.string.board_share else R.string.board_people)
            IconButton(onClick = { dialogs.members = true; vm.loadMembers() }) {
                BadgedBox(badge = { if ((board?.members ?: 0) > 0) Badge(containerColor = MaterialTheme.colorScheme.primary) { Text(((board?.members ?: 0) + 1).toString()) } }) {
                    Icon(if (board?.isOwner != false) Icons.Outlined.PersonAdd else Icons.Outlined.Group, peopleLabel)
                }
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, stringResource(R.string.action_more)) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    if (vm.canWrite) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.board_new_column)) }, onClick = { menu = false; dialogs.newColumn = true })
                        DropdownMenuItem(text = { Text(stringResource(R.string.board_labels)) }, onClick = { menu = false; dialogs.labels = true })
                    }
                    DropdownMenuItem(text = { Text(stringResource(R.string.board_archived)) }, onClick = { menu = false; dialogs.archived = true; vm.loadArchived() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.board_export_json)) }, onClick = { menu = false; exportJson.launch("${board?.name ?: "tablero"}.json") })
                    DropdownMenuItem(text = { Text(stringResource(R.string.board_export_csv)) }, onClick = { menu = false; exportCsv.launch("${board?.name ?: "tablero"}.csv") })
                    if (vm.canWrite) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.teams_title)) }, onClick = { menu = false; dialogs.teams = true })
                        DropdownMenuItem(text = { Text(stringResource(R.string.board_settings)) }, onClick = { menu = false; dialogs.settings = true })
                    }
                }
            }
        },
    )
}

@Composable
private fun EmptyBoard(canWrite: Boolean, onAddColumn: () -> Unit) {
    app.delyra.core.ui.EmptyState(stringResource(R.string.board_empty_title), stringResource(R.string.board_empty_body), Modifier.fillMaxSize()) {
        if (canWrite) OutlinedButton(onClick = onAddColumn) { Text(stringResource(R.string.board_new_column)) }
    }
}

// ── Estrecho: una columna por página ─────────────────────────────────────────

@Composable
private fun CompactBoard(vm: BoardViewModel, dialogs: BoardDialogs, onOpen: (String) -> Unit) {
    val columns = vm.columns
    val pager = rememberPagerState { columns.size }
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            PrimaryScrollableTabRow(selectedTabIndex = pager.currentPage.coerceAtMost((columns.size - 1).coerceAtLeast(0)), edgePadding = 8.dp) {
                columns.forEachIndexed { index, column ->
                    val count = vm.cardsByColumn[column.id].orEmpty().size
                    val over = column.wipLimit?.let { count > it } == true
                    Tab(
                        selected = pager.currentPage == index,
                        onClick = { scope.launch { pager.animateScrollToPage(index) } },
                        text = {
                            Text(
                                column.name + " · " + (column.wipLimit?.let { "$count/$it" } ?: count.toString()),
                                color = if (over) MaterialTheme.colorScheme.error else androidx.compose.ui.graphics.Color.Unspecified,
                                maxLines = 1,
                            )
                        },
                    )
                }
            }
            HorizontalPager(pager, modifier = Modifier.weight(1f), key = { columns.getOrNull(it)?.id ?: it }) { page ->
                columns.getOrNull(page)?.let { column ->
                    ColumnLane(vm, column, dialogs, onOpen, compact = true, modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp))
                }
            }
        }
        if (vm.canWrite && columns.isNotEmpty()) {
            FloatingActionButton(
                onClick = { dialogs.addCardTo = columns.getOrNull(pager.currentPage)?.id },
                modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
            ) { Icon(Icons.Default.Add, stringResource(R.string.board_add_card)) }
        }
    }
}

// ── Ancho: columnas lado a lado, con arrastrar y soltar ──────────────────────

@Composable
private fun WideBoard(vm: BoardViewModel, dialogs: BoardDialogs, onOpen: (String) -> Unit, laneWidth: androidx.compose.ui.unit.Dp) {
    LazyRow(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(vm.columns, key = { it.id }) { column ->
            ColumnLane(
                vm, column, dialogs, onOpen, compact = false,
                modifier = Modifier.width(laneWidth).fillParentMaxHeight()
                    .clip(MaterialTheme.shapes.large)
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .padding(8.dp),
            )
        }
        if (vm.canWrite) {
            item {
                OutlinedButton(onClick = { dialogs.newColumn = true }, modifier = Modifier.width(laneWidth)) {
                    Icon(Icons.Default.Add, null)
                    Text(stringResource(R.string.board_new_column), Modifier.padding(start = 8.dp))
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ColumnLane(
    vm: BoardViewModel,
    column: BoardColumn,
    dialogs: BoardDialogs,
    onOpen: (String) -> Unit,
    compact: Boolean,
    modifier: Modifier,
) {
    val locale = appLocale()
    val cards = vm.visibleCards(column.id)
    val count = vm.cardsByColumn[column.id].orEmpty().size
    val bounds = remember(column.id) { mutableStateMapOf<String, Rect>() }
    var hovering by remember { mutableStateOf(false) }
    val zone = vm.let { app.delyra.core.ui.LocalAppGraph.current.session.active?.zone ?: java.time.ZoneId.systemDefault() }
    val moveTo = stringResource(R.string.board_move_to)
    val archiveLabel = stringResource(R.string.card_archive)
    val dropTarget = remember(column.id, vm) {
        object : DragAndDropTarget {
            override fun onEntered(event: DragAndDropEvent) { hovering = true }
            override fun onExited(event: DragAndDropEvent) { hovering = false }
            override fun onEnded(event: DragAndDropEvent) { hovering = false }
            override fun onDrop(event: DragAndDropEvent): Boolean {
                hovering = false
                val drag = event.toAndroidDragEvent()
                val id = drag.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString() ?: return false
                val y = drag.y
                val siblings = vm.cardsByColumn[column.id].orEmpty().filter { it.id != id }
                val index = siblings.count { card -> bounds[card.id]?.let { it.center.y < y } == true }
                val current = vm.cardsByColumn.values.flatten().firstOrNull { it.id == id } ?: return false
                if (column.delegated && current.columnId != column.id) dialogs.delegate = Triple(id, column.id, index) else vm.moveCard(id, column.id, index)
                return true
            }
        }
    }

    Column(
        modifier.then(
            if (!compact && vm.canWrite) {
                Modifier.dragAndDropTarget(
                    shouldStartDragAndDrop = { it.mimeTypes().contains(ClipDescription.MIMETYPE_TEXT_PLAIN) },
                    target = dropTarget,
                )
            } else {
                Modifier
            },
        ).then(if (hovering) Modifier.background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f), MaterialTheme.shapes.large) else Modifier),
    ) {
        ColumnHeader(vm, column, count, dialogs)
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(bottom = if (compact) 96.dp else 8.dp, top = 4.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(cards, key = { it.id }) { card ->
                val actions = if (vm.canWrite) {
                    vm.columns.filter { it.id != card.columnId }.map { target ->
                        CustomAccessibilityAction("$moveTo ${target.name}") {
                            if (target.delegated) dialogs.delegate = Triple(card.id, target.id, vm.cardsByColumn[target.id].orEmpty().size)
                            else vm.moveCard(card.id, target.id, vm.cardsByColumn[target.id].orEmpty().size)
                            true
                        }
                    } + CustomAccessibilityAction(archiveLabel) { vm.archiveCard(card.id); true }
                } else {
                    emptyList()
                }
                CardItem(
                    card = card,
                    labels = vm.labels,
                    zone = zone,
                    locale = locale,
                    onClick = { onOpen(card.id) },
                    onLongClick = if (vm.canWrite && compact) ({ dialogs.moveCard = card }) else null,
                    accessibilityActions = actions,
                    modifier = Modifier
                        .animateItem()
                        .onGloballyPositioned { bounds[card.id] = it.boundsInRoot() }
                        .then(
                            if (!compact && vm.canWrite) {
                                Modifier.dragAndDropSource { _ ->
                                    DragAndDropTransferData(ClipData.newPlainText("delyra-card", card.id))
                                }
                            } else {
                                Modifier
                            },
                        ),
                )
            }
            if (!compact && vm.canWrite) {
                item {
                    TextButton(onClick = { dialogs.addCardTo = column.id }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Default.Add, null)
                        Text(stringResource(R.string.board_add_card), Modifier.padding(start = 8.dp))
                    }
                }
            }
            if (cards.isEmpty() && compact) {
                item { Text(stringResource(R.string.board_column_empty), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp)) }
            }
        }
    }
}

@Composable
private fun ColumnHeader(vm: BoardViewModel, column: BoardColumn, count: Int, dialogs: BoardDialogs) {
    var menu by remember { mutableStateOf(false) }
    val index = vm.columns.indexOf(column)
    val over = column.wipLimit?.let { count > it } == true
    Row(Modifier.fillMaxWidth().padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        if (column.isDone) Icon(Icons.Outlined.CheckCircle, stringResource(R.string.column_done), Modifier.size(18.dp).padding(end = 4.dp), tint = MaterialTheme.colorScheme.primary)
        if (column.delegated) Icon(AssigneeIcon, stringResource(R.string.column_delegated), Modifier.size(18.dp).padding(end = 4.dp), tint = MaterialTheme.colorScheme.tertiary)
        Text(column.name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Box(
            Modifier.clip(CircleShape).background(if (over) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceContainerHigh).padding(horizontal = 8.dp, vertical = 2.dp),
        ) {
            Text(
                column.wipLimit?.let { "$count/$it" } ?: count.toString(),
                style = MaterialTheme.typography.labelSmall,
                color = if (over) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (vm.canWrite) {
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, stringResource(R.string.action_more)) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.action_edit)) }, onClick = { menu = false; dialogs.editColumn = column })
                    if (index > 0) DropdownMenuItem(text = { Text(stringResource(R.string.column_move_left)) }, onClick = { menu = false; vm.moveColumn(column, index - 1) })
                    if (index < vm.columns.size - 1) DropdownMenuItem(text = { Text(stringResource(R.string.column_move_right)) }, onClick = { menu = false; vm.moveColumn(column, index + 1) })
                    DropdownMenuItem(text = { Text(stringResource(R.string.action_delete)) }, onClick = { menu = false; dialogs.deleteColumn = column })
                }
            }
        }
    }
}
