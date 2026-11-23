package app.delyra.feature.kanban

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp

/**
 * Markdown básico de las descripciones (la web usa markdown-it): títulos, listas, citas, negrita,
 * cursiva, código y enlaces http(s). Nada de HTML: el texto se pinta, nunca se interpreta.
 */
@Composable
fun MarkdownText(text: String, modifier: Modifier = Modifier) {
    val linkColor = MaterialTheme.colorScheme.primary
    val codeBackground = MaterialTheme.colorScheme.surfaceContainerHigh
    SelectionContainer(modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            text.lines().forEach { raw ->
                val line = raw.trimEnd()
                when {
                    line.isBlank() -> Unit
                    line.startsWith("### ") -> Text(inline(line.drop(4), linkColor, codeBackground), style = MaterialTheme.typography.titleSmall)
                    line.startsWith("## ") -> Text(inline(line.drop(3), linkColor, codeBackground), style = MaterialTheme.typography.titleMedium)
                    line.startsWith("# ") -> Text(inline(line.drop(2), linkColor, codeBackground), style = MaterialTheme.typography.titleLarge)
                    line.startsWith("> ") -> Text(
                        inline(line.drop(2), linkColor, codeBackground),
                        style = MaterialTheme.typography.bodyMedium.copy(fontStyle = FontStyle.Italic),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Regex("^\\s*[-*+] ").containsMatchIn(line) -> Text(
                        AnnotatedString("•  ") + inline(line.replaceFirst(Regex("^\\s*[-*+] "), ""), linkColor, codeBackground),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Regex("^\\s*\\d+[.)] ").containsMatchIn(line) -> Text(inline(line.trim(), linkColor, codeBackground), style = MaterialTheme.typography.bodyMedium)
                    else -> Text(inline(line, linkColor, codeBackground), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

private val INLINE = Regex("""\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`(.+?)`|\[([^\]]+)]\((https?://[^)\s]+)\)|(https?://\S+)""")

private fun inline(text: String, linkColor: Color, codeBackground: Color): AnnotatedString = buildAnnotatedString {
    var last = 0
    val links = TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline))
    for (match in INLINE.findAll(text)) {
        append(text.substring(last, match.range.first))
        val g = match.groupValues
        when {
            g[1].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(g[1]) }
            g[2].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(g[2]) }
            g[3].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(g[3]) }
            g[4].isNotEmpty() -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBackground)) { append(g[4]) }
            g[5].isNotEmpty() -> withLink(LinkAnnotation.Url(g[6], links)) { append(g[5]) }
            g[7].isNotEmpty() -> withLink(LinkAnnotation.Url(g[7], links)) { append(g[7]) }
        }
        last = match.range.last + 1
    }
    append(text.substring(last))
}
