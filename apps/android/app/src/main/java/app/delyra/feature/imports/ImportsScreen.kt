package app.delyra.feature.imports

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.viewModelScope
import app.delyra.AppGraph
import app.delyra.R
import app.delyra.core.i18n.serverText
import app.delyra.core.model.AddGoogleSyncRequest
import app.delyra.core.model.GoogleAccountCalendar
import app.delyra.core.model.GoogleSyncInfo
import app.delyra.core.model.GoogleSyncedCalendar
import app.delyra.core.model.ImportInfo
import app.delyra.core.model.SubscribeRequest
import app.delyra.core.model.SubscriptionInfo
import app.delyra.core.network.ApiError
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import app.delyra.core.ui.ColorDot
import app.delyra.core.ui.ConfirmDialog
import app.delyra.core.ui.ErrorText
import app.delyra.core.ui.LocalAppGraph
import app.delyra.core.ui.Tile
import app.delyra.core.ui.appViewModel
import app.delyra.core.ui.message
import app.delyra.core.ui.openInBrowser
import app.delyra.core.ui.parseHexColor
import app.delyra.feature.settings.Hint
import app.delyra.feature.settings.TileTitle
import app.delyra.feature.settings.accountDateTime
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import java.io.IOException

/** `IMPORT_LIMITS.uploadBytes` de la API. */
private const val MAX_UPLOAD_BYTES = 25L * 1024 * 1024

/** Aviso breve con un texto opcional («Suscrito a «X»»). */
data class Notice(val text: Int, val arg: String? = null)

/**
 * Importar y sincronizar (F5 y F7-09 en la web, F8-08 aquí): subir la exportación de Google
 * Calendar, suscripciones iCal y la sincronización continua con Google. Conectar con Google (el
 * OAuth) se hace en la web, en el navegador; al volver a la app se recarga todo.
 */
class ImportsViewModel(private val graph: AppGraph) : ViewModel() {
    private val api = graph.integrationsApi
    var googleEnabled by mutableStateOf<Boolean?>(null)
        private set
    var sync by mutableStateOf<GoogleSyncInfo?>(null)
        private set
    var available by mutableStateOf<List<GoogleAccountCalendar>?>(null)
        private set
    var subscriptions by mutableStateOf<List<SubscriptionInfo>?>(null)
        private set
    var imports by mutableStateOf<List<ImportInfo>>(emptyList())
        private set
    var busy by mutableStateOf(false)
        private set
    var uploading by mutableStateOf(false)
        private set
    var subscribeError by mutableStateOf<ApiError?>(null)
    /** Sube con cada suscripción creada: el campo se vacía. */
    var subscribed by mutableIntStateOf(0)
        private set
    var message by mutableStateOf<ApiError?>(null)
    var notice by mutableStateOf<Notice?>(null)
    /** Importación recién subida: se abre su asistente. */
    var opened by mutableStateOf<String?>(null)
    private var polling: Job? = null

    fun refresh() {
        viewModelScope.launch {
            apiCall { api.googleStatus() }.onSuccess { googleEnabled = it.enabled }.onFailure { googleEnabled = false }
            loadSync()
            loadSubscriptions()
            apiCall { api.imports() }.onSuccess { imports = it.imports }
            pollIfBusy()
        }
    }

    private suspend fun loadSync() {
        apiCall { api.googleSync() }.onSuccess { info ->
            sync = info
            if (info.connection?.status == "ok") {
                apiCall { api.googleAvailable() }.onSuccess { available = it.calendars }.onFailure { available = emptyList() }
            } else {
                available = null
            }
        }
    }

    private suspend fun loadSubscriptions() {
        apiCall { api.subscriptions() }.onSuccess { subscriptions = it.subscriptions }.onFailure { message = it.apiError }
    }

    /** Mientras se descarga un calendario o se lee una importación, se pregunta cada 2 s. */
    private fun pollIfBusy() {
        if (polling?.isActive == true) return
        polling = viewModelScope.launch {
            repeat(150) {
                val pending = sync?.calendars?.any { it.status == "pending" } == true ||
                    subscriptions?.any { it.status == "pending" } == true ||
                    imports.any { it.status == "analyzing" || it.status == "importing" }
                if (!pending) return@launch
                delay(2_000)
                loadSync()
                loadSubscriptions()
                apiCall { api.imports() }.onSuccess { imports = it.imports }
                graph.changes.calendarChanged()
            }
        }
    }

    /** Sube el fichero en streaming con su tamaño exacto, como los adjuntos y las copias. */
    fun upload(resolver: ContentResolver, uri: Uri) {
        val (name, size) = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) to cursor.getLong(1) else null
        } ?: return
        if (size <= 0) return
        if (size > MAX_UPLOAD_BYTES) {
            notice = Notice(R.string.imports_file_too_large)
            return
        }
        val type = resolver.getType(uri) ?: "application/octet-stream"
        val body = object : RequestBody() {
            override fun contentType(): MediaType? = type.toMediaTypeOrNull()
            override fun contentLength(): Long = size
            override fun writeTo(sink: BufferedSink) {
                resolver.openInputStream(uri)?.use { sink.writeAll(it.source()) } ?: throw IOException("Sin acceso al fichero")
            }
        }
        uploading = true
        viewModelScope.launch {
            apiCall { api.upload(Uri.encode(name ?: "calendario.ics"), body) }
                .onSuccess { opened = it.item.id }
                .onFailure { message = it.apiError }
            uploading = false
        }
    }

    fun subscribe(url: String) = act(onError = { subscribeError = it }) {
        val subscription = api.subscribe(SubscribeRequest(url.trim())).subscription
        subscribed++
        notice = Notice(R.string.sub_subscribed, subscription.name)
        loadSubscriptions()
    }

    fun syncSubscription(subscription: SubscriptionInfo) = act {
        val updated = api.syncSubscription(subscription.id).subscription
        subscriptions = subscriptions?.map { if (it.id == updated.id) updated else it }
    }

    fun unsubscribe(subscription: SubscriptionInfo) = act {
        api.unsubscribe(subscription.id)
        loadSubscriptions()
    }

    fun addSync(calendar: GoogleAccountCalendar, reminders: Boolean) = act {
        sync = api.addGoogleSync(AddGoogleSyncRequest(calendar.googleCalendarId, reminders))
        notice = Notice(R.string.sync_added)
        loadSync()
    }

    fun syncNow(calendar: GoogleSyncedCalendar) = act { sync = api.syncGoogleNow(calendar.id) }

    fun removeSync(calendar: GoogleSyncedCalendar) = act {
        api.removeGoogleSync(calendar.id)
        loadSync()
    }

    fun disconnect() = act {
        api.disconnectGoogle()
        notice = Notice(R.string.sync_disconnected)
        loadSync()
    }

    /** Cualquier cambio puede crear o borrar calendarios: el calendario se recarga. */
    private fun act(onError: (ApiError) -> Unit = { message = it }, block: suspend () -> Unit) {
        if (busy) return
        busy = true
        subscribeError = null
        viewModelScope.launch {
            apiCall { block() }.onFailure { onError(it.apiError) }
            graph.changes.calendarChanged()
            busy = false
            pollIfBusy()
        }
    }

    override fun onCleared() {
        polling?.cancel()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportsScreen(onBack: () -> Unit, onOpenImport: (String) -> Unit) {
    val vm = appViewModel { ImportsViewModel(it) }
    val snackbar = remember { SnackbarHostState() }
    val errorText = vm.message?.message()
    val noticeText = vm.notice?.let { n -> if (n.arg != null) stringResource(n.text, n.arg) else stringResource(n.text) }
    LaunchedEffect(vm.message, vm.notice) {
        (errorText ?: noticeText)?.let { snackbar.showSnackbar(it) }
        vm.message = null
        vm.notice = null
    }
    LaunchedEffect(vm.opened) {
        vm.opened?.let { id ->
            vm.opened = null
            onOpenImport(id)
        }
    }
    // Al volver de la web (conectar Google) o de otra pantalla, se pregunta de nuevo.
    LifecycleResumeEffect(Unit) {
        vm.refresh()
        onPauseOrDispose { }
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.imports_title)) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.action_back)) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        LazyVerticalGrid(
            columns = GridCells.Adaptive(340.dp),
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { FileTile(vm) }
            item { GoogleImportTile(vm) }
            item(span = { GridItemSpan(maxLineSpan) }) { GoogleSyncTile(vm) }
            item(span = { GridItemSpan(maxLineSpan) }) { SubscriptionsTile(vm) }
            if (vm.imports.isNotEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { RecentImportsTile(vm.imports, onOpenImport) }
        }
    }
}

@Composable
private fun TileColumn(content: @Composable () -> Unit) {
    Tile(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
    }
}

/** Abre una página de la web de Delyra (la del entorno actual) en el navegador. */
@Composable
private fun rememberOpenWeb(onFail: () -> Unit): (String) -> Unit {
    val context = LocalContext.current
    val graph = LocalAppGraph.current
    return { path -> if (!openInBrowser(context, graph.environment.origin + path)) onFail() }
}

@Composable
private fun FileTile(vm: ImportsViewModel) {
    val context = LocalContext.current
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.upload(context.contentResolver, uri)
    }
    TileColumn {
        TileTitle(stringResource(R.string.imports_file_title))
        Hint(stringResource(R.string.imports_file_intro))
        Button(
            onClick = { pick.launch(arrayOf("application/zip", "application/x-zip-compressed", "text/calendar", "application/octet-stream")) },
            enabled = !vm.uploading,
        ) {
            if (vm.uploading) CircularProgressIndicator(Modifier.padding(end = 8.dp).size(16.dp), strokeWidth = 2.dp)
            else Icon(Icons.Outlined.UploadFile, null, Modifier.padding(end = 8.dp).size(18.dp))
            Text(stringResource(R.string.imports_file_pick))
        }
    }
}

@Composable
private fun GoogleImportTile(vm: ImportsViewModel) {
    val openWeb = rememberOpenWeb { vm.notice = Notice(R.string.imports_no_browser) }
    TileColumn {
        TileTitle(stringResource(R.string.imports_account_title))
        Hint(stringResource(R.string.imports_account_intro))
        when (vm.googleEnabled) {
            null -> Unit
            false -> Text(stringResource(R.string.imports_google_unavailable), style = MaterialTheme.typography.bodyMedium)
            true -> {
                Hint(stringResource(R.string.imports_account_web))
                OutlinedButton(onClick = { openWeb("/importar#cuenta") }) {
                    Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, Modifier.padding(end = 8.dp).size(18.dp))
                    Text(stringResource(R.string.imports_connect_web))
                }
            }
        }
    }
}

@Composable
private fun statusLine(status: String, error: String?, events: Int, lastSyncedAt: String?): Pair<String, Boolean> = when (status) {
    "pending" -> stringResource(R.string.sync_syncing) to false
    "error" -> (error?.let { serverText(it) } ?: stringResource(R.string.wizard_failed)) to true
    else -> listOfNotNull(
        pluralStringResource(R.plurals.imports_count_events, events, events),
        lastSyncedAt?.let { stringResource(R.string.imports_updated, accountDateTime(it)) },
    ).joinToString(" · ") to false
}

@Composable
private fun SyncedRow(name: String, color: String, line: Pair<String, Boolean>, syncLabel: String, removeLabel: String, busy: Boolean, onSync: () -> Unit, onRemove: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        ColorDot(parseHexColor(color))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                line.first,
                style = MaterialTheme.typography.bodySmall,
                color = if (line.second) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(onClick = onSync, enabled = !busy) { Icon(Icons.Outlined.Refresh, syncLabel) }
        IconButton(onClick = onRemove, enabled = !busy) { Icon(Icons.Outlined.Delete, removeLabel) }
    }
}

@Composable
private fun GoogleSyncTile(vm: ImportsViewModel) {
    val info = vm.sync ?: return
    if (!info.enabled) return
    val openWeb = rememberOpenWeb { vm.notice = Notice(R.string.imports_no_browser) }
    var removing by remember { mutableStateOf<GoogleSyncedCalendar?>(null) }
    var disconnecting by remember { mutableStateOf(false) }
    TileColumn {
        TileTitle(stringResource(R.string.sync_title))
        Hint(stringResource(R.string.sync_intro))
        val connection = info.connection
        when {
            connection == null -> {
                Hint(stringResource(R.string.sync_permanent_note))
                Hint(stringResource(R.string.sync_web_note))
                Button(onClick = { openWeb("/importar#sincronizar") }) {
                    Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, Modifier.padding(end = 8.dp).size(18.dp))
                    Text(stringResource(R.string.sync_connect))
                }
            }
            connection.status == "revoked" -> {
                Text(stringResource(R.string.sync_revoked), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                OutlinedButton(onClick = { openWeb("/importar#sincronizar") }) { Text(stringResource(R.string.sync_reconnect)) }
            }
            else -> Text(
                stringResource(R.string.sync_connected_as, connection.email ?: stringResource(R.string.sync_your_account)),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        info.calendars.forEach { calendar ->
            SyncedRow(
                name = calendar.name,
                color = calendar.color,
                line = statusLine(calendar.status, calendar.error, calendar.events, calendar.lastSyncedAt),
                syncLabel = stringResource(R.string.sync_now),
                removeLabel = stringResource(R.string.sync_remove, calendar.name),
                busy = vm.busy || calendar.status == "pending" || connection?.status != "ok",
                onSync = { vm.syncNow(calendar) },
                onRemove = { removing = calendar },
            )
        }
        if (connection?.status == "ok") {
            AddSyncForm(vm)
            TextButton(onClick = { disconnecting = true }, enabled = !vm.busy) {
                Text(stringResource(R.string.sync_disconnect), color = MaterialTheme.colorScheme.error)
            }
        }
    }
    removing?.let { calendar ->
        ConfirmDialog(
            title = stringResource(R.string.sync_remove_title),
            text = stringResource(R.string.sync_remove_body, calendar.name),
            confirmLabel = stringResource(R.string.action_delete),
            destructive = true,
            onConfirm = { vm.removeSync(calendar) },
            onDismiss = { removing = null },
        )
    }
    if (disconnecting) {
        val n = info.calendars.size
        ConfirmDialog(
            title = stringResource(R.string.sync_disconnect),
            text = if (n == 0) stringResource(R.string.sync_disconnect_body_none) else pluralStringResource(R.plurals.sync_disconnect_body, n, n),
            confirmLabel = stringResource(R.string.sync_disconnect),
            destructive = true,
            onConfirm = vm::disconnect,
            onDismiss = { disconnecting = false },
        )
    }
}

@Composable
private fun AddSyncForm(vm: ImportsViewModel) {
    val options = vm.available?.filter { !it.synced }
    if (options == null) {
        Hint(stringResource(R.string.sync_loading))
        return
    }
    if (options.isEmpty()) {
        Hint(stringResource(R.string.sync_all_synced))
        return
    }
    var chosenId by rememberSaveable(options.map { it.googleCalendarId }) {
        mutableStateOf((options.firstOrNull { !it.suggestSkip } ?: options.first()).googleCalendarId)
    }
    var reminders by rememberSaveable { mutableStateOf(true) }
    var menu by remember { mutableStateOf(false) }
    val chosen = options.firstOrNull { it.googleCalendarId == chosenId } ?: options.first()
    HorizontalDivider(Modifier.padding(vertical = 4.dp))
    Text(stringResource(R.string.sync_calendar), style = MaterialTheme.typography.labelLarge)
    Box {
        TextButton(onClick = { menu = true }) { Text(optionLabel(chosen), maxLines = 1, overflow = TextOverflow.Ellipsis) }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            options.forEach { option ->
                DropdownMenuItem(text = { Text(optionLabel(option)) }, onClick = { menu = false; chosenId = option.googleCalendarId })
            }
        }
    }
    Row(
        Modifier.fillMaxWidth().toggleable(reminders, role = Role.Switch) { reminders = it },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.sync_reminders), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Switch(checked = reminders, onCheckedChange = null)
    }
    Button(onClick = { vm.addSync(chosen, reminders) }, enabled = !vm.busy) { Text(stringResource(R.string.sync_add)) }
}

@Composable
private fun optionLabel(option: GoogleAccountCalendar): String =
    if (option.suggestSkip) stringResource(R.string.sync_not_recommended, option.name) else option.name

@Composable
private fun SubscriptionsTile(vm: ImportsViewModel) {
    var url by rememberSaveable { mutableStateOf("") }
    var removing by remember { mutableStateOf<SubscriptionInfo?>(null) }
    LaunchedEffect(vm.subscribed) { if (vm.subscribed > 0) url = "" }
    TileColumn {
        TileTitle(stringResource(R.string.sub_title))
        Hint(stringResource(R.string.sub_intro))
        vm.subscriptions.orEmpty().forEach { subscription ->
            SyncedRow(
                name = subscription.name,
                color = subscription.color,
                line = statusLine(subscription.status, subscription.error, subscription.events, subscription.lastSyncedAt).let { (text, error) ->
                    (if (error) text else "${subscription.urlHint} · $text") to error
                },
                syncLabel = stringResource(R.string.sub_sync, subscription.name),
                removeLabel = stringResource(R.string.sub_remove, subscription.name),
                busy = vm.busy || subscription.status == "pending",
                onSync = { vm.syncSubscription(subscription) },
                onRemove = { removing = subscription },
            )
        }
        OutlinedTextField(
            value = url,
            onValueChange = { url = it.take(1000); vm.subscribeError = null },
            label = { Text(stringResource(R.string.sub_address)) },
            placeholder = { Text("https://calendar.google.com/calendar/ical/…/basic.ics", maxLines = 1, overflow = TextOverflow.Ellipsis) },
            singleLine = true,
            isError = vm.subscribeError != null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
            modifier = Modifier.fillMaxWidth(),
        )
        ErrorText(vm.subscribeError)
        Button(onClick = { vm.subscribe(url) }, enabled = url.isNotBlank() && !vm.busy) { Text(stringResource(R.string.sub_subscribe)) }
    }
    removing?.let { subscription ->
        ConfirmDialog(
            title = stringResource(R.string.sub_remove_title),
            text = stringResource(R.string.sub_remove_body, subscription.name),
            confirmLabel = stringResource(R.string.action_delete),
            destructive = true,
            onConfirm = { vm.unsubscribe(subscription) },
            onDismiss = { removing = null },
        )
    }
}

@Composable
private fun RecentImportsTile(imports: List<ImportInfo>, onOpen: (String) -> Unit) {
    TileColumn {
        TileTitle(stringResource(R.string.recent_title))
        imports.forEachIndexed { index, item ->
            if (index > 0) HorizontalDivider()
            Column(Modifier.fillMaxWidth().clickable { onOpen(item.id) }.padding(vertical = 8.dp)) {
                Text(
                    if (item.source == "google") stringResource(R.string.recent_google) else item.filename ?: stringResource(R.string.recent_file),
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Hint("${importStatusLabel(item.status)} · ${accountDateTime(item.createdAt)}")
            }
        }
    }
}

@Composable
fun importStatusLabel(status: String): String = stringResource(
    when (status) {
        "analyzing" -> R.string.import_status_analyzing
        "ready" -> R.string.import_status_ready
        "importing" -> R.string.import_status_importing
        "succeeded" -> R.string.import_status_succeeded
        "failed" -> R.string.import_status_failed
        else -> R.string.import_status_expired
    },
)
