package app.delyra.navigation

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ViewKanban
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.ViewKanban
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffoldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import app.delyra.R
import app.delyra.core.network.ApiError
import app.delyra.core.session.SessionState
import app.delyra.core.ui.ErrorState
import app.delyra.core.ui.LoadingBox
import app.delyra.core.ui.LocalAppGraph
import app.delyra.feature.auth.AuthFlow
import app.delyra.feature.calendar.CalendarScreen
import app.delyra.feature.calendar.EventEditorScreen
import app.delyra.feature.calendar.EventSearchScreen
import app.delyra.feature.calendar.editRoute
import app.delyra.feature.kanban.BoardScreen
import app.delyra.feature.kanban.BoardsScreen
import app.delyra.feature.kanban.CardScreen
import app.delyra.feature.settings.SettingsScreen
import app.delyra.feature.admin.AdminScreen
import app.delyra.feature.imports.ImportWizardScreen
import app.delyra.feature.imports.ImportsScreen

/** Raíz: el estado de la sesión decide entre acceso y la app. */
@Composable
fun DelyraRoot() {
    val graph = LocalAppGraph.current
    val state by graph.session.state.collectAsStateWithLifecycle()
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when (val current = state) {
            SessionState.Loading -> LoadingBox()
            SessionState.Unreachable -> ErrorState(ApiError.Network, onRetry = graph.session::restore)
            is SessionState.Active -> MainNavigation(current)
            else -> AuthFlow(current)
        }
    }
}

/**
 * Navegación con sesión. Las pestañas viven en [HomeRoute]; tablero, tarjeta, editor y búsqueda
 * son pantallas completas encima (sin barra de navegación, más espacio en el móvil).
 */
@Composable
private fun MainNavigation(session: SessionState.Active) {
    val nav = rememberNavController()
    NavHost(nav, startDestination = HomeRoute) {
        composable<HomeRoute> { HomeShell(session, nav) }
        composable<BoardRoute> { entry ->
            val route = entry.toRoute<BoardRoute>()
            BoardScreen(
                boardId = route.boardId,
                onBack = { nav.popBackStack() },
                onOpenCard = { nav.navigate(CardRoute(it)) },
            )
        }
        composable<CardRoute> { entry ->
            CardScreen(cardId = entry.toRoute<CardRoute>().cardId, onBack = { nav.popBackStack() })
        }
        composable<EventEditorRoute> { entry ->
            EventEditorScreen(route = entry.toRoute(), onDone = { nav.popBackStack() })
        }
        composable<EventSearchRoute> {
            EventSearchScreen(
                onBack = { nav.popBackStack() },
                onOpen = { occurrence -> nav.navigate(occurrence.editRoute()) },
            )
        }
        composable<ImportsRoute> {
            ImportsScreen(onBack = { nav.popBackStack() }, onOpenImport = { nav.navigate(ImportRoute(it)) })
        }
        composable<ImportRoute> { entry ->
            ImportWizardScreen(
                importId = entry.toRoute<ImportRoute>().importId,
                onBack = { nav.popBackStack() },
                onViewCalendar = { nav.popBackStack(HomeRoute, inclusive = false) },
            )
        }
        composable<AdminRoute> { AdminScreen(onBack = { nav.popBackStack() }) }
    }
}

@Composable
private fun HomeShell(session: SessionState.Active, nav: NavHostController) {
    var tab by rememberSaveable { mutableStateOf(HomeTab.Calendar) }
    val graph = LocalAppGraph.current
    val codesLeft by graph.session.recoveryCodesLeft.collectAsStateWithLifecycle()
    codesLeft?.let { left ->
        AlertDialog(
            onDismissRequest = { graph.session.recoveryCodesLeft.value = null },
            title = { Text(stringResource(R.string.recovery_title)) },
            text = { Text(pluralStringResource(R.plurals.second_factor_remaining, left, left)) },
            confirmButton = { TextButton(onClick = { graph.session.recoveryCodesLeft.value = null }) { Text(stringResource(R.string.action_continue)) } },
        )
    }
    val layoutType = NavigationSuiteScaffoldDefaults.navigationSuiteType(currentWindowAdaptiveInfoV2())
    NavigationSuiteScaffold(
        layoutType = layoutType,
        navigationSuiteItems = {
            HomeTab.entries.forEach { item ->
                val selected = item == tab
                item(
                    selected = selected,
                    onClick = { tab = item },
                    icon = { Icon(item.icon(selected), contentDescription = null) },
                    label = { Text(stringResource(item.label())) },
                )
            }
        },
    ) {
        when (tab) {
            HomeTab.Calendar -> CalendarScreen(
                session = session,
                onCreateEvent = { nav.navigate(it) },
                onOpenEvent = { nav.navigate(it) },
                onSearch = { nav.navigate(EventSearchRoute) },
                onOpenBoard = { nav.navigate(BoardRoute(it)) },
                onImports = { nav.navigate(ImportsRoute) },
            )
            HomeTab.Tasks -> BoardsScreen(onOpenBoard = { nav.navigate(BoardRoute(it)) })
            HomeTab.Settings -> SettingsScreen(session, onAdmin = { nav.navigate(AdminRoute) })
        }
    }
}

private fun HomeTab.label(): Int = when (this) {
    HomeTab.Calendar -> R.string.tab_calendar
    HomeTab.Tasks -> R.string.tab_tasks
    HomeTab.Settings -> R.string.tab_settings
}

private fun HomeTab.icon(selected: Boolean) = when (this) {
    HomeTab.Calendar -> if (selected) Icons.Filled.CalendarMonth else Icons.Outlined.CalendarMonth
    HomeTab.Tasks -> if (selected) Icons.Filled.ViewKanban else Icons.Outlined.ViewKanban
    HomeTab.Settings -> if (selected) Icons.Filled.Settings else Icons.Outlined.Settings
}
