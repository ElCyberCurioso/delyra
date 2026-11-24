package app.delyra.feature.auth

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.delyra.AppGraph
import app.delyra.core.model.CodeRequest
import app.delyra.core.model.ForgotPasswordRequest
import app.delyra.core.model.InvitationInfo
import app.delyra.core.model.LoginRequest
import app.delyra.core.model.RegisterRequest
import app.delyra.core.model.ResetPasswordRequest
import app.delyra.core.model.TokenRequest
import app.delyra.core.model.TotpSetupResponse
import app.delyra.core.network.ApiError
import app.delyra.core.network.apiCall
import app.delyra.core.network.apiError
import kotlinx.coroutines.launch

/** Estado de un formulario de acceso. */
data class FormState(
    val busy: Boolean = false,
    val error: ApiError? = null,
    /** Sube tras cada intento con Turnstile: el token ya está gastado y hay que pedir otro. */
    val turnstileReset: Int = 0,
    val done: Boolean = false,
)

/**
 * Pasos de identidad (F8-02), igual que la web: login → segundo factor (o alta TOTP) → sesión
 * activa. Tras cada paso se pregunta a `/api/auth/me` y la raíz de la app cambia de pantalla.
 */
class AuthViewModel(private val graph: AppGraph) : ViewModel() {
    private val api = graph.authApi

    var login by mutableStateOf(FormState())
        private set
    var secondFactor by mutableStateOf(FormState())
        private set
    var totp by mutableStateOf(FormState())
        private set
    var totpEnrollment by mutableStateOf<TotpSetupResponse?>(null)
        private set
    var recoveryCodes by mutableStateOf<List<String>?>(null)
        private set
    var register by mutableStateOf(FormState())
        private set
    var invitation by mutableStateOf<InvitationInfo?>(null)
        private set
    var forgot by mutableStateOf(FormState())
        private set
    var reset by mutableStateOf(FormState())
        private set

    fun login(email: String, password: String, turnstileToken: String?) {
        if (login.busy) return
        if (turnstileToken == null) {
            login = login.copy(error = ApiError.Validation(emptyMap(), null))
            return
        }
        login = FormState(busy = true, turnstileReset = login.turnstileReset)
        viewModelScope.launch {
            val result = apiCall { api.login(LoginRequest(email.trim().lowercase(), password, turnstileToken)) }
            result.onSuccess { graph.session.refresh() }
            login = FormState(error = result.exceptionOrNull()?.apiError, turnstileReset = login.turnstileReset + 1)
        }
    }

    fun submitSecondFactor(code: String) {
        if (secondFactor.busy || code.isBlank()) return
        secondFactor = FormState(busy = true)
        viewModelScope.launch {
            val result = apiCall { api.secondFactor(CodeRequest(code.trim())) }
            result.onSuccess {
                graph.session.recoveryCodesLeft.value = it.remainingRecoveryCodes
                graph.session.refresh()
            }.onFailure {
                // Tras 5 fallos la API revoca la sesión pendiente: `/auth/me` lo dirá (→ login).
                if (it.apiError is ApiError.Unauthorized) graph.session.refresh()
            }
            secondFactor = FormState(error = result.exceptionOrNull()?.apiError)
        }
    }

    /** Abandona un login a medias (sesión pendiente) y vuelve al formulario. */
    fun cancelPending() {
        viewModelScope.launch { graph.session.logout() }
    }

    fun startTotpEnrollment() {
        if (totpEnrollment != null || totp.busy) return
        totp = FormState(busy = true)
        viewModelScope.launch {
            val result = apiCall { api.totpSetup() }
            totpEnrollment = result.getOrNull()
            totp = FormState(error = result.exceptionOrNull()?.apiError)
        }
    }

    fun confirmTotp(code: String) {
        if (totp.busy || code.length != 6) return
        totp = FormState(busy = true)
        viewModelScope.launch {
            val result = apiCall { api.totpConfirm(CodeRequest(code)) }
            recoveryCodes = result.getOrNull()?.recoveryCodes
            totp = FormState(error = result.exceptionOrNull()?.apiError)
        }
    }

    /** Tras guardar los códigos de recuperación: la sesión ya es activa. */
    fun finishEnrollment() {
        viewModelScope.launch {
            graph.session.refresh()
            recoveryCodes = null
            totpEnrollment = null
        }
    }

    fun checkInvitation(link: String) {
        val token = extractToken(link) ?: run {
            register = register.copy(error = ApiError.Validation(mapOf("token" to ""), null))
            return
        }
        register = FormState(busy = true)
        viewModelScope.launch {
            val result = apiCall { api.invitation(TokenRequest(token)) }
            invitation = result.getOrNull()
            invitationToken = if (result.isSuccess) token else null
            register = FormState(error = result.exceptionOrNull()?.apiError)
        }
    }

    private var invitationToken: String? = null

    fun register(name: String, password: String, turnstileToken: String?) {
        val token = invitationToken ?: return
        if (register.busy || turnstileToken == null) return
        register = FormState(busy = true, turnstileReset = register.turnstileReset)
        viewModelScope.launch {
            val result = apiCall { api.register(RegisterRequest(token, name.trim(), password, turnstileToken)) }
            result.onSuccess { graph.session.refresh() }
            register = FormState(error = result.exceptionOrNull()?.apiError, turnstileReset = register.turnstileReset + 1)
        }
    }

    fun forgotPassword(email: String, turnstileToken: String?) {
        if (forgot.busy || turnstileToken == null) return
        forgot = FormState(busy = true, turnstileReset = forgot.turnstileReset)
        viewModelScope.launch {
            val result = apiCall { api.forgotPassword(ForgotPasswordRequest(email.trim().lowercase(), turnstileToken)) }
            forgot = FormState(
                error = result.exceptionOrNull()?.apiError,
                done = result.isSuccess,
                turnstileReset = forgot.turnstileReset + 1,
            )
        }
    }

    fun resetPassword(link: String, password: String) {
        val token = extractToken(link) ?: run {
            reset = reset.copy(error = ApiError.Validation(mapOf("token" to ""), null))
            return
        }
        if (reset.busy) return
        reset = FormState(busy = true)
        viewModelScope.launch {
            val result = apiCall { api.resetPassword(ResetPasswordRequest(token, password)) }
            reset = FormState(error = result.exceptionOrNull()?.apiError, done = result.isSuccess)
        }
    }

    fun clearForgot() {
        forgot = FormState()
        reset = FormState()
    }

    companion object {
        private val TOKEN = Regex("^[\\w-]{20,128}$")

        /**
         * Token de un enlace de invitación o de recuperación (`…/registro#token=…`,
         * `…/restablecer#token=…`) o el token suelto. El token va en el fragmento, nunca en la query.
         */
        fun extractToken(input: String): String? {
            val text = input.trim()
            if (TOKEN.matches(text)) return text
            val fragment = text.substringAfter('#', "")
            val value = fragment.split('&').firstNotNullOfOrNull { part ->
                part.split('=', limit = 2).takeIf { it.size == 2 && it[0] == "token" }?.get(1)
            }
            return value?.takeIf { TOKEN.matches(it) }
        }
    }
}
