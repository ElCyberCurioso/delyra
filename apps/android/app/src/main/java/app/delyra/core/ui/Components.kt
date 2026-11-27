package app.delyra.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.delyra.R
import app.delyra.core.i18n.serverText
import app.delyra.core.network.ApiError
import app.delyra.core.network.apiError

// ── Colores ────────────────────────────────────────────────────────────────────

/** Paleta común de 18 colores con nombre (`packages/shared/src/colors.ts`). */
val PALETTE: List<Pair<String, String>> = listOf(
    "violet" to "#7c5cff", "indigo" to "#5b5bd6", "blue" to "#2f80ed", "sky" to "#0ea5e9",
    "teal" to "#00a3a3", "emerald" to "#10b981", "green" to "#27ae60", "lime" to "#84cc16",
    "yellow" to "#f2c94c", "amber" to "#f59e0b", "orange" to "#f2994a", "red" to "#eb5757",
    "crimson" to "#e11d48", "pink" to "#d6409f", "purple" to "#a855f7", "brown" to "#8d6e63",
    "slate" to "#64748b", "graphite" to "#374151",
)

/** Colores por defecto de las etiquetas (`LABEL_COLORS` de `schemas/kanban.ts`). */
val LABEL_COLORS = listOf("#eb5757", "#f2994a", "#f2c94c", "#27ae60", "#2f80ed", "#7c5cff", "#d6409f", "#8d6e63")

fun parseHexColor(hex: String?, fallback: Color = Color(0xFF007145)): Color {
    if (hex == null || !Regex("^#[0-9a-fA-F]{6}$").matches(hex)) return fallback
    return Color(0xFF000000 or hex.substring(1).toLong(16))
}

private fun channel(c: Float): Double = if (c <= 0.03928f) c / 12.92 else Math.pow((c + 0.055) / 1.055, 2.4)

private fun Color.relativeLuminance(): Double = 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)

/** Blanco o casi negro, el que más contraste tenga (WCAG 1.4.3), como `readableTextColor`. */
fun readableOn(background: Color): Color {
    val l = background.relativeLuminance()
    val onWhite = 1.05 / (l + 0.05)
    val onDark = (l + 0.05) / (Color(0xFF111827).relativeLuminance() + 0.05)
    return if (onWhite >= onDark) Color.White else Color(0xFF111827)
}

@Composable
fun ColorDot(color: Color, size: Dp = 12.dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).clip(CircleShape).background(color))
}

@Composable
fun ColorPicker(selected: String?, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        PALETTE.forEach { (name, hex) ->
            val isSelected = selected.equals(hex, ignoreCase = true)
            val color = parseHexColor(hex)
            Box(
                Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(color)
                    .border(if (isSelected) 3.dp else 0.dp, MaterialTheme.colorScheme.onSurface, CircleShape)
                    .clickable(role = Role.RadioButton) { onSelect(hex) }
                    .semantics {
                        contentDescription = name
                        this.selected = isSelected
                    },
                contentAlignment = Alignment.Center,
            ) {
                if (isSelected) Icon(Icons.Default.Check, null, tint = readableOn(color))
            }
        }
    }
}

// ── Errores ────────────────────────────────────────────────────────────────────

/** El mensaje para la persona; los textos de la API se traducen si la app está en inglés. */
@Composable
fun ApiError.message(): String = when (this) {
    ApiError.Network -> stringResource(R.string.error_network)
    is ApiError.Unauthorized -> detail?.let { serverText(it) } ?: stringResource(R.string.error_unauthorized)
    is ApiError.RateLimited -> detail?.let { serverText(it) }
        ?: retryAfterSeconds?.let { stringResource(R.string.error_rate_limited_wait, it) }
        ?: stringResource(R.string.error_rate_limited)
    is ApiError.Validation -> (detail ?: fields.values.firstOrNull())?.let { serverText(it) } ?: stringResource(R.string.error_validation)
    is ApiError.Http -> detail?.let { serverText(it) } ?: when (status) {
        403 -> stringResource(R.string.error_forbidden)
        404 -> stringResource(R.string.error_not_found)
        413 -> stringResource(R.string.error_too_large)
        in 500..599 -> stringResource(R.string.error_server)
        else -> stringResource(R.string.error_generic)
    }
    is ApiError.Unexpected -> stringResource(R.string.error_generic)
}

@Composable
fun Throwable.message(): String = apiError.message()

@Composable
fun ErrorText(error: ApiError?, modifier: Modifier = Modifier) {
    if (error == null) return
    Text(
        error.message(),
        modifier = modifier.semantics { },
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodyMedium,
    )
}

@Composable
fun LoadingBox(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

@Composable
fun ErrorState(error: ApiError, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            if (error == ApiError.Network) Icons.Outlined.CloudOff else Icons.Outlined.ErrorOutline,
            contentDescription = null,
            modifier = Modifier.size(48.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(16.dp))
        Text(error.message(), textAlign = TextAlign.Center, modifier = Modifier.widthIn(max = 420.dp))
        Spacer(Modifier.height(16.dp))
        OutlinedButton(onClick = onRetry) { Text(stringResource(R.string.action_retry)) }
    }
}

@Composable
fun EmptyState(title: String, body: String? = null, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Column(
        modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        if (body != null) {
            Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
        action?.invoke()
    }
}

// ── Diálogos ───────────────────────────────────────────────────────────────────

@Composable
fun ConfirmDialog(
    title: String,
    text: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = false,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = {
            TextButton(onClick = { onConfirm(); onDismiss() }) {
                Text(confirmLabel, color = if (destructive) MaterialTheme.colorScheme.error else Color.Unspecified)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

@Composable
fun TextInputDialog(
    title: String,
    label: String,
    initial: String = "",
    confirmLabel: String = stringResource(R.string.action_save),
    maxLength: Int = 300,
    singleLine: Boolean = true,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var value by rememberSaveable { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = value,
                onValueChange = { if (it.length <= maxLength) value = it },
                label = { Text(label) },
                singleLine = singleLine,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            Button(onClick = { onConfirm(value.trim()); onDismiss() }, enabled = value.isNotBlank()) { Text(confirmLabel) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

/** Mosaico a todo el ancho con su contenido en columna: el bloque de las pantallas de ajustes. */
@Composable
fun TileColumn(content: @Composable ColumnScope.() -> Unit) {
    Tile(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
    }
}

/** Mosaico (tile) de la web: tarjeta con esquinas de 20 dp y borde fino. */
@Composable
fun Tile(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    val shape = MaterialTheme.shapes.large
    val border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    if (onClick != null) {
        Surface(onClick = onClick, modifier = modifier, shape = shape, border = border, color = MaterialTheme.colorScheme.surfaceContainerLowest, tonalElevation = 0.dp, shadowElevation = 1.dp) { content() }
    } else {
        Surface(modifier = modifier, shape = shape, border = border, color = MaterialTheme.colorScheme.surfaceContainerLowest, shadowElevation = 1.dp) { content() }
    }
}
