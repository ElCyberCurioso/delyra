package app.delyra

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import app.delyra.core.session.SessionState
import app.delyra.core.ui.DelyraTheme
import app.delyra.core.ui.LocalAppGraph
import app.delyra.navigation.DelyraRoot

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val graph = (application as DelyraApp).graph
        // La marca se queda en pantalla mientras se comprueba la sesión (unos cientos de ms).
        installSplashScreen().setKeepOnScreenCondition { graph.session.state.value == SessionState.Loading }
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            CompositionLocalProvider(LocalAppGraph provides graph) {
                DelyraTheme { DelyraRoot() }
            }
        }
    }
}
