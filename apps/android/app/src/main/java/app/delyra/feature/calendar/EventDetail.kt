package app.delyra.feature.calendar

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.core.net.toUri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.material.icons.outlined.ViewKanban
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.delyra.R
import app.delyra.core.model.CalendarInfo
import app.delyra.core.model.Occurrence
import app.delyra.core.ui.ColorDot
import app.delyra.core.ui.parseHexColor

/** Detalle de un elemento: en una hoja inferior (estrecho) o en un panel lateral (ancho). */
@Composable
fun EventDetail(
    item: CalendarItem,
    calendar: CalendarInfo?,
    onClose: () -> Unit,
    onEdit: (CalendarItem) -> Unit,
    onDelete: (Occurrence, String) -> Unit,
    onOpenBoard: (String) -> Unit,
) {
    val locale = appLocale()
    val context = LocalContext.current
    var askDelete by remember { mutableStateOf(false) }
    val occurrence = item.occurrence

    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp).navigationBarsPadding(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            ColorDot(parseHexColor(item.colorHex), 14.dp, Modifier.padding(top = 8.dp))
            Text(
                item.title + (occurrence?.age?.let { " · " + stringResource(R.string.calendar_turns, it) } ?: ""),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.weight(1f).padding(horizontal = 12.dp).semantics { heading() },
            )
            IconButton(onClick = onClose) { Icon(Icons.Outlined.Close, stringResource(R.string.action_close)) }
        }
        Text(whenText(item, locale), style = MaterialTheme.typography.bodyLarge)
        if (occurrence?.recurring == true && !item.occurrence.isBirthday) {
            InfoRow(Icons.Outlined.Repeat, stringResource(R.string.event_recurring))
        }
        when (item.kind) {
            ItemKind.Event -> {
                calendar?.let { InfoRow(null, it.name, parseHexColor(it.color)) }
                occurrence?.location?.let { place ->
                    InfoRow(Icons.Outlined.Place, place) {
                        open(context, Intent(Intent.ACTION_VIEW, ("geo:0,0?q=" + Uri.encode(place)).toUri()))
                    }
                }
                occurrence?.url?.let { url ->
                    InfoRow(Icons.Outlined.Link, url) { open(context, Intent(Intent.ACTION_VIEW, url.toUri())) }
                }
                occurrence?.notes?.takeIf { it.isNotBlank() }?.let {
                    SelectionContainer { Text(it, style = MaterialTheme.typography.bodyMedium) }
                }
                if (item.readOnly) {
                    Text(stringResource(R.string.event_read_only), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else if (occurrence != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilledTonalButton(onClick = { onEdit(item) }) {
                            Icon(Icons.Outlined.Edit, null, Modifier.size(18.dp))
                            Text(stringResource(R.string.action_edit), Modifier.padding(start = 8.dp))
                        }
                        OutlinedButton(onClick = { askDelete = true }) {
                            Icon(Icons.Outlined.Delete, null, Modifier.size(18.dp))
                            Text(stringResource(R.string.action_delete), Modifier.padding(start = 8.dp))
                        }
                    }
                }
            }
            ItemKind.Task -> {
                val task = item.task
                if (task != null) {
                    InfoRow(Icons.Outlined.ViewKanban, task.boardName)
                    Text(
                        stringResource(if (task.completed) R.string.task_completed else R.string.task_pending),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    FilledTonalButton(onClick = { onOpenBoard(task.boardId); onClose() }) { Text(stringResource(R.string.task_open_board)) }
                }
            }
            ItemKind.Holiday -> Text(
                stringResource(if (item.holiday?.regional == true) R.string.holiday_regional else R.string.holiday_national),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Box(Modifier.size(8.dp))
    }

    if (askDelete && occurrence != null) {
        if (occurrence.recurring) {
            ScopeDialog(
                title = stringResource(R.string.scope_delete_title),
                options = if (occurrence.isBirthday) listOf("this", "all") else listOf("this", "following", "all"),
                onPick = { onDelete(occurrence, it) },
                onDismiss = { askDelete = false },
            )
        } else {
            AlertDialog(
                onDismissRequest = { askDelete = false },
                title = { Text(stringResource(R.string.event_delete_title)) },
                text = { Text(stringResource(R.string.event_delete_body, occurrence.title)) },
                confirmButton = {
                    TextButton(onClick = { askDelete = false; onDelete(occurrence, "all") }) {
                        Text(stringResource(R.string.action_delete), color = MaterialTheme.colorScheme.error)
                    }
                },
                dismissButton = { TextButton(onClick = { askDelete = false }) { Text(stringResource(R.string.action_cancel)) } },
            )
        }
    }
}

@Composable
private fun InfoRow(icon: androidx.compose.ui.graphics.vector.ImageVector?, text: String, dot: androidx.compose.ui.graphics.Color? = null, onClick: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().then(if (onClick != null) Modifier.selectable(false, role = Role.Button, onClick = onClick) else Modifier),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (icon != null) Icon(icon, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        if (dot != null) ColorDot(dot, 12.dp, Modifier.padding(horizontal = 6.dp))
        Text(
            text,
            style = MaterialTheme.typography.bodyMedium,
            color = if (onClick != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
        )
    }
}

private fun open(context: android.content.Context, intent: Intent) {
    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        // Sin app para abrirlo: no se hace nada (el texto se puede copiar).
    }
}

@Composable
private fun whenText(item: CalendarItem, locale: java.util.Locale): String {
    val first = longDate(item.startDate, locale)
    if (item.allDay) {
        val last = item.endDate.minusDays(1)
        return if (last == item.startDate) "$first · ${stringResource(R.string.calendar_all_day)}" else "$first – ${longDate(last, locale)}"
    }
    val s = item.start ?: return first
    val e = item.end ?: return "$first · ${timeText(s, locale)}"
    return if (s.toLocalDate() == e.toLocalDate() || (e.toLocalTime() == java.time.LocalTime.MIDNIGHT && e.toLocalDate() == s.toLocalDate().plusDays(1))) {
        "$first · ${timeText(s, locale)}–${timeText(e, locale)}"
    } else {
        "$first ${timeText(s, locale)} – ${longDate(e.toLocalDate(), locale)} ${timeText(e, locale)}"
    }
}

/** «Solo este», «este y los siguientes» o «todos» al cambiar o borrar un evento que se repite. */
@Composable
fun ScopeDialog(title: String, options: List<String>, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    var choice by rememberSaveable { mutableStateOf(options.first()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                options.forEach { option ->
                    Row(
                        Modifier.fillMaxWidth().selectable(choice == option, role = Role.RadioButton) { choice = option }.padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = choice == option, onClick = null)
                        Text(
                            stringResource(
                                when (option) {
                                    "this" -> R.string.scope_this
                                    "following" -> R.string.scope_following
                                    else -> R.string.scope_all
                                },
                            ),
                            Modifier.padding(start = 12.dp),
                        )
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onDismiss(); onPick(choice) }) { Text(stringResource(R.string.action_continue)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
