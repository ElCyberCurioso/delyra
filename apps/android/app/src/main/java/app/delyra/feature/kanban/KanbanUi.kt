package app.delyra.feature.kanban

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AssignmentTurnedIn
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.automirrored.outlined.FactCheck
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.RocketLaunch
import androidx.compose.material.icons.automirrored.outlined.StickyNote2
import androidx.compose.material.icons.outlined.Work
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.delyra.R
import app.delyra.core.model.DueInfo
import app.delyra.feature.calendar.parseInstant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Tipos de tarjeta, prioridades, plantillas y fechas límite (como `kinds.tsx` y `logic.ts`). */

val CARD_KINDS = listOf("task", "meeting", "call", "email", "errand", "note")
val CARD_PRIORITIES = listOf("none", "low", "medium", "high", "urgent")
val BOARD_TEMPLATES = listOf("personal", "sprint", "audit", "empty")

fun kindIcon(kind: String): ImageVector = when (kind) {
    "meeting" -> Icons.Outlined.Groups
    "call" -> Icons.Outlined.Call
    "email" -> Icons.Outlined.Email
    "errand" -> Icons.Outlined.Work
    "note" -> Icons.AutoMirrored.Outlined.StickyNote2
    else -> Icons.Outlined.CheckBox
}

@Composable
fun kindLabel(kind: String): String = stringResource(
    when (kind) {
        "meeting" -> R.string.kind_meeting
        "call" -> R.string.kind_call
        "email" -> R.string.kind_email
        "errand" -> R.string.kind_errand
        "note" -> R.string.kind_note
        else -> R.string.kind_task
    },
)

/** Tono de cada tipo (texto legible sobre su fondo en claro y en oscuro). */
@Composable
fun kindColors(kind: String): Pair<Color, Color> {
    val dark = MaterialTheme.colorScheme.background.red < 0.5f
    val base = when (kind) {
        "meeting" -> Color(0xFF7C3AED)
        "call" -> Color(0xFF059669)
        "email" -> Color(0xFF0284C7)
        "errand" -> Color(0xFFD97706)
        "note" -> Color(0xFFE11D48)
        else -> Color(0xFF64748B)
    }
    val text = if (dark) lerp(base, Color.White, 0.55f) else lerp(base, Color.Black, 0.35f)
    return base.copy(alpha = 0.16f) to text
}

private fun lerp(a: Color, b: Color, t: Float) = Color(
    red = a.red + (b.red - a.red) * t,
    green = a.green + (b.green - a.green) * t,
    blue = a.blue + (b.blue - a.blue) * t,
)

@Composable
fun KindBadge(kind: String, modifier: Modifier = Modifier) {
    val (background, text) = kindColors(kind)
    Row(
        modifier.background(background, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(kindIcon(kind), null, Modifier.size(14.dp), tint = text)
        Text(kindLabel(kind), style = MaterialTheme.typography.labelSmall, color = text)
    }
}

@Composable
fun priorityLabel(priority: String): String = stringResource(
    when (priority) {
        "low" -> R.string.priority_low
        "medium" -> R.string.priority_medium
        "high" -> R.string.priority_high
        "urgent" -> R.string.priority_urgent
        else -> R.string.priority_none
    },
)

@Composable
fun priorityColor(priority: String): Color = when (priority) {
    "urgent" -> MaterialTheme.colorScheme.error
    "high" -> Color(0xFFEA580C)
    "medium" -> Color(0xFFCA8A04)
    "low" -> Color(0xFF2563EB)
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

@Composable
fun templateName(template: String): String = stringResource(
    when (template) {
        "sprint" -> R.string.template_sprint
        "audit" -> R.string.template_audit
        "empty" -> R.string.template_empty
        else -> R.string.template_personal
    },
)

@Composable
fun templateDescription(template: String): String = stringResource(
    when (template) {
        "sprint" -> R.string.template_sprint_body
        "audit" -> R.string.template_audit_body
        "empty" -> R.string.template_empty_body
        else -> R.string.template_personal_body
    },
)

fun templateIcon(template: String): ImageVector = when (template) {
    "sprint" -> Icons.Outlined.RocketLaunch
    "audit" -> Icons.AutoMirrored.Outlined.FactCheck
    "empty" -> Icons.Outlined.Dashboard
    else -> Icons.Outlined.AssignmentTurnedIn
}

val ArchiveIcon: ImageVector get() = Icons.Outlined.Inventory2
val AssigneeIcon: ImageVector get() = Icons.Outlined.Person

@Composable
fun roleLabel(role: String): String = stringResource(
    when (role) {
        "owner" -> R.string.role_owner
        "editor" -> R.string.role_editor
        else -> R.string.role_reader
    },
)

/** Fecha (en la zona de la cuenta) en la que vence. */
fun DueInfo.date(zone: ZoneId): LocalDate =
    if (allDay) LocalDate.parse(at.take(10)) else parseInstant(at).atZone(zone).toLocalDate()

fun DueInfo.isOverdue(zone: ZoneId, completed: Boolean): Boolean {
    if (completed) return false
    return if (allDay) date(zone) < LocalDate.now(zone) else parseInstant(at).isBefore(java.time.Instant.now())
}

/** «Hoy», «Mañana 17:00», «12 nov»… */
@Composable
fun dueLabel(due: DueInfo, zone: ZoneId, locale: Locale): String {
    val date = due.date(zone)
    val today = LocalDate.now(zone)
    val day = when (date) {
        today -> stringResource(R.string.due_today)
        today.plusDays(1) -> stringResource(R.string.due_tomorrow)
        today.minusDays(1) -> stringResource(R.string.due_yesterday)
        else -> date.format(DateTimeFormatter.ofPattern(if (date.year == today.year) "d MMM" else "d MMM yyyy", locale))
    }
    if (due.allDay) return day
    val time = parseInstant(due.at).atZone(zone).toLocalTime().format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale))
    return "$day $time"
}
