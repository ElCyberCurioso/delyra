package app.delyra.core.session

import app.delyra.core.model.MeResponse
import app.delyra.core.model.User
import app.delyra.core.model.UserSettings
import app.delyra.core.network.ApiError
import app.delyra.core.network.SessionCookieJar
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import app.delyra.core.network.api.AuthApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.ZoneId

/** Estado de la sesión común a calendario y planificador (ADR-0004). */
sealed interface SessionState {
    data object Loading : SessionState

    /** Sin sesión (o caducada). */
    data class SignedOut(val expired: Boolean = false) : SessionState

    /** Contraseña correcta; falta el código (o la llave). */
    data class PendingSecondFactor(val passkey: Boolean) : SessionState

    /** Cuenta sin TOTP: solo puede darlo de alta. */
    data class PendingTotp(val user: User) : SessionState

    data class Active(val user: User, val settings: UserSettings) : SessionState {
        val zone: ZoneId get() = runCatching { ZoneId.of(settings.timeZone) }.getOrDefault(ZoneId.systemDefault())
    }

    /** No se pudo preguntar a la API al abrir (sin conexión): se ofrece reintentar. */
    data object Unreachable : SessionState
}

class SessionRepository(
    private val api: AuthApi,
    private val cookies: SessionCookieJar,
    private val scope: CoroutineScope,
    private val onSignedOut: suspend () -> Unit,
) {
    private val _state = MutableStateFlow<SessionState>(SessionState.Loading)
    val state: StateFlow<SessionState> = _state.asStateFlow()

    val active: SessionState.Active? get() = _state.value as? SessionState.Active

    /** Tras entrar con un código de recuperación: cuántos quedan (aviso al llegar a la app). */
    val recoveryCodesLeft = MutableStateFlow<Int?>(null)

    /** Al abrir la app: sin cookie no se pregunta (directo al login). */
    fun restore() {
        if (!cookies.hasSession()) {
            _state.value = SessionState.SignedOut()
            return
        }
        _state.value = SessionState.Loading
        scope.launch { refresh() }
    }

    suspend fun refresh(): SessionState {
        val next = apiCall { api.me() }.fold(
            onSuccess = ::fromMe,
            onFailure = {
                when (it.apiError) {
                    is ApiError.Unauthorized -> SessionState.SignedOut()
                    ApiError.Network -> SessionState.Unreachable
                    else -> SessionState.Unreachable
                }
            },
        )
        _state.value = next
        return next
    }

    /** La API respondió 401 a una petición normal: la sesión ya no vale. */
    fun expired() {
        if (_state.value is SessionState.Active) {
            scope.launch {
                cookies.clear()
                onSignedOut()
                _state.value = SessionState.SignedOut(expired = true)
            }
        }
    }

    fun updateSettings(settings: UserSettings) {
        (_state.value as? SessionState.Active)?.let { _state.value = it.copy(settings = settings) }
    }

    fun updateUser(user: User) {
        (_state.value as? SessionState.Active)?.let { _state.value = it.copy(user = user) }
    }

    suspend fun logout() {
        // Sin cookie no hay nada que revocar en la API (p. ej. al cambiar de entorno en debug).
        if (cookies.hasSession()) apiCall { api.logout() }
        cookies.clear()
        onSignedOut()
        _state.value = SessionState.SignedOut()
    }

    private fun fromMe(me: MeResponse): SessionState = when (me.state) {
        "active" -> {
            val user = me.user
            val settings = me.settings
            if (user != null && settings != null) SessionState.Active(user, settings) else SessionState.SignedOut()
        }
        "pending_2fa" -> SessionState.PendingSecondFactor(me.passkey == true)
        "pending_totp" -> me.user?.let { SessionState.PendingTotp(it) } ?: SessionState.SignedOut()
        else -> SessionState.SignedOut()
    }
}
