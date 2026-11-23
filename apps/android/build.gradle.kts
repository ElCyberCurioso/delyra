// AGP 9 trae Kotlin integrado: no se aplica `org.jetbrains.kotlin.android`. Los plugins de Kotlin
// de abajo fijan la versión del compilador (docs/plan-android.md).
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
