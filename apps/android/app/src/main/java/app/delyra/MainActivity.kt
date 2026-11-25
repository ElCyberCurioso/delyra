package app.delyra

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import app.delyra.core.session.SessionState
import app.delyra.core.ui.DelyraTheme
import app.delyra.core.ui.LocalAppGraph
import app.delyra.navigation.AppLinks
import app.delyra.navigation.DelyraRoot

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val graph = (application as DelyraApp).graph
        // La marca se queda en pantalla mientras se comprueba la sesión (unos cientos de ms).
        installSplashScreen().setKeepOnScreenCondition { graph.session.state.value == SessionState.Loading }
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handleLink(intent)
        setContent {
            CompositionLocalProvider(LocalAppGraph provides graph) {
                DelyraTheme { DelyraRoot() }
            }
        }
    }

    // `singleTask`: un enlace con la app abierta llega aquí en vez de abrir otra copia.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLink(intent)
    }

    private fun handleLink(intent: Intent?) {
        val link = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.dataString ?: return
        if (AppLinks.kind(link) != null) (application as DelyraApp).graph.incomingLink.value = link
    }
}
