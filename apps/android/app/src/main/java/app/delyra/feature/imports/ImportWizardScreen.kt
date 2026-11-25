package app.delyra.feature.imports

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.delyra.AppGraph
import app.delyra.R
import app.delyra.core.i18n.serverText
import app.delyra.core.model.CalendarInfo
import app.delyra.core.model.ImportCalendarPreview
import app.delyra.core.model.ImportInfo
import app.delyra.core.network.ApiError
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import app.delyra.core.ui.ColorDot
import app.delyra.core.ui.ColorPicker
import app.delyra.core.ui.ErrorState
import app.delyra.core.ui.LoadingBox
import app.delyra.core.ui.PALETTE
import app.delyra.core.ui.Tile
import app.delyra.core.ui.appViewModel
import app.delyra.core.ui.message
import app.delyra.core.ui.parseHexColor
import app.delyra.feature.calendar.appLocale
import app.delyra.feature.calendar.mediumDate
import app.delyra.feature.calendar.parseInstant
import app.delyra.feature.settings.Hint
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.ZoneId

/**
 * Asistente de una importación (como `ImportWizard` de la web): el Workflow lee el fichero, se
 * elige dónde va cada calendario y se sigue el progreso hasta el informe final.
 */
class ImportWizardViewModel(private val graph: AppGraph, private val id: String) : ViewModel() {
    private val api = graph.integrationsApi
    var item by mutableStateOf<ImportInfo?>(null)
        private set
    var loadError by mutableStateOf<ApiError?>(null)
        private set
    /** Calendarios propios en los que se puede escribir (destinos posibles). */
    var own by mutableStateOf<List<CalendarInfo>>(emptyList())
        private set
    val choices = mutableStateListOf<ImportChoice>()
    var reminders by mutableStateOf(true)
    var problem by mutableStateOf<PlanProblem?>(null)
        private set
    var error by mutableStateOf<ApiError?>(null)
    var busy by mutableStateOf(false)
        private set
    var discarded by mutableStateOf(false)
        private set
    private var polling: Job? = null

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            apiCall { graph.calendarApi.calendars() }.onSuccess { r -> own = r.calendars.filter { !it.readOnly }.sortedBy { it.position } }
            apiCall { api.import(id) }.onSuccess { apply(it.item) }.onFailure { loadError = it.apiError }
        }
    }

    private fun apply(next: ImportInfo) {
        val before = item?.status
        item = next
        loadError = null
        if (next.status == "ready" && choices.size != next.calendars.size) {
            choices.clear()
            val palette = PALETTE.map { it.second }
            next.calendars.forEachIndexed { index, calendar -> choices += initialChoice(calendar, index, own, palette) }
        }
        if (next.status == "succeeded" && before != "succeeded") graph.changes.calendarChanged()
        if (next.status == "analyzing" || next.status == "importing") poll()
    }

    /** Mientras el Workflow trabaja, se pregunta cada 1,5 s. */
    private fun poll() {
        if (polling?.isActive == true) return
        polling = viewModelScope.launch {
            while (true) {
                delay(1_500)
                val next = apiCall { api.import(id) }.getOrNull()?.item ?: continue
                apply(next)
                if (next.status != "analyzing" && next.status != "importing") break
            }
        }
    }

    fun choose(index: Int, choice: ImportChoice) {
        if (index in choices.indices) choices[index] = choice
        problem = null
    }

    fun start() {
        val current = item ?: return
        problem = planProblem(choices)
        if (problem != null || busy) return
        busy = true
        error = null
        viewModelScope.launch {
            apiCall { api.start(id, startImportBody(current.calendars, choices.toList(), reminders)) }
                .onSuccess { apply(it.item) }
                .onFailure { error = it.apiError }
            busy = false
        }
    }

    fun discard() {
        if (busy) return
        busy = true
        viewModelScope.launch {
            apiCall { api.discard(id) }.onSuccess { discarded = true }.onFailure { error = it.apiError }
            busy = false
        }
    }

    override fun onCleared() {
        polling?.cancel()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportWizardScreen(importId: String, onBack: () -> Unit, onViewCalendar: () -> Unit) {
    val vm = appViewModel(key = "import-$importId") { ImportWizardViewModel(it, importId) }
    LaunchedEffect(vm.discarded) { if (vm.discarded) onBack() }
    val snackbar = remember { SnackbarHostState() }
    val errorText = vm.error?.message()
    LaunchedEffect(vm.error) {
        errorText?.let { snackbar.showSnackbar(it) }
        vm.error = null
    }
    val item = vm.item
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        when {
                            item == null -> stringResource(R.string.imports_title)
                            item.source == "google" -> stringResource(R.string.wizard_google)
                            else -> stringResource(R.string.wizard_file, item.filename ?: stringResource(R.string.recent_file))
                        },
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.action_back)) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            when {
                item == null && vm.loadError != null -> ErrorState(vm.loadError!!, onRetry = vm::load)
                item == null -> LoadingBox(Modifier.fillMaxSize())
                else -> Column(
                    Modifier.widthIn(max = 720.dp).fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    when (item.status) {
                        "analyzing" -> Working(stringResource(if (item.source == "google") R.string.wizard_downloading else R.string.wizard_reading))
                        "ready" -> PreviewForm(vm, item)
                        "importing" -> Progress(item)
                        "succeeded" -> Report(item, onViewCalendar = onViewCalendar, onAnother = onBack)
                        "failed" -> Text(item.error?.let { serverText(it) } ?: stringResource(R.string.wizard_failed), color = MaterialTheme.colorScheme.error)
                        else -> Text(stringResource(R.string.wizard_expired), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}

@Composable
private fun Working(text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        Text(text, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun PreviewForm(vm: ImportWizardViewModel, item: ImportInfo) {
    Hint(stringResource(R.string.preview_intro))
    item.calendars.forEachIndexed { index, calendar ->
        val choice = vm.choices.getOrNull(index) ?: return@forEachIndexed
        CalendarChoiceCard(calendar, choice, vm.own) { vm.choose(index, it) }
    }
    Row(
        Modifier.fillMaxWidth().toggleable(vm.reminders, role = Role.Switch) { vm.reminders = it }.padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.preview_reminders), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Switch(checked = vm.reminders, onCheckedChange = null)
    }
    Warnings(item.warnings)
    vm.problem?.let { problem ->
        Text(
            stringResource(if (problem == PlanProblem.NothingChosen) R.string.preview_choose_one else R.string.preview_name_new),
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = vm::start, enabled = !vm.busy) { Text(stringResource(R.string.preview_import)) }
        OutlinedButton(onClick = vm::discard, enabled = !vm.busy) { Text(stringResource(R.string.preview_discard)) }
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun CalendarChoiceCard(calendar: ImportCalendarPreview, choice: ImportChoice, own: List<CalendarInfo>, onChange: (ImportChoice) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val locale = appLocale()
    Tile(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                calendar.color?.let {
                    ColorDot(parseHexColor(it))
                    Spacer(Modifier.width(8.dp))
                }
                Text(calendar.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            }
            val facts = listOfNotNull(
                pluralStringResource(R.plurals.imports_count_events, calendar.events, calendar.events),
                calendar.recurring.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.imports_count_series, it, it) },
                calendar.birthdays.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.imports_count_birthdays, it, it) },
                calendar.withReminders.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.imports_count_with_reminders, it, it) },
                period(calendar, locale),
            )
            Hint(facts.joinToString(" · "))
            Text(stringResource(R.string.preview_destination), style = MaterialTheme.typography.labelLarge)
            Box {
                TextButton(onClick = { menu = true }) {
                    Text(
                        when (choice) {
                            ImportChoice.Skip -> stringResource(R.string.preview_skip)
                            is ImportChoice.New -> stringResource(R.string.preview_new)
                            is ImportChoice.Existing -> stringResource(R.string.preview_add_to, own.firstOrNull { it.id == choice.calendarId }?.name.orEmpty())
                        },
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.preview_new)) },
                        onClick = { menu = false; onChange(ImportChoice.New(calendar.name.take(60), calendar.color ?: PALETTE.first().second)) },
                    )
                    own.forEach { target ->
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.preview_add_to, target.name)) },
                            leadingIcon = { ColorDot(parseHexColor(target.color)) },
                            onClick = { menu = false; onChange(ImportChoice.Existing(target.id)) },
                        )
                    }
                    DropdownMenuItem(text = { Text(stringResource(R.string.preview_skip)) }, onClick = { menu = false; onChange(ImportChoice.Skip) })
                }
            }
            if (choice is ImportChoice.New) {
                OutlinedTextField(
                    value = choice.name,
                    onValueChange = { onChange(choice.copy(name = it.take(60))) },
                    label = { Text(stringResource(R.string.preview_new_name)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                ColorPicker(choice.color, onSelect = { onChange(choice.copy(color = it)) })
            }
        }
    }
}

/** «12 ene 2024 – 3 dic 2026», el primer y el último inicio, para reconocer el calendario. */
private fun period(calendar: ImportCalendarPreview, locale: java.util.Locale): String? {
    val first = calendar.firstStart ?: return null
    val last = calendar.lastStart ?: return null
    val zone = ZoneId.systemDefault()
    val a = runCatching { mediumDate(parseInstant(first).atZone(zone).toLocalDate(), locale) }.getOrNull() ?: return null
    val b = runCatching { mediumDate(parseInstant(last).atZone(zone).toLocalDate(), locale) }.getOrNull() ?: return null
    return if (a == b) a else "$a – $b"
}

@Composable
private fun Warnings(warnings: List<String>) {
    if (warnings.isEmpty()) return
    var open by remember { mutableStateOf(false) }
    TextButton(onClick = { open = !open }) {
        Icon(Icons.Outlined.WarningAmber, null, Modifier.padding(end = 8.dp).size(18.dp), tint = MaterialTheme.colorScheme.tertiary)
        Text("${stringResource(R.string.preview_warnings)} (${warnings.size})")
    }
    if (open) warnings.forEach { Hint("• ${serverText(it)}") }
}

@Composable
private fun Progress(item: ImportInfo) {
    Working(stringResource(R.string.wizard_importing))
    val total = item.progress.total
    if (total > 0) {
        LinearProgressIndicator(progress = { (item.progress.done.toFloat() / total).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
        Hint(stringResource(R.string.progress_of, item.progress.done.toString(), pluralStringResource(R.plurals.imports_count_events, total, total)))
    } else {
        LinearProgressIndicator(Modifier.fillMaxWidth())
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun Report(item: ImportInfo, onViewCalendar: () -> Unit, onAnother: () -> Unit) {
    val report = item.report ?: return
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.CheckCircle, null, tint = MaterialTheme.colorScheme.primary)
        Text(stringResource(R.string.report_done), style = MaterialTheme.typography.titleMedium)
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(
            R.string.report_created to report.created,
            R.string.report_updated to report.updated,
            R.string.report_unchanged to report.unchanged,
            R.string.report_skipped to report.skipped,
        ).forEach { (label, value) ->
            Tile {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                    Text(value.toString(), style = MaterialTheme.typography.headlineSmall)
                    Hint(stringResource(label))
                }
            }
        }
    }
    if (report.calendars.size > 1) {
        report.calendars.forEach { c -> Hint(stringResource(R.string.report_calendar, c.name, c.created, c.updated, c.unchanged)) }
    }
    Warnings(report.warnings)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = onViewCalendar) { Text(stringResource(R.string.wizard_view)) }
        OutlinedButton(onClick = onAnother) { Text(stringResource(R.string.wizard_another)) }
    }
}
