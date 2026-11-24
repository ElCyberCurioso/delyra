package app.delyra.feature.settings

import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
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
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.viewModelScope
import app.delyra.AppGraph
import app.delyra.R
import app.delyra.core.model.TelegramStatus
import app.delyra.core.network.ApiError
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import app.delyra.core.ui.ConfirmDialog
import app.delyra.core.ui.ErrorText
import app.delyra.core.ui.Tile
import app.delyra.feature.calendar.TimePick
import app.delyra.feature.calendar.appLocale
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Telegram en Ajustes (F3-04, F3-09 en la web): vincular con el bot, resumen diario, horas de
 * silencio, mensaje de prueba y desvincular. Al vincular se abre `t.me` y la pantalla pregunta cada
 * 3 s (y al volver a la app) hasta que el bot confirma.
 */
class TelegramViewModel(private val graph: AppGraph) : ViewModel() {
    private val api = graph.accountApi
    var status by mutableStateOf<TelegramStatus?>(null)
        private set
    var loadError by mutableStateOf<ApiError?>(null)
        private set
    /** Enlace de vinculación abierto: mientras no sea `null` se espera al bot. */
    var linkUrl by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var message by mutableStateOf<ApiError?>(null)
    var notice by mutableStateOf<Int?>(null)
    private var polling: Job? = null

    fun load() {
        viewModelScope.launch {
            apiCall { api.telegram() }
                .onSuccess { apply(it) }
                .onFailure { if (status == null) loadError = it.apiError }
        }
    }

    private fun apply(next: TelegramStatus) {
        loadError = null
        status = next
        if (next.linked && linkUrl != null) {
            linkUrl = null
            polling?.cancel()
            notice = R.string.telegram_linked
        }
    }

    fun link(open: (String) -> Unit) {
        act {
            apiCall { api.telegramLink() }.onSuccess { link ->
                linkUrl = link.url
                open(link.url)
                startPolling()
            }
        }
    }

    /** El enlace caduca a los 10 minutos: no tiene sentido seguir preguntando después. */
    private fun startPolling() {
        polling?.cancel()
        polling = viewModelScope.launch {
            repeat(200) {
                delay(3_000)
                if (linkUrl == null) return@launch
                apiCall { api.telegram() }.onSuccess { apply(it) }
            }
            linkUrl = null
        }
    }

    fun cancelLink() {
        linkUrl = null
        polling?.cancel()
    }

    /** `null` desactiva el resumen o las horas de silencio. */
    fun savePreferences(digestTime: String?, quietStart: String?, quietEnd: String?) = act {
        apiCall {
            api.updateTelegram(buildJsonObject {
                put("digestTime", digestTime?.let(::JsonPrimitive) ?: JsonNull)
                put("quietStart", quietStart?.let(::JsonPrimitive) ?: JsonNull)
                put("quietEnd", quietEnd?.let(::JsonPrimitive) ?: JsonNull)
            })
        }.onSuccess { apply(it); notice = R.string.telegram_saved }
    }

    fun unmute() = act {
        apiCall { api.updateTelegram(buildJsonObject { put("muted", JsonPrimitive(false)) }) }
            .onSuccess { apply(it); notice = R.string.telegram_unmuted }
    }

    fun sendTest() = act {
        apiCall { api.telegramTest() }.onSuccess { notice = R.string.telegram_test_sent }
    }

    fun unlink() = act {
        apiCall { api.unlinkTelegram() }.onSuccess { notice = R.string.telegram_unlinked; load() }
    }

    private fun act(block: suspend () -> Result<*>) {
        if (busy) return
        busy = true
        viewModelScope.launch {
            block().onFailure { message = it.apiError }
            busy = false
        }
    }

    override fun onCleared() {
        polling?.cancel()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TelegramTile(vm: TelegramViewModel) {
    val context = LocalContext.current
    var noApp by remember { mutableStateOf(false) }
    var confirmUnlink by remember { mutableStateOf(false) }
    val open = { url: String ->
        noApp = false
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
        } catch (_: ActivityNotFoundException) {
            noApp = true
        }
    }
    // Al volver de Telegram se pregunta enseguida, sin esperar al siguiente intento.
    LifecycleResumeEffect(vm.linkUrl) {
        if (vm.linkUrl != null) vm.load()
        onPauseOrDispose { }
    }
    Tile(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TileTitle("Telegram")
            Hint(stringResource(R.string.telegram_intro))
            val status = vm.status
            when {
                status == null && vm.loadError != null -> {
                    ErrorText(vm.loadError)
                    OutlinedButton(onClick = vm::load) { Text(stringResource(R.string.action_retry)) }
                }
                status == null -> CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                !status.available -> Text(stringResource(R.string.telegram_unavailable), style = MaterialTheme.typography.bodyMedium)
                !status.linked -> {
                    val url = vm.linkUrl
                    if (url != null) {
                        Text(stringResource(R.string.telegram_waiting), style = MaterialTheme.typography.bodyMedium)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { open(url) }) { Text(stringResource(R.string.telegram_open_bot, status.botUsername.orEmpty())) }
                            TextButton(onClick = vm::cancelLink) { Text(stringResource(R.string.action_cancel)) }
                        }
                    } else {
                        Button(onClick = { vm.link(open) }, enabled = !vm.busy) { Text(stringResource(R.string.telegram_link)) }
                    }
                    if (noApp) Text(stringResource(R.string.telegram_no_app), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                else -> {
                    val bot = status.botUsername.orEmpty()
                    Text(
                        status.linkedAt?.let { stringResource(R.string.telegram_linked_since, bot, accountDateTime(it)) }
                            ?: stringResource(R.string.telegram_linked_with, bot),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    status.mutedUntil?.let { until ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(R.string.telegram_muted_until, accountDateTime(until)), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                            TextButton(onClick = vm::unmute, enabled = !vm.busy) { Text(stringResource(R.string.telegram_unmute)) }
                        }
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = vm::sendTest, enabled = !vm.busy) { Text(stringResource(R.string.telegram_send_test)) }
                        TextButton(onClick = { confirmUnlink = true }, enabled = !vm.busy) {
                            Text(stringResource(R.string.telegram_unlink), color = MaterialTheme.colorScheme.error)
                        }
                    }
                    HorizontalDivider(Modifier.padding(vertical = 4.dp))
                    TelegramPreferences(status, busy = vm.busy, onSave = vm::savePreferences)
                }
            }
        }
    }
    if (confirmUnlink) {
        ConfirmDialog(
            title = stringResource(R.string.telegram_unlink_title),
            text = stringResource(R.string.telegram_unlink_body),
            confirmLabel = stringResource(R.string.telegram_unlink),
            destructive = true,
            onConfirm = vm::unlink,
            onDismiss = { confirmUnlink = false },
        )
    }
}

@Composable
private fun TelegramPreferences(status: TelegramStatus, busy: Boolean, onSave: (String?, String?, String?) -> Unit) {
    // Se reinicia cuando cambia lo guardado (p. ej. tras guardar o desde otro dispositivo).
    val key = "${status.digestTime}-${status.quietStart}-${status.quietEnd}"
    var digest by rememberSaveable(key) { mutableStateOf(status.digestTime != null) }
    var digestTime by rememberSaveable(key) { mutableStateOf(status.digestTime ?: "08:00") }
    var quiet by rememberSaveable(key) { mutableStateOf(status.quietStart != null) }
    var quietStart by rememberSaveable(key) { mutableStateOf(status.quietStart ?: "22:00") }
    var quietEnd by rememberSaveable(key) { mutableStateOf(status.quietEnd ?: "08:00") }
    var picking by remember { mutableStateOf<String?>(null) }

    SwitchRow(stringResource(R.string.telegram_digest), digest) { digest = it }
    if (digest) TimeRow(stringResource(R.string.telegram_digest_time), digestTime) { picking = "digest" }
    SwitchRow(stringResource(R.string.telegram_quiet), quiet) { quiet = it }
    if (quiet) {
        TimeRow(stringResource(R.string.telegram_from), quietStart) { picking = "start" }
        TimeRow(stringResource(R.string.telegram_to), quietEnd) { picking = "end" }
    }
    Hint(stringResource(R.string.telegram_quiet_hint))
    val changed = (if (digest) digestTime else null) != status.digestTime ||
        (if (quiet) quietStart else null) != status.quietStart ||
        (if (quiet) quietEnd else null) != status.quietEnd
    Button(
        onClick = { onSave(digestTime.takeIf { digest }, quietStart.takeIf { quiet }, quietEnd.takeIf { quiet }) },
        enabled = changed && !busy,
    ) { Text(stringResource(R.string.telegram_save)) }

    picking?.let { which ->
        val current = when (which) {
            "digest" -> digestTime
            "start" -> quietStart
            else -> quietEnd
        }
        TimePick(minutesOf(current), onDismiss = { picking = null }) { minutes ->
            val value = hhmm(minutes)
            when (which) {
                "digest" -> digestTime = value
                "start" -> quietStart = value
                else -> quietEnd = value
            }
        }
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().toggleable(checked, role = Role.Switch, onValueChange = onChange).padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Switch(checked = checked, onCheckedChange = null)
    }
}

@Composable
private fun TimeRow(label: String, value: String, onClick: () -> Unit) {
    val locale = appLocale()
    val shown = runCatching { LocalTime.parse(value).format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale)) }.getOrDefault(value)
    Row(Modifier.fillMaxWidth().padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = onClick) { Text(shown) }
    }
}

internal fun minutesOf(hhmm: String): Int = runCatching { LocalTime.parse(hhmm).let { it.hour * 60 + it.minute } }.getOrDefault(8 * 60)

internal fun hhmm(minutes: Int): String = String.format(Locale.ROOT, "%02d:%02d", minutes / 60 % 24, minutes % 60)
