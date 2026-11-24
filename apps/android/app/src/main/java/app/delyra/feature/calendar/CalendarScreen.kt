package app.delyra.feature.calendar

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Today
import androidx.compose.material.icons.outlined.ViewAgenda
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.delyra.R
import app.delyra.core.session.SessionState
import app.delyra.core.ui.appViewModel
import app.delyra.core.ui.message
import app.delyra.core.ui.rememberWindowLayout
import app.delyra.navigation.EventEditorRoute
import kotlinx.coroutines.delay
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZonedDateTime

private const val PAGES = 2_000
private const val START_PAGE = PAGES / 2

@Composable
fun CalendarScreen(
    session: SessionState.Active,
    onCreateEvent: (EventEditorRoute) -> Unit,
    onOpenEvent: (EventEditorRoute) -> Unit,
    onSearch: () -> Unit,
    onOpenBoard: (String) -> Unit,
) {
    val vm = appViewModel { CalendarViewModel(it) }
    val layout = rememberWindowLayout()
    val narrow = layout.isCompact
    LaunchedEffect(narrow) { vm.resolveView(narrow) }
    val view = vm.view ?: return
    val locale = appLocale()
    val zone = vm.zone

    // Fecha base del deslizador: cambiarla (hoy, minicalendario) recrea el deslizador en ella.
    var base by rememberSaveable { mutableStateOf(vm.anchor.toString()) }
    var pagerKey by rememberSaveable { mutableIntStateOf(0) }
    val jumpTo: (LocalDate) -> Unit = { date ->
        vm.anchor = date
        base = date.toString()
        pagerKey += 1
    }
    var showCalendars by rememberSaveable { mutableStateOf(false) }
    var showQuickAdd by rememberSaveable { mutableStateOf(false) }
    var viewMenu by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val now by produceState(ZonedDateTime.now(zone), zone) {
        while (true) {
            delay(60_000)
            value = ZonedDateTime.now(zone)
        }
    }

    val error = vm.message
    val errorText = error?.message()
    val noticeText = vm.notice?.let { stringResource(it) } ?: vm.quickAdded?.let { stringResource(R.string.quick_added, it) }
    LaunchedEffect(error, vm.notice, vm.quickAdded) {
        val text = errorText ?: noticeText
        if (text != null) {
            snackbar.showSnackbar(text)
            vm.message = null
            vm.notice = null
            vm.quickAdded = null
        }
    }

    val newEventAt = { date: LocalDate, minutes: Int?, allDay: Boolean ->
        onCreateEvent(EventEditorRoute(date = date.toString(), minutes = minutes, allDay = allDay))
    }
    val range = view.range(vm.anchor, vm.weekStart)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(periodTitle(view, range, vm.anchor, locale), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                actions = {
                    IconButton(onClick = { jumpTo(vm.today) }) { Icon(Icons.Outlined.Today, stringResource(R.string.action_today)) }
                    Box {
                        IconButton(onClick = { viewMenu = true }) { Icon(Icons.Outlined.ViewAgenda, stringResource(R.string.calendar_view)) }
                        DropdownMenu(expanded = viewMenu, onDismissRequest = { viewMenu = false }) {
                            CalendarView.entries.filter { it.allowed(narrow) }.forEach { option ->
                                DropdownMenuItem(
                                    text = { Text(stringResource(option.label())) },
                                    leadingIcon = { if (option == view) Icon(Icons.Outlined.Check, null) },
                                    onClick = {
                                        viewMenu = false
                                        vm.selectView(option)
                                        jumpTo(vm.anchor)
                                    },
                                )
                            }
                        }
                    }
                    IconButton(onClick = { showQuickAdd = true }) { Icon(Icons.Outlined.AutoAwesome, stringResource(R.string.quick_add)) }
                    IconButton(onClick = onSearch) { Icon(Icons.Outlined.Search, stringResource(R.string.action_search)) }
                    if (!layout.isExpanded) {
                        IconButton(onClick = { showCalendars = true }) { Icon(Icons.Outlined.Layers, stringResource(R.string.calendar_calendars)) }
                    } else {
                        IconButton(onClick = vm::refresh) { Icon(Icons.Outlined.Refresh, stringResource(R.string.action_refresh)) }
                    }
                },
            )
        },
        floatingActionButton = {
            val start = if (vm.anchor == vm.today) nextHalfHour(now) else vm.anchor.atTime(9, 0).atZone(zone)
            if (layout.isCompact) {
                FloatingActionButton(onClick = { newEventAt(start.toLocalDate(), start.hour * 60 + start.minute, false) }) {
                    Icon(Icons.Default.Add, stringResource(R.string.calendar_new_event))
                }
            } else {
                ExtendedFloatingActionButton(
                    onClick = { newEventAt(start.toLocalDate(), start.hour * 60 + start.minute, false) },
                    icon = { Icon(Icons.Default.Add, null) },
                    text = { Text(stringResource(R.string.calendar_new_event)) },
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Row(Modifier.fillMaxSize().padding(padding)) {
            if (layout.isExpanded) {
                CalendarsPanel(
                    vm = vm,
                    selectedDate = vm.anchor,
                    onPickDate = jumpTo,
                    modifier = Modifier.width(300.dp).fillMaxHeight(),
                )
                VerticalDivider()
            }
            Column(Modifier.weight(1f).fillMaxHeight()) {
                val current = vm.data(range)
                if (current.loading) {
                    LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp))
                } else {
                    Spacer(Modifier.height(2.dp))
                }
                key(view, pagerKey) {
                    CalendarPages(
                        vm = vm,
                        view = view,
                        base = LocalDate.parse(base),
                        now = now,
                        hourHeight = when {
                            layout.shortHeight -> 44.dp
                            layout.isCompact -> 56.dp
                            else -> 64.dp
                        },
                        onItemClick = { vm.selected = it },
                        onSlotClick = { date, minutes -> newEventAt(date, minutes, false) },
                        onDayClick = { date ->
                            vm.selectView(if (narrow) CalendarView.Day else CalendarView.Day)
                            jumpTo(date)
                        },
                        onDayLongClick = { date -> newEventAt(date, null, true) },
                        onMonthClick = { month ->
                            vm.selectView(CalendarView.Month)
                            jumpTo(month)
                        },
                    )
                }
            }
            val selected = vm.selected
            if (layout.isExpanded && selected != null) {
                VerticalDivider()
                Surface(Modifier.width(360.dp).fillMaxHeight(), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                    EventDetail(
                        item = selected,
                        calendar = vm.calendars.firstOrNull { it.id == selected.occurrence?.calendarId },
                        onClose = { vm.selected = null },
                        onEdit = { onOpenEvent(it.editRoute()); vm.selected = null },
                        onDelete = vm::deleteOccurrence,
                        onOpenBoard = onOpenBoard,
                    )
                }
            }
        }
    }

    val selected = vm.selected
    if (!layout.isExpanded && selected != null) {
        ModalBottomSheet(onDismissRequest = { vm.selected = null }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)) {
            EventDetail(
                item = selected,
                calendar = vm.calendars.firstOrNull { it.id == selected.occurrence?.calendarId },
                onClose = { vm.selected = null },
                onEdit = { onOpenEvent(it.editRoute()); vm.selected = null },
                onDelete = vm::deleteOccurrence,
                onOpenBoard = onOpenBoard,
            )
        }
    }
    if (showQuickAdd) QuickAddSheet(vm, onMoreOptions = onCreateEvent, onDismiss = { showQuickAdd = false })
    if (showCalendars && !layout.isExpanded) {
        ModalBottomSheet(onDismissRequest = { showCalendars = false }) {
            CalendarsPanel(vm = vm, selectedDate = vm.anchor, onPickDate = { jumpTo(it); showCalendars = false })
        }
    }
}

/** Las páginas del deslizador (o la agenda continua). */
@Composable
private fun CalendarPages(
    vm: CalendarViewModel,
    view: CalendarView,
    base: LocalDate,
    now: ZonedDateTime,
    hourHeight: androidx.compose.ui.unit.Dp,
    onItemClick: (CalendarItem) -> Unit,
    onSlotClick: (LocalDate, Int) -> Unit,
    onDayClick: (LocalDate) -> Unit,
    onDayLongClick: (LocalDate) -> Unit,
    onMonthClick: (LocalDate) -> Unit,
) {
    val today = vm.today
    if (view == CalendarView.Agenda) {
        var chunks by rememberSaveable { mutableIntStateOf(1) }
        val ranges = (0 until chunks).map { CalendarView.Agenda.range(CalendarView.Agenda.shift(base, it), vm.weekStart) }
        ranges.forEach { r -> LaunchedEffect(r, vm.dataVersion) { vm.ensure(r) } }
        val data = ranges.map { vm.data(it) }
        val sections = ranges.flatMap { r ->
            val items = vm.data(r).items
            r.days.mapNotNull { d -> items.filter { it.overlaps(d) }.takeIf { it.isNotEmpty() }?.let { d to it } }
        }
        AgendaList(
            sections = sections,
            today = today,
            loading = data.any { it.loading },
            onItemClick = onItemClick,
            onEndReached = { if (data.none { it.loading } && chunks < 13) chunks++ },
        )
        return
    }
    val pager = rememberPagerState(initialPage = START_PAGE) { PAGES }
    LaunchedEffect(pager) {
        snapshotFlow { pager.settledPage }.collect { page -> vm.anchor = view.shift(base, page - START_PAGE) }
    }
    HorizontalPager(state = pager, beyondViewportPageCount = 1, key = { it }) { page ->
        val anchor = view.shift(base, page - START_PAGE)
        val range = view.range(anchor, vm.weekStart)
        LaunchedEffect(range, vm.dataVersion) { vm.ensure(range) }
        val items = vm.data(range).items
        when (view) {
            CalendarView.Day, CalendarView.ThreeDay, CalendarView.Week -> TimeGrid(
                days = range.days,
                items = items,
                today = today,
                now = now,
                hourHeight = hourHeight,
                onItemClick = onItemClick,
                onSlotClick = onSlotClick,
                onDayClick = onDayClick,
            )
            CalendarView.Month -> MonthGrid(
                month = YearMonth.from(anchor),
                range = range,
                items = items,
                today = today,
                weekStart = vm.weekStart,
                onDayClick = onDayClick,
                onDayLongClick = onDayLongClick,
                onItemClick = onItemClick,
            )
            CalendarView.Year -> YearGrid(
                year = anchor.year,
                items = items.filter { it.kind == ItemKind.Event },
                today = today,
                weekStart = vm.weekStart,
                onMonthClick = onMonthClick,
                onDayClick = onDayClick,
            )
            CalendarView.Agenda -> Unit
        }
    }
}

fun CalendarView.label(): Int = when (this) {
    CalendarView.Agenda -> R.string.view_agenda
    CalendarView.Day -> R.string.view_day
    CalendarView.ThreeDay -> R.string.view_three_days
    CalendarView.Week -> R.string.view_week
    CalendarView.Month -> R.string.view_month
    CalendarView.Year -> R.string.view_year
}

/** Ruta del editor para un elemento del calendario. */
fun CalendarItem.editRoute(): EventEditorRoute = occurrence?.editRoute() ?: EventEditorRoute()

/** Ruta del editor para una ocurrencia (con sus horas reales, por si es de una serie). */
fun app.delyra.core.model.Occurrence.editRoute() = EventEditorRoute(
    eventId = eventId,
    occurrenceStart = originalStart,
    start = start,
    end = end,
    recurring = recurring,
)
