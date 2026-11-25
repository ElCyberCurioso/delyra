package app.delyra

import android.content.Context
import android.net.ConnectivityManager
import android.util.Base64
import app.delyra.core.config.AppPreferences
import app.delyra.core.config.Environment
import app.delyra.core.i18n.ServerMessages
import app.delyra.core.network.CookieCipher
import app.delyra.core.network.CookieStorage
import app.delyra.core.network.Network
import app.delyra.core.network.OfflineCache
import app.delyra.core.network.SessionCookieJar
import app.delyra.core.network.api.AccountApi
import app.delyra.core.network.api.AdminApi
import app.delyra.core.network.api.AuthApi
import app.delyra.core.network.api.CalendarApi
import app.delyra.core.network.api.IntegrationsApi
import app.delyra.core.network.api.BackupsApi
import app.delyra.core.network.api.KanbanApi
import app.delyra.core.security.KeystoreCipher
import app.delyra.core.session.DataChanges
import app.delyra.core.session.SessionRepository
import app.delyra.core.session.SessionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.io.File
import java.util.Locale

/**
 * Dependencias de la app, creadas una vez (sin Hilt: docs/plan-android.md). Los ViewModel las
 * reciben por constructor desde [app.delyra.core.ui.appViewModel].
 */
class AppGraph(private val context: Context) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val preferences = AppPreferences(context)

    /** Entorno actual; observable para que la pantalla de acceso se recargue al cambiarlo. */
    val environmentFlow = MutableStateFlow(runBlocking { preferences.environment() })
    val environment: Environment get() = environmentFlow.value

    private val cookieStorage = object : CookieStorage {
        override fun load(): String? = runBlocking { preferences.encryptedCookies() }
        override fun save(value: String?) = runBlocking { preferences.setEncryptedCookies(value) }
    }

    private val cookieCipher = object : CookieCipher {
        override fun seal(plain: String): String =
            Base64.encodeToString(KeystoreCipher.encrypt(plain.toByteArray()), Base64.NO_WRAP)

        override fun open(sealed: String): String? =
            runCatching { Base64.decode(sealed, Base64.NO_WRAP) }.getOrNull()
                ?.let(KeystoreCipher::decrypt)?.toString(Charsets.UTF_8)
    }

    val cookies = SessionCookieJar(cookieStorage, cookieCipher, allowInsecureLocalhost = BuildConfig.ALLOW_LOCAL)

    /**
     * Lecturas de agenda y tableros para usar la app sin conexión (F8-09). En `noBackupFilesDir` y
     * no en la caché: con poco espacio, Android vacía la carpeta de caché y la app dejaría de
     * abrir sin conexión. Tiene tope (20 MB), queda fuera de las copias y se vacía al salir.
     */
    val offlineCache = OfflineCache(File(context.noBackupFilesDir, "api-cache"))

    val network = Network(cookies, environment = { environment }, language = ::languageTag, offlineCache = offlineCache)

    val authApi: AuthApi = network.create()
    val accountApi: AccountApi = network.create()
    val calendarApi: CalendarApi = network.create()
    val kanbanApi: KanbanApi = network.create()
    val backupsApi: BackupsApi = network.create()
    val integrationsApi: IntegrationsApi = network.create()
    val adminApi: AdminApi = network.create()

    val session = SessionRepository(authApi, cookies, scope, onSignedOut = ::clearLocalData)
    val changes = DataChanges()

    /** Traducción de los mensajes de la API al inglés; se lee la primera vez que hace falta. */
    val serverMessages by lazy {
        ServerMessages(context.assets.open("server-messages.en.json").bufferedReader().use { it.readText() })
    }

    init {
        scope.launch { network.sessionExpired.collect { session.expired() } }
        // Si entra otra cuenta, nada de lo guardado sin conexión es suyo. (Al cerrar sesión ya se
        // vacía; esto cubre lo demás. La primera vez no hay nada de nadie: no se borra el `me`
        // recién guardado, que es lo que permite abrir la app sin conexión.)
        scope.launch {
            session.state.collect { state ->
                if (state !is SessionState.Active) return@collect
                val previous = preferences.lastUser()
                if (previous != state.user.id) {
                    if (previous != null) offlineCache.clear()
                    preferences.setLastUser(state.user.id)
                }
            }
        }
        watchConnectivity()
    }

    /** Al volver la red tras ver datos guardados, se recarga todo (y se reintenta la sesión). */
    private fun watchConnectivity() {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return
        runCatching {
            manager.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: android.net.Network) {
                    if (session.state.value is SessionState.Unreachable) {
                        scope.launch { session.refresh() }
                    } else if (offlineCache.offline.value) {
                        changes.calendarChanged()
                        changes.boardsChanged()
                    }
                }
            })
        }
    }

    /** Idioma de la app (el elegido por app en Android 13+ o el del sistema): `es` o `en`. */
    fun languageTag(): String {
        val locales = context.resources.configuration.locales
        val locale = if (locales.isEmpty) Locale.getDefault() else locales[0]
        return if (locale.language == "en") "en" else "es"
    }

    /** Solo en debug: cambiar a `pnpm dev` (o volver a producción) borra la sesión. */
    suspend fun switchEnvironment(target: Environment) {
        if (!BuildConfig.ALLOW_LOCAL || target == environment) return
        session.logout()
        preferences.setEnvironment(target)
        environmentFlow.value = target
        session.restore()
    }

    /** Al cerrar sesión no queda nada de la cuenta: descargas temporales incluidas. */
    private suspend fun clearLocalData() {
        File(context.cacheDir, "downloads").deleteRecursively()
        offlineCache.clear()
    }
}
