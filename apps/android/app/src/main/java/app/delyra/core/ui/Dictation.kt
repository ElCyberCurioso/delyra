package app.delyra.core.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext

enum class DictationError { Denied, NoSpeech, Failed }

/**
 * Dictado por voz (F8-07), como `use-dictation.ts` de la web: lo transcribe el servicio de voz del
 * sistema (en la mayoría de móviles, el de Google) y Delyra solo recibe el texto. El micrófono se
 * pide la primera vez que se pulsa y solo se usa mientras se escucha. Sin servicio de voz,
 * [supported] es `false` y no se muestra el botón.
 */
@Stable
class Dictation internal constructor(private val context: Context) {
    val supported: Boolean = SpeechRecognizer.isRecognitionAvailable(context)
    var listening by mutableStateOf(false)
        private set

    internal var onText: (String, Boolean) -> Unit = { _, _ -> }
    internal var onError: (DictationError) -> Unit = {}
    internal var requestPermission: () -> Unit = {}
    internal var languageTag: String = "es-ES"
    private var recognizer: SpeechRecognizer? = null

    fun start() {
        if (!supported || recognizer != null) return
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermission()
            return
        }
        begin()
    }

    fun stop() {
        recognizer?.stopListening()
    }

    internal fun begin() {
        val speech = runCatching { SpeechRecognizer.createSpeechRecognizer(context) }.getOrNull() ?: run {
            onError(DictationError.Failed)
            return
        }
        recognizer = speech
        speech.setRecognitionListener(object : RecognitionListener {
            override fun onPartialResults(partialResults: Bundle?) = deliver(partialResults, final = false)
            override fun onResults(results: Bundle?) {
                deliver(results, final = true)
                finish()
            }
            override fun onError(error: Int) {
                when (error) {
                    // Se canceló (al cerrar o al parar antes de hablar): no es un error para la persona.
                    SpeechRecognizer.ERROR_CLIENT -> Unit
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> onError(DictationError.Denied)
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> onError(DictationError.NoSpeech)
                    else -> onError(DictationError.Failed)
                }
                finish()
            }
            override fun onReadyForSpeech(params: Bundle?) = Unit
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        listening = true
        runCatching { speech.startListening(intent) }.onFailure {
            finish()
            onError(DictationError.Failed)
        }
    }

    private fun deliver(bundle: Bundle?, final: Boolean) {
        val text = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
        if (text.isNotEmpty()) onText(text, final)
    }

    private fun finish() {
        recognizer?.destroy()
        recognizer = null
        listening = false
    }

    internal fun dispose() {
        recognizer?.cancel()
        finish()
    }
}

/**
 * @param languageTag idioma del reconocimiento (`es-ES`, `en-US`…), el de la app.
 * @param onText texto reconocido hasta ahora (`final` cuando ha terminado la frase).
 */
@Composable
fun rememberDictation(languageTag: String, onText: (String, Boolean) -> Unit, onError: (DictationError) -> Unit): Dictation {
    val context = LocalContext.current
    val dictation = remember(context) { Dictation(context) }
    val currentText by rememberUpdatedState(onText)
    val currentError by rememberUpdatedState(onError)
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) dictation.begin() else currentError(DictationError.Denied)
    }
    dictation.onText = { text, final -> currentText(text, final) }
    dictation.onError = { currentError(it) }
    dictation.requestPermission = { permission.launch(Manifest.permission.RECORD_AUDIO) }
    dictation.languageTag = languageTag
    // Al cerrar la pantalla (o cambiar de idioma) se deja de escuchar.
    DisposableEffect(dictation) { onDispose { dictation.dispose() } }
    return dictation
}
