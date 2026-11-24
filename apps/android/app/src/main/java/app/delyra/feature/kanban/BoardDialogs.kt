package app.delyra.feature.kanban

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.delyra.R
import app.delyra.core.model.BoardColumn
import app.delyra.core.model.CardLabel
import app.delyra.core.ui.ColorDot
import app.delyra.core.ui.ColorPicker
import app.delyra.core.ui.ConfirmDialog
import app.delyra.core.ui.EmailField
import app.delyra.core.ui.LABEL_COLORS
import app.delyra.core.ui.TextInputDialog
import app.delyra.core.ui.parseHexColor

@Composable
fun BoardDialogsHost(vm: BoardViewModel, dialogs: BoardDialogs, onMessage: (String) -> Unit) {
    dialogs.addCardTo?.let { columnId ->
        AddCardDialog(onDismiss = { dialogs.addCardTo = null }) { title, kind -> vm.addCard(columnId, title, kind) }
    }
    if (dialogs.newColumn) ColumnDialog(null, onDismiss = { dialogs.newColumn = false }) { n, w, d, g -> vm.addColumn(n, w, d, g) }
    dialogs.editColumn?.let { column ->
        ColumnDialog(column, onDismiss = { dialogs.editColumn = null }) { n, w, d, g -> vm.updateColumn(column, n, w, d, g) }
    }
    dialogs.deleteColumn?.let { column ->
        ConfirmDialog(
            title = stringResource(R.string.column_delete_title),
            text = vm.cardsByColumn[column.id].orEmpty().size.let { n -> androidx.compose.ui.res.pluralStringResource(R.plurals.column_delete_body, n, column.name, n) },
            confirmLabel = stringResource(R.string.action_delete),
            destructive = true,
            onConfirm = { vm.deleteColumn(column) },
            onDismiss = { dialogs.deleteColumn = null },
        )
    }
    dialogs.moveCard?.let { card -> MoveSheet(vm, card, dialogs) }
    dialogs.delegate?.let { (cardId, columnId, index) ->
        TextInputDialog(
            title = stringResource(R.string.card_delegate_title),
            label = stringResource(R.string.card_assignee_hint),
            confirmLabel = stringResource(R.string.card_move),
            maxLength = 80,
            onConfirm = { vm.moveCard(cardId, columnId, index, it) },
            onDismiss = { dialogs.delegate = null },
        )
    }
    if (dialogs.labels) LabelsDialog(vm, onDismiss = { dialogs.labels = false })
    if (dialogs.archived) ArchivedSheet(vm, onDismiss = { dialogs.archived = false })
    if (dialogs.members) ShareSheet(vm, onDismiss = { dialogs.members = false })
    if (dialogs.settings) SettingsDialog(vm, dialogs, onDismiss = { dialogs.settings = false })
    if (dialogs.deleteBoard) {
        ConfirmDialog(
            title = stringResource(R.string.board_delete_title),
            text = stringResource(R.string.board_delete_body, vm.detail?.board?.name.orEmpty()),
            confirmLabel = stringResource(R.string.action_delete),
            destructive = true,
            onConfirm = vm::deleteBoard,
            onDismiss = { dialogs.deleteBoard = false },
        )
    }
}

@Composable
private fun AddCardDialog(onDismiss: () -> Unit, onAdd: (String, String) -> Unit) {
    var title by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf("task") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.board_add_card)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(title, { title = it.take(300) }, label = { Text(stringResource(R.string.event_title)) }, modifier = Modifier.fillMaxWidth())
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    CARD_KINDS.forEach { option ->
                        FilterChip(
                            selected = kind == option,
                            onClick = { kind = option },
                            label = { Text(kindLabel(option)) },
                            leadingIcon = { Icon(kindIcon(option), null) },
                        )
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onAdd(title.trim(), kind); onDismiss() }, enabled = title.isNotBlank()) { Text(stringResource(R.string.action_add)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

@Composable
private fun ColumnDialog(column: BoardColumn?, onDismiss: () -> Unit, onSave: (String, Int?, Boolean, Boolean) -> Unit) {
    var name by rememberSaveable { mutableStateOf(column?.name ?: "") }
    var wip by rememberSaveable { mutableStateOf(column?.wipLimit?.toString() ?: "") }
    var done by rememberSaveable { mutableStateOf(column?.isDone ?: false) }
    var delegated by rememberSaveable { mutableStateOf(column?.delegated ?: false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(if (column == null) R.string.board_new_column else R.string.column_edit)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(name, { name = it.take(60) }, label = { Text(stringResource(R.string.field_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    wip,
                    { wip = it.filter(Char::isDigit).take(3) },
                    label = { Text(stringResource(R.string.column_wip)) },
                    supportingText = { Text(stringResource(R.string.column_wip_hint)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                SwitchRow(stringResource(R.string.column_done_switch), done) { done = it }
                SwitchRow(stringResource(R.string.column_delegated_switch), delegated) { delegated = it }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                onSave(name.trim(), wip.toIntOrNull()?.coerceIn(1, 999), done, delegated)
                onDismiss()
            }, enabled = name.isNotBlank()) { Text(stringResource(R.string.action_save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(role = Role.Switch) { onChange(!checked) }, verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

/** «Mover a…»: la forma de mover tarjetas en el teléfono (y sin arrastrar). */
@Composable
private fun MoveSheet(vm: BoardViewModel, card: app.delyra.core.model.CardSummary, dialogs: BoardDialogs) {
    var target by rememberSaveable { mutableStateOf(card.columnId) }
    var confirmDelete by remember { mutableStateOf(false) }
    val dismiss = { dialogs.moveCard = null }
    ModalBottomSheet(onDismissRequest = dismiss) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(card.title, style = MaterialTheme.typography.titleMedium, maxLines = 2)
            Text(stringResource(R.string.board_move_to), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            vm.columns.forEach { column ->
                Row(
                    Modifier.fillMaxWidth().selectable(target == column.id, role = Role.RadioButton) { target = column.id }.padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = target == column.id, onClick = null)
                    Text(column.name, Modifier.padding(start = 12.dp))
                }
            }
            val size = vm.cardsByColumn[target].orEmpty().count { it.id != card.id }
            val column = vm.columns.firstOrNull { it.id == target }
            val move = { index: Int ->
                dismiss()
                if (column?.delegated == true && target != card.columnId) dialogs.delegate = Triple(card.id, target, index) else vm.moveCard(card.id, target, index)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { move(0) }) { Text(stringResource(R.string.board_move_top)) }
                OutlinedButton(onClick = { move(size) }) { Text(stringResource(R.string.board_move_bottom)) }
            }
            if (target == card.columnId) {
                val list = vm.cardsByColumn[target].orEmpty()
                val at = list.indexOfFirst { it.id == card.id }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (at > 0) TextButton(onClick = { move(at - 1) }) { Text(stringResource(R.string.board_move_up)) }
                    if (at in 0 until list.size - 1) TextButton(onClick = { move(at + 1) }) { Text(stringResource(R.string.board_move_down)) }
                }
            }
            HorizontalDivider()
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { vm.archiveCard(card.id); dismiss() }) { Text(stringResource(R.string.card_archive)) }
                OutlinedButton(onClick = { confirmDelete = true }) { Text(stringResource(R.string.action_delete), color = MaterialTheme.colorScheme.error) }
            }
        }
    }
    if (confirmDelete) {
        ConfirmDialog(
            title = stringResource(R.string.card_delete_title),
            text = stringResource(R.string.card_delete_body, card.title),
            confirmLabel = stringResource(R.string.action_delete),
            destructive = true,
            onConfirm = { vm.deleteCard(card.id); dismiss() },
            onDismiss = { confirmDelete = false },
        )
    }
}

@Composable
private fun LabelsDialog(vm: BoardViewModel, onDismiss: () -> Unit) {
    var editing by remember { mutableStateOf<CardLabel?>(null) }
    var creating by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.board_labels)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (vm.labels.isEmpty()) Text(stringResource(R.string.labels_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
                vm.labels.forEach { label ->
                    Row(Modifier.fillMaxWidth().clickable { editing = label }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        ColorDot(parseHexColor(label.color), 14.dp)
                        Text(label.name, Modifier.weight(1f).padding(horizontal = 12.dp))
                        IconButton(onClick = { vm.deleteLabel(label) }) { Icon(Icons.Outlined.Delete, stringResource(R.string.action_delete)) }
                    }
                }
                TextButton(onClick = { creating = true }) { Text(stringResource(R.string.labels_new)) }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) } },
    )
    if (creating) LabelDialog(null, onDismiss = { creating = false }) { n, c -> vm.addLabel(n, c) }
    editing?.let { label -> LabelDialog(label, onDismiss = { editing = null }) { n, c -> vm.updateLabel(label, n, c) } }
}

@Composable
private fun LabelDialog(label: CardLabel?, onDismiss: () -> Unit, onSave: (String, String) -> Unit) {
    var name by rememberSaveable { mutableStateOf(label?.name ?: "") }
    var color by rememberSaveable { mutableStateOf(label?.color ?: LABEL_COLORS.first()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(if (label == null) R.string.labels_new else R.string.labels_edit)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(name, { name = it.take(40) }, label = { Text(stringResource(R.string.field_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                ColorPicker(color, onSelect = { color = it })
            }
        },
        confirmButton = { TextButton(onClick = { onSave(name.trim(), color); onDismiss() }, enabled = name.isNotBlank()) { Text(stringResource(R.string.action_save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

@Composable
private fun ArchivedSheet(vm: BoardViewModel, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.board_archived), style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
            val archived = vm.archived
            when {
                archived == null -> Text(stringResource(R.string.loading))
                archived.isEmpty() -> Text(stringResource(R.string.archived_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
                else -> archived.forEach { card ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(card.title, Modifier.weight(1f), maxLines = 2)
                        if (vm.canWrite) {
                            TextButton(onClick = { vm.restoreCard(card.id) }) { Text(stringResource(R.string.card_restore)) }
                            IconButton(onClick = { vm.deleteArchived(card.id) }) { Icon(Icons.Outlined.Delete, stringResource(R.string.action_delete)) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsDialog(vm: BoardViewModel, dialogs: BoardDialogs, onDismiss: () -> Unit) {
    val board = vm.detail?.board ?: return
    var name by rememberSaveable { mutableStateOf(board.name) }
    var days by rememberSaveable { mutableStateOf(board.autoarchiveDays.toString()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.board_settings)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(name, { name = it.take(80) }, label = { Text(stringResource(R.string.field_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    days,
                    { days = it.filter(Char::isDigit).take(3) },
                    label = { Text(stringResource(R.string.board_autoarchive)) },
                    supportingText = { Text(stringResource(R.string.board_autoarchive_hint)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                // Borrar el tablero es solo de su dueño (la API responde 404 al resto).
                if (vm.isOwner) {
                    OutlinedButton(onClick = { onDismiss(); dialogs.deleteBoard = true }) {
                        Text(stringResource(R.string.board_delete_title), color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { vm.updateBoard(name.trim(), (days.toIntOrNull() ?: 0).coerceIn(0, 365)); onDismiss() }, enabled = name.isNotBlank()) {
                Text(stringResource(R.string.action_save))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
