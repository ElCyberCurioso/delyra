package app.delyra.core.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.delyra.AppGraph

val LocalAppGraph = staticCompositionLocalOf<AppGraph> { error("Sin AppGraph") }

/** ViewModel con sus dependencias del [AppGraph] (inyección manual). */
@Composable
inline fun <reified VM : ViewModel> appViewModel(
    key: String? = null,
    crossinline create: (AppGraph) -> VM,
): VM {
    val graph = LocalAppGraph.current
    return viewModel(key = key, factory = viewModelFactory { initializer { create(graph) } })
}
