package app.delyra.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.delyra.AppGraph
import app.delyra.R
import app.delyra.core.model.AccountDeletionSummary
import app.delyra.core.model.ReauthRequest
import app.delyra.core.network.ApiError
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import app.delyra.core.ui.CodeField
import app.delyra.core.ui.ErrorText
import app.delyra.core.ui.PasswordField
import app.delyra.core.ui.Tile
import app.delyra.core.ui.appViewModel
import kotlinx.coroutines.launch

/**
 * Eliminar la cuenta (F8-12), como en la web: Google Play lo exige y es el derecho de supresión.
 * Se borra al momento con la contraseña y el código. Antes se avisa de los tableros compartidos,
 * que se borran también para los demás, y la única persona administradora no puede.
 */
class DeleteAccountViewModel(private val graph: AppGraph) : ViewModel() {
    var summary by mutableStateOf<AccountDeletionSummary?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<ApiError?>(null)

    fun load() {
        summary = null
        error = null
        viewModelScope.launch {
            apiCall { graph.accountApi.deletionSummary() }
                .onSuccess { summary = it }
                .onFailure { error = it.apiError }
        }
    }

    fun delete(password: String, code: String) {
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            apiCall { graph.accountApi.deleteAccount(ReauthRequest(password, code)) }
                // Como al cerrar sesión, pero el login dice que la cuenta ya no existe.
                .onSuccess { graph.session.accountDeleted() }
                .onFailure { error = it.apiError }
            busy = false
        }
    }
}

@Composable
internal fun DeleteAccountTile() {
    val vm = appViewModel { DeleteAccountViewModel(it) }
    var open by rememberSaveable { mutableStateOf(false) }
    Tile(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TileTitle(stringResource(R.string.delete_account_title))
            Hint(stringResource(R.string.delete_account_body))
            OutlinedButton(
                onClick = { open = true; vm.load() },
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) { Text(stringResource(R.string.delete_account_open)) }
        }
    }
    if (open) DeleteAccountDialog(vm) { if (!vm.busy) open = false }
}

@Composable
private fun DeleteAccountDialog(vm: DeleteAccountViewModel, onDismiss: () -> Unit) {
    var password by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var recovery by rememberSaveable { mutableStateOf(false) }
    // Si se gira la pantalla con el diálogo abierto, el resumen se vuelve a pedir.
    LaunchedEffect(Unit) { if (vm.summary == null && vm.error == null) vm.load() }
    val summary = vm.summary
    val canDelete = summary != null && !summary.lastAdmin
    val valid = canDelete && password.isNotEmpty() && (if (recovery) code.length >= 10 else code.length == 6)
    val submit = { if (valid) vm.delete(password, code) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.delete_account_dialog_title)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when {
                    summary == null && vm.error == null -> CircularProgressIndicator(Modifier.size(24.dp))
                    summary?.lastAdmin == true -> Text(stringResource(R.string.delete_account_last_admin))
                    summary != null -> {
                        if (summary.sharedBoards > 0) {
                            Text(
                                pluralStringResource(R.plurals.delete_account_shared_boards, summary.sharedBoards, summary.sharedBoards) + " " +
                                    pluralStringResource(R.plurals.delete_account_shared_people, summary.sharedWith, summary.sharedWith),
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                        Text(stringResource(R.string.delete_account_dialog_body), style = MaterialTheme.typography.bodyMedium)
                        Hint(stringResource(R.string.delete_account_backup_hint))
                        PasswordField(password, { password = it }, stringResource(R.string.field_current_password), Modifier.fillMaxWidth())
                        CodeField(
                            code,
                            { code = it },
                            stringResource(if (recovery) R.string.field_recovery_code else R.string.settings_current_code),
                            Modifier.fillMaxWidth(),
                            recovery = recovery,
                            onDone = submit,
                        )
                        TextButton(onClick = { recovery = !recovery; code = "" }) {
                            Text(stringResource(if (recovery) R.string.second_factor_use_totp else R.string.second_factor_use_recovery))
                        }
                    }
                }
                ErrorText(vm.error)
            }
        },
        confirmButton = {
            if (canDelete) {
                TextButton(
                    onClick = submit,
                    enabled = valid && !vm.busy,
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) {
                    if (vm.busy) CircularProgressIndicator(Modifier.padding(end = 8.dp).size(16.dp), strokeWidth = 2.dp)
                    Text(stringResource(R.string.delete_account_confirm))
                }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !vm.busy) { Text(stringResource(R.string.action_cancel)) } },
    )
}
