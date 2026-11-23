package app.delyra.feature.calendar

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.delyra.R
import app.delyra.core.model.CalendarInfo
import app.delyra.core.ui.ColorPicker
import app.delyra.core.ui.ConfirmDialog
import app.delyra.core.ui.PALETTE
import app.delyra.core.ui.copy
import app.delyra.core.ui.parseHexColor
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.YearMonth

/** Minicalendario, calendarios (mostrar, color, nombre, feed, borrar) y capas. */
@Composable
fun CalendarsPanel(
    vm: CalendarViewModel,
    selectedDate: LocalDate,
    onPickDate: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
) {
    var month by remember(selectedDate) { mutableStateOf(YearMonth.from(selectedDate)) }
    var editing by remember { mutableStateOf<CalendarInfo?>(null) }
    var creating by rememberSaveable { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<CalendarInfo?>(null) }
    var feedFor by remember { mutableStateOf<CalendarInfo?>(null) }

    Column(modifier.verticalScroll(rememberScrollState()).padding(16.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        MiniMonth(
            month = month,
            today = vm.today,
            weekStart = vm.weekStart,
            busyDays = emptySet(),
            selected = selectedDate,
            onDayClick = onPickDate,
            onPrevious = { month = month.minusMonths(1) },
            onNext = { month = month.plusMonths(1) },
        )
        HorizontalDivider(Modifier.padding(vertical = 8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.calendar_calendars), style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f).semantics { heading() })
            IconButton(onClick = { creating = true }) { Icon(Icons.Outlined.Add, stringResource(R.string.calendar_new)) }
        }
        vm.calendars.forEach { calendar ->
            CalendarRow(
                calendar = calendar,
                onToggle = { vm.toggleCalendar(calendar) },
                onEdit = { editing = calendar },
                onFeed = { feedFor = calendar; vm.loadFeed(calendar) },
                onDelete = { deleting = calendar },
            )
        }
        HorizontalDivider(Modifier.padding(vertical = 8.dp))
        Text(stringResource(R.string.calendar_layers), style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
        LayerRow(stringResource(R.string.calendar_layer_holidays), vm.showHolidays) { vm.toggleLayer(holidays = it) }
        LayerRow(stringResource(R.string.calendar_layer_tasks), vm.showTasks) { vm.toggleLayer(tasks = it) }
    }

    if (creating) {
        CalendarDialog(null, onDismiss = { creating = false }) { name, color -> vm.createCalendar(name, color) }
    }
    editing?.let { calendar ->
        CalendarDialog(calendar, onDismiss = { editing = null }) { name, color -> vm.updateCalendar(calendar, name, color) }
    }
    deleting?.let { calendar ->
        ConfirmDialog(
            title = stringResource(R.string.calendar_delete_title),
            text = stringResource(R.string.calendar_delete_body, calendar.name),
            confirmLabel = stringResource(R.string.action_delete),
            destructive = true,
            onConfirm = { vm.deleteCalendar(calendar) },
            onDismiss = { deleting = null },
        )
    }
    feedFor?.let { calendar -> FeedDialog(vm, calendar, onDismiss = { feedFor = null; vm.clearFeed() }) }
}

@Composable
private fun CalendarRow(calendar: CalendarInfo, onToggle: () -> Unit, onEdit: () -> Unit, onFeed: () -> Unit, onDelete: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val color = parseHexColor(calendar.color)
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Checkbox, onClick = onToggle),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(
            checked = calendar.visible,
            onCheckedChange = { onToggle() },
            colors = CheckboxDefaults.colors(checkedColor = color, uncheckedColor = color),
        )
        Text(calendar.name, Modifier.weight(1f), maxLines = 1)
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, stringResource(R.string.action_more)) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text(stringResource(R.string.action_edit)) }, onClick = { menu = false; onEdit() })
                DropdownMenuItem(text = { Text(stringResource(R.string.calendar_feed)) }, onClick = { menu = false; onFeed() })
                DropdownMenuItem(text = { Text(stringResource(R.string.action_delete)) }, onClick = { menu = false; onDelete() })
            }
        }
    }
}

@Composable
private fun LayerRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(role = Role.Switch) { onChange(!checked) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun CalendarDialog(calendar: CalendarInfo?, onDismiss: () -> Unit, onSave: (String, String) -> Unit) {
    var name by rememberSaveable { mutableStateOf(calendar?.name ?: "") }
    var color by rememberSaveable { mutableStateOf(calendar?.color ?: PALETTE.first().second) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(if (calendar == null) R.string.calendar_new else R.string.calendar_edit)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(60) },
                    label = { Text(stringResource(R.string.field_name)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                ColorPicker(selected = color, onSelect = { color = it })
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(name.trim(), color); onDismiss() }, enabled = name.isNotBlank()) { Text(stringResource(R.string.action_save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

/** Feed ICS privado (F7-02): un enlace secreto para suscribirse desde otras apps de calendario. */
@Composable
private fun FeedDialog(vm: CalendarViewModel, calendar: CalendarInfo, onDismiss: () -> Unit) {
    val feed = vm.feed
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(feed?.url) { copied = false }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.calendar_feed_title, calendar.name)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.calendar_feed_body), style = MaterialTheme.typography.bodyMedium)
                if (feed != null) {
                    SelectionContainer { Text(feed.url, style = MaterialTheme.typography.bodySmall) }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { scope.launch { clipboard.copy(feed.url, sensitive = true); copied = true } }) {
                            Text(stringResource(if (copied) R.string.copied else R.string.action_copy))
                        }
                        OutlinedButton(onClick = {
                            context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, feed.url), null))
                        }) { Text(stringResource(R.string.action_share)) }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { vm.rotateFeed(calendar) }, enabled = !vm.feedBusy) { Text(stringResource(R.string.calendar_feed_rotate)) }
                        TextButton(onClick = { vm.revokeFeed(calendar) }, enabled = !vm.feedBusy) {
                            Text(stringResource(R.string.calendar_feed_revoke), color = MaterialTheme.colorScheme.error)
                        }
                    }
                } else {
                    OutlinedButton(onClick = { vm.rotateFeed(calendar) }, enabled = !vm.feedBusy) { Text(stringResource(R.string.calendar_feed_create)) }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) } },
    )
}
