package app.delyra.core.ui

import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.window.core.layout.WindowSizeClass

/** Ancho disponible según las clases de tamaño de Material 3 (600 y 840 dp). */
enum class WidthClass { Compact, Medium, Expanded }

/**
 * Lo que las pantallas necesitan saber de la ventana. Se recalcula en cada cambio (giro, plegado,
 * multiventana, ventana de escritorio): nada depende de la orientación, solo del espacio.
 */
@Immutable
data class WindowLayout(
    val width: WidthClass,
    /** Alto < 480 dp: teléfono en horizontal o ventana baja. */
    val shortHeight: Boolean,
    /** Plegable medio abierto en horizontal (postura de mesa). */
    val tabletop: Boolean,
) {
    val isCompact: Boolean get() = width == WidthClass.Compact
    val isExpanded: Boolean get() = width == WidthClass.Expanded
    val atLeastMedium: Boolean get() = width != WidthClass.Compact
}

@Composable
fun rememberWindowLayout(): WindowLayout {
    val info = currentWindowAdaptiveInfoV2()
    val size = info.windowSizeClass
    val width = when {
        size.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_EXPANDED_LOWER_BOUND) -> WidthClass.Expanded
        size.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_MEDIUM_LOWER_BOUND) -> WidthClass.Medium
        else -> WidthClass.Compact
    }
    return WindowLayout(
        width = width,
        shortHeight = !size.isHeightAtLeastBreakpoint(WindowSizeClass.HEIGHT_DP_MEDIUM_LOWER_BOUND),
        tabletop = info.windowPosture.isTabletop,
    )
}
