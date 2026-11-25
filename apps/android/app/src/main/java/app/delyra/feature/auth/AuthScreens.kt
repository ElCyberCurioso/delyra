package app.delyra.feature.auth

import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.core.net.toUri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.ViewKanban
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.delyra.R
import app.delyra.core.security.Passkeys
import app.delyra.navigation.AppLinks
import app.delyra.core.ui.LocalAppGraph
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.delyra.core.model.TotpSetupResponse
import app.delyra.core.network.ApiError
import app.delyra.core.session.SessionState
import app.delyra.core.ui.CodeField
import app.delyra.core.ui.EmailField
import app.delyra.core.ui.ErrorText
import app.delyra.core.ui.PasswordField
import app.delyra.core.ui.SecureScreen
import app.delyra.core.ui.appViewModel
import app.delyra.core.ui.copy
import app.delyra.core.ui.message
import app.delyra.core.ui.rememberWindowLayout
import kotlinx.coroutines.launch

private enum class SignedOutScreen { Login, Register, Forgot, Reset }

/** Raíz de las pantallas sin sesión activa: el paso lo decide el estado de la sesión. */
@Composable
fun AuthFlow(state: SessionState) {
    val vm = appViewModel { AuthViewModel(it) }
    var screen by rememberSaveable { mutableStateOf(SignedOutScreen.Login) }
    // Un enlace de invitación o de recuperación (App Link) lleva a su formulario, ya relleno.
    val graph = LocalAppGraph.current
    val incoming by graph.incomingLink.collectAsStateWithLifecycle()
    LaunchedEffect(incoming) {
        val link = incoming ?: return@LaunchedEffect
        graph.incomingLink.value = null
        when (AppLinks.kind(link)) {
            AppLinks.Kind.Invitation -> {
                screen = SignedOutScreen.Register
                vm.prefilledLink = link
                vm.checkInvitation(link)
            }
            AppLinks.Kind.PasswordReset -> {
                screen = SignedOutScreen.Reset
                vm.prefilledLink = link
            }
            null -> Unit
        }
    }
    AuthLayout {
        when (state) {
            is SessionState.PendingSecondFactor -> SecondFactorForm(vm, passkey = state.passkey)
            is SessionState.PendingTotp -> TotpSetupForm(vm)
            else -> {
                if (screen != SignedOutScreen.Login) BackHandler { screen = SignedOutScreen.Login; vm.clearForgot() }
                when (screen) {
                    SignedOutScreen.Login -> LoginForm(
                        vm,
                        expired = (state as? SessionState.SignedOut)?.expired == true,
                        onRegister = { screen = SignedOutScreen.Register },
                        onForgot = { screen = SignedOutScreen.Forgot },
                    )
                    SignedOutScreen.Register -> RegisterForm(vm, onBack = { screen = SignedOutScreen.Login })
                    SignedOutScreen.Forgot -> ForgotForm(
                        vm,
                        onReset = { screen = SignedOutScreen.Reset },
                        onBack = { screen = SignedOutScreen.Login; vm.clearForgot() },
                    )
                    SignedOutScreen.Reset -> ResetForm(vm, onBack = { screen = SignedOutScreen.Login; vm.clearForgot() })
                }
                if (app.delyra.BuildConfig.ALLOW_LOCAL) DebugEnvironmentSwitch()
            }
        }
    }
}

/**
 * Pantallas anchas: panel de marca a la izquierda y el formulario en un mosaico a la derecha (como
 * la web). Estrechas: solo el formulario, desplazable y por encima del teclado.
 */
@Composable
private fun AuthLayout(content: @Composable () -> Unit) {
    val layout = rememberWindowLayout()
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Row(Modifier.fillMaxSize().safeDrawingPadding()) {
            if (layout.atLeastMedium && !layout.shortHeight) {
                BrandPanel(Modifier.weight(1f).fillMaxHeight().padding(16.dp))
            }
            Box(
                Modifier.weight(1f).fillMaxHeight().imePadding().verticalScroll(rememberScrollState()),
                contentAlignment = Alignment.Center,
            ) {
                Surface(
                    modifier = Modifier.padding(16.dp).widthIn(max = 440.dp).fillMaxWidth(),
                    shape = MaterialTheme.shapes.large,
                    color = MaterialTheme.colorScheme.surfaceContainerLowest,
                    shadowElevation = 2.dp,
                ) {
                    Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        BrandMark()
                        content()
                    }
                }
            }
        }
    }
}

@Composable
private fun BrandMark() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(
            Modifier.size(36.dp).background(
                Brush.linearGradient(listOf(Color(0xFF00A166), Color(0xFF007145))),
                RoundedCornerShape(10.dp),
            ),
            contentAlignment = Alignment.Center,
        ) { Text("D", color = Color.White, fontWeight = FontWeight.Bold) }
        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.titleLarge)
    }
}

@Composable
private fun BrandPanel(modifier: Modifier) {
    Box(
        modifier.background(
            Brush.linearGradient(listOf(Color(0xFF00A166), Color(0xFF007145), Color(0xFF0B3D2A))),
            MaterialTheme.shapes.extraLarge,
        ).padding(32.dp),
    ) {
        Column(Modifier.align(Alignment.CenterStart), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            Text(stringResource(R.string.auth_brand_title), style = MaterialTheme.typography.displaySmall, color = Color.White)
            Feature(Icons.Outlined.CalendarMonth, stringResource(R.string.auth_brand_calendar))
            Feature(Icons.Outlined.ViewKanban, stringResource(R.string.auth_brand_tasks))
            Feature(Icons.Outlined.Lock, stringResource(R.string.auth_brand_security))
        }
    }
}

@Composable
private fun Feature(icon: ImageVector, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(icon, null, tint = Color.White)
        Text(text, color = Color.White.copy(alpha = 0.92f), style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun Title(text: String, subtitle: String? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(text, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
        if (subtitle != null) {
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SubmitButton(text: String, busy: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled && !busy, modifier = Modifier.fillMaxWidth().height(48.dp)) {
        if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text(text)
    }
}

@Composable
private fun FormError(error: ApiError?, fallbackTurnstile: Boolean = false) {
    if (error == null) return
    if (fallbackTurnstile && error is ApiError.Validation && error.detail == null && error.fields.isEmpty()) {
        Text(stringResource(R.string.turnstile_required), color = MaterialTheme.colorScheme.error)
    } else {
        ErrorText(error)
    }
}

/** Solo en debug: elegir producción o el `pnpm dev` local (con `adb reverse tcp:5173 tcp:5173`). */
@Composable
private fun DebugEnvironmentSwitch() {
    val graph = app.delyra.core.ui.LocalAppGraph.current
    val current by graph.environmentFlow.collectAsState()
    val scope = rememberCoroutineScope()
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.settings_environment), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        app.delyra.core.config.Environment.entries.forEach { env ->
            androidx.compose.material3.FilterChip(
                selected = current == env,
                onClick = { scope.launch { graph.switchEnvironment(env) } },
                label = { Text(if (env == app.delyra.core.config.Environment.LOCAL) "local" else "delyra.app", maxLines = 1) },
            )
        }
    }
}

// ── Login ──────────────────────────────────────────────────────────────────────

@Composable
private fun LoginForm(vm: AuthViewModel, expired: Boolean, onRegister: () -> Unit, onForgot: () -> Unit) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var token by rememberSaveable { mutableStateOf<String?>(null) }
    val state = vm.login
    val submit = { vm.login(email, password, token) }

    Title(stringResource(R.string.login_title), stringResource(R.string.login_subtitle))
    if (expired) Text(stringResource(R.string.login_expired), color = MaterialTheme.colorScheme.tertiary)
    EmailField(email, { email = it }, Modifier.fillMaxWidth())
    PasswordField(password, { password = it }, stringResource(R.string.field_password), Modifier.fillMaxWidth(), onDone = submit)
    TurnstileWidget(action = "login", resetKey = state.turnstileReset, onToken = { token = it })
    FormError(state.error, fallbackTurnstile = true)
    SubmitButton(stringResource(R.string.login_submit), state.busy, enabled = email.isNotBlank() && password.isNotEmpty(), onClick = submit)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        TextButton(onClick = onForgot) { Text(stringResource(R.string.login_forgot)) }
        TextButton(onClick = onRegister) { Text(stringResource(R.string.login_have_invitation)) }
    }
}

// ── Segundo factor ─────────────────────────────────────────────────────────────

@Composable
private fun SecondFactorForm(vm: AuthViewModel, passkey: Boolean) {
    var code by rememberSaveable { mutableStateOf("") }
    var recovery by rememberSaveable { mutableStateOf(false) }
    val state = vm.secondFactor
    val submit = { vm.submitSecondFactor(code) }
    BackHandler { vm.cancelPending() }

    Title(
        stringResource(R.string.second_factor_title),
        stringResource(if (recovery) R.string.second_factor_recovery_hint else R.string.second_factor_hint),
    )
    CodeField(
        code,
        { code = it },
        stringResource(if (recovery) R.string.field_recovery_code else R.string.field_totp_code),
        Modifier.fillMaxWidth(),
        recovery = recovery,
        onDone = submit,
    )
    FormError(state.error)
    SubmitButton(
        stringResource(R.string.second_factor_submit),
        state.busy,
        enabled = if (recovery) code.length >= 10 else code.length == 6,
        onClick = submit,
    )
    TextButton(onClick = { recovery = !recovery; code = "" }) {
        Text(stringResource(if (recovery) R.string.second_factor_use_totp else R.string.second_factor_use_recovery))
    }
    // La cuenta tiene llaves de acceso: se puede entrar con la huella, la cara o el PIN.
    if (passkey && Passkeys.supported) {
        val activity = LocalActivity.current
        OutlinedButton(
            onClick = { activity?.let(vm::signInWithPasskey) },
            enabled = !state.busy && activity != null,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(Icons.Outlined.Key, null)
            Spacer(Modifier.size(8.dp))
            Text(stringResource(R.string.passkey_use))
        }
        vm.passkeyProblem?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    }
    TextButton(onClick = vm::cancelPending) { Text(stringResource(R.string.action_cancel)) }
}

// ── Alta del TOTP ──────────────────────────────────────────────────────────────

@Composable
private fun TotpSetupForm(vm: AuthViewModel) {
    SecureScreen()
    LaunchedEffect(Unit) { vm.startTotpEnrollment() }
    val codes = vm.recoveryCodes
    if (codes != null) {
        RecoveryCodesView(codes, onDone = vm::finishEnrollment)
        return
    }
    val enrollment = vm.totpEnrollment
    var code by rememberSaveable { mutableStateOf("") }
    BackHandler { vm.cancelPending() }

    Title(stringResource(R.string.totp_title), stringResource(R.string.totp_subtitle))
    if (enrollment == null) {
        if (vm.totp.busy) CircularProgressIndicator() else FormError(vm.totp.error)
        if (vm.totp.error != null) OutlinedButton(onClick = vm::startTotpEnrollment) { Text(stringResource(R.string.action_retry)) }
        return
    }
    Text(stringResource(R.string.totp_step_open), style = MaterialTheme.typography.bodyMedium)
    TotpSecretBlock(enrollment)
    Text(stringResource(R.string.totp_step_code), style = MaterialTheme.typography.bodyMedium)
    CodeField(code, { code = it }, stringResource(R.string.field_totp_code), Modifier.fillMaxWidth(), onDone = { vm.confirmTotp(code) })
    FormError(vm.totp.error)
    SubmitButton(stringResource(R.string.totp_confirm), vm.totp.busy, enabled = code.length == 6) { vm.confirmTotp(code) }
    TextButton(onClick = vm::cancelPending) { Text(stringResource(R.string.action_cancel)) }
}

/** Abrir la app autenticadora con el `otpauth://` o copiar la clave a mano (alta y cambio de app). */
@Composable
fun TotpSecretBlock(enrollment: TotpSetupResponse) {
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var noApp by rememberSaveable { mutableStateOf(false) }
    Button(onClick = {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, enrollment.otpauthUri.toUri()))
        } catch (_: ActivityNotFoundException) {
            noApp = true
        }
    }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.totp_open_app)) }
    if (noApp) Text(stringResource(R.string.totp_no_app), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
    Text(stringResource(R.string.totp_step_manual), style = MaterialTheme.typography.bodyMedium)
    Row(verticalAlignment = Alignment.CenterVertically) {
        SelectionContainer(Modifier.weight(1f)) {
            Text(enrollment.secret.chunked(4).joinToString(" "), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.titleMedium)
        }
        TextButton(onClick = { scope.launch { clipboard.copy(enrollment.secret, sensitive = true) } }) {
            Icon(Icons.Outlined.ContentCopy, null)
            Spacer(Modifier.size(4.dp))
            Text(stringResource(R.string.action_copy))
        }
    }
}

@Composable
fun RecoveryCodesView(
    codes: List<String>,
    onDone: () -> Unit,
    title: String = stringResource(R.string.recovery_title),
    subtitle: String = stringResource(R.string.recovery_subtitle),
) {
    SecureScreen()
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var saved by rememberSaveable { mutableStateOf(false) }
    Title(title, subtitle)
    SelectionContainer {
        Column(
            Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer, MaterialTheme.shapes.medium).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            codes.chunked(2).forEach { pair ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    pair.forEach { Text(it, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.titleMedium) }
                }
            }
        }
    }
    OutlinedButton(onClick = { scope.launch { clipboard.copy(codes.joinToString("\n"), sensitive = true) } }, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Outlined.ContentCopy, null)
        Spacer(Modifier.size(8.dp))
        Text(stringResource(R.string.recovery_copy))
    }
    // Toda la fila marca la casilla (no solo el cuadrado).
    Row(
        Modifier.fillMaxWidth().toggleable(saved, role = Role.Checkbox) { saved = it },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = saved, onCheckedChange = null, modifier = Modifier.padding(12.dp))
        Text(stringResource(R.string.recovery_saved))
    }
    Button(onClick = onDone, enabled = saved, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text(stringResource(R.string.action_continue)) }
}

// ── Registro por invitación ────────────────────────────────────────────────────

@Composable
private fun RegisterForm(vm: AuthViewModel, onBack: () -> Unit) {
    var link by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(vm.prefilledLink) { vm.prefilledLink?.let { link = it; vm.prefilledLink = null } }
    var name by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var repeat by rememberSaveable { mutableStateOf("") }
    var token by rememberSaveable { mutableStateOf<String?>(null) }
    val state = vm.register
    val invitation = vm.invitation

    Title(stringResource(R.string.register_title), stringResource(R.string.register_subtitle))
    if (invitation == null) {
        OutlinedTextField(
            value = link,
            onValueChange = { link = it.take(2048) },
            label = { Text(stringResource(R.string.register_link)) },
            supportingText = { Text(stringResource(R.string.register_link_hint)) },
            modifier = Modifier.fillMaxWidth(),
        )
        if (state.error is ApiError.Validation && state.error.fields.containsKey("token")) {
            Text(stringResource(R.string.register_link_invalid), color = MaterialTheme.colorScheme.error)
        } else {
            FormError(state.error)
        }
        SubmitButton(stringResource(R.string.action_continue), state.busy, enabled = link.isNotBlank()) { vm.checkInvitation(link) }
    } else {
        Text(stringResource(R.string.register_for, invitation.email), style = MaterialTheme.typography.bodyLarge)
        OutlinedTextField(
            value = name,
            onValueChange = { name = it.take(80) },
            label = { Text(stringResource(R.string.field_name)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        val tooShort = password.isNotEmpty() && password.length < 12
        PasswordField(
            password, { password = it }, stringResource(R.string.field_new_password), Modifier.fillMaxWidth(),
            newPassword = true, imeAction = ImeAction.Next,
            error = if (tooShort) stringResource(R.string.password_min) else null,
            supporting = stringResource(R.string.password_rules),
        )
        val mismatch = repeat.isNotEmpty() && repeat != password
        PasswordField(
            repeat, { repeat = it }, stringResource(R.string.field_repeat_password), Modifier.fillMaxWidth(),
            newPassword = true, error = if (mismatch) stringResource(R.string.password_mismatch) else null,
        )
        TurnstileWidget(action = "register", resetKey = state.turnstileReset, onToken = { token = it })
        FormError(state.error)
        SubmitButton(
            stringResource(R.string.register_submit),
            state.busy,
            enabled = name.isNotBlank() && password.length >= 12 && password == repeat && token != null,
        ) { vm.register(name, password, token) }
    }
    TextButton(onClick = onBack) { Text(stringResource(R.string.action_back_to_login)) }
}

// ── Recuperar la contraseña ────────────────────────────────────────────────────

@Composable
private fun ForgotForm(vm: AuthViewModel, onReset: () -> Unit, onBack: () -> Unit) {
    var email by rememberSaveable { mutableStateOf("") }
    var token by rememberSaveable { mutableStateOf<String?>(null) }
    val state = vm.forgot
    Title(stringResource(R.string.forgot_title), stringResource(R.string.forgot_subtitle))
    if (state.done) {
        Text(stringResource(R.string.forgot_sent), textAlign = TextAlign.Start)
        Button(onClick = onReset, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.forgot_have_link)) }
    } else {
        EmailField(email, { email = it }, Modifier.fillMaxWidth(), imeAction = ImeAction.Done)
        TurnstileWidget(action = "forgot", resetKey = state.turnstileReset, onToken = { token = it })
        FormError(state.error)
        SubmitButton(stringResource(R.string.forgot_submit), state.busy, enabled = email.contains('@') && token != null) {
            vm.forgotPassword(email, token)
        }
        TextButton(onClick = onReset) { Text(stringResource(R.string.forgot_have_link)) }
    }
    TextButton(onClick = onBack) { Text(stringResource(R.string.action_back_to_login)) }
}

@Composable
private fun ResetForm(vm: AuthViewModel, onBack: () -> Unit) {
    var link by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(vm.prefilledLink) { vm.prefilledLink?.let { link = it; vm.prefilledLink = null } }
    var password by rememberSaveable { mutableStateOf("") }
    var repeat by rememberSaveable { mutableStateOf("") }
    val state = vm.reset
    Title(stringResource(R.string.reset_title), stringResource(R.string.reset_subtitle))
    if (state.done) {
        Text(stringResource(R.string.reset_done))
        Button(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.action_back_to_login)) }
        return
    }
    OutlinedTextField(
        value = link,
        onValueChange = { link = it.take(2048) },
        label = { Text(stringResource(R.string.reset_link)) },
        modifier = Modifier.fillMaxWidth(),
    )
    PasswordField(
        password, { password = it }, stringResource(R.string.field_new_password), Modifier.fillMaxWidth(),
        newPassword = true, imeAction = ImeAction.Next, supporting = stringResource(R.string.password_rules),
    )
    PasswordField(
        repeat, { repeat = it }, stringResource(R.string.field_repeat_password), Modifier.fillMaxWidth(), newPassword = true,
        error = if (repeat.isNotEmpty() && repeat != password) stringResource(R.string.password_mismatch) else null,
    )
    if (state.error is ApiError.Validation && state.error.fields.containsKey("token")) {
        Text(stringResource(R.string.reset_link_invalid), color = MaterialTheme.colorScheme.error)
    } else {
        FormError(state.error)
    }
    SubmitButton(stringResource(R.string.reset_submit), state.busy, enabled = link.isNotBlank() && password.length >= 12 && password == repeat) {
        vm.resetPassword(link, password)
    }
    TextButton(onClick = onBack) { Text(stringResource(R.string.action_back_to_login)) }
}

/** Mensaje de error de un fallo cualquiera (para usar fuera de los formularios). */
@Composable
fun ApiError?.text(): String? = this?.message()
