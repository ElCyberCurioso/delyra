package app.delyra.core.i18n

import androidx.compose.runtime.Composable
import app.delyra.core.ui.LocalAppGraph
import app.delyra.feature.calendar.appLocale
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Mensajes de la API en inglés (F7-06 en la web). La API los escribe en español; la tabla
 * `assets/server-messages.en.json` se exporta desde `packages/ui/src/i18n/server-messages.en.ts`
 * (la prueba `server-messages.android.test.ts` falla si se queda atrás).
 *
 * Igual que `translateWith` de la web: primero la coincidencia exacta y, si el mensaje lleva datos,
 * el primer patrón que case, con sus grupos en la plantilla (`{1}`, `{2}`…).
 */
class ServerMessages(json: String) {
    @Serializable
    private data class Table(val exact: Map<String, String>, val patterns: List<Entry>)

    @Serializable
    private data class Entry(val pattern: String, val flags: String = "", val template: String, val parts: List<Int> = emptyList())

    private class Compiled(val regex: Regex, val template: String, val parts: Set<Int>)

    private val exact: Map<String, String>
    private val patterns: List<Compiled>

    init {
        val table = Json { ignoreUnknownKeys = true }.decodeFromString<Table>(json)
        exact = table.exact
        patterns = table.patterns.map { entry ->
            val options = buildSet {
                if ('s' in entry.flags) add(RegexOption.DOT_MATCHES_ALL)
                if ('i' in entry.flags) add(RegexOption.IGNORE_CASE)
            }
            Compiled(Regex(entry.pattern, options), entry.template, entry.parts.toSet())
        }
    }

    fun translate(text: String): String {
        exact[text]?.let { return it }
        for (pattern in patterns) {
            val match = pattern.regex.find(text) ?: continue
            return PLACEHOLDER.replace(pattern.template) { placeholder ->
                val group = placeholder.groupValues[1].toInt()
                val value = match.groups[group]?.value.orEmpty()
                if (group in pattern.parts) exact[value] ?: value else value
            }
        }
        return text
    }

    private companion object {
        val PLACEHOLDER = Regex("""\{(\d+)\}""")
    }
}

/** Un texto de la API en el idioma de la app: en inglés se traduce; en español llega tal cual. */
@Composable
fun serverText(text: String): String {
    if (appLocale().language != "en") return text
    return LocalAppGraph.current.serverMessages.translate(text)
}
