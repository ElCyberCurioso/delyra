package app.delyra.feature.calendar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.delyra.R
import app.delyra.core.ui.ColorDot
import app.delyra.core.ui.DictationError
import app.delyra.core.ui.parseHexColor
import app.delyra.core.ui.rememberDictation
import app.delyra.navigation.EventEditorRoute
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private const val MAX_LENGTH = 200

/**
 * Alta rápida (F8-07), como `QuickAdd` de `toolbar-inputs.tsx`: se escribe o se dicta una frase,
 * se ve qué evento saldría y se añade al calendario personal o se abre el editor con todo puesto.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuickAddSheet(vm: CalendarViewModel, onMoreOptions: (EventEditorRoute) -> Unit, onDismiss: () -> Unit) {
    val locale = appLocale()
    val english = locale.language == "en"
    val zone = vm.zone
    var text by rememberSaveable { mutableStateOf("") }
    var dictationError by remember { mutableStateOf<DictationError?>(null) }
    val draft = remember(text, english, zone) { QuickAdd.parse(text, LocalDateTime.now(zone), english) }
    val calendar = vm.quickCalendar
    val dictation = rememberDictation(
        languageTag = speechLanguage(locale),
        onText = { spoken, _ ->
            text = spoken.take(MAX_LENGTH)
            dictationError = null
        },
        onError = { dictationError = it },
    )
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val add = { if (draft != null && calendar != null) vm.quickAdd(draft, calendar, onDismiss) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 24.dp).imePadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(stringResource(R.string.quick_add), style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            OutlinedTextField(
                value = text,
                onValueChange = {
                    text = it.take(MAX_LENGTH)
                    dictationError = null
                },
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
                placeholder = { Text(stringResource(R.string.quick_add_placeholder), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                leadingIcon = { Icon(Icons.Outlined.AutoAwesome, null) },
                trailingIcon = if (dictation.supported) {
                    {
                        if (dictation.listening) {
                            FilledIconButton(
                                onClick = dictation::stop,
                                colors = IconButtonDefaults.filledIconButtonColors(containerColor = MaterialTheme.colorScheme.error),
                            ) { Icon(Icons.Filled.Stop, stringResource(R.string.quick_add_stop)) }
                        } else {
                            IconButton(onClick = dictation::start) { Icon(Icons.Outlined.Mic, stringResource(R.string.quick_add_dictate)) }
                        }
                    }
                } else {
                    null
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { add() }),
            )
            val status = Modifier.semantics { liveRegion = LiveRegionMode.Polite }
            when {
                dictation.listening -> Hint(stringResource(R.string.quick_add_listening), status)
                dictationError != null -> Text(
                    stringResource(
                        when (dictationError) {
                            DictationError.Denied -> R.string.quick_add_mic_denied
                            DictationError.NoSpeech -> R.string.quick_add_no_speech
                            else -> R.string.quick_add_dictation_failed
                        },
                    ),
                    modifier = status,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
                text.isNotBlank() && draft != null && calendar == null && vm.calendars.isNotEmpty() ->
                    Text(stringResource(R.string.quick_add_no_calendar), modifier = status, color = MaterialTheme.colorScheme.error)
                text.isNotBlank() && draft != null && calendar != null -> Surface(
                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                    shape = MaterialTheme.shapes.medium,
                    modifier = status.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(draft.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(draftWhen(draft, locale), style = MaterialTheme.typography.bodyMedium)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            ColorDot(parseHexColor(calendar.color))
                            Spacer(Modifier.width(8.dp))
                            Text(calendar.name, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                            TextButton(onClick = {
                                onMoreOptions(draft.editorRoute(calendar.id))
                                onDismiss()
                            }) { Text(stringResource(R.string.quick_add_more)) }
                            Spacer(Modifier.width(8.dp))
                            Button(onClick = add, enabled = !vm.quickBusy) { Text(stringResource(R.string.quick_add_add)) }
                        }
                    }
                }
                text.trim().length > 3 -> Hint(stringResource(R.string.quick_add_hint), status)
            }
        }
    }
}

@Composable
private fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun draftWhen(draft: QuickDraft, locale: Locale): String {
    val day = longDate(draft.date, locale)
    val start = draft.startTime ?: return "$day · ${stringResource(R.string.calendar_all_day)}"
    val format = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale)
    return "$day · ${start.format(format)}–${draft.endTime?.format(format).orEmpty()}"
}

/** El editor con lo que se ha escrito, para añadir alertas, repetición, lugar… */
fun QuickDraft.editorRoute(calendarId: String): EventEditorRoute {
    val times = formTimes()
    return EventEditorRoute(
        date = date.toString(),
        minutes = if (allDay) null else times.startMinutes,
        endMinutes = if (allDay) null else times.endMinutes,
        allDay = allDay,
        title = title,
        calendarId = calendarId,
    )
}

/** Idioma del reconocimiento de voz con región (`es-ES`, `en-US`), como `intlLocale()` en la web. */
private fun speechLanguage(locale: Locale): String = when {
    locale.country.isNotEmpty() -> locale.toLanguageTag()
    locale.language == "en" -> "en-US"
    else -> "es-ES"
}
