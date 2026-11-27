package app.delyra.feature.admin

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Share
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
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.delyra.AppGraph
import app.delyra.R
import app.delyra.core.i18n.serverText
import app.delyra.core.model.AdminInvitation
import app.delyra.core.model.AdminUser
import app.delyra.core.model.CreateInvitationRequest
import app.delyra.core.model.InvitationDelivery
import app.delyra.core.model.SystemBackupsResponse
import app.delyra.core.network.ApiError
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import app.delyra.core.ui.ConfirmDialog
import app.delyra.core.ui.EmailField
import app.delyra.core.ui.ErrorText
import app.delyra.core.ui.LocalAppGraph
import app.delyra.core.ui.TileColumn
import app.delyra.core.ui.appViewModel
import app.delyra.core.ui.copy
import app.delyra.core.ui.message
import app.delyra.feature.calendar.parseInstant
import app.delyra.feature.settings.Hint
import app.delyra.feature.settings.TileTitle
import app.delyra.feature.settings.accountDateTime
import app.delyra.feature.settings.formatSize
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant

private val EXPIRY_DAYS = listOf(1, 7, 30)

/** Una acción sobre una cuenta: la ruta de la API y los textos de su confirmación. */
enum class UserAction(val path: String, val title: Int, val body: Int, val confirm: Int, val destructive: Boolean) {
    Disable("disable", R.string.admin_disable_title, R.string.admin_disable_body, R.string.admin_disable, true),
    Enable("enable", R.string.admin_enable_title, R.string.admin_enable_body, R.string.admin_enable, false),
    Reset2fa("reset-2fa", R.string.admin_reset_2fa_title, R.string.admin_reset_2fa_body, R.string.admin_reset_2fa, true),
}

/** `accepted`, `revoked`, `expired` o `pending`, como `invitationStatus` de la web. */
fun invitationStatus(invitation: AdminInvitation, now: Instant): String = when {
    invitation.acceptedAt != null -> "accepted"
    invitation.revokedAt != null -> "revoked"
    runCatching { parseInstant(invitation.expiresAt).isBefore(now) }.getOrDefault(false) -> "expired"
    else -> "pending"
}

/**
 * Panel de administración (F1-13 y F6-06 en la web), solo para el rol `admin`: cuentas
 * (desactivar, reactivar, reiniciar el 2FA), invitaciones (crear, reenviar, revocar) y backups
 * del sistema. Todo queda en el historial de seguridad.
 */
class AdminViewModel(private val graph: AppGraph) : ViewModel() {
    private val api = graph.adminApi
    var users by mutableStateOf<List<AdminUser>?>(null)
        private set
    var invitations by mutableStateOf<List<AdminInvitation>?>(null)
        private set
    var backups by mutableStateOf<SystemBackupsResponse?>(null)
        private set
    /** El enlace recién creado o reenviado: solo se ve una vez. */
    var delivery by mutableStateOf<InvitationDelivery?>(null)
    var inviteError by mutableStateOf<ApiError?>(null)
    var message by mutableStateOf<ApiError?>(null)
    var notice by mutableStateOf<Int?>(null)
    var busy by mutableStateOf(false)
        private set

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            apiCall { api.users() }.onSuccess { users = it.users }.onFailure { message = it.apiError }
            apiCall { api.invitations() }.onSuccess { invitations = it.invitations }
            loadBackups()
        }
    }

    private suspend fun loadBackups() {
        apiCall { api.systemBackups() }.onSuccess { backups = it }
    }

    fun userAction(user: AdminUser, action: UserAction) = act(R.string.admin_done) {
        api.userAction(user.id, action.path)
        users = api.users().users
    }

    fun invite(email: String, role: String, days: Int) = act(onError = { inviteError = it }) {
        delivery = api.invite(CreateInvitationRequest(email.trim(), role, days))
        invitations = api.invitations().invitations
    }

    fun resend(invitation: AdminInvitation) = act {
        delivery = api.resend(invitation.id).copy(email = invitation.email)
        invitations = api.invitations().invitations
    }

    fun revoke(invitation: AdminInvitation) = act(R.string.admin_revoked) {
        api.revoke(invitation.id)
        invitations = api.invitations().invitations
    }

    /** El backup tarda: se pregunta cada 5 s mientras el último siga en marcha. */
    fun runBackup() = act(R.string.system_launched) {
        api.runSystemBackup()
        loadBackups()
        repeat(60) {
            if (backups?.runs?.firstOrNull()?.status != "running") return@act
            delay(5_000)
            loadBackups()
        }
    }

    private fun act(success: Int? = null, onError: (ApiError) -> Unit = { message = it }, block: suspend () -> Unit) {
        if (busy) return
        busy = true
        inviteError = null
        viewModelScope.launch {
            apiCall { block() }.onSuccess { success?.let { notice = it } }.onFailure { onError(it.apiError) }
            busy = false
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminScreen(onBack: () -> Unit) {
    val vm = appViewModel { AdminViewModel(it) }
    val snackbar = remember { SnackbarHostState() }
    val errorText = vm.message?.message()
    val noticeText = vm.notice?.let { stringResource(it) }
    LaunchedEffect(vm.message, vm.notice) {
        (errorText ?: noticeText)?.let { snackbar.showSnackbar(it) }
        vm.message = null
        vm.notice = null
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.admin_title)) },
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
            item(span = { GridItemSpan(maxLineSpan) }) { Hint(stringResource(R.string.admin_intro)) }
            item { InviteTile(vm) }
            item { SystemBackupsTile(vm) }
            item(span = { GridItemSpan(maxLineSpan) }) { InvitationsTile(vm) }
            item(span = { GridItemSpan(maxLineSpan) }) { UsersTile(vm) }
        }
    }
}

@Composable
private fun roleLabel(role: String) = stringResource(if (role == "admin") R.string.admin_role_admin else R.string.admin_role_member)

@Composable
private fun InviteTile(vm: AdminViewModel) {
    var email by rememberSaveable { mutableStateOf("") }
    var role by rememberSaveable { mutableStateOf("member") }
    var days by rememberSaveable { mutableIntStateOf(7) }
    var daysMenu by remember { mutableStateOf(false) }
    LaunchedEffect(vm.delivery) { if (vm.delivery != null) email = "" }
    TileColumn {
        TileTitle(stringResource(R.string.admin_invite_title))
        Hint(stringResource(R.string.admin_invite_intro))
        EmailField(email, { email = it; vm.inviteError = null }, Modifier.fillMaxWidth())
        Text(stringResource(R.string.admin_role), style = MaterialTheme.typography.labelLarge)
        Row {
            listOf("member", "admin").forEach { option ->
                Row(
                    Modifier.selectable(role == option, role = Role.RadioButton) { role = option }.padding(end = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = role == option, onClick = null)
                    Text(roleLabel(option), Modifier.padding(start = 4.dp))
                }
            }
        }
        Text(stringResource(R.string.admin_expires_in), style = MaterialTheme.typography.labelLarge)
        Box {
            TextButton(onClick = { daysMenu = true }) { Text(pluralStringResource(R.plurals.admin_days, days, days)) }
            DropdownMenu(expanded = daysMenu, onDismissRequest = { daysMenu = false }) {
                EXPIRY_DAYS.forEach { n ->
                    DropdownMenuItem(text = { Text(pluralStringResource(R.plurals.admin_days, n, n)) }, onClick = { daysMenu = false; days = n })
                }
            }
        }
        ErrorText(vm.inviteError)
        Button(onClick = { vm.invite(email, role, days) }, enabled = email.contains('@') && !vm.busy) { Text(stringResource(R.string.admin_invite)) }
        vm.delivery?.let { InvitationLink(it) }
    }
}

/** El enlace de la invitación, una sola vez: copiarlo o compartirlo por un canal privado. */
@Composable
private fun InvitationLink(delivery: InvitationDelivery) {
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var copied by remember(delivery.link) { mutableStateOf(false) }
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val email = delivery.email.orEmpty()
            Text(
                stringResource(if (delivery.emailed) R.string.admin_emailed else R.string.admin_not_emailed, email),
                style = MaterialTheme.typography.bodyMedium,
            )
            SelectionContainer { Text(delivery.link, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { scope.launch { clipboard.copy(delivery.link, sensitive = true); copied = true } }) {
                    Icon(Icons.Outlined.ContentCopy, null, Modifier.padding(end = 8.dp).size(18.dp))
                    Text(stringResource(if (copied) R.string.admin_link_copied else R.string.action_copy))
                }
                OutlinedButton(onClick = {
                    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, delivery.link), null))
                }) {
                    Icon(Icons.Outlined.Share, null, Modifier.padding(end = 8.dp).size(18.dp))
                    Text(stringResource(R.string.action_share))
                }
            }
            Hint(stringResource(R.string.admin_one_use))
        }
    }
}

@Composable
private fun InvitationsTile(vm: AdminViewModel) {
    var revoking by remember { mutableStateOf<AdminInvitation?>(null) }
    var all by rememberSaveable { mutableStateOf(false) }
    val now = remember { Instant.now() }
    TileColumn {
        TileTitle(stringResource(R.string.admin_invitations))
        val list = vm.invitations
        if (list != null && list.isEmpty()) Hint(stringResource(R.string.admin_no_invitations))
        val shown = if (all) list.orEmpty() else list.orEmpty().take(8)
        shown.forEachIndexed { index, invitation ->
            if (index > 0) HorizontalDivider()
            val status = invitationStatus(invitation, now)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(invitation.email, style = MaterialTheme.typography.bodyMedium)
                    Hint(
                        listOf(
                            roleLabel(invitation.role),
                            stringResource(
                                when (status) {
                                    "accepted" -> R.string.admin_status_accepted
                                    "revoked" -> R.string.admin_status_revoked
                                    "expired" -> R.string.admin_status_expired
                                    else -> R.string.admin_status_pending
                                },
                            ),
                            stringResource(R.string.admin_created_on, accountDateTime(invitation.createdAt)),
                        ).joinToString(" · "),
                    )
                }
                if (status == "pending" || status == "expired") {
                    TextButton(onClick = { vm.resend(invitation) }, enabled = !vm.busy) { Text(stringResource(R.string.admin_resend)) }
                }
                if (status == "pending") {
                    TextButton(onClick = { revoking = invitation }, enabled = !vm.busy) {
                        Text(stringResource(R.string.admin_revoke), color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
        if (list.orEmpty().size > 8) {
            TextButton(onClick = { all = !all }) {
                Text(stringResource(if (all) R.string.settings_activity_fewer else R.string.settings_activity_all))
            }
        }
    }
    revoking?.let { invitation ->
        ConfirmDialog(
            title = stringResource(R.string.admin_revoke_title),
            text = stringResource(R.string.admin_revoke_body, invitation.email),
            confirmLabel = stringResource(R.string.admin_revoke),
            destructive = true,
            onConfirm = { vm.revoke(invitation) },
            onDismiss = { revoking = null },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun UsersTile(vm: AdminViewModel) {
    val me = LocalAppGraph.current.session.active?.user?.id
    var pending by remember { mutableStateOf<Pair<AdminUser, UserAction>?>(null) }
    TileColumn {
        TileTitle(stringResource(R.string.admin_users))
        vm.users.orEmpty().forEachIndexed { index, user ->
            if (index > 0) HorizontalDivider()
            Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    user.name + if (user.id == me) " · " + stringResource(R.string.admin_you) else "",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Hint(user.email)
                Hint(
                    listOf(
                        roleLabel(user.role),
                        stringResource(if (user.status == "active") R.string.admin_active else R.string.admin_disabled),
                        stringResource(if (user.hasTotp) R.string.admin_has_2fa else R.string.admin_no_2fa),
                        user.lastLoginAt?.let { stringResource(R.string.admin_last_login, accountDateTime(it)) } ?: stringResource(R.string.admin_never_logged),
                    ).joinToString(" · "),
                )
                // Las acciones sobre la propia cuenta se hacen en Ajustes (la API las rechaza).
                if (user.id != me) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        val toggle = if (user.status == "active") UserAction.Disable else UserAction.Enable
                        OutlinedButton(onClick = { pending = user to toggle }, enabled = !vm.busy) { Text(stringResource(toggle.confirm)) }
                        if (user.hasTotp) {
                            TextButton(onClick = { pending = user to UserAction.Reset2fa }, enabled = !vm.busy) {
                                Text(stringResource(R.string.admin_reset_2fa), color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
            }
        }
    }
    pending?.let { (user, action) ->
        ConfirmDialog(
            title = stringResource(action.title) + " · " + user.name,
            text = stringResource(action.body),
            confirmLabel = stringResource(action.confirm),
            destructive = action.destructive,
            onConfirm = { vm.userAction(user, action) },
            onDismiss = { pending = null },
        )
    }
}

@Composable
private fun SystemBackupsTile(vm: AdminViewModel) {
    val data = vm.backups
    val last = data?.runs?.firstOrNull()
    TileColumn {
        TileTitle(stringResource(R.string.system_title))
        Hint(stringResource(R.string.system_intro))
        if (last == null) {
            if (data != null) Hint(stringResource(R.string.system_none))
        } else {
            val result = when (last.status) {
                "running" -> stringResource(R.string.system_running)
                "succeeded" -> stringResource(R.string.system_ok, formatSize(last.sizeBytes))
                else -> stringResource(R.string.system_failed, last.error?.let { serverText(it) } ?: stringResource(R.string.system_no_detail))
            }
            Text(
                stringResource(R.string.system_last, accountDateTime(last.startedAt)) + " · " + result +
                    if (last.trigger == "manual") stringResource(R.string.system_manual) else "",
                style = MaterialTheme.typography.bodyMedium,
                color = if (last.status == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
            )
        }
        val running = last?.status == "running"
        Button(onClick = vm::runBackup, enabled = data != null && !running && !vm.busy) {
            if (running) CircularProgressIndicator(Modifier.padding(end = 8.dp).size(16.dp), strokeWidth = 2.dp)
            Text(stringResource(R.string.system_run_now))
        }
        listOf(
            "daily" to R.string.system_tier_daily,
            "weekly" to R.string.system_tier_weekly,
            "monthly" to R.string.system_tier_monthly,
        ).forEach { (tier, label) ->
            val objects = data?.objects.orEmpty().filter { it.tier == tier }
            val newest = objects.maxByOrNull { it.uploadedAt }
            Hint(
                listOfNotNull(
                    "${stringResource(label)} · ${objects.size}",
                    newest?.let { "${accountDateTime(it.uploadedAt)} (${formatSize(it.sizeBytes)})" },
                ).joinToString(" · "),
            )
        }
    }
}
