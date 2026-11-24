package app.delyra.feature.calendar

import android.text.format.DateFormat
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.delyra.R
import app.delyra.core.ui.ConfirmDialog
import app.delyra.core.ui.ErrorState
import app.delyra.core.ui.ErrorText
import app.delyra.core.ui.LoadingBox
import app.delyra.core.ui.appViewModel
import app.delyra.navigation.EventEditorRoute
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle

@Composable
fun EventEditorScreen(route: EventEditorRoute, onDone: () -> Unit) {
    val vm = appViewModel(key = route.toString()) { EventEditorViewModel(it, route) }
    LaunchedEffect(vm.done) { if (vm.done) onDone() }
    var askScope by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onDone) { Icon(Icons.Outlined.Close, stringResource(R.string.action_close)) } },
                title = {
                    Text(
                        stringResource(
                            when {
                                vm.editing && vm.birthday -> R.string.event_edit_birthday
                                vm.editing -> R.string.event_edit
                                vm.birthday -> R.string.event_new_birthday
                                else -> R.string.calendar_new_event
                            },
                        ),
                    )
                },
                actions = {
                    Button(
                        onClick = { if (vm.needsScope) askScope = "edit" else vm.save() },
                        enabled = !vm.busy && !vm.loading,
                        modifier = Modifier.padding(end = 8.dp),
                    ) { Text(stringResource(R.string.action_save)) }
                },
            )
        },
    ) { padding ->
        when {
            vm.loading -> LoadingBox(Modifier.padding(padding))
            vm.loadError != null && vm.editing && vm.detail == null -> ErrorState(vm.loadError!!, onRetry = onDone, modifier = Modifier.padding(padding))
            else -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
                EditorForm(vm, onDelete = { if (vm.recurringOccurrence) askScope = "delete" else confirmDelete = true })
            }
        }
    }

    askScope?.let { kind ->
        ScopeDialog(
            title = stringResource(if (kind == "edit") R.string.scope_edit_title else R.string.scope_delete_title),
            options = if (vm.birthday) listOf("this", "all") else listOf("this", "following", "all"),
            onPick = { scope -> if (kind == "edit") vm.save(scope) else vm.delete(scope) },
            onDismiss = { askScope = null },
        )
    }
    if (confirmDelete) {
        ConfirmDialog(
            title = stringResource(R.string.event_delete_title),
            text = stringResource(R.string.event_delete_body, vm.title),
            confirmLabel = stringResource(R.string.action_delete),
            destructive = true,
            onConfirm = { vm.delete("all") },
            onDismiss = { confirmDelete = false },
        )
    }
}

@Composable
private fun EditorForm(vm: EventEditorViewModel, onDelete: () -> Unit) {
    val locale = appLocale()
    Column(
        Modifier
            .widthIn(max = 680.dp)
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (!vm.editing) {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(selected = !vm.birthday, onClick = { vm.switchType(false) }, shape = SegmentedButtonDefaults.itemShape(0, 2)) {
                    Text(stringResource(R.string.event_type_event))
                }
                SegmentedButton(selected = vm.birthday, onClick = { vm.switchType(true) }, shape = SegmentedButtonDefaults.itemShape(1, 2)) {
                    Text(stringResource(R.string.event_type_birthday))
                }
            }
        }
        OutlinedTextField(
            value = vm.title,
            onValueChange = { vm.title = it.take(200) },
            label = { Text(stringResource(if (vm.birthday) R.string.event_birthday_name else R.string.event_title)) },
            singleLine = true,
            textStyle = MaterialTheme.typography.titleLarge,
            modifier = Modifier.fillMaxWidth(),
        )
        CalendarPicker(vm)

        if (!vm.birthday) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.calendar_all_day), Modifier.weight(1f))
                Switch(checked = vm.times.allDay, onCheckedChange = vm::setAllDay)
            }
        }
        val t = vm.times
        DateTimeRow(
            label = stringResource(if (vm.birthday) R.string.event_date else R.string.event_start),
            date = t.startDate,
            minutes = t.startMinutes.takeIf { !t.allDay },
            onDate = { vm.setStart(date = it) },
            onTime = { vm.setStart(minutes = it) },
        )
        if (!vm.birthday) {
            DateTimeRow(
                label = stringResource(R.string.event_end),
                date = t.endDate,
                minutes = t.endMinutes.takeIf { !t.allDay },
                onDate = { vm.setEnd(date = it) },
                onTime = { vm.setEnd(minutes = it) },
            )
            Text(
                stringResource(R.string.event_zone, vm.zone.getDisplayName(TextStyle.FULL, locale)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            RepeatPicker(vm)
        } else {
            OutlinedTextField(
                value = vm.birthYear,
                onValueChange = { vm.birthYear = it.filter(Char::isDigit).take(4) },
                label = { Text(stringResource(R.string.event_birth_year)) },
                supportingText = { Text(stringResource(R.string.event_birth_year_hint)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
            )
            if (t.startDate.monthValue == 2 && t.startDate.dayOfMonth == 29) {
                Text(stringResource(R.string.event_feb29), style = MaterialTheme.typography.bodyMedium)
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    listOf("feb28" to R.string.event_feb28, "mar1" to R.string.event_mar1).forEachIndexed { i, (value, label) ->
                        SegmentedButton(selected = vm.feb29Rule == value, onClick = { vm.feb29Rule = value }, shape = SegmentedButtonDefaults.itemShape(i, 2)) {
                            Text(stringResource(label))
                        }
                    }
                }
            }
        }
        RemindersPicker(vm)
        if (!vm.birthday) {
            OutlinedTextField(
                value = vm.location,
                onValueChange = { vm.location = it.take(300) },
                label = { Text(stringResource(R.string.event_location)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = vm.url,
                onValueChange = { vm.url = it.take(2000) },
                label = { Text(stringResource(R.string.event_url)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        OutlinedTextField(
            value = vm.notes,
            onValueChange = { vm.notes = it.take(10_000) },
            label = { Text(stringResource(R.string.event_notes)) },
            minLines = 3,
            modifier = Modifier.fillMaxWidth(),
        )
        vm.localError?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.error) }
        ErrorText(vm.error)
        if (vm.editing) {
            HorizontalDivider()
            OutlinedButton(onClick = onDelete, enabled = !vm.busy) {
                Text(stringResource(R.string.action_delete), color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun CalendarPicker(vm: EventEditorViewModel) {
    var expanded by remember { mutableStateOf(false) }
    val options = vm.calendars.filter { !it.readOnly }
    val current = vm.calendars.firstOrNull { it.id == vm.calendarId }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = current?.name.orEmpty(),
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.event_calendar)) },
            leadingIcon = current?.let { { app.delyra.core.ui.ColorDot(app.delyra.core.ui.parseHexColor(it.color), 14.dp) } },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { calendar ->
                DropdownMenuItem(
                    text = { Text(calendar.name) },
                    leadingIcon = { app.delyra.core.ui.ColorDot(app.delyra.core.ui.parseHexColor(calendar.color), 14.dp) },
                    onClick = { vm.calendarId = calendar.id; expanded = false },
                )
            }
        }
    }
}

@Composable
private fun DateTimeRow(label: String, date: LocalDate, minutes: Int?, onDate: (LocalDate) -> Unit, onTime: (Int) -> Unit) {
    val locale = appLocale()
    var pickDate by rememberSaveable { mutableStateOf(false) }
    var pickTime by rememberSaveable { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { pickDate = true }) {
                Text(date.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)))
            }
            if (minutes != null) {
                OutlinedButton(onClick = { pickTime = true }) {
                    Text(LocalTime.ofSecondOfDay(minutes * 60L).format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale)))
                }
            }
        }
    }
    if (pickDate) DatePick(date, onDismiss = { pickDate = false }, onPick = onDate)
    if (pickTime && minutes != null) TimePick(minutes, onDismiss = { pickTime = false }, onPick = onTime)
}

@Composable
fun DatePick(initial: LocalDate, onDismiss: () -> Unit, onPick: (LocalDate) -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = initial.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                state.selectedDateMillis?.let { onPick(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) }
                onDismiss()
            }) { Text(stringResource(R.string.action_continue)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    ) { DatePicker(state = state) }
}

/** Elegir una hora (minutos desde medianoche), en 12 o 24 h según el móvil. */
@Composable
internal fun TimePick(minutes: Int, onDismiss: () -> Unit, onPick: (Int) -> Unit) {
    val context = LocalContext.current
    val state = rememberTimePickerState(initialHour = minutes / 60, initialMinute = minutes % 60, is24Hour = DateFormat.is24HourFormat(context))
    AlertDialog(
        onDismissRequest = onDismiss,
        text = { TimePicker(state = state) },
        confirmButton = { TextButton(onClick = { onPick(state.hour * 60 + state.minute); onDismiss() }) { Text(stringResource(R.string.action_continue)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

@Composable
private fun RepeatPicker(vm: EventEditorViewModel) {
    val locale = appLocale()
    var expanded by remember { mutableStateOf(false) }
    val start = vm.times.startDate
    val weekday = start.dayOfWeek.getDisplayName(TextStyle.FULL, locale)
    val labels = mapOf(
        RepeatPreset.None to stringResource(R.string.repeat_none),
        RepeatPreset.Daily to stringResource(R.string.repeat_daily),
        RepeatPreset.Weekdays to stringResource(R.string.repeat_weekdays),
        RepeatPreset.Weekly to stringResource(R.string.repeat_weekly, weekday),
        RepeatPreset.Monthly to stringResource(R.string.repeat_monthly, start.dayOfMonth),
        RepeatPreset.Yearly to stringResource(R.string.repeat_yearly),
        RepeatPreset.Custom to stringResource(R.string.repeat_custom),
    )
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = labels.getValue(vm.repeat.preset),
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.event_repeat)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            labels.forEach { (preset, label) ->
                DropdownMenuItem(text = { Text(label) }, onClick = { vm.repeat = vm.repeat.copy(preset = preset); expanded = false })
            }
        }
    }
    when (vm.repeat.preset) {
        RepeatPreset.None -> Unit
        RepeatPreset.Custom -> OutlinedTextField(
            value = vm.repeat.custom,
            onValueChange = { vm.repeat = vm.repeat.copy(custom = it.uppercase().take(300)) },
            label = { Text(stringResource(R.string.repeat_rule)) },
            supportingText = { Text("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        else -> RepeatEndPicker(vm)
    }
}

@Composable
private fun RepeatEndPicker(vm: EventEditorViewModel) {
    val locale = appLocale()
    var pickDate by rememberSaveable { mutableStateOf(false) }
    val end = vm.repeat.end
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.repeat_ends), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            SegmentedButton(selected = end is RepeatEnd.Never, onClick = { vm.repeat = vm.repeat.copy(end = RepeatEnd.Never) }, shape = SegmentedButtonDefaults.itemShape(0, 3)) {
                Text(stringResource(R.string.repeat_never))
            }
            SegmentedButton(
                selected = end is RepeatEnd.Until,
                onClick = { vm.repeat = vm.repeat.copy(end = RepeatEnd.Until(vm.times.startDate.plusMonths(3))) },
                shape = SegmentedButtonDefaults.itemShape(1, 3),
            ) { Text(stringResource(R.string.repeat_until)) }
            SegmentedButton(selected = end is RepeatEnd.Count, onClick = { vm.repeat = vm.repeat.copy(end = RepeatEnd.Count(10)) }, shape = SegmentedButtonDefaults.itemShape(2, 3)) {
                Text(stringResource(R.string.repeat_count))
            }
        }
        when (end) {
            is RepeatEnd.Until -> OutlinedButton(onClick = { pickDate = true }) {
                Text(end.date.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)))
            }
            is RepeatEnd.Count -> OutlinedTextField(
                value = end.count.toString(),
                onValueChange = { v -> v.filter(Char::isDigit).take(3).toIntOrNull()?.let { vm.repeat = vm.repeat.copy(end = RepeatEnd.Count(it.coerceAtLeast(1))) } },
                label = { Text(stringResource(R.string.repeat_times)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
            RepeatEnd.Never -> Unit
        }
    }
    if (pickDate && end is RepeatEnd.Until) {
        DatePick(end.date, onDismiss = { pickDate = false }) { vm.repeat = vm.repeat.copy(end = RepeatEnd.Until(it)) }
    }
}

@Composable
private fun RemindersPicker(vm: EventEditorViewModel) {
    var expanded by remember { mutableStateOf(false) }
    val allDay = vm.times.allDay || vm.birthday
    val options = (if (allDay) ALL_DAY_REMINDERS else TIMED_REMINDERS).filter { it !in vm.reminders }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.event_reminders), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            vm.reminders.forEach { offset ->
                InputChip(
                    selected = false,
                    onClick = { vm.reminders.remove(offset) },
                    label = { Text(reminderLabel(offset, allDay)) },
                    leadingIcon = { Icon(Icons.Outlined.NotificationsNone, null) },
                    trailingIcon = { Icon(Icons.Outlined.Close, stringResource(R.string.event_remove_reminder)) },
                )
            }
            if (vm.reminders.size < 10 && options.isNotEmpty()) {
                Box {
                    TextButton(onClick = { expanded = true }) { Text(stringResource(R.string.event_add_reminder)) }
                    androidx.compose.material3.DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        options.forEach { offset ->
                            DropdownMenuItem(text = { Text(reminderLabel(offset, allDay)) }, onClick = { vm.reminders.add(offset); expanded = false })
                        }
                    }
                }
            }
        }
        Text(stringResource(R.string.event_reminders_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun reminderLabel(offset: Int, allDay: Boolean): String = if (allDay) {
    when (offset) {
        -540 -> stringResource(R.string.reminder_same_day_9)
        900 -> stringResource(R.string.reminder_day_before_9)
        2340 -> stringResource(R.string.reminder_two_days_before_9)
        9540 -> stringResource(R.string.reminder_week_before_9)
        else -> if (offset >= 0) stringResource(R.string.reminder_minutes_before, offset) else stringResource(R.string.reminder_minutes_after, -offset)
    }
} else {
    when {
        offset == 0 -> stringResource(R.string.reminder_at_start)
        offset == 10_080 -> stringResource(R.string.reminder_week_before)
        offset > 0 && offset % 1440 == 0 -> androidx.compose.ui.res.pluralStringResource(R.plurals.reminder_days_before, offset / 1440, offset / 1440)
        offset > 0 && offset % 60 == 0 -> stringResource(R.string.reminder_hours_before, offset / 60)
        offset >= 0 -> stringResource(R.string.reminder_minutes_before, offset)
        else -> stringResource(R.string.reminder_minutes_after, -offset)
    }
}
