# kotlinx.serialization y Retrofit 3 traen sus propias reglas de R8 dentro de las librerías.
# Las interfaces de la API se usan por reflexión (proxies de Retrofit).
-keepattributes Signature, InnerClasses, EnclosingMethod, *Annotation*
-keep,allowobfuscation,allowshrinking interface app.delyra.core.network.api.**

# Credential Manager (F8-10): el proveedor de Google Play Services se carga por reflexión.
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** { *; }
