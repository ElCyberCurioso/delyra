package app.delyra.feature.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.delyra.AppGraph
import app.delyra.R
import app.delyra.core.model.ChangePasswordRequest
import app.delyra.core.model.CodeRequest
import app.delyra.core.model.Passkey
import app.delyra.core.model.ReauthRequest
import app.delyra.core.model.SecurityOverview
import app.delyra.core.model.TotpSetupResponse
import app.delyra.core.network.ApiError
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import app.delyra.core.ui.CodeField
import app.delyra.core.ui.ConfirmDialog
import app.delyra.core.ui.ErrorText
import app.delyra.core.ui.PasswordField
import app.delyra.core.ui.SecureScreen
import app.delyra.core.ui.Tile
import app.delyra.feature.auth.RecoveryCodesView
import app.delyra.feature.auth.TotpSecretBlock
import kotlinx.coroutines.launch

/** Para qué se confirma la identidad (contraseña y código) en Ajustes. */
enum class ReauthPurpose { RecoveryCodes, AuthenticatorApp }

/** Paso en curso de un cambio de seguridad. */
sealed interface SecurityFlow {
    data class Reauth(val purpose: ReauthPurpose) : SecurityFlow
    /** Códigos nuevos: se enseñan una sola vez. */
    data class NewCodes(val codes: List<String>) : SecurityFlow
    /** Semilla de la app nueva; la anterior vale hasta confirmar un código de la nueva. */
    data class NewApp(val setup: TotpSetupResponse) : SecurityFlow
}

/**
 * Seguridad de la cuenta (F8-06): contraseña, códigos de recuperación, cambio de app autenticadora
 * y llaves de acceso (listar y quitar; añadirlas llega con F8-10). Como en la web, los cambios del
 * segundo factor piden la contraseña y un código (`reauthenticate` en `routes/account.ts`).
 */
class SecurityViewModel(private val graph: AppGraph) : ViewModel() {
    private val api = graph.accountApi
    var security by mutableStateOf<SecurityOverview?>(null)
        private set
    var passkeys by mutableStateOf<List<Passkey>?>(null)
        private set
    var message by mutableStateOf<ApiError?>(null)
    var notice by mutableStateOf<Int?>(null)

    var flow by mutableStateOf<SecurityFlow?>(null)
        private set
    var flowBusy by mutableStateOf(false)
        private set
    var flowError by mutableStateOf<ApiError?>(null)
        private set

    /** Sube con cada cambio que deja rastro en el historial o cierra otras sesiones. */
    var revision by mutableIntStateOf(0)
        private set

    fun refresh() {
        viewModelScope.launch {
            apiCall { api.security() }.onSuccess { security = it }.onFailure { message = it.apiError }
            apiCall { api.passkeys() }.onSuccess { passkeys = it.passkeys }
        }
    }

    fun changePassword(current: String, new: String) {
        viewModelScope.launch {
            apiCall { api.changePassword(ChangePasswordRequest(current, new)) }
                .onSuccess { notice = R.string.settings_password_changed; revision++; refresh() }
                .onFailure { message = it.apiError }
        }
    }

    fun startReauth(purpose: ReauthPurpose) {
        flowError = null
        flow = SecurityFlow.Reauth(purpose)
    }

    fun reauth(password: String, code: String) {
        val purpose = (flow as? SecurityFlow.Reauth)?.purpose ?: return
        val request = ReauthRequest(password, code.trim())
        flowBusy = true
        flowError = null
        viewModelScope.launch {
            when (purpose) {
                ReauthPurpose.RecoveryCodes -> apiCall { api.regenerateRecoveryCodes(request) }
                    .onSuccess { flow = SecurityFlow.NewCodes(it.recoveryCodes) }
                ReauthPurpose.AuthenticatorApp -> apiCall { api.reconfigureTotp(request) }
                    .onSuccess { flow = SecurityFlow.NewApp(it) }
            }.onFailure { flowError = it.apiError }
            // Bien o mal (`reauth.failure`), el intento queda en el historial.
            revision++
            flowBusy = false
        }
    }

    fun confirmNewApp(code: String) {
        if (flow !is SecurityFlow.NewApp) return
        flowBusy = true
        flowError = null
        viewModelScope.launch {
            apiCall { api.confirmTotpReconfigure(CodeRequest(code)) }
                .onSuccess {
                    flow = null
                    notice = R.string.settings_app_changed
                    revision++
                    refresh()
                }
                .onFailure { flowError = it.apiError }
            flowBusy = false
        }
    }

    fun closeFlow() {
        flow = null
        flowError = null
        refresh()
    }

    fun removePasskey(passkey: Passkey) {
        viewModelScope.launch {
            apiCall { api.deletePasskey(passkey.id) }
                .onSuccess { notice = R.string.settings_passkey_removed; revision++; refresh() }
                .onFailure { message = it.apiError }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun SecurityTile(vm: SecurityViewModel) {
    var changingPassword by rememberSaveable { mutableStateOf(false) }
    var removing by remember { mutableStateOf<Passkey?>(null) }
    val security = vm.security
    Tile(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TileTitle(stringResource(R.string.settings_security))
            Hint(stringResource(R.string.settings_two_factor_hint))
            if (security != null) {
                security.totpConfirmedAt?.let { Text(stringResource(R.string.settings_totp_active_since, accountDateTime(it)), style = MaterialTheme.typography.bodyMedium) }
                val left = security.remainingRecoveryCodes
                Text(
                    if (left == 0) stringResource(R.string.settings_no_codes_left) else pluralStringResource(R.plurals.settings_recovery_left, left, left),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (left <= 2) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                )
                security.passwordChangedAt?.let { Hint(stringResource(R.string.settings_password_changed_at, accountDateTime(it))) }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                OutlinedButton(onClick = { changingPassword = true }) { Text(stringResource(R.string.settings_change_password)) }
                OutlinedButton(onClick = { vm.startReauth(ReauthPurpose.RecoveryCodes) }) { Text(stringResource(R.string.settings_regenerate_codes)) }
                OutlinedButton(onClick = { vm.startReauth(ReauthPurpose.AuthenticatorApp) }) { Text(stringResource(R.string.settings_change_app)) }
            }
            HorizontalDivider(Modifier.padding(vertical = 4.dp))
            Text(stringResource(R.string.settings_passkeys_title), style = MaterialTheme.typography.titleSmall)
            val passkeys = vm.passkeys
            when {
                passkeys == null -> Unit
                passkeys.isEmpty() -> Hint(stringResource(R.string.settings_passkeys_none))
                else -> passkeys.forEach { passkey -> PasskeyRow(passkey, onRemove = { removing = passkey }) }
            }
            Hint(stringResource(R.string.settings_passkeys_add_on_web))
        }
    }
    if (changingPassword) PasswordDialog(onDismiss = { changingPassword = false }, onSave = vm::changePassword)
    (vm.flow as? SecurityFlow.Reauth)?.let { ReauthDialog(vm, it.purpose) }
    removing?.let { passkey ->
        ConfirmDialog(
            title = stringResource(R.string.settings_passkey_remove_title),
            text = stringResource(R.string.settings_passkey_remove_body, passkey.name),
            confirmLabel = stringResource(R.string.settings_passkey_remove),
            destructive = true,
            onConfirm = { vm.removePasskey(passkey) },
            onDismiss = { removing = null },
        )
    }
}

@Composable
private fun PasskeyRow(passkey: Passkey, onRemove: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(
                passkey.name + if (passkey.backedUp) " · " + stringResource(R.string.settings_passkey_synced) else "",
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                stringResource(R.string.settings_passkey_created, accountDateTime(passkey.createdAt)) + " · " +
                    (passkey.lastUsedAt?.let { stringResource(R.string.settings_passkey_last_used, accountDateTime(it)) } ?: stringResource(R.string.settings_passkey_never_used)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(onClick = onRemove) {
            Icon(Icons.Outlined.Delete, stringResource(R.string.settings_passkey_remove_label, passkey.name))
        }
    }
}

/** Contraseña y código actual (de la app o de recuperación), como `ReauthForm` en la web. */
@Composable
private fun ReauthDialog(vm: SecurityViewModel, purpose: ReauthPurpose) {
    var password by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var recovery by rememberSaveable { mutableStateOf(false) }
    val valid = password.isNotEmpty() && if (recovery) code.length >= 10 else code.length == 6
    val submit = { if (valid && !vm.flowBusy) vm.reauth(password, code) }
    AlertDialog(
        onDismissRequest = { if (!vm.flowBusy) vm.closeFlow() },
        title = { Text(stringResource(if (purpose == ReauthPurpose.RecoveryCodes) R.string.settings_regenerate_codes else R.string.settings_change_app)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    stringResource(if (purpose == ReauthPurpose.RecoveryCodes) R.string.settings_regenerate_body else R.string.settings_change_app_confirm),
                    style = MaterialTheme.typography.bodyMedium,
                )
                PasswordField(password, { password = it }, stringResource(R.string.field_current_password), Modifier.fillMaxWidth())
                CodeField(
                    code,
                    { code = it },
                    stringResource(if (recovery) R.string.field_recovery_code else R.string.settings_current_code),
                    Modifier.fillMaxWidth(),
                    recovery = recovery,
                    onDone = submit,
                )
                Hint(stringResource(R.string.settings_current_code_hint))
                TextButton(onClick = { recovery = !recovery; code = "" }) {
                    Text(stringResource(if (recovery) R.string.second_factor_use_totp else R.string.second_factor_use_recovery))
                }
                ErrorText(vm.flowError)
            }
        },
        confirmButton = {
            TextButton(onClick = submit, enabled = valid && !vm.flowBusy) {
                if (vm.flowBusy) CircularProgressIndicator(Modifier.padding(end = 8.dp).size(16.dp), strokeWidth = 2.dp)
                Text(stringResource(R.string.action_continue))
            }
        },
        dismissButton = { TextButton(onClick = vm::closeFlow, enabled = !vm.flowBusy) { Text(stringResource(R.string.action_cancel)) } },
    )
}

/** Pantalla completa para lo que solo se ve una vez: los códigos nuevos o la semilla de la app nueva. */
@Composable
internal fun SecurityFlowScreen(vm: SecurityViewModel, flow: SecurityFlow, modifier: Modifier = Modifier) {
    SecureScreen()
    BackHandler(enabled = !vm.flowBusy) { vm.closeFlow() }
    Column(
        modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = 520.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when (flow) {
                is SecurityFlow.NewCodes -> RecoveryCodesView(
                    flow.codes,
                    onDone = vm::closeFlow,
                    title = stringResource(R.string.settings_new_codes_title),
                    subtitle = stringResource(R.string.settings_new_codes_body),
                )
                is SecurityFlow.NewApp -> NewAppSteps(vm, flow.setup)
                is SecurityFlow.Reauth -> Unit
            }
        }
    }
}

@Composable
private fun NewAppSteps(vm: SecurityViewModel, setup: TotpSetupResponse) {
    var code by rememberSaveable { mutableStateOf("") }
    val submit = { if (code.length == 6 && !vm.flowBusy) vm.confirmNewApp(code) }
    Text(stringResource(R.string.settings_change_app), style = MaterialTheme.typography.headlineSmall)
    Text(stringResource(R.string.settings_change_app_steps), style = MaterialTheme.typography.bodyMedium)
    TotpSecretBlock(setup)
    CodeField(code, { code = it }, stringResource(R.string.settings_new_app_code), Modifier.fillMaxWidth(), onDone = submit)
    ErrorText(vm.flowError)
    Button(onClick = submit, enabled = code.length == 6 && !vm.flowBusy, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.settings_use_new_app))
    }
    TextButton(onClick = vm::closeFlow, enabled = !vm.flowBusy, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.action_cancel)) }
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
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                PasswordField(current, { current = it }, stringResource(R.string.field_current_password), Modifier.fillMaxWidth())
                PasswordField(new, { new = it }, stringResource(R.string.field_new_password), Modifier.fillMaxWidth(), newPassword = true, supporting = stringResource(R.string.password_rules))
                PasswordField(
                    repeat, { repeat = it }, stringResource(R.string.field_repeat_password), Modifier.fillMaxWidth(), newPassword = true,
                    error = if (repeat.isNotEmpty() && repeat != new) stringResource(R.string.password_mismatch) else null,
                )
                Hint(stringResource(R.string.settings_password_effect))
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
