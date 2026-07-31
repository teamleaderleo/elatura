plugins {
    id("com.android.application")
}

val elaturaBuildSha = System.getenv("GITHUB_SHA")?.takeIf(String::isNotBlank) ?: "local"
val elaturaBuildRunId = System.getenv("GITHUB_RUN_ID")?.takeIf(String::isNotBlank) ?: "local"
val elaturaBuildRunNumber = System.getenv("GITHUB_RUN_NUMBER")
    ?.toIntOrNull()
    ?.coerceAtLeast(1)
    ?: 1
val elaturaSigningMode = System.getenv("ELATURA_SIGNING_MODE")
    ?.trim()
    ?.take(64)
    ?.takeIf(String::isNotEmpty)
    ?: "local-debug"
val stableSigningRequested = elaturaSigningMode == "stable-private"
val stableKeystorePath = System.getenv("ELATURA_ANDROID_KEYSTORE_PATH")?.takeIf(String::isNotBlank)
val stableKeystorePassword = System.getenv("ELATURA_ANDROID_KEYSTORE_PASSWORD")?.takeIf(String::isNotBlank)
val stableKeyAlias = System.getenv("ELATURA_ANDROID_KEY_ALIAS")?.takeIf(String::isNotBlank)
val stableKeyPassword = System.getenv("ELATURA_ANDROID_KEY_PASSWORD")?.takeIf(String::isNotBlank)

if (stableSigningRequested) {
    requireNotNull(stableKeystorePath) { "Stable signing requires ELATURA_ANDROID_KEYSTORE_PATH" }
    requireNotNull(stableKeystorePassword) { "Stable signing requires ELATURA_ANDROID_KEYSTORE_PASSWORD" }
    requireNotNull(stableKeyAlias) { "Stable signing requires ELATURA_ANDROID_KEY_ALIAS" }
    requireNotNull(stableKeyPassword) { "Stable signing requires ELATURA_ANDROID_KEY_PASSWORD" }
    require(file(stableKeystorePath).isFile) { "Stable Android keystore file is missing" }
}

android {
    namespace = "dev.elatura.notificationcompanion"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.elatura.notificationcompanion"
        minSdk = 28
        targetSdk = 36
        versionCode = elaturaBuildRunNumber
        versionName = "0.1.0-dev.$elaturaBuildRunNumber-$elaturaSigningMode"
        buildConfigField("String", "ELATURA_BUILD_SHA", "\"$elaturaBuildSha\"")
        buildConfigField("String", "ELATURA_BUILD_RUN_ID", "\"$elaturaBuildRunId\"")
        buildConfigField("String", "ELATURA_SIGNING_MODE", "\"$elaturaSigningMode\"")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (stableSigningRequested) {
            create("stable") {
                storeFile = file(requireNotNull(stableKeystorePath))
                storePassword = requireNotNull(stableKeystorePassword)
                keyAlias = requireNotNull(stableKeyAlias)
                keyPassword = requireNotNull(stableKeyPassword)
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (stableSigningRequested) {
                signingConfig = signingConfigs.getByName("stable")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isIncludeAndroidResources = false
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
