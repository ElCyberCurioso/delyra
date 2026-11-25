package app.delyra.core.security

import android.content.Context
import android.os.Build
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.CreateCredentialProviderConfigurationException
import androidx.credentials.exceptions.CreateCredentialUnsupportedException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.GetCredentialUnsupportedException
import androidx.credentials.exceptions.NoCredentialException

/** Cómo acabó una ceremonia de llave de acceso. */
sealed interface PasskeyResult {
    /** JSON de la respuesta (`RegistrationResponseJSON` o `AuthenticationResponseJSON`). */
    data class Ok(val json: String) : PasskeyResult
    /** La persona canceló o se agotó el tiempo: no es un error que haya que explicar. */
    data object Cancelled : PasskeyResult
    /** El móvil no puede (sin bloqueo de pantalla, sin gestor de contraseñas, sin Google Play). */
    data object Unsupported : PasskeyResult
    /** No hay ninguna llave de esta cuenta en el móvil. */
    data object NoCredential : PasskeyResult
    data object Failed : PasskeyResult
}

/**
 * Llaves de acceso con Credential Manager (F8-10). Las opciones llegan de la API tal cual
 * (`@simplewebauthn/server`) y la respuesta vuelve tal cual: Android la firma con el origen
 * `android:apk-key-hash:…`, que la API acepta porque el certificado está en `@delyra/shared` y en
 * `https://delyra.app/.well-known/assetlinks.json`. Necesita un contexto de actividad.
 */
object Passkeys {
    /** Las llaves de acceso de Credential Manager existen desde Android 9 (API 28). */
    val supported: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P

    suspend fun create(context: Context, optionsJson: String): PasskeyResult = if (!supported) PasskeyResult.Unsupported else try {
        val response = CredentialManager.create(context).createCredential(context, CreatePublicKeyCredentialRequest(optionsJson))
        (response as? CreatePublicKeyCredentialResponse)?.let { PasskeyResult.Ok(it.registrationResponseJson) } ?: PasskeyResult.Failed
    } catch (_: CreateCredentialCancellationException) {
        PasskeyResult.Cancelled
    } catch (_: CreateCredentialProviderConfigurationException) {
        PasskeyResult.Unsupported
    } catch (_: CreateCredentialUnsupportedException) {
        PasskeyResult.Unsupported
    } catch (_: CreateCredentialException) {
        PasskeyResult.Failed
    }

    suspend fun get(context: Context, optionsJson: String): PasskeyResult = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) PasskeyResult.Unsupported else try {
        val request = GetCredentialRequest(listOf(GetPublicKeyCredentialOption(optionsJson)))
        val credential = CredentialManager.create(context).getCredential(context, request).credential
        (credential as? PublicKeyCredential)?.let { PasskeyResult.Ok(it.authenticationResponseJson) } ?: PasskeyResult.Failed
    } catch (_: GetCredentialCancellationException) {
        PasskeyResult.Cancelled
    } catch (_: NoCredentialException) {
        PasskeyResult.NoCredential
    } catch (_: GetCredentialProviderConfigurationException) {
        PasskeyResult.Unsupported
    } catch (_: GetCredentialUnsupportedException) {
        PasskeyResult.Unsupported
    } catch (_: GetCredentialException) {
        PasskeyResult.Failed
    }
}
