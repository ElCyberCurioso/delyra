package app.delyra.feature.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.delyra.R
import app.delyra.core.ui.parseHexColor
import java.time.LocalDate
import java.time.YearMonth
import java.util.Locale

/**
 * Vista de mes: 6 semanas de 7 días. En cada día caben tantos elementos como permita su alto
 * (se calcula con el espacio real, sea un teléfono o una tablet) y el resto se resume en «+n».
 */
@Composable
fun MonthGrid(
    month: YearMonth,
    range: DateRange,
    items: List<CalendarItem>,
    today: LocalDate,
    weekStart: Int,
    onDayClick: (LocalDate) -> Unit,
    onDayLongClick: (LocalDate) -> Unit,
    onItemClick: (CalendarItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    val locale = appLocale()
    val byDay = remember(items, range) { range.days.associateWith { d -> items.filter { it.overlaps(d) } } }
    val lineColor = MaterialTheme.colorScheme.outlineVariant
    Column(modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
            weekDays(weekStart).forEach { day ->
                Text(
                    weekdayNarrow(day, locale),
                    modifier = Modifier.weight(1f),
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val rowHeight = maxHeight / 6
            val chips = (((rowHeight - 26.dp) / 17.dp).toInt()).coerceIn(0, 6)
            val small = maxWidth / 7 < 70.dp
            Column(Modifier.fillMaxSize()) {
                range.days.chunked(7).forEach { week ->
                    Row(Modifier.weight(1f).fillMaxWidth()) {
                        week.forEach { date ->
                            val dayItems = byDay[date].orEmpty()
                            val inMonth = YearMonth.from(date) == month
                            val holiday = dayItems.firstOrNull { it.kind == ItemKind.Holiday }
                            Column(
                                Modifier
                                    .weight(1f)
                                    .fillMaxHeight()
                                    .border(0.5.dp, lineColor)
                                    .background(if (inMonth) Color.Transparent else MaterialTheme.colorScheme.surfaceContainerLow)
                                    .combinedClickable(
                                        role = Role.Button,
                                        onClick = { onDayClick(date) },
                                        onLongClick = { onDayLongClick(date) },
                                    )
                                    .semantics {
                                        contentDescription = longDate(date, locale) + ", " + dayItems.joinToString { it.title }
                                    }
                                    .padding(2.dp),
                                verticalArrangement = Arrangement.spacedBy(1.dp),
                            ) {
                                DayNumber(date, date == today, inMonth, holiday != null)
                                val visible = dayItems.filter { it.kind != ItemKind.Holiday || chips > 1 }
                                visible.take(chips).forEach { ItemChip(it, locale, onItemClick, small = small) }
                                val hidden = visible.size - chips
                                if (hidden > 0) {
                                    Text(
                                        if (chips == 0) "•".repeat(hidden.coerceAtMost(3)) else stringResource(R.string.calendar_more, hidden),
                                        style = MaterialTheme.typography.labelSmall,
                                        fontSize = 10.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.padding(horizontal = 2.dp),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DayNumber(date: LocalDate, isToday: Boolean, inMonth: Boolean, holiday: Boolean) {
    Box(
        Modifier.size(24.dp).clip(CircleShape).background(if (isToday) MaterialTheme.colorScheme.primary else Color.Transparent),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            date.dayOfMonth.toString(),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal,
            color = when {
                isToday -> MaterialTheme.colorScheme.onPrimary
                holiday -> MaterialTheme.colorScheme.error
                inMonth -> MaterialTheme.colorScheme.onSurface
                else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
            },
        )
    }
}

/** Vista de año: los 12 meses en una rejilla de tantas columnas como quepan. */
@Composable
fun YearGrid(
    year: Int,
    items: List<CalendarItem>,
    today: LocalDate,
    weekStart: Int,
    onMonthClick: (LocalDate) -> Unit,
    onDayClick: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
) {
    val busy = remember(items) {
        buildSet { items.forEach { item -> generateSequence(item.startDate) { it.plusDays(1) }.takeWhile { it < item.endDate }.take(400).forEach { add(it) } } }
    }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(168.dp),
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        items((1..12).toList()) { month ->
            val first = LocalDate.of(year, month, 1)
            MiniMonth(
                month = YearMonth.of(year, month),
                today = today,
                weekStart = weekStart,
                busyDays = busy,
                selected = null,
                onDayClick = onDayClick,
                onTitleClick = { onMonthClick(first) },
            )
        }
    }
}

/** Minicalendario: en el año, en el panel lateral y en las hojas de elegir fecha. */
@Composable
fun MiniMonth(
    month: YearMonth,
    today: LocalDate,
    weekStart: Int,
    busyDays: Set<LocalDate>,
    selected: LocalDate?,
    onDayClick: (LocalDate) -> Unit,
    onTitleClick: (() -> Unit)? = null,
    onPrevious: (() -> Unit)? = null,
    onNext: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val locale = appLocale()
    val start = month.atDay(1).startOfWeek(weekStart)
    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (onPrevious != null) monthTitle(month.atDay(1), locale) else monthName(month.atDay(1), locale),
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier
                    .weight(1f)
                    .then(if (onTitleClick != null) Modifier.clickable(role = Role.Button, onClick = onTitleClick) else Modifier)
                    .padding(vertical = 6.dp, horizontal = 4.dp),
            )
            if (onPrevious != null) {
                IconButton(onClick = onPrevious) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(R.string.calendar_previous)) }
            }
            if (onNext != null) {
                IconButton(onClick = onNext) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.calendar_next)) }
            }
        }
        Row(Modifier.fillMaxWidth()) {
            weekDays(weekStart).forEach {
                Text(
                    weekdayNarrow(it, locale), Modifier.weight(1f), textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        for (week in 0 until 6) {
            Row(Modifier.fillMaxWidth()) {
                for (day in 0 until 7) {
                    val date = start.plusDays((week * 7 + day).toLong())
                    val inMonth = YearMonth.from(date) == month
                    val isToday = date == today
                    val isSelected = date == selected
                    Box(
                        Modifier
                            .weight(1f)
                            .aspectRatio(1f)
                            .padding(1.dp)
                            .clip(CircleShape)
                            .background(
                                when {
                                    isToday -> MaterialTheme.colorScheme.primary
                                    isSelected -> MaterialTheme.colorScheme.primaryContainer
                                    else -> Color.Transparent
                                },
                            )
                            .clickable(enabled = inMonth, role = Role.Button) { onDayClick(date) },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (inMonth) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    date.dayOfMonth.toString(),
                                    fontSize = 11.sp,
                                    color = if (isToday) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                                )
                                if (date in busyDays) {
                                    Box(
                                        Modifier.size(3.dp).clip(CircleShape).background(
                                            if (isToday) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.primary,
                                        ),
                                    )
                                } else {
                                    Spacer(Modifier.height(3.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Agenda: los días con algo, uno detrás de otro; al llegar al final se pide el siguiente tramo. */
@Composable
fun AgendaList(
    sections: List<Pair<LocalDate, List<CalendarItem>>>,
    today: LocalDate,
    loading: Boolean,
    onItemClick: (CalendarItem) -> Unit,
    onEndReached: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val locale = appLocale()
    val state = androidx.compose.foundation.lazy.rememberLazyListState()
    val nearEnd = remember {
        androidx.compose.runtime.derivedStateOf {
            val last = state.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= state.layoutInfo.totalItemsCount - 3
        }
    }
    androidx.compose.runtime.LaunchedEffect(nearEnd.value, sections.size) { if (nearEnd.value) onEndReached() }
    androidx.compose.foundation.lazy.LazyColumn(
        modifier.fillMaxSize(),
        state = state,
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 96.dp),
    ) {
        if (sections.isEmpty() && !loading) {
            item { app.delyra.core.ui.EmptyState(stringResource(R.string.calendar_agenda_empty)) }
        }
        sections.forEach { (date, list) ->
            item(key = "h$date") {
                Text(
                    longDate(date, locale),
                    style = MaterialTheme.typography.titleSmall,
                    color = if (date == today) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(top = 16.dp, bottom = 6.dp),
                )
            }
            list.forEach { item ->
                item(key = "$date:${item.key}") { AgendaRow(item, date, locale, onItemClick) }
            }
        }
        if (loading) {
            item { Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { androidx.compose.material3.CircularProgressIndicator() } }
        }
    }
}

@Composable
fun AgendaRow(item: CalendarItem, date: LocalDate, locale: Locale, onClick: (CalendarItem) -> Unit) {
    val time = when {
        item.allDay -> stringResource(R.string.calendar_all_day)
        else -> timeRangeText(item, locale) ?: ""
    }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.medium)
            .clickable(role = Role.Button) { onClick(item) }
            .padding(vertical = 10.dp, horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(width = 4.dp, height = 36.dp).clip(CircleShape).background(parseHexColor(item.colorHex)))
        Text(time, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(width = 88.dp, height = 36.dp).padding(top = 8.dp))
        Column(Modifier.weight(1f)) {
            Text(
                item.title + (item.occurrence?.age?.let { " ($it)" } ?: ""),
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 2,
            )
            val sub = item.occurrence?.location ?: item.task?.boardName ?: if (item.kind == ItemKind.Holiday) stringResource(R.string.calendar_holiday) else null
            if (sub != null) Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
    }
}
