package app.delyra.feature.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.delyra.R
import app.delyra.core.ui.parseHexColor
import app.delyra.core.ui.readableOn
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.roundToInt

private const val MAX_ALL_DAY = 3

/**
 * Vistas día, 3 días y semana: cabecera de días, fila de «todo el día» y rejilla de 24 horas con
 * los eventos repartidos en columnas cuando se solapan. Tocar un hueco crea un evento ahí.
 */
@Composable
fun TimeGrid(
    days: List<LocalDate>,
    items: List<CalendarItem>,
    today: LocalDate,
    now: ZonedDateTime,
    hourHeight: Dp,
    onItemClick: (CalendarItem) -> Unit,
    onSlotClick: (LocalDate, Int) -> Unit,
    onDayClick: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
) {
    val locale = appLocale()
    // En formato de 12 h («10:00 PM») hace falta más ancho que en 24 h («22:00»).
    val gutter = if (android.text.format.DateFormat.is24HourFormat(androidx.compose.ui.platform.LocalContext.current)) 48.dp else 68.dp
    val allDay = remember(items, days) { days.associateWith { d -> items.filter { it.allDay && it.overlaps(d) } } }
    val timed = remember(items, days) {
        days.associateWith { d -> layoutDay(items.mapNotNull { segmentFor(it, d) }) }
    }
    val scroll = rememberScrollState()
    val density = LocalDensity.current
    val hourPx = with(density) { hourHeight.toPx() }
    LaunchedEffect(days.first()) {
        val hour = if (today in days) (now.hour - 1).coerceAtLeast(0) else 7
        scroll.scrollTo((hour * hourPx).roundToInt())
    }
    val lineColor = MaterialTheme.colorScheme.outlineVariant

    Column(modifier.fillMaxSize()) {
        // Cabecera: día de la semana pequeño y número grande; hoy, en un círculo.
        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
            Box(Modifier.width(gutter))
            days.forEach { date ->
                DayHeader(date, date == today, locale, Modifier.weight(1f).clickable(role = Role.Button) { onDayClick(date) })
            }
        }
        if (allDay.values.any { it.isNotEmpty() }) {
            Row(Modifier.fillMaxWidth().heightIn(min = 28.dp)) {
                Text(
                    stringResource(R.string.calendar_all_day),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.width(gutter).padding(start = 4.dp, top = 4.dp),
                    maxLines = 2,
                )
                days.forEach { date ->
                    val list = allDay[date].orEmpty()
                    Column(Modifier.weight(1f).padding(horizontal = 1.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        list.take(MAX_ALL_DAY).forEach { ItemChip(it, locale, onItemClick) }
                        if (list.size > MAX_ALL_DAY) {
                            Text(
                                stringResource(R.string.calendar_more, list.size - MAX_ALL_DAY),
                                style = MaterialTheme.typography.labelSmall,
                                modifier = Modifier.clickable { onDayClick(date) }.padding(2.dp),
                            )
                        }
                    }
                }
            }
        }
        HorizontalDivider(color = lineColor)
        Box(Modifier.weight(1f).verticalScroll(scroll)) {
            Row(Modifier.fillMaxWidth().height(hourHeight * 24)) {
                HourGutter(hourHeight, locale, Modifier.width(gutter).fillMaxHeight())
                days.forEach { date ->
                    DayColumn(
                        date = date,
                        segments = timed[date].orEmpty(),
                        hourHeight = hourHeight,
                        now = now.takeIf { date == today },
                        locale = locale,
                        onItemClick = onItemClick,
                        onSlotClick = onSlotClick,
                        modifier = Modifier.weight(1f).fillMaxHeight(),
                    )
                }
            }
        }
    }
}

@Composable
private fun DayHeader(date: LocalDate, isToday: Boolean, locale: Locale, modifier: Modifier) {
    Column(modifier.semantics(mergeDescendants = true) { heading() }, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            weekdayShort(date, locale),
            style = MaterialTheme.typography.labelSmall,
            color = if (isToday) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Box(
            Modifier.size(34.dp).clip(CircleShape).background(if (isToday) MaterialTheme.colorScheme.primary else androidx.compose.ui.graphics.Color.Transparent),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                date.dayOfMonth.toString(),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = if (isToday) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
private fun HourGutter(hourHeight: Dp, locale: Locale, modifier: Modifier) {
    val format = remember(locale) { DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale) }
    Box(modifier) {
        for (hour in 1 until 24) {
            Text(
                LocalTime.of(hour, 0).format(format),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.offset(y = hourHeight * hour - 7.dp).padding(start = 4.dp),
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun DayColumn(
    date: LocalDate,
    segments: List<DaySegment>,
    hourHeight: Dp,
    now: ZonedDateTime?,
    locale: Locale,
    onItemClick: (CalendarItem) -> Unit,
    onSlotClick: (LocalDate, Int) -> Unit,
    modifier: Modifier,
) {
    val lineColor = MaterialTheme.colorScheme.outlineVariant
    val nowColor = MaterialTheme.colorScheme.error
    val density = LocalDensity.current
    val hourPx = with(density) { hourHeight.toPx() }
    val minHeight = with(density) { 22.dp.roundToPx() }
    Box(
        modifier
            .drawBehind {
                drawLine(lineColor, Offset(0f, 0f), Offset(0f, size.height), strokeWidth = 1f)
                for (hour in 1 until 24) {
                    val y = hour * hourPx
                    drawLine(lineColor, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
                }
            }
            .pointerInput(date, hourPx) {
                detectTapGestures { offset ->
                    val minutes = ((offset.y / hourPx) * 60).toInt().coerceIn(0, MINUTES_PER_DAY - 30)
                    onSlotClick(date, minutes / 30 * 30)
                }
            },
    ) {
        Layout(
            content = { segments.forEach { EventBlock(it, locale, onItemClick) } },
            modifier = Modifier.fillMaxSize(),
        ) { measurables, constraints ->
            val width = constraints.maxWidth
            val placeables = measurables.mapIndexed { index, measurable ->
                val segment = segments[index]
                val top = (segment.startMinute / 60f * hourPx).roundToInt()
                val height = ((segment.endMinute - segment.startMinute) / 60f * hourPx).roundToInt().coerceAtLeast(minHeight)
                val columnWidth = width / segment.columns
                val placeable = measurable.measure(
                    Constraints.fixed((columnWidth - 2).coerceAtLeast(1), (height - 1).coerceAtLeast(1)),
                )
                Triple(placeable, columnWidth * segment.column + 1, top)
            }
            layout(width, constraints.maxHeight) {
                placeables.forEach { (placeable, x, y) -> placeable.place(x, y) }
            }
        }
        if (now != null) {
            val y = (now.toLocalTime().toSecondOfDay() / 3600f) * hourPx
            Box(
                Modifier
                    .offset(y = with(density) { y.toDp() } - 1.dp)
                    .fillMaxWidth()
                    .height(2.dp)
                    .background(nowColor),
            )
        }
    }
}

@Composable
private fun EventBlock(segment: DaySegment, locale: Locale, onClick: (CalendarItem) -> Unit) {
    val item = segment.item
    val background = parseHexColor(item.colorHex)
    val foreground = readableOn(background)
    val time = timeRangeText(item, locale)
    val description = listOfNotNull(item.title, time).joinToString(", ")
    Column(
        Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(background)
            .clickable(role = Role.Button) { onClick(item) }
            .semantics(mergeDescendants = true) { contentDescription = description }
            .padding(horizontal = 4.dp, vertical = 2.dp),
    ) {
        Text(
            (if (item.kind == ItemKind.Task) "☐ " else "") + item.title,
            color = foreground,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            lineHeight = 14.sp,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
        if (time != null) {
            Text(time, color = foreground.copy(alpha = 0.9f), fontSize = 11.sp, lineHeight = 13.sp, maxLines = 1)
        }
    }
}

/** Fila compacta de un elemento de día completo (o de la vista mes). */
@Composable
fun ItemChip(item: CalendarItem, locale: Locale, onClick: (CalendarItem) -> Unit, small: Boolean = false) {
    val background = parseHexColor(item.colorHex)
    val foreground = readableOn(background)
    val prefix = when (item.kind) {
        ItemKind.Task -> if (item.task?.completed == true) "☑ " else "☐ "
        ItemKind.Event -> if (!item.allDay) item.start?.let { timeText(it, locale) + " " } ?: "" else ""
        ItemKind.Holiday -> ""
    }
    val title = item.title + (item.occurrence?.age?.let { " ($it)" } ?: "")
    Text(
        prefix + title,
        color = foreground,
        fontSize = if (small) 10.sp else 12.sp,
        lineHeight = if (small) 12.sp else 14.sp,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(4.dp))
            .background(background)
            .clickable(role = Role.Button) { onClick(item) }
            .padding(horizontal = 4.dp, vertical = 1.dp),
    )
}
