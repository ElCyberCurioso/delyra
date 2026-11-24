package app.delyra.feature.kanban

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.automirrored.outlined.Notes
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.delyra.core.model.CardLabel
import app.delyra.core.model.CardSummary
import app.delyra.core.ui.parseHexColor
import java.time.ZoneId
import java.util.Locale

/**
 * Tarjeta en una columna: franja de su color, tipo, título, etiquetas y contadores. Tocar abre el
 * detalle; mantener pulsado abre «Mover a…» (o arrastra, en pantallas anchas). Para TalkBack, las
 * mismas acciones están como acciones personalizadas.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun CardItem(
    card: CardSummary,
    labels: List<CardLabel>,
    zone: ZoneId,
    locale: Locale,
    onClick: () -> Unit,
    onLongClick: (() -> Unit)?,
    accessibilityActions: List<CustomAccessibilityAction>,
    modifier: Modifier = Modifier,
) {
    val completed = card.completedAt != null
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.medium)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .semantics { customActions = accessibilityActions },
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        shadowElevation = 1.dp,
    ) {
        Row(Modifier.height(IntrinsicSize.Min)) {
            card.color?.let { Box(Modifier.width(5.dp).fillMaxHeight().background(parseHexColor(it))) }
            Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    KindBadge(card.kind)
                    if (card.priority != "none") {
                        Text(priorityLabel(card.priority), style = MaterialTheme.typography.labelSmall, color = priorityColor(card.priority))
                    }
                    if (completed) Icon(Icons.Outlined.CheckCircle, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                }
                Text(
                    card.title,
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis,
                    color = if (completed) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                )
                val cardLabels = labels.filter { it.id in card.labelIds }
                if (cardLabels.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        cardLabels.take(5).forEach { LabelPill(it.name, it.color) }
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    card.due?.let { due ->
                        val overdue = due.isOverdue(zone, completed)
                        Badge(Icons.Outlined.Schedule, dueLabel(due, zone, locale), if (overdue) MaterialTheme.colorScheme.error else null)
                    }
                    if (card.checklist.total > 0) {
                        val done = card.checklist.done == card.checklist.total
                        Badge(Icons.Outlined.Checklist, "${card.checklist.done}/${card.checklist.total}", if (done) MaterialTheme.colorScheme.primary else null)
                    }
                    if (card.comments > 0) Badge(Icons.Outlined.ChatBubbleOutline, card.comments.toString())
                    if (card.attachments > 0) Badge(Icons.Outlined.AttachFile, card.attachments.toString())
                    if (card.hasDescription) Badge(Icons.AutoMirrored.Outlined.Notes, null)
                    card.assignee?.let { Badge(AssigneeIcon, it) }
                }
            }
        }
    }
}

@Composable
private fun Badge(icon: ImageVector, text: String?, tint: Color? = null) {
    val color = tint ?: MaterialTheme.colorScheme.onSurfaceVariant
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        Icon(icon, null, Modifier.size(15.dp), tint = color)
        if (text != null) Text(text, style = MaterialTheme.typography.labelSmall, color = color, maxLines = 1)
    }
}
