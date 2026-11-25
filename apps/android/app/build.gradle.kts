import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Versión (F8-11): el workflow de publicación pasa `-Pdelyra.versionName=X.Y.Z`. El versionCode
// sale de ella (X·10000 + Y·100 + Z), así que crece siempre que sube la versión.
val appVersionName = providers.gradleProperty("delyra.versionName").orElse("0.1.0").get()
val appVersionCode = Regex("""^(\d{1,3})\.(\d{1,2})\.(\d{1,2})$""").matchEntire(appVersionName)
    ?.destructured?.let { (major, minor, patch) -> major.toInt() * 10_000 + minor.toInt() * 100 + patch.toInt() }
    ?: error("delyra.versionName debe ser X.Y.Z, con Y y Z menores que 100 (es «$appVersionName»)")

// Firma de publicación (F8-11): la clave de subida solo existe en los secretos del workflow de
// publicación, nunca en el repositorio. Sin ella, `bundleRelease` genera un AAB sin firmar.
val uploadKeystore = providers.environmentVariable("DELYRA_UPLOAD_KEYSTORE").orNull
fun uploadSecret(name: String): String =
    providers.environmentVariable(name).orNull ?: error("Falta la variable de entorno $name")

android {
    namespace = "app.delyra"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.delyra"
        minSdk = 26
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Orígenes de `packages/shared/src/app-origins.json`: la API se alcanza a través de la SPA.
        buildConfigField("String", "PRODUCTION_ORIGIN", "\"https://delyra.app\"")
        buildConfigField("String", "LOCAL_ORIGIN", "\"http://localhost:5173\"")
        // La web de tareas: para lo que solo se hace en el navegador (conectar Microsoft 365).
        buildConfigField("String", "PRODUCTION_WORK_ORIGIN", "\"https://work.delyra.app\"")
        buildConfigField("String", "LOCAL_WORK_ORIGIN", "\"http://localhost:5174\"")
    }

    signingConfigs {
        if (uploadKeystore != null) {
            create("upload") {
                storeFile = file(uploadKeystore)
                storePassword = uploadSecret("DELYRA_UPLOAD_STORE_PASSWORD")
                keyAlias = uploadSecret("DELYRA_UPLOAD_KEY_ALIAS")
                keyPassword = uploadSecret("DELYRA_UPLOAD_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            // En debug se puede elegir el entorno (producción o `pnpm dev` con `adb reverse`).
            buildConfigField("boolean", "ALLOW_LOCAL", "true")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("boolean", "ALLOW_LOCAL", "false")
            signingConfig = signingConfigs.findByName("upload")
        }
        // Igual que release (R8 y recursos reducidos), pero firmada con la clave debug y con
        // `pnpm dev`: para comprobar en local que R8 no rompe nada. Nunca se publica.
        create("qa") {
            initWith(getByName("release"))
            applicationIdSuffix = ".qa"
            versionNameSuffix = "-qa"
            signingConfig = signingConfigs.getByName("debug")
            buildConfigField("boolean", "ALLOW_LOCAL", "true")
        }
    }

    sourceSets {
        // qa: sin log HTTP (el código de release) y con texto plano hacia `pnpm dev` (la red de debug).
        getByName("qa") {
            kotlin.srcDir("src/release/java")
            res.srcDir("src/debug/res")
        }
    }

    bundle {
        // El idioma se cambia dentro de la app (Ajustes): los dos van en todas las instalaciones.
        language {
            enableSplit = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    androidResources {
        // Idioma por app (Android 13+): genera `locales_config` a partir de `values-*`.
        generateLocaleConfig = true
    }

    lint {
        warningsAsErrors = false
        abortOnError = true
        checkDependencies = false
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion")
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        optIn.addAll(
            "androidx.compose.material3.ExperimentalMaterial3Api",
            "androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi",
            "androidx.compose.foundation.layout.ExperimentalLayoutApi",
            "kotlinx.serialization.ExperimentalSerializationApi",
        )
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.browser)
    // Llaves de acceso (F8-10): Credential Manager y su proveedor de Google Play Services.
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.material3.navigation.suite)
    implementation(libs.compose.material.icons)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.adaptive)
    implementation(libs.adaptive.layout)
    implementation(libs.adaptive.navigation)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    debugImplementation(libs.okhttp.logging)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
