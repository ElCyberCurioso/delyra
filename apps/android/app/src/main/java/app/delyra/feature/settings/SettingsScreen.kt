package app.delyra.feature.settings

import android.os.Build
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.delyra.AppGraph
import app.delyra.BuildConfig
import app.delyra.R
import app.delyra.core.config.Environment
import app.delyra.core.model.ActiveSession
import app.delyra.core.model.ChangePasswordRequest
import app.delyra.core.model.ProfileRequest
import app.delyra.core.model.SecurityOverview
import app.delyra.core.model.UserSettings
import app.delyra.core.network.ApiError
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import app.delyra.core.session.SessionState
import app.delyra.core.ui.ConfirmDialog
import app.delyra.core.ui.LocalAppGraph
import app.delyra.core.ui.PasswordField
import app.delyra.core.ui.TextInputDialog
import app.delyra.core.ui.Tile
import app.delyra.core.ui.appViewModel
import app.delyra.core.ui.message
import app.delyra.feature.calendar.appLocale
import app.delyra.feature.kanban.shortDateTime
import kotlinx.coroutines.launch
import java.time.DayOfWeek
import java.time.ZoneId
import java.time.format.TextStyle

/** Ajustes de cuenta (F8-06, primera parte): perfil, preferencias, contraseña y sesiones. */
class SettingsViewModel(private val graph: AppGraph) : ViewModel() {
    private val api = graph.accountApi
    var security by mutableStateOf<SecurityOverview?>(null)
        private set
    var sessions by mutableStateOf<List<ActiveSession>>(emptyList())
        private set
    var message by mutableStateOf<ApiError?>(null)
    var notice by mutableStateOf<Int?>(null)

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            apiCall { api.security() }.onSuccess { security = it }
            apiCall { api.sessions() }.onSuccess { sessions = it.sessions }.onFailure { message = it.apiError }
        }
    }

    fun rename(name: String) {
        viewModelScope.launch {
            apiCall { api.updateProfile(ProfileRequest(name)) }
                .onSuccess { r -> r.user?.let(graph.session::updateUser); notice = R.string.settings_saved }
                .onFailure { message = it.apiError }
        }
    }

    fun updateSettings(settings: UserSettings) {
        viewModelScope.launch {
            apiCall { api.updateSettings(settings) }
                .onSuccess { r ->
                    graph.session.updateSettings(r.settings ?: settings)
                    graph.changes.calendarChanged()
                    notice = R.string.settings_saved
                }
                .onFailure { message = it.apiError }
        }
    }

    fun changePassword(current: String, new: String) {
        viewModelScope.launch {
            apiCall { api.changePassword(ChangePasswordRequest(current, new)) }
                .onSuccess { notice = R.string.settings_password_changed; refresh() }
                .onFailure { message = it.apiError }
        }
    }

    fun revoke(session: ActiveSession) {
        viewModelScope.launch {
            apiCall { api.revokeSession(session.id) }.onSuccess { refresh() }.onFailure { message = it.apiError }
        }
    }

    fun revokeOthers() {
        viewModelScope.launch {
            apiCall { api.revokeOtherSessions() }.onSuccess { refresh() }.onFailure { message = it.apiError }
        }
    }

    fun logout() {
        viewModelScope.launch { graph.session.logout() }
    }

    fun switchEnvironment(target: Environment) {
        viewModelScope.launch { graph.switchEnvironment(target) }
    }
}

@Composable
fun SettingsScreen(session: SessionState.Active) {
    val vm = appViewModel { SettingsViewModel(it) }
    val snackbar = remember { SnackbarHostState() }
    val messageText = vm.message?.message()
    val noticeText = vm.notice?.let { stringResource(it) }
    LaunchedEffect(vm.message, vm.notice) {
        (messageText ?: noticeText)?.let { snackbar.showSnackbar(it) }
        vm.message = null
        vm.notice = null
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.tab_settings)) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        // Rejilla bento: una columna en el teléfono, dos o más en anchas.
        LazyVerticalGrid(
            columns = GridCells.Adaptive(340.dp),
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { ProfileTile(session, vm) }
            item { PreferencesTile(session, vm) }
            item { SecurityTile(vm) }
            item(span = { GridItemSpan(maxLineSpan) }) { SessionsTile(vm) }
            if (BuildConfig.ALLOW_LOCAL) item { EnvironmentTile(vm) }
            item { AboutTile(vm) }
        }
    }
}

@Composable
private fun TileTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
}

@Composable
private fun ProfileTile(session: SessionState.Active, vm: SettingsViewModel) {
    var editing by rememberSaveable { mutableStateOf(false) }
    Tile(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TileTitle(stringResource(R.string.settings_profile))
            Text(session.user.name, style = MaterialTheme.typography.headlineSmall)
            Text(session.user.email, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (session.user.isAdmin) Text(stringResource(R.string.settings_admin), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            OutlinedButton(onClick = { editing = true }) { Text(stringResource(R.string.settings_rename)) }
        }
    }
    if (editing) {
        TextInputDialog(
            title = stringResource(R.string.settings_rename),
            label = stringResource(R.string.field_name),
            initial = session.user.name,
            maxLength = 80,
            onConfirm = vm::rename,
            onDismiss = { editing = false },
        )
    }
}

@Composable
private fun PreferencesTile(session: SessionState.Active, vm: SettingsViewModel) {
    val locale = appLocale()
    val context = androidx.compose.ui.platform.LocalContext.current
    val settings = session.settings
    var pickZone by remember { mutableStateOf(false) }
    var weekMenu by remember { mutableStateOf(false) }
    Tile(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TileTitle(stringResource(R.string.settings_preferences))
            Text(stringResource(R.string.settings_time_zone), style = MaterialTheme.typography.labelLarge)
            TextButton(onClick = { pickZone = true }) { Text(settings.timeZone) }
            val device = ZoneId.systemDefault().id
            if (device != settings.timeZone) {
                TextButton(onClick = { vm.updateSettings(settings.copy(timeZone = device)) }) { Text(stringResource(R.string.settings_use_device_zone, device)) }
            }
            Text(stringResource(R.string.settings_week_start), style = MaterialTheme.typography.labelLarge)
            Box {
                TextButton(onClick = { weekMenu = true }) { Text(dayName(settings.weekStart, locale)) }
                DropdownMenu(expanded = weekMenu, onDismissRequest = { weekMenu = false }) {
                    listOf(1, 6, 0).forEach { day ->
                        DropdownMenuItem(text = { Text(dayName(day, locale)) }, onClick = { weekMenu = false; vm.updateSettings(settings.copy(weekStart = day)) })
                    }
                }
            }
            Text(stringResource(R.string.settings_language), style = MaterialTheme.typography.labelLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("es" to "Español", "en" to "English").forEach { (code, name) ->
                    Row(
                        Modifier.selectable(settings.locale == code, role = Role.RadioButton) {
                            vm.updateSettings(settings.copy(locale = code))
                            applyAppLanguage(context, code)
                        },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = settings.locale == code, onClick = null)
                        Text(name, Modifier.padding(start = 4.dp, end = 12.dp))
                    }
                }
            }
            Text(stringResource(R.string.settings_language_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    if (pickZone) ZoneDialog(settings.timeZone, onDismiss = { pickZone = false }) { vm.updateSettings(settings.copy(timeZone = it)) }
}

/** Idioma por app (Android 13+): la interfaz cambia sin tocar el idioma del sistema. */
private fun applyAppLanguage(context: android.content.Context, code: String) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.getSystemService(android.app.LocaleManager::class.java)?.applicationLocales = android.os.LocaleList.forLanguageTags(code)
    }
}

private fun dayName(weekStart: Int, locale: java.util.Locale): String {
    val day = if (weekStart == 0) DayOfWeek.SUNDAY else DayOfWeek.of(weekStart.coerceIn(1, 6))
    return day.getDisplayName(TextStyle.FULL_STANDALONE, locale).replaceFirstChar { it.titlecase(locale) }
}

@Composable
private fun ZoneDialog(current: String, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    val zones = remember { ZoneId.getAvailableZoneIds().filter { it.contains('/') && !it.startsWith("Etc/") }.sorted() }
    val shown = zones.filter { it.contains(query.trim(), ignoreCase = true) }.take(60)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.settings_time_zone)) },
        text = {
            Column {
                OutlinedTextField(query, { query = it.take(40) }, label = { Text(stringResource(R.string.action_search)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxWidth().padding(top = 8.dp).heightIn(max = 360.dp)) {
                    items(shown.size) { i ->
                        val zone = shown[i]
                        Text(
                            zone,
                            Modifier.fillMaxWidth().clickable { onPick(zone); onDismiss() }.padding(vertical = 10.dp),
                            color = if (zone == current) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) } },
    )
}

@Composable
private fun SecurityTile(vm: SettingsViewModel) {
    val locale = appLocale()
    val zone = LocalAppGraph.current.session.active?.zone ?: ZoneId.systemDefault()
    var changing by rememberSaveable { mutableStateOf(false) }
    val security = vm.security
    Tile(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TileTitle(stringResource(R.string.settings_security))
            if (security != null) {
                Text(androidx.compose.ui.res.pluralStringResource(R.plurals.settings_recovery_left, security.remainingRecoveryCodes, security.remainingRecoveryCodes), style = MaterialTheme.typography.bodyMedium)
                security.passwordChangedAt?.let {
                    Text(stringResource(R.string.settings_password_changed_at, shortDateTime(it, zone, locale)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(stringResource(R.string.settings_passkeys, security.passkeys), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            OutlinedButton(onClick = { changing = true }) { Text(stringResource(R.string.settings_change_password)) }
            Text(stringResource(R.string.settings_more_on_web), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    if (changing) PasswordDialog(onDismiss = { changing = false }, onSave = vm::changePassword)
}

@Composable
private fun PasswordDialog(onDismiss: () -> Unit, onSave: (String, String) -> Unit) {
    var current by rememberSaveable { mutableStateOf("") }
    var new by rememberSaveable { mutableStateOf("") }
    var repeat by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.settings_change_password)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                PasswordField(current, { current = it }, stringResource(R.string.field_current_password), Modifier.fillMaxWidth())
                PasswordField(new, { new = it }, stringResource(R.string.field_new_password), Modifier.fillMaxWidth(), newPassword = true, supporting = stringResource(R.string.password_rules))
                PasswordField(
                    repeat, { repeat = it }, stringResource(R.string.field_repeat_password), Modifier.fillMaxWidth(), newPassword = true,
                    error = if (repeat.isNotEmpty() && repeat != new) stringResource(R.string.password_mismatch) else null,
                )
                Text(stringResource(R.string.settings_password_effect), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(current, new); onDismiss() }, enabled = current.isNotEmpty() && new.length >= 12 && new == repeat) {
                Text(stringResource(R.string.action_save))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

@Composable
private fun SessionsTile(vm: SettingsViewModel) {
    val locale = appLocale()
    val zone = LocalAppGraph.current.session.active?.zone ?: ZoneId.systemDefault()
    var confirmOthers by remember { mutableStateOf(false) }
    Tile(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TileTitle(stringResource(R.string.settings_sessions))
            vm.sessions.forEachIndexed { index, s ->
                if (index > 0) HorizontalDivider()
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            (s.userAgent ?: stringResource(R.string.settings_unknown_device)) + if (s.current) " · " + stringResource(R.string.settings_this_device) else "",
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 2,
                        )
                        Text(
                            listOfNotNull(s.country, stringResource(R.string.settings_last_seen, shortDateTime(s.lastSeenAt, zone, locale))).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (!s.current) TextButton(onClick = { vm.revoke(s) }) { Text(stringResource(R.string.settings_close_session)) }
                }
            }
            if (vm.sessions.count { !it.current } > 0) {
                OutlinedButton(onClick = { confirmOthers = true }) { Text(stringResource(R.string.settings_close_others)) }
            }
        }
    }
    if (confirmOthers) {
        ConfirmDialog(
            title = stringResource(R.string.settings_close_others),
            text = stringResource(R.string.settings_close_others_body),
            confirmLabel = stringResource(R.string.settings_close_others),
            onConfirm = vm::revokeOthers,
            onDismiss = { confirmOthers = false },
        )
    }
}

@Composable
private fun EnvironmentTile(vm: SettingsViewModel) {
    val graph = LocalAppGraph.current
    val current by graph.environmentFlow.collectAsState()
    Tile(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TileTitle(stringResource(R.string.settings_environment))
            Environment.entries.forEach { env ->
                Row(
                    Modifier.fillMaxWidth().selectable(current == env, role = Role.RadioButton) { vm.switchEnvironment(env) },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = current == env, onClick = null)
                    Text(env.origin, Modifier.padding(start = 8.dp))
                }
            }
            Text(stringResource(R.string.settings_environment_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun AboutTile(vm: SettingsViewModel) {
    var confirm by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Tile(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TileTitle(stringResource(R.string.app_name))
            Text("${BuildConfig.VERSION_NAME} · Android ${Build.VERSION.RELEASE}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(onClick = { confirm = true }) { Text(stringResource(R.string.settings_logout)) }
        }
    }
    if (confirm) {
        ConfirmDialog(
            title = stringResource(R.string.settings_logout),
            text = stringResource(R.string.settings_logout_body),
            confirmLabel = stringResource(R.string.settings_logout),
            onConfirm = { scope.launch { vm.logout() } },
            onDismiss = { confirm = false },
        )
    }
}
