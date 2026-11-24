package app.delyra.core.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Gama «Bosque» (docs/diseno/plan-ui.md): esmeralda y lima sobre arena. Los valores salen de los
 * tokens OKLCH de `packages/ui/src/styles.css` convertidos a sRGB. Sin color dinámico: la marca
 * se mantiene en cualquier dispositivo.
 */
private val Light = lightColorScheme(
    primary = Color(0xFF007145),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFD7F4E0),
    onPrimaryContainer = Color(0xFF00391F),
    secondary = Color(0xFF4C5D4F),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFEFF2E7),
    onSecondaryContainer = Color(0xFF1B2A20),
    tertiary = Color(0xFF4F6B00),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFE2F2B5),
    onTertiaryContainer = Color(0xFF1A2600),
    background = Color(0xFFFAF9F4),
    onBackground = Color(0xFF0E1C14),
    surface = Color(0xFFFAF9F4),
    onSurface = Color(0xFF0E1C14),
    surfaceVariant = Color(0xFFF1F0E9),
    onSurfaceVariant = Color(0xFF4C5D4F),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF6F5EF),
    surfaceContainer = Color(0xFFF1F0E9),
    surfaceContainerHigh = Color(0xFFEBEAE2),
    surfaceContainerHighest = Color(0xFFE5E4DC),
    outline = Color(0xFF7A8A7D),
    outlineVariant = Color(0xFFDEDFD4),
    error = Color(0xFFD40C1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF5BD295),
    onPrimary = Color(0xFF03130B),
    primaryContainer = Color(0xFF143525),
    onPrimaryContainer = Color(0xFFB6F0CF),
    secondary = Color(0xFFA3B3A6),
    onSecondary = Color(0xFF0E1C14),
    secondaryContainer = Color(0xFF1C2721),
    onSecondaryContainer = Color(0xFFDCE7DE),
    tertiary = Color(0xFFB4D96A),
    onTertiary = Color(0xFF1A2600),
    tertiaryContainer = Color(0xFF2E3D0A),
    onTertiaryContainer = Color(0xFFE2F2B5),
    background = Color(0xFF070E0A),
    onBackground = Color(0xFFF3F6F4),
    surface = Color(0xFF070E0A),
    onSurface = Color(0xFFF3F6F4),
    surfaceVariant = Color(0xFF1A241F),
    onSurfaceVariant = Color(0xFFA3B3A6),
    surfaceContainerLowest = Color(0xFF040906),
    surfaceContainerLow = Color(0xFF0B140F),
    surfaceContainer = Color(0xFF0F1913),
    surfaceContainerHigh = Color(0xFF16211B),
    surfaceContainerHighest = Color(0xFF1C2721),
    outline = Color(0xFF5F6F63),
    outlineVariant = Color(0xFF26322B),
    error = Color(0xFFF4514F),
    onError = Color(0xFF2B0000),
    errorContainer = Color(0xFF5C0B0A),
    onErrorContainer = Color(0xFFFFDAD6),
)

/** Mosaicos de 1,25 rem como en la web. */
private val DelyraShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

private fun typography(): Typography {
    val base = Typography()
    return base.copy(
        displaySmall = base.displaySmall.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp),
        headlineLarge = base.headlineLarge.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp),
        headlineMedium = base.headlineMedium.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.4).sp),
        headlineSmall = base.headlineSmall.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.3).sp),
        titleLarge = base.titleLarge.copy(fontWeight = FontWeight.SemiBold),
        titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold),
    )
}

@Composable
fun DelyraTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (dark) Dark else Light,
        shapes = DelyraShapes,
        typography = typography(),
        content = content,
    )
}

val ColorScheme.isDark: Boolean get() = background.luminance() < 0.5f

private fun Color.luminance(): Float = 0.2126f * red + 0.7152f * green + 0.0722f * blue
