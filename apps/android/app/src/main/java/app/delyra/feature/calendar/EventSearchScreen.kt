package app.delyra.feature.calendar

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.delyra.AppGraph
import app.delyra.R
import app.delyra.core.model.CalendarInfo
import app.delyra.core.model.Occurrence
import app.delyra.core.network.ApiError
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import app.delyra.core.ui.EmptyState
import app.delyra.core.ui.ErrorText
import app.delyra.core.ui.appViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class EventSearchViewModel(private val graph: AppGraph) : ViewModel() {
    var results by mutableStateOf<List<Occurrence>?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<ApiError?>(null)
        private set
    var calendars by mutableStateOf<Map<String, CalendarInfo>>(emptyMap())
        private set
    private var job: Job? = null

    init {
        viewModelScope.launch { apiCall { graph.calendarApi.calendars() }.onSuccess { r -> calendars = r.calendars.associateBy { it.id } } }
    }

    /** Busca al dejar de escribir (300 ms); la API pide al menos 2 caracteres. */
    fun search(query: String) {
        job?.cancel()
        val q = query.trim()
        if (q.length < 2) {
            results = null
            return
        }
        job = viewModelScope.launch {
            delay(300)
            busy = true
            apiCall { graph.calendarApi.search(q) }
                .onSuccess { results = it.events; error = null }
                .onFailure { error = it.apiError }
            busy = false
        }
    }
}

@Composable
fun EventSearchScreen(onBack: () -> Unit, onOpen: (Occurrence) -> Unit) {
    val vm = appViewModel { EventSearchViewModel(it) }
    var query by rememberSaveable { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val graph = app.delyra.core.ui.LocalAppGraph.current
    val zone = graph.session.active?.zone ?: java.time.ZoneId.systemDefault()
    val locale = appLocale()

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.action_back)) } },
                title = {
                    TextField(
                        value = query,
                        onValueChange = { query = it.take(100); vm.search(query) },
                        placeholder = { Text(stringResource(R.string.search_events)) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { vm.search(query) }),
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = Color.Transparent,
                            unfocusedContainerColor = Color.Transparent,
                            focusedIndicatorColor = Color.Transparent,
                            unfocusedIndicatorColor = Color.Transparent,
                        ),
                        modifier = Modifier.fillMaxWidth().focusRequester(focus),
                    )
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            if (vm.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            val results = vm.results
            LazyColumn(Modifier.widthIn(max = 720.dp).fillMaxSize(), contentPadding = PaddingValues(16.dp)) {
                vm.error?.let { item { ErrorText(it) } }
                if (results != null && results.isEmpty() && !vm.busy) {
                    item { EmptyState(stringResource(R.string.search_no_results)) }
                }
                items(results.orEmpty(), key = { it.id }) { occurrence ->
                    val calendar = vm.calendars[occurrence.calendarId]
                    val item = occurrence.toItem(zone, calendar?.color ?: "#7c5cff", calendar?.readOnly == true)
                    Text(longDate(item.startDate, locale), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                    AgendaRow(item, item.startDate, locale) { if (!it.readOnly) onOpen(occurrence) }
                }
            }
        }
    }
}
