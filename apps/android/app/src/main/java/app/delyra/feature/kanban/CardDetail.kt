package app.delyra.feature.kanban

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.automirrored.outlined.Label
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleStartEffect
import app.delyra.R
import app.delyra.core.ui.OfflineBanner
import app.delyra.core.model.CardDetail
import app.delyra.core.model.DueInfo
import app.delyra.core.ui.ColorDot
import app.delyra.core.ui.ColorPicker
import app.delyra.core.ui.ConfirmDialog
import app.delyra.core.ui.ErrorState
import app.delyra.core.ui.LoadingBox
import app.delyra.core.ui.TextInputDialog
import app.delyra.core.ui.appViewModel
import app.delyra.core.ui.message
import app.delyra.core.ui.parseHexColor
import app.delyra.feature.calendar.ALL_DAY_REMINDERS
import app.delyra.feature.calendar.DatePick
import app.delyra.feature.calendar.TIMED_REMINDERS
import app.delyra.feature.calendar.appLocale
import app.delyra.feature.calendar.parseInstant
import app.delyra.feature.calendar.reminderLabel
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.ChronoUnit

/** Pantalla completa de una tarjeta (estrecho y mediano). En expandido va en un panel del tablero. */
@Composable
fun CardScreen(cardId: String, onBack: () -> Unit) {
    val vm = appViewModel(key = "card:$cardId") { CardViewModel(it, cardId) }
    val context = LocalContext.current
    val goneText = stringResource(R.string.card_gone)
    LaunchedEffect(vm.deleted, vm.gone) {
        // Se cierra sola si otra persona la borró o te quitó el acceso; se avisa porque no lo hiciste tú.
        if (vm.gone) android.widget.Toast.makeText(context, goneText, android.widget.Toast.LENGTH_LONG).show()
        if (vm.deleted || vm.gone) onBack()
    }
    // Con el tablero detrás (y su canal cerrado), la tarjeta escucha los cambios de las demás personas.
    LifecycleStartEffect(cardId) {
        vm.startLive()
        onStopOrDispose { vm.stopLive() }
    }
    val snackbar = remember { SnackbarHostState() }
    CardMessages(vm, snackbar)
    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.action_back)) } },
                title = { Text(vm.board?.board?.name.orEmpty(), maxLines = 1) },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = { OfflineBanner() },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            CardDetailBody(vm, Modifier.widthIn(max = 760.dp))
        }
    }
}

@Composable
fun CardMessages(vm: CardViewModel, snackbar: SnackbarHostState) {
    val text = vm.message?.message()
    val tooLarge = stringResource(R.string.card_attachment_too_large)
    LaunchedEffect(vm.message) {
        if (text != null) {
            snackbar.showSnackbar(text)
            vm.message = null
        }
    }
    LaunchedEffect(vm.tooLarge) {
        if (vm.tooLarge) {
            snackbar.showSnackbar(tooLarge)
            vm.tooLarge = false
        }
    }
}

/** Panel lateral del tablero en pantallas anchas. */
@Composable
fun CardPane(cardId: String, onClose: () -> Unit, modifier: Modifier = Modifier) {
    val vm = appViewModel(key = "card:$cardId") { CardViewModel(it, cardId) }
    val context = LocalContext.current
    val goneText = stringResource(R.string.card_gone)
    LaunchedEffect(vm.deleted, vm.gone) {
        if (vm.gone) android.widget.Toast.makeText(context, goneText, android.widget.Toast.LENGTH_LONG).show()
        if (vm.deleted || vm.gone) onClose()
    }
    val snackbar = remember { SnackbarHostState() }
    CardMessages(vm, snackbar)
    Box(modifier) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.card_title), style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                IconButton(onClick = onClose) { Icon(Icons.Outlined.Close, stringResource(R.string.action_close)) }
            }
            CardDetailBody(vm, Modifier.fillMaxWidth())
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun CardDetailBody(vm: CardViewModel, modifier: Modifier) {
    val card = vm.card
    when {
        card == null && vm.loadError != null -> ErrorState(vm.loadError!!, onRetry = vm::load)
        card == null -> LoadingBox()
        // `imePadding` antes del desplazamiento: así la zona visible se acorta con el teclado y el
        // campo con el foco (p. ej. «Nuevo elemento» de la checklist) sube por encima de él.
        else -> Column(
            modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (vm.busy || vm.uploading) LinearProgressIndicator(Modifier.fillMaxWidth()) else Spacer(Modifier.height(4.dp))
            CardHeader(vm, card)
            CardProperties(vm, card)
            HorizontalDivider()
            DescriptionSection(vm, card)
            HorizontalDivider()
            ChecklistSection(vm, card)
            HorizontalDivider()
            AttachmentsSection(vm, card)
            HorizontalDivider()
            CommentsSection(vm, card)
            HorizontalDivider()
            ActivitySection(card)
            if (vm.canWrite) CardFooter(vm, card)
        }
    }
}

@Composable
private fun CardHeader(vm: CardViewModel, card: CardDetail) {
    var editing by rememberSaveable { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.Top) {
        card.color?.let { ColorDot(parseHexColor(it), 14.dp, Modifier.padding(top = 8.dp, end = 10.dp)) }
        Text(
            card.title,
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.weight(1f).semantics { heading() }.then(if (vm.canWrite) Modifier.clickable { editing = true } else Modifier),
        )
        if (vm.canWrite) IconButton(onClick = { editing = true }) { Icon(Icons.Outlined.Edit, stringResource(R.string.action_edit)) }
    }
    if (card.archivedAt != null) Text(stringResource(R.string.card_archived), color = MaterialTheme.colorScheme.tertiary)
    if (editing) {
        TextInputDialog(
            title = stringResource(R.string.card_rename),
            label = stringResource(R.string.event_title),
            initial = card.title,
            singleLine = false,
            onConfirm = vm::setTitle,
            onDismiss = { editing = false },
        )
    }
}

@Composable
private fun CardProperties(vm: CardViewModel, card: CardDetail) {
    val locale = appLocale()
    val board = vm.board
    val columns = board?.columns?.sortedBy { it.position }.orEmpty()
    val column = columns.firstOrNull { it.id == card.columnId }
    val labels = board?.labels.orEmpty()
    var pickColor by remember { mutableStateOf(false) }
    var pickLabels by remember { mutableStateOf(false) }
    var editDue by remember { mutableStateOf(false) }
    var editAssignee by remember { mutableStateOf(false) }
    var delegateTo by remember { mutableStateOf<String?>(null) }
    val enabled = vm.canWrite

    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Picker(stringResource(R.string.card_column), column?.name.orEmpty(), enabled, columns.map { it.id to it.name }) { id ->
            val target = columns.first { it.id == id }
            if (target.delegated) delegateTo = id else vm.move(id)
        }
        Picker(stringResource(R.string.card_kind), kindLabel(card.kind), enabled, CARD_KINDS.map { it to it }, label = { kindLabel(it) }) { vm.setKind(it) }
        Picker(stringResource(R.string.card_priority), priorityLabel(card.priority), enabled, CARD_PRIORITIES.map { it to it }, label = { priorityLabel(it) }) { vm.setPriority(it) }
        AssistChip(
            onClick = { editDue = true },
            enabled = enabled,
            label = { Text(card.due?.let { dueLabel(it, vm.zone, locale) } ?: stringResource(R.string.card_no_due)) },
            leadingIcon = { Icon(Icons.Outlined.Event, null, Modifier.size(18.dp)) },
        )
        AssistChip(
            onClick = { pickColor = true },
            enabled = enabled,
            label = { Text(stringResource(R.string.card_color)) },
            leadingIcon = { card.color?.let { ColorDot(parseHexColor(it), 14.dp) } ?: Icon(Icons.Outlined.Palette, null, Modifier.size(18.dp)) },
        )
        AssistChip(
            onClick = { pickLabels = true },
            enabled = enabled && labels.isNotEmpty(),
            label = { Text(stringResource(R.string.card_labels)) },
            leadingIcon = { Icon(Icons.AutoMirrored.Outlined.Label, null, Modifier.size(18.dp)) },
        )
        if (column?.delegated == true || card.assignee != null) {
            AssistChip(
                onClick = { editAssignee = true },
                enabled = enabled,
                label = { Text(card.assignee?.let { stringResource(R.string.card_assignee_to, it) } ?: stringResource(R.string.card_assignee)) },
                leadingIcon = { Icon(AssigneeIcon, null, Modifier.size(18.dp)) },
            )
        }
    }
    val cardLabels = labels.filter { it.id in card.labelIds }
    if (cardLabels.isNotEmpty()) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            cardLabels.forEach { LabelPill(it.name, it.color) }
        }
    }
    if (card.due != null) RemindersRow(vm, card)

    if (pickColor) {
        AlertDialog(
            onDismissRequest = { pickColor = false },
            title = { Text(stringResource(R.string.card_color)) },
            text = { ColorPicker(card.color, onSelect = { vm.setColor(it); pickColor = false }) },
            confirmButton = { TextButton(onClick = { vm.setColor(null); pickColor = false }) { Text(stringResource(R.string.card_no_color)) } },
            dismissButton = { TextButton(onClick = { pickColor = false }) { Text(stringResource(R.string.action_cancel)) } },
        )
    }
    if (pickLabels) {
        var selected by remember { mutableStateOf(card.labelIds.toSet()) }
        AlertDialog(
            onDismissRequest = { pickLabels = false },
            title = { Text(stringResource(R.string.card_labels)) },
            text = {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    labels.forEach { label ->
                        FilterChip(
                            selected = label.id in selected,
                            onClick = { selected = if (label.id in selected) selected - label.id else selected + label.id },
                            label = { Text(label.name) },
                            leadingIcon = { ColorDot(parseHexColor(label.color), 10.dp) },
                        )
                    }
                }
            },
            confirmButton = { TextButton(onClick = { vm.setLabels(selected.toList()); pickLabels = false }) { Text(stringResource(R.string.action_save)) } },
            dismissButton = { TextButton(onClick = { pickLabels = false }) { Text(stringResource(R.string.action_cancel)) } },
        )
    }
    if (editDue) DueDialog(card.due, vm.zone.id, onDismiss = { editDue = false }, onSave = vm::setDue, zone = vm.zone)
    if (editAssignee) {
        TextInputDialog(
            title = stringResource(R.string.card_assignee),
            label = stringResource(R.string.card_assignee_hint),
            initial = card.assignee.orEmpty(),
            maxLength = 80,
            onConfirm = { vm.setAssignee(it) },
            onDismiss = { editAssignee = false },
        )
    }
    delegateTo?.let { id ->
        TextInputDialog(
            title = stringResource(R.string.card_delegate_title),
            label = stringResource(R.string.card_assignee_hint),
            initial = card.assignee.orEmpty(),
            confirmLabel = stringResource(R.string.card_move),
            maxLength = 80,
            onConfirm = { vm.move(id, it) },
            onDismiss = { delegateTo = null },
        )
    }
}

@Composable
private fun Picker(
    title: String,
    value: String,
    enabled: Boolean,
    options: List<Pair<String, String>>,
    label: @Composable (String) -> String = { key -> options.first { it.first == key }.second },
    onPick: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        AssistChip(onClick = { open = true }, enabled = enabled, label = { Text("$title: $value", maxLines = 1) })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (key, _) ->
                DropdownMenuItem(text = { Text(label(key)) }, onClick = { open = false; onPick(key) })
            }
        }
    }
}

@Composable
fun LabelPill(name: String, color: String) {
    val background = parseHexColor(color)
    Text(
        name,
        style = MaterialTheme.typography.labelSmall,
        color = app.delyra.core.ui.readableOn(background),
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(background)
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

@Composable
private fun RemindersRow(vm: CardViewModel, card: CardDetail) {
    var open by remember { mutableStateOf(false) }
    val allDay = card.due?.allDay == true
    val offsets = card.reminders.map { it.offsetMinutes }
    val options = (if (allDay) ALL_DAY_REMINDERS else TIMED_REMINDERS).filter { it !in offsets }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
        card.reminders.forEach { reminder ->
            InputChip(
                selected = false,
                enabled = vm.canWrite,
                onClick = { vm.setReminders(offsets - reminder.offsetMinutes) },
                label = { Text(reminderLabel(reminder.offsetMinutes, allDay)) },
                leadingIcon = { Icon(Icons.Outlined.NotificationsNone, null) },
                trailingIcon = { Icon(Icons.Outlined.Close, stringResource(R.string.event_remove_reminder)) },
            )
        }
        if (vm.canWrite && offsets.size < 10 && options.isNotEmpty()) {
            Box {
                TextButton(onClick = { open = true }) { Text(stringResource(R.string.event_add_reminder)) }
                DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                    options.forEach { offset ->
                        DropdownMenuItem(text = { Text(reminderLabel(offset, allDay)) }, onClick = { open = false; vm.setReminders(offsets + offset) })
                    }
                }
            }
        }
    }
}

/** Fecha límite: día completo o con hora (en la zona de la cuenta). */
@Composable
private fun DueDialog(due: DueInfo?, tz: String, zone: java.time.ZoneId, onDismiss: () -> Unit, onSave: (DueInfo?) -> Unit) {
    val locale = appLocale()
    val initialDate = due?.let { if (it.allDay) LocalDate.parse(it.at.take(10)) else parseInstant(it.at).atZone(zone).toLocalDate() } ?: LocalDate.now(zone)
    val initialTime = due?.takeIf { !it.allDay }?.let { parseInstant(it.at).atZone(zone).toLocalTime() } ?: LocalTime.of(17, 0)
    var date by remember { mutableStateOf(initialDate) }
    var allDay by remember { mutableStateOf(due?.allDay ?: true) }
    var hour by remember { mutableStateOf(initialTime.hour.toString().padStart(2, '0')) }
    var minute by remember { mutableStateOf(initialTime.minute.toString().padStart(2, '0')) }
    var pickDate by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.card_due)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = { pickDate = true }) { Text(date.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))) }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.calendar_all_day), Modifier.weight(1f))
                    Switch(checked = allDay, onCheckedChange = { allDay = it })
                }
                if (!allDay) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(hour, { hour = it.filter(Char::isDigit).take(2) }, label = { Text("hh") }, singleLine = true, modifier = Modifier.weight(1f))
                        Text(":")
                        OutlinedTextField(minute, { minute = it.filter(Char::isDigit).take(2) }, label = { Text("mm") }, singleLine = true, modifier = Modifier.weight(1f))
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val value = if (allDay) {
                    DueInfo(true, date.toString(), tz)
                } else {
                    val time = LocalTime.of((hour.toIntOrNull() ?: 17).coerceIn(0, 23), (minute.toIntOrNull() ?: 0).coerceIn(0, 59))
                    DueInfo(false, date.atTime(time).atZone(zone).toInstant().truncatedTo(ChronoUnit.SECONDS).toString(), tz)
                }
                onSave(value)
                onDismiss()
            }) { Text(stringResource(R.string.action_save)) }
        },
        dismissButton = {
            Row {
                if (due != null) TextButton(onClick = { onSave(null); onDismiss() }) { Text(stringResource(R.string.card_remove_due), color = MaterialTheme.colorScheme.error) }
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
            }
        },
    )
    if (pickDate) DatePick(date, onDismiss = { pickDate = false }) { date = it }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
}

@Composable
private fun DescriptionSection(vm: CardViewModel, card: CardDetail) {
    var editing by rememberSaveable { mutableStateOf(false) }
    var draft by rememberSaveable(card.description) { mutableStateOf(card.description) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) { SectionTitle(stringResource(R.string.card_description)) }
        if (vm.canWrite && !editing) IconButton(onClick = { editing = true }) { Icon(Icons.Outlined.Edit, stringResource(R.string.action_edit)) }
    }
    if (editing) {
        OutlinedTextField(
            value = draft,
            onValueChange = { draft = it.take(20_000) },
            minLines = 4,
            supportingText = { Text(stringResource(R.string.card_markdown_hint)) },
            modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { vm.setDescription(draft); editing = false }) { Text(stringResource(R.string.action_save)) }
            TextButton(onClick = { draft = card.description; editing = false }) { Text(stringResource(R.string.action_cancel)) }
        }
    } else if (card.description.isBlank()) {
        Text(stringResource(R.string.card_no_description), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
    } else {
        MarkdownText(card.description)
    }
}

@Composable
private fun ChecklistSection(vm: CardViewModel, card: CardDetail) {
    var draft by rememberSaveable { mutableStateOf("") }
    var renaming by remember { mutableStateOf<app.delyra.core.model.ChecklistItem?>(null) }
    val done = card.checklistItems.count { it.done }
    val total = card.checklistItems.size
    SectionTitle(stringResource(R.string.card_checklist) + if (total > 0) " · $done/$total" else "")
    if (total > 0) LinearProgressIndicator(progress = { done.toFloat() / total }, modifier = Modifier.fillMaxWidth())
    card.checklistItems.forEach { item ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = item.done, onCheckedChange = { vm.toggleChecklistItem(item.id, it) }, enabled = vm.canWrite)
            Text(item.text, Modifier.weight(1f).then(if (vm.canWrite) Modifier.clickable { renaming = item } else Modifier), style = MaterialTheme.typography.bodyMedium)
            if (vm.canWrite) IconButton(onClick = { vm.deleteChecklistItem(item.id) }) { Icon(Icons.Outlined.Delete, stringResource(R.string.action_delete)) }
        }
    }
    if (vm.canWrite) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(draft, { draft = it.take(300) }, label = { Text(stringResource(R.string.card_checklist_add)) }, singleLine = true, modifier = Modifier.weight(1f))
            TextButton(onClick = { vm.addChecklistItem(draft); draft = "" }, enabled = draft.isNotBlank()) { Text(stringResource(R.string.action_add)) }
        }
    }
    renaming?.let { item ->
        TextInputDialog(
            title = stringResource(R.string.action_edit),
            label = stringResource(R.string.card_checklist),
            initial = item.text,
            onConfirm = { vm.renameChecklistItem(item.id, it) },
            onDismiss = { renaming = null },
        )
    }
}

@Composable
private fun AttachmentsSection(vm: CardViewModel, card: CardDetail) {
    val context = LocalContext.current
    val locale = appLocale()
    var deleting by remember { mutableStateOf<app.delyra.core.model.CardAttachment?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) vm.upload(context, uri) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) { SectionTitle(stringResource(R.string.card_attachments)) }
        if (vm.canWrite && card.attachmentList.size < 20) {
            TextButton(onClick = { picker.launch(arrayOf("image/*", "application/pdf", "text/*", "application/zip", "application/vnd.openxmlformats-officedocument.*")) }, enabled = !vm.uploading) {
                if (vm.uploading) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Icon(Icons.Outlined.AttachFile, null)
                Text(stringResource(R.string.card_attach), Modifier.padding(start = 6.dp))
            }
        }
    }
    if (card.attachmentList.isEmpty()) {
        Text(stringResource(R.string.card_no_attachments), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
    }
    card.attachmentList.forEach { attachment ->
        Row(Modifier.fillMaxWidth().clickable { vm.open(context, attachment) }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.AttachFile, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(attachment.filename, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                Text(
                    android.text.format.Formatter.formatShortFileSize(context, attachment.size) + " · " + shortDateTime(attachment.createdAt, vm.zone, locale),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (vm.canWrite) IconButton(onClick = { deleting = attachment }) { Icon(Icons.Outlined.Delete, stringResource(R.string.action_delete)) }
        }
    }
    deleting?.let { attachment ->
        ConfirmDialog(
            title = stringResource(R.string.card_attachment_delete),
            text = attachment.filename,
            confirmLabel = stringResource(R.string.action_delete),
            destructive = true,
            onConfirm = { vm.deleteAttachment(attachment.id) },
            onDismiss = { deleting = null },
        )
    }
}

@Composable
private fun CommentsSection(vm: CardViewModel, card: CardDetail) {
    val locale = appLocale()
    var draft by rememberSaveable { mutableStateOf("") }
    var editing by remember { mutableStateOf<app.delyra.core.model.CardComment?>(null) }
    SectionTitle(stringResource(R.string.card_comments))
    card.commentList.forEach { comment ->
        Column(Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(comment.authorName ?: stringResource(R.string.card_someone), style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                Text(shortDateTime(comment.createdAt, vm.zone, locale), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (comment.mine) {
                    IconButton(onClick = { editing = comment }) { Icon(Icons.Outlined.Edit, stringResource(R.string.action_edit), Modifier.size(18.dp)) }
                    IconButton(onClick = { vm.deleteComment(comment.id) }) { Icon(Icons.Outlined.Delete, stringResource(R.string.action_delete), Modifier.size(18.dp)) }
                }
            }
            MarkdownText(comment.body)
        }
    }
    if (vm.canWrite) {
        OutlinedTextField(draft, { draft = it.take(5_000) }, label = { Text(stringResource(R.string.card_comment_add)) }, minLines = 2, modifier = Modifier.fillMaxWidth())
        Button(onClick = { vm.addComment(draft); draft = "" }, enabled = draft.isNotBlank()) { Text(stringResource(R.string.card_comment_send)) }
    }
    editing?.let { comment ->
        TextInputDialog(
            title = stringResource(R.string.action_edit),
            label = stringResource(R.string.card_comments),
            initial = comment.body,
            maxLength = 5_000,
            singleLine = false,
            onConfirm = { vm.editComment(comment.id, it) },
            onDismiss = { editing = null },
        )
    }
}

@Composable
private fun ActivitySection(card: CardDetail) {
    val locale = appLocale()
    var open by rememberSaveable { mutableStateOf(false) }
    val zone = app.delyra.core.ui.LocalAppGraph.current.session.active?.zone ?: java.time.ZoneId.systemDefault()
    Row(Modifier.fillMaxWidth().clickable { open = !open }, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) { SectionTitle(stringResource(R.string.card_activity) + " · ${card.activity.size}") }
        Text(stringResource(if (open) R.string.card_hide else R.string.card_show), color = MaterialTheme.colorScheme.primary)
    }
    if (open) {
        card.activity.forEach { entry ->
            Text(
                "${shortDateTime(entry.createdAt, zone, locale)} · ${entry.actorName ?: stringResource(R.string.card_someone)} · ${activityLabel(entry.kind)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun activityLabel(kind: String): String = when (kind) {
    "created" -> stringResource(R.string.activity_created)
    "moved" -> stringResource(R.string.activity_moved)
    "commented" -> stringResource(R.string.activity_commented)
    "attached" -> stringResource(R.string.activity_attached)
    "detached" -> stringResource(R.string.activity_detached)
    "archived" -> stringResource(R.string.activity_archived)
    "restored" -> stringResource(R.string.activity_restored)
    "completed" -> stringResource(R.string.activity_completed)
    else -> stringResource(R.string.activity_updated)
}

@Composable
private fun CardFooter(vm: CardViewModel, card: CardDetail) {
    var confirmDelete by remember { mutableStateOf(false) }
    HorizontalDivider()
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { vm.archive(card.archivedAt == null) }) {
            Icon(ArchiveIcon, null, Modifier.size(18.dp))
            Text(stringResource(if (card.archivedAt == null) R.string.card_archive else R.string.card_restore), Modifier.padding(start = 8.dp))
        }
        OutlinedButton(onClick = { confirmDelete = true }) {
            Text(stringResource(R.string.action_delete), color = MaterialTheme.colorScheme.error)
        }
    }
    if (confirmDelete) {
        ConfirmDialog(
            title = stringResource(R.string.card_delete_title),
            text = stringResource(R.string.card_delete_body, card.title),
            confirmLabel = stringResource(R.string.action_delete),
            destructive = true,
            onConfirm = vm::delete,
            onDismiss = { confirmDelete = false },
        )
    }
}

fun shortDateTime(iso: String, zone: java.time.ZoneId, locale: java.util.Locale): String = runCatching {
    parseInstant(iso).atZone(zone).format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withLocale(locale))
}.getOrDefault(iso)
